import { Router } from 'express';
import { storage } from '../storage';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { getAdmin, ensureFirebaseReady } from '../lib/firebase-admin.js';
import { z } from 'zod';
import { generateCheckoutId } from '../../shared/schema';
import { getCheckoutsIndexFromRTDB, syncCheckoutAfterCreate, syncCheckoutAfterUpdate, syncCheckoutAfterDelete, backfillCheckoutsToRTDB } from '../lib/checkouts-sync.js';
import { firestoreCache, withFirestoreTimeout } from '../lib/firestore-cache.js';
import { neonQuery } from '../lib/neon-db.js';

const router = Router();

// Helper para remover campos undefined
function removeUndefinedDeep(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedDeep).filter(v => v !== undefined);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      const cleaned = removeUndefinedDeep(value);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {} as any);
  }
  return obj;
}

// 📦 GET /api/checkouts - Buscar checkouts do seller
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.get('/', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId, limit: queryLimit, cursor } = req.query;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId é obrigatório' });
    }
    
    // 🔐 SECURITY: Verificar se usuário tem acesso a este tenant
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    // Verificar se é admin (pode ver qualquer tenant) ou se é o próprio tenant
    const isAdmin = user.customClaims?.admin === true;
    const isOwnTenant = user.uid === tenantId;
    
    if (!isAdmin && !isOwnTenant) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando acessar checkouts do tenant ${tenantId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode ver seus próprios checkouts' });
    }
    
    // 🚀 PAGINAÇÃO: Limitar resultados (default 50, max 9999 para aggregations)
    const limit = Math.min(parseInt(queryLimit as string) || 50, 9999);
    
    await ensureFirebaseReady();
    const _adminSdk = getAdmin();
    const firebaseStorage = { db: _adminSdk.firestore() } as any;

    // ⚡ FAST PATH: RTDB index (O(1) por tenant) - sem cursor
    if (!cursor) {
      try {
        const rtdbIndex = await getCheckoutsIndexFromRTDB(tenantId as string);
        if (rtdbIndex && Object.keys(rtdbIndex).length > 0) {
          console.log(`⚡ [RTDB] Usando index RTDB para checkouts tenant ${tenantId} (${Object.keys(rtdbIndex).length} checkouts)`);

          let checkoutsArray = Object.entries(rtdbIndex)
            .map(([id, data]: [string, any]) => ({ id, ...data }))
            .filter(c => !c.deleted);

          checkoutsArray.sort((a, b) => {
            const aTime = new Date(a.createdAt || 0).getTime();
            const bTime = new Date(b.createdAt || 0).getTime();
            return bTime - aTime;
          });

          const hasMore = checkoutsArray.length > limit;
          const sliced = checkoutsArray.slice(0, limit);
          const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

          console.log(`⚡ [RTDB] ✅ ${sliced.length} checkouts via RTDB index (hasMore: ${hasMore})`);

          return res.json({
            checkouts: sliced,
            pagination: { hasMore, nextCursor, limit, count: sliced.length },
            source: 'rtdb'
          });
        }
      } catch (rtdbError) {
        console.warn('⚠️ [RTDB] Fallback para Firestore (checkouts):', rtdbError);
      }
    }

    console.log(`📦 Buscando checkouts do Neon para tenant: ${tenantId} (limit: ${limit})`);

    let neonCheckouts: any[] = [];
    await neonQuery(async (sql) => {
      if (cursor) {
        neonCheckouts = await sql`SELECT * FROM checkouts WHERE tenant_id = ${tenantId as string} AND (deleted IS NULL OR deleted = false) AND id < ${cursor as string} ORDER BY created_at DESC LIMIT ${limit + 1}`;
      } else {
        neonCheckouts = await sql`SELECT * FROM checkouts WHERE tenant_id = ${tenantId as string} AND (deleted IS NULL OR deleted = false) ORDER BY created_at DESC LIMIT ${limit + 1}`;
      }
    }, `listCheckouts:${tenantId}`);

    const hasMore = neonCheckouts.length > limit;
    const docs = hasMore ? neonCheckouts.slice(0, limit) : neonCheckouts;
    const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;
    const checkouts = docs.map((r: any) => ({ id: r.id, ...r, tenantId: r.tenant_id, createdAt: r.created_at, updatedAt: r.updated_at }));

    console.log(`📦 Retornando ${checkouts.length} checkouts via Neon`);
    res.json({ checkouts, pagination: { hasMore, nextCursor, limit, count: checkouts.length }, source: 'neon' });
  } catch (error: any) {
    const errMsg = error?.message || error?.code || error?.details || JSON.stringify(error) || 'Erro desconhecido';
    console.error('❌ Erro ao buscar checkouts:', errMsg, error);
    res.status(500).json({ error: 'Erro ao buscar checkouts: ' + errMsg });
  }
});

