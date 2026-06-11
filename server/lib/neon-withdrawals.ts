/**
 * 🐘 NEON — dual-write para withdrawals e affiliate_commissions
 * Fire-and-forget: nunca bloqueia o fluxo Firebase principal
 */

import { neonQuery } from './neon-db.js';

// ─── WITHDRAWALS ─────────────────────────────────────────────────────────────

export async function neonWriteWithdrawal(w: {
  withdrawalId: string;
  sellerId: string;
  tenantId?: string;
  userType?: string;
  amount: number;
  fee?: number;
  currency: string;
  status: string;
  breakdown?: Record<string, number>;
  pixKey?: string;
  pixKeyType?: string;
  holderName?: string;
  holderEmail?: string;
  holderDocument?: string;
  requestedAt?: Date | null;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO withdrawals (
        id, seller_id, tenant_id, user_type, amount, fee, currency, status,
        breakdown, pix_key, pix_key_type, holder_name, holder_email, holder_document,
        requested_at, created_at, updated_at
      ) VALUES (
        ${w.withdrawalId}, ${w.sellerId}, ${w.tenantId ?? w.sellerId},
        ${w.userType ?? 'seller'}, ${w.amount}, ${w.fee ?? 0}, ${w.currency},
        ${w.status}, ${w.breakdown ? JSON.stringify(w.breakdown) : null},
        ${w.pixKey ?? null}, ${w.pixKeyType ?? null}, ${w.holderName ?? null},
        ${w.holderEmail ?? null}, ${w.holderDocument ?? null},
        ${w.requestedAt ?? new Date()}, NOW(), NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }, `neonWriteWithdrawal:${w.withdrawalId}`);
}

export async function neonUpdateWithdrawalStatus(data: {
  withdrawalId: string;
  status: string;
  approvedBy?: string;
  approvedByEmail?: string;
  rejectedBy?: string;
  rejectedByEmail?: string;
  rejectionReason?: string;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  processingAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  cancelledAt?: Date | null;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      UPDATE withdrawals SET
        status           = ${data.status},
        approved_by      = COALESCE(${data.approvedBy ?? null}, approved_by),
        approved_by_email= COALESCE(${data.approvedByEmail ?? null}, approved_by_email),
        rejected_by      = COALESCE(${data.rejectedBy ?? null}, rejected_by),
        rejected_by_email= COALESCE(${data.rejectedByEmail ?? null}, rejected_by_email),
        rejection_reason = COALESCE(${data.rejectionReason ?? null}, rejection_reason),
        approved_at      = COALESCE(${data.approvedAt ?? null}, approved_at),
        rejected_at      = COALESCE(${data.rejectedAt ?? null}, rejected_at),
        processing_at    = COALESCE(${data.processingAt ?? null}, processing_at),
        completed_at     = COALESCE(${data.completedAt ?? null}, completed_at),
        failed_at        = COALESCE(${data.failedAt ?? null}, failed_at),
        cancelled_at     = COALESCE(${data.cancelledAt ?? null}, cancelled_at),
        updated_at       = NOW()
      WHERE id = ${data.withdrawalId}
    `;
  }, `neonUpdateWithdrawal:${data.withdrawalId}:${data.status}`);
}

// ─── AFFILIATE COMMISSIONS ───────────────────────────────────────────────────

export async function neonWriteAffiliateCommission(c: {
  id: string;
  tenantId?: string;
  affiliateId: string;
  affiliateCode?: string;
  affiliateName?: string;
  affiliateEmail?: string;
  orderId?: string;
  checkoutId?: string;
  productId?: string;
  productName?: string;
  productType?: string;
  customerEmail?: string;
  customerName?: string;
  orderAmount?: number;
  commissionPercent?: number;
  amount?: number;
  grossAmount?: number;
  adminFee?: number;
  netAmount?: number;
  adminFeePercent?: number;
  status?: string;
  paymentMethod?: string;
  balanceCredited?: boolean;
  releaseDate?: Date | null;
  paidAt?: Date | null;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO affiliate_commissions (
        id, tenant_id, affiliate_id, affiliate_code, affiliate_name, affiliate_email,
        order_id, checkout_id, product_id, product_name, product_type,
        customer_email, customer_name, order_amount, commission_percent,
        amount, gross_amount, admin_fee, net_amount, admin_fee_percent,
        status, payment_method, balance_credited, release_date, paid_at,
        created_at, updated_at
      ) VALUES (
        ${c.id}, ${c.tenantId ?? null}, ${c.affiliateId},
        ${c.affiliateCode ?? null}, ${c.affiliateName ?? null}, ${c.affiliateEmail ?? null},
        ${c.orderId ?? null}, ${c.checkoutId ?? null}, ${c.productId ?? null},
        ${c.productName ?? null}, ${c.productType ?? null},
        ${c.customerEmail ?? null}, ${c.customerName ?? null},
        ${c.orderAmount ?? 0}, ${c.commissionPercent ?? 0},
        ${c.amount ?? 0}, ${c.grossAmount ?? 0}, ${c.adminFee ?? 0},
        ${c.netAmount ?? 0}, ${c.adminFeePercent ?? 0},
        ${c.status ?? 'pending'}, ${c.paymentMethod ?? null},
        ${c.balanceCredited ?? false},
        ${c.releaseDate ?? null}, ${c.paidAt ?? null},
        NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        status          = EXCLUDED.status,
        balance_credited= EXCLUDED.balance_credited,
        updated_at      = NOW()
    `;
  }, `neonWriteCommission:${c.id}`);
}
