import { Router } from 'express';
import express from 'express';
import admin from 'firebase-admin';
import { nanoid } from 'nanoid';
import { storage } from '../storage';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth';
import { sendPixPagoEmail, sendSellerApprovalEmail, sendSaleApprovedEmail } from '../lib/email-service';
import { syncOrderAfterUpdate } from '../lib/orders-sync.js';
import { sendOrderStatusUpdate } from '../lib/utmify-service.js';
import { 
  dispatchBoletoPaidEvent,
  dispatchSubscriptionCreatedEvent,
  dispatchSubscriptionRenewedEvent,
  dispatchSubscriptionCancelledEvent,
  dispatchSubscriptionPaymentFailedEvent,
} from '../lib/webhook-dispatcher';
import {
  validateWebhookSecurity,
  verifyOrderOwnership,
  verifySubscriptionOwnership,
  markWebhookProcessed,
  calculateFinancialSnapshot
} from '../lib/webhook-security';
import { loadWooviConfig, validateWooviWebhook } from '../lib/woovi-api';
import {
  processWebhookWithBalanceUpdate,
  addToBalance,
  subtractFromBalance
} from '../lib/atomic-balance';
import { firestoreCache } from '../lib/firestore-cache.js';
import { autoCreateMemberOnPurchase, processCoproductionCommissions } from './members-coproduction.js';
import { sendSaleNotification } from '../lib/push-notification-service.js';
import { sendXtrackyConversion } from '../lib/xtracky-service.js';
import { sendDiscordNotification } from '../lib/discord-service.js';

const router = Router();

// Helper: cria subscription via Neon se produto for assinatura
async function neonCreateSubscriptionIfNeeded(orderData: any, orderId: string, neonQ: Function) {
  try {
    const product = await firestoreCache.getProduct(orderData.productId);
    if (!product || product.productType !== 'subscription') return;

    const { neonWriteSubscription } = await import('../lib/neon-subscriptions.js');

    // Idempotência: verificar se já existe
    let alreadyExists = false;
    await neonQ(async (sql: any) => {
      const rows = await sql`SELECT id FROM subscriptions WHERE order_id = ${orderId} LIMIT 1`;
      if (rows[0]) alreadyExists = true;
    }, `sub:check:${orderId}`);
    if (alreadyExists) { console.log(`⚠️ Subscription já existe para ordem ${orderId}`); return; }

    const subscriptionId = 'sub_' + nanoid(21);
    const billingCycle = product.billingCycle || product.subscriptionPeriod || 'mensal';
    const nextBillingDate = new Date();
    switch (billingCycle) {
      case 'mensal': case 'monthly': nextBillingDate.setMonth(nextBillingDate.getMonth() + 1); break;
      case 'trimestral': case 'quarterly': nextBillingDate.setMonth(nextBillingDate.getMonth() + 3); break;
      case 'semestral': case 'semiannual': nextBillingDate.setMonth(nextBillingDate.getMonth() + 6); break;
      case 'anual': case 'annual': nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1); break;
      default: nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }
    const normalizedPeriod = ({ mensal: 'monthly', trimestral: 'quarterly', semestral: 'semiannual', anual: 'annual' } as Record<string, string>)[billingCycle] || billingCycle;
    const isCardPayment = orderData.paymentMethod === 'card' || orderData.paymentMethod === 'credit_card' || orderData.method === 'card';
    const cardPaymentToken = orderData.payment_token || orderData.cardPaymentToken || null;

    await neonWriteSubscription({
      id: subscriptionId,
      customerId: orderData.customerId,
      customerName: orderData.customer?.name || orderData.customer?.email?.split('@')[0] || 'Cliente',
      customerEmail: orderData.customer?.email,
      customerPhone: orderData.customer?.phone || null,
      customerDocument: orderData.customer?.document || null,
      tenantId: orderData.tenantId,
      productId: orderData.productId,
      productName: product.name || product.title || 'Subscription',
      orderId,
      status: 'active',
      billingCycle,
      period: normalizedPeriod,
      amount: orderData.amount,
      currency: orderData.currency || 'BRL',
      recurringCount: 1,
      method: isCardPayment ? 'card' : (orderData.paymentMethod || 'pix'),
      autoRenew: isCardPayment && !!cardPaymentToken,
      dunningAttempts: 0,
      nextBillingDate,
      currentPeriodStart: new Date(),
      currentPeriodEnd: nextBillingDate,
    });
    console.log(`✅ Subscription criada via Neon: ${subscriptionId} (${normalizedPeriod})`);
  } catch (e: any) {
    console.error(`⚠️ neonCreateSubscriptionIfNeeded err:`, e?.message);
  }
}

