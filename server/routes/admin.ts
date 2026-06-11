import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { FieldValue, Timestamp, FieldPath } from 'firebase-admin/firestore';
import { ensureFirebaseReady, getAdmin, getFirestore } from '../lib/firebase-admin.js';
import { neonQuery } from '../lib/neon-db.js';
import { verifyFirebaseToken, requireAdmin, type AuthenticatedRequest } from '../security/firebase-auth.js';
import { storage } from '../storage.js';
import { calculateDynamicFees } from '../index.js';
import { runCardPendingReleaseNow } from '../services/balance-scheduler.js';
import { currencyConverter } from '../lib/currency-converter.js';
import { sendSellerApprovalEmail, sendSellerRejectionEmail, sendPixPagoEmail, sendWithdrawalApprovedEmail, sendWithdrawalRejectedEmail } from '../lib/email-service.js';
import { uploadToBunnyStorage, createSellerFolderStructure, uploadToSellerFolder, getSellerFolderPath } from '../lib/bunny-helper.js';
import { createWooviSubAccount, buildWooviSubAccountRequest } from '../lib/woovi-api.js';

const adminRouter = Router();

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fieldSize: 1 * 1024,
    fieldNameSize: 30,
    fields: 3
  },
  fileFilter: async (req: any, file: any, cb: any) => {
    try {
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedImageTypes.includes(file.mimetype)) {
        return cb(new Error('SECURITY: Apenas JPEG, PNG, WebP e GIF permitidos'));
      }
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      const extension = file.originalname.toLowerCase().split('.').pop();
      if (!extension || !validExtensions.includes('.' + extension)) {
        return cb(new Error('SECURITY: Extensão de arquivo não corresponde ao tipo'));
      }
      if (!file.originalname || file.originalname.length > 100) {
        return cb(new Error('SECURITY: Nome de imagem inválido'));
      }
      const suspiciousPatterns = /\.(php|jsp|asp|js|html|htm|svg|xml)$/i;
      if (suspiciousPatterns.test(file.originalname)) {
        return cb(new Error('SECURITY: Padrão suspeito detectado no nome'));
      }
      cb(null, true);
    } catch (error) {
      cb(new Error('SECURITY: Erro na validação do arquivo'));
    }
  }
});

const blockingRulesSchema = z.object({
  lowRiskThreshold: z.number().min(0).max(100),
  mediumRiskThreshold: z.number().min(0).max(100),
  highRiskThreshold: z.number().min(0).max(100),
  urgentRiskThreshold: z.number().min(0).max(100),
  autoBlockEnabled: z.boolean(),
  aiAnalysisEnabled: z.boolean(),
  chargebackThreshold: z.number().min(0).max(100).optional(),
  refundThreshold: z.number().min(0).max(100).optional(),
  chargebackCountThreshold: z.number().min(0).optional(),
  refundCountThreshold: z.number().min(0).optional(),
  blockType: z.enum(["account", "all_products", "specific_product"]).optional(),
  productQualityEnabled: z.boolean().optional(),
  chargebackMode: z.enum(["percentage", "quantity"]).optional(),
  refundMode: z.enum(["percentage", "quantity"]).optional()
});

function getThresholdWithDefault(value: number | undefined, defaultValue: number): number {
  return value ?? defaultValue;
}

async function calculateSellerRefundRiskAndAutoBlock(sellerId: string): Promise<{
  refundPercentage: number;
  shouldBlock: boolean;
  reason: string;
  aiAnalysis?: string;
}> {
  try {
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    const realtimeDb = admin.database();
    
    // CARREGAR REGRAS DE BLOQUEIO
    const rulesRef = realtimeDb.ref('system/blockingRules');
    const rulesSnapshot = await rulesRef.once('value');
    const rules = rulesSnapshot.val() || {
      autoBlockEnabled: false,
      aiAnalysisEnabled: true,
        chargebackThreshold: 5,
        refundThreshold: 10,
        chargebackCountThreshold: 3,
        refundCountThreshold: 10,
        blockType: "account",
        productQualityEnabled: true,
      lowRiskThreshold: 25,
      mediumRiskThreshold: 50,
      highRiskThreshold: 75,
      urgentRiskThreshold: 90
    };
    
    console.log('🔍 Regras de bloqueio carregadas:', rules);
    
    // SE BLOQUEIO AUTOMÁTICO DESATIVADO, RETORNA SEM BLOQUEAR
    if (!rules.autoBlockEnabled) {
      console.log('⏸️ Bloqueio automático DESATIVADO - pulando verificação');
      return {
        refundPercentage: 0,
        shouldBlock: false,
        reason: 'Bloqueio automático desativado'
      };
    }
    
    // BUSCAR TODOS OS PEDIDOS DO SELLER (NEON)
    let totalOrders = 0;
    let totalRefunds = 0;
    let refundRows: any[] = [];
    await neonQuery(async (sql) => {
      const oRows = await sql`SELECT COUNT(*) as cnt FROM orders WHERE tenant_id = ${sellerId} AND status = 'paid'`;
      totalOrders = parseInt(oRows[0]?.cnt || '0');
      const rRows = await sql`SELECT amount, created_at, reason FROM refunds WHERE tenant_id = ${sellerId} AND status = 'approved'`;
      totalRefunds = rRows.length;
      refundRows = rRows;
    }, `sellerRisk:${sellerId}`);

    if (totalOrders === 0) {
      console.log('✅ Seller sem pedidos aprovados - sem risco');
      return { refundPercentage: 0, shouldBlock: false, reason: 'Sem pedidos aprovados' };
    }
    
    const refundPercentage = (totalRefunds / totalOrders) * 100;
    
    console.log(`📊 Seller ${sellerId}: ${totalRefunds} reembolsos / ${totalOrders} pedidos = ${refundPercentage.toFixed(2)}%`);
    
    // DETERMINAR CATEGORIA DE RISCO
    let riskCategory: 'baixo' | 'medio' | 'alto' | 'urgente' = 'baixo';
    let thresholdExceeded = false;
    
    if (refundPercentage >= getThresholdWithDefault(rules.urgentRiskThreshold, 90)) {
      riskCategory = 'urgente';
      thresholdExceeded = true;
    } else if (refundPercentage >= getThresholdWithDefault(rules.highRiskThreshold, 75)) {
      riskCategory = 'alto';
      thresholdExceeded = true;
    } else if (refundPercentage >= getThresholdWithDefault(rules.mediumRiskThreshold, 50)) {
      riskCategory = 'medio';
      thresholdExceeded = true;
    } else if (refundPercentage >= getThresholdWithDefault(rules.lowRiskThreshold, 25)) {
      riskCategory = 'baixo';
      thresholdExceeded = true;
    }
    
    if (!thresholdExceeded) {
      console.log(`✅ Seller abaixo de todos os limites (${refundPercentage.toFixed(2)}%)`);
      return {
        refundPercentage,
        shouldBlock: false,
        reason: 'Abaixo dos limites configurados'
      };
    }
    
    console.log(`⚠️ LIMITE ULTRAPASSADO! Categoria: ${riskCategory} (${refundPercentage.toFixed(2)}%)`);
    
    // SE IA ATIVADA, USAR ANÁLISE DE PADRÕES
    let aiApproval = true; // Default: bloquear se ultrapassar limite
    let aiAnalysis = '';
    
    if (rules.aiAnalysisEnabled) {
      console.log('🤖 IA ATIVADA - Analisando padrões...');
      
      try {
        // ANALISAR PADRÕES COM IA (OPENAI)
        const openai = await import('openai');
        const apiKey = process.env.OPENAI_API_KEY;
        
        if (apiKey) {
          const client = new openai.OpenAI({ apiKey });
          
          // PREPARAR DADOS PARA IA
          const refundsData = refundRows.map((row: any) => ({
            date: row.created_at || new Date(),
            amount: row.amount || 0,
            reason: row.reason || 'Não informado'
          }));
          
          const prompt = `Analise este seller e determine se o bloqueio é justificado:

Estatísticas:
- Total de pedidos: ${totalOrders}
- Total de reembolsos: ${totalRefunds}
- % de reembolso: ${refundPercentage.toFixed(2)}%
- Categoria de risco: ${riskCategory}

Histórico de reembolsos recentes:
${JSON.stringify(refundsData.slice(-10), null, 2)}

IMPORTANTE: Analise se há padrões suspeitos (muitos reembolsos recentes, valores altos, razões suspeitas) ou se pode ser um seller legítimo com problemas operacionais normais.

Responda APENAS: "BLOQUEAR" ou "NÃO BLOQUEAR" seguido de uma linha com a justificativa (máximo 100 caracteres).`;

          const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: 'Você é um especialista em detecção de fraudes e análise de risco em e-commerce. Seja preciso e objetivo.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 150
          });
          
          const aiResponse = completion.choices[0]?.message?.content || '';
          aiAnalysis = aiResponse;
          aiApproval = aiResponse.toUpperCase().includes('BLOQUEAR') && !aiResponse.toUpperCase().includes('NÃO BLOQUEAR');
          
          console.log('🤖 IA respondeu:', aiResponse);
          console.log('🤖 IA aprova bloqueio?', aiApproval);
        } else {
          console.log('⚠️ OPENAI_API_KEY não configurada - usando análise heurística');
          aiApproval = true; // Se não tiver IA, bloqueia se ultrapassou limite
        }
      } catch (error) {
        console.error('❌ Erro na análise da IA:', error);
        console.log('🔄 Fallback: usando análise heurística');
        aiApproval = true; // Em caso de erro, bloqueia se ultrapassou limite
      }
    }
    
    // DECISÃO FINAL
    const shouldBlock = thresholdExceeded && aiApproval;
    
    if (shouldBlock) {
      console.log(`🚫 BLOQUEANDO produtos do seller ${sellerId}`);
      
      // BUSCAR TODOS OS PRODUTOS/CHECKOUTS DO SELLER (NEON)
      let checkouts: any[] = [];
      await neonQuery(async (sql) => {
        checkouts = await sql`SELECT id, product_id, tenant_id FROM checkouts WHERE tenant_id = ${sellerId} AND active = true`;
        if (checkouts.length > 0) {
          await sql`UPDATE checkouts SET blocked_by_refund_risk = true, blocked_at = NOW(), blocked_reason = ${'% de reembolso muito alto (' + refundPercentage.toFixed(2) + '%)'}, risk_category = ${riskCategory}, last_risk_check = NOW() WHERE tenant_id = ${sellerId} AND active = true`;
        }
        await sql`INSERT INTO risk_alerts (type, seller_id, refund_percentage, total_orders, total_refunds, risk_category, products_blocked, ai_analysis, status, created_at) VALUES ('AUTO_BLOCK', ${sellerId}, ${refundPercentage}, ${totalOrders}, ${totalRefunds}, ${riskCategory}, ${checkouts.length}, ${aiAnalysis || 'N/A'}, 'active', NOW())`;
      }, `autoBlockCheckouts:${sellerId}`);

      // Also update RTDB for each checkout (for real-time checkout page blocking)
      for (const checkout of checkouts) {
        const productId = checkout.product_id || checkout.id;
        realtimeDb.ref(`products/${productId}/blocked`).set({ blocked: true, reason: `% de reembolso muito alto (${refundPercentage.toFixed(2)}%)`, riskCategory, blockedAt: new Date().toISOString(), sellerId, checkoutId: checkout.id }).catch(() => {});
      }
      console.log(`✅ ${checkouts.length} produtos bloqueados!`);
    }
    
    return {
      refundPercentage,
      shouldBlock,
      reason: shouldBlock ? `Limite de ${riskCategory} ultrapassado (${refundPercentage.toFixed(2)}%)` : 'Abaixo do limite',
      aiAnalysis: aiAnalysis || undefined
    };
    
  } catch (error: any) {
    console.error('❌ Erro ao calcular risco de reembolso:', error);
    throw error;
  }
}

const sellersCache = new Map<string, { data: any; timestamp: number }>();
const productsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function batchFetchSellers(
  _db: any,
  tenantIds: string[]
): Promise<Map<string, any>> {
  const sellersMap = new Map<string, any>();
  const idsToFetch: string[] = [];

  for (const tid of tenantIds) {
    const cached = sellersCache.get(tid);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      sellersMap.set(tid, cached.data);
    } else {
      idsToFetch.push(tid);
    }
  }

  if (idsToFetch.length > 0) {
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM sellers WHERE id = ANY(${idsToFetch}::text[])`;
      for (const row of rows) {
        sellersMap.set(row.id, row);
        sellersCache.set(row.id, { data: row, timestamp: Date.now() });
      }
    }, 'batchFetchSellers');
  }

  return sellersMap;
}

async function batchFetchProducts(
  _db: any,
  checkoutIds: string[]
): Promise<Map<string, any>> {
  const productsMap = new Map<string, any>();
  const idsToFetch: string[] = [];

  for (const cid of checkoutIds) {
    const cached = productsCache.get(cid);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      productsMap.set(cid, cached.data);
    } else {
      idsToFetch.push(cid);
    }
  }

  if (idsToFetch.length > 0) {
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM checkouts WHERE id = ANY(${idsToFetch}::text[])`;
      for (const row of rows) {
        productsMap.set(row.id, row);
        productsCache.set(row.id, { data: row, timestamp: Date.now() });
      }
    }, 'batchFetchProducts');
  }

  return productsMap;
}

const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1 * 1024 * 1024, // 1 MB max
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.p12', '.pfx'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (!allowedExtensions.includes(ext)) {
      return cb(new Error(`Apenas arquivos ${allowedExtensions.join(', ')} são permitidos`));
    }
    
    // MIME type validation (pode ser application/x-pkcs12 ou octet-stream)
    const allowedMimes = ['application/x-pkcs12', 'application/octet-stream'];
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error('Tipo de arquivo inválido'));
    }
    
    cb(null, true);
  }
});

adminRouter.get('/api/admin/stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string>;
    const dateStart = startDate ? new Date(Number(startDate)) : null;
    const dateEnd = endDate ? new Date(Number(endDate)) : null;

    const inDateRange = (order: any): boolean => {
      if (!dateStart || !dateEnd) return true;
      const raw = order.paidAt || order.createdAt;
      if (!raw) return true;
      const d = raw?.toDate ? raw.toDate() : new Date(raw);
      return d >= dateStart && d <= dateEnd;
    };

    console.log('📊 GET - Admin buscando estatísticas gerais do sistema...');
    
    console.log('🔥 Buscando dados de orders e sellers do Neon...');

    const sellersMap = new Map<string, { id: string; name: string; email: string; phone?: string; revenue: number; orders: number }>();
    let totalSellers = 0;
    let totalCustomers = 0;
    let totalCheckouts = 0;
    let totalActiveSubscriptions = 0;
    let totalActiveProducts = 0;
    let totalRevenue = 0;
    let totalPaidOrders = 0;
    let totalPendingOrders = 0;
    let totalPendingRevenue = 0;
    let gatewayProfit = 0;
    let pixRevenue = 0;
    let cardBrRevenue = 0;
    let cardGlobalRevenue = 0;
    let boletoRevenue = 0;
    const salesByState = new Map<string, { state: string; count: number; revenue: number }>();

    await neonQuery(async (sql) => {
      // Count sellers
      const sCount = await sql`SELECT COUNT(*) as cnt FROM sellers`;
      totalSellers = parseInt(sCount[0]?.cnt || '0');

      // Count customers
      const cCount = await sql`SELECT COUNT(*) as cnt FROM customers`;
      totalCustomers = parseInt(cCount[0]?.cnt || '0');

      // Count checkouts
      const chCount = await sql`SELECT COUNT(*) as cnt FROM checkouts`;
      totalCheckouts = parseInt(chCount[0]?.cnt || '0');

      // Count active subscriptions
      const subCount = await sql`SELECT COUNT(*) as cnt FROM subscriptions WHERE status = 'active'`;
      totalActiveSubscriptions = parseInt(subCount[0]?.cnt || '0');

      // Count active products
      const prodCount = await sql`SELECT COUNT(*) as cnt FROM products WHERE active = true AND deleted_at IS NULL`;
      totalActiveProducts = parseInt(prodCount[0]?.cnt || '0');

      // Build sellers map
      const sellerRows = await sql`SELECT id, name, business_name, email, phone FROM sellers`;
      for (const s of sellerRows) {
        sellersMap.set(s.id, { id: s.id, name: s.business_name || s.name || 'Seller', email: s.email || 'N/A', phone: s.phone || '', revenue: 0, orders: 0 });
      }

      // Paid orders
      const startFilter = dateStart ? dateStart : new Date(0);
      const endFilter = dateEnd ? dateEnd : new Date('2099-12-31');
      const paidOrders = await sql`SELECT amount, gateway_fee, platform_fee, payment_method, method, gateway, processor, tenant_id, seller_name, seller_email, customer_address, state FROM orders WHERE status = 'paid' AND created_at BETWEEN ${startFilter} AND ${endFilter} LIMIT 10000`;

      for (const order of paidOrders) {
        const amount = order.amount || 0;
        totalRevenue += amount;
        totalPaidOrders++;
        gatewayProfit += order.gateway_fee || order.platform_fee || 0;
        const pm = (order.payment_method || order.method || order.gateway || '').toLowerCase();
        const proc = (order.processor || '').toLowerCase();
        const gw = (order.gateway || '').toLowerCase();
        if (pm.includes('pix') || proc.includes('pix') || gw.includes('pix')) pixRevenue += amount;
        else if (pm.includes('boleto') || proc.includes('boleto')) boletoRevenue += amount;
        else if (pm.includes('card') || pm.includes('credit') || proc.includes('stripe') || gw.includes('stripe')) {
          if (proc.includes('stripe') || gw.includes('stripe')) cardGlobalRevenue += amount;
          else cardBrRevenue += amount;
        }
        const tenantId = order.tenant_id;
        if (tenantId) {
          if (!sellersMap.has(tenantId)) sellersMap.set(tenantId, { id: tenantId, name: order.seller_name || 'Seller', email: order.seller_email || 'N/A', revenue: 0, orders: 0 });
          const s = sellersMap.get(tenantId)!;
          s.revenue += amount; s.orders++;
        }
        const state = order.customer_address?.state || order.state;
        if (state) {
          const ns = state.toUpperCase().trim();
          if (!salesByState.has(ns)) salesByState.set(ns, { state: ns, count: 0, revenue: 0 });
          const sd = salesByState.get(ns)!;
          sd.count++; sd.revenue += amount;
        }
      }

      // Pending orders
      const pendingOrders = await sql`SELECT amount FROM orders WHERE status = 'pending' AND created_at BETWEEN ${startFilter} AND ${endFilter} LIMIT 10000`;
      for (const o of pendingOrders) {
        totalPendingOrders++;
        totalPendingRevenue += o.amount || 0;
      }
    }, 'adminStats');

    const totalUsers = totalSellers;
    
    // Ordenar top sellers por revenue
    const topSellers = Array.from(sellersMap.values())
      .filter(s => s.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
    
    // Ordenar vendas por estado
    const salesByStateArray = Array.from(salesByState.values())
      .sort((a, b) => b.revenue - a.revenue);

    // 📊 TICKET MÉDIO (centavos)
    const ticketMedio = totalPaidOrders > 0 ? Math.round(totalRevenue / totalPaidOrders) : 0;

    // 📈 TAXA DE CONVERSÃO (paid / (paid + pending)) * 100
    const totalAttempts = totalPaidOrders + totalPendingOrders;
    const conversionRate = totalAttempts > 0 ? Math.round((totalPaidOrders / totalAttempts) * 100) : 0;
    
    console.log(`✅ Stats REAIS: ${totalRealCustomers} clientes reais (customers), ${totalSellers} sellers, ${totalCheckouts} checkouts`);
    console.log(`✅ Faturamento: R$ ${(totalRevenue / 100).toFixed(2)}, Vendas Pagas: ${totalPaidOrders}, Pendentes: ${totalPendingOrders}`);
    console.log(`💳 Faturamento por método: PIX: R$ ${(pixRevenue / 100).toFixed(2)}, Cartão BR: R$ ${(cardBrRevenue / 100).toFixed(2)}, Cartão Global: R$ ${(cardGlobalRevenue / 100).toFixed(2)}, Boleto: R$ ${(boletoRevenue / 100).toFixed(2)}`);
    console.log(`✅ Top Sellers: ${topSellers.length}, Estados: ${salesByStateArray.length}`);
    
    res.json({
      totalUsers,
      totalSellers,
      totalCustomers,
      totalCheckouts,
      totalRevenue,
      totalPaidOrders,
      totalPendingOrders,
      totalPendingRevenue,
      gatewayProfit,
      pixRevenue,
      cardBrRevenue,
      cardGlobalRevenue,
      boletoRevenue,
      topSellers,
      salesByState: salesByStateArray,
      ticketMedio,
      conversionRate,
      totalActiveSubscriptions,
      totalActiveProducts
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar stats para admin:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

adminRouter.get('/api/admin/blocking-rules', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🛡️ ADMIN: Carregando regras de bloqueio automático...');
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const realtimeDb = admin.database();
    
    // CARREGAR DO FIREBASE REALTIME DATABASE (ETERNAL STORAGE)
    const rulesRef = realtimeDb.ref('system/blockingRules');
    const snapshot = await rulesRef.once('value');
    const rules = snapshot.val();
    
    if (!rules) {
      // REGRAS PADRÃO SE NÃO EXISTIR
      const defaultRules = {
        lowRiskThreshold: 25,
        mediumRiskThreshold: 50,
        highRiskThreshold: 75,
        urgentRiskThreshold: 90,
        autoBlockEnabled: false,
        aiAnalysisEnabled: true,
        chargebackThreshold: 5,
        refundThreshold: 10,
        chargebackCountThreshold: 3,
        refundCountThreshold: 10,
        blockType: "account",
        productQualityEnabled: true,
      };
      
      console.log('✅ Retornando regras padrão');
      return res.json({ rules: defaultRules });
    }
    
    console.log('✅ Regras carregadas:', rules);
    return res.json({ rules });
    
  } catch (error: any) {
    console.error('❌ Erro ao carregar regras de bloqueio:', error);
    return res.status(500).json({
      error: 'Erro ao carregar regras de bloqueio'
    });
  }
});

adminRouter.post('/api/admin/blocking-rules', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🛡️ ADMIN: Salvando regras de bloqueio automático...');
    
    const { rules } = req.body;
    
    if (!rules) {
      return res.status(400).json({ error: 'Regras não fornecidas' });
    }
    
    // VALIDAR REGRAS COM ZOD
    const validationResult = blockingRulesSchema.safeParse(rules);
    
    if (!validationResult.success) {
      console.error('❌ Validação falhou:', validationResult.error);
      return res.status(400).json({ 
        error: 'Formato de regras inválido',
        details: validationResult.error.errors 
      });
    }
    
    const validatedRules = validationResult.data;
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const realtimeDb = admin.database();
    
    // SALVAR NO FIREBASE REALTIME DATABASE (ETERNAL STORAGE)
    const rulesRef = realtimeDb.ref('system/blockingRules');
    await rulesRef.set({
      ...validatedRules,
      lastUpdated: new Date().toISOString(),
      updatedBy: req.user?.uid || 'system'
    });
    
    console.log('✅ Regras salvas com sucesso:', {
      autoBlockEnabled: validatedRules.autoBlockEnabled,
      aiAnalysisEnabled: validatedRules.aiAnalysisEnabled,
      thresholds: { 
        lowRiskThreshold: validatedRules.lowRiskThreshold, 
        mediumRiskThreshold: validatedRules.mediumRiskThreshold, 
        highRiskThreshold: validatedRules.highRiskThreshold, 
        urgentRiskThreshold: validatedRules.urgentRiskThreshold 
      }
    });
    
    return res.json({
      success: true,
      message: 'Regras salvas com sucesso',
      rules: validatedRules
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao salvar regras de bloqueio:', error);
    return res.status(500).json({
      error: 'Erro ao salvar regras de bloqueio'
    });
  }
});

adminRouter.get('/api/admin/acquirer-stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📊 ADMIN: Buscando estatísticas da adquirente...');
    
    let totalSales = 0, chargebacks = 0, refunds = 0;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT status, COUNT(*) as cnt FROM orders WHERE status IN ('paid','refunded','chargeback') GROUP BY status`;
      for (const r of rows) {
        if (r.status === 'chargeback') chargebacks = parseInt(r.cnt);
        else if (r.status === 'refunded') refunds = parseInt(r.cnt);
        totalSales += parseInt(r.cnt);
      }
    }, 'acquirerStats');
    
    console.log(`✅ Stats: ${chargebacks} chargebacks, ${refunds} reembolsos, ${totalSales} total`);
    
    return res.json({
      success: true,
      stats: {
        chargebacks,
        refunds,
        total: totalSales,
        chargebackRate: totalSales > 0 ? ((chargebacks / totalSales) * 100).toFixed(2) : '0.00',
        refundRate: totalSales > 0 ? ((refunds / totalSales) * 100).toFixed(2) : '0.00'
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar stats da adquirente:', error);
    return res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

adminRouter.post('/api/admin/products/:productId/block', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const { reason, blockCheckout } = req.body;
    const adminEmail = req.authUser?.email || 'unknown';
    
    console.log(`🚫 ADMIN: Bloqueando produto ${productId} por ${adminEmail}`);
    
    let checkoutTenantId: string | null = null;
    let found = false;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id, active FROM checkouts WHERE id = ${productId} LIMIT 1`;
      if (rows.length > 0) {
        found = true;
        checkoutTenantId = rows[0].tenant_id;
        const newActive = blockCheckout !== false ? false : rows[0].active;
        await sql`UPDATE checkouts SET blocked = true, blocked_at = NOW(), blocked_by = ${adminEmail}, blocked_reason = ${reason || 'Bloqueio por risco'}, active = ${newActive} WHERE id = ${productId}`;
        await sql`INSERT INTO audit_logs (action, target_type, target_id, tenant_id, performed_by, reason, created_at) VALUES ('PRODUCT_BLOCKED','product',${productId},${checkoutTenantId},${adminEmail},${reason || 'Bloqueio por risco'},NOW())`;
      }
    }, `blockProduct:${productId}`);
    if (!found) return res.status(404).json({ error: 'Produto não encontrado' });
    // Also update RTDB for real-time checkout page
    try {
      const adminInst = getAdmin();
      const rtdb = adminInst.database();
      rtdb.ref(`products/${productId}/blocked`).set({ blocked: true, blockedAt: new Date().toISOString(), blockedBy: adminEmail, reason: reason || 'Bloqueio por risco' }).catch(() => {});
    } catch {}
    
    console.log(`✅ Produto ${productId} bloqueado`);
    res.json({ success: true, message: 'Produto bloqueado' });
    
  } catch (error: any) {
    console.error('❌ Erro ao bloquear produto:', error);
    res.status(500).json({ error: 'Erro ao bloquear produto' });
  }
});