// 📦 POST /api/checkouts - Criar novo checkout
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + validação de limite
router.post('/', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const checkoutData = req.body;
    
    // 🔐 SECURITY FIX: tenantId SEMPRE vem do usuário autenticado, NÃO do body (IDOR protection)
    const tenantId = user.uid;
    const isAdmin = user.customClaims?.admin === true;

    // 🔍 BUSCAR CHECKOUTS EXISTENTES DO FIREBASE PARA VALIDAR LIMITE
    // 🎯 LIMITE: 12 checkouts POR PRODUTO (ofertas), não contando deletados
    const MAX_CHECKOUTS_PER_PRODUCT = 12;
    const syncedProductId = checkoutData.syncedProductId;

    let currentCount = 0;
    await neonQuery(async (sql) => {
      let countRows: any[];
      if (syncedProductId) {
        countRows = await sql`SELECT COUNT(*)::int AS cnt FROM checkouts WHERE tenant_id = ${tenantId} AND (deleted IS NULL OR deleted = false) AND synced_product_id = ${syncedProductId}`;
      } else {
        countRows = await sql`SELECT COUNT(*)::int AS cnt FROM checkouts WHERE tenant_id = ${tenantId} AND (deleted IS NULL OR deleted = false)`;
      }
      currentCount = countRows[0]?.cnt || 0;
    }, `checkoutLimitCheck:${tenantId}`);

    if (currentCount >= MAX_CHECKOUTS_PER_PRODUCT) {
      const errorMsg = syncedProductId
        ? `Você atingiu o limite máximo de ${MAX_CHECKOUTS_PER_PRODUCT} ofertas por produto. Para criar novas ofertas, exclua algumas ofertas existentes deste produto.`
        : `Você atingiu o limite máximo de ${MAX_CHECKOUTS_PER_PRODUCT} checkouts. Para criar novos checkouts, exclua alguns checkouts existentes.`;
      console.warn(`⚠️ Limite de checkouts atingido para tenant ${tenantId}: ${currentCount}/${MAX_CHECKOUTS_PER_PRODUCT}`);
      return res.status(400).json({ error: errorMsg, limit: MAX_CHECKOUTS_PER_PRODUCT, current: currentCount });
    }

    // Validar amount > 0
    if (!checkoutData.pricing?.amount || checkoutData.pricing.amount <= 0) {
      return res.status(400).json({ error: 'O valor do produto deve ser maior que zero' });
    }

    // Limpar undefined profundamente
    const cleanedData = removeUndefinedDeep(checkoutData);

    const dataToSave = {
      ...cleanedData,
      tenantId,
      deleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const checkoutId = generateCheckoutId();
    console.log(`📦 Criando novo checkout ${checkoutId} para tenant ${tenantId}:`, dataToSave.title);

    // Salvar diretamente no Neon (source of truth)
    await neonQuery(async (sql) => {
      await sql`INSERT INTO checkouts (id, tenant_id, slug, title, subtitle, logo_url, product_type, currency, active, test_mode, product_id, synced_product_id, pricing, methods, theme, affiliate, global_settings, fields, config, deleted, created_at, updated_at)
        VALUES (
          ${checkoutId}, ${tenantId},
          ${(dataToSave as any).slug || checkoutId},
          ${(dataToSave as any).title || null},
          ${(dataToSave as any).subtitle || null},
          ${(dataToSave as any).logoUrl || null},
          ${(dataToSave as any).productType || null},
          ${(dataToSave as any).currency || 'BRL'},
          ${(dataToSave as any).active !== false},
          ${(dataToSave as any).testMode || false},
          ${(dataToSave as any).productId || null},
          ${(dataToSave as any).syncedProductId || null},
          ${JSON.stringify((dataToSave as any).pricing || {})}::jsonb,
          ${JSON.stringify((dataToSave as any).methods || {})}::jsonb,
          ${JSON.stringify((dataToSave as any).theme || {})}::jsonb,
          ${JSON.stringify((dataToSave as any).affiliate || {})}::jsonb,
          ${JSON.stringify((dataToSave as any).globalSettings || {})}::jsonb,
          ${JSON.stringify((dataToSave as any).fields || {})}::jsonb,
          ${JSON.stringify(dataToSave)}::jsonb,
          false, NOW(), NOW()
        ) ON CONFLICT (id) DO NOTHING`;
    }, `createCheckout:${checkoutId}`);

    const createdCheckout = { id: checkoutId, ...dataToSave };
    console.log(`✅ Checkout criado com ID estável no Neon: ${checkoutId}`);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-products.js').then(({ neonWriteCheckout }) => {
      neonWriteCheckout({
        checkoutId,
        tenantId,
        slug: (dataToSave as any).slug || checkoutId,
        title: (dataToSave as any).title,
        subtitle: (dataToSave as any).subtitle,
        logoUrl: (dataToSave as any).logoUrl,
        productType: (dataToSave as any).productType,
        currency: (dataToSave as any).currency,
        active: (dataToSave as any).active,
        testMode: (dataToSave as any).testMode,
        productId: (dataToSave as any).productId,
        syncedProductId: (dataToSave as any).syncedProductId,
        pricing: (dataToSave as any).pricing,
        methods: (dataToSave as any).methods,
        theme: (dataToSave as any).theme,
        affiliate: (dataToSave as any).affiliate,
        globalSettings: (dataToSave as any).globalSettings,
        fields: (dataToSave as any).fields,
        deleted: false,
      });
    }).catch(() => {});

    syncCheckoutAfterCreate(tenantId, checkoutId, { ...dataToSave, id: checkoutId });

    firestoreCache.invalidateTenantCheckouts(tenantId);

    res.status(201).json(createdCheckout);
  } catch (error: any) {
    console.error('❌ Erro ao criar checkout:', error);
    res.status(500).json({ error: 'Erro ao criar checkout: ' + error.message });
  }
});