// 🔍 ENDPOINT DE DIAGNÓSTICO - PROTEGIDO COM AUTENTICAÇÃO ADMIN
router.get('/diagnostic', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const { neonQuery } = await import('../lib/neon-db.js');

    let ordersByStatus: Record<string, number> = {};
    let ordersByMethod: Record<string, number> = {};
    let totalPaid = 0;
    let totalPaidAmount = 0;

    await neonQuery(async (sql: any) => {
      const rows = await sql`SELECT status, method, amount FROM orders LIMIT 1000`;
      for (const row of rows) {
        const status = row.status || 'unknown';
        const method = row.method || 'unknown';
        ordersByStatus[status] = (ordersByStatus[status] || 0) + 1;
        ordersByMethod[method] = (ordersByMethod[method] || 0) + 1;
        if (status === 'paid') { totalPaid++; totalPaidAmount += row.amount || 0; }
      }
    }, 'diagnostic:orders');

    const sellerBalances: any[] = [];
    await neonQuery(async (sql: any) => {
      const rows = await sql`SELECT seller_id, available_balance, total_balance, pending_balance FROM seller_balances`;
      for (const row of rows) {
        sellerBalances.push({
          sellerId: row.seller_id,
          availableBRL: (row.available_balance || 0) / 100,
          totalBRL: (row.total_balance || 0) / 100,
          pendingBRL: (row.pending_balance || 0) / 100
        });
      }
    }, 'diagnostic:balances');

    return res.json({
      timestamp: new Date().toISOString(),
      orders: {
        byStatus: ordersByStatus,
        byMethod: ordersByMethod,
        totalPaid,
        totalPaidAmount: totalPaidAmount / 100
      },
      balances: {
        sellers: sellerBalances
      },
      webhook: {
        endpoint: '/api/webhooks/woovi',
        fullUrl: `https://${req.get('host')}/api/webhooks/woovi`,
        status: 'active'
      }
    });
  } catch (error: any) {
    console.error('❌ Erro no diagnóstico:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 🎓 HELPER: Criar CustomerProfile e MemberEntitlement automaticamente após pagamento
async function createCustomerEntitlementOnPayment(order: any) {
  try {
    const customerEmail = order.customer?.email;
    const customerName = order.customer?.name || customerEmail?.split('@')[0] || 'Cliente';
    if (!customerEmail) { console.log('⚠️ Ordem sem email de cliente - pulando criação de entitlement'); return; }

    let customerProfile = await storage.getCustomerProfileByEmail(customerEmail);
    if (!customerProfile) {
      customerProfile = await storage.createCustomerProfile({ email: customerEmail, name: customerName, firebaseUid: null });
    }

    const existingEntitlement = await storage.getMemberEntitlementByOrder(order.id);
    if (existingEntitlement) { return existingEntitlement; }

    const product = await storage.getProduct(order.productId);
    let billingCycle: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | undefined = undefined;
    let accessEndDate: Date | null = null;

    if (order.productType === 'subscription' && product) {
      const subscriptionPeriod = order.subscriptionPeriod || (product as any).subscriptionPeriod || (product as any).billingCycle;
      if (subscriptionPeriod) {
        const periodMap: Record<string, 'monthly' | 'quarterly' | 'semiannual' | 'annual'> = { mensal: 'monthly', monthly: 'monthly', trimestral: 'quarterly', quarterly: 'quarterly', semestral: 'semiannual', semiannual: 'semiannual', anual: 'annual', annual: 'annual' };
        billingCycle = periodMap[subscriptionPeriod] || 'monthly';
        const now = new Date();
        switch (subscriptionPeriod) {
          case 'mensal': case 'monthly': accessEndDate = new Date(now.setMonth(now.getMonth() + 1)); break;
          case 'trimestral': case 'quarterly': accessEndDate = new Date(now.setMonth(now.getMonth() + 3)); break;
          case 'semestral': case 'semiannual': accessEndDate = new Date(now.setMonth(now.getMonth() + 6)); break;
          case 'anual': case 'annual': accessEndDate = new Date(now.setFullYear(now.getFullYear() + 1)); break;
          default: accessEndDate = null;
        }
      }
    }

    const entitlement = await storage.createMemberEntitlement({ customerId: customerProfile.id, customerEmail, orderId: order.id, productId: order.productId, productTitle: order.productTitle || 'Produto', productType: order.productType || 'digital', tenantId: order.tenantId, billingCycle, accessStartDate: new Date(), accessEndDate });

    // ORDER BUMPS via Neon
    const orderBumps: any[] = order.selectedOrderBumps || [];
    if (orderBumps.length > 0) {
      const { neonQuery } = await import('../lib/neon-db.js');
      for (const bump of orderBumps) {
        try {
          const bumpCheckoutId = bump.checkoutId;
          if (!bumpCheckoutId) continue;

          let bumpProductId: string | null = null;
          let bumpTitle = bump.name || 'Produto adicional';
          await neonQuery(async (sql: any) => {
            const rows = await sql`SELECT id, title, product_id FROM checkouts WHERE id = ${bumpCheckoutId} LIMIT 1`;
            if (rows[0]) { bumpProductId = rows[0].product_id || rows[0].id; bumpTitle = bump.name || rows[0].title || bumpTitle; }
          }, `bumpCheckout:${bumpCheckoutId}`);
          if (!bumpProductId) continue;

          // Verificar idempotência via Neon enrollments
          let bumpExists = false;
          await neonQuery(async (sql: any) => {
            const rows = await sql`SELECT id FROM enrollments WHERE order_id = ${order.id} AND product_id = ${bumpProductId} LIMIT 1`;
            if (rows[0]) bumpExists = true;
          }, `bumpEntitlementCheck:${order.id}`);
          if (bumpExists) continue;

          const bumpProduct = await storage.getProduct(bumpProductId);
          await storage.createMemberEntitlement({ customerId: customerProfile!.id, customerEmail, orderId: order.id, productId: bumpProductId, productTitle: bumpTitle, productType: bumpProduct?.productType || 'digital', tenantId: order.tenantId, billingCycle: undefined, accessStartDate: new Date(), accessEndDate: null });
        } catch (bumpErr: any) {
          console.error(`❌ Erro ao criar entitlement para bump:`, bumpErr?.message);
        }
      }
    }

    return entitlement;
  } catch (error: any) {
    console.error(`❌ Erro ao criar customer entitlement:`, error?.message || error);
    return null;
  }
}

// 💸 WEBHOOK PARA PIX (WOOVI/EFIBANK) - CONFIRMAÇÃO AUTOMÁTICA DE PAGAMENTO
router.post('/woovi', express.json(), async (req, res) => {
  const startTime = Date.now();
  let idempotencyKey: string | null = null;
  let finalResponse: any = null;
  
  try {
    // 🔐 VALIDAR AUTENTICAÇÃO DO WEBHOOK WOOVI (fail-closed)
    const authHeader = req.headers['authorization'] as string | undefined;
    const wooviConfig = await loadWooviConfig();
    if (!wooviConfig?.webhookSecret) {
      console.error('🚨 WEBHOOK PIX REJEITADO: webhookSecret não configurado - bloqueando por segurança');
      return res.status(503).json({ error: 'Webhook não configurado' });
    }
    if (!validateWooviWebhook(authHeader, wooviConfig.webhookSecret)) {
      console.error('🚨 WEBHOOK PIX REJEITADO: Authorization header inválido');
      return res.status(401).json({ error: 'Webhook não autorizado' });
    }

    console.log('💸 WEBHOOK PIX RECEBIDO:', JSON.stringify(req.body, null, 2));
    
    const payload = req.body;
    const event: string = payload.event || '';

    // 🔍 EXTRAIR DADOS DO WEBHOOK WOOVI (suporta todos os formatos de evento)
    // OPENPIX:CHARGE_COMPLETED → payload.charge
    // OPENPIX:TRANSACTION_RECEIVED → payload.pix.charge
    // Fallback → payload direto
    let correlationID: string | undefined;
    let status: string | undefined;
    let value: number = 0;

    if (event === 'OPENPIX:CHARGE_COMPLETED' || event === 'OPENPIX:CHARGE_EXPIRED') {
      const charge = payload.charge || {};
      correlationID = charge.correlationID || charge.identifier;
      status = charge.status;
      value = charge.value || 0;
    } else if (event === 'OPENPIX:TRANSACTION_RECEIVED') {
      // Neste evento o correlationID fica dentro de pix.charge
      const pixCharge = payload.pix?.charge || payload.charge || {};
      correlationID = pixCharge.correlationID || pixCharge.identifier;
      status = pixCharge.status || 'COMPLETED'; // TRANSACTION_RECEIVED = pago
      value = payload.transaction?.value || payload.charge?.value || 0;
    } else {
      // Formato legado / sem campo event (EfíBank-style ou teste)
      const charge = payload.charge || payload.pix || payload;
      correlationID = charge.correlationID || charge.identifier || charge.transactionID;
      status = charge.status;
      value = charge.value || 0;
    }
    
    console.log(`📋 Webhook Woovi - Event: ${event}, Status: ${status}, CorrelationID: ${correlationID}, Valor: ${value}`);
    
    // ✅ PROCESSAR APENAS PAGAMENTOS CONFIRMADOS
    const isPaid = status === 'COMPLETED' || status === 'REALIZADO' || status === 'CONCLUIDA'
      || event === 'OPENPIX:CHARGE_COMPLETED' || event === 'OPENPIX:TRANSACTION_RECEIVED';
    if (!isPaid) {
      console.log(`⚠️ PIX não confirmado ainda - Status: ${status}, Event: ${event}`);
      return res.status(200).json({ success: true, message: 'Aguardando confirmação' });
    }
    
    // 🔍 BUSCAR ORDEM PELO CORRELATION ID
    if (!correlationID) {
      console.error('❌ CorrelationID ausente no webhook');
      return res.status(400).json({ error: 'CorrelationID obrigatório' });
    }
    
    console.log(`🔍 Buscando ordem com txid: ${correlationID}`);
    
    const { neonQuery } = await import('../lib/neon-db.js');

    // Buscar ordem pelo txid via Neon
    let orderData: any = null;
    let orderId: string = '';
    await neonQuery(async (sql: any) => {
      const rows = await sql`SELECT * FROM orders WHERE txid = ${correlationID} LIMIT 1`;
      if (rows[0]) { orderId = rows[0].id; orderData = rows[0]; }
    }, `webhookPix:findOrder:${correlationID}`);

    if (!orderData) {
      console.error(`❌ Ordem não encontrada com txid: ${correlationID}`);
      return res.status(404).json({ error: 'Ordem não encontrada' });
    }

    orderData.id = orderId;
    console.log(`✅ Ordem encontrada: ${orderId} - Status atual: ${orderData.status}`);

    idempotencyKey = `pix_${correlationID}_${orderId}`;

    // GATE 1: LOCK via Neon processed_webhooks (idempotência)
    let lockCreated = false;
    await neonQuery(async (sql: any) => {
      try {
        await sql`INSERT INTO processed_webhooks (id, status, created_at, metadata) VALUES (${idempotencyKey}, 'processing', NOW(), ${JSON.stringify({ correlationID, orderId, source: 'pix_woovi' })}::jsonb) ON CONFLICT (id) DO NOTHING`;
      } catch { /* ignore */ }
      const rows = await sql`SELECT id, status, response FROM processed_webhooks WHERE id = ${idempotencyKey} LIMIT 1`;
      if (rows[0]?.status === 'processing' && !rows[0]?.response) lockCreated = true;
      if (rows[0]?.response && orderData.status === 'paid') {
        lockCreated = false; // Duplicado
      }
    }, `webhookPix:lock:${idempotencyKey}`);

    if (!lockCreated && orderData.status === 'paid') {
      console.log(`⚠️ Webhook PIX duplicado - ordem já paga`);
      return res.status(200).json({ success: true, message: 'Webhook já processado anteriormente' });
    }
    
    // 🔐 GATE 2: Verificar se já está paga (proteção contra duplicação)
    if (orderData.status === 'paid') {
      console.log(`⚠️ Ordem ${orderId} já está paga - webhook duplicado bloqueado`);
      finalResponse = { success: true, message: 'Ordem já paga', orderId };
      return res.status(200).json(finalResponse);
    }
    
    // 💰 CALCULAR SNAPSHOT FINANCEIRO
    // ⚡ FIX: usar gateway real da ordem (woovi, efibank, etc.) — não hardcoded
    const _wooviGateway = orderData.gateway || 'woovi';
    const financialSnapshot = await calculateFinancialSnapshot(
      orderData.amount,
      'pix',
      _wooviGateway,
      1,
      orderData.tenantId
    );
    
    console.log(`💰 Snapshot financeiro criado:`, financialSnapshot);
    
    // 🔒 ATUALIZAR ORDEM PARA PAGO via Neon
    await neonQuery(async (sql: any) => {
      const fresh = await sql`SELECT status FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (fresh[0]?.status === 'paid') { console.log(`⚠️ RACE CONDITION - Ordem ${orderId} já paga`); return; }
      await sql`UPDATE orders SET status='paid', paid_at=NOW(), method='pix', processor=${_wooviGateway}, gateway=${_wooviGateway}, txid=${correlationID || orderId}, net_amount=${financialSnapshot.netAmount}, gateway_fee=${financialSnapshot.gatewayFee}, platform_fee=${financialSnapshot.platformFee}, release_date=${financialSnapshot.releaseDate}, financial_data=${JSON.stringify({ totalAmount: financialSnapshot.totalAmount, netAmount: financialSnapshot.netAmount, gatewayFee: financialSnapshot.gatewayFee, platformFee: financialSnapshot.platformFee, releaseDate: financialSnapshot.releaseDate, paidAt: new Date(), feeSnapshot: financialSnapshot.feeSnapshot })}::jsonb, updated_at=NOW() WHERE id=${orderId}`;
      console.log(`✅ PIX CONFIRMADO - Ordem ${orderId} atualizada para PAGO`);
    }, `webhookPix:updateOrder:${orderId}`);
    
    syncOrderAfterUpdate(orderData.tenantId, orderId, {
      status: 'paid',
      paidAt: new Date().toISOString(),
      method: 'pix',
      netAmount: financialSnapshot.netAmount,
      gatewayFee: financialSnapshot.gatewayFee
    });

    sendOrderStatusUpdate(orderData.tenantId, orderId, 'paid', { paidAt: new Date() })
      .catch(err => console.warn('[UTMify] Async PIX paid update failed:', err?.message));
    
    // 🎓 CRIAR ENROLLMENT AUTOMÁTICO (fire-and-forget)
    storage.createEnrollmentOnPayment({ ...orderData, id: orderId, paidAt: new Date() })
      .then(() => console.log(`✅ Enrollment criado: ${orderId}`))
      .catch((e: any) => console.error(`⚠️ Enrollment erro:`, e?.message));

    // 👤 AUTO-CRIAR CONTA DE MEMBRO (fire-and-forget)
    if (!orderData.productType || orderData.productType === 'digital' || orderData.productType === 'subscription') {
      autoCreateMemberOnPurchase({
        customerEmail: orderData.customer?.email || orderData.customerEmail,
        customerName: orderData.customer?.name || orderData.customerName,
        productId: orderData.productId,
        productType: orderData.productType || 'digital',
        orderId,
        checkoutId: orderData.checkoutId || orderData.checkoutSlug
      }).catch((e: any) => console.warn('⚠️ [AUTO-MEMBER] Pix err:', e?.message));
    }

    // 🎓 CRIAR CUSTOMER PROFILE + MEMBER ENTITLEMENT (fire-and-forget)
    createCustomerEntitlementOnPayment({ ...orderData, id: orderId, paidAt: new Date() })
      .catch((e: any) => console.error(`⚠️ Entitlement err:`, e?.message));
    
    // 🔁 CRIAR SUBSCRIPTION SE FOR PRODUTO DE ASSINATURA (via Neon)
    neonCreateSubscriptionIfNeeded(orderData, orderId, neonQuery).catch((e: any) => console.error(`⚠️ Subscription err:`, e?.message));
    
    // 💰 PROCESSAMENTO ATÔMICO: Webhook Deduplication + Balance Update (RACE-CONDITION FREE)
    console.log(`💰 Processando webhook atomicamente (deduplicação + balance)...`);
    let netAmountCents = Math.round(financialSnapshot.netAmount);
    let affiliateCommissionData: any = null;
    
    // 🔥 CALCULAR COMISSÃO ANTES DE CREDITAR VENDEDOR (garante atomicidade)
    if (orderData.affiliateCode || orderData.affiliateUid) {
      console.log(`💰 Calculando comissão do afiliado ANTES de creditar vendedor...`);
      try {
        affiliateCommissionData = await (storage as any).calculateAffiliateCommission(orderData);
        if (affiliateCommissionData.hasAffiliate && affiliateCommissionData.netCommission > 0) {
          netAmountCents = netAmountCents - affiliateCommissionData.netCommission;
        }
      } catch (calcError: any) {
        console.error(`⚠️ Erro ao calcular comissão:`, calcError?.message);
      }
    }
    
    const webhookResult = await processWebhookWithBalanceUpdate({
      webhookId: idempotencyKey,
      provider: 'woovi',
      eventType: 'pix.paid',
      sellerId: orderData.tenantId,
      amountCents: netAmountCents, // 🔥 JÁ DESCONTADA A COMISSÃO
      currency: 'BRL',
      operation: 'add',
      balanceType: 'available',
      reason: `Pagamento PIX recebido - Ordem ${orderId}`,
      orderId: orderId,
      metadata: {
        method: 'pix',
        acquirer: 'woovi',
        totalAmount: financialSnapshot.totalAmount,
        platformFee: financialSnapshot.platformFee,
        gatewayFee: financialSnapshot.gatewayFee,
        affiliateCommission: affiliateCommissionData?.netCommission || 0,
        customer: orderData.customer?.email
      },
      rawPayload: req.body
    });
    
    // Se webhook já foi processado (duplicado), retornar 200 imediatamente
    if (!webhookResult.processed) {
      console.log(`⚠️ ${webhookResult.reason}`);
      return res.status(200).json({ 
        success: true, 
        message: 'Webhook já processado anteriormente',
        reason: webhookResult.reason
      });
    }
    
    console.log(`✅ Webhook processado: +R$ ${netAmountCents / 100} (vendedor líquido)`);
    
    // 💰 PROCESSAR COMISSÃO DE AFILIADO (apenas creditar afiliado - vendedor já descontado)
    if (affiliateCommissionData?.hasAffiliate) {
      try {
        await (storage as any).processAffiliateCommission({ ...orderData, id: orderId });
      } catch (affiliateError: any) {
        const orphanId = `orphan_webhook_${orderId}_${Date.now()}`;
        await neonQuery(async (sql: any) => {
          await sql`INSERT INTO orphaned_commissions (id, order_id, affiliate_id, net_commission, tenant_id, error, source, status, created_at) VALUES (${orphanId}, ${orderId}, ${affiliateCommissionData.affiliateId}, ${affiliateCommissionData.netCommission}, ${orderData.tenantId}, ${String(affiliateError?.message || affiliateError)}, 'pix_webhook_fallback', 'pending_recovery', NOW()) ON CONFLICT (id) DO NOTHING`;
        }, `webhookPix:orphan:${orphanId}`);
      }
    }
    
    // 💼 COMISSÕES DE COPRODUÇÃO (fire-and-forget) — Woovi PIX
    void processCoproductionCommissions(
      orderId,
      orderData.checkoutId,
      orderData.tenantId,
      financialSnapshot.totalAmount,
      financialSnapshot.netAmount,
      orderData.affiliateCode ? 'affiliate_sale' : 'own_sale',
      orderData.affiliateId
    ).catch((e: any) => console.warn('⚠️ [COPROD] Woovi err:', e?.message));

    finalResponse = { 
      success: true, 
      message: 'PIX confirmado',
      orderId,
      amount: financialSnapshot.totalAmount
    };
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ WEBHOOK PIX PROCESSADO COM SUCESSO (${processingTime}ms)`);
    console.log(`🎉 Ordem ${orderId} confirmada via PIX - Cliente: ${orderData.customer?.email}`);
    
    // 📧 ENVIAR EMAIL DE VENDA APROVADA PARA SELLER (fire-and-forget)
    void (async () => {
      try {
        const sellerData = await firestoreCache.getSeller(orderData.tenantId);
        if (sellerData?.email) {
          const orderBumps = orderData.orderBumps?.map((bump: any) => ({
            name: bump.name || bump.productName || 'Order Bump',
            price: bump.price || bump.amount || 0
          })) || [];
          await sendSaleApprovedEmail({
            sellerEmail: sellerData.email,
            sellerName: sellerData.businessName || sellerData.fullName,
            productName: orderData.productName || orderData.checkoutTitle || 'Produto',
            productPrice: orderData.amount - (orderBumps.reduce((sum: number, b: any) => sum + b.price, 0)),
            buyerName: orderData.customer?.name || 'Cliente',
            buyerEmail: orderData.customer?.email || '',
            paymentMethod: 'pix',
            orderId: orderId,
            netAmount: netAmountCents,
            orderBumps: orderBumps.length > 0 ? orderBumps : undefined,
            currency: 'BRL'
          });
          console.log(`📧✅ Email PIX enviado: ${sellerData.email}`);
        }
      } catch (e: any) { console.error('⚠️ Email PIX err:', e?.message); }
    })();
    
    sendSaleNotification(orderData.tenantId, {
      id: orderId,
      customer: orderData.customer,
      productName: orderData.productName || orderData.checkoutTitle,
      amount: orderData.amount,
      method: 'pix',
      affiliateId: affiliateCommissionData?.affiliateId,
      affiliateCommission: affiliateCommissionData?.netCommission,
    }).catch(err => console.warn('[PUSH] Async PIX sale notification failed:', err?.message));

    sendXtrackyConversion(orderData.tenantId, {
      orderId,
      amount: orderData.amount || 0,
      status: 'paid',
      utmSource: orderData.utmSource || orderData.utm_source || orderData.metadata?.utm_source,
      leadName: orderData.customer?.name || orderData.customerName,
      leadEmail: orderData.customer?.email || orderData.customerEmail,
      leadPhone: orderData.customer?.phone || orderData.customerPhone,
      leadDocument: orderData.customer?.document || orderData.customerDocument,
    }).catch(err => console.warn('[Xtracky] Async PIX conversion failed:', err?.message));

    sendDiscordNotification(orderData.tenantId, 'payment.pix.paid', {
      orderId,
      amount: orderData.amount || 0,
      productName: orderData.productName || orderData.checkoutTitle,
      customerName: orderData.customer?.name || orderData.customerName,
      customerEmail: orderData.customer?.email || orderData.customerEmail,
      paymentMethod: 'pix',
    }).catch(err => console.warn('[Discord] Async PIX notification failed:', err?.message));

    import('../security/transaction-limits.js').then(({ recordApprovedTransaction }) => {
      recordApprovedTransaction(orderData.tenantId, orderData.amount || 0).catch(() => {});
    }).catch(() => {});
    
    return res.status(200).json(finalResponse);
    
  } catch (error: any) {
    console.error('❌ ERRO no webhook PIX:', error);
    console.error('❌ Stack:', error.stack);
    
    // ⚠️ Preencher finalResponse com error payload para finally block persistir
    finalResponse = {
      success: false,
      error: 'Erro ao processar webhook PIX',
      message: error?.message || 'Erro desconhecido'
    };
    
    return res.status(500).json({ error: 'Erro ao processar webhook PIX' });
  } finally {
    // ✅ CRITICAL: SEMPRE limpar lock (success, error, early return)
    // Dual ledger: processedWebhooks (atomic dedupe) + webhookProcessing (cached response)
    if (idempotencyKey && finalResponse) {
      try {
        await markWebhookProcessed(idempotencyKey, finalResponse);
        console.log(`✅ Lock limpo via finally block`);
      } catch (markError) {
        console.error('⚠️ Erro ao marcar webhook no finally block (não crítico):', markError);
        // Não re-throw - preservar erro original
      }
    }
  }
});

// 🎫 WEBHOOK PARA BOLETO BANCÁRIO - SEGURO E PROTEGIDO
router.post('/boleto', express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('🎫 Webhook Boleto recebido - iniciando validação de segurança...');
    
    // 🔐 GATE 1: Validação de segurança (HMAC, estrutura, idempotência)
    const hmacSecret = process.env.BOLETO_WEBHOOK_HMAC;
    const validation = await validateWebhookSecurity(
      req,
      hmacSecret || '',
      ['orderId', 'tenantId']
    );
    
    if (!validation.valid) {
      // Se for duplicata, retornar 200 com resposta cached (idempotência correta)
      if (validation.error?.includes('duplicado') && (validation.data as any)?.previousResponse) {
        console.log('⚠️ Webhook BOLETO duplicado - retornando resposta cached');
        return res.status(200).json((validation.data as any).previousResponse);
      }
      console.error('🚨 Webhook BOLETO REJEITADO:', validation.error);
      return res.status(403).json({ error: validation.error });
    }
    
    const { orderId, tenantId, event, data, idempotencyKey: boletoIdempotencyKey } = validation.data!;
    
    console.log('✅ SECURITY GATE 1 PASSED: Webhook validation OK', { orderId, tenantId, event });
    
    // ✅ PROCESSAR EVENTO DE BOLETO PAGO
    if (event === 'boleto.paid' || event === 'charge.paid') {
      // 🔐 GATE 2: Verificar ownership (prevenir cross-tenant)
      const ownership = await verifyOrderOwnership(orderId!, tenantId);
      
      if (!ownership.valid) {
        console.error('🚨 OWNERSHIP VERIFICATION FAILED:', ownership.error);
        return res.status(403).json({ error: ownership.error });
      }
      
      const orderData = ownership.order!;
      
      console.log('✅ SECURITY GATE 2 PASSED: Ownership verification OK');
      
      // 🔐 GATE 3: Verificar status atual (proteção contra race condition)
      if (orderData.status === 'paid') {
        console.log('⚠️ Ordem já está paga - webhook duplicado bloqueado');
        await markWebhookProcessed(boletoIdempotencyKey!, { success: true, message: 'Already paid' });
        return res.status(200).json({ success: true, message: 'Ordem já está paga' });
      }
      
      console.log('✅ SECURITY GATE 3 PASSED: Status check OK');
      
      // 💰 CRITICAL: Calcular snapshot financeiro (fees atuais)
      const financialSnapshot = await calculateFinancialSnapshot(
        orderData.amount,
        'boleto',
        orderData.gateway || 'pagarme',
        1,
        orderData.tenantId
      );
      
      console.log('💰 Fee snapshot criado:', financialSnapshot);
      
      // 🔒 ATUALIZAR ORDEM PARA PAGO via Neon
      const { neonQuery: neonQ } = await import('../lib/neon-db.js');
      await neonQ(async (sql: any) => {
        const fresh = await sql`SELECT status FROM orders WHERE id = ${orderId} LIMIT 1`;
        if (fresh[0]?.status === 'paid') { console.log('⚠️ RACE CONDITION - Boleto já pago'); return; }
        await sql`UPDATE orders SET status='paid', paid_at=NOW(), method='boleto', gateway=${orderData.gateway || 'pagarme'}, txid=${data.txid || data.id || data.chargeId || orderId}, net_amount=${financialSnapshot.netAmount}, gateway_fee=${financialSnapshot.gatewayFee}, platform_fee=${financialSnapshot.platformFee}, release_date=${financialSnapshot.releaseDate}, financial_data=${JSON.stringify({ totalAmount: financialSnapshot.totalAmount, netAmount: financialSnapshot.netAmount, gatewayFee: financialSnapshot.gatewayFee, platformFee: financialSnapshot.platformFee, releaseDate: financialSnapshot.releaseDate, paidAt: new Date(), feeSnapshot: financialSnapshot.feeSnapshot })}::jsonb, updated_at=NOW() WHERE id=${orderId}`;
        console.log(`✅ Boleto confirmado - Ordem ${orderId} paga`);
      }, `webhookBoleto:updateOrder:${orderId}`);
      
      syncOrderAfterUpdate(orderData.tenantId, orderId, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        method: 'boleto',
        netAmount: financialSnapshot.netAmount,
        gatewayFee: financialSnapshot.gatewayFee
      });

      sendOrderStatusUpdate(orderData.tenantId, orderId, 'paid', { paidAt: new Date() })
        .catch(err => console.warn('[UTMify] Async boleto paid update failed:', err?.message));
      
      // 🎓 CRIAR ENROLLMENT AUTOMÁTICO (fire-and-forget)
      storage.createEnrollmentOnPayment({ ...orderData, id: orderId, paidAt: new Date() })
        .then(() => console.log(`✅ Enrollment criado: ${orderId}`))
        .catch((e: any) => console.error(`⚠️ Enrollment err:`, e?.message));

      // 👤 AUTO-CRIAR CONTA DE MEMBRO (fire-and-forget)
      if (!orderData.productType || orderData.productType === 'digital' || orderData.productType === 'subscription') {
        autoCreateMemberOnPurchase({
          customerEmail: orderData.customer?.email || orderData.customerEmail,
          customerName: orderData.customer?.name || orderData.customerName,
          productId: orderData.productId,
          productType: orderData.productType || 'digital',
          orderId,
          checkoutId: orderData.checkoutId || orderData.checkoutSlug,
        }).catch((e: any) => console.warn('⚠️ [AUTO-MEMBER] Boleto err:', e?.message));
      }

      // 🎓 CRIAR CUSTOMER PROFILE + MEMBER ENTITLEMENT (fire-and-forget)
      createCustomerEntitlementOnPayment({ ...orderData, id: orderId, paidAt: new Date() })
        .catch((e: any) => console.error(`⚠️ Entitlement err:`, e?.message));
      
      // 🔁 CRIAR SUBSCRIPTION (via Neon)
      neonCreateSubscriptionIfNeeded(orderData, orderId, neonQ).catch((e: any) => console.error(`⚠️ Subscription err:`, e?.message));
      
      // 💰 PROCESSAMENTO ATÔMICO: Balance Update para BOLETO
      console.log(`💰 Processando saldo para BOLETO...`);
      let netAmountCentsBoleto = Math.round(financialSnapshot.netAmount);
      let affiliateCommissionDataBoleto: any = null;
      
      if (orderData.affiliateCode || orderData.affiliateUid) {
        try {
          affiliateCommissionDataBoleto = await (storage as any).calculateAffiliateCommission(orderData);
          if (affiliateCommissionDataBoleto.hasAffiliate && affiliateCommissionDataBoleto.netCommission > 0) {
            netAmountCentsBoleto = netAmountCentsBoleto - affiliateCommissionDataBoleto.netCommission;
          }
        } catch (calcError: any) {
          console.error(`⚠️ Erro ao calcular comissão boleto:`, calcError?.message);
        }
      }
      
      const boletoWebhookResult = await processWebhookWithBalanceUpdate({
        webhookId: boletoIdempotencyKey!,
        provider: 'efibank',
        eventType: 'boleto.paid',
        sellerId: orderData.tenantId,
        amountCents: netAmountCentsBoleto,
        currency: 'BRL',
        operation: 'add',
        balanceType: 'available',
        reason: `Pagamento Boleto recebido - Ordem ${orderId}`,
        orderId: orderId,
        metadata: {
          method: 'boleto',
          acquirer: 'efibank',
          totalAmount: financialSnapshot.totalAmount,
          platformFee: financialSnapshot.platformFee,
          gatewayFee: financialSnapshot.gatewayFee,
          affiliateCommission: affiliateCommissionDataBoleto?.netCommission || 0,
          customer: orderData.customer?.email
        },
        rawPayload: req.body
      });
      
      if (!boletoWebhookResult.processed) {
        return res.status(200).json({ success: true, message: 'Webhook já processado anteriormente', reason: boletoWebhookResult.reason });
      }
      
      // 💰 PROCESSAR COMISSÃO DE AFILIADO
      if (affiliateCommissionDataBoleto?.hasAffiliate) {
        try {
          await (storage as any).processAffiliateCommission({ ...orderData, id: orderId });
        } catch (affiliateError: any) {
          const orphanId = `orphan_boleto_${orderId}_${Date.now()}`;
          await neonQ(async (sql: any) => {
            await sql`INSERT INTO orphaned_commissions (id, order_id, affiliate_id, net_commission, tenant_id, error, source, status, created_at) VALUES (${orphanId}, ${orderId}, ${affiliateCommissionDataBoleto.affiliateId}, ${affiliateCommissionDataBoleto.netCommission}, ${orderData.tenantId}, ${String(affiliateError?.message || affiliateError)}, 'boleto_webhook_fallback', 'pending_recovery', NOW()) ON CONFLICT (id) DO NOTHING`;
          }, `webhookBoleto:orphan:${orphanId}`);
        }
      }
      
      // 📡 DISPARAR WEBHOOK PARA O TENANT (fire-and-forget)
      dispatchBoletoPaidEvent(tenantId, {
        id: orderId,
        ...orderData,
        boletoBarcode: data.boleto?.barcode || data.barcode,
        paidAt: new Date(),
        netAmount: financialSnapshot.netAmount
      }).catch((e: any) => console.warn('⚠️ dispatchBoleto err:', e?.message));

      const processingTime = Date.now() - startTime;
      console.log(`✅ WEBHOOK BOLETO PROCESSADO COM SUCESSO (${processingTime}ms)`);

      // 📧 ENVIAR EMAIL DE VENDA APROVADA PARA SELLER (BOLETO — fire-and-forget)
      void (async () => {
        try {
          const sellerData = await firestoreCache.getSeller(tenantId);
          if (sellerData?.email) {
            const orderBumps = orderData.orderBumps?.map((bump: any) => ({
              name: bump.name || bump.productName || 'Order Bump',
              price: bump.price || bump.amount || 0
            })) || [];
            await sendSaleApprovedEmail({
              sellerEmail: sellerData.email,
              sellerName: sellerData.businessName || sellerData.fullName,
              productName: orderData.productName || orderData.checkoutTitle || 'Produto',
              productPrice: orderData.amount - (orderBumps.reduce((sum: number, b: any) => sum + b.price, 0)),
              buyerName: orderData.customer?.name || 'Cliente',
              buyerEmail: orderData.customer?.email || '',
              paymentMethod: 'boleto',
              orderId: orderId,
              netAmount: financialSnapshot.netAmount,
              orderBumps: orderBumps.length > 0 ? orderBumps : undefined,
              currency: 'BRL'
            });
            console.log(`📧✅ Email boleto enviado: ${sellerData.email}`);
          }
        } catch (e: any) { console.error('⚠️ Email boleto err:', e?.message); }
      })();
      
      sendSaleNotification(tenantId, {
        id: orderId,
        customer: orderData.customer,
        productName: orderData.productName || orderData.checkoutTitle,
        amount: orderData.amount,
        method: 'boleto',
        affiliateId: affiliateCommissionDataBoleto?.affiliateId,
        affiliateCommission: affiliateCommissionDataBoleto?.netCommission,
      }).catch(err => console.warn('[PUSH] Async boleto sale notification failed:', err?.message));

      sendXtrackyConversion(tenantId, {
        orderId,
        amount: orderData.amount || 0,
        status: 'paid',
        utmSource: orderData.utmSource || orderData.utm_source || orderData.metadata?.utm_source,
        leadName: orderData.customer?.name || orderData.customerName,
        leadEmail: orderData.customer?.email || orderData.customerEmail,
        leadPhone: orderData.customer?.phone || orderData.customerPhone,
        leadDocument: orderData.customer?.document || orderData.customerDocument,
      }).catch(err => console.warn('[Xtracky] Async boleto conversion failed:', err?.message));

      sendDiscordNotification(tenantId, 'payment.boleto.paid', {
        orderId,
        amount: orderData.amount || 0,
        productName: orderData.productName || orderData.checkoutTitle,
        customerName: orderData.customer?.name || orderData.customerName,
        customerEmail: orderData.customer?.email || orderData.customerEmail,
        paymentMethod: 'boleto',
      }).catch(err => console.warn('[Discord] Async boleto notification failed:', err?.message));
      
      return res.status(200).json({ success: true, message: 'Boleto confirmado' });
    }
    
    return res.status(200).json({ success: true, message: 'Evento recebido' });
    
  } catch (error) {
    console.error('❌ Erro no webhook de boleto:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// 🔁 WEBHOOK PARA ASSINATURAS (CICLO DE VIDA) - SEGURO E PROTEGIDO
router.post('/subscription', express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('🔁 Webhook Subscription recebido - iniciando validação de segurança...');
    
    // 🔐 GATE 1: Validação de segurança (HMAC, estrutura, idempotência)
    const hmacSecret = process.env.SUBSCRIPTION_WEBHOOK_HMAC;
    const validation = await validateWebhookSecurity(
      req,
      hmacSecret || '',
      ['subscriptionId', 'tenantId']
    );
    
    if (!validation.valid) {
      // Se for duplicata, retornar 200 com resposta cached (idempotência correta)
      if (validation.error?.includes('duplicado') && (validation.data as any)?.previousResponse) {
        console.log('⚠️ Webhook SUBSCRIPTION duplicado - retornando resposta cached');
        return res.status(200).json((validation.data as any).previousResponse);
      }
      console.error('🚨 Webhook SUBSCRIPTION REJEITADO:', validation.error);
      return res.status(403).json({ error: validation.error });
    }
    
    const { subscriptionId, tenantId, event, data, idempotencyKey: subIdempotencyKey } = validation.data!;
    
    console.log('✅ SECURITY GATE 1 PASSED: Webhook validation OK', { subscriptionId, tenantId, event });
    
    // 🔐 GATE 2: Verificar ownership (prevenir cross-tenant)
    const ownership = await verifySubscriptionOwnership(subscriptionId!, tenantId);
    
    if (!ownership.valid) {
      console.error('🚨 OWNERSHIP VERIFICATION FAILED:', ownership.error);
      return res.status(403).json({ error: ownership.error });
    }
    
    const subData = ownership.subscription!;
    
    console.log('✅ SECURITY GATE 2 PASSED: Ownership verification OK');
    
    // 🔒 PROCESSAR EVENTOS VIA Neon
    const { neonQuery: subNeonQ } = await import('../lib/neon-db.js');
    const { neonUpdateSubscription } = await import('../lib/neon-subscriptions.js');
    await subNeonQ(async (sql: any) => {
      const freshRows = await sql`SELECT status, period, renewal_count FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`;
      const freshSub = freshRows[0];
      if (!freshSub) return;

      switch (event) {
        case 'subscription.created':
          if (freshSub.status === 'active') { console.log('⚠️ Assinatura já ativa'); return; }
          await sql`UPDATE subscriptions SET status='active', activated_at=NOW(), updated_at=NOW() WHERE id=${subscriptionId}`;
          console.log(`✅ Assinatura ativada: ${subscriptionId}`);
          break;

        case 'subscription.renewed': {
          const subPeriod = freshSub.period || 'monthly';
          const daysToAdd = subPeriod === 'monthly' ? 30 : subPeriod === 'quarterly' ? 90 : subPeriod === 'semiannual' ? 180 : 365;
          const nextBilling = new Date();
          nextBilling.setDate(nextBilling.getDate() + daysToAdd);
          await sql`UPDATE subscriptions SET last_renewal_date=NOW(), next_billing_date=${nextBilling}, renewal_count=${(freshSub.renewal_count || 0) + 1}, updated_at=NOW() WHERE id=${subscriptionId}`;
          console.log(`✅ Assinatura renovada: ${subscriptionId}`);
          break;
        }

        case 'subscription.cancelled':
          if (freshSub.status === 'cancelled') { console.log('⚠️ Assinatura já cancelada'); return; }
          await sql`UPDATE subscriptions SET status='cancelled', cancelled_at=NOW(), cancellation_reason=${data.reason || 'Cliente solicitou'}, updated_at=NOW() WHERE id=${subscriptionId}`;
          console.log(`✅ Assinatura cancelada: ${subscriptionId}`);
          break;

        case 'subscription.payment_failed':
          await sql`UPDATE subscriptions SET status='past_due', last_payment_failure=NOW(), failure_reason=${data.reason || 'Cartão recusado'}, updated_at=NOW() WHERE id=${subscriptionId}`;
          console.log(`⚠️ Falha no pagamento registrada: ${subscriptionId}`);
          break;

        default:
          console.log(`⚠️ Evento de subscription desconhecido: ${event}`);
      }
    }, `webhookSub:event:${subscriptionId}`);

    // Sync Neon via helper
    if (event === 'subscription.created') neonUpdateSubscription(subscriptionId, { status: 'active', activatedAt: new Date() }).catch(() => {});
    else if (event === 'subscription.cancelled') neonUpdateSubscription(subscriptionId, { status: 'cancelled', cancelledAt: new Date() }).catch(() => {});
    else if (event === 'subscription.payment_failed') neonUpdateSubscription(subscriptionId, { status: 'past_due' }).catch(() => {});

    // ✅ Marcar webhook como processado (idempotência)
    await markWebhookProcessed(subIdempotencyKey!, {
      success: true,
      message: 'Evento processado',
      subscriptionId,
      event
    });
    
    // 📡 DISPARAR WEBHOOKS PARA O TENANT
    switch (event) {
      case 'subscription.created':
        await dispatchSubscriptionCreatedEvent(tenantId, { ...subData, id: subscriptionId });
        break;
      case 'subscription.renewed':
        await dispatchSubscriptionRenewedEvent(tenantId, { ...subData, id: subscriptionId });
        break;
      case 'subscription.cancelled':
        await dispatchSubscriptionCancelledEvent(tenantId, { ...subData, id: subscriptionId });
        break;
      case 'subscription.payment_failed':
        await dispatchSubscriptionPaymentFailedEvent(tenantId, { ...subData, id: subscriptionId });
        break;
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ WEBHOOK SUBSCRIPTION PROCESSADO COM SUCESSO (${processingTime}ms)`);
    
    return res.status(200).json({ success: true, message: 'Evento processado' });
    
  } catch (error) {
    console.error('❌ Erro no webhook de subscription:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

export default router;
