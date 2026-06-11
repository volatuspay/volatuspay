import { Router, type Response } from 'express';
import {
  verifyFirebaseToken,
  AuthenticatedRequest
} from '../security/firebase-auth.js';
import { ensureFirebaseReady, getAdmin, getFirestore } from '../lib/firebase-admin.js';
import { replayProtectionMiddleware, idempotencyMiddleware } from '../security/idempotency.js';
import { userRateLimit } from '../security/user-rate-limiter.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { storage } from '../storage.js';
import { nanoid } from 'nanoid';

const membersCoproductionRouter = Router();

const BASE_URL = process.env.VITE_PLATFORM_DOMAIN
  ? `https://${process.env.VITE_PLATFORM_DOMAIN}`
  : (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '');

// ==================================================================================
// 👤 MEMBERS AUTH - Registro e Login para Área de Membros
// ==================================================================================

// 📝 REGISTRAR CONTA DE MEMBRO (Área de Membros)
membersCoproductionRouter.post('/api/members/register', async (req, res) => {
  try {
    console.log('📝 Registro de membro recebido');
    
    const { memberRegisterSchema } = await import('../../shared/schema.js');
    const validation = memberRegisterSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validation.error.errors 
      });
    }
    
    const { name, email, whatsapp, password } = validation.data;
    
    await ensureFirebaseReady();
    const adminInst = getAdmin();
    const { neonQuery } = await import('../lib/neon-db.js');

    // 🔐 VALIDAR: Email deve ter compra válida (order completed/paid)
    let validOrders: any[] = [];
    await neonQuery(async (sql: any) => {
      validOrders = await sql`SELECT id, product_id, status FROM orders WHERE customer_email = ${email} AND status IN ('paid','completed','approved','active') LIMIT 50`;
    }, `members:register:validatePurchase:${email}`);

    if (validOrders.length === 0) {
      return res.status(403).json({
        error: 'Acesso negado',
        message: 'Email não possui compras válidas. Use o mesmo email da compra no checkout.'
      });
    }

    // Verificar se já existe conta com este email via Neon
    let existingMember: any = null;
    await neonQuery(async (sql: any) => {
      const rows = await sql`SELECT id FROM members WHERE email = ${email} LIMIT 1`;
      if (rows[0]) existingMember = rows[0];
    }, `members:register:checkExisting:${email}`);

    if (existingMember) {
      return res.status(409).json({
        error: 'Email já cadastrado',
        message: 'Já existe uma conta com este email. Faça login.'
      });
    }

    // Criar usuário no Firebase Auth
    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);

    const userRecord = await adminInst.auth().createUser({
      email,
      password,
      displayName: name,
    });

    // Salvar membro no Neon
    await neonQuery(async (sql: any) => {
      await sql`INSERT INTO members (id, user_id, email, name, whatsapp, password, created_at, updated_at) VALUES (${userRecord.uid}, ${userRecord.uid}, ${email}, ${name}, ${whatsapp || null}, ${hashedPassword}, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`;
    }, `members:register:save:${userRecord.uid}`);

    // Criar enrollments automaticamente para produtos comprados
    for (const order of validOrders) {
      if (!order.product_id) continue;
      let productType = 'digital';
      await neonQuery(async (sql: any) => {
        const rows = await sql`SELECT product_type FROM products WHERE id = ${order.product_id} LIMIT 1`;
        if (rows[0]) productType = rows[0].product_type || 'digital';
      }, `members:register:getProduct:${order.product_id}`);

      if (productType === 'digital' || productType === 'subscription') {
        const enrollmentId = `enr_${nanoid(12)}`;
        await neonQuery(async (sql: any) => {
          await sql`INSERT INTO enrollments (id, member_id, product_id, order_id, enrollment_type, customer_email, status, enrolled_at, created_at, updated_at) VALUES (${enrollmentId}, ${userRecord.uid}, ${order.product_id}, ${order.id}, 'purchase', ${email}, 'active', NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`;
        }, `members:register:enrollment:${enrollmentId}`);
        console.log(`✅ Enrollment criado: ${enrollmentId}`);
      }
    }

    // Gerar token de autenticação
    const customToken = await adminInst.auth().createCustomToken(userRecord.uid);
    
    console.log(`✅ Membro registrado: ${email}`);
    
    res.json({ 
      success: true,
      token: customToken,
      user: {
        uid: userRecord.uid,
        email,
        name,
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao registrar membro:', error);
    res.status(500).json({ 
      error: 'Erro ao criar conta',
      message: error.message 
    });
  }
});

// 🔑 LOGIN DE MEMBRO (Área de Membros)
membersCoproductionRouter.post('/api/members/login', async (req, res) => {
  try {
    console.log('🔑 Login de membro recebido');
    
    const { memberLoginSchema } = await import('../../shared/schema.js');
    const validation = memberLoginSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validation.error.errors 
      });
    }
    
    const { email, password } = validation.data;
    
    await ensureFirebaseReady();
    const adminInst2 = getAdmin();
    const { neonQuery: neonQ2 } = await import('../lib/neon-db.js');

    // Buscar membro por email via Neon
    let member: any = null;
    await neonQ2(async (sql: any) => {
      const rows = await sql`SELECT * FROM members WHERE email = ${email} LIMIT 1`;
      if (rows[0]) member = rows[0];
    }, `members:login:${email}`);

    if (!member) {
      return res.status(401).json({ error: 'Credenciais inválidas', message: 'Email ou senha incorretos' });
    }

    const storedHash = member.password || member.hashed_password;
    if (!storedHash) {
      return res.status(401).json({ error: 'Credenciais inválidas', message: 'Email ou senha incorretos' });
    }

    const bcrypt = await import('bcrypt');
    const passwordMatch = await bcrypt.compare(password, storedHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Credenciais inválidas', message: 'Email ou senha incorretos' });
    }

    // Gerar token de autenticação
    const customToken = await adminInst2.auth().createCustomToken(member.user_id || member.id);
    
    console.log(`✅ Login de membro bem-sucedido: ${email}`);
    
    res.json({ 
      success: true,
      token: customToken,
      user: {
        uid: member.userId,
        email: member.email,
        name: member.name,
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro no login de membro:', error);
    res.status(500).json({ 
      error: 'Erro ao fazer login',
      message: error.message 
    });
  }
});