// 📦 GET /api/checkouts/:id - Buscar checkout individual
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.get('/:id', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    let checkoutRow: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM checkouts WHERE id = ${id} LIMIT 1`;
      if (rows[0]) checkoutRow = rows[0];
    }, `getCheckout:${id}`);

    if (!checkoutRow) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    const isAdmin = user.customClaims?.admin === true;
    if (checkoutRow.tenant_id !== user.uid && !isAdmin) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    res.json({ id: checkoutRow.id, ...checkoutRow, tenantId: checkoutRow.tenant_id, createdAt: checkoutRow.created_at, updatedAt: checkoutRow.updated_at });
  } catch (error: any) {
    console.error('❌ Erro ao buscar checkout:', error);
    res.status(500).json({ error: 'Erro ao buscar checkout: ' + error.message });
  }
});

// 📦 PUT /api/checkouts/:id - Atualizar checkout existente
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.put('/:id', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    console.log(`🔍 DEBUG SHOWCASE: Recebendo atualização do checkout ${id}`);
    console.log(`🔍 DEBUG SHOWCASE: req.body.showcase =`, JSON.stringify(updateData.showcase, null, 2));
    
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    let existingCheckout: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM checkouts WHERE id = ${id} LIMIT 1`;
      if (rows[0]) existingCheckout = rows[0];
    }, `putCheckoutFetch:${id}`);

    if (!existingCheckout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    const isAdmin = user.customClaims?.admin === true;
    const isOwner = user.uid === existingCheckout.tenant_id;

    if (!isAdmin && !isOwner) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando editar checkout ${id} do tenant ${existingCheckout.tenant_id}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode editar seus próprios checkouts' });
    }

    const cleanedData = removeUndefinedDeep(updateData);
    console.log(`🔍 DEBUG SHOWCASE: Após removeUndefinedDeep, cleanedData.showcase =`, JSON.stringify(cleanedData.showcase, null, 2));

    const dataToUpdate = { ...cleanedData };
    delete dataToUpdate.tenantId;
    delete dataToUpdate.id;
    delete dataToUpdate.createdAt;
    delete dataToUpdate.slug;

    console.log(`🔍 DEBUG SHOWCASE: Valor FINAL a ser salvo, dataToUpdate.showcase =`, JSON.stringify(dataToUpdate.showcase, null, 2));
    console.log(`📦 Atualizando checkout ${id} para tenant ${existingCheckout.tenant_id}`);

    // Mesclar config existente com updates
    const mergedConfig = { ...(existingCheckout.config || {}), ...dataToUpdate };

    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET
        title = COALESCE(${dataToUpdate.title ?? null}, title),
        subtitle = COALESCE(${dataToUpdate.subtitle ?? null}, subtitle),
        logo_url = COALESCE(${dataToUpdate.logoUrl ?? null}, logo_url),
        active = COALESCE(${dataToUpdate.active ?? null}, active),
        test_mode = COALESCE(${dataToUpdate.testMode ?? null}, test_mode),
        product_id = COALESCE(${dataToUpdate.productId ?? null}, product_id),
        synced_product_id = COALESCE(${dataToUpdate.syncedProductId ?? null}, synced_product_id),
        pricing = CASE WHEN ${dataToUpdate.pricing != null} THEN ${JSON.stringify(dataToUpdate.pricing || {})}::jsonb ELSE pricing END,
        methods = CASE WHEN ${dataToUpdate.methods != null} THEN ${JSON.stringify(dataToUpdate.methods || {})}::jsonb ELSE methods END,
        theme = CASE WHEN ${dataToUpdate.theme != null} THEN ${JSON.stringify(dataToUpdate.theme || {})}::jsonb ELSE theme END,
        affiliate = CASE WHEN ${dataToUpdate.affiliate != null} THEN ${JSON.stringify(dataToUpdate.affiliate || {})}::jsonb ELSE affiliate END,
        global_settings = CASE WHEN ${dataToUpdate.globalSettings != null} THEN ${JSON.stringify(dataToUpdate.globalSettings || {})}::jsonb ELSE global_settings END,
        config = ${JSON.stringify(mergedConfig)}::jsonb,
        updated_at = NOW()
        WHERE id = ${id}`;
    }, `putCheckoutUpdate:${id}`);

    const updatedCheckout = { id, ...existingCheckout, ...dataToUpdate, tenantId: existingCheckout.tenant_id, updatedAt: new Date() };
    console.log(`✅ Checkout atualizado com sucesso no Neon: ${id}`);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-products.js').then(({ neonUpdateCheckout }) => {
      neonUpdateCheckout(id, {
        title: (dataToUpdate as any).title,
        subtitle: (dataToUpdate as any).subtitle,
        logoUrl: (dataToUpdate as any).logoUrl,
        active: (dataToUpdate as any).active,
        productId: (dataToUpdate as any).productId,
        syncedProductId: (dataToUpdate as any).syncedProductId,
        pricing: (dataToUpdate as any).pricing,
        methods: (dataToUpdate as any).methods,
        theme: (dataToUpdate as any).theme,
        globalSettings: (dataToUpdate as any).globalSettings,
      });
    }).catch(() => {});

    firestoreCache.invalidateCheckout(id);
    firestoreCache.invalidateTenantCheckouts(existingCheckout.tenantId);
    firestoreCache.invalidateShowcase();

    syncCheckoutAfterUpdate(existingCheckout.tenantId, id, dataToUpdate);

    res.json(updatedCheckout);
  } catch (error: any) {
    console.error('❌ Erro ao atualizar checkout:', error);
    res.status(500).json({ error: 'Erro ao atualizar checkout: ' + error.message });
  }
});

// 📦 DELETE /api/checkouts/:id - Deletar checkout
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.delete('/:id', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    let delCheckout: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM checkouts WHERE id = ${id} LIMIT 1`;
      if (rows[0]) delCheckout = rows[0];
    }, `deleteCheckoutFetch:${id}`);

    if (!delCheckout) {
      return res.status(404).json({ error: 'Checkout não encontrado' });
    }

    const isAdmin = user.customClaims?.admin === true;
    const isOwner = user.uid === delCheckout.tenant_id;

    if (!isAdmin && !isOwner) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando deletar checkout ${id} do tenant ${delCheckout.tenant_id}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode deletar seus próprios checkouts' });
    }

    console.log(`📦 Verificando vendas relacionadas ao checkout ${id}...`);

    // Verificar se há orders para este checkout no Neon
    let salesCount = 0;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT COUNT(*)::int AS cnt FROM orders WHERE checkout_id = ${id}`;
      salesCount = rows[0]?.cnt || 0;
    }, `deleteCheckoutSalesCheck:${id}`);

    if (salesCount > 0) {
      console.log(`🚨 BLOQUEADO: Checkout ${id} possui ${salesCount} venda(s) - SOFT-DELETE negado`);
      return res.status(400).json({
        status: 400,
        error: 'Não é possível deletar este checkout',
        message: 'Este checkout possui vendas relacionadas. Deletar o checkout quebraria o histórico de compras dos clientes.',
        details: { salesCount, totalBlocking: salesCount, message: `O checkout possui ${salesCount} venda(s)` }
      });
    }

    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET deleted = true, deleted_at = NOW(), deleted_by = ${user.uid}, updated_at = NOW() WHERE id = ${id}`;
    }, `deleteCheckoutUpdate:${id}`);

    console.log(`✅ Checkout soft-deleted com sucesso no Neon: ${id}`);

    firestoreCache.invalidateCheckout(id);
    firestoreCache.invalidateTenantCheckouts(delCheckout.tenant_id);
    syncCheckoutAfterDelete(delCheckout.tenant_id, id);

    res.json({ success: true, message: 'Checkout deletado com sucesso.' });
  } catch (error: any) {
    console.error('❌ Erro ao deletar checkout:', error);
    res.status(500).json({ error: 'Erro ao deletar checkout: ' + error.message });
  }
});

