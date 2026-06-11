import { Router } from 'express';
import { storage } from '../storage';
import { verifyFirebaseToken, requireAdmin, require2FAVerified } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { fetchCheckoutsAndProducts, normalizeOrderForResponse } from '../helpers/order-helpers.js';
import { syncOrderAfterUpdate, getOrdersIndexFromRTDB, getAllOrdersIndexFromRTDB, backfillOrdersToRTDB } from '../lib/orders-sync.js';
import { sendOrderStatusUpdate } from '../lib/utmify-service.js';
import { neonQuery } from '../lib/neon-db.js';
import { getAdmin, ensureFirebaseReady } from '../lib/firebase-admin.js';

const router = Router();

router.get('/', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId, limit: queryLimit, cursor, status: filterStatus } = req.query;
    
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const isAdmin = user.customClaims?.admin === true;
    
    if (!isAdmin && !tenantId) {
      return res.status(400).json({ error: 'tenantId é obrigatório para sellers' });
    }
    
    if (!isAdmin && tenantId && user.uid !== tenantId) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando acessar orders do tenant ${tenantId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode ver suas próprias vendas' });
    }
    
    const limit = Math.min(parseInt(queryLimit as string) || 50, 9999);
    
    await ensureFirebaseReady();
    const _ordersAdminSdk = getAdmin();
    const firebaseStorage = { db: _ordersAdminSdk.firestore() } as any;
    
    if (tenantId && !cursor) {
      try {
        const rtdbIndex = await getOrdersIndexFromRTDB(tenantId as string);
        if (rtdbIndex && Object.keys(rtdbIndex).length > 0) {
          console.log(`⚡ [RTDB] Usando index RTDB para tenant ${tenantId} (${Object.keys(rtdbIndex).length} orders)`);
          
          let ordersArray = Object.entries(rtdbIndex).map(([id, data]: [string, any]) => ({
            id,
            ...data
          }));
          
          if (filterStatus) {
            ordersArray = ordersArray.filter(o => o.status === filterStatus);
          }
          
          ordersArray.sort((a, b) => {
            const aTime = new Date(a.createdAt || 0).getTime();
            const bTime = new Date(b.createdAt || 0).getTime();
            return bTime - aTime;
          });
          
          const hasMore = ordersArray.length > limit;
          const sliced = ordersArray.slice(0, limit);
          const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;
          
          const checkoutIds = [...new Set(sliced.map(o => o.checkoutId).filter(Boolean))];
          
          const { firestoreCache } = await import('../lib/firestore-cache.js');
          const checkoutsMap = await firestoreCache.getCheckoutsBatch(checkoutIds);
          
          const productIds = new Set<string>();
          checkoutsMap.forEach((data: any) => {
            if (data?.syncedProductId) productIds.add(data.syncedProductId);
            if (data?.productId) productIds.add(data.productId);
          });
          
          const productsMap = productIds.size > 0
            ? await firestoreCache.getProductsBatch([...productIds])
            : new Map();
          
          const orders = sliced.map(order => {
            const checkoutData = checkoutsMap.get(order.checkoutId);
            const productId = checkoutData?.productId || checkoutData?.syncedProductId || order.checkoutId;
            const productData = productId ? productsMap.get(productId) : null;
            return normalizeOrderForResponse(order, checkoutData, productData);
          });
          
          console.log(`⚡ [RTDB] ✅ ${orders.length} orders via RTDB index (hasMore: ${hasMore})`);
          
          return res.json({
            data: orders,
            pagination: { hasMore, nextCursor, limit, count: orders.length },
            source: 'rtdb'
          });
        }
      } catch (rtdbError) {
        console.warn('⚠️ [RTDB] Fallback para Firestore:', rtdbError);
      }
    }
    
    if (isAdmin && !tenantId) {
      console.log(`👑 Admin buscando TODAS as orders do Firestore (limit: ${limit}, cursor: ${cursor || 'início'})`);
    } else {
      console.log(`📦 Buscando orders do Firestore para tenant: ${tenantId} (limit: ${limit}, cursor: ${cursor || 'início'})`);
    }
    
    let neonOrders: any[] = [];
    await neonQuery(async (sql) => {
      if (tenantId) {
        if (cursor) {
          neonOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${tenantId as string} AND id < ${cursor as string} ORDER BY created_at DESC LIMIT ${limit + 1}`;
        } else {
          neonOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${tenantId as string} ORDER BY created_at DESC LIMIT ${limit + 1}`;
        }
      } else {
        if (cursor) {
          neonOrders = await sql`SELECT * FROM orders WHERE id < ${cursor as string} ORDER BY created_at DESC LIMIT ${limit + 1}`;
        } else {
          neonOrders = await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT ${limit + 1}`;
        }
      }
    }, 'listOrders');

    if (filterStatus) neonOrders = neonOrders.filter((o: any) => o.status === filterStatus);

    const hasMore = neonOrders.length > limit;
    const docs = hasMore ? neonOrders.slice(0, limit) : neonOrders;
    const nextCursor = hasMore ? docs[docs.length - 1].id : null;
    const orders = docs.map((o: any) => normalizeOrderForResponse({ id: o.id, ...o, tenantId: o.tenant_id, checkoutId: o.checkout_id, createdAt: o.created_at, paidAt: o.paid_at }, null));

    console.log(`📦 ✅ ${orders.length} orders encontradas (hasMore: ${hasMore})`);
    res.json({ data: orders, pagination: { hasMore, nextCursor, limit, count: orders.length }, source: 'neon' });
    
  } catch (error) {
    console.error('❌ Erro ao buscar orders:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🛒 ENDPOINT: HISTÓRICO DE COMPRAS DO USUÁRIO
// ⚠️ IMPORTANTE: Este endpoint DEVE estar ANTES de /:orderId para evitar route collision
// Retorna todas as compras feitas com o email do usuário logado + compras dos seus checkouts
router.get('/my-purchases', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const firebaseStorage = { db: getAdmin().firestore() } as any;

    console.log(`🛒 Buscando histórico de compras para: ${user.email}`);

    let allOrders: any[] = [];
    await neonQuery(async (sql) => {
      const buyerOrders = user.email ? await sql`SELECT *, 'purchase' as type FROM orders WHERE customer_email = ${user.email} ORDER BY created_at DESC LIMIT 100` : [];
      const sellerOrders = await sql`SELECT *, 'sale' as type FROM orders WHERE tenant_id = ${user.uid} ORDER BY created_at DESC LIMIT 100`;
      const seen = new Set<string>();
      for (const o of [...buyerOrders, ...sellerOrders]) {
        if (!seen.has(o.id)) { seen.add(o.id); allOrders.push(o); }
      }
    }, 'myPurchases');
    allOrders.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    const checkoutIds = [...new Set(allOrders.map((o: any) => o.checkout_id).filter(Boolean))];
    const checkoutsMap = new Map<string, any>();
    if (checkoutIds.length > 0) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT * FROM checkouts WHERE id = ANY(${checkoutIds}::text[])`;
        rows.forEach((r: any) => checkoutsMap.set(r.id, r));
      }, 'myPurchasesCheckouts');
    }

    const formattedOrders = allOrders.map((order: any) => {
      const checkoutData = checkoutsMap.get(order.checkout_id || order.checkoutId);
      return { ...normalizeOrderForResponse({ id: order.id, ...order, tenantId: order.tenant_id, checkoutId: order.checkout_id }, checkoutData), type: order.type };
    });

    console.log(`✅ Encontradas ${formattedOrders.length} compras via Neon`);

    return res.json(formattedOrders);

  } catch (error) {
    console.error('❌ Erro ao buscar histórico de compras:', error);
    return res.status(500).json({ error: 'Erro ao buscar histórico de compras' });
  }
});

