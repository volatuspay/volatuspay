import { Router, Response } from 'express';
import { validateApiKey, requirePermission, ApiKeyRequest } from '../middleware/api-key-auth';
import { neonQuery } from '../lib/neon-db.js';
import { generateCheckoutId } from '../../shared/schema';
import { dispatchSubscriptionCancelledEvent, dispatchPixCreatedEvent } from '../lib/webhook-dispatcher';

const router = Router();

router.use(validateApiKey);

// ═══════════════════════════════════════════════════════════════
// 📦 PEDIDOS (ORDERS)
// ═══════════════════════════════════════════════════════════════

router.get('/orders', requirePermission('orders:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const sellerId = req.apiKey!.sellerId;
    const lim = Math.min(Number(limit), 100);

    let rows: any[] = [];
    await neonQuery(async (sql) => {
      if (status) {
        rows = await sql`SELECT id, status, amount, payment_method, customer_name, customer_email, product_title, created_at, paid_at FROM orders WHERE tenant_id = ${sellerId} AND status = ${status as string} ORDER BY created_at DESC LIMIT ${lim}`;
      } else {
        rows = await sql`SELECT id, status, amount, payment_method, customer_name, customer_email, product_title, created_at, paid_at FROM orders WHERE tenant_id = ${sellerId} ORDER BY created_at DESC LIMIT ${lim}`;
      }
    }, `extApi:orders:${sellerId}`);

    const orders = rows.map((r) => ({ id: r.id, ...sanitizeOrderData(r) }));
    res.json({ success: true, data: orders, pagination: { page: Number(page), limit: lim, total: orders.length } });
  } catch (error: any) {
    console.error('API Error - GET /orders:', error);
    res.status(500).json({ error: 'Erro ao buscar pedidos', code: 'ORDERS_FETCH_ERROR' });
  }
});

router.get('/orders/:orderId', requirePermission('orders:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, amount, payment_method, customer_name, customer_email, product_title, created_at, paid_at, tenant_id FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) row = rows[0];
    }, `extApi:getOrder:${orderId}`);
    if (!row || row.tenant_id !== req.apiKey!.sellerId) return res.status(404).json({ error: 'Pedido não encontrado', code: 'ORDER_NOT_FOUND' });
    res.json({ success: true, data: { id: row.id, ...sanitizeOrderData(row) } });
  } catch (error: any) {
    console.error('API Error - GET /orders/:id:', error);
    res.status(500).json({ error: 'Erro ao buscar pedido', code: 'ORDER_FETCH_ERROR' });
  }
});

router.patch('/orders/:orderId', requirePermission('orders:write'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) row = rows[0];
    }, `extApi:getOrderPatch:${orderId}`);
    if (!row || row.tenant_id !== req.apiKey!.sellerId) return res.status(404).json({ error: 'Pedido não encontrado', code: 'ORDER_NOT_FOUND' });

    await neonQuery(async (sql) => {
      if (status && notes) await sql`UPDATE orders SET status = ${status}, notes = ${notes}, updated_at = NOW() WHERE id = ${orderId}`;
      else if (status) await sql`UPDATE orders SET status = ${status}, updated_at = NOW() WHERE id = ${orderId}`;
      else if (notes) await sql`UPDATE orders SET notes = ${notes}, updated_at = NOW() WHERE id = ${orderId}`;
    }, `extApi:patchOrder:${orderId}`);

    res.json({ success: true, message: 'Pedido atualizado', data: { id: orderId, status, notes } });
  } catch (error: any) {
    console.error('API Error - PATCH /orders/:id:', error);
    res.status(500).json({ error: 'Erro ao atualizar pedido', code: 'ORDER_UPDATE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// 🛒 CHECKOUTS
// ═══════════════════════════════════════════════════════════════

router.get('/checkouts', requirePermission('checkouts:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { limit = 20 } = req.query;
    const sellerId = req.apiKey!.sellerId;
    const lim = Math.min(Number(limit), 100);
    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`SELECT id, title, slug, price, active, created_at FROM checkouts WHERE tenant_id = ${sellerId} LIMIT ${lim}`;
    }, `extApi:checkouts:${sellerId}`);
    const checkouts = rows.map((r) => ({ id: r.id, title: r.title, slug: r.slug, price: r.price, active: r.active, createdAt: r.created_at }));
    res.json({ success: true, data: checkouts });
  } catch (error: any) {
    console.error('API Error - GET /checkouts:', error);
    res.status(500).json({ error: 'Erro ao buscar checkouts', code: 'CHECKOUTS_FETCH_ERROR' });
  }
});

