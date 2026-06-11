/**
 * 🐘 NEON — Dual-write para affiliations, affiliates, affiliate_balances, affiliate_clicks
 * Fire-and-forget: nunca bloqueia o fluxo Firebase principal
 */

import { neonQuery } from './neon-db.js';

// ─────────────────────────────────────────────
// AFFILIATIONS (sistema novo — produto/afiliado)
// ─────────────────────────────────────────────

export async function neonWriteAffiliation(data: {
  id: string;
  affiliateId?: string;
  affiliateName?: string;
  affiliateEmail?: string;
  productId?: string;
  productName?: string;
  sellerId?: string;
  sellerName?: string;
  status?: string;
  affiliateCode?: string;
  affiliateLink?: string;
  commissionSnapshot?: Record<string, any>;
  totalSales?: number;
  totalEarnings?: number;
  approvedAt?: Date | null;
  createdAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO affiliations (
        id, affiliate_id, affiliate_name, affiliate_email,
        product_id, product_name, seller_id, seller_name,
        status, affiliate_code, affiliate_link,
        commission_snapshot, total_sales, total_earnings,
        approved_at, created_at, updated_at
      ) VALUES (
        ${data.id},
        ${data.affiliateId ?? null},
        ${data.affiliateName ?? null},
        ${data.affiliateEmail ?? null},
        ${data.productId ?? null},
        ${data.productName ?? null},
        ${data.sellerId ?? null},
        ${data.sellerName ?? null},
        ${data.status ?? 'pending'},
        ${data.affiliateCode ?? null},
        ${data.affiliateLink ?? null},
        ${data.commissionSnapshot ? JSON.stringify(data.commissionSnapshot) : null},
        ${data.totalSales ?? 0},
        ${data.totalEarnings ?? 0},
        ${data.approvedAt ?? null},
        ${data.createdAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        affiliate_id        = EXCLUDED.affiliate_id,
        affiliate_name      = EXCLUDED.affiliate_name,
        affiliate_email     = EXCLUDED.affiliate_email,
        product_id          = EXCLUDED.product_id,
        product_name        = EXCLUDED.product_name,
        seller_id           = EXCLUDED.seller_id,
        seller_name         = EXCLUDED.seller_name,
        status              = EXCLUDED.status,
        affiliate_code      = EXCLUDED.affiliate_code,
        affiliate_link      = EXCLUDED.affiliate_link,
        commission_snapshot = EXCLUDED.commission_snapshot,
        total_sales         = EXCLUDED.total_sales,
        total_earnings      = EXCLUDED.total_earnings,
        approved_at         = EXCLUDED.approved_at,
        updated_at          = NOW()
    `;
  }, `neonWriteAffiliation(${data.id})`);
}

export async function neonUpdateAffiliationStatus(
  id: string,
  status: 'approved' | 'rejected' | 'removed',
  extra?: { approvedAt?: Date; rejectedAt?: Date; removedAt?: Date }
): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO affiliations (id, status, approved_at, updated_at)
      VALUES (${id}, ${status}, ${extra?.approvedAt ?? null}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        status      = ${status},
        approved_at = COALESCE(${extra?.approvedAt ?? null}, affiliations.approved_at),
        updated_at  = NOW()
    `;
  }, `neonUpdateAffiliationStatus(${id}, ${status})`);
}

// ─────────────────────────────────────────────
// AFFILIATES (sistema checkout/legacy)
// ─────────────────────────────────────────────

export async function neonWriteAffiliate(data: {
  id: string;
  userId?: string;
  checkoutId?: string;
  sellerId?: string;
  name?: string;
  email?: string;
  document?: string;
  phone?: string;
  pixKey?: string;
  status?: string;
  customCommission?: number;
  affiliateLink?: string;
  affiliateSlug?: string;
  affiliateCode?: string;
  totalClicks?: number;
  totalSales?: number;
  totalCommissions?: number;
  approvedAt?: Date | null;
  createdAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO affiliates (
        id, user_id, checkout_id, seller_id,
        name, email, document, phone, pix_key,
        status, custom_commission,
        affiliate_link, affiliate_slug, affiliate_code,
        total_clicks, total_sales, total_commissions,
        approved_at, created_at, updated_at
      ) VALUES (
        ${data.id},
        ${data.userId ?? null},
        ${data.checkoutId ?? null},
        ${data.sellerId ?? null},
        ${data.name ?? null},
        ${data.email ?? null},
        ${data.document ?? null},
        ${data.phone ?? null},
        ${data.pixKey ?? null},
        ${data.status ?? 'pending'},
        ${data.customCommission ?? 10},
        ${data.affiliateLink ?? null},
        ${data.affiliateSlug ?? null},
        ${data.affiliateCode ?? null},
        ${data.totalClicks ?? 0},
        ${data.totalSales ?? 0},
        ${data.totalCommissions ?? 0},
        ${data.approvedAt ?? null},
        ${data.createdAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id           = EXCLUDED.user_id,
        checkout_id       = EXCLUDED.checkout_id,
        seller_id         = EXCLUDED.seller_id,
        name              = EXCLUDED.name,
        email             = EXCLUDED.email,
        status            = EXCLUDED.status,
        custom_commission = EXCLUDED.custom_commission,
        affiliate_link    = EXCLUDED.affiliate_link,
        affiliate_slug    = EXCLUDED.affiliate_slug,
        affiliate_code    = EXCLUDED.affiliate_code,
        approved_at       = EXCLUDED.approved_at,
        updated_at        = NOW()
    `;
  }, `neonWriteAffiliate(${data.id})`);
}

export async function neonUpdateAffiliate(
  id: string,
  updates: { status?: string; customCommission?: number; approvedAt?: Date }
): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO affiliates (id, updated_at)
      VALUES (${id}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        status            = COALESCE(${updates.status ?? null}, affiliates.status),
        custom_commission = COALESCE(${updates.customCommission ?? null}, affiliates.custom_commission),
        approved_at       = COALESCE(${updates.approvedAt ?? null}, affiliates.approved_at),
        updated_at        = NOW()
    `;
  }, `neonUpdateAffiliate(${id})`);
}

// ─────────────────────────────────────────────
// AFFILIATE BALANCES
// ─────────────────────────────────────────────

export async function neonUpsertAffiliateBalance(data: {
  userId: string;
  balanceAvailableBrl: number;
  balancePendingBrl: number;
  balanceReservedBrl?: number;
  lifetimeCommissionsBrl: number;
  totalWithdrawnBrl?: number;
  totalSales?: number;
  totalCommissions?: number;
  pendingCommissions?: number;
  approvedCommissions?: number;
}): Promise<void> {
  if (!data.userId) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO affiliate_balances (
        user_id,
        balance_available_brl, balance_pending_brl, balance_reserved_brl,
        lifetime_commissions_brl, total_withdrawn_brl,
        total_sales, total_commissions, pending_commissions, approved_commissions,
        created_at, updated_at
      ) VALUES (
        ${data.userId},
        ${data.balanceAvailableBrl},
        ${data.balancePendingBrl},
        ${data.balanceReservedBrl ?? 0},
        ${data.lifetimeCommissionsBrl},
        ${data.totalWithdrawnBrl ?? 0},
        ${data.totalSales ?? 0},
        ${data.totalCommissions ?? 0},
        ${data.pendingCommissions ?? 0},
        ${data.approvedCommissions ?? 0},
        NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        balance_available_brl    = EXCLUDED.balance_available_brl,
        balance_pending_brl      = EXCLUDED.balance_pending_brl,
        balance_reserved_brl     = EXCLUDED.balance_reserved_brl,
        lifetime_commissions_brl = EXCLUDED.lifetime_commissions_brl,
        total_withdrawn_brl      = EXCLUDED.total_withdrawn_brl,
        total_sales              = EXCLUDED.total_sales,
        total_commissions        = EXCLUDED.total_commissions,
        pending_commissions      = EXCLUDED.pending_commissions,
        approved_commissions     = EXCLUDED.approved_commissions,
        updated_at               = NOW()
    `;
  }, `neonUpsertAffiliateBalance(${data.userId})`);
}

// ─────────────────────────────────────────────
// AFFILIATE CLICKS
// ─────────────────────────────────────────────

export async function neonWriteAffiliateClick(data: {
  id: string;
  affiliateId?: string;
  checkoutId?: string;
  sellerId?: string;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
  converted?: boolean;
  clickedAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO affiliate_clicks (
        id, affiliate_id, checkout_id, seller_id,
        ip_address, user_agent, referrer, converted, clicked_at, created_at
      ) VALUES (
        ${data.id},
        ${data.affiliateId ?? null},
        ${data.checkoutId ?? null},
        ${data.sellerId ?? null},
        ${data.ipAddress ?? null},
        ${data.userAgent ?? null},
        ${data.referrer ?? null},
        ${data.converted ?? false},
        ${data.clickedAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }, `neonWriteAffiliateClick(${data.id})`);
}
