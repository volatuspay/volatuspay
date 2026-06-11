/**
 * 🐘 NEON READS — Neon-first com fallback implícito para Firebase
 *
 * Cada função retorna os dados do Neon ou null.
 * null = caller deve usar Firebase como fallback.
 * Nunca lança exceção — erros viram null silenciosamente.
 */

import { neonQuery } from './neon-db.js';

// ─────────────────────────────────────────────
// API KEYS
// ─────────────────────────────────────────────

export interface NeonApiKey {
  id: string;
  sellerId: string;
  name: string;
  permissions: string[];
}

/**
 * Busca API key por hash no Neon.
 * Retorna null se não encontrada (ou inativa) — caller usa Firebase.
 */
export async function neonReadApiKey(keyHash: string): Promise<NeonApiKey | null> {
  let result: NeonApiKey | null = null;
  await neonQuery(async (sql) => {
    const rows = await sql<{ id: string; seller_id: string; name: string; permissions: any; active: boolean }[]>`
      SELECT id, seller_id, name, permissions, active
      FROM api_keys
      WHERE key_hash = ${keyHash}
      LIMIT 1
    `;
    if (rows.length > 0 && rows[0].active !== false) {
      result = {
        id: rows[0].id,
        sellerId: rows[0].seller_id,
        name: rows[0].name || '',
        permissions: Array.isArray(rows[0].permissions) ? rows[0].permissions : [],
      };
    }
  }, `neonReadApiKey(${keyHash.slice(0, 8)})`);
  return result;
}

// ─────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────

/**
 * Busca order por ID no Neon.
 * Retorna objeto compatível com Firebase .data() ou null.
 */
export async function neonReadOrder(orderId: string): Promise<Record<string, any> | null> {
  let result: Record<string, any> | null = null;
  await neonQuery(async (sql) => {
    const rows = await sql`
      SELECT *
      FROM orders
      WHERE id = ${orderId}
      LIMIT 1
    `;
    if (rows.length > 0) {
      const r = rows[0] as any;
      // Mapear snake_case → camelCase para compatibilidade com código Firebase existente
      result = {
        id: r.id,
        checkoutId: r.checkout_id,
        productId: r.product_id,
        tenantId: r.tenant_id,
        sellerId: r.seller_id,
        status: r.status,
        method: r.method,
        paymentMethod: r.payment_method,
        amount: r.amount,
        currency: r.currency,
        installments: r.installments,
        efiChargeId: r.efi_charge_id,
        efiTxid: r.efi_txid,
        efiStatus: r.efi_status,
        couponCode: r.coupon_code,
        affiliateUid: r.affiliate_uid,
        gatewayFee: r.gateway_fee,
        platformFee: r.platform_fee,
        netAmount: r.net_amount,
        customer: r.customer,
        financialData: r.financial_data,
        financial: r.financial,
        metadata: r.metadata,
        paidAt: r.paid_at,
        refundedAt: r.refunded_at,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        // _source para rastreio
        _neon: true,
      };
    }
  }, `neonReadOrder(${orderId})`);
  return result;
}

// ─────────────────────────────────────────────
// SELLERS
// ─────────────────────────────────────────────

/**
 * Busca tenantId do seller por UID no Neon.
 * Retorna tenantId string ou null.
 */
export async function neonReadSellerTenantId(sellerId: string): Promise<string | null> {
  let result: string | null = null;
  await neonQuery(async (sql) => {
    const rows = await sql<{ tenant_id: string | null }[]>`
      SELECT tenant_id
      FROM sellers
      WHERE id = ${sellerId}
      LIMIT 1
    `;
    if (rows.length > 0 && rows[0].tenant_id) {
      result = rows[0].tenant_id;
    }
  }, `neonReadSellerTenantId(${sellerId})`);
  return result;
}

/**
 * Busca dados básicos do seller por ID no Neon.
 * Retorna objeto com campos principais ou null.
 */
export async function neonReadSeller(sellerId: string): Promise<Record<string, any> | null> {
  let result: Record<string, any> | null = null;
  await neonQuery(async (sql) => {
    const rows = await sql`
      SELECT *
      FROM sellers
      WHERE id = ${sellerId}
      LIMIT 1
    `;
    if (rows.length > 0) {
      const r = rows[0] as any;
      result = {
        id: r.id,
        tenantId: r.tenant_id,
        email: r.email,
        name: r.name,
        businessName: r.business_name,
        status: r.status,
        phone: r.phone,
        document: r.document,
        plan: r.plan,
        profileComplete: r.profile_complete,
        approvedAt: r.approved_at,
        blockedAt: r.blocked_at,
        acquirers: r.acquirers,
        bankingData: r.banking_data,
        createdAt: r.created_at,
        _neon: true,
      };
    }
  }, `neonReadSeller(${sellerId})`);
  return result;
}

// ─────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────

/**
 * Busca subscription por ID no Neon.
 * Retorna objeto compatível com Firebase .data() ou null.
 */
export async function neonReadSubscription(subscriptionId: string): Promise<Record<string, any> | null> {
  let result: Record<string, any> | null = null;
  await neonQuery(async (sql) => {
    const rows = await sql`
      SELECT *
      FROM subscriptions
      WHERE id = ${subscriptionId}
      LIMIT 1
    `;
    if (rows.length > 0) {
      const r = rows[0] as any;
      result = {
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerEmail: r.customer_email,
        tenantId: r.tenant_id,
        productId: r.product_id,
        productName: r.product_name,
        orderId: r.order_id,
        status: r.status,
        billingCycle: r.billing_cycle,
        period: r.period,
        amount: r.amount,
        currency: r.currency,
        recurringCount: r.recurring_count,
        method: r.method,
        autoRenew: r.auto_renew,
        dunningAttempts: r.dunning_attempts,
        nextBillingDate: r.next_billing_date,
        currentPeriodStart: r.current_period_start,
        currentPeriodEnd: r.current_period_end,
        cancelledAt: r.cancelled_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        _neon: true,
      };
    }
  }, `neonReadSubscription(${subscriptionId})`);
  return result;
}