router.post('/checkouts', requirePermission('checkouts:create'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { title, price, description, productType } = req.body;
    if (!title || !price) return res.status(400).json({ error: 'Título e preço são obrigatórios', code: 'VALIDATION_ERROR' });

    const checkoutId = generateCheckoutId();
    const sellerId = req.apiKey!.sellerId;
    await neonQuery(async (sql) => {
      await sql`INSERT INTO checkouts (id, title, price, description, product_type, slug, tenant_id, active, created_at, updated_at) VALUES (${checkoutId}, ${title}, ${Number(price)}, ${description || ''}, ${productType || 'digital'}, ${checkoutId}, ${sellerId}, true, NOW(), NOW())`;
    }, `extApi:createCheckout:${checkoutId}`);

    res.status(201).json({ success: true, data: { id: checkoutId, title, price: Number(price), slug: checkoutId, tenantId: sellerId, active: true } });
  } catch (error: any) {
    console.error('API Error - POST /checkouts:', error);
    res.status(500).json({ error: 'Erro ao criar checkout', code: 'CHECKOUT_CREATE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// 📦 PRODUTOS
// ═══════════════════════════════════════════════════════════════

router.get('/products', requirePermission('products:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const sellerId = req.apiKey!.sellerId;
    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`SELECT id, title, description, price, product_type, active, created_at FROM products WHERE tenant_id = ${sellerId} LIMIT 100`;
    }, `extApi:products:${sellerId}`);
    const products = rows.map((r) => ({ id: r.id, title: r.title, description: r.description, price: r.price, productType: r.product_type, active: r.active, createdAt: r.created_at }));
    res.json({ success: true, data: products });
  } catch (error: any) {
    console.error('API Error - GET /products:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos', code: 'PRODUCTS_FETCH_ERROR' });
  }
});

router.post('/products', requirePermission('products:write'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { title, description, price, productType } = req.body;
    if (!title) return res.status(400).json({ error: 'Título é obrigatório', code: 'VALIDATION_ERROR' });
    const { nanoid } = await import('nanoid');
    const productId = `prod_${nanoid(12)}`;
    const sellerId = req.apiKey!.sellerId;
    await neonQuery(async (sql) => {
      await sql`INSERT INTO products (id, title, description, price, product_type, tenant_id, active, created_at, updated_at) VALUES (${productId}, ${title}, ${description || ''}, ${Number(price) || 0}, ${productType || 'digital'}, ${sellerId}, true, NOW(), NOW())`;
    }, `extApi:createProduct:${productId}`);
    res.status(201).json({ success: true, data: { id: productId, title, price: Number(price) || 0, tenantId: sellerId, active: true } });
  } catch (error: any) {
    console.error('API Error - POST /products:', error);
    res.status(500).json({ error: 'Erro ao criar produto', code: 'PRODUCT_CREATE_ERROR' });
  }
});

