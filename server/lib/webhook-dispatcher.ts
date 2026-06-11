import { storage } from '../storage';
import { saveDataToBunny } from './bunny-data-storage.js';
import { firestoreCache } from './firestore-cache.js';

// 🎯 BARRAMENTO CENTRAL DE EVENTOS WEBHOOK
// Sistema de disparo automático de webhooks para URLs configuradas por tenant

interface WebhookEvent {
  event: string;
  tenantId: string;
  data: any;
  timestamp: Date;
}

interface WebhookLog {
  tenantId: string;
  event: string;
  webhookUrl: string;
  payload: any;
  response?: {
    status: number;
    body: any;
  };
  success: boolean;
  attempts: number;
  sentAt: Date;
  error?: string;
}

/**
 * 🔗 Despacha para webhooks customizados criados na página de Integrações
 * Busca na coleção 'webhooks' do Firestore por webhooks ativos do seller
 * Filtra por evento e envia com assinatura HMAC-SHA256 se secret configurado
 */
async function dispatchToCustomWebhooks(db: any, tenantId: string, eventName: string, payload: any): Promise<void> {
  try {
    const webhooksSnapshot = await db.collection('webhooks')
      .where('sellerUid', '==', tenantId)
      .where('active', '==', true)
      .get();

    if (webhooksSnapshot.empty) return;

    const crypto = await import('crypto');

    for (const doc of webhooksSnapshot.docs) {
      const wh = doc.data();

      if (wh.events && Array.isArray(wh.events) && !wh.events.includes(eventName)) {
        continue;
      }

      if (!wh.url || (!wh.url.startsWith('http://') && !wh.url.startsWith('https://'))) {
        continue;
      }

      const payloadStr = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Zen-Event': eventName,
        'X-Zen-Tenant': tenantId,
        'X-Webhook-Source': 'volatuspay.com',
        'User-Agent': 'VolatusPay-Webhook/1.0',
        'X-Webhook-Timestamp': String(Math.floor(Date.now() / 1000))
      };

      if (wh.secret) {
        const signature = crypto.createHmac('sha256', wh.secret)
          .update(payloadStr)
          .digest('hex');
        headers['X-Zen-Signature'] = `sha256=${signature}`;
      }

      let success = false;
      let statusCode = 0;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await fetch(wh.url, {
            method: 'POST',
            headers,
            body: payloadStr,
            signal: AbortSignal.timeout(10000)
          });
          statusCode = resp.status;
          if (resp.ok) {
            success = true;
            break;
          }
        } catch (e: any) {
          console.error(`❌ Custom webhook ${doc.id} tentativa ${attempt}: ${e.message}`);
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000));
      }

      try {
        const { getAdmin } = await import('../lib/firebase-admin.js');
        const adminSdk = getAdmin();
        const increment = adminSdk.firestore.FieldValue.increment(1);
        await db.collection('webhooks').doc(doc.id).update({
          lastTrigger: new Date(),
          ...(success ? { successCount: increment } : { failureCount: increment })
        });
      } catch (e) {}

      console.log(`${success ? '✅' : '❌'} Custom webhook ${doc.id} → ${wh.url} (${eventName}) status=${statusCode}`);
    }
  } catch (error) {
    console.error('❌ Erro ao despachar custom webhooks:', error);
  }
}

/**
 * 📡 Dispara webhook para tenant com retry automático
 * Busca URL em múltiplas coleções: sellers, users, checkouts
 */