// 📦 ENDPOINT RESTFUL PARA BUSCAR ORDERS DE UM TENANT ESPECÍFICO
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
// 🚀 SCALABILITY: Paginação obrigatória para suportar 120k+ usuários
// ⚠️ IMPORTANTE: Este endpoint DEVE estar ANTES de /:orderId para evitar route collision
router.get('/by-tenant/:tenantId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const { limit: queryLimit, cursor } = req.query;
    
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
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando acessar orders do tenant ${tenantId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode ver suas próprias vendas' });
    }
    
    // 🚀 PAGINAÇÃO: Limitar resultados (default 50, max 9999 para aggregations)
    // CRITICAL: Permitir limit=9999 para métricas e KPIs que precisam de TODOS os dados
    const limit = Math.min(parseInt(queryLimit as string) || 50, 9999);
    
    console.log(`📦 Buscando orders para tenant: ${tenantId} (limit: ${limit}, cursor: ${cursor || 'início'})`);
    
    // 🔍 BUSCAR ORDERS DO FIREBASE
    const firebaseStorage = { db: getAdmin().firestore() } as any;
    
    let byTenantOrders: any[] = [];
    await neonQuery(async (sql) => {
      if (cursor) {
        byTenantOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${tenantId} AND id < ${cursor as string} ORDER BY created_at DESC LIMIT ${limit + 1}`;
      } else {
        byTenantOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${limit + 1}`;
      }
    }, `ordersByTenant:${tenantId}`);

    const hasMore = byTenantOrders.length > limit;
    const docs = hasMore ? byTenantOrders.slice(0, limit) : byTenantOrders;
    const nextCursor = hasMore ? docs[docs.length - 1].id : null;
    const orders = docs.map((o: any) => normalizeOrderForResponse({ id: o.id, ...o, tenantId: o.tenant_id, checkoutId: o.checkout_id, createdAt: o.created_at, paidAt: o.paid_at }, null));

    console.log(`📦 ✅ ${orders.length} orders encontradas (hasMore: ${hasMore})`);
    res.json({ data: orders, pagination: { hasMore, nextCursor, limit, count: orders.length } });
    
  } catch (error) {
    console.error('❌ Erro ao buscar orders by tenant:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/:orderId/status', async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId é obrigatório' });
    }
    
    const firebaseStorage = { db: getAdmin().firestore() } as any;
    
    // 🐘 Neon-first: status da order sem round-trip ao Firebase
    try {
      const { neonReadOrder } = await import('../lib/neon-reads.js');
      const neonOrder = await neonReadOrder(orderId);
      if (neonOrder) {
        return res.json({
          orderId: neonOrder.id,
          status: neonOrder.status,
          method: neonOrder.method,
          createdAt: neonOrder.createdAt,
          paidAt: neonOrder.paidAt,
        });
      }
    } catch {}

    let neonStatusOrder: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, method, created_at, paid_at FROM orders WHERE id = ${orderId} LIMIT 1`;
      neonStatusOrder = rows[0] || null;
    }, `orderStatus:${orderId}`);
    if (!neonStatusOrder) return res.status(404).json({ error: 'Order não encontrada' });
    return res.json({ orderId: neonStatusOrder.id, status: neonStatusOrder.status, method: neonStatusOrder.method, createdAt: neonStatusOrder.created_at, paidAt: neonStatusOrder.paid_at });
    
  } catch (error) {
    console.error('❌ Erro ao buscar status da order:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/:orderId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId é obrigatório' });
    }
    
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const firebaseStorage = { db: getAdmin().firestore() } as any;
    
    let orderData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) orderData = { ...rows[0], tenantId: rows[0].tenant_id, checkoutId: rows[0].checkout_id, createdAt: rows[0].created_at, paidAt: rows[0].paid_at, affiliateId: rows[0].affiliate_id };
    }, `orderDetail:${orderId}`);

    if (!orderData) {
      return res.status(404).json({ error: 'Order não encontrada' });
    }

    const isAdmin = user.customClaims?.admin === true;
    const isOwnTenant = user.uid === orderData.tenantId;
    const isOwnAffiliate = user.uid === (orderData.affiliateUid || orderData.affiliateId);

    if (!isAdmin && !isOwnTenant && !isOwnAffiliate) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando acessar order ${orderId} do tenant ${orderData.tenantId}`);
      return res.status(403).json({ error: 'Acesso negado' });
    }

    let checkoutData: any = null;
    if (orderData.checkoutId) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT * FROM checkouts WHERE id = ${orderData.checkoutId} LIMIT 1`;
        if (rows[0]) checkoutData = rows[0];
      }, `orderDetailCheckout:${orderData.checkoutId}`);
    }

    let affiliateCommission: any = null;
    // affiliateCommissions not in Neon yet — skip gracefully

    const orderDetails: any = normalizeOrderForResponse({ id: orderId, ...orderData }, checkoutData);

    if (isOwnAffiliate && !isOwnTenant) {
      orderDetails.isMyAffiliateSale = true;
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT name, business_name, email FROM sellers WHERE id = ${orderData.tenantId} LIMIT 1`;
        if (rows[0]) orderDetails.sellerName = rows[0].business_name || rows[0].name || rows[0].email?.split('@')[0] || 'Vendedor';
      }, `orderDetailSeller:${orderData.tenantId}`);
    }

    orderDetails.checkoutDeleted = checkoutData ? false : true;
    console.log(`✅ Detalhes da order ${orderId} retornados`);
    res.json(orderDetails);
    
  } catch (error) {
    console.error('❌ Erro ao buscar detalhes da order:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💰 ENDPOINT PARA CALCULAR SALDOS REAIS POR MEIO DE PAGAMENTO
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.get('/balances/:tenantId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    
    // 🔐 SECURITY: Verificar se usuário tem acesso a este tenant
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const isAdmin = user.customClaims?.admin === true;
    const isOwnTenant = user.uid === tenantId;
    
    if (!isAdmin && !isOwnTenant) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando acessar saldos do tenant ${tenantId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode ver seus próprios saldos' });
    }

    // 🔒 Bloquear sellers rejeitados/bloqueados de acessar dados financeiros
    if (!isAdmin) {
      let sellerStatus: string | null = null;
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT status FROM sellers WHERE id = ${tenantId} LIMIT 1`;
        if (rows[0]) sellerStatus = rows[0].status;
      }, `balancesSellerCheck:${tenantId}`);
      if (sellerStatus === 'rejected' || sellerStatus === 'blocked') {
        console.warn(`🚨 [BALANCES] Seller ${tenantId} com status '${sellerStatus}' tentou acessar saldos`);
        return res.status(403).json({ error: 'Conta suspensa ou rejeitada. Entre em contato com o suporte.' });
      }
    }

    console.log('💰 Calculando saldos REAIS para tenant:', tenantId);

    // 🔥 BUSCAR CONFIGURAÇÕES DE TAXAS DO ADMIN (da tabela payment_config no Neon)
    let pixFeePercent: number;
    let pixFeeFixed: number;
    let cardBRFeePercent: number;
    let cardBRFeeFixed: number;
    let cardGlobalFeePercent: number;
    let cardGlobalFeeFixed: number;
    let boletoFeePercent: number;
    let boletoFeeFixed: number;
    let pixWithdrawalDays: number;
    let cardBRWithdrawalDays: number;
    let cardGlobalWithdrawalDays: number;
    let boletoWithdrawalDays: number;

    let config: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT config FROM payment_config WHERE id = 'acquirers' LIMIT 1`;
      if (rows[0]) config = rows[0].config;
    }, 'balancesAcquirersConfig');

    if (!config) {
      return res.status(500).json({
        error: 'Configuração de adquirentes não encontrada',
        message: 'Configure as taxas em Admin > Adquirentes primeiro'
      });
    }

    if (!config.efibank?.pixFeePercent) {
      return res.status(500).json({
        error: 'Taxa PIX não configurada',
        message: 'Configure as taxas do EfíBank em Admin > Adquirentes'
      });
    }

    pixFeePercent = config.efibank.pixFeePercent;
    pixFeeFixed = config.efibank.pixFeeFixed || 0;
    cardBRFeePercent = config.efibank.cardFeePercent || config.efibank.installment1x || 0;
    cardBRFeeFixed = config.efibank.cardFeeFixed || 0;
    pixWithdrawalDays = config.efibank.releaseDays || 0;
    cardBRWithdrawalDays = config.efibank.releaseDays || 0;

    if (config.stripe) {
      cardGlobalFeePercent = config.stripe.cardFeePercent || config.stripe.installment1x || 0;
      cardGlobalFeeFixed = config.stripe.cardFeeFixed || 0;
      cardGlobalWithdrawalDays = config.stripe.releaseDays || 0;
    } else {
      cardGlobalFeePercent = 0; cardGlobalFeeFixed = 0; cardGlobalWithdrawalDays = 0;
    }

    if (config.pagarme) {
      boletoFeePercent = config.pagarme.boletoFeePercent || 0;
      boletoFeeFixed = config.pagarme.boletoFeeFixed || 0;
      boletoWithdrawalDays = config.pagarme.releaseDays || 0;
    } else {
      boletoFeePercent = 0; boletoFeeFixed = 0; boletoWithdrawalDays = 0;
    }

    console.log('✅ [BALANCES] Taxas do Admin: PIX=', pixFeePercent, '%+R$', (pixFeeFixed/100).toFixed(2));

    // Buscar todas as orders PAID do tenant via Neon
    let paidOrders: any[] = [];
    await neonQuery(async (sql) => {
      paidOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${tenantId} AND status = 'paid'`;
    }, `balancesOrders:${tenantId}`);

    const now = Date.now();

    // Comissões de afiliados: não migradas ainda, usar mapa vazio
    const commissionsMap = new Map<string, number>();
    let commissionsWithoutOrderId = 0;
    
    console.log(`💰 Mapa de comissões: vazio (affiliateCommissions não migradas ainda)`);

    // Inicializar saldos
    const balances = {
      pix: { available: 0, processing: 0, grossRevenue: 0 },
      cardBR: { available: 0, processing: 0, grossRevenue: 0 },
      cardGlobal: { available: 0, processing: 0, grossRevenue: 0 },
      boleto: { available: 0, processing: 0, grossRevenue: 0 }
    };

    paidOrders.forEach((orderData: any) => {
      const orderId = orderData.id;
      const amount = orderData.amount || 0;
      const method = orderData.method || 'pix';
      const gateway = orderData.gateway || 'efibank';
      const paidAtRaw = orderData.paid_at;
      const paidAtTimestamp = paidAtRaw ? new Date(paidAtRaw).getTime() : now;
      const daysSincePaid = (now - paidAtTimestamp) / (1000 * 60 * 60 * 24);
      
      let feePercent = 0;
      let feeFixed = 0;
      let withdrawalDays = 0;
      let balanceKey: 'pix' | 'cardBR' | 'cardGlobal' | 'boleto' = 'pix';
      
      // Determinar taxas e chave do saldo baseado no método e gateway
      if (method === 'pix') {
        feePercent = pixFeePercent;
        feeFixed = pixFeeFixed;
        withdrawalDays = orderData.withdrawalDays !== undefined ? orderData.withdrawalDays : pixWithdrawalDays;
        balanceKey = 'pix';
      } else if (method === 'credit_card' || method === 'card') {
        if (gateway === 'stripe' || gateway === 'adyen') {
          feePercent = cardGlobalFeePercent;
          feeFixed = cardGlobalFeeFixed;
          withdrawalDays = orderData.withdrawalDays !== undefined ? orderData.withdrawalDays : cardGlobalWithdrawalDays;
          balanceKey = 'cardGlobal';
        } else {
          feePercent = cardBRFeePercent;
          feeFixed = cardBRFeeFixed;
          withdrawalDays = orderData.withdrawalDays !== undefined ? orderData.withdrawalDays : cardBRWithdrawalDays;
          balanceKey = 'cardBR';
        }
      } else if (method === 'boleto') {
        feePercent = boletoFeePercent;
        feeFixed = boletoFeeFixed;
        withdrawalDays = orderData.withdrawalDays !== undefined ? orderData.withdrawalDays : boletoWithdrawalDays;
        balanceKey = 'boleto';
      }
      
      // 🔥 BUG FIX CRÍTICO: Usar netAmount REAL da ordem (já descontado de comissões de afiliado)
      // Se a ordem já tem sellerNetAmount ou netAmount (comissão já descontada), usar esse valor
      // Caso contrário, recalcular (orders antigas sem comissão)
      let netAmount: number;
      
      if (orderData.sellerNetAmount !== undefined && orderData.sellerNetAmount !== null) {
        // Valor REAL do seller após todas as deduções (gateway fees + comissão afiliado)
        netAmount = orderData.sellerNetAmount;
      } else if (orderData.netAmount !== undefined && orderData.netAmount !== null) {
        // Fallback: usar netAmount se sellerNetAmount não existir
        netAmount = orderData.netAmount;
        
        // 🔥 CRITICAL FIX: Descontar comissão de afiliado se existir
        const affiliateCommission = commissionsMap.get(orderId); // ✅ Usar orderId (doc.id) em vez de orderData.id
        if (affiliateCommission && affiliateCommission > 0) {
          netAmount -= affiliateCommission;
          console.log(`💸 Ordem ${orderId}: Descontando comissão de R$ ${(affiliateCommission/100).toFixed(2)} (netAmount final: R$ ${(netAmount/100).toFixed(2)})`);
        }
      } else {
        // Fallback final: recalcular para orders antigas (antes de processAffiliateCommission)
        const percentFeeAmount = Math.round(amount * (feePercent / 100));
        netAmount = amount - percentFeeAmount - feeFixed;
        
        // 🔥 CRITICAL FIX: Descontar comissão de afiliado se existir
        const affiliateCommission = commissionsMap.get(orderId); // ✅ Usar orderId (doc.id) em vez de orderData.id
        if (affiliateCommission && affiliateCommission > 0) {
          netAmount -= affiliateCommission;
          console.log(`💸 Ordem ${orderId}: Descontando comissão de R$ ${(affiliateCommission/100).toFixed(2)} (netAmount final: R$ ${(netAmount/100).toFixed(2)})`);
        }
      }
      
      // Adicionar ao saldo bruto
      balances[balanceKey].grossRevenue += amount;
      
      // Verificar se está disponível ou em processamento
      if (daysSincePaid >= withdrawalDays) {
        balances[balanceKey].available += netAmount;
      } else {
        balances[balanceKey].processing += netAmount;
      }
    });

    // 💰 DESCONTAR SAQUES PENDENTES/APROVADOS/PROCESSANDO DO SALDO DISPONÍVEL
    try {
      let pendingWithdrawals: any[] = [];
      await neonQuery(async (sql) => {
        pendingWithdrawals = await sql`SELECT * FROM withdrawals WHERE seller_id = ${tenantId} AND status = ANY(ARRAY['pending','approved','processing'])`;
      }, `balancesWithdrawals:${tenantId}`);
      pendingWithdrawals.forEach(withdrawal => {
        const amount = withdrawal.amount || 0;
        const type = withdrawal.type || 'pix';
        let balanceKey: 'pix' | 'cardBR' | 'cardGlobal' | 'boleto' = 'pix';
        if (type === 'cardBR') balanceKey = 'cardBR';
        else if (type === 'cardGlobal') balanceKey = 'cardGlobal';
        else if (type === 'boleto') balanceKey = 'boleto';
        balances[balanceKey].available -= amount;
        console.log(`💸 Saque ${withdrawal.id} (${type}): Descontando R$ ${(amount/100).toFixed(2)} do disponível`);
      });
      console.log('📊 Saldos após descontar saques:', balances);
    } catch (error) {
      console.warn('⚠️ Erro ao buscar saques pendentes:', error);
    }

    // 💰 DESCONTAR REEMBOLSOS — refund_debits não migrados ainda, skip gracefully
    
    console.log('📊 Saldos finais:', balances);
    res.json(balances);
    
  } catch (error) {
    console.error('❌ Erro ao calcular saldos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 ENDPOINT PARA CALCULAR MÉTRICAS DE CONVERSÃO POR MÉTODO DE PAGAMENTO
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.get('/metrics/:tenantId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    
    // 🔐 SECURITY: Verificar se usuário tem acesso a este tenant
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const isAdmin = user.customClaims?.admin === true;
    const isOwnTenant = user.uid === tenantId;
    
    if (!isAdmin && !isOwnTenant) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando acessar métricas do tenant ${tenantId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode ver suas próprias métricas' });
    }
    
    console.log('📊 Calculando métricas via API backend para tenant:', tenantId);

    let metricsOrders: any[] = [];
    await neonQuery(async (sql) => {
      metricsOrders = await sql`SELECT method, gateway, status FROM orders WHERE tenant_id = ${tenantId}`;
    }, `metrics:${tenantId}`);

    const counters = {
      pix: { paid: 0, pending: 0 },
      cardBR: { paid: 0, pending: 0 },
      cardGlobal: { paid: 0, pending: 0 },
      boleto: { paid: 0, pending: 0 }
    };

    metricsOrders.forEach((orderData: any) => {
      const method = orderData.method || 'pix';
      const gateway = orderData.gateway || 'efibank';
      const status = orderData.status || 'pending';
      
      let metricKey: 'pix' | 'cardBR' | 'cardGlobal' | 'boleto' = 'pix';
      
      // Determinar chave da métrica baseado no método e gateway
      if (method === 'pix') {
        metricKey = 'pix';
      } else if (method === 'credit_card' || method === 'card') {
        if (gateway === 'stripe' || gateway === 'adyen') {
          metricKey = 'cardGlobal';
        } else {
          metricKey = 'cardBR';
        }
      } else if (method === 'boleto') {
        metricKey = 'boleto';
      }
      
      // Contar status
      if (status === 'paid') {
        counters[metricKey].paid++;
      } else if (status === 'pending') {
        counters[metricKey].pending++;
      }
    });
    
    // Formatar resposta para o frontend com paidPercent e pendingPercent
    const metrics = {
      pixMetrics: {
        paid: counters.pix.paid,
        pending: counters.pix.pending,
        paidPercent: counters.pix.paid + counters.pix.pending > 0 
          ? Math.round((counters.pix.paid / (counters.pix.paid + counters.pix.pending)) * 100)
          : 0,
        pendingPercent: counters.pix.paid + counters.pix.pending > 0
          ? Math.round((counters.pix.pending / (counters.pix.paid + counters.pix.pending)) * 100)
          : 0
      },
      cardBRMetrics: {
        paid: counters.cardBR.paid,
        pending: counters.cardBR.pending,
        paidPercent: counters.cardBR.paid + counters.cardBR.pending > 0
          ? Math.round((counters.cardBR.paid / (counters.cardBR.paid + counters.cardBR.pending)) * 100)
          : 0,
        pendingPercent: counters.cardBR.paid + counters.cardBR.pending > 0
          ? Math.round((counters.cardBR.pending / (counters.cardBR.paid + counters.cardBR.pending)) * 100)
          : 0
      },
      cardGlobalMetrics: {
        paid: counters.cardGlobal.paid,
        pending: counters.cardGlobal.pending,
        paidPercent: counters.cardGlobal.paid + counters.cardGlobal.pending > 0
          ? Math.round((counters.cardGlobal.paid / (counters.cardGlobal.paid + counters.cardGlobal.pending)) * 100)
          : 0,
        pendingPercent: counters.cardGlobal.paid + counters.cardGlobal.pending > 0
          ? Math.round((counters.cardGlobal.pending / (counters.cardGlobal.paid + counters.cardGlobal.pending)) * 100)
          : 0
      },
      boletoMetrics: {
        paid: counters.boleto.paid,
        pending: counters.boleto.pending,
        paidPercent: counters.boleto.paid + counters.boleto.pending > 0
          ? Math.round((counters.boleto.paid / (counters.boleto.paid + counters.boleto.pending)) * 100)
          : 0,
        pendingPercent: counters.boleto.paid + counters.boleto.pending > 0
          ? Math.round((counters.boleto.pending / (counters.boleto.paid + counters.boleto.pending)) * 100)
          : 0
      }
    };

    console.log('📊 Métricas calculadas (formato frontend):', metrics);
    res.json(metrics);
    
  } catch (error) {
    console.error('❌ Erro ao calcular métricas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔄 ADMIN: Marcar ordem como CHARGEBACK (REQUER AUTENTICAÇÃO ADMIN)
router.post('/admin/chargeback', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId, reason } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId é obrigatório' });
    }
    
    let prevData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, tenant_id FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) prevData = rows[0];
    }, `chargebackFetch:${orderId}`);
    if (!prevData) return res.status(404).json({ error: 'Ordem não encontrada' });

    await neonQuery(async (sql) => {
      await sql`UPDATE orders SET status='chargeback', chargeback_at=NOW(), chargeback_reason=${reason || 'Cliente contestou no banco'}, previous_status=${prevData.status}, updated_at=NOW() WHERE id=${orderId}`;
    }, `chargebackUpdate:${orderId}`);

    syncOrderAfterUpdate(prevData.tenant_id, orderId, { status: 'chargeback' });
    sendOrderStatusUpdate(prevData.tenant_id, orderId, 'chargedback')
      .catch(err => console.warn('[UTMify] Async chargeback update failed:', err?.message));

    console.log(`⚠️ Ordem ${orderId} marcada como CHARGEBACK`);
    res.json({ success: true, message: 'Ordem marcada como chargeback', orderId, newStatus: 'chargeback' });
    
  } catch (error) {
    console.error('❌ Erro ao marcar chargeback:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💰 ADMIN: Marcar ordem como REFUNDED (reembolsada) (REQUER AUTENTICAÇÃO ADMIN)
router.post('/admin/refund', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId, reason, amount } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId é obrigatório' });
    }
    
    let refundOrderData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, amount, tenant_id FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) refundOrderData = rows[0];
    }, `refundFetch:${orderId}`);
    if (!refundOrderData) return res.status(404).json({ error: 'Ordem não encontrada' });

    await neonQuery(async (sql) => {
      await sql`UPDATE orders SET status='refunded', refunded_at=NOW(), refund_reason=${reason || 'Solicitado pelo cliente'}, refund_amount=${amount || refundOrderData.amount}, previous_status=${refundOrderData.status}, updated_at=NOW() WHERE id=${orderId}`;
    }, `refundUpdate:${orderId}`);

    syncOrderAfterUpdate(refundOrderData.tenant_id, orderId, { status: 'refunded' });
    sendOrderStatusUpdate(refundOrderData.tenant_id, orderId, 'refunded', { refundedAt: new Date() })
      .catch(err => console.warn('[UTMify] Async refund update failed:', err?.message));

    console.log(`💰 Ordem ${orderId} marcada como REFUNDED`);
    res.json({ success: true, message: 'Ordem reembolsada com sucesso', orderId, newStatus: 'refunded', refundAmount: amount || refundOrderData.amount });
    
  } catch (error) {
    console.error('❌ Erro ao processar reembolso:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ⏰ ADMIN: Marcar ordem como EXPIRED (expirada) (REQUER AUTENTICAÇÃO ADMIN)
router.post('/admin/expire', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId é obrigatório' });
    }
    
    let expireOrderData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, tenant_id FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) expireOrderData = rows[0];
    }, `expireFetch:${orderId}`);
    if (!expireOrderData) return res.status(404).json({ error: 'Ordem não encontrada' });
    if (expireOrderData.status !== 'pending') return res.status(400).json({ error: 'Apenas ordens pendentes podem ser marcadas como expiradas', currentStatus: expireOrderData.status });

    await neonQuery(async (sql) => {
      await sql`UPDATE orders SET status='expired', expired_at=NOW(), previous_status='pending', updated_at=NOW() WHERE id=${orderId}`;
    }, `expireUpdate:${orderId}`);

    syncOrderAfterUpdate(expireOrderData.tenant_id, orderId, { status: 'expired' });
    sendOrderStatusUpdate(expireOrderData.tenant_id, orderId, 'expired')
      .catch(err => console.warn('[UTMify] Async expired update failed:', err?.message));

    console.log(`⏰ Ordem ${orderId} marcada como EXPIRED`);
    res.json({ success: true, message: 'Ordem marcada como expirada', orderId, newStatus: 'expired' });
    
  } catch (error) {
    console.error('❌ Erro ao expirar ordem:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔧 ENDPOINT ADMINISTRATIVO TEMPORÁRIO: BUSCAR E CORRIGIR VENDA ESPECÍFICA
// 🔒 CRITICAL SECURITY FIX: verifyFirebaseToken DEVE vir ANTES de requireAdmin
router.post('/admin/fix-order-status', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    const { customerEmail, sellerEmail, newStatus } = req.body;
    
    if (!customerEmail || !sellerEmail || !newStatus) {
      return res.status(400).json({ 
        error: 'customerEmail, sellerEmail e newStatus são obrigatórios' 
      });
    }
    
    console.log('🔧 ADMIN FIX: Buscando ordem para corrigir...');
    console.log(`   Cliente: ${customerEmail}`);
    console.log(`   Seller: ${sellerEmail}`);
    console.log(`   Novo status: ${newStatus}`);
    
    let fixSellerId: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE email = ${sellerEmail as string} LIMIT 1`;
      if (rows[0]) fixSellerId = rows[0].id;
    }, 'fixOrderStatusSeller');
    if (!fixSellerId) return res.status(404).json({ error: 'Seller não encontrado' });
    console.log(`   Seller ID: ${fixSellerId}`);

    let fixOrders: any[] = [];
    await neonQuery(async (sql) => {
      fixOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${fixSellerId} AND customer_email = ${customerEmail as string} ORDER BY created_at DESC`;
    }, 'fixOrderStatusOrders');
    if (fixOrders.length === 0) return res.status(404).json({ error: 'Ordem não encontrada', details: `Nenhuma ordem encontrada para ${customerEmail} do seller ${sellerEmail}` });

    const targetOrder = fixOrders[0];
    console.log(`   Ordem selecionada: ${targetOrder.id}, status: ${targetOrder.status}, valor: R$ ${((targetOrder.amount || 0)/100).toFixed(2)}`);

    let paidAtUpdate: Date | null = targetOrder.paid_at;
    if (newStatus === 'pending') paidAtUpdate = null;
    if (newStatus === 'paid' && !targetOrder.paid_at) paidAtUpdate = new Date();

    await neonQuery(async (sql) => {
      await sql`UPDATE orders SET status=${newStatus}, updated_at=NOW(), admin_correction_by=${req.user?.uid}, admin_correction_at=NOW(), previous_status=${targetOrder.status}, paid_at=${paidAtUpdate} WHERE id=${targetOrder.id}`;
    }, `fixOrderStatusUpdate:${targetOrder.id}`);

    syncOrderAfterUpdate(targetOrder.tenant_id || fixSellerId, targetOrder.id, { status: newStatus });
    sendOrderStatusUpdate(targetOrder.tenant_id || fixSellerId, targetOrder.id, newStatus)
      .catch(err => console.warn('[UTMify] Async admin status correction update failed:', err?.message));

    console.log(`✅ Status corrigido: ${targetOrder.status} → ${newStatus}`);
    res.json({ success: true, message: 'Status da ordem corrigido com sucesso', order: { id: targetOrder.id, customerEmail: targetOrder.customer_email, amount: targetOrder.amount, oldStatus: targetOrder.status, newStatus, correctedAt: new Date() } });
    
  } catch (error) {
    console.error('❌ Erro ao corrigir status da ordem:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔍 ENDPOINT ADMINISTRATIVO: BUSCAR VENDAS POR SELLER E DATA
// 🔒 CRITICAL SECURITY FIX: verifyFirebaseToken DEVE vir ANTES de requireAdmin
router.get('/admin/search-orders', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerEmail, startDate, endDate } = req.query;
    
    if (!sellerEmail) {
      return res.status(400).json({ error: 'sellerEmail é obrigatório' });
    }
    
    let searchSellerId: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE email = ${sellerEmail as string} LIMIT 1`;
      if (rows[0]) searchSellerId = rows[0].id;
    }, 'searchOrdersSeller');
    if (!searchSellerId) return res.status(404).json({ error: 'Seller não encontrado' });

    let searchOrders: any[] = [];
    await neonQuery(async (sql) => {
      if (startDate && endDate) {
        searchOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${searchSellerId} AND created_at >= ${new Date(startDate as string)} AND created_at <= ${new Date(endDate as string)} ORDER BY created_at DESC`;
      } else if (startDate) {
        searchOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${searchSellerId} AND created_at >= ${new Date(startDate as string)} ORDER BY created_at DESC`;
      } else if (endDate) {
        searchOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${searchSellerId} AND created_at <= ${new Date(endDate as string)} ORDER BY created_at DESC`;
      } else {
        searchOrders = await sql`SELECT * FROM orders WHERE tenant_id = ${searchSellerId} ORDER BY created_at DESC`;
      }
    }, 'searchOrders');

    const searchCheckoutIds = [...new Set(searchOrders.map((o: any) => o.checkout_id).filter(Boolean))];
    const searchCheckoutsMap = new Map<string, any>();
    if (searchCheckoutIds.length > 0) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT * FROM checkouts WHERE id = ANY(${searchCheckoutIds}::text[])`;
        rows.forEach((r: any) => searchCheckoutsMap.set(r.id, r));
      }, 'searchOrdersCheckouts');
    }

    const orders = searchOrders.map((o: any) => {
      const checkoutData = searchCheckoutsMap.get(o.checkout_id);
      return normalizeOrderForResponse({ id: o.id, ...o, tenantId: o.tenant_id, checkoutId: o.checkout_id, createdAt: o.created_at, paidAt: o.paid_at }, checkoutData);
    });

    res.json({ seller: { id: searchSellerId, email: sellerEmail }, totalOrders: orders.length, orders });
    
  } catch (error) {
    console.error('❌ Erro ao buscar ordens:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/admin/backfill-rtdb', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId é obrigatório' });
    }
    
    const firebaseStorage = { db: getAdmin().firestore() } as any;
    
    console.log(`🔄 [BACKFILL] Admin ${req.user?.uid} iniciando backfill para tenant ${tenantId}`);
    
    const result = await backfillOrdersToRTDB(firebaseStorage.db, tenantId);
    
    res.json({
      success: true,
      message: `Backfill concluído para tenant ${tenantId}`,
      ...result
    });
    
  } catch (error) {
    console.error('❌ Erro no backfill:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