router.patch('/products/:productId', requirePermission('products:write'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { productId } = req.params;
    const { title, description, price, active } = req.body;
    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id FROM products WHERE id = ${productId} LIMIT 1`;
      if (rows[0]) row = rows[0];
    }, `extApi:getProductPatch:${productId}`);
    if (!row || row.tenant_id !== req.apiKey!.sellerId) return res.status(404).json({ error: 'Produto não encontrado', code: 'PRODUCT_NOT_FOUND' });
    await neonQuery(async (sql) => {
      await sql`UPDATE products SET title = COALESCE(${title ?? null}, title), description = COALESCE(${description ?? null}, description), price = COALESCE(${price != null ? Number(price) : null}, price), active = COALESCE(${active ?? null}, active), updated_at = NOW() WHERE id = ${productId}`;
    }, `extApi:patchProduct:${productId}`);
    res.json({ success: true, message: 'Produto atualizado' });
  } catch (error: any) {
    console.error('API Error - PATCH /products/:id:', error);
    res.status(500).json({ error: 'Erro ao atualizar produto', code: 'PRODUCT_UPDATE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// 👥 CLIENTES
// ═══════════════════════════════════════════════════════════════

router.get('/customers', requirePermission('customers:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { limit = 50 } = req.query;
    const sellerId = req.apiKey!.sellerId;
    const lim = Math.min(Number(limit), 100);
    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`SELECT customer_email AS email, customer_name AS name, customer_phone AS phone, customer_document AS document, MIN(created_at) AS created_at, COUNT(*) AS total_orders FROM orders WHERE tenant_id = ${sellerId} GROUP BY customer_email, customer_name, customer_phone, customer_document ORDER BY created_at DESC LIMIT ${lim}`;
    }, `extApi:customers:${sellerId}`);
    const customers = rows.map((r) => ({ id: r.email, name: r.name, email: r.email, phone: r.phone || '', document: maskDocument(r.document || ''), totalOrders: Number(r.total_orders) || 0, createdAt: r.created_at }));
    res.json({ success: true, data: customers });
  } catch (error: any) {
    console.error('API Error - GET /customers:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes', code: 'CUSTOMERS_FETCH_ERROR' });
  }
});

router.get('/customers/:customerId', requirePermission('customers:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { customerId } = req.params;
    const sellerId = req.apiKey!.sellerId;
    const email = decodeURIComponent(customerId);
    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`SELECT customer_email AS email, customer_name AS name, customer_phone AS phone, customer_document AS document, MIN(created_at) AS created_at, COUNT(*) AS total_orders FROM orders WHERE tenant_id = ${sellerId} AND customer_email = ${email} GROUP BY customer_email, customer_name, customer_phone, customer_document LIMIT 1`;
    }, `extApi:getCustomer:${customerId}`);
    if (!rows[0]) return res.status(404).json({ error: 'Cliente não encontrado', code: 'CUSTOMER_NOT_FOUND' });
    const r = rows[0];
    res.json({ success: true, data: { id: customerId, name: r.name, email: r.email, phone: r.phone || '', document: maskDocument(r.document || ''), totalOrders: Number(r.total_orders) || 0, createdAt: r.created_at } });
  } catch (error: any) {
    console.error('API Error - GET /customers/:id:', error);
    res.status(500).json({ error: 'Erro ao buscar cliente', code: 'CUSTOMER_FETCH_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// 💰 FINANCEIRO
// ═══════════════════════════════════════════════════════════════

router.post('/refunds', requirePermission('refunds:create'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { orderId, amount, reason } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId é obrigatório', code: 'VALIDATION_ERROR' });
    const sellerId = req.apiKey!.sellerId;

    let orderRow: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id, amount, status FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) orderRow = rows[0];
    }, `extApi:getOrderRefund:${orderId}`);
    if (!orderRow || orderRow.tenant_id !== sellerId) return res.status(404).json({ error: 'Pedido não encontrado', code: 'ORDER_NOT_FOUND' });
    if (orderRow.status === 'refunded') return res.status(400).json({ error: 'Pedido já foi reembolsado', code: 'ALREADY_REFUNDED' });

    const { nanoid } = await import('nanoid');
    const refundId = `ref_${nanoid(16)}`;
    const refundAmount = amount || orderRow.amount;
    await neonQuery(async (sql) => {
      await sql`INSERT INTO refunds (id, order_id, tenant_id, amount, reason, status, requested_at, requested_via, created_at, updated_at) VALUES (${refundId}, ${orderId}, ${sellerId}, ${refundAmount}, ${reason || 'Solicitado via API'}, 'pending', NOW(), 'api', NOW(), NOW())`;
      await sql`UPDATE orders SET status = 'refund_requested', updated_at = NOW() WHERE id = ${orderId}`;
    }, `extApi:createRefund:${refundId}`);

    res.status(201).json({ success: true, data: { refundId, orderId, tenantId: sellerId, amount: refundAmount, reason: reason || 'Solicitado via API', status: 'pending' } });
  } catch (error: any) {
    console.error('API Error - POST /refunds:', error);
    res.status(500).json({ error: 'Erro ao processar reembolso', code: 'REFUND_ERROR' });
  }
});

router.get('/balance', requirePermission('balance:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const sellerId = req.apiKey!.sellerId;
    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT available, pending, blocked, updated_at FROM seller_balances WHERE seller_id = ${sellerId} LIMIT 1`;
      if (rows[0]) row = rows[0];
    }, `extApi:balance:${sellerId}`);
    const balance = row || { available: 0, pending: 0, blocked: 0, updated_at: new Date() };
    res.json({ success: true, data: { available: balance.available || 0, pending: balance.pending || 0, blocked: balance.blocked || 0, currency: 'BRL', updatedAt: balance.updated_at || new Date() } });
  } catch (error: any) {
    console.error('API Error - GET /balance:', error);
    res.status(500).json({ error: 'Erro ao buscar saldo', code: 'BALANCE_FETCH_ERROR' });
  }
});