export async function dispatchWebhook(event: WebhookEvent): Promise<void> {
  try {
    const { tenantId, event: eventName, data, timestamp } = event;
    
    console.log(`📡 Disparando webhook: ${eventName} para tenant ${tenantId}`);
    
    // 🔍 BUSCAR URL DO WEBHOOK NO FIRESTORE
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      console.error('❌ Firebase não conectado - webhook não enviado');
      return;
    }
    
    let webhookUrl: string | null = null;
    
    // 🔍 BUSCAR EM MÚLTIPLAS COLEÇÕES (ordem de prioridade)
    
    // 1️⃣ Tentar buscar em 'sellers' (onde vendedores armazenam configurações)
    const sellerData = await firestoreCache.getSeller(tenantId);
    if (sellerData) {
      webhookUrl = sellerData?.webhookUrl || 
                   sellerData?.settings?.webhookUrl || 
                   sellerData?.integrations?.webhookUrl ||
                   sellerData?.notifications?.webhookUrl;
      if (webhookUrl) {
        console.log(`✅ Webhook URL encontrada em sellers/${tenantId}`);
      }
    }
    
    // 2️⃣ Se não encontrou, tentar em 'users'
    if (!webhookUrl) {
      const userData = await firestoreCache.getUser(tenantId);
      if (userData) {
        webhookUrl = userData?.webhookUrl || 
                     userData?.settings?.webhookUrl ||
                     userData?.integrations?.webhookUrl;
        if (webhookUrl) {
          console.log(`✅ Webhook URL encontrada em users/${tenantId}`);
        }
      }
    }
    
    // 3️⃣ Se não encontrou, tentar em 'tenantSettings'
    if (!webhookUrl) {
      const settingsData = await firestoreCache.getTenantSettings(tenantId);
      if (settingsData) {
        webhookUrl = settingsData?.webhookUrl || 
                     settingsData?.notifications?.webhookUrl;
        if (webhookUrl) {
          console.log(`✅ Webhook URL encontrada em tenantSettings/${tenantId}`);
        }
      }
    }
    
    // 📦 MONTAR PAYLOAD PARA CUSTOM WEBHOOKS (antes do early return)
    const basePayload = {
      event: eventName,
      tenantId,
      data,
      timestamp: timestamp.toISOString(),
      apiVersion: '2025-11-03'
    };

    // ❌ Se não encontrou URL legada em nenhuma coleção
    if (!webhookUrl) {
      console.log(`⚠️ Webhook URL legada não configurada para tenant: ${tenantId}`);
      
      // 📝 Log de webhook não configurado (para debug)
      try {
        const unconfiguredLogId = `wh_nocfg_${tenantId}_${Date.now()}`;
        const unconfiguredLogData = {
          tenantId,
          event: eventName,
          webhookUrl: null,
          payload: { event: eventName, data: '(URL legada não configurada)' },
          success: false,
          attempts: 0,
          sentAt: new Date(),
          error: 'Webhook URL legada não configurada'
        };

        saveDataToBunny('logs/webhook', unconfiguredLogId, unconfiguredLogData)
          .then(r => r.success && console.log(`☁️ Webhook log ${unconfiguredLogId} salvo no Bunny`))
          .catch(err => console.error('⚠️ Bunny webhook log error:', err));

        await firebaseStorage.db.collection('webhookLogs').doc(unconfiguredLogId).set({
          timestamp: new Date(),
          url: null,
          status: 0,
          attempts: 0,
          success: false
        });

        // 🐘 DUAL-WRITE → Neon (fire-and-forget)
        import('./neon-subscriptions.js').then(({ neonWriteWebhookLog }) => {
          neonWriteWebhookLog({ id: unconfiguredLogId, tenantId, event: eventName, success: false, attempts: 0 });
        }).catch(() => {});
      } catch (e) {}
      
      // 🔗 Ainda assim, despachar para webhooks customizados da coleção 'webhooks'
      await dispatchToCustomWebhooks(firebaseStorage.db, tenantId, eventName, basePayload);
      return;
    }
    
    // ✅ VALIDAR URL
    if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
      console.error(`❌ Webhook URL inválida (deve começar com http/https): ${webhookUrl}`);
      return;
    }
    
    // 📦 USAR PAYLOAD JÁ MONTADO ACIMA
    const payload = basePayload;
    
    console.log(`📦 Payload do webhook:`, JSON.stringify(payload, null, 2).substring(0, 500));

    // 🔐 OBTER OU GERAR SECRET HMAC DO SELLER PARA ASSINAR O WEBHOOK
    let webhookSecret: string | null = null;
    try {
      const sellerSnap = await firebaseStorage.db.collection('sellers').doc(tenantId).get();
      if (sellerSnap.exists) {
        webhookSecret = sellerSnap.data()?.webhookSecret || null;
      }
      if (!webhookSecret) {
        const { randomBytes } = await import('crypto');
        webhookSecret = randomBytes(32).toString('hex');
        await firebaseStorage.db.collection('sellers').doc(tenantId).set(
          { webhookSecret, webhookSecretCreatedAt: new Date() },
          { merge: true }
        );
        console.log(`🔑 [WEBHOOK] Secret HMAC gerado para tenant ${tenantId.slice(0, 8)}...`);
      }
    } catch {}

    // 🚀 ENVIAR WEBHOOK COM RETRY
    let success = false;
    let lastError = '';
    let response: any = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📤 Tentativa ${attempt}/3 de enviar webhook para ${webhookUrl}`);

        const payloadStr = JSON.stringify(payload);
        const outboundHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Zen-Event': eventName,
          'X-Zen-Tenant': tenantId,
          'X-Webhook-Source': 'volatuspay.com',
          'User-Agent': 'VolatusPay-Webhook/1.0',
          'X-Webhook-Timestamp': String(Math.floor(Date.now() / 1000)),
        };
        if (webhookSecret) {
          const { createHmac } = await import('crypto');
          const sig = createHmac('sha256', webhookSecret).update(payloadStr).digest('hex');
          outboundHeaders['X-Zen-Signature'] = `sha256=${sig}`;
        }
        
        const webhookResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: outboundHeaders,
          body: payloadStr,
        });
        
        response = {
          status: webhookResponse.status,
          body: await webhookResponse.text()
        };
        
        if (webhookResponse.ok) {
          success = true;
          console.log(`✅ Webhook enviado com sucesso (tentativa ${attempt}) - Status: ${webhookResponse.status}`);
          break;
        } else {
          lastError = `HTTP ${webhookResponse.status}: ${response.body.substring(0, 200)}`;
          console.error(`❌ Webhook falhou (tentativa ${attempt}): ${lastError}`);
        }
      } catch (error: any) {
        lastError = error.message;
        console.error(`❌ Erro ao enviar webhook (tentativa ${attempt}):`, error.message);
      }
      
      // Aguardar antes do próximo retry (backoff exponencial)
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
    
    // 📝 SALVAR LOG DO WEBHOOK
    const webhookLogId = `wh_${tenantId}_${Date.now()}`;
    const webhookLog: WebhookLog = {
      tenantId,
      event: eventName,
      webhookUrl,
      payload,
      response,
      success,
      attempts: success ? 1 : 3,
      sentAt: new Date(),
      error: success ? undefined : lastError
    };
    
    saveDataToBunny('logs/webhook', webhookLogId, webhookLog)
      .then(r => r.success && console.log(`☁️ Webhook log ${webhookLogId} salvo no Bunny`))
      .catch(err => console.error('⚠️ Bunny webhook log error:', err));

    await firebaseStorage.db.collection('webhookLogs').doc(webhookLogId).set({
      timestamp: new Date(),
      url: webhookUrl,
      status: response?.status || 0,
      attempts: success ? 1 : 3,
      success
    });

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./neon-subscriptions.js').then(({ neonWriteWebhookLog }) => {
      neonWriteWebhookLog({
        id: webhookLogId,
        tenantId,
        event: eventName,
        webhookUrl,
        payload,
        response: response ? { status: response.status, body: String(response.body || '').substring(0, 500) } : null,
        responseStatus: response?.status ?? null,
        success,
        attempts: success ? 1 : 3,
        error: success ? null : lastError,
        sentAt: new Date(),
      });
    }).catch(() => {});

    if (success) {
      console.log(`✅ Webhook ${eventName} entregue com sucesso para ${webhookUrl}`);
    } else {
      console.error(`❌ Webhook ${eventName} falhou após 3 tentativas: ${lastError}`);
    }
    
    await dispatchToCustomWebhooks(firebaseStorage.db, tenantId, eventName, payload);
    
  } catch (error) {
    console.error('❌ Erro crítico no dispatcher de webhook:', error);
  }
}

/**
 * 🎯 EVENTOS ESPECÍFICOS DO SISTEMA
 */

// 💳 Evento de pagamento PIX confirmado
export async function dispatchPixPaidEvent(tenantId: string, orderData: any): Promise<void> {
  const address = orderData.customerAddress || orderData.customer?.address || orderData.address || null;
  const items = orderData.items || orderData.orderItems || [];
  const productType = orderData.productType || orderData.checkoutSnapshot?.productType || 'digital';
  const offerId = orderData.offerId || orderData.checkoutSnapshot?.offerId || orderData.checkoutId || '';
  const offerName = orderData.offerName || orderData.checkoutSnapshot?.offerName || orderData.checkoutSnapshot?.title || '';
  const offerCode = orderData.offerCode || orderData.checkoutSnapshot?.offerCode || orderData.checkoutSnapshot?.slug || '';
  await dispatchWebhook({
    event: 'payment.pix.paid',
    tenantId,
    data: {
      orderId: orderData.id,
      txid: orderData.txid,
      amount: orderData.amount,
      amountFormatted: `R$ ${(orderData.amount / 100).toFixed(2).replace('.', ',')}`,
      customer: {
        name: orderData.customer?.name || orderData.customerName || '',
        email: orderData.customer?.email || orderData.customerEmail || '',
        phone: orderData.customer?.phone || orderData.customerPhone || '',
        whatsapp: orderData.customer?.phone || orderData.customerPhone || '',
        cpf: orderData.customer?.cpf || orderData.customerCpf || '',
        document: orderData.customer?.cpf || orderData.customerCpf || ''
      },
      product: {
        name: orderData.productName || orderData.product?.name || '',
        id: orderData.productId || orderData.product?.id || '',
        checkoutId: orderData.checkoutId || '',
        type: productType
      },
      offer: {
        id: offerId,
        name: offerName,
        code: offerCode
      },
      ...(items.length > 0 ? { items } : {}),
      ...(address ? { address } : {}),
      paymentMethod: 'pix',
      processor: 'efibank',
      status: 'paid',
      paidAt: orderData.paidAt || new Date()
    },
    timestamp: new Date()
  });
}

// 💳 Evento de pagamento com cartão aprovado
export async function dispatchCardApprovedEvent(tenantId: string, orderData: any): Promise<void> {
  const address = orderData.customerAddress || orderData.customer?.address || orderData.address || null;
  const items = orderData.items || orderData.orderItems || [];
  const productType = orderData.productType || orderData.checkoutSnapshot?.productType || 'digital';
  const offerId = orderData.offerId || orderData.checkoutSnapshot?.offerId || orderData.checkoutId || '';
  const offerName = orderData.offerName || orderData.checkoutSnapshot?.offerName || orderData.checkoutSnapshot?.title || '';
  const offerCode = orderData.offerCode || orderData.checkoutSnapshot?.offerCode || orderData.checkoutSnapshot?.slug || '';
  const processor = orderData.processor || (orderData.stripeChargeId ? 'stripe' : 'efibank');
  await dispatchWebhook({
    event: 'payment.card.approved',
    tenantId,
    data: {
      orderId: orderData.id,
      chargeId: orderData.chargeId,
      amount: orderData.amount,
      amountFormatted: `R$ ${(orderData.amount / 100).toFixed(2).replace('.', ',')}`,
      customer: {
        name: orderData.customer?.name || orderData.customerName || '',
        email: orderData.customer?.email || orderData.customerEmail || '',
        phone: orderData.customer?.phone || orderData.customerPhone || '',
        cpf: orderData.customer?.cpf || orderData.customerCpf || '',
        document: orderData.customer?.cpf || orderData.customerCpf || ''
      },
      product: {
        name: orderData.productName || orderData.product?.name || '',
        id: orderData.productId || orderData.product?.id || '',
        checkoutId: orderData.checkoutId || '',
        type: productType
      },
      offer: {
        id: offerId,
        name: offerName,
        code: offerCode
      },
      ...(items.length > 0 ? { items } : {}),
      ...(address ? { address } : {}),
      paymentMethod: 'credit_card',
      processor,
      status: 'approved',
      approvedAt: orderData.paidAt || new Date()
    },
    timestamp: new Date()
  });
}

// 🎫 Evento de boleto pago
export async function dispatchBoletoPaidEvent(tenantId: string, orderData: any): Promise<void> {
  const address = orderData.customerAddress || orderData.customer?.address || orderData.address || null;
  const items = orderData.items || orderData.orderItems || [];
  const productType = orderData.productType || orderData.checkoutSnapshot?.productType || 'digital';
  const offerId = orderData.offerId || orderData.checkoutSnapshot?.offerId || orderData.checkoutId || '';
  const offerName = orderData.offerName || orderData.checkoutSnapshot?.offerName || orderData.checkoutSnapshot?.title || '';
  const offerCode = orderData.offerCode || orderData.checkoutSnapshot?.offerCode || orderData.checkoutSnapshot?.slug || '';
  await dispatchWebhook({
    event: 'payment.boleto.paid',
    tenantId,
    data: {
      orderId: orderData.id,
      barcode: orderData.boletoBarcode,
      amount: orderData.amount,
      amountFormatted: `R$ ${(orderData.amount / 100).toFixed(2).replace('.', ',')}`,
      customer: {
        name: orderData.customer?.name || orderData.customerName || '',
        email: orderData.customer?.email || orderData.customerEmail || '',
        phone: orderData.customer?.phone || orderData.customerPhone || '',
        cpf: orderData.customer?.cpf || orderData.customerCpf || '',
        document: orderData.customer?.cpf || orderData.customerCpf || ''
      },
      product: {
        name: orderData.productName || orderData.product?.name || '',
        id: orderData.productId || orderData.product?.id || '',
        checkoutId: orderData.checkoutId || '',
        type: productType
      },
      offer: {
        id: offerId,
        name: offerName,
        code: offerCode
      },
      ...(items.length > 0 ? { items } : {}),
      ...(address ? { address } : {}),
      paymentMethod: 'boleto',
      processor: 'efibank',
      status: 'paid',
      paidAt: orderData.paidAt || new Date()
    },
    timestamp: new Date()
  });
}

// 🔁 Evento de assinatura criada
export async function dispatchSubscriptionCreatedEvent(tenantId: string, subscriptionData: any): Promise<void> {
  await dispatchWebhook({
    event: 'subscription.created',
    tenantId,
    data: {
      subscriptionId: subscriptionData.id,
      customerId: subscriptionData.customerId,
      customerEmail: subscriptionData.customerEmail || subscriptionData.customer?.email || null,
      productId: subscriptionData.productId || null,
      planName: subscriptionData.planName || subscriptionData.productName || null,
      checkoutId: subscriptionData.checkoutId,
      period: subscriptionData.period || subscriptionData.billingCycle,
      amount: subscriptionData.amount,
      status: 'active',
      startDate: subscriptionData.startDate || new Date(),
      nextBillingDate: subscriptionData.nextBillingDate,
      accessEndDate: subscriptionData.accessEndDate || null
    },
    timestamp: new Date()
  });
}

// 🔁 Evento de assinatura renovada
export async function dispatchSubscriptionRenewedEvent(tenantId: string, subscriptionData: any): Promise<void> {
  await dispatchWebhook({
    event: 'subscription.renewed',
    tenantId,
    data: {
      subscriptionId: subscriptionData.id,
      customerId: subscriptionData.customerId,
      customerEmail: subscriptionData.customerEmail || subscriptionData.customer?.email || null,
      productId: subscriptionData.productId || null,
      planName: subscriptionData.planName || subscriptionData.productName || null,
      amount: subscriptionData.amount,
      period: subscriptionData.period || subscriptionData.billingCycle,
      renewedAt: new Date(),
      nextBillingDate: subscriptionData.nextBillingDate,
      accessEndDate: subscriptionData.accessEndDate || null
    },
    timestamp: new Date()
  });
}

// 🔁 Evento de assinatura cancelada
export async function dispatchSubscriptionCancelledEvent(tenantId: string, subscriptionData: any): Promise<void> {
  await dispatchWebhook({
    event: 'subscription.cancelled',
    tenantId,
    data: {
      subscriptionId: subscriptionData.id,
      customerId: subscriptionData.customerId,
      customerEmail: subscriptionData.customerEmail || subscriptionData.customer?.email || null,
      productId: subscriptionData.productId || null,
      planName: subscriptionData.planName || subscriptionData.productName || null,
      amount: subscriptionData.amount || null,
      period: subscriptionData.period || subscriptionData.billingCycle || null,
      reason: subscriptionData.cancellationReason || subscriptionData.cancelledVia === 'api' ? 'Cancelado via API' : 'Cliente solicitou',
      cancelledAt: new Date(),
      accessEndDate: subscriptionData.accessEndDate || null
    },
    timestamp: new Date()
  });
}

// 🔁 Evento de falha no pagamento da assinatura
export async function dispatchSubscriptionPaymentFailedEvent(tenantId: string, subscriptionData: any): Promise<void> {
  await dispatchWebhook({
    event: 'subscription.payment_failed',
    tenantId,
    data: {
      subscriptionId: subscriptionData.id,
      customerId: subscriptionData.customerId,
      customerEmail: subscriptionData.customerEmail || subscriptionData.customer?.email || null,
      productId: subscriptionData.productId || null,
      planName: subscriptionData.planName || subscriptionData.productName || null,
      amount: subscriptionData.amount,
      failedAt: new Date(),
      reason: subscriptionData.failureReason || 'Cartão recusado'
    },
    timestamp: new Date()
  });
}

// ═══════════════════════════════════════════════════════════════
// 💻 EVENTOS DE ACESSO - PRODUTOS DIGITAIS
// ═══════════════════════════════════════════════════════════════

// ✅ Evento de acesso liberado (produto digital)
export async function dispatchAccessGrantedEvent(tenantId: string, accessData: any): Promise<void> {
  await dispatchWebhook({
    event: 'access.granted',
    tenantId,
    data: {
      orderId: accessData.orderId,
      customerId: accessData.customerId,
      customerEmail: accessData.customerEmail,
      productId: accessData.productId,
      productName: accessData.productName,
      accessType: accessData.accessType || 'lifetime',
      accessUrl: accessData.accessUrl,
      expiresAt: accessData.expiresAt,
      grantedAt: new Date()
    },
    timestamp: new Date()
  });
}

// ❌ Evento de acesso revogado (produto digital)
export async function dispatchAccessRevokedEvent(tenantId: string, accessData: any): Promise<void> {
  await dispatchWebhook({
    event: 'access.revoked',
    tenantId,
    data: {
      orderId: accessData.orderId,
      customerId: accessData.customerId,
      customerEmail: accessData.customerEmail,
      productId: accessData.productId,
      productName: accessData.productName,
      reason: accessData.reason || 'Reembolso processado',
      revokedAt: new Date()
    },
    timestamp: new Date()
  });
}

// 🛒 Evento de carrinho abandonado
export async function dispatchCartAbandonedEvent(tenantId: string, cartData: any): Promise<void> {
  await dispatchWebhook({
    event: 'cart.abandoned',
    tenantId,
    data: {
      sessionId: cartData.sessionId,
      checkoutId: cartData.checkoutId,
      customer: cartData.customer,
      products: cartData.products,
      totalAmount: cartData.totalAmount,
      abandonedAt: new Date(),
      recoveryUrl: cartData.recoveryUrl
    },
    timestamp: new Date()
  });
}

// 💳 Evento de PIX gerado
export async function dispatchPixCreatedEvent(tenantId: string, orderData: any): Promise<void> {
  await dispatchWebhook({
    event: 'payment.pix.created',
    tenantId,
    data: {
      orderId: orderData.id,
      txid: orderData.txid,
      amount: orderData.amount,
      customer: orderData.customer,
      qrCode: orderData.qrCode,
      expiresAt: orderData.expiresAt,
      createdAt: new Date()
    },
    timestamp: new Date()
  });
}

// ⏰ Evento de PIX expirado
export async function dispatchPixExpiredEvent(tenantId: string, orderData: any): Promise<void> {
  await dispatchWebhook({
    event: 'payment.pix.expired',
    tenantId,
    data: {
      orderId: orderData.id,
      txid: orderData.txid,
      amount: orderData.amount,
      customer: orderData.customer,
      expiredAt: new Date()
    },
    timestamp: new Date()
  });
}

// 🎫 Evento de boleto gerado
export async function dispatchBoletoCreatedEvent(tenantId: string, orderData: any): Promise<void> {
  await dispatchWebhook({
    event: 'payment.boleto.created',
    tenantId,
    data: {
      orderId: orderData.id,
      barcode: orderData.boletoBarcode,
      digitableLine: orderData.boletoDigitableLine,
      pdfUrl: orderData.boletoPdfUrl,
      amount: orderData.amount,
      customer: orderData.customer,
      dueDate: orderData.boletoDueDate,
      createdAt: new Date()
    },
    timestamp: new Date()
  });
}

// ⏰ Evento de boleto expirado
export async function dispatchBoletoExpiredEvent(tenantId: string, orderData: any): Promise<void> {
  await dispatchWebhook({
    event: 'payment.boleto.expired',
    tenantId,
    data: {
      orderId: orderData.id,
      barcode: orderData.boletoBarcode,
      amount: orderData.amount,
      customer: orderData.customer,
      expiredAt: new Date()
    },
    timestamp: new Date()
  });
}

// ❌ Evento de compra recusada
export async function dispatchPaymentDeclinedEvent(tenantId: string, orderData: any): Promise<void> {
  await dispatchWebhook({
    event: 'payment.declined',
    tenantId,
    data: {
      orderId: orderData.id,
      amount: orderData.amount,
      customer: orderData.customer,
      paymentMethod: orderData.paymentMethod,
      declineReason: orderData.declineReason || 'Cartão recusado',
      declinedAt: new Date()
    },
    timestamp: new Date()
  });
}

// 💰 Evento de reembolso processado
export async function dispatchRefundProcessedEvent(tenantId: string, refundData: any): Promise<void> {
  await dispatchWebhook({
    event: 'payment.refunded',
    tenantId,
    data: {
      orderId: refundData.orderId,
      refundId: refundData.refundId,
      amount: refundData.amount,
      customer: refundData.customer,
      reason: refundData.reason || 'Solicitado pelo cliente',
      refundedAt: new Date()
    },
    timestamp: new Date()
  });
}

// ⚠️ Evento de chargeback
export async function dispatchChargebackEvent(tenantId: string, chargebackData: any): Promise<void> {
  await dispatchWebhook({
    event: 'payment.chargeback',
    tenantId,
    data: {
      orderId: chargebackData.orderId,
      chargebackId: chargebackData.chargebackId,
      amount: chargebackData.amount,
      customer: chargebackData.customer,
      reason: chargebackData.reason || 'Disputa aberta pelo cliente',
      chargebackAt: new Date()
    },
    timestamp: new Date()
  });
}

// 🔁 Evento de assinatura atrasada (pagamento pendente)
export async function dispatchSubscriptionOverdueEvent(tenantId: string, subscriptionData: any): Promise<void> {
  await dispatchWebhook({
    event: 'subscription.overdue',
    tenantId,
    data: {
      subscriptionId: subscriptionData.id,
      customerId: subscriptionData.customerId,
      amount: subscriptionData.amount,
      dueDate: subscriptionData.nextBillingDate,
      daysOverdue: subscriptionData.daysOverdue || 1,
      overdueAt: new Date()
    },
    timestamp: new Date()
  });
}