adminRouter.post('/api/admin/products/:productId/unblock', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const adminEmail = req.authUser?.email || 'unknown';
    
    console.log(`✅ ADMIN: Desbloqueando produto ${productId}`);
    
    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET blocked = false, unblocked_at = NOW(), unblocked_by = ${adminEmail}, active = true WHERE id = ${productId}`;
      await sql`INSERT INTO audit_logs (action, target_type, target_id, performed_by, created_at) VALUES ('PRODUCT_UNBLOCKED','product',${productId},${adminEmail},NOW())`;
    }, `unblockProduct:${productId}`);
    try {
      const adminInst = getAdmin();
      const rtdb = adminInst.database();
      rtdb.ref(`products/${productId}/blocked`).remove().catch(() => {});
    } catch {}
    
    res.json({ success: true, message: 'Produto desbloqueado' });
    
  } catch (error: any) {
    console.error('❌ Erro ao desbloquear produto:', error);
    res.status(500).json({ error: 'Erro ao desbloquear produto' });
  }
});

adminRouter.post('/api/admin/check-seller-risk/:sellerId', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId } = req.params;
    
    if (!sellerId) {
      return res.status(400).json({ error: 'sellerId é obrigatório' });
    }
    
    console.log(`🔍 ADMIN: Verificando risco de reembolso para seller ${sellerId}`);
    
    const result = await calculateSellerRefundRiskAndAutoBlock(sellerId);
    
    return res.json({
      success: true,
      sellerId,
      ...result,
      message: result.shouldBlock 
        ? `Produtos bloqueados automaticamente (${result.refundPercentage.toFixed(2)}% de reembolso)`
        : `Seller está seguro (${result.refundPercentage.toFixed(2)}% de reembolso)`
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao verificar risco:', error);
    return res.status(500).json({
      error: 'Erro ao verificar risco de reembolso'
    });
  }
});

adminRouter.get('/api/admin/transactions', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const startTime = Date.now();
    const { search, status, gateway, dateFilter } = req.query;
    
    console.log('📊 ADMIN: Buscando transações reais do Firebase (BULK-LOADING OTIMIZADO)...');
    console.log('🔍 Filtros:', { search, status, gateway, dateFilter });
    
    // Build date range
    const now = new Date();
    let txStartDate: Date | null = null;
    let txEndDate: Date | null = null;
    if (dateFilter && dateFilter !== 'all' && dateFilter !== 'total') {
      txStartDate = new Date();
      switch (dateFilter) {
        case '24h': txStartDate.setHours(now.getHours() - 24); break;
        case 'today': txStartDate.setHours(0, 0, 0, 0); break;
        case 'yesterday':
          txStartDate.setDate(now.getDate() - 1); txStartDate.setHours(0, 0, 0, 0);
          txEndDate = new Date(txStartDate); txEndDate.setHours(23, 59, 59, 999); break;
        case 'week':
          const dow = now.getDay(); txStartDate.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); txStartDate.setHours(0, 0, 0, 0); break;
        case 'month': txStartDate.setDate(1); txStartDate.setHours(0, 0, 0, 0); break;
        case 'quarter':
          const qm = Math.floor(now.getMonth() / 3) * 3; txStartDate.setMonth(qm, 1); txStartDate.setHours(0, 0, 0, 0); break;
        case '7d': txStartDate.setDate(now.getDate() - 7); break;
        case '30d': txStartDate.setDate(now.getDate() - 30); break;
      }
    }

    let orders: any[] = [];
    const txSellersMap = new Map<string, any>();
    const txProductsMap = new Map<string, any>();
    await neonQuery(async (sql) => {
      let rows: any[];
      const lim = 100;
      if (txStartDate && txEndDate) {
        rows = await sql`SELECT o.*, s.business_name as seller_business_name, s.email as seller_email_data, c.title as product_title, c.commission_percent FROM orders o LEFT JOIN sellers s ON s.id = o.tenant_id LEFT JOIN checkouts c ON c.id = o.checkout_id WHERE (${status as string} = 'all' OR o.status = ${status as string}) AND (${gateway as string} = 'all' OR o.method = ${gateway as string}) AND o.created_at >= ${txStartDate} AND o.created_at <= ${txEndDate} ORDER BY o.created_at DESC LIMIT ${lim}`;
      } else if (txStartDate) {
        rows = await sql`SELECT o.*, s.business_name as seller_business_name, s.email as seller_email_data, c.title as product_title, c.commission_percent FROM orders o LEFT JOIN sellers s ON s.id = o.tenant_id LEFT JOIN checkouts c ON c.id = o.checkout_id WHERE (${status as string} = 'all' OR o.status = ${status as string}) AND (${gateway as string} = 'all' OR o.method = ${gateway as string}) AND o.created_at >= ${txStartDate} ORDER BY o.created_at DESC LIMIT ${lim}`;
      } else {
        rows = await sql`SELECT o.*, s.business_name as seller_business_name, s.email as seller_email_data, c.title as product_title, c.commission_percent FROM orders o LEFT JOIN sellers s ON s.id = o.tenant_id LEFT JOIN checkouts c ON c.id = o.checkout_id WHERE (${status as string} = 'all' OR o.status = ${status as string}) AND (${gateway as string} = 'all' OR o.method = ${gateway as string}) ORDER BY o.created_at DESC LIMIT ${lim}`;
      }
      orders = rows;
      // Fetch affiliate sellers for affiliate orders
      const affiliateIds = [...new Set(rows.filter((r: any) => r.is_affiliate_sale && r.affiliate_uid).map((r: any) => r.affiliate_uid))];
      if (affiliateIds.length > 0) {
        const affRows = await sql`SELECT id, business_name, email FROM sellers WHERE id = ANY(${affiliateIds})`;
        for (const a of affRows) txSellersMap.set(a.id, a);
      }
    }, 'adminTransactions');

    const queryTime = Date.now() - startTime;

    const transactions = [];
    const assemblyStartTime = Date.now();
    for (const data of orders) {
      const searchStr = (search as string || '').toLowerCase().trim();
      if (searchStr) {
        const cn = (data.customer?.name || data.customer_name || '').toLowerCase();
        const sn = (data.seller_business_name || data.seller_email_data || '').toLowerCase();
        const pn = (data.product_title || '').toLowerCase();
        const oid = (data.id || '').toLowerCase();
        if (!cn.includes(searchStr) && !sn.includes(searchStr) && !pn.includes(searchStr) && !oid.includes(searchStr)) continue;
      }

      let affiliateData: any = null;
      let affiliateCommission = 0;
      if (data.is_affiliate_sale && data.affiliate_uid) {
        affiliateData = txSellersMap.get(data.affiliate_uid);
        if (affiliateData) {
          const commissionPercent = (data.commission_percent || 10) / 100;
          affiliateCommission = Math.round((data.amount || 0) * commissionPercent);
          if (affiliateCommission < 0) affiliateCommission = 0;
        }
      }

      const paymentMethod = (data.method === 'card' || data.method === 'stripe') ? 'card' : 'pix';
      let fees: any;
      if (data.gateway_fee !== undefined && data.net_amount !== undefined) {
        fees = { gatewayFee: data.gateway_fee || 0, platformFee: data.platform_fee || 0, netAmount: data.net_amount, gatewayFeePercent: 0, platformFeePercent: 0, releaseDays: 1 };
      } else {
        const gw = data.processor === 'stripe' ? 'stripe' : (data.processor || data.acquirer || data.gateway || 'efibank');
        fees = await calculateDynamicFees(data.amount || 0, paymentMethod, data.installments || 1, gw, data.tenant_id || null);
      }

      transactions.push({
        id: data.id, orderId: data.id,
        sellerId: data.tenant_id,
        sellerName: data.seller_business_name || data.seller_email_data?.split('@')[0] || 'Seller',
        sellerEmail: data.seller_email_data || 'seller@email.com',
        companyName: data.seller_business_name || 'Empresa',
        productName: data.product_title || 'Produto Digital',
        productId: data.product_id || data.checkout_id || 'N/A',
        checkoutId: data.checkout_id,
        customerName: data.customer?.name || data.customer_name || 'Cliente',
        customerEmail: data.customer?.email || data.customer_email || 'cliente@email.com',
        customerPhone: data.customer?.phone || data.customer_phone || '',
        customerDocument: data.customer?.document || data.customer_document || '',
        amount: data.amount || 0, currency: 'BRL',
        paymentMethod: data.method || 'pix', paymentStatus: data.status || 'pending',
        platformFee: fees.platformFee, gatewayFee: fees.gatewayFee, netAmount: fees.netAmount,
        createdAt: data.created_at ? new Date(data.created_at).toISOString() : new Date().toISOString(),
        paidAt: data.paid_at ? new Date(data.paid_at).toISOString() : null,
        tenantId: data.tenant_id, productType: data.product_type || 'digital',
        gateway: data.processor || data.method || 'pix',
        processor: data.processor || (data.method === 'pix' ? 'efibank' : 'stripe'),
        transactionId: data.id,
        isAffiliateSale: data.is_affiliate_sale || false,
        affiliateId: data.affiliate_uid || null,
        affiliateName: affiliateData?.business_name || affiliateData?.email?.split('@')[0] || null,
        affiliateEmail: affiliateData?.email || null,
        affiliateCommission,
        customer: data.customer
      });
    }

    const assemblyTime = Date.now() - assemblyStartTime;
    const totalTime = Date.now() - startTime;
    res.json({ success: true, transactions, total: transactions.length, _meta: { queryTime, batchTime: 0, assemblyTime, totalTime } });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar transações admin:', error);
    res.status(500).json({
      error: 'Erro ao buscar transações',
      message: error.message
    });
  }
});

adminRouter.get('/api/admin/transactions/stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { dateFilter } = req.query;
    
    console.log('📊 ADMIN: Calculando estatísticas das transações...');
    
    // Build date filter for neon
    const stNow = new Date();
    let stStartDate: Date | null = null;
    let stEndDate: Date | null = null;
    if (dateFilter && dateFilter !== 'all' && dateFilter !== 'total') {
      stStartDate = new Date();
      switch (dateFilter) {
        case '24h': stStartDate.setHours(stNow.getHours() - 24); break;
        case 'today': stStartDate.setHours(0, 0, 0, 0); break;
        case 'yesterday': stStartDate.setDate(stNow.getDate() - 1); stStartDate.setHours(0, 0, 0, 0); stEndDate = new Date(stStartDate); stEndDate.setHours(23, 59, 59, 999); break;
        case 'week': const sdow = stNow.getDay(); stStartDate.setDate(stNow.getDate() - (sdow === 0 ? 6 : sdow - 1)); stStartDate.setHours(0, 0, 0, 0); break;
        case 'month': stStartDate.setDate(1); stStartDate.setHours(0, 0, 0, 0); break;
        case 'quarter': const sqm = Math.floor(stNow.getMonth() / 3) * 3; stStartDate.setMonth(sqm, 1); stStartDate.setHours(0, 0, 0, 0); break;
        case '7d': stStartDate.setDate(stNow.getDate() - 7); break;
        case '30d': stStartDate.setDate(stNow.getDate() - 30); break;
      }
    }

    let totalTransactions = 0, totalPaid = 0, totalPending = 0, totalRevenue = 0, totalFees = 0;
    let pixCount = 0, cardCount = 0, efibankCount = 0, stripeCount = 0, affiliateSalesCount = 0, affiliateRevenue = 0;
    const sellerRevenueMap = new Map<string, number>();

    await neonQuery(async (sql) => {
      let rows: any[];
      if (stStartDate && stEndDate) {
        rows = await sql`SELECT status, amount, method, processor, platform_fee, gateway_fee, tenant_id, is_affiliate_sale FROM orders WHERE created_at >= ${stStartDate} AND created_at <= ${stEndDate}`;
      } else if (stStartDate) {
        rows = await sql`SELECT status, amount, method, processor, platform_fee, gateway_fee, tenant_id, is_affiliate_sale FROM orders WHERE created_at >= ${stStartDate}`;
      } else {
        rows = await sql`SELECT status, amount, method, processor, platform_fee, gateway_fee, tenant_id, is_affiliate_sale FROM orders`;
      }
      for (const data of rows) {
        totalTransactions++;
        if (data.status === 'paid') {
          totalPaid++; totalRevenue += data.amount || 0;
          totalFees += (data.platform_fee || 0) + (data.gateway_fee || 0);
          if (data.tenant_id) sellerRevenueMap.set(data.tenant_id, (sellerRevenueMap.get(data.tenant_id) || 0) + (data.amount || 0));
        } else if (data.status === 'pending') totalPending++;
        if (data.method === 'pix') pixCount++;
        else if (data.method === 'card') cardCount++;
        if (data.processor === 'efibank' || data.method === 'pix') efibankCount++;
        else if (data.processor === 'stripe' || data.method === 'card') stripeCount++;
        if (data.is_affiliate_sale && data.status === 'paid') { affiliateSalesCount++; affiliateRevenue += data.amount || 0; }
      }
    }, 'adminTransactionStats');
    
    const stats = {
      totalTransactions,
      totalPaid,
      totalPending,
      totalRevenue,
      totalFees,
      avgTicket: totalPaid > 0 ? Math.floor(totalRevenue / totalPaid) : 0,
      conversionRate: totalTransactions > 0 ? ((totalPaid / totalTransactions) * 100).toFixed(1) : 0,
      
      // 💳 POR MÉTODO
      byMethod: {
        pix: pixCount,
        card: cardCount
      },
      
      // 🏦 POR GATEWAY/PROCESSADOR
      byGateway: {
        efibank: efibankCount,
        stripe: stripeCount
      },
      
      // 🎁 VENDAS DE AFILIADOS
      affiliates: {
        totalSales: affiliateSalesCount,
        totalRevenue: affiliateRevenue,
        averageTicket: affiliateSalesCount > 0 ? Math.floor(affiliateRevenue / affiliateSalesCount) : 0
      },
      
      // 🏢 TOP 5 SELLERS POR RECEITA
      topSellers: Array.from(sellerRevenueMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sellerId, revenue]) => ({ sellerId, revenue }))
    };
    
    console.log('📊 ADMIN Stats calculadas:', stats);
    
    res.json({
      success: true,
      stats
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao calcular estatísticas:', error);
    res.status(500).json({
      error: 'Erro ao calcular estatísticas',
      message: error.message
    });
  }
});

adminRouter.post('/api/admin/promote-to-seller', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }
    
    console.log(`🔧 [PROMOTE-SELLER] Admin promovendo usuário: ${email}`);
    
    // Buscar Firebase Admin para Auth (only)
    const { getAdmin: getAdminForAuth } = await import('../lib/firebase-admin.js');
    const adminInstance = await getAdminForAuth();
    
    // Buscar usuário pelo email no Firebase Auth
    let userRecord;
    try {
      userRecord = await adminInstance.auth().getUserByEmail(email);
    } catch (authError: any) {
      console.error(`❌ [PROMOTE-SELLER] Usuário não encontrado no Auth: ${email}`);
      return res.status(404).json({ error: 'Usuário não encontrado no Firebase Auth' });
    }
    
    const userId = userRecord.uid;
    console.log(`✅ [PROMOTE-SELLER] Usuário encontrado - UID: ${userId.substring(0, 8)}...`);
    
    // Verificar se já é seller (Neon)
    let alreadySeller = false;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE id = ${userId} LIMIT 1`;
      alreadySeller = rows.length > 0;
    }, 'promoteSellerCheck');

    if (alreadySeller) {
      console.log(`⚠️ [PROMOTE-SELLER] Usuário já é seller: ${userId.substring(0, 8)}...`);
      return res.json({ success: true, message: 'Usuário já é seller', userId, alreadySeller: true });
    }
    
    // Criar seller no Neon
    const approvedBy = req.authUser?.email || 'admin';
    await neonQuery(async (sql) => {
      await sql`INSERT INTO sellers (id, email, status, profile_complete, approved_at, approved_by, created_at) VALUES (${userId}, ${email}, 'approved', true, NOW(), ${approvedBy}, NOW()) ON CONFLICT (id) DO UPDATE SET status = 'approved', approved_at = NOW(), approved_by = ${approvedBy}`
    }, 'promoteSeller');

    console.log(`✅ [PROMOTE-SELLER] Seller criado com sucesso: ${userId.substring(0, 8)}...`);
    
    res.json({
      success: true,
      message: 'Usuário promovido a seller com sucesso',
      userId,
      email,
      status: 'approved'
    });
    
  } catch (error: any) {
    console.error('❌ [PROMOTE-SELLER] Erro:', error);
    res.status(500).json({
      error: 'Erro ao promover usuário',
      message: error.message
    });
  }
});

adminRouter.post('/api/admin/efibank/certificate', 
  verifyFirebaseToken, 
  requireAdmin,
  certificateUpload.single('certificate'),
  async (req: AuthenticatedRequest, res) => {
    try {
      console.log('📤 UPLOAD: Recebendo certificado EfíBank...');
      
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          error: 'Nenhum arquivo enviado' 
        });
      }
      
      const buffer = req.file.buffer;
      
      // 🔍 VALIDAÇÃO: Magic bytes PKCS#12 (0x30 0x82)
      if (buffer[0] !== 0x30 || buffer[1] !== 0x82) {
        console.error('❌ VALIDAÇÃO FALHOU: Magic bytes inválidos');
        return res.status(400).json({ 
          success: false, 
          error: 'Arquivo não é um certificado PKCS#12 válido (.p12)' 
        });
      }
      
      // 🔍 VALIDAÇÃO: Tamanho mínimo (certificados válidos > 256 bytes)
      if (buffer.length < 256) {
        console.error('❌ VALIDAÇÃO FALHOU: Arquivo muito pequeno');
        return res.status(400).json({ 
          success: false, 
          error: 'Certificado parece estar corrompido (tamanho insuficiente)' 
        });
      }
      
      console.log(`✅ VALIDAÇÃO: Certificado PKCS#12 válido (${buffer.length} bytes)`);
      
      // 🐰 BUNNY CDN: Salvar certificado ETERNAMENTE
      const timestamp = Date.now();
      const storagePath = `certificates/global/efibank-${timestamp}.p12`;
      
      console.log(`💾 SALVANDO no Bunny CDN: ${storagePath}`);
      
      // 📁 CAMINHO LOCAL PARA FALLBACK
      const localCertPath = `/home/runner/workspace/certs/efi-prod.p12`;
      let savedToBunnyCDN = false;
      let savedLocally = false;
      
      // 💾 TENTAR UPLOAD DO BUFFER PARA BUNNY CDN
      try {
        const { uploadToBunnyStorage } = await import('../lib/bunny-helper.js');
        const uploadResult = await uploadToBunnyStorage(storagePath, buffer, 'application/x-pkcs12');
        
        if (uploadResult.success) {
          savedToBunnyCDN = true;
          console.log(`✅ CERTIFICADO SALVO NO BUNNY CDN: ${storagePath}`);
        } else {
          console.warn(`⚠️ Bunny CDN falhou: ${uploadResult.error}`);
          console.log('📁 Tentando fallback para armazenamento local...');
        }
      } catch (storageError: any) {
        console.warn(`⚠️ Bunny CDN falhou: ${storageError.message}`);
        console.log('📁 Tentando fallback para armazenamento local...');
      }
      
      // 📁 SEMPRE SALVAR LOCALMENTE (FALLBACK + CACHE)
      try {
        const fs = await import('fs');
        const pathModule = await import('path');
        const certsDir = pathModule.dirname(localCertPath);
        
        // Criar diretório se não existir
        if (!fs.existsSync(certsDir)) {
          fs.mkdirSync(certsDir, { recursive: true });
          console.log(`📁 Diretório criado: ${certsDir}`);
        }
        
        // Salvar certificado localmente
        fs.writeFileSync(localCertPath, buffer);
        savedLocally = true;
        console.log(`✅ CERTIFICADO SALVO LOCALMENTE: ${localCertPath} (${buffer.length} bytes)`);
      } catch (localError: any) {
        console.error(`❌ Erro ao salvar localmente: ${localError.message}`);
      }
      
      // 🔐 SALVAR NO FIREBASE RTDB (SEGURO - não público)
      let savedToRTDB = false;
      try {
        const { getAdmin } = await import('../lib/firebase-admin.js');
        const adminSdk = getAdmin();
        const rtdb = adminSdk.database();
        await rtdb.ref('system/certificates/efibank-prod').set({
          base64: buffer.toString('base64'),
          uploadedAt: new Date().toISOString(),
          uploadedBy: req.authUser?.email || 'admin',
          sizeBytes: buffer.length,
          source: 'admin-upload'
        });
        savedToRTDB = true;
        console.log('🔐 CERTIFICADO SALVO NO FIREBASE RTDB (seguro, não público)');
      } catch (rtdbError: any) {
        console.warn(`⚠️ RTDB save falhou (non-blocking): ${rtdbError.message}`);
      }
      
      // ❌ Se não conseguiu salvar em nenhum lugar, retornar erro
      if (!savedToBunnyCDN && !savedLocally && !savedToRTDB) {
        return res.status(500).json({
          success: false,
          error: 'Não foi possível salvar o certificado',
          details: 'Falha ao salvar no RTDB, Bunny CDN e localmente'
        });
      }
      
      console.log(`✅ CERTIFICADO SALVO COM SUCESSO (RTDB: ${savedToRTDB}, Bunny CDN: ${savedToBunnyCDN}, Local: ${savedLocally})`);
      
      // 🔄 ATUALIZAR PAYMENTCONFIG COM NOVO CERTIFICADO
      const db = getAdmin().firestore();
      const { savePaymentConfig, getPaymentConfig } = await import('../lib/payment-config.js');
      
      // Buscar config existente
      const existingConfig = await getPaymentConfig(db);
      
      // Atualizar com novo certificateStoragePath (+ manter certificatePath legado)
      const updatedEfibank = {
        ...existingConfig?.efibank,
        certificatePath: localCertPath,
        certificateStoragePath: savedToBunnyCDN ? storagePath : null,
        certificateInRTDB: savedToRTDB,
        certificateUpdatedAt: new Date()
      };
      
      await savePaymentConfig(
        db, 
        {
          ...existingConfig,
          efibank: updatedEfibank
        },
        req.authUser?.uid || 'system',
        req.authUser?.email || 'admin'
      );
      
      console.log('✅ PAYMENT CONFIG ATUALIZADO COM CERTIFICADO');
      
      const successMessage = savedToRTDB 
        ? 'Certificado EfíBank salvo com sucesso no Firebase (seguro) e localmente'
        : savedToBunnyCDN 
          ? 'Certificado EfíBank salvo no Bunny CDN e localmente'
          : 'Certificado EfíBank salvo localmente';
      
      res.json({
        success: true,
        message: successMessage,
        certificatePath: localCertPath,
        certificateStoragePath: savedToBunnyCDN ? storagePath : null,
        savedToRTDB,
        savedToBunnyCDN,
        savedLocally,
        uploadedAt: new Date().toISOString(),
        fileSize: buffer.length
      });
      
    } catch (error: any) {
      console.error('❌ ERRO ao fazer upload de certificado:', error);
      
      res.status(500).json({
        success: false,
        error: 'Erro ao salvar certificado',
        details: error.message
      });
    }
});