router.get('/analytics', requirePermission('analytics:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const sellerId = req.apiKey!.sellerId;
    let rows: any[] = [];
    await neonQuery(async (sql) => {
      if (startDate && endDate) {
        rows = await sql`SELECT amount, payment_method FROM orders WHERE tenant_id = ${sellerId} AND status = 'paid' AND created_at >= ${new Date(startDate as string)} AND created_at <= ${new Date(endDate as string)} LIMIT 1000`;
      } else {
        rows = await sql`SELECT amount, payment_method FROM orders WHERE tenant_id = ${sellerId} AND status = 'paid' LIMIT 1000`;
      }
    }, `extApi:analytics:${sellerId}`);
    const paymentMethods: Record<string, number> = {};
    let totalRevenue = 0;
    rows.forEach((r) => { totalRevenue += r.amount || 0; const m = r.payment_method || 'unknown'; paymentMethods[m] = (paymentMethods[m] || 0) + 1; });
    const totalOrders = rows.length;
    res.json({ success: true, data: { totalRevenue, totalOrders, averageTicket: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0, paymentMethods, period: { startDate, endDate } } });
  } catch (error: any) {
    console.error('API Error - GET /analytics:', error);
    res.status(500).json({ error: 'Erro ao buscar analytics', code: 'ANALYTICS_FETCH_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// 🔁 ASSINATURAS
// ═══════════════════════════════════════════════════════════════

router.get('/subscriptions', requirePermission('subscriptions:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { status, limit = 50 } = req.query;
    const sellerId = req.apiKey!.sellerId;
    const lim = Math.min(Number(limit), 100);
    let rows: any[] = [];
    await neonQuery(async (sql) => {
      if (status) {
        rows = await sql`SELECT id, customer_id, customer_email, plan_name, amount, status, next_billing_date, created_at FROM subscriptions WHERE tenant_id = ${sellerId} AND status = ${status as string} LIMIT ${lim}`;
      } else {
        rows = await sql`SELECT id, customer_id, customer_email, plan_name, amount, status, next_billing_date, created_at FROM subscriptions WHERE tenant_id = ${sellerId} LIMIT ${lim}`;
      }
    }, `extApi:subscriptions:${sellerId}`);
    const subscriptions = rows.map((r) => ({ id: r.id, customerId: r.customer_id, customerEmail: r.customer_email, planName: r.plan_name, amount: r.amount, status: r.status, nextBillingDate: r.next_billing_date, createdAt: r.created_at }));
    res.json({ success: true, data: subscriptions });
  } catch (error: any) {
    console.error('API Error - GET /subscriptions:', error);
    res.status(500).json({ error: 'Erro ao buscar assinaturas', code: 'SUBSCRIPTIONS_FETCH_ERROR' });
  }
});

router.patch('/subscriptions/:subscriptionId', requirePermission('subscriptions:write'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const { status, autoRenew, nextBillingDate } = req.body;
    const sellerId = req.apiKey!.sellerId;

    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`;
      if (rows[0]) row = rows[0];
    }, `extApi:getSubPatch:${subscriptionId}`);
    if (!row || row.tenant_id !== sellerId) return res.status(404).json({ error: 'Assinatura não encontrada', code: 'SUBSCRIPTION_NOT_FOUND' });

    await neonQuery(async (sql) => {
      await sql`UPDATE subscriptions SET status = COALESCE(${status ?? null}, status), auto_renew = COALESCE(${autoRenew ?? null}, auto_renew), next_billing_date = COALESCE(${nextBillingDate ? new Date(nextBillingDate) : null}, next_billing_date), updated_at = NOW() WHERE id = ${subscriptionId}`;
    }, `extApi:patchSub:${subscriptionId}`);

    res.json({ success: true, message: 'Assinatura atualizada' });
  } catch (error: any) {
    console.error('API Error - PATCH /subscriptions/:id:', error);
    res.status(500).json({ error: 'Erro ao atualizar assinatura', code: 'SUBSCRIPTION_UPDATE_ERROR' });
  }
});

router.delete('/subscriptions/:subscriptionId', requirePermission('subscriptions:write'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const sellerId = req.apiKey!.sellerId;

    let subData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id, customer_id, customer_email, plan_name, amount FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`;
      if (rows[0]) subData = rows[0];
    }, `extApi:getSubDelete:${subscriptionId}`);
    if (!subData || subData.tenant_id !== sellerId) return res.status(404).json({ error: 'Assinatura não encontrada', code: 'SUBSCRIPTION_NOT_FOUND' });

    await neonQuery(async (sql) => {
      await sql`UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), cancelled_via = 'api', updated_at = NOW() WHERE id = ${subscriptionId}`;
    }, `extApi:cancelSub:${subscriptionId}`);

    dispatchSubscriptionCancelledEvent(sellerId, {
      id: subscriptionId, customerId: subData.customer_id, customerEmail: subData.customer_email,
      planName: subData.plan_name, amount: subData.amount, cancelledVia: 'api', cancellationReason: 'Cancelado via API'
    }).catch((e: any) => console.warn('[WEBHOOK] Erro ao disparar subscription.cancelled:', e?.message));

    res.json({ success: true, message: 'Assinatura cancelada' });
  } catch (error: any) {
    console.error('API Error - DELETE /subscriptions/:id:', error);
    res.status(500).json({ error: 'Erro ao cancelar assinatura', code: 'SUBSCRIPTION_CANCEL_ERROR' });
  }
});