// 🌍 PUBLIC: GET /api/checkouts/showcase/checkouts - Vitrine pública com produtos reais
router.get('/showcase/checkouts', async (req, res) => {
  try {
    const { search = '', category = 'all', affiliateOnly = 'false' } = req.query;
    console.log('🌟 Buscando showcase checkouts: { search: ' + search + ', category: ' + category + ', affiliateOnly: ' + affiliateOnly + ' }');

    console.log('🏪 Neon: Buscando checkouts públicos para showcase');

    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`SELECT c.*, s.name AS seller_name, s.business_name, s.id AS seller_uid
        FROM checkouts c
        LEFT JOIN sellers s ON s.id = c.tenant_id
        WHERE (c.deleted IS NULL OR c.deleted = false)
          AND c.active = true
          AND (c.config->>'adminHidden')::boolean IS NOT TRUE
          AND (c.affiliate->'enabled')::boolean = true
          AND (c.affiliate->>'marketplaceEnabled')::boolean = true`;
    }, 'showcaseCheckouts');

    const validCheckouts = rows.map((r: any) => {
      const affiliate = r.affiliate || {};
      const config = r.config || {};
      return {
        id: r.id,
        title: config.name || r.title || 'Sem título',
        description: config.description || '',
        pricing: r.pricing || { amount: config.price || 0 },
        price: (r.pricing as any)?.amount || config.price || 0,
        image: config.image || r.logo_url || config.imageUrl || null,
        productType: r.product_type || 'digital',
        isAffiliate: affiliate.enabled || false,
        affiliate: { enabled: affiliate.enabled || false, autoApprove: affiliate.autoApprove || false, commissionPercent: affiliate.commissionPercent || 0 },
        commission: affiliate.commissionPercent || 0,
        category: config.category || 'all',
        seller: { name: r.seller_name || 'Empresa', businessName: r.business_name || r.seller_name || 'Empresa', avatar: config.sellerAvatar || null, uid: r.tenant_id },
        createdAt: r.created_at || Date.now(),
        stats: { sales: config.salesCount || 0, rating: 0, reviews: 0 }
      };
    });

    console.log('✅ FILTROS EM CÓDIGO: ' + validCheckouts.length + ' checkouts válidos');

    let filtered = validCheckouts;

    if (search) {
      filtered = filtered.filter((c: any) =>
        c.title.toLowerCase().includes(String(search).toLowerCase()) ||
        c.description.toLowerCase().includes(String(search).toLowerCase()) ||
        c.seller.name.toLowerCase().includes(String(search).toLowerCase())
      );
    }

    if (category && category !== 'all' && category !== 'profitable') {
      filtered = filtered.filter((c: any) => c.productType === category);
    }

    if (affiliateOnly === 'true') {
      filtered = filtered.filter((c: any) => c.isAffiliate);
    }

    console.log('✅ Neon SHOWCASE: ' + filtered.length + ' checkouts públicos retornados');
    res.json(filtered);
  } catch (error: any) {
    const errMsg = error?.message || error?.code || error?.details || JSON.stringify(error) || 'Erro desconhecido';
    console.error('❌ Erro ao buscar showcase checkouts:', errMsg, error);
    res.status(500).json({ error: 'Erro ao buscar checkouts', details: errMsg });
  }
});