adminRouter.post('/api/admin/efibank/test-connection', 
  verifyFirebaseToken, 
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      console.log('🔍 ADMIN: Testando conexão EfíBank...');
      
      await ensureFirebaseReady();
      const db = getAdmin().firestore();
      const { getEfiBankKeys } = await import('../lib/payment-config.js');
      const https = await import('https');
      
      const efiKeys = await getEfiBankKeys(db);
      
      const adminSdk = getAdmin();
      const rtdb = adminSdk.database();
      const certSnap = await rtdb.ref('system/certificates/efibank-prod').once('value');
      const certData = certSnap.val();
      
      const diagnostics: any = {
        credentials: {
          clientIdLength: efiKeys.clientId?.length || 0,
          clientSecretLength: efiKeys.clientSecret?.length || 0,
          clientIdFirst6: efiKeys.clientId?.substring(0, 6) || 'N/A',
          clientIdLast4: efiKeys.clientId?.substring(efiKeys.clientId.length - 4) || 'N/A',
          environment: efiKeys.environment,
          hasPayeeCode: !!efiKeys.payeeCode,
          hasPixKey: !!efiKeys.pixKey,
        },
        certificate: {
          existsInRTDB: !!certData?.base64,
          sizeBytes: certData?.sizeBytes || 0,
          uploadedAt: certData?.uploadedAt || 'N/A',
          uploadedBy: certData?.uploadedBy || 'N/A',
          source: certData?.source || 'N/A',
        },
        connectionTest: { success: false, error: '', details: '' }
      };
      
      if (!efiKeys.clientId || !efiKeys.clientSecret) {
        diagnostics.connectionTest.error = 'Credenciais ausentes';
        return res.json({ success: false, diagnostics });
      }
      
      if (!certData?.base64) {
        diagnostics.connectionTest.error = 'Certificado não encontrado no RTDB';
        return res.json({ success: false, diagnostics });
      }
      
      const certBuffer = Buffer.from(certData.base64, 'base64');
      diagnostics.certificate.actualBytes = certBuffer.length;
      diagnostics.certificate.validMagicBytes = certBuffer[0] === 0x30 && certBuffer[1] === 0x82;
      
      try {
        const httpsAgent = new https.Agent({
          pfx: certBuffer,
          passphrase: '',
          rejectUnauthorized: true,
          keepAlive: false,
          timeout: 15000,
          minVersion: 'TLSv1.2'
        });
        
        const credentials = Buffer.from(`${efiKeys.clientId}:${efiKeys.clientSecret}`).toString('base64');
        const postData = JSON.stringify({ grant_type: 'client_credentials' });
        
        const result: string = await new Promise((resolve, reject) => {
          const reqOAuth = https.request({
            hostname: 'pix.api.efipay.com.br',
            port: 443,
            path: '/oauth/token',
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
            agent: httpsAgent,
          }, (response: any) => {
            let data = '';
            response.on('data', (chunk: any) => data += chunk);
            response.on('end', () => resolve(`${response.statusCode}|${data}`));
          });
          reqOAuth.on('error', (e: any) => reject(e));
          reqOAuth.setTimeout(15000, () => { reqOAuth.destroy(); reject(new Error('Timeout')); });
          reqOAuth.write(postData);
          reqOAuth.end();
        });
        
        const [statusCode, responseBody] = result.split('|');
        const parsed = JSON.parse(responseBody || '{}');
        
        if (statusCode === '200' && parsed.access_token) {
          diagnostics.connectionTest.success = true;
          diagnostics.connectionTest.details = 'Token OAuth2 obtido com sucesso!';
          console.log('✅ TESTE CONEXÃO EFIBANK: SUCESSO!');
        } else {
          diagnostics.connectionTest.error = parsed.error_description || parsed.error || 'Erro desconhecido';
          diagnostics.connectionTest.statusCode = statusCode;
          diagnostics.connectionTest.rawResponse = parsed;
          console.log(`❌ TESTE CONEXÃO EFIBANK: ${statusCode} - ${parsed.error_description}`);
        }
      } catch (connError: any) {
        diagnostics.connectionTest.error = connError.message;
        console.log(`❌ TESTE CONEXÃO EFIBANK ERRO: ${connError.message}`);
      }
      
      res.json({ success: diagnostics.connectionTest.success, diagnostics });
      
    } catch (error: any) {
      console.error('❌ Erro no teste de conexão EfíBank:', error);
      res.status(500).json({ success: false, error: error.message });
    }
});

adminRouter.post('/api/admin/efibank/register-webhook', 
  verifyFirebaseToken, 
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      console.log('🔔 ADMIN: Registrando webhook EfíBank PIX...');
      
      await ensureFirebaseReady();
      const db = getAdmin().firestore();
      
      // 1️⃣ Buscar configuração EfíBank
      const { getPaymentConfig } = await import('../lib/payment-config.js');
      const paymentConfig = await getPaymentConfig(db);
      
      if (!paymentConfig?.efibank?.enabled) {
        return res.status(400).json({ 
          success: false, 
          error: 'EfíBank não está habilitado' 
        });
      }
      
      const { pixKey, certificatePath, certificateStoragePath, environment } = paymentConfig.efibank;
      
      if (!pixKey) {
        return res.status(400).json({ 
          success: false, 
          error: 'Chave PIX não configurada' 
        });
      }
      
      // 2️⃣ Baixar certificado do Bunny CDN
      let certBuffer: Buffer | undefined;
      
      // 🔧 FIX: Usar certificateStoragePath (Bunny CDN) ao invés de certificatePath (filesystem)
      const storagePathToUse = certificateStoragePath || certificatePath;
      
      if (storagePathToUse) {
        console.log(`📥 Baixando certificado do Bunny CDN: ${storagePathToUse}`);
        certBuffer = await downloadCertFromFirebaseStorage(storagePathToUse);
      } else {
        console.warn('⚠️ Nenhum certificado configurado - webhook pode falhar');
      }
      
      // 3️⃣ Construir webhook URL com HMAC (busca do Firebase ou gera automaticamente)
      let WEBHOOK_HMAC = await getWebhookHmac(db);
      
      // 🔐 AUTO-GERAR HMAC SE NÃO EXISTIR
      if (!WEBHOOK_HMAC) {
        console.log('🔐 EFIBANK_WEBHOOK_HMAC não encontrado - gerando automaticamente...');
        const crypto = await import('crypto');
        WEBHOOK_HMAC = crypto.randomBytes(32).toString('hex');
        console.log(`✅ HMAC gerado: ${WEBHOOK_HMAC.substring(0, 8)}...`);
        
        const { encryptSensitiveData } = await import('../security/key-encryption.js');
        const encryptedHmac = encryptSensitiveData(WEBHOOK_HMAC);
        await neonQuery(async (sql) => {
          const existing = await sql`SELECT config FROM payment_config WHERE id='global' LIMIT 1`;
          const cfg: any = existing[0]?.config || {};
          cfg.efibank = { ...(cfg.efibank || {}), webhookHmac: encryptedHmac };
          await sql`INSERT INTO payment_config (id, config, updated_at) VALUES ('global', ${cfg as any}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`;
        }, 'saveEfibankHmac');
        console.log('✅ HMAC salvo no Neon (criptografado)');
      }
      
      // 🌐 Usar domínio base (PRODUÇÃO ETERNA: volatuspay.com)
      const domain = getBaseDomain();
      const webhookUrl = `${domain}/webhook/efi?hmac=${WEBHOOK_HMAC}&ignorar=`;
      
      console.log(`🌐 Registrando webhook URL: ${webhookUrl.replace(WEBHOOK_HMAC, '***')}`);
      console.log(`🔑 Chave PIX: ${pixKey.substring(0, 8)}...`);
      console.log(`🏭 Environment: ${environment || 'production'}`);
      
      // 4️⃣ Registrar webhook na API EfíBank
      const success = await registerEfiBankWebhook(pixKey, webhookUrl, certBuffer);
      
      if (success) {
        console.log('✅ Webhook EfíBank registrado com sucesso!');
        
        const webhookRegisteredAt = new Date().toISOString();
        await neonQuery(async (sql) => {
          const existing = await sql`SELECT config FROM payment_config WHERE id='global' LIMIT 1`;
          const cfg: any = existing[0]?.config || {};
          cfg.efibank = { ...(cfg.efibank || {}), webhookRegisteredAt, webhookUrl };
          cfg.updatedBy = req.user?.uid || 'system';
          await sql`INSERT INTO payment_config (id, config, updated_at) VALUES ('global', ${cfg as any}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`;
        }, 'saveEfibankWebhookUrl');
        console.log('💾 Webhook metadata salva no Neon');
        
        return res.json({
          success: true,
          message: 'Webhook PIX registrado com sucesso na EfíBank',
          webhookUrl: webhookUrl.replace(WEBHOOK_HMAC, '***'),
          pixKey: pixKey.substring(0, 8) + '...',
          environment: environment || 'production',
          registeredAt: webhookRegisteredAt
        });
      } else {
        throw new Error('Falha ao registrar webhook (retorno false)');
      }
      
    } catch (error: any) {
      const errorMessage = sanitizeError(error);
      console.error('❌ ERRO ao registrar webhook EfíBank:', errorMessage);
      
      return res.status(500).json({
        success: false,
        error: 'Erro ao registrar webhook',
        details: errorMessage,
        hint: 'Verifique se o certificado EfíBank está configurado e as credenciais estão corretas'
      });
    }
});

adminRouter.post('/api/admin/cleanup-failed-orders', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🧹 ADMIN: Limpando vendas falhadas...');
    
    const { sellerEmail, timePeriod, productType, dryRun = true } = req.body;
    if (!['1h', '24h', '7d', 'all'].includes(timePeriod)) return res.status(400).json({ error: 'Período inválido. Use: 1h, 24h, 7d ou all' });
    if (!['digital', 'subscription', 'all'].includes(productType)) return res.status(400).json({ error: 'Tipo de produto inválido. Use: digital, subscription ou all' });
    console.log(`📊 Filtros: Email=${sellerEmail || 'TODOS'}, Período=${timePeriod}, Tipo=${productType}, DryRun=${dryRun}`);

    const now = new Date();
    let startDate = new Date(0);
    if (timePeriod === '1h') startDate = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    else if (timePeriod === '24h') startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    else if (timePeriod === '7d') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let uniqueOrders: any[] = [];
    await neonQuery(async (sql) => {
      let rows: any[];
      if (!sellerEmail || sellerEmail.trim() === '') {
        rows = productType === 'all'
          ? await sql`SELECT id, status, product_type, amount FROM orders WHERE status NOT IN ('paid','pending') AND created_at >= ${startDate}`
          : await sql`SELECT id, status, product_type, amount FROM orders WHERE status NOT IN ('paid','pending') AND product_type = ${productType} AND created_at >= ${startDate}`;
      } else {
        // Find seller by email
        const sellerRows = await sql`SELECT id FROM sellers WHERE email = ${sellerEmail} LIMIT 1`;
        const targetId = sellerRows[0]?.id || null;
        if (targetId) {
          rows = productType === 'all'
            ? await sql`SELECT id, status, product_type, amount FROM orders WHERE tenant_id = ${targetId} AND status NOT IN ('paid','pending') AND created_at >= ${startDate}`
            : await sql`SELECT id, status, product_type, amount FROM orders WHERE tenant_id = ${targetId} AND product_type = ${productType} AND status NOT IN ('paid','pending') AND created_at >= ${startDate}`;
        } else {
          rows = [];
        }
      }
      uniqueOrders = rows;
    }, 'adminCleanupFailedOrders');

    const stats = { total: uniqueOrders.length, byStatus: {} as Record<string, number>, byType: {} as Record<string, number>, totalAmount: 0 };
    const orderIds: string[] = [];
    for (const o of uniqueOrders) {
      orderIds.push(o.id);
      stats.byStatus[o.status] = (stats.byStatus[o.status] || 0) + 1;
      stats.byType[o.product_type || 'unknown'] = (stats.byType[o.product_type || 'unknown'] || 0) + 1;
      stats.totalAmount += o.amount || 0;
    }

    if (uniqueOrders.length === 0) return res.json({ success: true, message: 'Nenhuma venda falhada encontrada', statistics: { found: 0, deleted: 0, email: sellerEmail, timePeriod, productType } });

    if (dryRun) {
      return res.json({ success: true, dryRun: true, message: `Preview: ${stats.total} vendas falhadas seriam removidas`, statistics: { found: stats.total, deleted: 0, email: sellerEmail, timePeriod, productType, byStatus: stats.byStatus, byType: stats.byType, totalAmount: stats.totalAmount }, orderIds });
    }

    let deletedCount = 0;
    await neonQuery(async (sql) => {
      await sql`DELETE FROM orders WHERE id = ANY(${orderIds})`;
      deletedCount = orderIds.length;
      await sql`INSERT INTO audit_logs (action, performed_by, target_email, orders_deleted, created_at) VALUES ('cleanup_failed_orders',${req.user?.uid || 'unknown'},${sellerEmail || null},${deletedCount},NOW())`;
    }, 'adminDeleteFailedOrders');

    res.json({ success: true, message: `${deletedCount} vendas falhadas removidas com sucesso!`, statistics: { found: stats.total, deleted: deletedCount, email: sellerEmail, timePeriod, productType, byStatus: stats.byStatus, byType: stats.byType, totalAmount: stats.totalAmount } });
    
  } catch (error: any) {
    console.error('❌ Erro ao limpar vendas falhadas:', error);
    res.status(500).json({
      error: 'Erro ao limpar vendas falhadas',
      details: error.message,
    });
  }
});

adminRouter.post('/api/admin/upload-banner', verifyFirebaseToken, requireAdmin, uploadImage.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📤 Upload de banner iniciado - User:', req.user?.uid);
    
    if (!req.file) {
      console.log('❌ Nenhum arquivo recebido no upload');
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    console.log('📤 Admin fazendo upload de banner:', req.file.originalname, 'Size:', req.file.size, 'bytes');

    // 🛡️ BLINDAGEM 1: TIPOS PERMITIDOS (whitelist rigoroso)
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      console.log('🚫 BLOQUEADO: Tipo de arquivo não permitido:', req.file.mimetype);
      return res.status(400).json({ error: 'Tipo de arquivo não permitido. Use apenas JPEG, PNG, WebP ou GIF' });
    }

    // 🛡️ BLINDAGEM 2: VALIDAÇÃO DE MAGIC BYTES (Sharp valida se é imagem real)
    try {
      const imageMetadata = await sharp(req.file.buffer).metadata();
      
      // Validar formato contra magic bytes (Sharp lê os bytes reais)
      const validFormats = ['jpeg', 'png', 'webp'];
      if (!imageMetadata.format || !validFormats.includes(imageMetadata.format)) {
        console.log('🚫 BLOQUEADO: Magic bytes inválidos. Formato detectado:', imageMetadata.format);
        return res.status(400).json({ error: 'Arquivo corrompido ou não é uma imagem válida' });
      }

      // 🛡️ BLINDAGEM 3: VALIDAÇÃO DE DIMENSÕES (proteção contra zip bombs)
      if (!imageMetadata.width || !imageMetadata.height) {
        console.log('🚫 BLOQUEADO: Imagem sem dimensões válidas');
        return res.status(400).json({ error: 'Imagem com dimensões inválidas' });
      }

      // Limite de dimensões: 8000x8000 (proteção contra DoS)
      if (imageMetadata.width > 8000 || imageMetadata.height > 8000) {
        console.log('🚫 BLOQUEADO: Dimensões muito grandes:', imageMetadata.width, 'x', imageMetadata.height);
        return res.status(400).json({ error: 'Imagem muito grande. Máximo: 8000x8000 pixels' });
      }

      console.log('✅ VALIDAÇÃO PASSOU: Formato:', imageMetadata.format, 'Dimensões:', imageMetadata.width, 'x', imageMetadata.height);

    } catch (sharpError) {
      console.log('🚫 BLOQUEADO: Sharp não conseguiu processar (arquivo malicioso?):', sharpError);
      return res.status(400).json({ error: 'Arquivo inválido ou corrompido' });
    }

    // 🛡️ BLINDAGEM 4: SANITIZAÇÃO DE NOME DE ARQUIVO (previne path traversal)
    const sanitizedName = req.file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')  // Remove caracteres perigosos
      .replace(/\.{2,}/g, '.')            // Remove ".." (path traversal)
      .substring(0, 100);                 // Limita tamanho

    // 🛡️ BLINDAGEM 5: NOME ÚNICO COM NANOID (previne conflitos e ataques)
    const timestamp = Date.now();
    const ext = sanitizedName.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const fileName = `banners/banner-${timestamp}-${nanoid(8)}.${safeExt}`;

    // 🐰 Upload para Bunny CDN (com fallback local)
    const { uploadToBunnyStorage } = await import('../lib/bunny-helper.js');
    const uploadResult = await uploadToBunnyStorage(fileName, req.file.buffer, req.file.mimetype);
    let publicUrl: string;
    if (uploadResult.success && uploadResult.url) {
      publicUrl = uploadResult.url;
    } else {
      // Fallback local quando Bunny não está configurado
      const fs = await import('fs');
      const path = await import('path');
      const localDir = path.join(process.cwd(), 'uploads', 'images', 'banners');
      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
      const localFile = path.join(localDir, path.basename(fileName));
      fs.writeFileSync(localFile, req.file.buffer);
      publicUrl = `/uploads/images/banners/${path.basename(fileName)}`;
      console.log('⚠️ Bunny indisponível, banner salvo localmente:', publicUrl);
    }

    console.log('✅ Banner uploaded com sucesso (BLINDADO):', publicUrl);

    res.json({
      success: true,
      url: publicUrl,
      fileName
    });

  } catch (error) {
    console.error('❌ Erro ao fazer upload de banner:', error);
    res.status(500).json({ error: 'Erro ao fazer upload da imagem' });
  }
});

adminRouter.delete('/api/admin/checkout/:id/execute-deletion', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.uid;
    
    console.log(`🗑️ ADMIN deletando checkout ${id}`);
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    let checkoutExists = false;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM checkouts WHERE id = ${id} LIMIT 1`;
      checkoutExists = rows.length > 0;
    }, `executeDeletionCheck:${id}`);
    if (!checkoutExists) return res.status(404).json({ error: 'Checkout não encontrado' });

    // Cascade soft-delete via Neon
    await neonQuery(async (sql) => {
      const products = await sql`SELECT id FROM products WHERE checkout_id = ${id}`;
      for (const p of products) {
        const modules = await sql`SELECT id FROM modules WHERE product_id = ${p.id}`;
        for (const m of modules) {
          await sql`UPDATE lessons SET active = false, deleted = true, deleted_at = NOW(), deleted_reason = 'checkout_deleted' WHERE module_id = ${m.id}`;
          await sql`UPDATE modules SET active = false, deleted = true, deleted_at = NOW(), deleted_reason = 'checkout_deleted' WHERE id = ${m.id}`;
        }
        await sql`UPDATE products SET active = false, deleted = true, deleted_at = NOW(), deleted_reason = 'checkout_deleted' WHERE id = ${p.id}`;
      }
      await sql`UPDATE checkouts SET deleted = true, deleted_at = NOW(), deleted_by = 'system' WHERE id = ${id}`;
    }, `executeDeletion:${id}`);

    console.log(`✅ Checkout ${id} soft-deleted com sucesso (+ área de membros arquivada)`);
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Erro ao deletar checkout:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

adminRouter.post('/api/admin/checkout/:id/approve-deletion', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.uid;
    
    console.log(`✅ Admin aprovando exclusão de checkout ${id}`);
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    let checkoutDeletion: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, deletion_request FROM checkouts WHERE id = ${id} LIMIT 1`;
      checkoutDeletion = rows[0] || null;
    }, `approveDeletionCheck:${id}`);

    if (!checkoutDeletion) return res.status(404).json({ error: 'Checkout não encontrado' });
    const delReq = checkoutDeletion.deletion_request || {};
    if (delReq.status !== 'pending') return res.status(400).json({ error: 'Não há solicitação de exclusão pendente para este checkout' });

    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET deletion_request = jsonb_set(COALESCE(deletion_request,'{}'),'{status}','"approved"') || ${JSON.stringify({ reviewedAt: new Date().toISOString(), reviewedBy: userId })}::jsonb WHERE id = ${id}`;
      const products = await sql`SELECT id FROM products WHERE checkout_id = ${id}`;
      for (const p of products) {
        const modules = await sql`SELECT id FROM modules WHERE product_id = ${p.id}`;
        for (const m of modules) {
          await sql`UPDATE lessons SET active = false, deleted = true, deleted_at = NOW(), deleted_reason = 'approved_deletion' WHERE module_id = ${m.id}`;
          await sql`UPDATE modules SET active = false, deleted = true, deleted_at = NOW(), deleted_reason = 'approved_deletion' WHERE id = ${m.id}`;
        }
        await sql`UPDATE products SET active = false, deleted = true, deleted_at = NOW(), deleted_reason = 'approved_deletion' WHERE id = ${p.id}`;
      }
      await sql`UPDATE checkouts SET deleted = true, deleted_at = NOW(), deleted_by = 'admin_approved' WHERE id = ${id}`;
    }, `approveDeletion:${id}`);

    console.log(`✅ Checkout ${id} e área de membros soft-deleted após aprovação`);
    res.json({ success: true, message: 'Exclusão aprovada e executada com sucesso' });
    
  } catch (error) {
    console.error('❌ Erro ao aprovar exclusão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

adminRouter.post('/api/admin/checkout/:id/reject-deletion', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user?.uid;
    
    console.log(`❌ Admin rejeitando exclusão de checkout ${id}`);
    
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    let checkoutRej: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, deletion_request FROM checkouts WHERE id = ${id} LIMIT 1`;
      checkoutRej = rows[0] || null;
    }, `rejectDeletionCheck:${id}`);
    if (!checkoutRej) return res.status(404).json({ error: 'Checkout não encontrado' });
    const rejDelReq = checkoutRej.deletion_request || {};
    if (rejDelReq.status !== 'pending') return res.status(400).json({ error: 'Não há solicitação de exclusão pendente para este checkout' });

    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET deletion_request = jsonb_set(COALESCE(deletion_request,'{}'),'{status}','"rejected"') || ${JSON.stringify({ reviewedAt: new Date().toISOString(), reviewedBy: userId, rejectionReason: reason || 'Sem motivo fornecido' })}::jsonb WHERE id = ${id}`;
    }, `rejectDeletion:${id}`);
    
    console.log(`✅ Solicitação de exclusão rejeitada para checkout ${id}`);
    res.json({ success: true, message: 'Solicitação de exclusão rejeitada' });
    
  } catch (error) {
    console.error('❌ Erro ao rejeitar exclusão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

adminRouter.post('/api/admin/products/:id/approve-deletion', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    const adminUid = req.authUser?.uid || req.user?.uid;
    
    console.log(`👑 ADMIN: Aprovando exclusão de produto ${productId}`);
    
    let productForApproval: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, deletion_request, deleted_at, deleted_by, tenant_id FROM products WHERE id = ${productId} LIMIT 1`;
      productForApproval = rows[0] || null;
    }, `approveProdDeletionCheck:${productId}`);

    if (!productForApproval) return res.status(404).json({ error: 'Produto não encontrado' });
    const pDelReq = productForApproval.deletion_request || {};
    if (pDelReq.status !== 'pending') return res.status(400).json({ error: 'Não há solicitação de exclusão pendente para este produto', currentStatus: pDelReq.status });
    if (productForApproval.deleted_at || pDelReq.status === 'approved') return res.status(409).json({ error: 'Produto já foi aprovado para exclusão anteriormente' });

    console.log(`🗑️ Deletando produto ${productId} e TODOS os checkouts via Neon...`);

    let checkoutsDeleted = 0, memberAreasDeleted = 0, modulesArchived = 0, enrollmentsRevoked = 0;
    const bunnyVideoGuids: string[] = [];

    await neonQuery(async (sql) => {
      // 1. Archive product
      await sql`UPDATE products SET active = false, deletion_request = ${JSON.stringify({ status: 'approved', reviewedAt: new Date().toISOString(), reviewedBy: adminUid })}::jsonb, deleted_at = NOW(), deleted_by = ${adminUid}, updated_at = NOW() WHERE id = ${productId}`;
      // 2. Delete checkouts
      const chkRows = await sql`UPDATE checkouts SET deleted = true, deleted_at = NOW(), deleted_by = 'product_deletion_approved' WHERE synced_product_id = ${productId} RETURNING id`;
      checkoutsDeleted = chkRows.length;
      // 3. Member areas
      const maRows = await sql`UPDATE member_areas SET deleted = true, deleted_at = NOW(), deleted_reason = 'product_deletion_approved' WHERE product_id = ${productId} RETURNING id`;
      memberAreasDeleted = maRows.length;
      // 4. Modules + lessons + collect Bunny GUIDs
      const modRows = await sql`SELECT id FROM modules WHERE product_id = ${productId}`;
      for (const mod of modRows) {
        const lesRows = await sql`SELECT id, video_type, video_url FROM lessons WHERE module_id = ${mod.id}`;
        for (const les of lesRows) {
          if (les.video_type === 'panda' && les.video_url) {
            const gm = les.video_url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
            if (gm) bunnyVideoGuids.push(gm[1]);
          }
          await sql`UPDATE lessons SET active = false, deleted_at = NOW(), updated_at = NOW() WHERE id = ${les.id}`;
        }
        await sql`UPDATE modules SET active = false, deleted_at = NOW(), updated_at = NOW() WHERE id = ${mod.id}`;
        modulesArchived++;
      }
      // 5. Revoke enrollments
      const enrRows = await sql`UPDATE enrollments SET status = 'cancelled', access_revoked_at = NOW(), access_revoked_reason = 'product_deleted_by_admin', updated_at = NOW() WHERE product_id = ${productId} AND status = 'active' RETURNING id`;
      enrollmentsRevoked = enrRows.length;
    }, `approveProdDeletion:${productId}`);

    // Bunny cleanup
    if (bunnyVideoGuids.length > 0) {
      try {
        const { cleanupBunnyResources } = await import('../services/bunny-cleanup');
        const cleanupResult = await cleanupBunnyResources(bunnyVideoGuids, []);
        return res.json({ success: true, message: 'Produto deletado com sucesso', details: { productId, checkoutsDeleted, memberAreasDeleted, modulesArchived, enrollmentsRevoked, bunnyVideosDeleted: cleanupResult.videosDeleted } });
      } catch (ce: any) {
        return res.json({ success: true, message: 'Produto deletado (aviso: vídeos Bunny podem não ter sido removidos)', details: { productId, checkoutsDeleted, memberAreasDeleted, modulesArchived, enrollmentsRevoked, bunnyCleanupWarning: ce.message } });
      }
    }
    res.json({ success: true, message: 'Produto deletado com sucesso', details: { productId, checkoutsDeleted, memberAreasDeleted, modulesArchived, enrollmentsRevoked } });
    
  } catch (error: any) {
    console.error('❌ Erro ao aprovar exclusão:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

adminRouter.post('/api/admin/products/:id/reject-deletion', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    const rejectionReason = req.body?.reason || 'Produto não pode ser excluído';
    const adminUid = req.authUser?.uid || req.user?.uid;
    
    console.log(`👑 ADMIN: Rejeitando exclusão de produto ${productId}`);
    
    let prodForRejection: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, deletion_request, deleted_at, tenant_id FROM products WHERE id = ${productId} LIMIT 1`;
      prodForRejection = rows[0] || null;
    }, `rejectProdDeletionCheck:${productId}`);
    if (!prodForRejection) return res.status(404).json({ error: 'Produto não encontrado' });
    const rPDelReq = prodForRejection.deletion_request || {};
    if (rPDelReq.status !== 'pending') return res.status(400).json({ error: 'Não há solicitação de exclusão pendente para este produto', currentStatus: rPDelReq.status });
    if (rPDelReq.status === 'approved' || prodForRejection.deleted_at) return res.status(409).json({ error: 'Produto já foi aprovado e deletado, não pode ser rejeitado' });

    await neonQuery(async (sql) => {
      await sql`UPDATE products SET deletion_request = ${JSON.stringify({ status: 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: adminUid, rejectionReason: rejectionReason })}::jsonb, updated_at = NOW() WHERE id = ${productId}`;
    }, `rejectProdDeletion:${productId}`);
    
    console.log(`✅ Exclusão rejeitada. Produto continua ativo.`);
    console.log(`📝 Motivo: ${rejectionReason}`);
    
    res.json({ 
      success: true,
      message: 'Solicitação de exclusão rejeitada',
      productId,
      rejectionReason
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao rejeitar exclusão:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

adminRouter.post('/api/admin/products/:id/toggle-status', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    const adminUid = req.authUser?.uid || req.user?.uid;
    
    console.log(`👑 ADMIN: Toggle status de produto ${productId}`);
    
    let prodToggle: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, active, status, description, image_url, checkout_id FROM products WHERE id = ${productId} LIMIT 1`;
      prodToggle = rows[0] || null;
    }, `toggleProductCheck:${productId}`);
    if (!prodToggle) return res.status(404).json({ error: 'Produto não encontrado' });

    const currentActive = prodToggle.active ?? true;
    const newActive = !currentActive;
    const missingDesc = !prodToggle.description || (prodToggle.description || '').trim().length < 5;
    const missingImg = !prodToggle.image_url || (prodToggle.image_url || '').trim() === '';
    const newStatus = newActive ? ((missingDesc && missingImg) ? 'risk' : 'active') : 'blocked';

    console.log(`🔄 ${newActive ? 'Ativando' : 'Bloqueando'} produto ${productId} → ${newStatus}`);

    let updatedProduct: any = null;
    await neonQuery(async (sql) => {
      await sql`UPDATE products SET active = ${newActive}, status = ${newStatus}, updated_at = NOW() WHERE id = ${productId}`;
      if (prodToggle.checkout_id) {
        await sql`UPDATE checkouts SET active = ${newActive}, updated_at = NOW() WHERE id = ${prodToggle.checkout_id}`;
      }
      const rows = await sql`SELECT * FROM products WHERE id = ${productId} LIMIT 1`;
      updatedProduct = rows[0] || null;
    }, `toggleProduct:${productId}`);

    res.json({ success: true, message: `Produto ${newActive ? 'ativado' : 'bloqueado'} com sucesso`, product: updatedProduct });
    
  } catch (error: any) {
    console.error('❌ Erro ao alterar status:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }

});

