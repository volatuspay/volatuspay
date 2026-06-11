/**
 * 🔄 NEON DUAL-WRITE — Financeiro (Etapa 2)
 * Espelha orders, saldos e movimentos do Firebase → Neon em paralelo.
 * Firebase continua sendo a fonte primária de leitura nesta fase.
 */

import { neonQuery } from './neon-db.js';

// ── ORDERS ────────────────────────────────────────────────────────────────────

export async function neonWriteOrder(order: {
  id: string;
  checkoutId?: string | null;
  productId?: string | null;
  tenantId: string;
  sellerId: string;
  status: string;
  method: string;
  paymentMethod?: string | null;
  paymentProcessor?: string | null;
  amount: number;
  currency?: string;
  installments?: number;
  productType?: string | null;
  marketTarget?: string | null;
  subscriptionPeriod?: string | null;
  efiChargeId?: string | null;
  efiTxid?: string | null;
  efiStatus?: string | null;
  cardMask?: string | null;
  offerSlug?: string | null;
  offerTitle?: string | null;
  couponCode?: string | null;
  affiliateUid?: string | null;
  gatewayFee?: number;
  gatewayFeePercent?: number;
  platformFee?: number;
  platformFeePercent?: number;
  netAmount?: number;
  customer?: any;
  customerAddress?: any;
  checkoutSnapshot?: any;
  financialData?: any;
  financial?: any;
  trackingParameters?: any;
  selectedOrderBumps?: any;
  orderBumps?: any;
  metadata?: any;
}): Promise<void> {
  await neonQuery(async (sql) => {
    const cust = order.customer != null ? JSON.stringify(order.customer) : null;
    const custAddr = order.customerAddress != null ? JSON.stringify(order.customerAddress) : null;
    const snap = order.checkoutSnapshot != null ? JSON.stringify(order.checkoutSnapshot) : null;
    const finData = order.financialData != null ? JSON.stringify(order.financialData) : null;
    const fin = order.financial != null ? JSON.stringify(order.financial) : null;
    const tracking = order.trackingParameters != null ? JSON.stringify(order.trackingParameters) : null;
    const selBumps = order.selectedOrderBumps != null ? JSON.stringify(order.selectedOrderBumps) : null;
    const bumps = order.orderBumps != null ? JSON.stringify(order.orderBumps) : null;
    const meta = order.metadata != null ? JSON.stringify(order.metadata) : null;

    await sql`
      INSERT INTO orders (
        id, checkout_id, product_id, tenant_id, seller_id,
        status, method, payment_method, payment_processor,
        amount, currency, installments,
        product_type, market_target, subscription_period,
        efi_charge_id, efi_txid, efi_status, card_mask,
        offer_slug, offer_title, coupon_code, affiliate_uid,
        gateway_fee, gateway_fee_percent, platform_fee, platform_fee_percent, net_amount,
        customer, customer_address, checkout_snapshot, financial_data, financial,
        tracking_parameters, selected_order_bumps, order_bumps, metadata
      ) VALUES (
        ${order.id},
        ${order.checkoutId ?? null},
        ${order.productId ?? null},
        ${order.tenantId},
        ${order.sellerId},
        ${order.status},
        ${order.method},
        ${order.paymentMethod ?? null},
        ${order.paymentProcessor ?? null},
        ${order.amount},
        ${order.currency ?? 'BRL'},
        ${order.installments ?? 1},
        ${order.productType ?? null},
        ${order.marketTarget ?? null},
        ${order.subscriptionPeriod ?? null},
        ${order.efiChargeId ?? null},
        ${order.efiTxid ?? null},
        ${order.efiStatus ?? null},
        ${order.cardMask ?? null},
        ${order.offerSlug ?? null},
        ${order.offerTitle ?? null},
        ${order.couponCode ?? null},
        ${order.affiliateUid ?? null},
        ${order.gatewayFee ?? 0},
        ${order.gatewayFeePercent ?? 0},
        ${order.platformFee ?? 0},
        ${order.platformFeePercent ?? 0},
        ${order.netAmount ?? 0},
        ${cust},
        ${custAddr},
        ${snap},
        ${finData},
        ${fin},
        ${tracking},
        ${selBumps},
        ${bumps},
        ${meta}
      )
      ON CONFLICT (id) DO UPDATE SET
        status           = EXCLUDED.status,
        efi_charge_id    = COALESCE(EXCLUDED.efi_charge_id, orders.efi_charge_id),
        efi_txid         = COALESCE(EXCLUDED.efi_txid, orders.efi_txid),
        efi_status       = COALESCE(EXCLUDED.efi_status, orders.efi_status),
        net_amount       = CASE WHEN EXCLUDED.net_amount > 0 THEN EXCLUDED.net_amount ELSE orders.net_amount END,
        financial        = COALESCE(EXCLUDED.financial, orders.financial),
        financial_data   = COALESCE(EXCLUDED.financial_data, orders.financial_data),
        updated_at       = NOW()
    `;
  }, `writeOrder:${order.id}`);
}