// 🔑 RECUPERAR SENHA DA ÁREA DE MEMBROS (envia nova senha provisória por email — NÃO usa Firebase reset)
membersCoproductionRouter.post('/api/members/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email obrigatório' });
    }

    await ensureFirebaseReady();
    const { neonQuery: neonQ3 } = await import('../lib/neon-db.js');

    let forgotMember: any = null;
    await neonQ3(async (sql: any) => {
      const rows = await sql`SELECT id, user_id, email FROM members WHERE email = ${email} LIMIT 1`;
      if (rows[0]) forgotMember = rows[0];
    }, `members:forgotPw:${email}`);

    if (!forgotMember) {
      console.log(`⚠️ [FORGOT-PW] Email não encontrado: ${email}`);
      return res.json({ success: true });
    }

    // Gerar nova senha provisória
    const crypto = await import('crypto');
    const newPassword = crypto.randomBytes(4).toString('hex');

    // Atualizar bcrypt hash no Neon
    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await neonQ3(async (sql: any) => {
      await sql`UPDATE members SET password = ${hashedPassword}, updated_at = NOW() WHERE id = ${forgotMember.id}`;
    }, `members:forgotPw:update:${forgotMember.id}`);

    // Enviar email com nova senha provisória
    try {
      const { sendEmail } = await import('../lib/email-service.js');
      const BASE_URL_EMAIL = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : 'https://volatuspay.com';
      const loginUrl = `${BASE_URL_EMAIL}/areademembros`;

      await sendEmail({
        to: email,
        subject: 'Nova senha provisória - Área de Membros VolatusPay',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VolatusPay</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:30px;background:#111;border-radius:12px;padding:28px 20px;">
      <img src="${BASE_URL_EMAIL}/logos/volatus-pay-logo.png" alt="Logo" width="200" style="display:block;margin:0 auto;max-width:200px;height:auto;" />
    </div>
    <h1 style="color:#ffffff;font-size:24px;text-align:center;margin-bottom:12px;font-weight:700;">Nova Senha Gerada</h1>
    <p style="color:#bbb;font-size:15px;line-height:1.7;text-align:center;margin-bottom:24px;">Recebemos uma solicitacao de recuperacao de senha para sua conta na Area de Membros. Uma nova senha provisoria foi gerada para voce.</p>
    <div style="background:#151520;border:1px solid #2a2a40;border-radius:14px;padding:28px;margin:0 0 24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;color:#888;font-size:13px;border-bottom:1px solid #222;">Email</td><td style="padding:10px 0;color:#fff;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #222;">${email}</td></tr>
        <tr><td style="padding:14px 0 10px;color:#888;font-size:13px;">Nova senha provisoria</td><td style="padding:14px 0 10px;text-align:right;"><span style="background:#1a1a2e;border:1px solid #9B30FF;border-radius:8px;padding:8px 16px;color:#c084fc;font-size:18px;font-weight:700;letter-spacing:3px;font-family:monospace;">${newPassword}</span></td></tr>
        <tr><td colspan="2" style="padding-top:14px;color:#999;font-size:13px;line-height:1.6;">Recomendamos alterar esta senha assim que fizer login. Use o menu de configuracoes da sua conta.</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:28px 0;">
      <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#9B30FF 0%,#7B1FD4 100%);color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 36px;border-radius:10px;letter-spacing:0.3px;">Acessar Area de Membros</a>
    </div>
    <hr style="border:none;border-top:1px solid #222;margin:32px 0;">
    <p style="color:#555;font-size:12px;text-align:center;line-height:1.8;">Se voce nao solicitou esta recuperacao, ignore este email. Sua senha anterior permanece ativa ate o proximo login.<br>&copy; ${new Date().getFullYear()} VolatusPay &mdash; Todos os direitos reservados</p>
  </div>
</body></html>`,
      });
      console.log(`📧 [FORGOT-PW] Nova senha enviada por email para: ${email}`);
    } catch (emailError) {
      console.error(`⚠️ [FORGOT-PW] Erro ao enviar email:`, emailError);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ [FORGOT-PW] Erro:', error);
    res.status(500).json({ error: 'Erro ao processar recuperação de senha' });
  }
});

// 🔐 ALTERAR SENHA DA ÁREA DE MEMBROS
membersCoproductionRouter.post('/api/members/change-password', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    await ensureFirebaseReady();
    const adminInst3 = getAdmin();
    const { neonQuery: neonQ4 } = await import('../lib/neon-db.js');

    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualiza no Neon
    await neonQ4(async (sql: any) => {
      const existing = await sql`SELECT id FROM members WHERE email = ${user.email} LIMIT 1`;
      if (existing[0]) {
        await sql`UPDATE members SET password = ${hashedPassword}, updated_at = NOW() WHERE email = ${user.email}`;
      } else {
        await sql`INSERT INTO members (id, user_id, email, password, created_at, updated_at) VALUES (${user.uid}, ${user.uid}, ${user.email}, ${hashedPassword}, NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET password = ${hashedPassword}, updated_at = NOW()`;
      }
    }, `members:changePw:${user.uid}`);

    // Atualiza também no Firebase Auth
    await adminInst3.auth().updateUser(user.uid, { password: newPassword });

    console.log(`✅ [MEMBERS] Senha alterada para: ${user.email}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ [MEMBERS] Erro ao alterar senha:', error);
    res.status(500).json({ error: 'Erro ao alterar senha', message: error.message });
  }
});

// 🔍 VERIFICAR SE EMAIL TEM COMPRA VÁLIDA
membersCoproductionRouter.get('/api/members/verify-purchase/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { neonQuery: neonQ5 } = await import('../lib/neon-db.js');

    let purchaseOrders: any[] = [];
    await neonQ5(async (sql: any) => {
      purchaseOrders = await sql`SELECT id, product_id, product_name, created_at FROM orders WHERE customer_email = ${email} AND status IN ('paid','completed','approved','active') LIMIT 50`;
    }, `members:verifyPurchase:${email}`);

    const hasPurchase = purchaseOrders.length > 0;
    const products = purchaseOrders.map(o => ({
      productId: o.product_id,
      productName: o.product_name,
      orderId: o.id,
      purchaseDate: o.created_at,
    }));
    
    res.json({ 
      hasPurchase,
      products 
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao verificar compra:', error);
    res.status(500).json({ 
      error: 'Erro ao verificar compra',
      message: error.message 
    });
  }
});


// 📊 DASHBOARD DE MEMBROS - Dados completos
membersCoproductionRouter.get('/api/members/dashboard', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const memberId = req.user?.uid;
    const memberEmail = req.user?.email;
    
    if (!memberId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    console.log(`🔍 [MEMBERS-DASHBOARD] Buscando para memberId: ${memberId}, email: ${memberEmail}`);
    
    const { neonQuery: neonQ6 } = await import('../lib/neon-db.js');

    // 1. Buscar enrollments via Neon (por memberId e por customerEmail)
    let enrollments: any[] = [];
    await neonQ6(async (sql: any) => {
      const rows1 = await sql`SELECT * FROM enrollments WHERE member_id = ${memberId} AND status = 'active'`;
      const rows2 = memberEmail ? await sql`SELECT * FROM enrollments WHERE customer_email = ${memberEmail} AND status = 'active'` : [];
      const seen = new Set<string>();
      for (const r of [...rows1, ...rows2]) {
        if (!seen.has(r.id)) { seen.add(r.id); enrollments.push({ id: r.id, productId: r.product_id, orderId: r.order_id, customerEmail: r.customer_email, enrolledAt: r.enrolled_at, checkoutSnapshot: r.checkout_snapshot || {} }); }
      }
    }, `dashboard:enrollments:${memberId}`);

    console.log(`📦 [MEMBERS-DASHBOARD] ${enrollments.length} enrollments existentes`);

    // 1c. SINCRONIZAR: Criar enrollments para compras pagas sem enrollment
    const paidStatusList = ['paid', 'approved', 'completed', 'active'];
    const processedProducts = new Set<string>(enrollments.map((e: any) => e.productId).filter(Boolean));

    if (memberEmail) {
      let ordersForSync: any[] = [];
      await neonQ6(async (sql: any) => {
        ordersForSync = await sql`SELECT id, product_id, status, paid_at, created_at FROM orders WHERE (customer_email = ${memberEmail} OR customer_id = ${memberId}) AND status = ANY(${paidStatusList}::text[])`;
      }, `dashboard:ordersSync:${memberId}`);

      const processedOrderIds = new Set<string>();
      for (const order of ordersForSync) {
        if (processedOrderIds.has(order.id)) continue;
        processedOrderIds.add(order.id);
        const productId = order.product_id;
        if (!productId || processedProducts.has(productId)) continue;
        processedProducts.add(productId);
        const enrollmentId = `enr_${nanoid(12)}`;
        await neonQ6(async (sql: any) => {
          await sql`INSERT INTO enrollments (id, member_id, customer_email, product_id, order_id, status, enrolled_at, created_at, updated_at) VALUES (${enrollmentId}, ${memberId}, ${memberEmail}, ${productId}, ${order.id}, 'active', ${order.paid_at || order.created_at || new Date()}, NOW(), NOW()) ON CONFLICT DO NOTHING`;
        }, `dashboard:createEnrollment:${enrollmentId}`);
        enrollments.push({ id: enrollmentId, productId, orderId: order.id, customerEmail: memberEmail, enrolledAt: order.paid_at || order.created_at });
      }
    }

    console.log(`📦 [MEMBERS-DASHBOARD] Total ${enrollments.length} enrollments após sync`);

    // 2. Obter productIds com compra paga
    const paidProductIds = new Set<string>();
    await neonQ6(async (sql: any) => {
      const rows = await sql`SELECT DISTINCT product_id FROM orders WHERE (customer_email = ${memberEmail || ''} OR customer_id = ${memberId}) AND status = ANY(${paidStatusList}::text[]) AND product_id IS NOT NULL`;
      for (const r of rows) if (r.product_id) paidProductIds.add(r.product_id);
    }, `dashboard:paidProducts:${memberId}`);

    const paidEnrollments = enrollments.filter((e: any) => paidProductIds.has(e.productId));
    console.log(`✅ [MEMBERS-DASHBOARD] ${paidEnrollments.length} enrollments com compra PAGA`);

    const productIds = paidEnrollments.map((e: any) => e.productId).filter(Boolean);

    // 3. Buscar produtos com progresso via Neon
    const products = await Promise.all(
      productIds.map(async (productId: string) => {
        const enrollment = enrollments.find((e: any) => e.productId === productId);
        let productData: any = null;
        let completedLessons = 0;
        let totalLessons = 0;
        await neonQ6(async (sql: any) => {
          const [prodRows, progressRows, lessonCountRows] = await Promise.all([
            sql`SELECT * FROM products WHERE id = ${productId} LIMIT 1`,
            sql`SELECT completed FROM lesson_progress WHERE member_id = ${memberId} AND product_id = ${productId}`,
            sql`SELECT COUNT(*) as cnt FROM lessons WHERE product_id = ${productId}`
          ]);
          if (prodRows[0]) productData = prodRows[0];
          completedLessons = progressRows.filter((r: any) => r.completed).length;
          totalLessons = parseInt(lessonCountRows[0]?.cnt || '0', 10);
        }, `dashboard:product:${productId}`);

        if (!productData) {
          // Fallback: buscar de checkouts
          await neonQ6(async (sql: any) => {
            const rows = await sql`SELECT title, logo_url, banner_url FROM checkouts WHERE id = ${productId} LIMIT 1`;
            if (rows[0]) productData = { title: rows[0].title, image_url: rows[0].logo_url || rows[0].banner_url, type: 'digital' };
          }, `dashboard:checkout:${productId}`);
          if (!productData) return null;
        }

        const engagementPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
        return {
          id: productId,
          title: productData.title,
          subtitle: productData.subtitle,
          imageUrl: productData.image_url || productData.imageUrl,
          type: productData.type || productData.product_type || 'digital',
          engagementPercent,
          completedLessons,
          totalLessons,
          enrolledAt: enrollment?.enrolledAt
        };
      })
    );
    
    // Filtrar nulls (produtos que não existem)
    const validProducts = products.filter(p => p !== null);
    console.log(`📦 [MEMBERS-DASHBOARD] ${validProducts.length} produtos válidos encontrados`);
    
    // 3. Buscar histórico de compras (sem orderBy para evitar índice composto)
    // Buscar por múltiplos campos
    const ordersSnapshot1 = memberEmail ? await db.collection('orders')
      .where('customer.email', '==', memberEmail)
      .limit(100)
      .get() : { docs: [] };
    
    const ordersSnapshot2 = memberEmail ? await db.collection('orders')
      .where('customerEmail', '==', memberEmail)
      .limit(100)
      .get() : { docs: [] };
    
    const ordersSnapshot3 = await db.collection('orders')
      .where('customerId', '==', memberId)
      .limit(100)
      .get();
    
    // Combinar e deduplicar orders
    const orderIds = new Set<string>();
    const allOrders: any[] = [];
    
    [...ordersSnapshot1.docs, ...ordersSnapshot2.docs, ...ordersSnapshot3.docs].forEach((doc: any) => {
      if (!orderIds.has(doc.id)) {
        orderIds.add(doc.id);
        allOrders.push({ id: doc.id, ...doc.data() });
      }
    });
    
    // Filtrar apenas pagos
    const paidOrders = allOrders.filter(order => 
      paidStatusList.includes(order.status)
    );
    
    const nowMs = Date.now();
    const purchaseHistory = paidOrders.map(order => {
      const paidAt = order.paidAt?.toDate?.() || order.createdAt?.toDate?.() || new Date(order.paidAt || order.createdAt || 0);
      const daysSincePurchase = Math.floor((nowMs - paidAt.getTime()) / (1000 * 3600 * 24));
      return {
        id: order.id,
        productId: order.productId || order.checkoutId,
        productName: order.checkoutSnapshot?.title || order.productSnapshot?.title || 'Produto',
        amount: order.amount,
        currency: order.currency || 'BRL',
        purchaseDate: order.createdAt || order.paidAt,
        paymentMethod: order.paymentMethod || order.method,
        status: order.status || 'paid',
        canRefund: order.refundable !== false && !order.refundId && daysSincePurchase <= 7
      };
    })
    // Ordenar por data mais recente
    .sort((a: any, b: any) => {
      const dateA = a.purchaseDate?.toDate?.() || new Date(a.purchaseDate || 0);
      const dateB = b.purchaseDate?.toDate?.() || new Date(b.purchaseDate || 0);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(0, 50); // Limitar a 50 após ordenação
    
    console.log(`📋 [MEMBERS-DASHBOARD] ${purchaseHistory.length} compras no histórico`);
    
    res.json({
      products: validProducts,
      purchaseHistory,
      totalProducts: validProducts.length
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar dashboard:', error);
    res.status(500).json({ 
      error: 'Erro ao carregar dashboard',
      message: error.message 
    });
  }
});

// 🎯 ATUALIZAR PROGRESSO DE VÍDEO
membersCoproductionRouter.patch('/api/members/progress/:lessonId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const memberId = req.user?.uid;
    const { lessonId } = req.params;
    const { watchedSeconds, totalSeconds, currentTimestamp, completed } = req.body;
    
    if (!memberId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const { neonQuery: neonQ7 } = await import('../lib/neon-db.js');

    // Buscar lesson para pegar productId e moduleId
    let lesson: any = null;
    await neonQ7(async (sql: any) => {
      const rows = await sql`SELECT * FROM lessons WHERE id = ${lessonId} LIMIT 1`;
      if (rows[0]) lesson = rows[0];
    }, `progress:getLesson:${lessonId}`);

    if (!lesson) {
      return res.status(404).json({ error: 'Aula não encontrada' });
    }

    // Upsert progresso via Neon
    await neonQ7(async (sql: any) => {
      const existing = await sql`SELECT id, watched_seconds, total_seconds, current_timestamp, completed, completed_at FROM lesson_progress WHERE member_id = ${memberId} AND lesson_id = ${lessonId} LIMIT 1`;
      if (existing[0]) {
        const cur = existing[0];
        await sql`UPDATE lesson_progress SET
          watched_seconds = ${watchedSeconds !== undefined ? watchedSeconds : cur.watched_seconds},
          total_seconds = ${totalSeconds !== undefined ? totalSeconds : cur.total_seconds},
          current_timestamp = ${currentTimestamp !== undefined ? currentTimestamp : cur.current_timestamp},
          completed = ${completed !== undefined ? completed : cur.completed},
          completed_at = ${completed && !cur.completed ? new Date() : cur.completed_at},
          last_watched_at = NOW(),
          updated_at = NOW()
          WHERE member_id = ${memberId} AND lesson_id = ${lessonId}`;
      } else {
        const progressId = `prg_${nanoid(12)}`;
        await sql`INSERT INTO lesson_progress (id, member_id, lesson_id, module_id, product_id, watched_seconds, total_seconds, current_timestamp, completed, completed_at, last_watched_at, created_at, updated_at) VALUES (${progressId}, ${memberId}, ${lessonId}, ${lesson.module_id}, ${lesson.product_id}, ${watchedSeconds || 0}, ${totalSeconds || 0}, ${currentTimestamp || 0}, ${completed || false}, ${completed ? new Date() : null}, NOW(), NOW(), NOW())`;
      }
    }, `progress:upsert:${memberId}:${lessonId}`);
    
    res.json({ 
      success: true,
      message: 'Progresso atualizado' 
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar progresso:', error);
    res.status(500).json({ 
      error: 'Erro ao salvar progresso',
      message: error.message 
    });
  }
});

// 🔄 SOLICITAR REEMBOLSO (vai direto para admin)
membersCoproductionRouter.post('/api/members/refunds/request', verifyFirebaseToken, userRateLimit('refund'), replayProtectionMiddleware, idempotencyMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const memberId = req.user?.uid;
    const { orderId, reason, pixKey } = req.body;
    
    if (!memberId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    if (!orderId || !reason) {
      return res.status(400).json({ error: 'ID do pedido e motivo são obrigatórios' });
    }
    
    const { neonQuery: neonQ8 } = await import('../lib/neon-db.js');

    // Verificar se o pedido pertence ao membro via Neon
    let order: any = null;
    await neonQ8(async (sql: any) => {
      const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) order = rows[0];
    }, `refund:getOrder:${orderId}`);

    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    if (order.customer_id !== memberId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (order.refund_id) {
      return res.status(400).json({ error: 'Já existe uma solicitação de reembolso para este pedido' });
    }

    // Validação CDC 7 dias
    const paidAt = order.paid_at ? new Date(order.paid_at) : new Date(order.created_at);
    const daysSincePurchase = Math.floor((Date.now() - paidAt.getTime()) / (1000 * 3600 * 24));
    if (daysSincePurchase > 7) {
      return res.status(400).json({ error: 'Prazo para solicitar reembolso expirado. O prazo é de 7 dias após a compra (CDC Art. 49).' });
    }

    const refundId = `ref_${nanoid(12)}`;
    const customerData = typeof order.customer === 'string' ? JSON.parse(order.customer || '{}') : (order.customer || {});
    const checkoutSnapshot = typeof order.checkout_snapshot === 'string' ? JSON.parse(order.checkout_snapshot || '{}') : (order.checkout_snapshot || {});

    await neonQ8(async (sql: any) => {
      await sql`INSERT INTO refunds (id, order_id, customer_id, seller_id, tenant_id, product_id, amount, refund_amount, currency, reason, pix_key, status, customer_email, customer_name, product_title, payment_method, requested_at, created_at, updated_at) VALUES (${refundId}, ${orderId}, ${memberId}, ${order.tenant_id}, ${order.tenant_id}, ${order.product_id}, ${order.amount}, ${order.amount}, ${order.currency || 'BRL'}, ${reason}, ${pixKey || null}, 'pending', ${customerData.email || order.customer_email || ''}, ${customerData.name || order.customer_name || ''}, ${checkoutSnapshot.title || order.product_name || 'Produto'}, ${order.payment_method || order.method || 'pix'}, NOW(), NOW(), NOW())`;
      await sql`UPDATE orders SET refund_id = ${refundId}, updated_at = NOW() WHERE id = ${orderId}`;
    }, `refund:create:${refundId}`);

    console.log(`📩 Reembolso solicitado: ${refundId} por membro ${memberId} para pedido ${orderId}`);
    
    res.json({
      success: true,
      refundId: refundId,
      message: 'Solicitação de reembolso enviada para análise do administrador'
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao solicitar reembolso:', error);
    res.status(500).json({ 
      error: 'Erro ao solicitar reembolso',
      message: error.message 
    });
  }
});



// 👥 ADICIONAR MEMBRO MANUALMENTE (Premium)
membersCoproductionRouter.post('/api/premium/add-student', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.user;
    if (!authUser) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { email, name, phone, productId } = req.body;

    // Validações básicas
    if (!email || !name || !productId) {
      return res.status(400).json({ error: 'Email, nome e productId são obrigatórios' });
    }

    // Normalizar email
    const normalizedEmail = email.toLowerCase().trim();

    await ensureFirebaseReady();
    const adminInst4 = getAdmin();
    const auth = getAuth();
    const { neonQuery: neonQ9 } = await import('../lib/neon-db.js');

    // Buscar tenantId do seller via Neon
    let seller: any = null;
    await neonQ9(async (sql: any) => {
      const rows = await sql`SELECT id, tenant_id FROM sellers WHERE id = ${authUser.uid} LIMIT 1`;
      if (rows[0]) seller = rows[0];
    }, `addStudent:getSeller:${authUser.uid}`);

    if (!seller) {
      return res.status(403).json({ error: 'Usuário não é um seller válido' });
    }
    const tenantId = seller.tenant_id || authUser.uid;

    // Validar que email existe no Firebase Auth
    try {
      await auth.getUserByEmail(normalizedEmail);
    } catch (authError: any) {
      if (authError.code === 'auth/user-not-found') {
        return res.status(400).json({ error: 'Email não encontrado no sistema. O usuário precisa ter uma conta registrada.' });
      }
      throw authError;
    }

    // Verificar se já existe membro com esse email e productId via Neon
    let existingMember: any = null;
    await neonQ9(async (sql: any) => {
      const rows = await sql`SELECT id FROM members WHERE email = ${normalizedEmail} AND product_id = ${productId} AND tenant_id = ${tenantId} LIMIT 1`;
      if (rows[0]) existingMember = rows[0];
    }, `addStudent:checkExisting:${normalizedEmail}`);

    if (existingMember) {
      return res.status(400).json({ error: 'Este email já está cadastrado como membro deste produto' });
    }

    const memberId2 = `mbr_${nanoid(12)}`;
    await neonQ9(async (sql: any) => {
      await sql`INSERT INTO members (id, email, name, phone, product_id, tenant_id, added_by, added_manually, created_at, updated_at) VALUES (${memberId2}, ${normalizedEmail}, ${name.trim()}, ${phone ? phone.trim() : ''}, ${productId}, ${tenantId}, ${authUser.email || authUser.uid}, true, NOW(), NOW())`;
    }, `addStudent:insert:${memberId2}`);

    console.log(`✅ Membro adicionado manualmente: ${normalizedEmail} para produto ${productId} por ${authUser.email}`);

    res.json({
      success: true,
      message: 'Membro adicionado com sucesso',
      memberId: memberId2,
      member: { id: memberId2, email: normalizedEmail, name: name.trim(), phone: phone || '', productId, tenantId, addedManually: true }
    });

  } catch (error: any) {
    console.error('❌ Erro ao adicionar membro:', error);
    res.status(500).json({ 
      error: 'Erro ao adicionar membro',
      message: error.message 
    });
  }
});

// 📋 LISTAR MEMBERS DE UM PRODUTO (com auto-vinculação de compras)
membersCoproductionRouter.get('/api/members', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.user;
    if (!authUser) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { productId } = req.query;

    if (!productId || typeof productId !== 'string') {
      return res.status(400).json({ error: 'productId é obrigatório' });
    }

    const { neonQuery: neonQ10 } = await import('../lib/neon-db.js');

    // Buscar tenantId do seller via Neon
    let sellerForList: any = null;
    await neonQ10(async (sql: any) => {
      const rows = await sql`SELECT id, tenant_id FROM sellers WHERE id = ${authUser.uid} LIMIT 1`;
      if (rows[0]) sellerForList = rows[0];
    }, `listMembers:getSeller:${authUser.uid}`);

    if (!sellerForList) {
      return res.status(403).json({ error: 'Usuário não é um seller válido' });
    }
    const tenantId = sellerForList.tenant_id || authUser.uid;

    // a) Buscar members manuais via Neon
    let manualMembers: any[] = [];
    await neonQ10(async (sql: any) => {
      const rows = await sql`SELECT id, email, name, phone, added_by, created_at FROM members WHERE product_id = ${productId} AND tenant_id = ${tenantId} AND added_manually = true`;
      manualMembers = rows.map((r: any) => ({ id: r.id, email: r.email, name: r.name || '', phone: r.phone || '', addedManually: true, addedAt: r.created_at, addedBy: r.added_by }));
    }, `listMembers:manual:${productId}`);

    // b) Buscar customers que compraram via Neon
    let purchaseMembers: any[] = [];
    await neonQ10(async (sql: any) => {
      const rows = await sql`SELECT id, customer_email, customer_name, amount, currency, paid_at, created_at FROM orders WHERE (checkout_id = ${productId} OR product_id = ${productId}) AND status IN ('paid','completed','approved','active') AND tenant_id = ${tenantId}`;
      purchaseMembers = rows.map((r: any) => ({ id: r.id, email: r.customer_email ? r.customer_email.toLowerCase().trim() : '', name: r.customer_name || '', phone: '', addedManually: false, purchaseDate: r.paid_at || r.created_at, orderId: r.id, amount: r.amount, currency: r.currency || 'BRL' }));
    }, `listMembers:purchases:${productId}`);

    // c) Combinar e dedupe por email
    const emailMap = new Map();

    // Adicionar members manuais primeiro (prioridade)
    for (const member of manualMembers) {
      if (member.email) {
        emailMap.set(member.email, member);
      }
    }

    // Adicionar customers de compras (só se não existir)
    for (const member of purchaseMembers) {
      if (member.email && !emailMap.has(member.email)) {
        emailMap.set(member.email, member);
      }
    }

    // Converter para array e ordenar
    let allMembers = Array.from(emailMap.values());

    // Ordenar: members manuais primeiro, depois por data desc
    allMembers.sort((a, b) => {
      // Prioridade: manuais primeiro
      if (a.addedManually && !b.addedManually) return -1;
      if (!a.addedManually && b.addedManually) return 1;

      // Dentro da mesma categoria, ordenar por data (mais recente primeiro)
      const dateA = a.addedAt || a.purchaseDate;
      const dateB = b.addedAt || b.purchaseDate;

      if (dateA && dateB) {
        const timeA = dateA.toMillis ? dateA.toMillis() : dateA;
        const timeB = dateB.toMillis ? dateB.toMillis() : dateB;
        return timeB - timeA;
      }

      return 0;
    });

    console.log(`📋 Listando ${allMembers.length} members do produto ${productId} (${manualMembers.length} manuais, ${purchaseMembers.length} compras)`);

    res.json({
      success: true,
      members: allMembers,
      stats: {
        total: allMembers.length,
        manual: manualMembers.length,
        purchases: purchaseMembers.length,
        unique: allMembers.length
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao listar members:', error);
    res.status(500).json({ 
      error: 'Erro ao listar members',
      message: error.message 
    });
  }
});

// ========================================
// 🤝 COPRODUÇÃO - SISTEMA COMPLETO
// ========================================

// 💰 HELPER: Processar comissões de coprodução automaticamente
export async function processCoproductionCommissions(
  orderId: string,
  checkoutId: string,
  sellerId: string,
  grossAmount: number,
  netAmount: number,
  source: 'own_sale' | 'affiliate_sale',
  affiliateId?: string
): Promise<void> {
  try {
    const { neonQuery: neonQC } = await import('../lib/neon-db.js');
    console.log(`💼 Processando comissões de coprodução para ordem ${orderId} (${source})`);

    // 1. Buscar contratos aceitos para este checkout via Neon
    let acceptedContracts: any[] = [];
    await neonQC(async (sql: any) => {
      acceptedContracts = await sql`SELECT * FROM coproduction_contracts WHERE checkout_id = ${checkoutId} AND status = 'accepted'`;
    }, `coprod:contracts:${checkoutId}`);

    if (acceptedContracts.length === 0) {
      console.log(`   Nenhum contrato de coprodução ativo para checkout ${checkoutId}`);
      return;
    }

    console.log(`   ${acceptedContracts.length} contrato(s) de coprodução encontrado(s)`);

    let totalCoproducerPercent = 0;

    // PRÉ-PROCESSAMENTO: Calcular totalCoproducerPercent
    for (const contract of acceptedContracts) {
      const isExpired = contract.duration === 'period' && contract.period_end_date && new Date() > new Date(contract.period_end_date);
      if (isExpired) continue;
      const shouldApply = contract.commission_source === 'both' ||
        (contract.commission_source === 'own_sales' && source === 'own_sale') ||
        (contract.commission_source === 'affiliate_sales' && source === 'affiliate_sale');
      if (!shouldApply) continue;
      totalCoproducerPercent += contract.commission_percent || 0;
    }

    console.log(`   📊 Total de comissões de coprodução: ${totalCoproducerPercent}%`);

    for (const contract of acceptedContracts) {
      const coproducerPercent = contract.commission_percent || 0;
      const isExpired = contract.duration === 'period' && contract.period_end_date && new Date() > new Date(contract.period_end_date);
      const shouldApply = contract.commission_source === 'both' ||
        (contract.commission_source === 'own_sales' && source === 'own_sale') ||
        (contract.commission_source === 'affiliate_sales' && source === 'affiliate_sale');

      // Idempotência: verificar se já existe comissão
      let existingCommission: any = null;
      await neonQC(async (sql: any) => {
        const rows = await sql`SELECT id FROM coproduction_commissions WHERE order_id = ${orderId} AND contract_id = ${contract.id} LIMIT 1`;
        if (rows[0]) existingCommission = rows[0];
      }, `coprod:checkExisting:${orderId}:${contract.id}`);

      if (existingCommission) {
        console.log(`   ⏭️  Comissão já existe para contrato ${contract.id} - pulando (idempotência)`);
        continue;
      }
      if (isExpired) { console.log(`   ⏰ Contrato ${contract.id} expirado - pulando`); continue; }
      if (!shouldApply) { console.log(`   ⏭️  Contrato ${contract.id} não se aplica a ${source} - pulando`); continue; }

      const commissionAmount = Math.round(netAmount * (coproducerPercent / 100));
      console.log(`   💰 Coprodutor ${contract.coproducer_name}: ${coproducerPercent}% = R$ ${(commissionAmount / 100).toFixed(2)}`);

      const commissionId = `coprod_${orderId}_${contract.id}`;
      const releaseDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await neonQC(async (sql: any) => {
        await sql`INSERT INTO coproduction_commissions (id, contract_id, order_id, checkout_id, seller_id, coproducer_id, coproducer_email, coproducer_name, order_amount, net_amount, commission_percent, commission_amount, source, affiliate_id, status, release_date, created_at, updated_at) VALUES (${commissionId}, ${contract.id}, ${orderId}, ${checkoutId}, ${sellerId}, ${contract.coproducer_id}, ${contract.coproducer_email}, ${contract.coproducer_name}, ${grossAmount}, ${netAmount}, ${coproducerPercent}, ${commissionAmount}, ${source}, ${affiliateId || null}, 'pending', ${releaseDate}, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`;
      }, `coprod:insertCommission:${commissionId}`);
      console.log(`   ✅ Comissão criada: ${commissionId}`);

      // Creditar saldo pendente do coprodutor via Neon
      if (contract.coproducer_id) {
        await neonQC(async (sql: any) => {
          await sql`INSERT INTO seller_balances (id, seller_id, available_balance, pending_balance, total_earnings, currency, created_at, updated_at) VALUES (${contract.coproducer_id}, ${contract.coproducer_id}, 0, ${commissionAmount}, 0, 'BRL', NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET pending_balance = seller_balances.pending_balance + ${commissionAmount}, updated_at = NOW()`;
        }, `coprod:creditCoproducer:${contract.coproducer_id}`);
        console.log(`   💵 R$ ${(commissionAmount / 100).toFixed(2)} creditado no saldo pendente de ${contract.coproducer_name}`);
      }
    }

    // 7. Debitar comissão total do saldo do seller principal + marcar ordem como settled
    if (totalCoproducerPercent > 0) {
      // Idempotência: verificar se já processou
      let alreadySettled = false;
      await neonQC(async (sql: any) => {
        const rows = await sql`SELECT coproduction_settled_at FROM orders WHERE id = ${orderId} LIMIT 1`;
        if (rows[0]?.coproduction_settled_at) alreadySettled = true;
      }, `coprod:checkSettled:${orderId}`);

      if (alreadySettled) {
        console.log(`   ⏭️  Ordem ${orderId} já completamente processada - pulando (idempotência)`);
        return;
      }

      const totalCoproducerAmount = Math.round(netAmount * (totalCoproducerPercent / 100));
      console.log(`   📊 Total: ${totalCoproducerPercent}% = R$ ${(totalCoproducerAmount / 100).toFixed(2)}`);
      console.log(`   💸 Seller recebe: R$ ${((netAmount - totalCoproducerAmount) / 100).toFixed(2)}`);

      await neonQC(async (sql: any) => {
        // Atualizar ordem com settled flag
        await sql`UPDATE orders SET coproduction_fees = ${totalCoproducerAmount}, net_amount_after_coproduction = ${netAmount - totalCoproducerAmount}, coproduction_settled_at = NOW(), updated_at = NOW() WHERE id = ${orderId}`;
        // Débitar seller (upsert)
        await sql`INSERT INTO seller_balances (id, seller_id, available_balance, pending_balance, total_earnings, total_coproduction_commissions, currency, created_at, updated_at) VALUES (${sellerId}, ${sellerId}, 0, ${-totalCoproducerAmount}, 0, ${totalCoproducerAmount}, 'BRL', NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET pending_balance = seller_balances.pending_balance - ${totalCoproducerAmount}, total_coproduction_commissions = COALESCE(seller_balances.total_coproduction_commissions, 0) + ${totalCoproducerAmount}, updated_at = NOW()`;
      }, `coprod:settle:${orderId}`);

      console.log(`   ✅ Ordem e saldo do seller atualizados atomicamente`);
      console.log(`   💸 R$ ${(totalCoproducerAmount / 100).toFixed(2)} debitado do saldo pendente do seller principal`);
    }
  } catch (error: any) {
    console.error(`❌ Erro ao processar comissões de coprodução:`, error);
  }
}

// 📧 ENVIAR CONVITE DE COPRODUÇÃO
membersCoproductionRouter.post('/api/coproduction/invite', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user.uid;
    const {
      checkoutId,
      coproducerName,
      coproducerEmail,
      commissionPercent,
      duration,
      periodMonths,
      commissionSource,
      shareCustomerData,
      extendCommission,
    } = req.body;

    // Validações
    if (!checkoutId || !coproducerEmail || commissionPercent === undefined) {
      return res.status(400).json({ error: 'Campos obrigatórios: checkoutId, coproducerEmail, commissionPercent' });
    }

    if (commissionPercent < 0 || commissionPercent > 70) {
      return res.status(400).json({ error: 'Comissão deve estar entre 0% e 70%' });
    }

    const { neonQuery: neonQInv } = await import('../lib/neon-db.js');

    // Buscar checkout via Neon
    let checkoutData: any = null;
    await neonQInv(async (sql: any) => {
      const rows = await sql`SELECT id, title, seller_id, tenant_id, seller_name FROM checkouts WHERE id = ${checkoutId} LIMIT 1`;
      if (rows[0]) checkoutData = rows[0];
    }, `invite:getCheckout:${checkoutId}`);

    if (!checkoutData) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }
    if (checkoutData.seller_id !== userId && checkoutData.tenant_id !== userId) {
      return res.status(403).json({ error: 'Sem permissão para este produto' });
    }

    // Verificar % total de coprodutores via Neon
    let totalPercent = 0;
    await neonQInv(async (sql: any) => {
      const rows = await sql`SELECT commission_percent FROM coproduction_contracts WHERE checkout_id = ${checkoutId} AND seller_id = ${userId} AND status IN ('pending','accepted')`;
      totalPercent = rows.reduce((sum: number, r: any) => sum + (r.commission_percent || 0), 0);
    }, `invite:checkPercent:${checkoutId}`);

    if (totalPercent + commissionPercent > 70) {
      return res.status(400).json({ error: 'Limite de 70% excedido', current: totalPercent, requested: commissionPercent, available: 70 - totalPercent });
    }

    // Buscar dados do seller via Neon
    let sellerData: any = null;
    await neonQInv(async (sql: any) => {
      const rows = await sql`SELECT name, full_name, email FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (rows[0]) sellerData = rows[0];
    }, `invite:getSeller:${userId}`);

    const effectiveSellerName = sellerData?.name || sellerData?.full_name || checkoutData?.seller_name || req.user.email?.split('@')[0] || 'Vendedor';
    const effectiveSellerEmail = sellerData?.email || req.user.email || '';

    const contractId2 = `ctr_${nanoid(12)}`;
    const periodEndDate = duration === 'period' && periodMonths ? new Date(Date.now() + periodMonths * 30 * 24 * 60 * 60 * 1000) : null;

    await neonQInv(async (sql: any) => {
      await sql`INSERT INTO coproduction_contracts (id, checkout_id, product_name, seller_id, tenant_id, seller_email, seller_name, coproducer_email, coproducer_name, coproducer_id, commission_percent, duration, period_end_date, commission_source, share_customer_data, extend_commission, status, invited_at, created_at, updated_at) VALUES (${contractId2}, ${checkoutId}, ${checkoutData.title || 'Produto'}, ${userId}, ${userId}, ${effectiveSellerEmail}, ${effectiveSellerName}, ${coproducerEmail.toLowerCase().trim()}, ${coproducerName || coproducerEmail}, null, ${commissionPercent}, ${duration || 'lifetime'}, ${periodEndDate}, ${commissionSource || 'own_sales'}, ${shareCustomerData || false}, ${extendCommission || false}, 'pending', NOW(), NOW(), NOW())`;
    }, `invite:insert:${contractId2}`);

    console.log(`✅ CONVITE DE COPRODUÇÃO ENVIADO: ${contractId2} → ${coproducerEmail}`);

    res.json({
      success: true,
      contractId: contractId2,
      message: `Convite enviado para ${coproducerEmail}`
    });

  } catch (error: any) {
    console.error('❌ Erro ao enviar convite de coprodução:', error);
    res.status(500).json({ error: 'Erro ao enviar convite', message: error.message });
  }
});

// 📋 LISTAR CONTRATOS DO SELLER
membersCoproductionRouter.get('/api/coproduction/my-contracts/:checkoutId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user.uid;
    const { checkoutId } = req.params;

    const { neonQuery: neonQMC } = await import('../lib/neon-db.js');
    let contracts: any[] = [];
    await neonQMC(async (sql: any) => {
      contracts = await sql`SELECT * FROM coproduction_contracts WHERE checkout_id = ${checkoutId} AND seller_id = ${userId}`;
    }, `myContracts:${checkoutId}:${userId}`);
    res.json(contracts.map(r => ({ id: r.id, checkoutId: r.checkout_id, sellerId: r.seller_id, coproducerId: r.coproducer_id, coproducerEmail: r.coproducer_email, coproducerName: r.coproducer_name, commissionPercent: r.commission_percent, status: r.status, duration: r.duration, periodEndDate: r.period_end_date, commissionSource: r.commission_source, createdAt: r.created_at })));

  } catch (error: any) {
    console.error('❌ Erro ao listar contratos:', error);
    res.json([]);
  }
});

// 📬 LISTAR CONVITES RECEBIDOS
membersCoproductionRouter.get('/api/coproduction/my-invites', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userEmail = req.user.email?.toLowerCase().trim();

    if (!userEmail) {
      return res.status(400).json({ error: 'Email não encontrado' });
    }

    const { neonQuery: neonQMI } = await import('../lib/neon-db.js');
    let invites: any[] = [];
    await neonQMI(async (sql: any) => {
      invites = await sql`SELECT * FROM coproduction_contracts WHERE coproducer_email = ${userEmail} AND status = 'pending'`;
    }, `myInvites:${userEmail}`);
    res.json(invites.map(r => ({ id: r.id, checkoutId: r.checkout_id, productName: r.product_name, sellerId: r.seller_id, sellerName: r.seller_name, sellerEmail: r.seller_email, coproducerEmail: r.coproducer_email, coproducerName: r.coproducer_name, commissionPercent: r.commission_percent, status: r.status, duration: r.duration, commissionSource: r.commission_source, createdAt: r.created_at })));

  } catch (error: any) {
    console.error('❌ Erro ao listar convites:', error);
    res.json([]);
  }
});

// ✅ ACEITAR CONVITE
membersCoproductionRouter.post('/api/coproduction/accept/:contractId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email?.toLowerCase().trim();
    const { contractId } = req.params;

    const { neonQuery: neonQAcc } = await import('../lib/neon-db.js');
    let contractAcc: any = null;
    await neonQAcc(async (sql: any) => {
      const rows = await sql`SELECT * FROM coproduction_contracts WHERE id = ${contractId} LIMIT 1`;
      if (rows[0]) contractAcc = rows[0];
    }, `accept:getContract:${contractId}`);

    if (!contractAcc) return res.status(404).json({ error: 'Contrato não encontrado' });
    if (contractAcc.coproducer_email !== userEmail) return res.status(403).json({ error: 'Este convite não é para você' });
    if (contractAcc.status !== 'pending') return res.status(400).json({ error: 'Convite já foi respondido' });

    await neonQAcc(async (sql: any) => {
      await sql`UPDATE coproduction_contracts SET status = 'accepted', coproducer_id = ${userId}, accepted_at = NOW(), updated_at = NOW() WHERE id = ${contractId}`;
    }, `accept:update:${contractId}`);

    console.log(`✅ CONVITE ACEITO: ${contractId} por ${userEmail}`);

    res.json({
      success: true,
      message: 'Convite aceito com sucesso!',
      contractId
    });

  } catch (error: any) {
    console.error('❌ Erro ao aceitar convite:', error);
    res.status(500).json({ error: 'Erro ao aceitar convite', message: error.message });
  }
});

// ❌ REJEITAR CONVITE
membersCoproductionRouter.post('/api/coproduction/reject/:contractId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userEmail = req.user.email?.toLowerCase().trim();
    const { contractId } = req.params;

    const { neonQuery: neonQRej } = await import('../lib/neon-db.js');
    let contractRej: any = null;
    await neonQRej(async (sql: any) => {
      const rows = await sql`SELECT * FROM coproduction_contracts WHERE id = ${contractId} LIMIT 1`;
      if (rows[0]) contractRej = rows[0];
    }, `reject:getContract:${contractId}`);

    if (!contractRej) return res.status(404).json({ error: 'Contrato não encontrado' });
    if (contractRej.coproducer_email !== userEmail) return res.status(403).json({ error: 'Este convite não é para você' });
    if (contractRej.status !== 'pending') return res.status(400).json({ error: 'Convite já foi respondido' });

    await neonQRej(async (sql: any) => {
      await sql`UPDATE coproduction_contracts SET status = 'rejected', rejected_at = NOW(), updated_at = NOW() WHERE id = ${contractId}`;
    }, `reject:update:${contractId}`);

    console.log(`❌ CONVITE REJEITADO: ${contractId} por ${userEmail}`);

    res.json({
      success: true,
      message: 'Convite rejeitado',
      contractId
    });

  } catch (error: any) {
    console.error('❌ Erro ao rejeitar convite:', error);
    res.status(500).json({ error: 'Erro ao rejeitar convite', message: error.message });
  }
});

// 🗑️ CANCELAR CONTRATO (Seller pode cancelar)
membersCoproductionRouter.delete('/api/coproduction/cancel/:contractId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user.uid;
    const { contractId } = req.params;

    const { neonQuery: neonQCan } = await import('../lib/neon-db.js');
    let contractCan: any = null;
    await neonQCan(async (sql: any) => {
      const rows = await sql`SELECT id, seller_id FROM coproduction_contracts WHERE id = ${contractId} LIMIT 1`;
      if (rows[0]) contractCan = rows[0];
    }, `cancel:getContract:${contractId}`);

    if (!contractCan) return res.status(404).json({ error: 'Contrato não encontrado' });
    if (contractCan.seller_id !== userId) return res.status(403).json({ error: 'Sem permissão para cancelar este contrato' });

    await neonQCan(async (sql: any) => {
      await sql`UPDATE coproduction_contracts SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = ${contractId}`;
    }, `cancel:update:${contractId}`);

    console.log(`🗑️ CONTRATO CANCELADO: ${contractId}`);

    res.json({
      success: true,
      message: 'Contrato cancelado com sucesso'
    });

  } catch (error: any) {
    console.error('❌ Erro ao cancelar contrato:', error);
    res.status(500).json({ error: 'Erro ao cancelar contrato', message: error.message });
  }
});

// 📊 RESUMO DE COPRODUTORES DO PRODUTO
membersCoproductionRouter.get('/api/coproduction/summary/:checkoutId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user.uid;
    const { checkoutId } = req.params;

    const { neonQuery: neonQSum } = await import('../lib/neon-db.js');
    let contracts: any[] = [];
    await neonQSum(async (sql: any) => {
      contracts = await sql`SELECT status, commission_percent FROM coproduction_contracts WHERE checkout_id = ${checkoutId} AND seller_id = ${userId}`;
    }, `summary:${checkoutId}:${userId}`);

    const totalContracts = contracts.length;
    const activeContracts = contracts.filter((c: any) => c.status === 'accepted').length;
    const pendingInvites = contracts.filter((c: any) => c.status === 'pending').length;
    const totalCommissionPercent = contracts.filter((c: any) => ['pending','accepted'].includes(c.status)).reduce((sum: number, c: any) => sum + (c.commission_percent || 0), 0);
    const availablePercent = 70 - totalCommissionPercent;

    res.json({
      totalContracts,
      activeContracts,
      pendingInvites,
      totalCommissionPercent,
      availablePercent: Math.max(0, availablePercent),
      maxPercent: 70
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar resumo:', error);
    res.json({
      totalContracts: 0,
      activeContracts: 0,
      pendingInvites: 0,
      totalCommissionPercent: 0,
      availablePercent: 70,
      maxPercent: 70
    });
  }
});

// 💰 LISTAR COMISSÕES RECEBIDAS (para coprodutores)
membersCoproductionRouter.get('/api/coproduction/my-commissions', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user.uid;

    const { neonQuery: neonQComm } = await import('../lib/neon-db.js');
    let commissions: any[] = [];
    await neonQComm(async (sql: any) => {
      commissions = await sql`SELECT * FROM coproduction_commissions WHERE coproducer_id = ${userId} ORDER BY created_at DESC LIMIT 100`;
    }, `myCommissions:${userId}`);
    res.json(commissions.map((r: any) => ({ id: r.id, contractId: r.contract_id, orderId: r.order_id, checkoutId: r.checkout_id, sellerId: r.seller_id, coproducerId: r.coproducer_id, coproducerEmail: r.coproducer_email, coproducerName: r.coproducer_name, commissionPercent: r.commission_percent, commissionAmount: r.commission_amount, status: r.status, source: r.source, releaseDate: r.release_date, createdAt: r.created_at })));

  } catch (error: any) {
    console.error('❌ Erro ao listar comissões:', error);
    res.json([]);
  }
});

export async function autoCreateMemberOnPurchase(orderData: {
  customerEmail: string;
  customerName?: string;
  productId?: string;
  productType?: string;
  orderId?: string;
  checkoutId?: string;
  forceCreate?: boolean;
}): Promise<void> {
  try {
    const { customerEmail, customerName, productType, forceCreate } = orderData;
    let productId = orderData.productId;
    
    if (!customerEmail) return;
    if (!forceCreate && productType && productType !== 'digital' && productType !== 'subscription') return;

    await ensureFirebaseReady();
    const adminAM = getAdmin();
    const { neonQuery: neonQAM } = await import('../lib/neon-db.js');

    // Se productId é null mas temos checkoutId, tentar resolver via checkout
    if (!productId && orderData.checkoutId) {
      try {
        await neonQAM(async (sql: any) => {
          const rows = await sql`SELECT product_id, synced_product_id FROM checkouts WHERE id = ${orderData.checkoutId} LIMIT 1`;
          if (rows[0]) { productId = rows[0].product_id || rows[0].synced_product_id || null; if (productId) console.log(`🔍 [AUTO-MEMBER] productId resolvido via checkout ${orderData.checkoutId}: ${productId}`); }
        }, `autoMember:resolveCheckout:${orderData.checkoutId}`);
      } catch (e) { /* silently continue */ }
    }

    if (productId) {
      let product: any = null;
      await neonQAM(async (sql: any) => {
        const rows = await sql`SELECT members_area_enabled FROM products WHERE id = ${productId} LIMIT 1`;
        if (rows[0]) product = rows[0];
      }, `autoMember:checkProduct:${productId}`);
      if (product && !forceCreate && !product.members_area_enabled) {
        console.log(`⏭️ [AUTO-MEMBER] Produto ${productId} nao tem area de membros ativada`);
        return;
      }
    }

    let existingMemberRow: any = null;
    await neonQAM(async (sql: any) => {
      const rows = await sql`SELECT id, user_id FROM members WHERE email = ${customerEmail} LIMIT 1`;
      if (rows[0]) existingMemberRow = rows[0];
    }, `autoMember:checkExisting:${customerEmail}`);

    if (existingMemberRow) {
      console.log(`⏭️ [AUTO-MEMBER] Conta ja existe para ${customerEmail}`);

      let productTitleForEmail = '';
      if (productId && orderData.orderId) {
        const existingMemberId = existingMemberRow.id || existingMemberRow.user_id;
        let hasEnrollment = false;
        await neonQAM(async (sql: any) => {
          const rows = await sql`SELECT id FROM enrollments WHERE member_id = ${existingMemberId} AND product_id = ${productId} LIMIT 1`;
          hasEnrollment = rows.length > 0;
        }, `autoMember:checkEnrollment:${existingMemberId}:${productId}`);

        if (!hasEnrollment) {
          let productData2: any = null;
          await neonQAM(async (sql: any) => {
            const rows = await sql`SELECT name, title, tenant_id FROM products WHERE id = ${productId} LIMIT 1`;
            if (rows[0]) productData2 = rows[0];
          }, `autoMember:getProduct2:${productId}`);
          productTitleForEmail = productData2?.name || productData2?.title || '';
          const enrollId = `enr_${nanoid(12)}`;
          await neonQAM(async (sql: any) => {
            await sql`INSERT INTO enrollments (id, member_id, product_id, order_id, tenant_id, product_title, enrollment_type, customer_email, customer_name, status, enrolled_at, created_at, updated_at) VALUES (${enrollId}, ${existingMemberId}, ${productId}, ${orderData.orderId || null}, ${productData2?.tenant_id || ''}, ${productTitleForEmail}, 'purchase', ${customerEmail}, ${customerName || ''}, 'active', NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`;
          }, `autoMember:createEnrollment:${enrollId}`);
          console.log(`✅ [AUTO-MEMBER] Enrollment criado para membro existente: ${productId}`);
        }
      }

      // 📧 ENVIAR EMAIL DE ACESSO PARA MEMBRO EXISTENTE
      try {
        const { sendEmail } = await import('../lib/email-service.js');
        const loginUrl = process.env.REPLIT_DEV_DOMAIN
          ? `https://${process.env.REPLIT_DEV_DOMAIN}/areademembros`
          : 'https://volatuspay.com/areademembros';
        const productLine = productTitleForEmail
          ? `<tr><td style="padding:8px 0;color:#999;font-size:14px;">Produto:</td><td style="padding:8px 0;color:#e5e5e5;font-size:14px;font-weight:bold;text-align:right;">${productTitleForEmail}</td></tr>`
          : '';
        await sendEmail({
          to: customerEmail,
          subject: productTitleForEmail
            ? `Acesso liberado: ${productTitleForEmail} - VolatusPay`
            : 'Seu acesso foi liberado - VolatusPay',
          html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>VolatusPay</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:30px;background:#111;border-radius:12px;padding:28px 20px;">
      <img src="${BASE_URL}/logos/volatus-pay-logo.png" alt="Logo" width="200" style="display:block;margin:0 auto;max-width:200px;height:auto;" />
    </div>
    <h1 style="color:#ffffff;font-size:26px;text-align:center;margin-bottom:12px;font-weight:700;">Acesso Liberado!</h1>
    <p style="color:#bbb;font-size:15px;line-height:1.7;text-align:center;margin-bottom:24px;">Sua compra foi confirmada com sucesso.<br>O conteudo ja esta disponivel na sua Area de Membros.</p>
    <div style="background:#151520;border:1px solid #2a2a40;border-radius:14px;padding:28px;margin:0 0 24px;">
      <table style="width:100%;border-collapse:collapse;">
        ${productLine}
        <tr><td style="padding:10px 0;color:#888;font-size:13px;border-bottom:1px solid #222;">Email de acesso</td><td style="padding:10px 0;color:#fff;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #222;">${customerEmail}</td></tr>
        <tr><td colspan="2" style="padding-top:14px;color:#999;font-size:13px;line-height:1.6;">Utilize seu email e a senha ja cadastrada para entrar. Caso nao lembre a senha, clique em <em>"Esqueci minha senha"</em> na tela de login.</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:28px 0;">
      <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#76FF03 0%,#64DD17 100%);color:#0a0a0a;text-decoration:none;font-weight:700;font-size:16px;padding:15px 36px;border-radius:10px;letter-spacing:0.3px;">Acessar Area de Membros</a>
    </div>
    <hr style="border:none;border-top:1px solid #222;margin:32px 0;">
    <p style="color:#555;font-size:12px;text-align:center;line-height:1.8;">Duvidas? Fale conosco em <a href="mailto:volatuspay@gmail.com" style="color:#9B30FF;text-decoration:none;">volatuspay@gmail.com</a><br>&copy; ${new Date().getFullYear()} VolatusPay &mdash; Todos os direitos reservados</p>
  </div>
</body></html>`,
        });
        console.log(`📧 [AUTO-MEMBER] Email de acesso enviado para membro existente: ${customerEmail}`);
      } catch (emailError) {
        console.error(`⚠️ [AUTO-MEMBER] Erro ao enviar email para membro existente:`, emailError);
      }

      return;
    }
    
    const crypto = await import('crypto');
    const provisionalPassword = crypto.randomBytes(4).toString('hex');
    
    let userRecord: any;
    let isExistingAuthUser = false;
    try {
      userRecord = await adminAM.auth().getUserByEmail(customerEmail);
      isExistingAuthUser = true;
      console.log(`🔑 [AUTO-MEMBER] Firebase Auth user já existe para ${customerEmail} - mantendo senha atual`);
    } catch {
      userRecord = await adminAM.auth().createUser({
        email: customerEmail,
        password: provisionalPassword,
        displayName: customerName || customerEmail.split('@')[0],
      });
    }

    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.hash(provisionalPassword, 10);

    let productTenantId = '';
    if (productId) {
      await neonQAM(async (sql: any) => {
        const rows = await sql`SELECT tenant_id FROM products WHERE id = ${productId} LIMIT 1`;
        if (rows[0]) productTenantId = rows[0].tenant_id || '';
      }, `autoMember:getTenantId:${productId}`);
    }

    // Upsert membro no Neon
    await neonQAM(async (sql: any) => {
      await sql`INSERT INTO members (id, user_id, email, name, tenant_id, auto_created, password, created_at, updated_at) VALUES (${userRecord.uid}, ${userRecord.uid}, ${customerEmail}, ${customerName || customerEmail.split('@')[0]}, ${productTenantId}, true, ${hashedPassword}, NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET password = ${hashedPassword}, updated_at = NOW()`;
    }, `autoMember:upsertMember:${userRecord.uid}`);

    if (productId && orderData.orderId) {
      let enrollProductTitle = '';
      await neonQAM(async (sql: any) => {
        const rows = await sql`SELECT name, title FROM products WHERE id = ${productId} LIMIT 1`;
        if (rows[0]) enrollProductTitle = rows[0].name || rows[0].title || '';
      }, `autoMember:enrollTitle:${productId}`);
      const enrollId = `enr_${nanoid(12)}`;
      await neonQAM(async (sql: any) => {
        await sql`INSERT INTO enrollments (id, member_id, product_id, order_id, tenant_id, product_title, enrollment_type, customer_email, customer_name, status, enrolled_at, created_at, updated_at) VALUES (${enrollId}, ${userRecord.uid}, ${productId}, ${orderData.orderId || null}, ${productTenantId}, ${enrollProductTitle}, 'purchase', ${customerEmail}, ${customerName || ''}, 'active', NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`;
      }, `autoMember:createEnroll:${enrollId}`);
    }

    try {
      const { sendEmail } = await import('../lib/email-service.js');
      const loginUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}/areademembros`
        : 'https://volatuspay.com/areademembros';

      let productTitleNew = '';
      if (orderData.productId) {
        try {
          await neonQAM(async (sql: any) => {
            const rows = await sql`SELECT name, title FROM products WHERE id = ${orderData.productId} LIMIT 1`;
            if (rows[0]) productTitleNew = rows[0].name || rows[0].title || '';
          }, `autoMember:productTitleNew:${orderData.productId}`);
        } catch { /* silently continue */ }
      }

      // Sempre envia a senha provisória quando é um novo documento de membro, pois a
      // senha bcrypt da área de membros é INDEPENDENTE do Firebase Auth. Mesmo que o
      // usuário já exista no Firebase Auth, o login da área de membros exige bcrypt, e
      // o hash salvo é o da provisionalPassword gerada agora — não a senha antiga deles.
      const credentialsSection = `<div style="background:#151520;border:1px solid #2a2a40;border-radius:14px;padding:28px;margin:24px 0;">
          <table style="width:100%;border-collapse:collapse;">
            ${productTitleNew ? `<tr><td style="padding:10px 0;color:#888;font-size:13px;border-bottom:1px solid #222;">Produto</td><td style="padding:10px 0;color:#e5e5e5;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #222;">${productTitleNew}</td></tr>` : ''}
            <tr><td style="padding:10px 0;color:#888;font-size:13px;border-bottom:1px solid #222;">Email</td><td style="padding:10px 0;color:#fff;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #222;">${customerEmail}</td></tr>
            <tr><td style="padding:10px 0;color:#888;font-size:13px;">Acesso inicial</td><td style="padding:10px 0;color:#9B30FF;font-size:20px;font-weight:700;text-align:right;letter-spacing:3px;">${provisionalPassword}</td></tr>
          </table>
          <p style="color:#888;font-size:12px;margin:16px 0 0;line-height:1.6;">Recomendamos trocar a senha apos o primeiro acesso em Configuracoes &gt; Seguranca.</p>
        </div>`;

      await sendEmail({
        to: customerEmail,
        subject: isExistingAuthUser
          ? (productTitleNew ? `Novo acesso liberado: ${productTitleNew} - VolatusPay` : 'Novo produto liberado na sua conta - VolatusPay')
          : (productTitleNew ? `Sua conta foi criada: ${productTitleNew} - VolatusPay` : 'Sua conta na Area de Membros foi criada - VolatusPay'),
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>VolatusPay</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:30px;background:#111;border-radius:12px;padding:28px 20px;">
      <img src="${BASE_URL}/logos/volatus-pay-logo.png" alt="Logo" width="200" style="display:block;margin:0 auto;max-width:200px;height:auto;" />
    </div>
    <h1 style="color:#ffffff;font-size:26px;text-align:center;margin-bottom:12px;font-weight:700;">
      ${isExistingAuthUser ? 'Novo produto liberado!' : 'Bem-vindo a Area de Membros!'}
    </h1>
    <p style="color:#bbb;font-size:15px;line-height:1.7;text-align:center;margin-bottom:24px;">
      ${isExistingAuthUser
        ? 'Sua compra foi confirmada. O acesso ao novo conteudo ja esta disponivel.'
        : 'Sua compra foi confirmada e sua conta foi criada. Guarde seus dados de acesso abaixo.'}
    </p>
    ${credentialsSection}
    <div style="text-align:center;margin:28px 0;">
      <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#76FF03 0%,#64DD17 100%);color:#0a0a0a;text-decoration:none;font-weight:700;font-size:16px;padding:15px 36px;border-radius:10px;letter-spacing:0.3px;">Acessar Area de Membros</a>
    </div>
    <hr style="border:none;border-top:1px solid #222;margin:32px 0;">
    <p style="color:#555;font-size:12px;text-align:center;line-height:1.8;">Duvidas? Fale conosco em <a href="mailto:volatuspay@gmail.com" style="color:#9B30FF;text-decoration:none;">volatuspay@gmail.com</a><br>&copy; ${new Date().getFullYear()} VolatusPay &mdash; Todos os direitos reservados</p>
  </div>
</body>
</html>`,
      });
      
      console.log(`📧 [AUTO-MEMBER] Email enviado para ${customerEmail} (existente: ${isExistingAuthUser})`);
    } catch (emailError) {
      console.error(`⚠️ [AUTO-MEMBER] Erro ao enviar email (conta criada mesmo assim):`, emailError);
    }

    // 📲 WHATSAPP: Notificar acesso liberado
    try {
      let customerPhone: string | undefined;
      if (orderData.orderId) {
        await neonQAM(async (sql: any) => {
          const rows = await sql`SELECT customer_phone FROM orders WHERE id = ${orderData.orderId} LIMIT 1`;
          if (rows[0]) customerPhone = rows[0].customer_phone || undefined;
        }, `autoMember:phone:${orderData.orderId}`);
      }
    } catch { /* silently skip */ }
    
    console.log(`✅ [AUTO-MEMBER] Conta criada automaticamente para ${customerEmail}`);
    
  } catch (error: any) {
    console.error(`❌ [AUTO-MEMBER] Erro ao criar conta automatica:`, error.message);
  }
}

// 🔧 SELLER: Reenviar email de acesso à área de membros para um comprador do próprio tenant
membersCoproductionRouter.post('/api/members/resend-access', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.user;
    if (!authUser) return res.status(401).json({ error: 'Não autenticado' });

    const { memberEmail, productId, orderId } = req.body;
    if (!memberEmail) return res.status(400).json({ error: 'memberEmail obrigatório' });

    const { neonQuery: neonQRA } = await import('../lib/neon-db.js');

    // Verificar que o seller tem acesso via Neon
    let sellerRA: any = null;
    await neonQRA(async (sql: any) => {
      const rows = await sql`SELECT id, tenant_id FROM sellers WHERE id = ${authUser.uid} LIMIT 1`;
      if (rows[0]) sellerRA = rows[0];
    }, `resendAccess:getSeller:${authUser.uid}`);
    if (!sellerRA) return res.status(403).json({ error: 'Usuário não é um seller válido' });
    const tenantId = sellerRA.tenant_id || authUser.uid;

    let resolvedOrderId = orderId;
    let resolvedProductId = productId;
    let resolvedName: string | undefined;

    if (resolvedOrderId) {
      let orderRA: any = null;
      await neonQRA(async (sql: any) => {
        const rows = await sql`SELECT id, tenant_id, product_id, customer_name FROM orders WHERE id = ${resolvedOrderId} LIMIT 1`;
        if (rows[0]) orderRA = rows[0];
      }, `resendAccess:getOrder:${resolvedOrderId}`);
      if (!orderRA || orderRA.tenant_id !== tenantId) return res.status(403).json({ error: 'Pedido não pertence ao seu tenant' });
      resolvedProductId = resolvedProductId || orderRA.product_id;
      resolvedName = orderRA.customer_name;
    } else {
      await neonQRA(async (sql: any) => {
        const rows = await sql`SELECT id, product_id, customer_name, status FROM orders WHERE customer_email = ${memberEmail} AND tenant_id = ${tenantId} LIMIT 10`;
        if (rows.length > 0) {
          const paid = rows.find((r: any) => r.status === 'paid') || rows[0];
          resolvedOrderId = paid.id;
          if (!resolvedProductId) resolvedProductId = paid.product_id;
          resolvedName = paid.customer_name;
        }
      }, `resendAccess:findOrder:${memberEmail}`);
    }

    await autoCreateMemberOnPurchase({
      customerEmail: memberEmail,
      customerName: resolvedName,
      productId: resolvedProductId,
      productType: 'digital',
      orderId: resolvedOrderId,
      forceCreate: true,
    });

    return res.json({ success: true, message: `Acesso reenviado para ${memberEmail}` });
  } catch (error: any) {
    console.error('[SELLER] Erro ao reenviar acesso de membro:', error.message);
    return res.status(500).json({ error: error.message || 'Erro interno' });
  }
});

// 🔧 ADMIN: Reenviar email de acesso à área de membros para um comprador (por orderId)
membersCoproductionRouter.post('/admin/send-access-by-email', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.user;
    const SUPERADMIN_EMAILS = (process.env.ADMIN_EMAIL || '').split(',').map((e: string) => e.trim()).filter(Boolean);
    if (!authUser || (SUPERADMIN_EMAILS.length > 0 && !SUPERADMIN_EMAILS.includes(authUser.email || ''))) {
      return res.status(403).json({ error: 'Acesso restrito ao administrador' });
    }

    const { customerEmail, customerName, productId } = req.body;
    if (!customerEmail) return res.status(400).json({ error: 'customerEmail obrigatório' });

    const { neonQuery: neonQSABE } = await import('../lib/neon-db.js');

    let orderId: string | undefined;
    let resolvedProductId = productId;
    let resolvedName = customerName;

    await neonQSABE(async (sql: any) => {
      const rows = await sql`SELECT id, product_id, customer_name, status FROM orders WHERE customer_email = ${customerEmail} LIMIT 10`;
      if (rows.length > 0) {
        const paid = rows.find((r: any) => r.status === 'paid') || rows[0];
        orderId = paid.id;
        if (!resolvedProductId) resolvedProductId = paid.product_id;
        if (!resolvedName) resolvedName = paid.customer_name;
      }
    }, `sendAccessByEmail:findOrder:${customerEmail}`);

    await autoCreateMemberOnPurchase({
      customerEmail,
      customerName: resolvedName,
      productId: resolvedProductId,
      productType: 'digital',
      orderId,
      forceCreate: true,
    });

    return res.json({ success: true, message: `Email de acesso enviado para ${customerEmail}`, orderId, productId: resolvedProductId });
  } catch (error: any) {
    console.error('[ADMIN] Erro ao enviar acesso por email:', error.message);
    return res.status(500).json({ error: error.message || 'Erro interno' });
  }
});

membersCoproductionRouter.post('/admin/resend-member-access', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.user;
    const SUPERADMIN_EMAILS = (process.env.ADMIN_EMAIL || '').split(',').map((e: string) => e.trim()).filter(Boolean);
    if (!authUser || (SUPERADMIN_EMAILS.length > 0 && !SUPERADMIN_EMAILS.includes(authUser.email || ''))) {
      return res.status(403).json({ error: 'Acesso restrito ao administrador' });
    }

    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId obrigatório' });

    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();

    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return res.status(404).json({ error: 'Pedido não encontrado' });

    const orderData = orderDoc.data() as any;
    const customerEmail = orderData.customerEmail || orderData.customer?.email;
    if (!customerEmail) return res.status(400).json({ error: 'Email do cliente não encontrado no pedido' });

    await autoCreateMemberOnPurchase({
      customerEmail,
      customerName: orderData.customerName || orderData.customer?.name,
      productId: orderData.productId,
      productType: orderData.productType || 'digital',
      orderId,
      checkoutId: orderData.checkoutId || orderData.checkoutSlug,
      forceCreate: true,
    });

    return res.json({ success: true, message: `Email de acesso enviado/reprocessado para ${customerEmail}` });
  } catch (error: any) {
    console.error('[ADMIN] Erro ao reenviar acesso de membro:', error.message);
    return res.status(500).json({ error: error.message || 'Erro interno' });
  }
});

export default membersCoproductionRouter;