adminRouter.patch('/api/admin/products/:id/hide-showcase', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    const adminUid = req.authUser?.uid || req.user?.uid;
    
    console.log(`👑 ADMIN: Toggle ocultar vitrine para produto ${productId}`);
    
    let prodHide: any = null;
    let resolvedCheckoutId: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, checkout_id, admin_hidden, tenant_id FROM products WHERE id = ${productId} LIMIT 1`;
      prodHide = rows[0] || null;
    }, `hideShowcaseCheck:${productId}`);
    if (!prodHide) return res.status(404).json({ error: 'Produto não encontrado' });

    resolvedCheckoutId = prodHide.checkout_id || null;
    if (!resolvedCheckoutId) {
      const r = await (async () => { let v: string | null = null; await neonQuery(async (sql) => { const rows = await sql`SELECT id FROM checkouts WHERE synced_product_id = ${productId} OR product_id = ${productId} LIMIT 1`; v = rows[0]?.id || null; }, 'hideShowcaseFindCheckout'); return v; })();
      resolvedCheckoutId = r;
    }

    const newHidden = !prodHide.admin_hidden;

    await neonQuery(async (sql) => {
      await sql`UPDATE products SET admin_hidden = ${newHidden}, admin_hidden_at = ${newHidden ? new Date() : null}, admin_hidden_by = ${newHidden ? adminUid : null}, updated_at = NOW() WHERE id = ${productId}`;
      if (resolvedCheckoutId) {
        await sql`UPDATE checkouts SET admin_hidden = ${newHidden}, admin_hidden_at = ${newHidden ? new Date() : null}, admin_hidden_by = ${newHidden ? adminUid : null}, updated_at = NOW() WHERE id = ${resolvedCheckoutId}`;
      }
    }, `hideShowcase:${productId}`);

    res.json({ success: true, message: newHidden ? 'Produto oculto da vitrine' : 'Produto visível na vitrine', productId, checkoutId: resolvedCheckoutId, adminHidden: newHidden });
    
  } catch (error: any) {
    console.error('❌ Erro ao alterar visibilidade na vitrine:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

adminRouter.post('/api/admin/products/:id/delete', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const productId = req.params.id;
    const adminUid = req.authUser?.uid || req.user?.uid;
    
    console.log(`🗑️ ADMIN: Deletando produto ${productId} por admin ${adminUid}`);
    
    let prodDelete: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, checkout_id, seller_id, image_url, title FROM products WHERE id = ${productId} LIMIT 1`;
      prodDelete = rows[0] || null;
    }, `adminProdDeleteCheck:${productId}`);
    if (!prodDelete) return res.status(404).json({ error: 'Produto não encontrado' });

    const stats = { checkoutsDeleted: 0, modulesArchived: 0, lessonsArchived: 0, bunnyFilesDeleted: 0, productDeleted: false };

    await neonQuery(async (sql) => {
      // Archive checkouts
      const chkRows = await sql`UPDATE checkouts SET active = false, archived_at = NOW(), archived_by = ${adminUid}, archived_reason = 'product_deleted_by_admin' WHERE product_id = ${productId} OR synced_product_id = ${productId} OR id = ${prodDelete.checkout_id || ''} RETURNING id`;
      stats.checkoutsDeleted = chkRows.length;
      // Archive modules + lessons
      const modRows = await sql`SELECT id FROM modules WHERE product_id = ${productId}`;
      for (const mod of modRows) {
        const lesRows = await sql`SELECT id, video_url FROM lessons WHERE module_id = ${mod.id}`;
        for (const les of lesRows) {
          if (les.video_url) {
            try { const vid = les.video_url.split('/').pop()?.split('?')[0]; if (vid) { await deleteBunnyStreamVideo(vid); stats.bunnyFilesDeleted++; } } catch {}
          }
          await sql`UPDATE lessons SET active = false, archived = true, archived_at = NOW() WHERE id = ${les.id}`;
          stats.lessonsArchived++;
        }
        await sql`UPDATE modules SET active = false, archived = true, archived_at = NOW(), archived_by = ${adminUid}, archived_reason = 'Produto deletado por admin' WHERE id = ${mod.id}`;
        stats.modulesArchived++;
      }
      // Bunny image
      if (prodDelete.image_url?.includes('bunny')) {
        try { const img = prodDelete.image_url.split('/').pop(); if (img) { await deleteBunnyStorageFile(img); stats.bunnyFilesDeleted++; } } catch {}
      }
      // Soft-delete product
      await sql`UPDATE products SET active = false, deleted = true, deleted_at = NOW(), deleted_by = ${adminUid}, status = 'deleted' WHERE id = ${productId}`;
      stats.productDeleted = true;
    }, `adminProdDelete:${productId}`);

    res.json({ success: true, message: 'Produto deletado com sucesso. Histórico financeiro preservado.', details: stats });
    
  } catch (error: any) {
    console.error(`❌ Erro ao deletar produto:`, error);
    res.status(500).json({ 
      error: 'Erro ao deletar produto', 
      message: error.message 
    });
  }
});

adminRouter.post('/api/admin/sync-deletion-requests', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log(`🔄 ADMIN: Sincronizando solicitações de exclusão...`);
    
    let checkoutsWithPending = 0, syncedCount = 0;
    await neonQuery(async (sql) => {
      const chkRows = await sql`SELECT id, deletion_request FROM checkouts WHERE deletion_request->>'status' = 'pending'`;
      checkoutsWithPending = chkRows.length;
      for (const chk of chkRows) {
        const prodRows = await sql`SELECT id, deletion_request FROM products WHERE checkout_id = ${chk.id} LIMIT 1`;
        if (prodRows.length > 0) {
          const prod = prodRows[0];
          const dr = prod.deletion_request || {};
          if (dr.status !== 'pending') {
            const chkDr = chk.deletion_request || {};
            await sql`UPDATE products SET deletion_request = ${JSON.stringify({ status: 'pending', requestedAt: chkDr.requestedAt || new Date().toISOString(), requestedBy: chkDr.requestedBy, reason: chkDr.reason || `Solicitação de exclusão do checkout ${chk.id}`, expiresAt: chkDr.expiresAt })}::jsonb, updated_at = NOW() WHERE id = ${prod.id}`;
            syncedCount++;
          }
        }
      }
    }, 'syncDeletionRequests');

    res.json({ success: true, checkoutsWithPendingDeletion: checkoutsWithPending, productsSynced: syncedCount, message: `${syncedCount} produtos sincronizados com sucesso` });
    
  } catch (error: any) {
    console.error('❌ Erro ao sincronizar:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

adminRouter.get('/api/admin/products/deletion-requests', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log(`👑 ADMIN: Listando produtos com solicitação de exclusão pendente`);
    
    let products: any[] = [];
    await neonQuery(async (sql) => {
      const prodRows = await sql`SELECT * FROM products WHERE deletion_request->>'status' = 'pending' ORDER BY (deletion_request->>'requestedAt') DESC NULLS LAST`;
      for (const p of prodRows) {
        const salesRows = await sql`SELECT COUNT(*) as cnt FROM orders WHERE checkout_id IN (SELECT id FROM checkouts WHERE synced_product_id = ${p.id}) AND status IN ('paid','completed')`;
        products.push({ ...p, totalSales: parseInt(salesRows[0]?.cnt || '0') });
      }
    }, 'listDeletionRequests');

    res.json({ products, total: products.length });
    
  } catch (error: any) {
    console.error('❌ Erro ao listar solicitações:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

adminRouter.get('/api/admin/products/deleted', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log(`👑 ADMIN: Listando produtos deletados (histórico)`);
    
    let products: any[] = [];
    await neonQuery(async (sql) => {
      products = await sql`SELECT * FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100`;
    }, 'listDeletedProducts');
    res.json({ products, total: products.length });
  } catch (error: any) {
    console.error('❌ Erro ao listar produtos deletados:', error);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

adminRouter.post('/api/admin/create-missing-products', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerEmail } = req.body;
    
    // ⚠️ VERIFICAR SE É ADMIN
    const userUid = req.user?.uid;
    const isAdmin = await checkAdminAccess(userUid || '');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Apenas admins podem executar' });
    }
    
    if (!sellerEmail) return res.status(400).json({ error: 'sellerEmail obrigatório' });
    
    let sellerRow: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, name, email FROM sellers WHERE email = ${sellerEmail} LIMIT 1`;
      sellerRow = rows[0] || null;
    }, 'createMissingProductsFindSeller');
    if (!sellerRow) return res.status(404).json({ error: 'Seller não encontrado' });

    const tenantId = sellerRow.id;
    let created = 0;
    const details: any[] = [];
    await neonQuery(async (sql) => {
      const checkouts = await sql`SELECT id, title, description, product_type, has_access, image_url, logo_url FROM checkouts WHERE tenant_id = ${tenantId}`;
      for (const chk of checkouts) {
        const existing = await sql`SELECT id FROM products WHERE checkout_id = ${chk.id} LIMIT 1`;
        if (existing.length > 0) { details.push({ checkoutId: chk.id, checkoutTitle: chk.title, status: 'já_tem_produto' }); continue; }
        const productId = `product_${Date.now()}_${nanoid(32)}`;
        await sql`INSERT INTO products (id, tenant_id, checkout_id, title, description, product_type, has_access, image_url, logo_url, active, created_at, updated_at) VALUES (${productId},${tenantId},${chk.id},${chk.title},${chk.description || `Área de membros do ${chk.title}`},${chk.product_type || 'digital'},${chk.has_access ?? true},${chk.image_url || ''},${chk.logo_url || ''},true,NOW(),NOW())`;
        if (chk.has_access ?? true) {
          const moduleId = `module_${Date.now()}_${nanoid(16)}`;
          await sql`INSERT INTO modules (id, product_id, tenant_id, title, description, position, active, auto_created, created_at, updated_at) VALUES (${moduleId},${productId},${tenantId},${chk.title},${`Área de membros do ${chk.title}`},0,true,true,NOW(),NOW())`;
          const lessonId = `lesson_${Date.now()}_${nanoid(16)}`;
          await sql`INSERT INTO lessons (id, module_id, product_id, tenant_id, title, description, content, position, duration, active, auto_created, created_at, updated_at) VALUES (${lessonId},${moduleId},${productId},${tenantId},${`Bem-vindo ao ${chk.title}`},'Conteúdo introdutório',${`<h1>Bem-vindo!</h1><p>Esta é sua área de membros do ${chk.title}.</p>`},0,0,true,true,NOW(),NOW())`;
        }
        created++;
        details.push({ checkoutId: chk.id, checkoutTitle: chk.title, productId, status: 'criado_com_sucesso' });
      }
    }, 'createMissingProducts');

    res.json({ success: true, seller: { email: sellerEmail, name: sellerRow.name, tenantId }, totalCheckouts: details.length, created, details });
    
  } catch (error: any) {
    console.error('❌ [CREATE-MISSING-PRODUCTS] Erro:', error);
    res.status(500).json({ error: error.message });
  }
});

adminRouter.post('/api/admin/setup-members-by-email', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerEmail } = req.body;
    
    if (!sellerEmail) {
      return res.status(400).json({ error: 'sellerEmail é obrigatório' });
    }
    
    // ⚠️ VERIFICAR SE É ADMIN
    const userUid = req.user?.uid;
    const isAdmin = await checkAdminAccess(userUid || '');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Apenas admins podem executar este comando' });
    }
    
    console.log(`👑 [ADMIN-SETUP] Buscando seller: ${sellerEmail}`);
    
    let setupSellerRow: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, name, email FROM sellers WHERE email = ${sellerEmail} LIMIT 1`;
      setupSellerRow = rows[0] || null;
    }, 'setupMembersByEmailFindSeller');
    if (!setupSellerRow) return res.status(404).json({ error: 'Seller não encontrado', email: sellerEmail });

    const tenantId = setupSellerRow.id;
    let processed = 0, created = 0;
    const errors: Array<{ productId: string; productTitle: string; error: string; }> = [];
    const details: Array<{ productId: string; productTitle: string; status: string; }> = [];

    await neonQuery(async (sql) => {
      const products = await sql`SELECT id, title, has_access FROM products WHERE tenant_id = ${tenantId} AND active = true`;
      processed = products.length;
      for (const p of products) {
        if (!(p.has_access ?? true)) { details.push({ productId: p.id, productTitle: p.title, status: 'skipped_no_access' }); continue; }
        const mods = await sql`SELECT id FROM modules WHERE product_id = ${p.id} LIMIT 1`;
        if (mods.length > 0) { details.push({ productId: p.id, productTitle: p.title, status: 'already_has_module' }); continue; }
        try {
          const moduleId = `module_${Date.now()}_${nanoid(16)}`;
          await sql`INSERT INTO modules (id, product_id, tenant_id, title, description, position, active, auto_created, auto_created_reason, created_at, updated_at) VALUES (${moduleId},${p.id},${tenantId},${p.title},${`Área de membros do ${p.title}`},0,true,true,'Setup admin automático',NOW(),NOW())`;
          const lessonId = `lesson_${Date.now()}_${nanoid(16)}`;
          await sql`INSERT INTO lessons (id, module_id, product_id, tenant_id, title, description, content, position, duration, active, auto_created, created_at, updated_at) VALUES (${lessonId},${moduleId},${p.id},${tenantId},${`Bem-vindo ao ${p.title}`},'Conteúdo introdutório - personalize conforme necessário',${`<h1>Bem-vindo!</h1><p>Esta é sua área de membros do ${p.title}.</p>`},0,0,true,true,NOW(),NOW())`;
          created++;
          details.push({ productId: p.id, productTitle: p.title, status: 'created' });
        } catch (e: any) {
          errors.push({ productId: p.id, productTitle: p.title, error: e.message });
          details.push({ productId: p.id, productTitle: p.title, status: `error: ${e.message}` });
        }
      }
    }, 'setupMembersByEmail');

    const result = {
      success: true,
      seller: { email: sellerEmail, name: setupSellerRow.name, tenantId },
      message: created > 0 ? `${created} área(s) de membros criada(s) com sucesso!` : 'Todos os produtos já possuem área de membros',
      processed, created, errors, details
    };
    res.json(result);
    
  } catch (error: any) {
    console.error('❌ [ADMIN-SETUP] Erro:', error);
    res.status(500).json({ 
      error: 'Erro ao executar setup',
      message: error.message 
    });
  }
});

adminRouter.post('/api/admin/force-update-pending-pix', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId necessário' });
    }
    
    console.log('🔥 FORÇANDO ATUALIZAÇÃO DE PIX PENDENTES:', { tenantId, adminUser: req.user?.email });
    
    const results: any[] = [];
    await neonQuery(async (sql) => {
      const pixOrders = await sql`SELECT id, customer, amount, method, created_at FROM orders WHERE tenant_id = ${tenantId} AND method = 'pix' AND status = 'pending'`;
      const now = Date.now();
      for (const o of pixOrders) {
        const minutesSinceCreation = (now - new Date(o.created_at).getTime()) / (1000 * 60);
        results.push({ orderId: o.id, customer: o.customer?.name, amount: o.amount / 100, minutesSinceCreation: Math.floor(minutesSinceCreation), action: minutesSinceCreation > 3 ? 'AGUARDANDO WEBHOOK REAL' : 'MUITO RECENTE - mantido pending' });
      }
    }, 'forceUpdatePendingPix');

    return res.json({ success: true, message: `Processados ${results.length} PIX pendentes`, results, adminEmail: req.user?.email });
    
  } catch (error) {
    console.error('❌ Erro ao forçar atualização PIX:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

adminRouter.post('/api/admin/register-efibank-webhook', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    let paymentConfigRow: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT config FROM payment_config ORDER BY updated_at DESC LIMIT 1`;
      paymentConfigRow = rows[0]?.config || null;
    }, 'registerWebhookGetConfig');
    const pixKey = paymentConfigRow?.efibank?.pixKey || process.env.EFIBANK_PIX_KEY;
    
    if (!pixKey) {
      return res.status(400).json({ 
        success: false,
        error: 'Chave PIX não configurada no Firebase nem em EFIBANK_PIX_KEY' 
      });
    }
    
    // 🌐 Usar domínio base (PRODUÇÃO ETERNA: volatuspay.com)
    const replitDomain = getBaseDomain();
    
    // 🔐 HMAC Hash OBRIGATÓRIO para validação skip-mTLS (conforme docs EfíBank)
    const webhookHmac = getSecret('EFIBANK_WEBHOOK_HMAC');
    
    if (!webhookHmac) {
      return res.status(400).json({ 
        success: false,
        error: 'EFIBANK_WEBHOOK_HMAC não configurado - necessário para webhook' 
      });
    }
    
    // URL com HMAC e ?ignorar= conforme documentação EfíBank
    const webhookUrl = `${replitDomain}/webhook/efi?hmac=${webhookHmac}&ignorar=`;
    
    console.log('📡 Registrando webhook EfíBank via admin:', {
      pixKey: `${pixKey.substring(0, 8)}...`,
      webhookUrl,
      adminEmail: req.user?.email
    });
    
    const success = await registerEfiBankWebhook(pixKey, webhookUrl);
    
    return res.json({
      success,
      message: 'Webhook registrado com sucesso!',
      webhookUrl,
      pixKey: `${pixKey.substring(0, 8)}...${pixKey.substring(pixKey.length - 8)}`,
      registeredBy: req.user?.email,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erro ao registrar webhook:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido' 
    });
  }
});

adminRouter.post('/api/admin/register-efibank-webhook-firebase', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📡 Registrando webhook EfíBank com chave do Firebase...');
    
    let wbConfig: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT config FROM payment_config ORDER BY updated_at DESC LIMIT 1`;
      wbConfig = rows[0]?.config || null;
    }, 'registerWebhookFirebaseGetConfig');
    const pixKey = wbConfig?.efibank?.pixKey;
    
    if (!pixKey) {
      return res.status(400).json({ 
        success: false,
        error: 'Chave PIX não configurada no Firebase. Configure em: Configurações de Pagamento → EfíBank → Chave PIX' 
      });
    }
    
    // 🌐 Usar domínio base (PRODUÇÃO ETERNA: volatuspay.com)
    const replitDomain = getBaseDomain();
    
    // 🔐 HMAC Hash OBRIGATÓRIO para validação skip-mTLS (conforme docs EfíBank)
    const webhookHmac = getSecret('EFIBANK_WEBHOOK_HMAC');
    
    if (!webhookHmac) {
      return res.status(400).json({ 
        success: false,
        error: 'EFIBANK_WEBHOOK_HMAC não configurado - necessário para webhook' 
      });
    }
    
    // URL com HMAC e ?ignorar= conforme documentação EfíBank
    const webhookUrl = `${replitDomain}/webhook/efi?hmac=${webhookHmac}&ignorar=`;
    
    console.log('📡 Registrando webhook EfíBank via Firebase config:', {
      pixKey: `${pixKey.substring(0, 8)}...`,
      webhookUrl: `${webhookUrl.split('?')[0]}?hmac=***&ignorar=`,
      adminEmail: req.user?.email
    });
    
    const success = await registerEfiBankWebhook(pixKey, webhookUrl);
    
    return res.json({
      success,
      message: success ? '✅ Webhook registrado com sucesso! Agora os PIX serão confirmados automaticamente.' : '⚠️ Webhook pode já estar registrado (isso é normal)',
      webhookUrl: `${webhookUrl.split('?')[0]}?hmac=***&ignorar=`,
      pixKey: `${pixKey.substring(0, 8)}...${pixKey.substring(pixKey.length - 8)}`,
      registeredBy: req.user?.email,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erro ao registrar webhook:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido' 
    });
  }
});