export async function neonUpdateOrderStatus(
  orderId: string,
  status: string,
  extra?: { paidAt?: Date; refundedAt?: Date; netAmount?: number }
): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      UPDATE orders SET
        status      = ${status},
        paid_at     = CASE WHEN ${extra?.paidAt ?? null} IS NOT NULL THEN ${extra?.paidAt ?? null} ELSE paid_at END,
        refunded_at = CASE WHEN ${extra?.refundedAt ?? null} IS NOT NULL THEN ${extra?.refundedAt ?? null} ELSE refunded_at END,
        net_amount  = CASE WHEN ${extra?.netAmount ?? null} IS NOT NULL THEN ${extra?.netAmount ?? 0} ELSE net_amount END,
        updated_at  = NOW()
      WHERE id = ${orderId}
    `;
  }, `updateOrderStatus:${orderId}`);
}

// ── SELLER BALANCES ────────────────────────────────────────────────────────────

/**
 * Upsert de saldo vendedor — suporta bootstrap (primeiro doc) e incremento.
 * Usa CASE WHEN para colunas dinâmicas sem sql.unsafe().
 */
export async function neonUpsertSellerBalance(data: {
  sellerId: string;
  delta: number;
  currency: 'BRL' | 'USD' | 'EUR';
  balanceType: 'available' | 'pending' | 'reserved';
  operation: 'add' | 'subtract';
  isBootstrap?: boolean;
  bootstrapDoc?: Record<string, any>;
}): Promise<void> {
  const { sellerId, delta, currency, balanceType, operation, isBootstrap, bootstrapDoc } = data;

  await neonQuery(async (sql) => {
    if (isBootstrap && bootstrapDoc) {
      await sql`
        INSERT INTO seller_balances (
          seller_id,
          total_balance, available_balance, pending_balance, reserved_balance,
          balance_available_brl, balance_pending_brl, balance_reserved_brl, lifetime_revenue_brl,
          balance_available_usd, balance_pending_usd, balance_reserved_usd, lifetime_revenue_usd,
          balance_available_eur, balance_pending_eur, balance_reserved_eur, lifetime_revenue_eur,
          total_withdrawn_brl, total_withdrawn_usd, total_withdrawn_eur,
          by_method, version
        ) VALUES (
          ${sellerId},
          ${bootstrapDoc.totalBalance ?? 0},
          ${bootstrapDoc.availableBalance ?? 0},
          ${bootstrapDoc.pendingBalance ?? 0},
          ${bootstrapDoc.reservedBalance ?? 0},
          ${bootstrapDoc.balanceAvailable_BRL ?? 0},
          ${bootstrapDoc.balancePending_BRL ?? 0},
          ${bootstrapDoc.balanceReserved_BRL ?? 0},
          ${bootstrapDoc.lifetimeRevenue_BRL ?? 0},
          ${bootstrapDoc.balanceAvailable_USD ?? 0},
          ${bootstrapDoc.balancePending_USD ?? 0},
          ${bootstrapDoc.balanceReserved_USD ?? 0},
          ${bootstrapDoc.lifetimeRevenue_USD ?? 0},
          ${bootstrapDoc.balanceAvailable_EUR ?? 0},
          ${bootstrapDoc.balancePending_EUR ?? 0},
          ${bootstrapDoc.balanceReserved_EUR ?? 0},
          ${bootstrapDoc.lifetimeRevenue_EUR ?? 0},
          ${bootstrapDoc.totalWithdrawn_BRL ?? 0},
          ${bootstrapDoc.totalWithdrawn_USD ?? 0},
          ${bootstrapDoc.totalWithdrawn_EUR ?? 0},
          ${bootstrapDoc.byMethod ? JSON.stringify(bootstrapDoc.byMethod) : null},
          ${bootstrapDoc.version ?? 1}
        )
        ON CONFLICT (seller_id) DO NOTHING
      `;
      return;
    }

    const d = delta;
    const isBRL  = currency === 'BRL';
    const isUSD  = currency === 'USD';
    const isEUR  = currency === 'EUR';
    const isAvail = balanceType === 'available';
    const isPend  = balanceType === 'pending';
    const isResv  = balanceType === 'reserved';
    const isAdd   = operation === 'add';

    await sql`
      INSERT INTO seller_balances (seller_id)
      VALUES (${sellerId})
      ON CONFLICT (seller_id) DO NOTHING
    `;

    await sql`
      UPDATE seller_balances SET
        total_balance         = total_balance + ${d},
        available_balance     = available_balance     + CASE WHEN ${isAvail} THEN ${d} ELSE 0 END,
        pending_balance       = pending_balance       + CASE WHEN ${isPend}  THEN ${d} ELSE 0 END,
        reserved_balance      = reserved_balance      + CASE WHEN ${isResv}  THEN ${d} ELSE 0 END,
        balance_available_brl = balance_available_brl + CASE WHEN ${isBRL && isAvail} THEN ${d} ELSE 0 END,
        balance_pending_brl   = balance_pending_brl   + CASE WHEN ${isBRL && isPend}  THEN ${d} ELSE 0 END,
        balance_reserved_brl  = balance_reserved_brl  + CASE WHEN ${isBRL && isResv}  THEN ${d} ELSE 0 END,
        lifetime_revenue_brl  = lifetime_revenue_brl  + CASE WHEN ${isBRL && isAvail && isAdd} THEN ABS(${d}) ELSE 0 END,
        balance_available_usd = balance_available_usd + CASE WHEN ${isUSD && isAvail} THEN ${d} ELSE 0 END,
        balance_pending_usd   = balance_pending_usd   + CASE WHEN ${isUSD && isPend}  THEN ${d} ELSE 0 END,
        balance_reserved_usd  = balance_reserved_usd  + CASE WHEN ${isUSD && isResv}  THEN ${d} ELSE 0 END,
        lifetime_revenue_usd  = lifetime_revenue_usd  + CASE WHEN ${isUSD && isAvail && isAdd} THEN ABS(${d}) ELSE 0 END,
        balance_available_eur = balance_available_eur + CASE WHEN ${isEUR && isAvail} THEN ${d} ELSE 0 END,
        balance_pending_eur   = balance_pending_eur   + CASE WHEN ${isEUR && isPend}  THEN ${d} ELSE 0 END,
        balance_reserved_eur  = balance_reserved_eur  + CASE WHEN ${isEUR && isResv}  THEN ${d} ELSE 0 END,
        lifetime_revenue_eur  = lifetime_revenue_eur  + CASE WHEN ${isEUR && isAvail && isAdd} THEN ABS(${d}) ELSE 0 END,
        version               = version + 1,
        updated_at            = NOW()
      WHERE seller_id = ${sellerId}
    `;
  }, `upsertSellerBalance:${sellerId}`);
}

export async function neonMoveSellerBalance(data: {
  sellerId: string;
  amountCents: number;
  currency: 'BRL' | 'USD' | 'EUR';
  from: 'available' | 'pending' | 'reserved';
  to: 'available' | 'pending' | 'reserved';
}): Promise<void> {
  const { sellerId, amountCents, currency, from, to } = data;

  await neonQuery(async (sql) => {
    const isBRL = currency === 'BRL';
    const isUSD = currency === 'USD';
    const isEUR = currency === 'EUR';

    const fromIsAvail = from === 'available';
    const fromIsPend  = from === 'pending';
    const fromIsResv  = from === 'reserved';
    const toIsAvail   = to === 'available';
    const toIsPend    = to === 'pending';
    const toIsResv    = to === 'reserved';
    const neg = -amountCents;

    await sql`
      UPDATE seller_balances SET
        available_balance     = available_balance     + CASE WHEN ${toIsAvail} THEN ${amountCents} WHEN ${fromIsAvail} THEN ${neg} ELSE 0 END,
        pending_balance       = pending_balance       + CASE WHEN ${toIsPend}  THEN ${amountCents} WHEN ${fromIsPend}  THEN ${neg} ELSE 0 END,
        reserved_balance      = reserved_balance      + CASE WHEN ${toIsResv}  THEN ${amountCents} WHEN ${fromIsResv}  THEN ${neg} ELSE 0 END,
        balance_available_brl = balance_available_brl + CASE WHEN ${isBRL && toIsAvail} THEN ${amountCents} WHEN ${isBRL && fromIsAvail} THEN ${neg} ELSE 0 END,
        balance_pending_brl   = balance_pending_brl   + CASE WHEN ${isBRL && toIsPend}  THEN ${amountCents} WHEN ${isBRL && fromIsPend}  THEN ${neg} ELSE 0 END,
        balance_reserved_brl  = balance_reserved_brl  + CASE WHEN ${isBRL && toIsResv}  THEN ${amountCents} WHEN ${isBRL && fromIsResv}  THEN ${neg} ELSE 0 END,
        balance_available_usd = balance_available_usd + CASE WHEN ${isUSD && toIsAvail} THEN ${amountCents} WHEN ${isUSD && fromIsAvail} THEN ${neg} ELSE 0 END,
        balance_pending_usd   = balance_pending_usd   + CASE WHEN ${isUSD && toIsPend}  THEN ${amountCents} WHEN ${isUSD && fromIsPend}  THEN ${neg} ELSE 0 END,
        balance_reserved_usd  = balance_reserved_usd  + CASE WHEN ${isUSD && toIsResv}  THEN ${amountCents} WHEN ${isUSD && fromIsResv}  THEN ${neg} ELSE 0 END,
        balance_available_eur = balance_available_eur + CASE WHEN ${isEUR && toIsAvail} THEN ${amountCents} WHEN ${isEUR && fromIsAvail} THEN ${neg} ELSE 0 END,
        balance_pending_eur   = balance_pending_eur   + CASE WHEN ${isEUR && toIsPend}  THEN ${amountCents} WHEN ${isEUR && fromIsPend}  THEN ${neg} ELSE 0 END,
        balance_reserved_eur  = balance_reserved_eur  + CASE WHEN ${isEUR && toIsResv}  THEN ${amountCents} WHEN ${isEUR && fromIsResv}  THEN ${neg} ELSE 0 END,
        version               = version + 1,
        updated_at            = NOW()
      WHERE seller_id = ${sellerId}
    `;
  }, `moveSellerBalance:${sellerId}`);
}

// ── BALANCE MOVEMENTS ─────────────────────────────────────────────────────────

export async function neonWriteBalanceMovement(movement: {
  sellerId: string;
  amountCents: number;
  currency: string;
  balanceType: string;
  operation: string;
  reason: string;
  orderId?: string | null;
  subscriptionId?: string | null;
  webhookId?: string | null;
  provider?: string | null;
  eventType?: string | null;
  metadata?: Record<string, any> | null;
}): Promise<void> {
  await neonQuery(async (sql) => {
    const meta = movement.metadata != null ? JSON.stringify(movement.metadata) : null;
    await sql`
      INSERT INTO balance_movements (
        seller_id, amount_cents, currency, balance_type, operation, reason,
        order_id, subscription_id, webhook_id, provider, event_type, metadata
      ) VALUES (
        ${movement.sellerId},
        ${movement.amountCents},
        ${movement.currency},
        ${movement.balanceType},
        ${movement.operation},
        ${movement.reason},
        ${movement.orderId ?? null},
        ${movement.subscriptionId ?? null},
        ${movement.webhookId ?? null},
        ${movement.provider ?? null},
        ${movement.eventType ?? null},
        ${meta}
      )
    `;
  }, `writeBalanceMovement:${movement.sellerId}`);
}