// ⚡ ADMIN: Backfill checkouts RTDB index
router.post('/admin/backfill-rtdb', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.body;
    await ensureFirebaseReady();
    const _backfillAdmin = getAdmin();
    const firebaseStorage = { db: _backfillAdmin.firestore() } as any;

    console.log(`⚡ [BACKFILL] Iniciando backfill de checkouts para RTDB${tenantId ? ` (tenant: ${tenantId})` : ' (TODOS)'}`);
    const result = await backfillCheckoutsToRTDB(firebaseStorage.db, tenantId);

    res.json({
      success: true,
      ...result,
      message: `Backfill concluído: ${result.synced} checkouts sincronizados, ${result.errors} erros`
    });
  } catch (error: any) {
    console.error('❌ Erro no backfill de checkouts:', error);
    res.status(500).json({ error: 'Erro no backfill: ' + error.message });
  }
});

// 🚨 ADMIN-ONLY: Deletar TODOS os checkouts (usar com cuidado!)
router.delete('/admin/purge-all', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔥 ADMIN PURGE: Deletando TODOS os checkouts do sistema...');

    let count = 0;
    await neonQuery(async (sql) => {
      const rows = await sql`DELETE FROM checkouts RETURNING id`;
      count = rows.length;
    }, 'purgeAllCheckouts');

    console.log(`✅ ${count} CHECKOUTS DELETADOS DO NEON COM SUCESSO!`);
    res.json({ success: true, message: `${count} checkouts deletados com sucesso!`, deleted: count });
  } catch (error: any) {
    console.error('❌ Erro ao deletar checkouts:', error);
    res.status(500).json({ error: 'Erro ao deletar checkouts: ' + error.message });
  }
});

export default router;