adminRouter.post('/api/admin/force-confirm-pix', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { txid, orderId } = req.body;
    
    if (!txid) {
      return res.status(400).json({ error: 'TxID necessário' });
    }
    
    console.log('🚨 CONFIRMAÇÃO MANUAL PIX EMERGÊNCIA:', { txid, orderId, adminUser: req.user?.email });
    
    // 🔒 AUDITORIA DE SEGURANÇA
    console.log(`🔒 ADMIN ${req.user?.email} confirmando PIX manualmente: ${orderId}`);
    
    try {
      let orderData: any = null;
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
        orderData = rows[0] || null;
      }, `forceConfirmPixCheck:${orderId}`);
      if (!orderData) return res.status(404).json({ error: 'Ordem não encontrada' });

      const currentStatus = orderData.status;
      const auditApproved = await auditedStatusChange(orderId, currentStatus, 'paid', 'admin_panel', 'admin_manual', {
        ip: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
        userAgent: req.headers['user-agent'],
        webhookId: `admin_${req.user?.uid}_${Date.now()}`,
        txid: txid,
        amount: orderData.amount || 0,
        paymentMethod: orderData.method || 'pix',
        additionalData: { adminUser: req.user?.email, adminUid: req.user?.uid, confirmationReason: 'Manual emergency confirmation by admin' }
      });
      if (!auditApproved) return res.status(403).json({ error: 'Confirmação manual bloqueada por auditoria' });

      const feeSnapshot = await calculateDynamicFees(orderData.amount, orderData.method || 'pix', orderData.installments || 1, orderData.gateway || 'efi');
      const releaseDate = new Date(Date.now() + (feeSnapshot.releaseDays || 0) * 24 * 60 * 60 * 1000);

      await neonQuery(async (sql) => {
        await sql`UPDATE orders SET status='paid', paid_at=NOW(), net_amount=${feeSnapshot.netAmount}, gateway_fee=${feeSnapshot.gatewayFee}, platform_fee=${feeSnapshot.platformFee}, financial_data=${JSON.stringify({ grossAmount: orderData.amount, feeAmount: feeSnapshot.gatewayFee + feeSnapshot.platformFee, netAmount: feeSnapshot.netAmount, releaseDate, released: false, feeBreakdown: { fixedFee: 0, percentFee: feeSnapshot.gatewayFeePercent, percentAmount: feeSnapshot.gatewayFee, platformFeePercent: feeSnapshot.platformFeePercent, platformFeeAmount: feeSnapshot.platformFee }, releaseDays: feeSnapshot.releaseDays || 0, paidAt: new Date() })}::jsonb, manual_confirmation=true, confirmed_by=${req.user?.email || 'admin_user'}, confirmed_at=NOW(), updated_at=NOW() WHERE id=${orderId}`;
      }, `forceConfirmPix:${orderId}`);

      if (orderData.tenant_id) {
        syncOrderAfterUpdate(orderData.tenant_id, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: orderData.method || 'pix', netAmount: feeSnapshot.netAmount, gatewayFee: feeSnapshot.gatewayFee });
        sendOrderStatusUpdate(orderData.tenant_id, orderId, 'paid', { paidAt: new Date() }).catch(err => console.warn('[UTMify] admin confirm PIX:', err?.message));
      }
      return res.json({ success: true, message: 'PIX confirmado manualmente' });
    } catch (neonError) {
      console.error('❌ Erro ao confirmar PIX:', neonError);
      return res.status(500).json({ error: 'Erro ao confirmar PIX' });
    }
    
  } catch (error) {
    console.error('❌ Erro na confirmação manual:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

adminRouter.post('/api/admin/mark-order-paid-by-email', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email obrigatório' });
    }
    
    console.log('💰 Marcando última venda pendente como paga:', { email, adminEmail: req.user?.email });
    
    let orderDataByEmail: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM orders WHERE customer->>'email' = ${email} AND status = 'pending' ORDER BY created_at DESC LIMIT 1`;
      orderDataByEmail = rows[0] || null;
    }, 'markOrderPaidByEmail');
    if (!orderDataByEmail) return res.status(404).json({ success: false, error: `Nenhuma ordem pendente encontrada para ${email}` });

    const orderId = orderDataByEmail.id;
    const feeSnapshot = await calculateDynamicFees(orderDataByEmail.amount, orderDataByEmail.method || 'pix', orderDataByEmail.installments || 1, orderDataByEmail.gateway || 'efi');
    const releaseDate = new Date(Date.now() + (feeSnapshot.releaseDays || 0) * 24 * 60 * 60 * 1000);

    await neonQuery(async (sql) => {
      await sql`UPDATE orders SET status='paid', paid_at=NOW(), net_amount=${feeSnapshot.netAmount}, gateway_fee=${feeSnapshot.gatewayFee}, platform_fee=${feeSnapshot.platformFee}, financial_data=${JSON.stringify({ grossAmount: orderDataByEmail.amount, feeAmount: feeSnapshot.gatewayFee + feeSnapshot.platformFee, netAmount: feeSnapshot.netAmount, releaseDate, released: false, feeBreakdown: { fixedFee: 0, percentFee: feeSnapshot.gatewayFeePercent, percentAmount: feeSnapshot.gatewayFee, platformFeePercent: feeSnapshot.platformFeePercent, platformFeeAmount: feeSnapshot.platformFee }, releaseDays: feeSnapshot.releaseDays || 0, paidAt: new Date() })}::jsonb, manual_confirmation=true, confirmed_by=${req.user?.email || 'admin_user'}, confirmed_at=NOW(), updated_at=NOW() WHERE id=${orderId}`;
    }, `markOrderPaidByEmailUpdate:${orderId}`);

    if (orderDataByEmail.tenant_id) {
      syncOrderAfterUpdate(orderDataByEmail.tenant_id, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: orderDataByEmail.method || 'pix', netAmount: feeSnapshot.netAmount, gatewayFee: feeSnapshot.gatewayFee });
      sendOrderStatusUpdate(orderDataByEmail.tenant_id, orderId, 'paid', { paidAt: new Date() }).catch(err => console.warn('[UTMify] admin confirm-by-email:', err?.message));
    }

    return res.json({ success: true, message: `✅ Venda de ${orderDataByEmail.customer?.name} marcada como paga!`, order: { id: orderId, customer: orderDataByEmail.customer, amount: orderDataByEmail.amount, status: 'paid' } });
    
  } catch (error) {
    console.error('❌ Erro ao marcar venda como paga:', error);
    return res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido' 
    });
  }
});

adminRouter.get('/api/admin/refunds', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    let refunds: any[] = [];
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT r.*, s.email as seller_email, p.title as product_name FROM refunds r LEFT JOIN sellers s ON s.id = r.seller_id LEFT JOIN products p ON p.id = r.product_id ORDER BY r.requested_at DESC LIMIT 100`;
      refunds = rows;
    }, 'adminListRefunds');
    res.json({ refunds });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao listar reembolsos' });
  }
});

adminRouter.post('/api/admin/refunds/:id/approve', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const adminUser = req.user;
    if (!adminUser) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const refundId = req.params.id;
    console.log(`👑 [ADMIN-APPROVE] Admin ${adminUser.email} aprovando reembolso:`, refundId);

    let refundData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM refunds WHERE id = ${refundId} LIMIT 1`;
      refundData = rows[0] || null;
    }, `approveRefundCheck:${refundId}`);
    if (!refundData) return res.status(404).json({ error: 'Reembolso não encontrado' });
    if (refundData.status !== 'pending') return res.status(400).json({ error: `Reembolso já está ${refundData.status}` });

    const sellerId = refundData.seller_id || refundData.tenant_id;
    const refundAmount = refundData.amount || 0;
    if (!refundAmount || refundAmount === 0) throw new Error('Valor de reembolso inválido. Não é possível processar.');

    let newBalance = 0;
    try {
      await neonQuery(async (sql) => {
        const sellerRows = await sql`SELECT withdrawal_balance FROM sellers WHERE id = ${sellerId} LIMIT 1`;
        const sellerBalance = sellerRows[0]?.withdrawal_balance || 0;
        newBalance = sellerBalance - refundAmount;
        await sql`UPDATE refunds SET status='approved', approved_at=NOW(), approved_by=${adminUser.uid}, updated_at=NOW() WHERE id=${refundId}`;
        await sql`UPDATE sellers SET withdrawal_balance=${newBalance}, updated_at=NOW() WHERE id=${sellerId}`;
      }, `approveRefund:${refundId}`);
    } catch (txError) {
      console.error('❌ [APPROVE-REFUND] Transaction failed:', txError);
      throw new Error('Erro ao processar débito. Tente novamente.');
    }


    // 🛡️ AUTO-BLOQUEIO: Verificar se seller excedeu limites após reembolso
    try {
      const autoBlockResult = await calculateSellerRefundRiskAndAutoBlock(sellerId);
      if (autoBlockResult.shouldBlock) {
        console.log(`🚫 [AUTO-BLOCK] Seller ${sellerId} BLOQUEADO automaticamente!`);
        console.log(`   Motivo: ${autoBlockResult.reason}`);
        console.log(`   Taxa de reembolso: ${autoBlockResult.refundPercentage.toFixed(2)}%`);
      }
    } catch (autoBlockError) {
      console.warn(`⚠️ [AUTO-BLOCK] Erro ao verificar auto-bloqueio (não crítico):`, autoBlockError);
    }
    res.json({
      success: true,
      message: 'Reembolso aprovado com sucesso',
      refund: { ...refundData, status: 'approved', approvedAt: new Date() },
      sellerNewBalance: newBalance
    });

  } catch (error) {
    console.error('❌ [APPROVE-REFUND] Erro:', error);
    res.status(500).json({ error: 'Erro ao aprovar reembolso' });
  }
});

adminRouter.post('/api/admin/refunds/:id/reject', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const adminUser = req.user;
    if (!adminUser) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const refundId = req.params.id;
    const { reason } = req.body;

    console.log(`👑 [ADMIN-REJECT] Admin ${adminUser.email} rejeitando reembolso:`, refundId);

    let rejectRefundData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM refunds WHERE id = ${refundId} LIMIT 1`;
      rejectRefundData = rows[0] || null;
    }, `rejectRefundCheck:${refundId}`);
    if (!rejectRefundData) return res.status(404).json({ error: 'Reembolso não encontrado' });
    if (rejectRefundData.status !== 'pending') return res.status(400).json({ error: `Reembolso já está ${rejectRefundData.status}` });

    await neonQuery(async (sql) => {
      await sql`UPDATE refunds SET status='rejected', rejected_at=NOW(), rejected_by=${adminUser.uid}, rejected_by_email=${adminUser.email}, rejection_reason=${reason || 'Sem motivo informado'}, updated_at=NOW() WHERE id=${refundId}`;
      if (rejectRefundData.product_id && rejectRefundData.customer_email) {
        await sql`UPDATE enrollments SET status='active', updated_at=NOW() WHERE product_id=${rejectRefundData.product_id} AND customer_email=${rejectRefundData.customer_email} LIMIT 1`;
      }
    }, `rejectRefund:${refundId}`);

    res.json({ success: true, message: 'Reembolso rejeitado com sucesso', refund: { ...rejectRefundData, status: 'rejected', rejectedAt: new Date() } });

  } catch (error) {
    console.error('❌ [REJECT-REFUND] Erro:', error);
    res.status(500).json({ error: 'Erro ao rejeitar reembolso' });
  }
});

adminRouter.post('/api/admin/approve-pix-payment', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId é obrigatório' });
    }
    
    console.log(`💰 ADMIN: Aprovando PIX manualmente para order: ${orderId}`);
    
    let approveOrderData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
      approveOrderData = rows[0] || null;
    }, `approvePixCheck:${orderId}`);
    if (!approveOrderData) return res.status(404).json({ error: 'Ordem não encontrada' });
    if (approveOrderData.status === 'paid') return res.status(400).json({ error: 'Ordem já está paga' });
    if (approveOrderData.method !== 'pix') return res.status(400).json({ error: 'Ordem não é PIX' });

    const method = approveOrderData.method || 'pix';
    const gateway = approveOrderData.gateway || 'efibank';
    const withdrawalDays = await getWithdrawalDays(method, gateway);
    let feeCalc: any = {};
    if (!approveOrderData.gateway_fee) {
      feeCalc = await calculateDynamicFees(approveOrderData.amount, method, 1, gateway);
    }
    const netAmount = feeCalc.netAmount || approveOrderData.net_amount || 0;
    const gatewayFee = feeCalc.gatewayFee || approveOrderData.gateway_fee || 0;
    const platformFee = feeCalc.platformFee || approveOrderData.platform_fee || 0;

    await neonQuery(async (sql) => {
      await sql`UPDATE orders SET status='paid', paid_at=NOW(), updated_at=NOW(), withdrawal_days=${withdrawalDays}, manually_approved=true, manually_approved_by=${req.user?.uid}, manually_approved_at=NOW(), net_amount=${netAmount}, gateway_fee=${gatewayFee}, platform_fee=${platformFee} WHERE id=${orderId}`;
    }, `approvePix:${orderId}`);

    const tenantId = approveOrderData.tenant_id || approveOrderData.seller_id;
    syncOrderAfterUpdate(tenantId, orderId, { status: 'paid', paidAt: new Date().toISOString(), method, netAmount, gatewayFee });
    sendOrderStatusUpdate(tenantId, orderId, 'paid', { paidAt: new Date() }).catch(err => console.warn('[UTMify] PIX approval:', err?.message));

    if (approveOrderData.product_type === 'digital' || approveOrderData.product_type === 'subscription') {
      await storage.createEnrollmentOnPayment({ ...approveOrderData, id: orderId, paidAt: new Date() });
    }
    if (approveOrderData.affiliate_code) {
      await storage.processAffiliateCommission({ ...approveOrderData, id: orderId });
    }

    return res.json({ success: true, message: 'PIX aprovado com sucesso', order: { id: orderId, customer: approveOrderData.customer?.name, amount: approveOrderData.amount / 100, status: 'paid' } });
    
  } catch (error) {
    console.error('❌ Erro ao aprovar PIX:', error);
    return res.status(500).json({ error: 'Erro ao aprovar PIX' });
  }
});

adminRouter.post('/api/admin/batch-verify-pending-pix', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔄 BATCH VERIFY: Buscando ordens PIX pendentes com txid...');
    
    const results: any[] = [];
    let approved = 0, stillPending = 0, errors = 0, total = 0;

    await neonQuery(async (sql) => {
      const pendingOrders = await sql`SELECT * FROM orders WHERE status='pending' AND method='pix'`;
      total = pendingOrders.length;
      for (const orderData of pendingOrders) {
        const orderId = orderData.id;
        if (!orderData.txid) { results.push({ orderId, status: 'skipped', reason: 'sem txid' }); continue; }
        try {
          const pixStatus = await verificarPixNaApi(orderData.txid);
          const pixPaid = pixStatus.valido && (pixStatus.dados?.status?.toLowerCase() === 'concluida' || pixStatus.dados?.status?.toLowerCase() === 'completed');
          const hasPagamento = pixStatus.dados?.pix && Array.isArray(pixStatus.dados.pix) && pixStatus.dados.pix.length > 0;
          if (pixPaid || hasPagamento) {
            const feeCalc2 = await calculateDynamicFees(orderData.amount, 'pix', 1, 'efibank');
            await sql`UPDATE orders SET status='paid', paid_at=NOW(), updated_at=NOW(), confirmed_via='admin_batch_verify', manually_approved=true, manually_approved_by=${req.user?.uid}, net_amount=${feeCalc2.netAmount}, gateway_fee=${feeCalc2.gatewayFee}, platform_fee=${feeCalc2.platformFee} WHERE id=${orderId}`;
            const tid = orderData.tenant_id || orderData.seller_id;
            syncOrderAfterUpdate(tid, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: 'pix', netAmount: feeCalc2.netAmount, gatewayFee: feeCalc2.gatewayFee });
            sendOrderStatusUpdate(tid, orderId, 'paid', { paidAt: new Date() }).catch(() => {});
            try { await dispatchPixPaidEvent(tid, { id: orderId, ...orderData, paidAt: new Date() }); } catch {}
            if (orderData.product_type === 'digital' || orderData.product_type === 'subscription') { try { await storage.createEnrollmentOnPayment({ ...orderData, id: orderId, paidAt: new Date() }); } catch {} }
            if (orderData.affiliate_code || orderData.affiliate_uid) { try { await storage.processAffiliateCommission({ ...orderData, id: orderId }); } catch {} }
            approved++;
            results.push({ orderId, status: 'approved', customer: orderData.customer?.name, amount: orderData.amount / 100 });
          } else {
            stillPending++;
            results.push({ orderId, status: 'still_pending', efiStatus: pixStatus.dados?.status || 'unknown' });
          }
        } catch (verifyErr: any) {
          errors++;
          results.push({ orderId, status: 'error', message: verifyErr?.message });
        }
      }
    }, 'batchVerifyPendingPix');

    return res.json({ success: true, total, approved, stillPending, errors, results });
    
  } catch (error: any) {
    console.error('❌ Erro no batch verify:', error);
    return res.status(500).json({ error: 'Erro no batch verify', details: error?.message });
  }
});

adminRouter.post('/api/admin/force-confirm-by-email', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { email, reason } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email necessário' });
    }
    
    console.log('🚨 HANDLER v3 - CONFIRMAÇÃO MANUAL POR EMAIL (ADMIN PROTEGIDO):', { email, reason });
    
    // Verificar se é admin
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    let v3OrderData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM orders WHERE customer->>'email' = ${email} AND status = 'pending' ORDER BY created_at DESC LIMIT 1`;
      v3OrderData = rows[0] || null;
    }, 'forceConfirmV3FindOrder');
    if (!v3OrderData) return res.status(404).json({ error: 'Nenhuma venda pendente encontrada para este email' });

    const orderId = v3OrderData.id;
    await neonQuery(async (sql) => {
      await sql`UPDATE orders SET status='paid', paid_at=NOW(), manual_confirmation=true, confirmed_by='admin_emergency', confirmed_at=NOW(), updated_at=NOW() WHERE id=${orderId}`;
      if (v3OrderData.checkout_snapshot?.product?.hasAccess) {
        const enrollmentId = `enrollment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await sql`INSERT INTO enrollments (id, tenant_id, product_id, customer_id, customer_name, customer_email, order_id, status, enrolled_at, created_at, updated_at) VALUES (${enrollmentId},${v3OrderData.tenant_id},${v3OrderData.checkout_snapshot.product.id},${v3OrderData.customer?.email},${v3OrderData.customer?.name},${v3OrderData.customer?.email},${orderId},'active',NOW(),NOW(),NOW()) ON CONFLICT DO NOTHING`;
      }
    }, `forceConfirmV3:${orderId}`);

    if (v3OrderData.tenant_id) {
      syncOrderAfterUpdate(v3OrderData.tenant_id, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: v3OrderData.method || 'pix' });
      sendOrderStatusUpdate(v3OrderData.tenant_id, orderId, 'paid', { paidAt: new Date() }).catch(() => {});
    }

    return res.json({ success: true, message: 'Venda confirmada manualmente com sucesso!', orderId, customerEmail: email, amount: v3OrderData.amount, method: v3OrderData.method, confirmedAt: new Date().toISOString() });
    
  } catch (error) {
    console.error('❌ Erro na confirmação manual por email:', error);
    return res.status(500).json({ 
      error: 'Erro interno',
      message: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
});

adminRouter.post('/api/admin/confirm-pending-pix', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('💰 ADMIN - Iniciando confirmação manual de PIX pendentes...');
    
    let confirmedCount = 0;
    const results: any[] = [];
    await neonQuery(async (sql) => {
      const pixOrders = await sql`SELECT * FROM orders WHERE status='pending' AND method='pix'`;
      for (const orderData of pixOrders) {
        const orderId = orderData.id;
        if (orderData.efi_txid) {
          try {
            await sql`UPDATE orders SET status='paid', paid_at=NOW(), confirmed_by='admin-manual', confirmed_at=NOW(), updated_at=NOW() WHERE id=${orderId}`;
            const tid = orderData.tenant_id || orderData.seller_id;
            syncOrderAfterUpdate(tid, orderId, { status: 'paid', paidAt: new Date().toISOString(), method: orderData.method || 'pix' });
            sendOrderStatusUpdate(tid, orderId, 'paid', { paidAt: new Date() }).catch(() => {});
            confirmedCount++;
            results.push({ orderId, customer: orderData.customer, amount: orderData.amount, txid: orderData.efi_txid, status: 'confirmed-manually' });
          } catch (e: any) {
            results.push({ orderId, customer: orderData.customer, amount: orderData.amount, status: 'error', error: e.message });
          }
        } else {
          results.push({ orderId, customer: orderData.customer, amount: orderData.amount, status: 'no-txid' });
        }
      }
    }, 'confirmPendingPix');

    res.json({ success: true, message: `${confirmedCount} PIX confirmados manualmente`, confirmed: confirmedCount, total: results.length, results });
    
  } catch (error: any) {
    console.error('❌ Erro na confirmação manual de PIX:', error);
    res.status(500).json({
      error: 'Erro na confirmação manual',
      message: error.message
    });
  }
});

adminRouter.post('/api/admin/stripe-config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { publicKey, secretKey } = req.body;
    
    console.log('🔍 DEBUG STRIPE CONFIG - Recebido:', {
      publicKeyPrefix: publicKey?.substring(0, 10),
      secretKeyPrefix: secretKey?.substring(0, 10),
      publicKeyLen: publicKey?.length,
      secretKeyLen: secretKey?.length
    });
    
    if (!publicKey || !secretKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'Chaves públicas e secretas são obrigatórias' 
      });
    }
    
    // 🔥 VALIDAÇÃO MAIS RIGOROSA - Rejeitar se parecer webhook secret ou estiver trocado
    if (publicKey.startsWith('whsec_') || publicKey.startsWith('sk_')) {
      return res.status(400).json({ 
        success: false, 
        message: '❌ ERRO: Chave pública NÃO pode ser webhook secret (whsec_) ou chave secreta (sk_)! Use a chave que começa com "pk_"' 
      });
    }
    
    if (secretKey.startsWith('pk_') || secretKey.startsWith('whsec_')) {
      return res.status(400).json({ 
        success: false, 
        message: '❌ ERRO: Chave secreta deve começar com "sk_", não "pk_" ou "whsec_"! Verifique se não estão trocadas.' 
      });
    }
    
    if (!publicKey.startsWith('pk_')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Chave pública deve começar com "pk_" (ex: pk_live_... ou pk_test_...)' 
      });
    }
    
    if (!secretKey.startsWith('sk_')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Chave secreta deve começar com "sk_" (ex: sk_live_... ou sk_test_...)' 
      });
    }
    
    // Determinar environment
    const environment = secretKey.includes('_live_') ? 'production' : 'sandbox';
    
    // Criptografar secretKey
    const encryptedSecretKey = encryptSensitiveData(secretKey);
    
    if (!encryptedSecretKey || encryptedSecretKey === 'ENCRYPTION_ERROR') {
      return res.status(500).json({ 
        success: false, 
        message: 'Erro ao criptografar chave secreta' 
      });
    }
    
    await neonQuery(async (sql) => {
      await sql`INSERT INTO payment_config (id, config, updated_at) VALUES ('stripe', jsonb_build_object('publicKey',${publicKey}::text,'secretKey',${encryptedSecretKey}::text,'environment',${environment}::text), NOW()) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`;
    }, 'saveStripeConfig');
    stripeConfigCache = null;
    
    console.log(`✅ Configuração Stripe salva e verificada: ${environment}`);
    console.log(`🔍 PublicKey salva (primeiro 10 chars): ${publicKey.substring(0, 10)}`);
    
    return res.json({ 
      success: true, 
      message: 'Configuração Stripe salva com sucesso! ✅',
      environment
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao salvar configuração Stripe:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Erro ao salvar configuração' 
    });
  }
});

adminRouter.delete('/api/admin/stripe-config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    await neonQuery(async (sql) => {
      await sql`DELETE FROM payment_config WHERE id = 'stripe'`;
    }, 'deleteStripeConfig');
    stripeConfigCache = null;
    
    console.log('🗑️ Configuração Stripe deletada');
    
    return res.json({ 
      success: true, 
      message: 'Configuração Stripe deletada com sucesso! Você pode agora salvar novas chaves.' 
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar configuração Stripe:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Erro ao deletar configuração' 
    });
  }
});

adminRouter.get('/api/admin/stripe-config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const stripeConfig = await loadSecureStripeConfig();
    
    if (stripeConfig) {
      return res.json({
        success: true,
        publicKey: stripeConfig.publicKey,
        environment: stripeConfig.environment,
        // NÃO retornar secretKey por segurança
      });
    }
    
    return res.json({
      success: false,
      message: 'Configuração Stripe não encontrada'
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração Stripe:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Erro ao buscar configuração' 
    });
  }
});