// ═══════════════════════════════════════════════════════════════
// 💳 PAGAMENTOS DIRETOS (sem checkout page)
// ═══════════════════════════════════════════════════════════════

router.post('/payments', requirePermission('payments:create'), async (req: ApiKeyRequest, res: Response) => {
  const { method, amount, customer, description, externalRef } = req.body;
  const sellerId = req.apiKey!.sellerId;

  if (!method || !amount || !customer) {
    return res.status(400).json({ error: 'Campos obrigatórios: method, amount, customer', code: 'VALIDATION_ERROR' });
  }
  if (method !== 'pix') {
    return res.status(422).json({
      error: 'method inválido para API direta',
      code: 'INVALID_METHOD',
      message: 'Apenas method=pix é suportado na API direta. Para cartão/boleto use POST /api/payment/create-session via frontend.',
    });
  }
  if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
    return res.status(400).json({ error: 'amount deve ser inteiro positivo em centavos (ex: 9900 = R$ 99,00)', code: 'INVALID_AMOUNT' });
  }
  if (!customer?.name || !customer?.document) {
    return res.status(400).json({ error: 'customer requer: name, document (CPF/CNPJ)', code: 'INVALID_CUSTOMER' });
  }
  const docRaw = (customer.document || '').replace(/\D/g, '');
  if (docRaw.length !== 11 && docRaw.length !== 14) {
    return res.status(400).json({ error: 'document deve ser CPF (11 dígitos) ou CNPJ (14 dígitos)', code: 'INVALID_DOCUMENT' });
  }

  try {
    let sellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, is_blocked, acquirers FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (rows[0]) sellerData = rows[0];
    }, `extApi:getSeller:${sellerId}`);

    // ── Validação KYC / status da conta ──────────────────────────────────────
    if (!sellerData) {
      return res.status(403).json({
        error: 'Conta não encontrada',
        code: 'SELLER_NOT_FOUND',
        message: 'A conta associada a esta API Key não existe.'
      });
    }
    if (sellerData?.status !== 'approved') {
      return res.status(403).json({
        error: 'Conta não aprovada',
        code: 'ACCOUNT_NOT_APPROVED',
        message: 'Sua conta ainda não foi aprovada pelo nosso time. Aguarde a verificação de identidade (KYC) para utilizar a API.'
      });
    }
    if (sellerData?.is_blocked) {
      return res.status(403).json({
        error: 'Conta bloqueada',
        code: 'ACCOUNT_BLOCKED',
        message: 'Sua conta está temporariamente bloqueada. Entre em contato com o suporte.'
      });
    }

    const sellerAcquirers = (typeof sellerData?.acquirers === 'string' ? JSON.parse(sellerData.acquirers) : sellerData?.acquirers) || {};

    const { getPaymentConfig } = await import('../lib/payment-config.js');
    const paymentConfig = await getPaymentConfig(null);

    // Determinar adquirente PIX: seller override → config global → fallback
    const pixAcquirer: string =
      sellerAcquirers?.pix ||
      paymentConfig?.defaultAcquirers?.pix ||
      'efibank';

    // Gerar orderId único para este pedido
    const orderId = `api_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const cleanCustomer = {
      name: String(customer.name).trim(),
      email: String(customer.email || '').trim().toLowerCase(),
      phone: String(customer.phone || '').replace(/\D/g, ''),
      document: docRaw,
    };

    // Pré-calcular taxas para mostrar no dashboard mesmo com pedido pendente
    let preCalcFee = { netAmount: amount, gatewayFee: 0, platformFee: 0, releaseDays: 1, gatewayFeePercent: 0 };
    try {
      const { calculateDynamicFees } = await import('../index.js');
      preCalcFee = await calculateDynamicFees(amount, 'pix', 1, pixAcquirer, sellerId);
    } catch (_feeErr) { /* ignora — fees serão recalculadas na confirmação */ }

    await neonQuery(async (sql) => {
      await sql`INSERT INTO orders (id, tenant_id, seller_id, source, external_ref, description, customer_name, customer_email, customer_phone, customer_document, amount, currency, payment_method, status, acquirer, processor, sale_type, product_type, net_amount, gateway_fee, platform_fee, metadata, created_at, updated_at) VALUES (${orderId}, ${sellerId}, ${sellerId}, 'api', ${externalRef || null}, ${description || null}, ${cleanCustomer.name}, ${cleanCustomer.email}, ${cleanCustomer.phone || null}, ${cleanCustomer.document || null}, ${amount}, 'BRL', 'pix', 'pending', ${pixAcquirer}, ${pixAcquirer}, 'api_direct', 'digital', ${preCalcFee.netAmount}, ${preCalcFee.gatewayFee}, ${preCalcFee.platformFee}, ${JSON.stringify({ apiKeyId: req.apiKey!.id, customer: cleanCustomer })}, NOW(), NOW())`;
    }, `extApi:createOrder:${orderId}`);

    const orderData = { id: orderId, tenantId: sellerId, sellerId, status: 'pending', method: 'pix', amount, customer: cleanCustomer, acquirer: pixAcquirer };


    // Indexar no RTDB para aparecer no dashboard
    const { syncOrderAfterCreate } = await import('../lib/orders-sync.js');
    syncOrderAfterCreate(sellerId, orderId, orderData);

    const amountFormatted = `R$ ${(amount / 100).toFixed(2).replace('.', ',')}`;
    const qrServerUrl = (brCode: string) =>
      `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(brCode)}`;






    // ── ONZ ──────────────────────────────────────────────────────────────────
    if (pixAcquirer === 'onz') {
      const { loadOnzCredentials, createOnzPixCharge } = await import('../lib/onz-finance-api.js');
      const creds = await loadOnzCredentials();
      if (!creds?.enabled) throw new Error('ONZ Finance não está habilitado ou não configurado');

      const result = await createOnzPixCharge({
        orderId,
        amountBRL: amount,
        devedorNome: cleanCustomer.name,
        devedorCpf: cleanCustomer.document,
        descricao: (description || 'Pagamento').substring(0, 50),
        expiracaoSegundos: 3600,
      });

      const brCode = result.brCode || result.location || '';
      const qrImage = result.qrCodeUrl || (brCode ? qrServerUrl(brCode) : '');
      const onzTxid = result.txid || orderId;

      await neonQuery(async (sql) => {
        await sql`UPDATE orders SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{onzTxid}', ${JSON.stringify(onzTxid)}::jsonb), updated_at = NOW() WHERE id = ${orderId}`;
      }, `extApi:updateOrderOnz:${orderId}`);

      dispatchPixCreatedEvent(sellerId, { id: orderId, amount, method: 'pix', acquirer: 'onz', customer: cleanCustomer }).catch(() => {});

      return res.status(201).json({ success: true, orderId, method: 'pix', status: 'pending', qrCode: brCode, qrCodeImage: qrImage, expiresAt: null, amount, amountFormatted });
    }

    // ── EfiBank PIX — OAuth2 + mTLS (mesmo fluxo do checkout) ───────────────
    if (pixAcquirer === 'efibank') {
      const { getEfiBankKeys } = await import('../lib/payment-config.js');
      const efiKeys = await getEfiBankKeys(null);

      const isProduction = efiKeys.environment === 'production';
      const hostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';
      const clientId = efiKeys.clientId;
      const clientSecret = efiKeys.clientSecret;
      const pixKey = efiKeys.pixKey || 'af767a52-0e4b-44fb-b1e0-5816479b08e5';

      if (!clientId || !clientSecret) {
        return res.status(503).json({ error: 'Credenciais EfíBank não configuradas', code: 'EFIBANK_NOT_CONFIGURED' });
      }

      // Carregar certificado P12
      const fsLib = await import('fs');
      const pathLib = await import('path');
      let certBuf: Buffer | null = null;
      const certFilePath = pathLib.join(process.cwd(), 'certs', isProduction ? 'efi-prod.p12' : 'efi-sandbox.p12');
      if (fsLib.existsSync(certFilePath)) {
        try { certBuf = await fsLib.promises.readFile(certFilePath); } catch {}
      }
      if (!certBuf) {
        try {
          const { loadCertificateFromRTDB } = await import('../lib/eternal-sync.js');
          certBuf = await loadCertificateFromRTDB();
        } catch {}
      }

      // mTLS Agent
      const httpsLib = await import('https');
      const mtlsAgent = certBuf && certBuf.length > 256
        ? new httpsLib.Agent({ pfx: certBuf, passphrase: '', rejectUnauthorized: true })
        : undefined;

      // OAuth2 token
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenBody = JSON.stringify({ grant_type: 'client_credentials' });
      const tokenResponse = await new Promise<any>((resolve, reject) => {
        const opts: any = {
          hostname, port: 443, path: '/oauth/token', method: 'POST',
          headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tokenBody) },
          ...(mtlsAgent ? { agent: mtlsAgent } : {})
        };
        const r = httpsLib.request(opts, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(`Token parse: ${d}`)); } });
        });
        r.on('error', reject); r.write(tokenBody); r.end();
      });
      const accessToken = tokenResponse.access_token;
      if (!accessToken) throw new Error(`EfíBank OAuth2 falhou: ${JSON.stringify(tokenResponse)}`);

      // Criar cobrança PIX
      const devedor = docRaw.length === 11
        ? { cpf: docRaw, nome: cleanCustomer.name }
        : { cnpj: docRaw, nome: cleanCustomer.name };
      const pixPayload = {
        calendario: { expiracao: 3600 },
        devedor,
        valor: { original: (amount / 100).toFixed(2) },
        chave: pixKey,
        solicitacaoPagador: (description || 'Pagamento VolatusPay').substring(0, 77)
      };
      const pixBody = JSON.stringify(pixPayload);
      const pixResponse = await new Promise<any>((resolve, reject) => {
        const opts: any = {
          hostname, port: 443, path: '/v2/cob', method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pixBody) },
          ...(mtlsAgent ? { agent: mtlsAgent } : {})
        };
        const r = httpsLib.request(opts, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(d);
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
              else reject(new Error(`PIX ${res.statusCode}: ${parsed.mensagem || d}`));
            } catch { reject(new Error(`PIX parse: ${d}`)); }
          });
        });
        r.on('error', reject); r.write(pixBody); r.end();
      });

      // Buscar QR Code
      const qrResponse = await new Promise<any>((resolve, reject) => {
        const opts: any = {
          hostname, port: 443, path: `/v2/loc/${pixResponse.loc.id}/qrcode`, method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` },
          ...(mtlsAgent ? { agent: mtlsAgent } : {})
        };
        const r = httpsLib.request(opts, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(`QR parse: ${d}`)); } });
        });
        r.on('error', reject); r.end();
      });

      const pixCopiaECola: string = qrResponse.qrcode || '';
      let qrImage: string | null = qrResponse.imagemQrcode || qrResponse.image || null;
      if (!qrImage && pixCopiaECola) {
        try {
          const QRCode = await import('qrcode');
          qrImage = await QRCode.toDataURL(pixCopiaECola, { errorCorrectionLevel: 'M', type: 'image/png', width: 300, margin: 1 });
        } catch {}
      }
      if (qrImage && !qrImage.startsWith('data:')) qrImage = `data:image/png;base64,${qrImage}`;

      const txid = pixResponse.txid;
      await neonQuery(async (sql) => {
        await sql`UPDATE orders SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ txid, efiTxid: txid, pixCopiaECola })}::jsonb, updated_at = NOW() WHERE id = ${orderId}`;
      }, `extApi:updateOrderEfi:${orderId}`);

      dispatchPixCreatedEvent(sellerId, { id: orderId, amount, method: 'pix', acquirer: 'efibank', customer: cleanCustomer }).catch(() => {});

      return res.status(201).json({
        success: true,
        orderId,
        method: 'pix',
        status: 'pending',
        txid,
        qrCode: pixCopiaECola,
        pixCopiaECola,
        qrCodeImage: qrImage,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        amount,
        amountFormatted
      });
    }

    // Adquirente não reconhecido
    return res.status(422).json({
      error: 'Adquirente PIX não suportado',
      code: 'ACQUIRER_NOT_SUPPORTED',
      message: `Adquirente '${pixAcquirer}' não suportado. Configure: efibank, onz.`,
    });

  } catch (error: any) {
    console.error('API Error - POST /api/v1/payments:', error);
    return res.status(500).json({
      error: 'Erro ao processar pagamento',
      code: 'PAYMENT_ERROR',
      message: error.message || 'Erro interno',
    });
  }
});

router.get('/payments/:orderId', requirePermission('payments:read'), async (req: ApiKeyRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, payment_method, amount, acquirer, external_ref, description, paid_at, created_at, customer_name, customer_email, tenant_id FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) row = rows[0];
    }, `extApi:getPayment:${orderId}`);
    if (!row || row.tenant_id !== req.apiKey!.sellerId) return res.status(404).json({ error: 'Pagamento não encontrado', code: 'PAYMENT_NOT_FOUND' });
    return res.json({ success: true, data: { orderId, status: row.status, method: row.payment_method, amount: row.amount, amountFormatted: `R$ ${((row.amount || 0) / 100).toFixed(2).replace('.', ',')}`, acquirer: row.acquirer, externalRef: row.external_ref || null, description: row.description || null, paidAt: row.paid_at || null, createdAt: row.created_at, customerName: row.customer_name, customerEmail: row.customer_email } });
  } catch (error: any) {
    console.error('API Error - GET /api/v1/payments/:orderId:', error);
    return res.status(500).json({ error: 'Erro ao buscar pagamento', code: 'PAYMENT_FETCH_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// 🔧 HELPERS
// ═══════════════════════════════════════════════════════════════

function sanitizeOrderData(data: any) {
  return {
    status: data.status,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    productTitle: data.productTitle,
    createdAt: data.createdAt,
    paidAt: data.paidAt,
  };
}

function maskDocument(doc: string): string {
  if (!doc) return '';
  if (doc.length === 11) return `***.***.${doc.slice(6, 9)}-**`;
  if (doc.length === 14) return `**.***.***/****-${doc.slice(-2)}`;
  return '***';
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    + '-' + Math.random().toString(36).substring(2, 8);
}

export default router;