adminRouter.get('/api/admin/acquirers-config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🏦 GET - Buscando configurações de adquirentes...');
    
    // ⚙️ CONFIGURAÇÃO REAL ATUALIZADA - Sincronizada com sistema
    const defaultConfig = {
      efibank: {
        enabled: true,
        pixFeePercent: 2,
        pixFeeFixed: 2.49,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 8.2,
        installment10to12x: 9.2,
        withdrawalDays: 20,
        withdrawalDays1x: 20,
        withdrawalDays2to6x: 25,
        withdrawalDays7to9x: 30,
        withdrawalDays10to12x: 30
      },
      stripe: {
        enabled: true,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 7.2,
        installment10to12x: 8.2,
        withdrawalDays: 30
      },
      adyen: {
        enabled: false,
        cardFeePercent: 4.8,
        cardFeeFixed: 2.49,
        installment1x: 4.8,
        installment2to6x: 5.8,
        installment7to9x: 6.8,
        installment10to12x: 7.8,
        withdrawalDays: 7
      },
      lastUpdated: new Date(),
      updatedBy: 'system'
    };
    
    try {
      let acquirerConfig: any = null;
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT config FROM payment_config WHERE id = 'acquirers' LIMIT 1`;
        acquirerConfig = rows[0]?.config || null;
      }, 'getAcquirersConfig');
      if (acquirerConfig) {
        res.json({ success: true, config: acquirerConfig });
      } else {
        res.json({ success: true, config: defaultConfig });
      }
    } catch (dbError) {
      console.log('🏦 Erro no banco, retornando padrão:', dbError);
      res.json({ success: true, config: defaultConfig });
    }
  } catch (error) {
    console.error('❌ Erro geral:', error);
    // ⚙️ SEMPRE RETORNA CONFIG REAL ATUALIZADA EM CASO DE ERRO
    res.json({ success: true, config: {
      efibank: {
        enabled: true,
        pixFeePercent: 2,
        pixFeeFixed: 2.49,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 8.2,
        installment10to12x: 9.2,
        withdrawalDays: 20,
        withdrawalDays1x: 20,
        withdrawalDays2to6x: 25,
        withdrawalDays7to9x: 30,
        withdrawalDays10to12x: 30
      },
      stripe: {
        enabled: true,
        cardFeePercent: 5.2,
        cardFeeFixed: 2.49,
        installment1x: 5.2,
        installment2to6x: 6.2,
        installment7to9x: 7.2,
        installment10to12x: 8.2,
        withdrawalDays: 30
      },
      adyen: {
        enabled: false,
        cardFeePercent: 4.8,
        cardFeeFixed: 2.49,
        installment1x: 4.8,
        installment2to6x: 5.8,
        installment7to9x: 6.8,
        installment10to12x: 7.8,
        withdrawalDays: 7
      },
      environment: 'production',
      updatedBy: 'system',
      version: '1.0.0'
    }});
  }
});

adminRouter.post('/api/admin/support-ticket-create', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎫 ✅ SUPORTE DIRETO - Criando ticket...');
    console.log('🎫 Criando ticket de suporte');
    
    const { tenantId, sellerId, sellerName, sellerEmail, category, subject, description, priority } = req.body;

    // Validações básicas
    if (!tenantId || !sellerId || !sellerName || !sellerEmail || !category || !subject || !description) {
      return res.status(400).json({
        error: 'Campos obrigatórios: tenantId, sellerId, sellerName, sellerEmail, category, subject, description'
      });
    }

    // 🎫 GERAÇÃO DE ID ÚNICO REAL NO FORMATO SOLICITADO (NUNCA DUPLICA)
    const uniqueCode = Math.random().toString(36).substr(2, 8) + 'x' + Date.now().toString().slice(-4);
    const ticketId = `ticket#${Date.now().toString().slice(-6)}${uniqueCode}`;
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    
    // 🛡️ TICKET SEGURO - Apenas campos definidos
    const ticket = {
      id: ticketId,
      tenantId: tenantId,
      sellerId: sellerId,
      sellerName: sellerName,
      sellerEmail: sellerEmail,
      category: category,
      subject: subject,
      description: description,
      status: 'open',
      priority: priority || 'normal',
      totalMessages: 1,
      unreadByAdmin: 1,
      unreadBySeller: 0,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    
    // 🛡️ MENSAGEM INICIAL SEGURA 
    const initialMessage = {
      id: messageId,
      ticketId: ticketId,
      senderId: sellerId,
      senderType: "seller",
      senderName: sellerName,
      content: description,
      messageType: "text",
      isSystemMessage: false,
      readByAdmin: false,
      readBySeller: true,
      createdAt: now,
      updatedAt: now,
    };
    
    console.log('🎫 Criando ticket com mensagem inicial:', { ticket, initialMessage });
    
    await neonQuery(async (sql) => {
      await sql`INSERT INTO support_tickets (id, tenant_id, seller_id, seller_name, seller_email, category, subject, description, status, priority, total_messages, unread_by_admin, unread_by_seller, last_message_at, created_at, updated_at) VALUES (${ticketId},${tenantId},${sellerId},${sellerName},${sellerEmail},${category},${subject},${description},'open',${priority || 'normal'},1,1,0,${now},${now},${now}) ON CONFLICT (id) DO NOTHING`;
      await sql`INSERT INTO support_messages (id, ticket_id, sender_id, sender_type, sender_name, content, message_type, is_system_message, read_by_admin, read_by_seller, created_at, updated_at) VALUES (${messageId},${ticketId},${sellerId},'seller',${sellerName},${description},'text',false,false,true,${now},${now}) ON CONFLICT (id) DO NOTHING`;
    }, `createSupportTicket:${ticketId}`);

    res.json({ success: true, ticketId, message: `Ticket ${ticketId} criado com sucesso!` });
    
  } catch (error: any) {
    console.error('❌ ERRO DETALHADO ao criar ticket via ROTA DIRETA:', {
      error: error,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Falha ao criar ticket de suporte',
      message: error.message
    });
  }
});

adminRouter.get('/api/admin/firebase-debug', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔍 ADMIN: Diagnóstico Firebase solicitado por:', req.user?.email);
    
    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      firebaseStatus: {
        initialized: false,
        canAccessFirestore: false,
        sellersCount: 0,
        ordersCount: 0
      },
      secretsAvailable: {
        FIREBASE_SERVICE_ACCOUNT_JSON: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
        FIREBASE_SERVICE_ACCOUNT_JSON_B64: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64,
        FIREBASE_ADMIN_PROJECT_ID: !!process.env.FIREBASE_ADMIN_PROJECT_ID,
        FIREBASE_ADMIN_CLIENT_EMAIL: !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        FIREBASE_ADMIN_PRIVATE_KEY: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
        FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY
      }
    };
    
    try {
      diagnostics.firebaseStatus.initialized = true;
      await neonQuery(async (sql) => {
        const sc = await sql`SELECT COUNT(*) as cnt FROM sellers`;
        const oc = await sql`SELECT COUNT(*) as cnt FROM orders`;
        diagnostics.firebaseStatus.canAccessFirestore = true;
        diagnostics.firebaseStatus.sellersCount = parseInt(sc[0]?.cnt || '0');
        diagnostics.firebaseStatus.ordersCount = parseInt(oc[0]?.cnt || '0');
      }, 'firebaseDebug');
    } catch (firebaseError: any) {
      diagnostics.firebaseError = { message: firebaseError.message, code: 'NEON_ERROR' };
    }
    
    return res.json({
      success: true,
      diagnostics
    });
    
  } catch (error: any) {
    console.error('❌ Erro no diagnóstico Firebase:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

function normalizeTimestamps(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined) return obj;
  if (obj?.toDate && typeof obj.toDate === 'function') return obj.toDate().toISOString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(item => normalizeTimestamps(item, seen));
  if (typeof obj === 'object') {
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = normalizeTimestamps(obj[key], seen);
    }
    return result;
  }
  return obj;
}

adminRouter.get('/api/admin/orders', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('💳 GET - Admin buscando todas as orders...');

    // 📅 FILTROS OPCIONAIS + PAGINAÇÃO CURSOR COMPLETA
    const { startDate, endDate, status, sellerId, limit: queryLimit, lastDocId, lastCreatedAt } = req.query;
    
    // ✅ VALIDAR PARÂMETROS (prevenir DoS e erros)
    let pageLimit = 200; // Default reduzido para dashboards típicos
    if (queryLimit) {
      const parsed = parseInt(queryLimit as string);
      if (isNaN(parsed) || parsed < 1 || parsed > 500) {
        return res.status(400).json({
          success: false,
          error: 'Parâmetro limit inválido (deve ser entre 1 e 500)',
          code: 'INVALID_LIMIT'
        });
      }
      pageLimit = parsed;
    }
    
    // Validar cursor de paginação (ambos ou nenhum)
    if ((lastDocId && !lastCreatedAt) || (!lastDocId && lastCreatedAt)) {
      return res.status(400).json({
        success: false,
        error: 'lastDocId e lastCreatedAt devem ser fornecidos juntos para paginação',
        code: 'INVALID_CURSOR'
      });
    }
    
    // Validar datas
    if (startDate || endDate) {
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate e endDate devem ser fornecidos juntos',
          code: 'INVALID_DATE_RANGE'
        });
      }
      const startMs = parseInt(startDate as string);
      const endMs = parseInt(endDate as string);
      if (isNaN(startMs) || isNaN(endMs) || startMs > endMs) {
        return res.status(400).json({
          success: false,
          error: 'Datas inválidas ou startDate > endDate',
          code: 'INVALID_DATES'
        });
      }
    }
    
    console.log('🔍 Filtros de orders:', { startDate, endDate, status, sellerId, limit: pageLimit, lastDocId });

    let filteredOrders: any[] = [];
    let hasMore = false;
    let nextCursor = null;
    
    await neonQuery(async (sql) => {
      const conditions: string[] = [];
      const params: any[] = [];
      let p = 1;

      if (startDate && endDate) {
        conditions.push(`created_at >= to_timestamp($${p++}/1000.0) AND created_at <= to_timestamp($${p++}/1000.0)`);
        params.push(parseInt(startDate as string), parseInt(endDate as string));
      }
      if (status && status !== 'all') {
        conditions.push(`status = $${p++}`);
        params.push(status);
      }
      if (sellerId) {
        conditions.push(`(seller_id = $${p++} OR tenant_id = $${p++})`);
        params.push(sellerId, sellerId);
      }
      if (lastDocId && lastCreatedAt) {
        conditions.push(`(created_at < to_timestamp($${p++}/1000.0) OR (created_at = to_timestamp($${p++}/1000.0) AND id < $${p++}))`);
        params.push(parseInt(lastCreatedAt as string), parseInt(lastCreatedAt as string), lastDocId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const queryStr = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${p}`;
      params.push(pageLimit + 1);

      const rows = await sql.unsafe(queryStr, params);

      if (rows.length > pageLimit) {
        hasMore = true;
        rows.pop();
      }
      const lastO = rows[rows.length - 1];
      if (lastO) nextCursor = { lastDocId: lastO.id, lastCreatedAt: lastO.created_at ? new Date(lastO.created_at).getTime() : null };
      filteredOrders = rows;
    }, 'adminGetOrders');

    // Formatar dados para o admin + normalizar timestamps recursivamente
    const formattedOrders = filteredOrders.map((order: any) => {
      const formatted = {
        id: order.id,
        orderId: order.id,
        sellerId: order.seller_id || order.tenant_id,
        tenantId: order.tenant_id,
        checkoutId: order.checkout_id,
        productId: order.product_id,
        productType: order.product_type || null,
        amount: order.amount || 0,
        currency: order.currency || 'BRL',
        status: order.status || 'pending',
        method: order.method || 'unknown',
        processor: order.gateway || 'volatuspay',
        paymentMethod: order.method || 'unknown',
        gateway: order.gateway || 'volatuspay',
        platformFee: order.platform_fee || 0,
        gatewayFee: order.gateway_fee || 0,
        sellerDeduction: order.seller_deduction || 0,
        netAmount: order.net_amount || 0,
        sellerNetAmount: order.seller_net_amount || 0,
        netProfit: order.net_profit || 0,
        customerName: order.customer?.name || 'Cliente',
        customerEmail: order.customer?.email || 'N/A',
        customerPhone: order.customer?.phone || null,
        customerDocument: order.customer?.document || null,
        customer: order.customer || null,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        paidAt: order.paid_at || null,
        transactionId: order.transaction_id || null,
        stripePaymentIntentId: order.stripe_payment_intent_id || null,
        pixQrCode: order.pix_qr_code || null,
        pixCopiaECola: order.pix_copia_e_cola || null,
        affiliateId: order.affiliate_uid || null,
        affiliateCommission: order.affiliate_commission || null,
        affiliateName: order.affiliate_name || null,
        affiliateEmail: order.affiliate_email || null,
        affiliateCode: order.affiliate_code || null,
        affiliateUid: order.affiliate_uid || null,
        isAffiliateSale: order.is_affiliate_sale || false,
        items: order.items || [],
        refunds: order.refunds || [],
        metadata: order.metadata || null
      };
      return normalizeTimestamps(formatted);
    });

    console.log(`✅ Retornando ${formattedOrders.length} orders formatadas para admin`);
    
    res.json({
      success: true,
      orders: formattedOrders,
      data: formattedOrders,  // Compatibilidade com código antigo
      total: formattedOrders.length,
      // 📄 METADADOS DE PAGINAÇÃO OTIMIZADOS
      pagination: {
        limit: pageLimit,
        hasMore: hasMore,
        nextCursor: nextCursor,  // Cursor completo para próxima página
        count: formattedOrders.length
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar orders para admin:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      message: error.message,
      code: 'GET_ORDERS_ERROR'
    });
  }
});

adminRouter.get('/api/admin/products', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📦 GET - Admin buscando todos os produtos...');
    
    // Buscar todos os produtos no Neon
    const products = await storage.getAllProducts({ force: true });
    
    console.log(`📦 Produtos encontrados no Firebase: ${products.length}`);
    
    // Formatar dados para o admin
    const formattedProducts = products.map((product: any) => ({
      id: product.id,
      tenantId: product.tenantId,
      title: product.title || 'Produto sem título',
      subtitle: product.subtitle || product.description || '',
      description: product.description || '',
      price: product.price || product.pricing?.amount || 0,
      currency: product.currency || 'BRL',
      active: product.active !== undefined ? product.active : true,
      productType: product.productType || 'digital',
      imageUrl: product.imageUrl || product.logoUrl || null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      // Campo crítico para admin: checkoutId
      checkoutId: product.checkoutId || product.checkout_id || null,
      // Dados adicionais do produto
      guaranteeDays: product.guaranteeDays || 7,
      slug: product.slug || null,
      testMode: product.testMode || false,
      // Estatísticas
      totalSales: product.totalSales || 0,
      totalRevenue: product.totalRevenue || 0,
      // Dados de afiliados
      affiliate: product.affiliate || null,
      // Campo para ocultar da vitrine
      adminHidden: product.adminHidden || false
    }));

    console.log(`✅ Retornando ${formattedProducts.length} produtos formatados para admin`);
    
    res.json(formattedProducts);

  } catch (error: any) {
    console.error('❌ Erro ao buscar produtos para admin:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message,
      code: 'GET_PRODUCTS_ERROR'
    });
  }
});

adminRouter.post('/api/admin/acquirers-config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🏦 POST - Salvando configurações de adquirentes...');
    
    // 🔐 VERIFICAR AUTENTICAÇÃO E PERMISSÕES DE ADMIN (CRÍTICO PARA SALVAMENTO)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Token de autenticação requerido',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    
    try {
      const admin = (await import('firebase-admin')).default;
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (authError) {
      return res.status(401).json({
        error: 'Token de autenticação inválido',
        code: 'INVALID_TOKEN'
      });
    }

    // 🔒 VERIFICAR PERMISSÕES DE ADMIN (VIA CUSTOM CLAIMS)
    const isAdmin = req.authUser?.isAdmin;
    if (!isAdmin) {
      return res.status(403).json({
        error: 'Acesso negado - permissões insuficientes',
        code: 'ACCESS_DENIED'
      });
    }
    
    console.log('✅ Admin autenticado:', decodedToken.email || decodedToken.uid);
    console.log('📋 Configuração recebida (dados sensíveis mascarados):', {
      acquirerCount: Object.keys(req.body || {}).length,
      timestamp: new Date().toISOString()
    });
    
    // 🛡️ VALIDAÇÃO DE TAXA MÍNIMA WOOVI (R$ 0,80 FIXO)
    if (req.body.woovi && req.body.woovi.pixFeeFixed !== undefined) {
      const MIN_WOOVI_FEE = 80; // R$ 0,80 em centavos
      const wooviPixFee = parseFloat(req.body.woovi.pixFeeFixed);
      
      if (wooviPixFee < MIN_WOOVI_FEE) {
        console.error(`❌ TAXA WOOVI BLOQUEADA: R$ ${(wooviPixFee/100).toFixed(2)} (mínimo: R$ ${(MIN_WOOVI_FEE/100).toFixed(2)})`);
        return res.status(400).json({
          error: 'Taxa Woovi PIX abaixo do mínimo permitido',
          message: `Taxa mínima Woovi: R$ ${(MIN_WOOVI_FEE/100).toFixed(2)}. Valor recebido: R$ ${(wooviPixFee/100).toFixed(2)}`,
          code: 'WOOVI_FEE_TOO_LOW',
          minFee: MIN_WOOVI_FEE,
          receivedFee: wooviPixFee
        });
      }
      
      console.log(`✅ Taxa Woovi validada: R$ ${(wooviPixFee/100).toFixed(2)} (mínimo R$ ${(MIN_WOOVI_FEE/100).toFixed(2)} OK)`);
    }
    
    // 🔥 PREPARAR DADOS COM TIMESTAMP FORÇADO E VALIDAÇÃO
    const configData = {
      ...req.body,
      lastUpdated: new Date(),
      updatedBy: 'admin',
      savedAt: new Date().toISOString(),
      version: '1.0.0',
      environment: 'production'
    };
    
    console.log('💾 SALVANDO NO FIREBASE ETERNO - Estrutura completa:', JSON.stringify(configData, null, 2));
    console.log('💾 SALVANDO NO FIREBASE ETERNO - Estrutura validada:', {
      version: configData.version,
      savedAt: configData.savedAt,
      hasAcquirers: Object.keys(configData).filter(k => !['lastUpdated', 'updatedBy', 'savedAt', 'version', 'environment'].includes(k)).length > 0,
      acquirers: Object.keys(configData).filter(k => !['lastUpdated', 'updatedBy', 'savedAt', 'version', 'environment'].includes(k))
    });
    
    await neonQuery(async (sql) => {
      await sql`INSERT INTO payment_config (id, config, updated_at) VALUES ('acquirers', ${configData as any}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`;
    }, 'saveAcquirersConfig');
    console.log('✅ Acquirer config salvo no Neon.');

    if (req.body.defaultAcquirers || req.body.efibank) {
      await neonQuery(async (sql) => {
        const existing = await sql`SELECT config FROM payment_config WHERE id = 'global' LIMIT 1`;
        const currentCfg = existing[0]?.config || {};
        const merged = { ...currentCfg, ...(req.body.defaultAcquirers ? { defaultAcquirers: req.body.defaultAcquirers } : {}), ...(req.body.efibank ? { efibank: { ...(currentCfg.efibank || {}), ...req.body.efibank } } : {}) };
        await sql`INSERT INTO payment_config (id, config, updated_at) VALUES ('global', ${merged as any}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`;
      }, 'syncPaymentConfigGlobal');
    }

    const totalUpdated = 0;
    try {
      console.log(`✅ ${totalUpdated} sellers configurados para usar taxas globais!`);
    } catch (sellersError) {
      console.warn('⚠️ Erro ao atualizar sellers (não crítico):', sellersError);
    }
    
    res.json({ 
      success: true, 
      message: 'Configurações salvas com sucesso e aplicadas globalmente!',
      saved: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ ERRO CRÍTICO ao salvar configurações de adquirentes:', error);
    console.error('📍 Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message,
      details: 'Falha no salvamento das configurações'
    });
  }
});

// 💳 LIBERAÇÃO MANUAL DE SALDO PENDENTE DE CARTÃO
adminRouter.post('/api/admin/release-card-pending-balances', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('💳 ADMIN: Disparando liberação manual de saldo pendente de cartão...');
    const result = await runCardPendingReleaseNow();
    res.json({
      success: true,
      message: `Liberação concluída: ${result.released} saldos liberados, ${result.errors} erros`,
      released: result.released,
      errors: result.errors
    });
  } catch (error: any) {
    console.error('❌ ADMIN: Erro ao liberar saldo pendente de cartão:', error);
    res.status(500).json({ success: false, message: error?.message || 'Erro interno' });
  }
});

adminRouter.post('/api/admin/reset-seller-transactions', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email é obrigatório'
      });
    }

    console.log(`🔄 ADMIN: Iniciando reset de transações para seller: ${email}`);

    // Buscar seller pelo email no Neon
    let sellerId: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE email = ${email} LIMIT 1`;
      sellerId = rows[0]?.id || null;
    }, `findSellerByEmail:${email}`);

    if (!sellerId) {
      return res.status(404).json({
        success: false,
        message: `Seller com email ${email} não encontrado`
      });
    }
    
    console.log(`🔍 Seller encontrado: ${email} (ID: ${sellerId})`);

    // Coleções para limpar
    const collectionsToClean = [
      'orders',
      'subscriptions', 
      'withdrawals',
      'refunds',
      'enrollments',
      'members'
    ];

    // Deletar do Neon (ordens, assinaturas, saques, reembolsos) e Firestore (membros, matrículas)
    let totalDeleted = 0;
    await neonQuery(async (sql) => {
      const neonTables = ['orders', 'subscriptions', 'withdrawals', 'refunds'];
      for (const table of neonTables) {
        try {
          const result = await sql.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [sellerId]);
          const count = (result as any).count || 0;
          if (count > 0) { console.log(`✅ Neon: ${count} registros deletados de ${table}`); totalDeleted += count; }
        } catch (e) { console.warn(`⚠️ Tabela ${table} não encontrada no Neon, pulando`); }
      }
    }, `resetSellerTransactions:${sellerId}`);

    // Limpar coleções do Firestore que não migraram
    await ensureFirebaseReady();
    const fsDb = getAdmin().firestore();
    const fsCollections = ['enrollments', 'members'];
    for (const collection of fsCollections) {
      let hasMore = true;
      while (hasMore) {
        const snapshot = await fsDb.collection(collection).where('tenantId', '==', sellerId).limit(450).get();
        if (snapshot.empty) { hasMore = false; break; }
        const batch = fsDb.batch();
        snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
        totalDeleted += snapshot.docs.length;
        if (snapshot.docs.length < 450) hasMore = false;
      }
    }

    console.log(`✅ Reset completo! Total de ${totalDeleted} documentos removidos`);

    res.json({
      success: true,
      message: `Transações resetadas com sucesso para ${email}`,
      deletedCount: totalDeleted
    });

  } catch (error) {
    console.error('❌ Erro no reset de transações:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

adminRouter.post('/api/admin/reset-seller-checkouts', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email é obrigatório'
      });
    }

    console.log(`🗑️ ADMIN: Iniciando reset de checkouts para seller: ${email}`);

    // Buscar seller pelo email no Neon
    let sellerId2: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE email = ${email} LIMIT 1`;
      sellerId2 = rows[0]?.id || null;
    }, `findSellerByEmail2:${email}`);

    if (!sellerId2) {
      return res.status(404).json({
        success: false,
        message: `Seller com email ${email} não encontrado`
      });
    }
    const sellerId = sellerId2;
    
    console.log(`🔍 Seller encontrado: ${email} (ID: ${sellerId})`);

    let totalDeleted = 0;

    // Deletar checkouts e produtos do Neon
    await neonQuery(async (sql) => {
      const neonTables = ['checkouts', 'products'];
      for (const table of neonTables) {
        try {
          const result = await sql.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [sellerId]);
          const count = (result as any).count || 0;
          if (count > 0) { console.log(`✅ Neon: ${count} registros deletados de ${table}`); totalDeleted += count; }
        } catch (e) { console.warn(`⚠️ Tabela ${table} não encontrada no Neon, pulando`); }
      }
    }, `resetSellerCheckouts:${sellerId}`);

    // Limpar coleções do Firestore que não migraram
    await ensureFirebaseReady();
    const fsDb2 = getAdmin().firestore();
    const fsColls = ['modules', 'lessons'];
    for (const collection of fsColls) {
      let hasMore = true;
      while (hasMore) {
        const snapshot = await fsDb2.collection(collection).where('tenantId', '==', sellerId).limit(450).get();
        if (snapshot.empty) { hasMore = false; break; }
        const batch = fsDb2.batch();
        snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
        totalDeleted += snapshot.docs.length;
        if (snapshot.docs.length < 450) hasMore = false;
      }
    }

    console.log(`✅ Reset de checkouts completo! Total de ${totalDeleted} documentos removidos`);

    res.json({
      success: true,
      message: `Checkouts resetados com sucesso para ${email}`,
      deletedCount: totalDeleted
    });

  } catch (error) {
    console.error('❌ Erro no reset de checkouts:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

adminRouter.post('/api/admin/reset-rate-limit', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, endpoint } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    console.log(`🔄 ADMIN: Resetando rate limit - userId: ${userId}, endpoint: ${endpoint || 'TODOS'}`);

    userRateLimiter.resetUserLimit(userId, endpoint);

    res.json({
      success: true,
      message: endpoint 
        ? `Rate limit resetado para ${userId} - endpoint: ${endpoint}` 
        : `Rate limit resetado para ${userId} - TODOS os endpoints`,
      userId,
      endpoint: endpoint || 'all'
    });
  } catch (error) {
    console.error('❌ Erro ao resetar rate limit:', error);
    res.status(500).json({ error: 'Erro ao resetar rate limit' });
  }
});

adminRouter.post('/api/admin/delete-account-complete', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email é obrigatório'
      });
    }

    console.log(`🔥 ADMIN: Iniciando APAGAMENTO COMPLETO da conta: ${email}`);

    let sellerId: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE email = ${email} LIMIT 1`;
      sellerId = rows[0]?.id || null;
    }, 'deleteAccountFindSeller');

    if (!sellerId) return res.status(404).json({ success: false, message: `Seller com email ${email} não encontrado` });

    let totalDeleted = 0;
    await neonQuery(async (sql) => {
      const sid = sellerId!;
      const r1 = await sql`DELETE FROM checkouts WHERE seller_id=${sid} OR tenant_id=${sid}`;
      const r2 = await sql`DELETE FROM products WHERE seller_id=${sid} OR tenant_id=${sid}`;
      const r3 = await sql`DELETE FROM orders WHERE seller_id=${sid} OR tenant_id=${sid}`;
      const r4 = await sql`DELETE FROM enrollments WHERE seller_id=${sid} OR tenant_id=${sid}`;
      const r5 = await sql`DELETE FROM sellers WHERE id=${sid}`;
      totalDeleted = (r1.count || 0) + (r2.count || 0) + (r3.count || 0) + (r4.count || 0) + (r5.count || 0);
    }, `deleteAccountComplete:${sellerId}`);

    // Firebase Auth deletion (Auth kept)
    try {
      await ensureFirebaseReady();
      const adminSdk = getAdmin();
      await adminSdk.auth().deleteUser(sellerId!);
    } catch (authError: any) {
      if (authError.code !== 'auth/user-not-found') console.error(`❌ Firebase Auth delete error:`, authError);
    }

    // 🐰 APAGAR ARQUIVOS DO BUNNY CDN
    let storageFilesDeleted = 0;
    try {
      const { deleteBunnyStorageFile } = await import('../lib/bunny-helper.js');
      const sellerEmail = email.toLowerCase();
      
      // 📂 DELETAR PASTAS DO SELLER NO BUNNY CDN
      const sellerFolders = [
        `sellers/${sellerEmail}/`,
        `sellers/${sellerId}/`,
        `documents/${sellerId}/`,
        `products/${sellerId}/`,
        `checkouts/${sellerId}/`
      ];
      
      for (const folder of sellerFolders) {
        try {
          const deleted = await deleteBunnyStorageFile(folder);
          if (deleted) {
            storageFilesDeleted++;
            console.log(`✅ Pasta removida do Bunny CDN: ${folder}`);
          }
        } catch (folderError: any) {
          console.warn(`⚠️ Erro ao deletar pasta ${folder}:`, folderError.message);
        }
      }
      
      console.log(`✅ Total de ${storageFilesDeleted} pastas removidas do Bunny CDN`);
    } catch (storageError: any) {
      console.error(`❌ Erro ao remover arquivos do Bunny CDN:`, storageError);
    }

    // Limpar cache do seller
    if (storage && typeof storage.clearSellerCache === 'function') {
      await storage.clearSellerCache();
      console.log('🧹 Cache de sellers limpo após exclusão');
    }

    console.log(`🔥 APAGAMENTO COMPLETO FINALIZADO!`);
    console.log(`📊 Total de ${totalDeleted} documentos do Firestore removidos`);
    console.log(`📊 Total de ${storageFilesDeleted} arquivos do Storage removidos`);
    console.log(`✅ Conta ${email} COMPLETAMENTE apagada do sistema (Auth + Firestore + Bunny CDN)`);

    res.json({
      success: true,
      message: `Conta ${email} apagada COMPLETAMENTE do sistema`,
      summary: {
        firestoreDocuments: totalDeleted,
        storageFiles: storageFilesDeleted,
        authenticationDeleted: true,
        cacheCleared: true
      },
      warning: 'Esta ação foi IRREVERSÍVEL - todos os dados foram perdidos para sempre (Auth + Firestore + Bunny CDN)'
    });

  } catch (error) {
    console.error('❌ Erro no apagamento completo da conta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

adminRouter.post('/api/admin/cleanup-orphan-sellers', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🧹🧹🧹 ADMIN: Iniciando limpeza profunda de sellers órfãos...');
    console.log('👤 Executado por admin:', req.user?.uid);
    
    await ensureFirebaseReady();
    const adminSdkOrphan = getAdmin();

    // 1️⃣ BUSCAR TODOS OS SELLERS DO NEON
    let allNeonSellers: any[] = [];
    await neonQuery(async (sql) => {
      allNeonSellers = await sql`SELECT id, email FROM sellers`;
    }, 'cleanupOrphanListSellers');

    const orphanSellers: any[] = [];
    const validSellers: any[] = [];

    // 2️⃣ VERIFICAR QUAIS EXISTEM NO FIREBASE AUTH
    for (const seller of allNeonSellers) {
      try {
        await adminSdkOrphan.auth().getUser(seller.id);
        validSellers.push({ id: seller.id, email: seller.email });
      } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
          orphanSellers.push({ id: seller.id, email: seller.email });
        }
      }
    }
    
    console.log(`\n📊 RESUMO:`);
    console.log(`   ✅ Sellers válidos: ${validSellers.length}`);
    console.log(`   🗑️ Sellers órfãos: ${orphanSellers.length}`);
    
    if (orphanSellers.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhum seller órfão encontrado! Sistema já está limpo.',
        summary: {
          validSellers: validSellers.length,
          orphansFound: 0,
          orphansDeleted: 0
        }
      });
    }
    
    // 2️⃣ DELETAR TODOS OS DADOS RELACIONADOS AOS SELLERS ÓRFÃOS
    let totalDeleted = 0;
    const deletionReport: any = {};

    for (const orphan of orphanSellers) {
      const sid = orphan.id;
      await neonQuery(async (sql) => {
        const r1 = await sql`DELETE FROM checkouts WHERE seller_id=${sid} OR tenant_id=${sid}`;
        const r2 = await sql`DELETE FROM products WHERE seller_id=${sid} OR tenant_id=${sid}`;
        const r3 = await sql`DELETE FROM orders WHERE seller_id=${sid} OR tenant_id=${sid}`;
        const r4 = await sql`DELETE FROM enrollments WHERE seller_id=${sid} OR tenant_id=${sid}`;
        const r5 = await sql`DELETE FROM sellers WHERE id=${sid}`;
        const count = (r1.count || 0) + (r2.count || 0) + (r3.count || 0) + (r4.count || 0) + (r5.count || 0);
        totalDeleted += count;
        deletionReport[orphan.email] = count;
      }, `cleanupOrphan:${sid}`);
    }
    
    // 3️⃣ LIMPAR CACHE
    if (storage && typeof storage.clearSellerCache === 'function') {
      await storage.clearSellerCache();
      console.log('🧹 Cache de sellers limpo');
    }
    
    console.log(`\n🎉 LIMPEZA PROFUNDA CONCLUÍDA!`);
    console.log(`📊 Total de ${totalDeleted} documentos deletados`);
    console.log(`✅ ${orphanSellers.length} sellers órfãos removidos`);
    console.log(`✅ ${validSellers.length} sellers válidos mantidos`);
    
    res.json({
      success: true,
      message: `Limpeza profunda concluída! ${orphanSellers.length} sellers órfãos removidos.`,
      summary: {
        validSellers: validSellers.length,
        validSellersList: validSellers.map(s => s.email),
        orphansFound: orphanSellers.length,
        orphansDeleted: orphanSellers.length,
        totalDocumentsDeleted: totalDeleted,
        deletionReport
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro na limpeza profunda:', error);
    res.status(500).json({
      success: false,
      message: 'Erro na limpeza profunda',
      error: error.message
    });
  }
});

adminRouter.post('/api/admin/impersonate-seller', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId, adminUserId } = req.body;
    
    console.log('🔐 [IMPERSONATION] Admin requisitando acesso:', {
      admin: adminUserId,
      targetSeller: sellerId
    });
    
    if (!sellerId) {
      return res.status(400).json({ 
        error: 'sellerId é obrigatório',
        message: 'É necessário informar o ID do seller'
      });
    }
    
    // ✅ VERIFICAR SE O SELLER EXISTE
    await ensureFirebaseReady();
    const admin = getAdmin();
    
    try {
      // Buscar o seller no Firebase Auth
      const sellerUser = await admin.auth().getUser(sellerId);
      
      console.log('✅ Seller encontrado:', {
        uid: sellerUser.uid,
        email: sellerUser.email,
        emailVerified: sellerUser.emailVerified
      });
      
      // 🔑 GERAR CUSTOM TOKEN PARA O SELLER
      const customToken = await admin.auth().createCustomToken(sellerId);
      
      console.log('✅ Custom token gerado para seller:', sellerUser.email);
      
      // 🌐 GERAR URL DE IMPERSONATION (usa o host do próprio request como fonte de verdade)
      const reqHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
      const reqProto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
      const baseUrl =
        process.env.APP_BASE_URL ||
        (reqHost ? `${reqProto}://${reqHost}` : 'https://volatuspay.com');
      const impersonateUrl = `${baseUrl}/auth/impersonate?token=${customToken}`;
      
      console.log('🚪 URL de impersonation gerada:', impersonateUrl);
      
      res.json({
        success: true,
        url: impersonateUrl,
        seller: {
          uid: sellerUser.uid,
          email: sellerUser.email
        }
      });
      
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({
          error: 'Seller não encontrado',
          message: 'O seller solicitado não existe no sistema de autenticação'
        });
      }
      
      throw error;
    }
    
  } catch (error: any) {
    console.error('❌ Erro ao gerar impersonation:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar acesso',
      message: error.message || 'Erro interno do servidor'
    });
  }
});

adminRouter.post('/api/admin/impersonate-login', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        error: 'Token é obrigatório',
        message: 'É necessário fornecer o token de impersonation'
      });
    }
    
    console.log('🔐 [IMPERSONATE-LOGIN] Validando token de impersonation...');
    
    // Verificar o custom token no Firebase Admin
    await ensureFirebaseReady();
    const admin = getAdmin();
    
    try {
      // Decodificar o token para extrair o UID
      const decodedToken = await admin.auth().verifySessionCookie(token, true).catch(() => {
        // Se falhar como session cookie, tentar como custom token
        // Custom tokens são JWT assinados mas não podem ser verificados diretamente
        // Precisamos confiar no token e extrair o UID dele
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return { uid: payload.uid };
      });
      
      const sellerId = decodedToken.uid;
      
      if (!sellerId) {
        return res.status(400).json({
          error: 'Token inválido',
          message: 'Não foi possível extrair UID do token'
        });
      }
      
      console.log('🔍 [IMPERSONATE-LOGIN] UID extraído do token:', sellerId);
      
      // Buscar dados do seller no Firebase Auth
      const sellerUser = await admin.auth().getUser(sellerId);
      
      let sellerDataImp: any = {};
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT * FROM sellers WHERE id = ${sellerId} LIMIT 1`;
        sellerDataImp = rows[0] || {};
      }, `impersonateLogin:${sellerId}`);

      console.log('✅ [IMPERSONATE-LOGIN] Seller autenticado:', sellerUser.email);
      
      // Retornar dados do seller para o frontend
      res.json({
        success: true,
        seller: {
          uid: sellerUser.uid,
          actualUserId: sellerUser.uid,
          email: sellerUser.email,
          displayName: sellerUser.displayName || sellerDataImp?.business_name || sellerUser.email.split('@')[0],
          businessName: sellerDataImp?.business_name,
          status: sellerDataImp?.status || 'active',
          id: sellerId
        }
      });
      
    } catch (error: any) {
      console.error('❌ [IMPERSONATE-LOGIN] Erro ao validar token:', error);
      
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({
          error: 'Usuário não encontrado',
          message: 'O seller não existe no sistema de autenticação'
        });
      }
      
      if (error.code === 'auth/invalid-custom-token' || error.code === 'auth/argument-error') {
        return res.status(401).json({
          error: 'Token inválido',
          message: 'O token de impersonation é inválido ou expirado'
        });
      }
      
      throw error;
    }
    
  } catch (error: any) {
    console.error('❌ [IMPERSONATE-LOGIN] Erro no login de impersonation:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao validar token',
      message: error.message || 'Erro interno do servidor'
    });
  }
});

adminRouter.get('/api/admin/withdrawals', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔍 Admin buscando TODOS os saques...');

    let withdrawals: any[] = [];
    await neonQuery(async (sql) => {
      withdrawals = await sql`SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT 500`;
    }, 'adminGetWithdrawals');

    withdrawals = withdrawals.map((w: any) => ({
      ...w,
      id: w.id,
      sellerName: w.seller_name || w.pix_data?.holderName || 'N/A',
      sellerEmail: w.seller_email || w.pix_data?.holderEmail || 'N/A',
      pixKey: w.pix_key || w.pix_data?.pixKey || 'N/A',
    }));

    console.log(`✅ ${withdrawals.length} saques encontrados (admin)`);
    return res.json(withdrawals);

  } catch (error: any) {
    console.error('❌ Erro ao buscar saques (admin):', error);
    return res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

adminRouter.post('/api/admin/withdrawals/:id/approve', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const adminUid = req.user?.uid;
    
    console.log(`✅ Admin ${adminUid} aprovando saque: ${id}`);
    
    let approveWithdrawal: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM withdrawals WHERE id = ${id} LIMIT 1`;
      approveWithdrawal = rows[0] || null;
    }, `approveWithdrawalCheck:${id}`);
    if (!approveWithdrawal) throw new Error('WITHDRAWAL_NOT_FOUND');
    if (approveWithdrawal.status !== 'pending') throw new Error(`STATUS_CONFLICT:${approveWithdrawal.status}`);

    await neonQuery(async (sql) => {
      await sql`UPDATE withdrawals SET status='approved', reviewed_at=NOW(), reviewed_by=${adminUid}, updated_at=NOW() WHERE id=${id}`;
      await sql`UPDATE sellers SET withdrawal_balance = COALESCE(withdrawal_balance,0) - ${approveWithdrawal.amount} WHERE id=${approveWithdrawal.seller_id}`;
    }, `approveWithdrawal:${id}`);

    const result = { withdrawal: { ...approveWithdrawal, amount: approveWithdrawal.amount, currency: approveWithdrawal.currency || 'BRL', pixData: approveWithdrawal.pix_data, sellerEmail: approveWithdrawal.seller_email, sellerName: approveWithdrawal.seller_name, pixKey: approveWithdrawal.pix_key } };

    console.log(`✅ Saque APROVADO ATOMICAMENTE: ${id} - R$ ${(result.withdrawal.amount/100).toFixed(2)} (reserved decrementado, totalWithdrawn incrementado)`);

    // 📧 ENVIAR EMAIL DE SAQUE APROVADO (assíncrono, não bloqueia resposta)
    const pixKey = result.withdrawal.pixData?.pixKey || result.withdrawal.pixKey || 'N/A';
    const sellerEmail = result.withdrawal.pixData?.holderEmail || result.withdrawal.sellerEmail || '';
    const sellerName = result.withdrawal.pixData?.holderName || result.withdrawal.sellerName || '';
    if (sellerEmail) {
      sendWithdrawalApprovedEmail({
        sellerEmail,
        sellerName,
        amount: result.withdrawal.amount,
        currency: result.withdrawal.currency || 'BRL',
        pixKey,
        withdrawalId: id
      }).then(() => {
        console.log(`📧 [EMAIL] Notificação de saque aprovado enviada para: ${sellerEmail}`);
      }).catch((err: any) => {
        console.error(`❌ [EMAIL] Erro ao enviar notificação de saque:`, err.message);
      });
    }
    
    res.json({ success: true, message: 'Saque aprovado com sucesso' });

  } catch (error: any) {
    console.error('❌ Erro ao aprovar saque:', error);

    if (error.message === 'WITHDRAWAL_NOT_FOUND') {
      return res.status(404).json({ error: 'Saque não encontrado' });
    }
    if (error.message?.startsWith('STATUS_CONFLICT:')) {
      return res.status(409).json({ error: `Saque já foi processado (status: ${error.message.split(':')[1]})`, code: 'STATUS_CONFLICT' });
    }
    if (error.message === 'BALANCE_NOT_FOUND') {
      return res.status(404).json({ error: 'Saldo do vendedor não encontrado' });
    }
    if (error.message?.startsWith('INSUFFICIENT_RESERVED:')) {
      return res.status(400).json({ error: 'Saldo reservado insuficiente', code: 'INSUFFICIENT_RESERVED' });
    }

    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

adminRouter.post('/api/admin/withdrawals/:id/reject', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminUid = req.user?.uid;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Motivo da recusa é obrigatório' });
    }
    
    console.log(`❌ Admin ${adminUid} rejeitando saque: ${id} - Motivo: ${reason}`);
    
    let rejectWithdrawal: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM withdrawals WHERE id = ${id} LIMIT 1`;
      rejectWithdrawal = rows[0] || null;
    }, `rejectWithdrawalCheck:${id}`);
    if (!rejectWithdrawal) throw new Error('WITHDRAWAL_NOT_FOUND');
    if (rejectWithdrawal.status !== 'pending') throw new Error(`STATUS_CONFLICT:${rejectWithdrawal.status}`);

    const WITHDRAWAL_FEE = 500;
    const feeReturned = rejectWithdrawal.fee || WITHDRAWAL_FEE;
    const totalToReturn = rejectWithdrawal.amount + feeReturned;

    await neonQuery(async (sql) => {
      await sql`UPDATE withdrawals SET status='rejected', rejected_by=${adminUid}, rejection_reason=${reason}, reviewed_at=NOW(), updated_at=NOW() WHERE id=${id}`;
      await sql`UPDATE sellers SET withdrawal_balance = COALESCE(withdrawal_balance,0) + ${totalToReturn} WHERE id=${rejectWithdrawal.seller_id}`;
    }, `rejectWithdrawal:${id}`);

    const result = { withdrawal: { ...rejectWithdrawal, amount: rejectWithdrawal.amount, currency: rejectWithdrawal.currency || 'BRL', pixData: rejectWithdrawal.pix_data, sellerEmail: rejectWithdrawal.seller_email, sellerName: rejectWithdrawal.seller_name, pixKey: rejectWithdrawal.pix_key }, feeReturned };
    
    console.log(`❌ Saque REJEITADO ATOMICAMENTE: ${id} - R$ ${(result.withdrawal.amount/100).toFixed(2)} + taxa R$ ${((result as any).feeReturned/100).toFixed(2)} DEVOLVIDOS ao saldo disponível`);

    // 📧 ENVIAR EMAIL DE SAQUE REJEITADO (assíncrono, não bloqueia resposta)
    const rejectedSellerEmail = result.withdrawal.pixData?.holderEmail || '';
    const rejectedSellerName = result.withdrawal.pixData?.holderName || '';
    const rejectedPixKey = result.withdrawal.pixData?.pixKey || 'N/A';
    if (rejectedSellerEmail) {
      sendWithdrawalRejectedEmail({
        sellerEmail: rejectedSellerEmail,
        sellerName: rejectedSellerName,
        amount: result.withdrawal.amount,
        currency: result.withdrawal.currency,
        pixKey: rejectedPixKey,
        withdrawalId: id,
        reason,
      }).then(() => {
        console.log(`📧 [EMAIL] Notificação de saque rejeitado enviada para: ${rejectedSellerEmail}`);
      }).catch((err: any) => {
        console.error(`❌ [EMAIL] Erro ao enviar notificação de saque rejeitado:`, err.message);
      });
    }

    res.json({ success: true, message: 'Saque rejeitado - Valor devolvido ao saldo' });
    
  } catch (error: any) {
    console.error('❌ Erro ao rejeitar saque:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // ✅ TRATAR ERROS CUSTOMIZADOS DA TRANSAÇÃO
    if (error.message === 'WITHDRAWAL_NOT_FOUND') {
      return res.status(404).json({ error: 'Saque não encontrado' });
    }
    
    if (error.message?.startsWith('STATUS_CONFLICT:')) {
      const status = error.message.split(':')[1];
      return res.status(409).json({ 
        error: `Saque já foi processado (status: ${status})`,
        code: 'STATUS_CONFLICT'
      });
    }
    
    if (error.message === 'BALANCE_NOT_FOUND') {
      return res.status(404).json({ error: 'Saldo do vendedor não encontrado' });
    }
    
    if (error.message?.startsWith('INSUFFICIENT_RESERVED:')) {
      const [, reserved, requested] = error.message.split(':');
      return res.status(400).json({ 
        error: 'Saldo reservado insuficiente (possível conflito)',
        reserved: parseInt(reserved),
        requested: parseInt(requested),
        code: 'INSUFFICIENT_RESERVED'
      });
    }
    
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

adminRouter.post('/api/admin/clear-all-sales', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  // 🚫 BLOQUEIO PERMANENTE - ENDPOINT DESABILITADO PARA PROTEÇÃO DE DADOS
  console.error('🚨 TENTATIVA BLOQUEADA: Endpoint de deleção de dados está PERMANENTEMENTE desabilitado');
  console.error('🔒 PROTEÇÃO ATIVA: Dados de vendas, produtos e clientes são PERMANENTES');
  console.error(`📋 Solicitante: ${req.authUser?.email || 'desconhecido'} - IP: ${req.ip}`);
  
  return res.status(403).json({
    success: false,
    error: 'ENDPOINT_DISABLED',
    message: '🚫 Este endpoint foi PERMANENTEMENTE desabilitado para proteção de dados. Produtos, vendas e dados de clientes são PERMANENTES e não podem ser deletados via painel admin.',
    reason: 'DATA_PROTECTION_POLICY',
    timestamp: new Date().toISOString()
  });
});

adminRouter.post('/api/admin/woovi/config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    console.log('🟢 Atualizando configuração Woovi (Admin)');

    const { enabled, environment, appId, webhookSecret } = req.body;

    const { encryptSensitiveData } = await import('../security/key-encryption.js');

    const encryptedAppId = appId ? encryptSensitiveData(appId) : undefined;
    const encryptedWebhookSecret = webhookSecret ? encryptSensitiveData(webhookSecret) : undefined;

    await neonQuery(async (sql) => {
      const existing = await sql`SELECT config FROM payment_config WHERE id='global' LIMIT 1`;
      const currentCfg: any = existing[0]?.config || {};
      currentCfg.woovi = { ...(currentCfg.woovi || {}), enabled: enabled !== undefined ? enabled : false, environment: environment || 'sandbox', ...(encryptedAppId ? { appId: encryptedAppId } : {}), ...(encryptedWebhookSecret ? { webhookSecret: encryptedWebhookSecret } : {}) };
      currentCfg.updatedBy = req.user!.uid;
      await sql`INSERT INTO payment_config (id, config, updated_at) VALUES ('global', ${currentCfg as any}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`;
    }, 'saveWooviConfig');

    console.log('✅ Configuração Woovi atualizada com sucesso');

    res.json({
      success: true,
      message: 'Configuração Woovi atualizada',
    });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar configuração Woovi:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

adminRouter.post('/api/admin/approve-seller', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sellerId, approved } = req.body;
    
    if (!sellerId) {
      return res.status(400).json({ 
        error: 'sellerId é obrigatório' 
      });
    }
    
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ 
        error: 'approved deve ser boolean (true/false)' 
      });
    }

    console.log(`👤 ADMIN: ${req.user?.email} aprovando seller:`, sellerId, '→', approved);

    let sellerDataForApprove: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      sellerDataForApprove = rows[0] || null;
    }, `approveSellerCheck:${sellerId}`);
    if (!sellerDataForApprove) return res.status(404).json({ error: 'Seller não encontrado' });

    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET is_approved=${approved}, status=${approved ? 'approved' : 'rejected'}, approved_at=${approved ? new Date() : null}, approved_by=${approved ? req.user?.email : null}, updated_at=NOW() WHERE id=${sellerId}`;
    }, `approveSeller:${sellerId}`);

    if (approved) {
      const wooviReq = buildWooviSubAccountRequest(sellerDataForApprove);
      if (wooviReq) {
        createWooviSubAccount(wooviReq)
          .then(async (result) => {
            if (result?.account?.accountId) {
              await neonQuery(async (sql) => {
                await sql`UPDATE sellers SET woovi_account_id=${result.account.accountId}, woovi_account_status=${result.account.status || 'PENDING'} WHERE id=${sellerId}`;
              }, `wooviSubAccount:${sellerId}`);
            }
          })
          .catch((e: any) => console.warn('⚠️ [Woovi Partner]:', e?.message));
      }
    }

    res.json({
      success: true,
      message: approved ? 'Seller aprovado com sucesso!' : 'Seller reprovado',
      sellerId,
      approved
    });

  } catch (error: any) {
    console.error('❌ Erro ao aprovar seller:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

// PUT /api/admin/sellers/:id — Approve or reject a seller (used by admin sellers page)
adminRouter.put('/api/admin/sellers/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { action, rejectionReason } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'sellerId é obrigatório' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action deve ser "approve" ou "reject"' });
    }

    let putSellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM sellers WHERE id = ${id} LIMIT 1`;
      putSellerData = rows[0] || null;
    }, `putSellerCheck:${id}`);
    if (!putSellerData) return res.status(404).json({ error: 'Seller não encontrado', id });

    if (action === 'approve') {
      await neonQuery(async (sql) => {
        await sql`UPDATE sellers SET status='approved', is_approved=true, approved_at=NOW(), approved_by=${req.user?.email}, rejected_at=null, rejected_by=null, rejection_reason=null, updated_at=NOW() WHERE id=${id}`;
      }, `putSellerApprove:${id}`);
      if (putSellerData.email) sendSellerApprovalEmail(putSellerData.email, putSellerData.business_name || putSellerData.name).catch(() => {});
      const wooviReqPut = buildWooviSubAccountRequest(putSellerData);
      if (wooviReqPut) {
        createWooviSubAccount(wooviReqPut).then(async (result) => {
          if (result?.account?.accountId) {
            await neonQuery(async (sql) => { await sql`UPDATE sellers SET woovi_account_id=${result.account.accountId}, woovi_account_status=${result.account.status || 'PENDING'} WHERE id=${id}`; }, `wooviSubAccount:${id}`);
          }
        }).catch(() => {});
      }
      return res.json({ success: true, message: 'Seller aprovado com sucesso!', id, status: 'approved' });
    } else {
      await neonQuery(async (sql) => {
        await sql`UPDATE sellers SET status='rejected', is_approved=false, approved_at=null, approved_by=null, rejected_at=NOW(), rejected_by=${req.user?.email}, rejection_reason=${rejectionReason || 'Rejeitado pelo administrador'}, updated_at=NOW() WHERE id=${id}`;
      }, `putSellerReject:${id}`);
      if (putSellerData.email) sendSellerRejectionEmail(putSellerData.email, rejectionReason || 'Sua conta foi rejeitada.', putSellerData.business_name || putSellerData.name).catch(() => {});
      return res.json({ success: true, message: 'Seller rejeitado com sucesso', id, status: 'rejected' });
    }

  } catch (error: any) {
    console.error('❌ Erro ao atualizar status do seller:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

adminRouter.post('/api/admin/fix-sellers-approval-status', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('🔧 FIX: Iniciando correção de status de sellers...');
    console.log('👤 ADMIN:', req.user?.email);
    
    const stats = { total: 0, alreadyCorrect: 0, fixed: 0, errors: 0, details: [] as Array<{ id: string; email: string; oldValue: any; newValue: boolean; action: string }> };

    await neonQuery(async (sql) => {
      const sellers = await sql`SELECT id, email, is_approved, status FROM sellers`;
      stats.total = sellers.length;
      for (const seller of sellers) {
        if (typeof seller.is_approved === 'boolean') { stats.alreadyCorrect++; continue; }
        try {
          const newVal = seller.status === 'approved';
          await sql`UPDATE sellers SET is_approved=${newVal}, updated_at=NOW() WHERE id=${seller.id}`;
          stats.fixed++;
          stats.details.push({ id: seller.id, email: seller.email, oldValue: seller.is_approved, newValue: newVal, action: 'status-based fix' });
        } catch (e: any) { stats.errors++; }
      }
    }, 'fixSellersApproval');
    
    console.log('✅ FIX CONCLUÍDO:', stats);
    
    res.json({
      success: true,
      message: 'Correção de sellers concluída',
      stats,
      details: stats.details
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao corrigir sellers:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

adminRouter.post('/api/admin/fix-showcase-products', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('🔧 ADMIN: Iniciando correção automática de showcase...');
    
    let totalCheckouts = 0;
    let fixedCount = 0;
    await neonQuery(async (sql) => {
      const checkouts = await sql`SELECT id, config FROM checkouts WHERE active = true`;
      totalCheckouts = checkouts.length;
      for (const co of checkouts) {
        const cfg: any = co.config || {};
        if (cfg.affiliate?.enabled === true && cfg.showcase?.enabled !== true) {
          cfg.showcase = { ...cfg.showcase, enabled: true, category: cfg.showcase?.category || 'outros' };
          await sql`UPDATE checkouts SET config=${cfg as any}::jsonb, updated_at=NOW() WHERE id=${co.id}`;
          fixedCount++;
        }
      }
    }, 'fixShowcaseProducts');

    res.json({
      success: true,
      totalCheckouts,
      fixed: fixedCount,
      message: `${fixedCount} produtos habilitados na vitrine`
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao corrigir showcase:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

adminRouter.post('/api/admin/purge-tenant-orders', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tenantId, confirmPhrase, secondConfirmPhrase, dryRun = true } = req.body;
    
    // 🔒 VALIDAÇÃO 1: Verificar tenantId
    if (!tenantId) {
      return res.status(400).json({ 
        error: 'tenantId é obrigatório' 
      });
    }

    // 🔒 VALIDAÇÃO 2: Dupla confirmação obrigatória
    if (confirmPhrase !== 'DELETE_ALL_SALES_PERMANENTLY') {
      return res.status(400).json({ 
        error: 'Primeira confirmação incorreta. Use: "DELETE_ALL_SALES_PERMANENTLY"',
        required: 'DELETE_ALL_SALES_PERMANENTLY'
      });
    }

    if (secondConfirmPhrase !== 'I_CONFIRM_TOTAL_PURGE') {
      return res.status(400).json({ 
        error: 'Segunda confirmação incorreta. Use: "I_CONFIRM_TOTAL_PURGE"',
        required: 'I_CONFIRM_TOTAL_PURGE'
      });
    }

    // 🔒 VALIDAÇÃO 3: Rate limiting (2 tentativas em 10 minutos)
    const adminEmail = req.user?.email || 'unknown';
    const now = Date.now();
    const attempts = purgeAttempts.get(adminEmail) || [];
    const recentAttempts = attempts.filter(time => now - time < 10 * 60 * 1000);
    
    if (recentAttempts.length >= 2 && dryRun === false) {
      return res.status(429).json({
        error: 'Limite de tentativas excedido. Aguarde 10 minutos.',
        attempts: recentAttempts.length,
        waitMinutes: 10
      });
    }

    // 📋 AUDIT LOG: Registrar ação CRÍTICA
    console.log('🔥🔥🔥 PURGE TOTAL INICIADO 🔥🔥🔥');
    console.log('⚠️ DELETANDO TODAS AS VENDAS DO TENANT:', tenantId);
    console.log('👤 ADMIN RESPONSÁVEL:', adminEmail);
    console.log('🧪 DRY RUN:', dryRun);

    let totalOrders = 0;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT COUNT(*)::int as cnt FROM orders WHERE tenant_id = ${tenantId}`;
      totalOrders = rows[0]?.cnt || 0;
    }, `purgeTenantOrdersCount:${tenantId}`);

    if (totalOrders === 0) {
      return res.json({ success: true, message: 'Nenhuma venda encontrada para deletar', deleted: 0, dryRun });
    }

    if (dryRun === true) {
      return res.json({ success: true, dryRun: true, message: `DRY RUN: ${totalOrders} vendas seriam deletadas`, count: totalOrders, warning: 'Para executar a deleção, envie: { "dryRun": false }', tenantId });
    }

    purgeAttempts.set(adminEmail, [...recentAttempts, now]);

    let totalDeleted = 0;
    await neonQuery(async (sql) => {
      const result = await sql`DELETE FROM orders WHERE tenant_id = ${tenantId}`;
      totalDeleted = result.count || 0;
      await sql`INSERT INTO audit_logs (action, actor, metadata, created_at) VALUES ('PURGE_TENANT_ORDERS', ${adminEmail}, ${JSON.stringify({ tenantId, deletedCount: totalDeleted })}::jsonb, NOW())`;
    }, `purgeTenantOrders:${tenantId}`);

    res.json({
      success: true,
      message: `${totalDeleted} vendas deletadas permanentemente`,
      deleted: totalDeleted,
      tenantId,
      adminEmail,
      warning: 'Esta ação é IRREVERSÍVEL!'
    });

  } catch (error: any) {
    console.error('❌ Erro ao executar purge:', error);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

adminRouter.get('/api/admin/download-kyc-pdf', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Configurar headers para download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=VolatusPay_KYC_Antifraude_${new Date().toISOString().split('T')[0]}.pdf`);

    // Pipe do PDF para o response
    doc.pipe(res);

    // Adicionar conteúdo ao PDF
    doc.fontSize(20).fillColor('#10B981').text('ZEN PAGAMENTOS', { align: 'center' });
    doc.fontSize(16).fillColor('#000000').text('Relatório KYC e Políticas Antifraude', { align: 'center' });
    doc.moveDown(2);

    // Seção 1: Políticas PLD e KYC
    doc.fontSize(14).fillColor('#10B981').text('1. Políticas de Prevenção à Lavagem de Dinheiro (PLD) e KYC');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000000').text('A VolatusPay adota rigorosas políticas de KYC (Know Your Customer) e PLD (Prevenção à Lavagem de Dinheiro) para garantir a legitimidade de todas as transações realizadas em sua plataforma.');
    doc.moveDown(0.5);
    doc.fontSize(10).text('• Coleta e verificação de dados de identificação de sellers e compradores');
    doc.text('• Análise de perfil comportamental e histórico transacional');
    doc.text('• Monitoramento contínuo de atividades suspeitas');
    doc.text('• Relatórios obrigatórios às autoridades competentes quando aplicável');
    doc.moveDown(1.5);

    // Seção 2: 6 Camadas de Segurança
    doc.fontSize(14).fillColor('#10B981').text('2. Sistema de Segurança em 6 Camadas');
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#1f2937').text('LAYER 1: Edge Firewall', { underline: true });
    doc.fontSize(10).text('IP Reputation, Geofencing, DDoS Protection');
    doc.moveDown(0.3);
    
    doc.fontSize(11).fillColor('#1f2937').text('LAYER 2: WAF (Web Application Firewall)', { underline: true });
    doc.fontSize(10).text('OWASP Top 10 Protection, SQL Injection, XSS, CSRF');
    doc.moveDown(0.3);
    
    doc.fontSize(11).fillColor('#1f2937').text('LAYER 3: IDS/IPS (Intrusion Detection/Prevention)', { underline: true });
    doc.fontSize(10).text('Behavioral Analysis, Honeypots, Anomaly Detection');
    doc.moveDown(0.3);
    
    doc.fontSize(11).fillColor('#1f2937').text('LAYER 4: Threat Intelligence', { underline: true });
    doc.fontSize(10).text('Zero-Day Protection, Automated Response, Blacklist Management');
    doc.moveDown(0.3);
    
    doc.fontSize(11).fillColor('#1f2937').text('LAYER 5: AI ThreatGuard', { underline: true });
    doc.fontSize(10).text('Machine Learning para detecção de fraudes, Shadow Mode, Auto-blocking');
    doc.moveDown(0.3);
    
    doc.fontSize(11).fillColor('#1f2937').text('LAYER 6: HTTP Security', { underline: true });
    doc.fontSize(10).text('Helmet + CSP Headers, Rate Limiting, SIEM Audit Trails');
    doc.moveDown(1.5);

    // Seção 3: Critérios de Bloqueio
    doc.fontSize(14).fillColor('#10B981').text('3. Critérios de Bloqueio e Taxa de Detecção');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000000').text('Taxa de Bloqueio Sellers Normais: 0.7%');
    doc.text('Taxa de Bloqueio Segmentos Alto Risco: 0.4%');
    doc.moveDown(0.5);
    doc.fontSize(10).text('Critérios principais:');
    doc.text('• CPF/CNPJ em listas de sanções ou PEP');
    doc.text('• Histórico de chargebacks superior a 1.5%');
    doc.text('• Padrões de transações suspeitas');
    doc.text('• Produtos de categorias de alto risco sem documentação');
    doc.moveDown(1.5);

    // Seção 4: Segmentos de Alto Risco
    doc.fontSize(14).fillColor('#10B981').text('4. Segmentos de Alto Risco');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000000').text('A plataforma classifica os seguintes segmentos como alto risco:');
    doc.moveDown(0.3);
    doc.text('• Apostas e Jogos de Azar (Bet, Cassino Online)');
    doc.text('• Infoprodutos de Renda Rápida/Investimentos');
    doc.text('• Criptomoedas e Produtos Financeiros Não Regulados');
    doc.text('• Produtos Adultos e Conteúdo Sensível');
    doc.moveDown(1.5);

    // Nova página
    doc.addPage();

    // Seção 5: Detecção de Contas Fachada
    doc.fontSize(14).fillColor('#10B981').text('5. Detecção de Contas Fachada e Laranjas');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000000').text('Sistema de Digital Fingerprint baseado em:');
    doc.moveDown(0.3);
    doc.text('• Endereço IP e geolocalização');
    doc.text('• Device fingerprint (navegador, sistema operacional)');
    doc.text('• Análise de comportamento (velocidade de digitação, padrões de clique)');
    doc.text('• Validação de documentos com OCR e base de dados governamentais');
    doc.text('• Cross-matching de CPF/CNPJ com múltiplas contas');
    doc.moveDown(1.5);

    // Seção 6: Verificação PEP
    doc.fontSize(14).fillColor('#10B981').text('6. Verificação de Pessoas Expostas Politicamente (PEP)');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000000').text('Consulta automatizada em bases de dados:');
    doc.moveDown(0.3);
    doc.text('• Lista de PEP nacional e internacional');
    doc.text('• Sanções ONU, OFAC, União Europeia');
    doc.text('• Lista de pessoas com restrições judiciais');
    doc.text('• Atualização semanal das bases de dados');
    doc.moveDown(1.5);

    // Seção 7: Monitoramento de Transações
    doc.fontSize(14).fillColor('#10B981').text('7. Monitoramento de Transações');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000000').text('Frequência: Análise Semanal + Trigger em Novos Produtos');
    doc.moveDown(0.3);
    doc.fontSize(10).text('Cálculo de Risco Automatizado (Índice 0-28):');
    doc.text('• Possibilidade de scam, golpes e fraudes');
    doc.text('• Categoria do produto (digital, serviço)');
    doc.text('• Nome e descrição suspeitos');
    doc.text('• Histórico do seller (chargebacks, vendas)');
    doc.moveDown(0.5);
    doc.fontSize(10).text('Sistema de Alertas:');
    doc.text('• Risco > 10: Monitoramento constante');
    doc.text('• Risco ≥ 28: Análise prioritária + bloqueio imediato');
    doc.moveDown(1.5);

    // Seção 8: Stack Tecnológico
    doc.fontSize(14).fillColor('#10B981').text('8. Stack Tecnológico de Segurança');
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000000').text('Firebase Ecosystem: Firestore, Authentication, Storage, Realtime Database');
    doc.text('Criptografia: AES-256-GCM com ENCRYPTION_MASTER_KEY');
    doc.text('HSM: Hardware Security Module em memória');
    doc.text('AI: ThreatGuard AI com Machine Learning');
    doc.text('Auditoria: SIEM-compatible logs (X-Request-ID)');
    doc.text('Rate Limiting: Redis + Express Rate Limit');
    doc.text('HTTP Security: Helmet + CSP Headers');
    doc.moveDown(2);

    // Footer
    doc.fontSize(8).fillColor('#6b7280').text(`Documento gerado em ${new Date().toLocaleDateString('pt-BR')}`, { align: 'center' });
    doc.text('CONFIDENCIAL - Uso exclusivo VolatusPay', { align: 'center' });

    // Finalizar o PDF
    doc.end();

    console.log('✅ PDF KYC gerado com sucesso');

  } catch (error: any) {
    console.error('❌ Erro ao gerar PDF KYC:', error);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

adminRouter.get('/api/admin/firebase-audit', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔍 AUDITORIA FIREBASE - Iniciando auditoria completa...');
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    const realtimeDb = admin.database();
    const audit: any = {
      timestamp: new Date().toISOString(),
      firestore: {
        collections: [],
        totalDocuments: 0
      },
      realtimeDatabase: {
        paths: []
      },
      storage: {
        note: 'Storage migrated to Bunny CDN',
        totalFiles: 0
      }
    };

    console.log('📊 Auditando Firestore...');
    const collections = await db.listCollections();
    
    for (const collection of collections) {
      const snapshot = await collection.count().get();
      const count = snapshot.data().count;
      
      audit.firestore.collections.push({
        name: collection.id,
        documentCount: count
      });
      audit.firestore.totalDocuments += count;
      
      console.log(`  📁 ${collection.id}: ${count} documentos`);
    }

    console.log('📊 Auditando Realtime Database...');
    try {
      const snapshot = await realtimeDb.ref('/').once('value');
      const data = snapshot.val();
      
      if (data) {
        audit.realtimeDatabase.paths = Object.keys(data).map(key => ({
          path: key,
          hasData: !!data[key]
        }));
        console.log(`  🗂️ Paths encontrados: ${audit.realtimeDatabase.paths.length}`);
      } else {
        console.log('  ✅ Realtime Database vazio');
      }
    } catch (dbError: any) {
      console.warn('⚠️ Erro ao acessar Realtime Database:', dbError.message);
      audit.realtimeDatabase.error = dbError.message;
    }

    console.log('📊 Storage migrado para Bunny CDN - auditoria via painel Bunny.net');
    audit.storage.note = 'Storage migrated to Bunny CDN - audit via Bunny.net dashboard';

    console.log('✅ Auditoria Firebase concluída');
    res.json({ success: true, audit });

  } catch (error: any) {
    console.error('❌ Erro na auditoria Firebase:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao auditar Firebase',
      details: error.message 
    });
  }
});

adminRouter.delete('/api/admin/firebase-purge', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { confirmCode } = req.body;
    
    if (confirmCode !== 'PURGE_ALL_DATA_PERMANENTLY') {
      return res.status(400).json({ 
        success: false, 
        error: 'Código de confirmação inválido. Use: PURGE_ALL_DATA_PERMANENTLY' 
      });
    }

    console.log('🔥 PURGE TOTAL FIREBASE - Iniciando limpeza completa...');
    console.log(`👤 Executado por: ${req.user!.email} (${req.user!.uid})`);
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    const realtimeDb = admin.database();
    const result: any = {
      timestamp: new Date().toISOString(),
      executedBy: req.user!.email,
      firestore: {
        collectionsDeleted: [],
        documentsDeleted: 0
      },
      realtimeDatabase: {
        pathsDeleted: [],
        status: 'pending'
      },
      storage: {
        note: 'Storage migrated to Bunny CDN',
        filesDeleted: [],
        filesPreserved: [],
        totalDeleted: 0
      }
    };

    console.log('🔥 Deletando coleções do Firestore...');
    const collections = await db.listCollections();
    
    for (const collection of collections) {
      console.log(`  🗑️ Deletando coleção: ${collection.id}`);
      
      const batchSize = 500;
      let deletedCount = 0;
      
      const deleteCollection = async (collectionRef: any) => {
        const snapshot = await collectionRef.limit(batchSize).get();
        
        if (snapshot.size === 0) {
          return 0;
        }
        
        const batch = db.batch();
        snapshot.docs.forEach((doc: any) => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        deletedCount += snapshot.size;
        
        if (snapshot.size === batchSize) {
          return await deleteCollection(collectionRef);
        }
        
        return deletedCount;
      };
      
      const total = await deleteCollection(collection);
      result.firestore.collectionsDeleted.push(collection.id);
      result.firestore.documentsDeleted += total;
      
      console.log(`    ✅ ${total} documentos deletados`);
    }

    console.log('🔥 Limpando Realtime Database...');
    try {
      const snapshot = await realtimeDb.ref('/').once('value');
      const data = snapshot.val();
      
      if (data) {
        const paths = Object.keys(data);
        
        for (const path of paths) {
          console.log(`  🗑️ Deletando path: /${path}`);
          await realtimeDb.ref(`/${path}`).remove();
          result.realtimeDatabase.pathsDeleted.push(path);
        }
        
        result.realtimeDatabase.status = 'cleaned';
        console.log(`    ✅ ${paths.length} paths deletados`);
      } else {
        result.realtimeDatabase.status = 'already_empty';
        console.log('    ✅ Realtime Database já estava vazio');
      }
    } catch (dbError: any) {
      console.warn('⚠️ Erro ao limpar Realtime Database:', dbError.message);
      result.realtimeDatabase.error = dbError.message;
      result.realtimeDatabase.status = 'error';
    }

    console.log('📦 Storage migrado para Bunny CDN - limpeza via painel Bunny.net');
    result.storage.note = 'Storage migrated to Bunny CDN - cleanup via Bunny.net dashboard';

    console.log('✅ PURGE TOTAL FIREBASE CONCLUÍDO');
    console.log(`📊 Resumo:`);
    console.log(`  - Firestore: ${result.firestore.documentsDeleted} docs em ${result.firestore.collectionsDeleted.length} coleções`);
    console.log(`  - Realtime DB: ${result.realtimeDatabase.pathsDeleted.length} paths`);
    console.log(`  - Storage: ${result.storage.totalDeleted} arquivos (${result.storage.filesPreserved.length} preservados)`);

    res.json({ success: true, result });

  } catch (error: any) {
    console.error('❌ Erro no purge Firebase:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao limpar Firebase',
      details: error.message 
    });
  }
});

// 🚫 ROTA REMOVIDA POR SEGURANÇA (Feb 2026 Audit)
// cleanup-test-products DELETAVA TODOS OS CHECKOUTS (não apenas teste!)
// Protegida apenas por chave hardcoded - risco de destruição total de dados

adminRouter.post('/api/admin/test-webhook', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId, webhookUrl } = req.body;
    
    if (!sellerId) {
      return res.status(400).json({ error: 'sellerId é obrigatório' });
    }
    
    let sellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      sellerData = rows[0] || null;
    }, `testWebhookSeller:${sellerId}`);

    if (!sellerData) return res.status(404).json({ error: 'Seller não encontrado', sellerId });
    const targetUrl = webhookUrl || sellerData?.webhook_url || sellerData?.config?.webhookUrl;
    
    console.log('🧪 ADMIN WEBHOOK TEST');
    console.log('   Seller ID:', sellerId);
    console.log('   Seller Email:', sellerData?.email);
    console.log('   Webhook URL:', targetUrl || 'NÃO CONFIGURADO');
    
    if (!targetUrl) {
      return res.status(400).json({ 
        error: 'Webhook URL não configurada para este vendedor',
        sellerId,
        sellerEmail: sellerData?.email,
        hint: 'Configure o campo webhookUrl no documento sellers/' + sellerId
      });
    }
    
    // Criar payload de teste
    const testPayload = {
      event: 'test.webhook',
      tenantId: sellerId,
      order: {
        id: 'TEST_ORDER_' + Date.now(),
        txid: 'TEST_TXID_' + Date.now(),
        status: 'paid',
        paymentMethod: 'pix',
        amount: 10.00,
        amountCentavos: 1000,
        amountFormatted: 'R$ 10,00'
      },
      customer: {
        name: 'Cliente Teste Webhook',
        email: 'teste@webhook.com',
        phone: '11999999999',
        whatsapp: '5511999999999',
        cpf: '12345678901'
      },
      product: {
        id: 'PROD_TEST',
        name: 'Produto Teste Webhook'
      },
      timestamp: new Date().toISOString(),
      apiVersion: '2025-11-03'
    };
    
    // Enviar webhook
    console.log('📤 Enviando webhook de teste para:', targetUrl);
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Source': 'volatuspay',
        'X-Webhook-Event': 'test.webhook',
        'X-Test-Webhook': 'true'
      },
      body: JSON.stringify(testPayload)
    });
    
    const responseStatus = response.status;
    let responseBody = '';
    try {
      responseBody = await response.text();
    } catch (e) {
      responseBody = 'Não foi possível ler o body';
    }
    
    console.log('📥 Resposta do webhook:', responseStatus, responseBody.substring(0, 200));
    
    const whSuccess = responseStatus >= 200 && responseStatus < 300;
    neonQuery(async (sql) => {
      await sql`INSERT INTO audit_logs (action, actor, metadata, created_at) VALUES ('TEST_WEBHOOK', ${sellerId}, ${JSON.stringify({ event: 'test.webhook', webhookUrl: targetUrl, responseStatus, success: whSuccess, responseBody: responseBody.substring(0, 500) })}::jsonb, NOW())`;
    }, 'testWebhookLog').catch(() => {});

    res.json({
      success: responseStatus >= 200 && responseStatus < 300,
      message: responseStatus >= 200 && responseStatus < 300 ? 'Webhook de teste enviado com sucesso!' : 'Webhook enviado mas recebeu erro',
      sellerId,
      webhookUrl: targetUrl,
      responseStatus,
      responseBody: responseBody.substring(0, 500),
      testPayload
    });
    
  } catch (error: any) {
    console.error('❌ Erro no teste de webhook admin:', error);
    res.status(500).json({ error: error.message });
  }
});

adminRouter.post('/api/admin/fix-offers', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  res.json({ success: true, fixed: 0, total: 0, results: [], message: 'fix-offers migrated to Neon — no legacy productOffers collection' });
});
export default adminRouter;
