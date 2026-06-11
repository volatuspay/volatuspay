/**
 * 🐘 NEON — Dual-write para webhook_logs, fraud_alerts, subscriptions
 * Fire-and-forget: nunca bloqueia o fluxo Firebase principal
 */

import { neonQuery } from './neon-db.js';

// ─────────────────────────────────────────────
// WEBHOOK LOGS
// ─────────────────────────────────────────────

export async function neonWriteWebhookLog(data: {
  id: string;
  tenantId?: string | null;
  event?: string | null;
  webhookUrl?: string | null;
  payload?: Record<string, any> | null;
  response?: Record<string, any> | null;
  responseStatus?: number | null;
  success: boolean;
  attempts?: number;
  error?: string | null;
  sentAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO webhook_logs (
        id, tenant_id, event, webhook_url, payload, response,
        response_status, success, attempts, error, sent_at, created_at
      ) VALUES (
        ${data.id},
        ${data.tenantId ?? null},
        ${data.event ?? null},
        ${data.webhookUrl ?? null},
        ${data.payload ? JSON.stringify(data.payload) : null},
        ${data.response ? JSON.stringify(data.response) : null},
        ${data.responseStatus ?? null},
        ${data.success},
        ${data.attempts ?? 0},
        ${data.error ?? null},
        ${data.sentAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }, `neonWriteWebhookLog(${data.id})`);
}

// ─────────────────────────────────────────────
// FRAUD ALERTS
// ─────────────────────────────────────────────

export async function neonWriteFraudAlert(data: {
  id: string;
  withdrawalId?: string | null;
  sellerId?: string | null;
  riskScore?: number | null;
  riskLevel?: string | null;
  riskFactors?: any[] | null;
  aiAnalysis?: Record<string, any> | null;
  context?: Record<string, any> | null;
  reviewStatus?: string;
  notificationSent?: boolean;
  detectionVersion?: string;
  createdAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO fraud_alerts (
        id, withdrawal_id, seller_id, risk_score, risk_level,
        risk_factors, ai_analysis, context,
        review_status, notification_sent, detection_version,
        created_at, updated_at
      ) VALUES (
        ${data.id},
        ${data.withdrawalId ?? null},
        ${data.sellerId ?? null},
        ${data.riskScore ?? null},
        ${data.riskLevel ?? null},
        ${data.riskFactors ? JSON.stringify(data.riskFactors) : null},
        ${data.aiAnalysis ? JSON.stringify(data.aiAnalysis) : null},
        ${data.context ? JSON.stringify(data.context) : null},
        ${data.reviewStatus ?? 'unreviewed'},
        ${data.notificationSent ?? false},
        ${data.detectionVersion ?? '1.0.0'},
        ${data.createdAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }, `neonWriteFraudAlert(${data.id})`);
}

export async function neonUpdateFraudAlert(
  id: string,
  updates: {
    reviewStatus?: string;
    reviewedBy?: string | null;
    reviewedByEmail?: string | null;
    reviewedAt?: Date | null;
    reviewNotes?: string | null;
  }
): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO fraud_alerts (id, updated_at) VALUES (${id}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        review_status     = COALESCE(${updates.reviewStatus ?? null},      fraud_alerts.review_status),
        reviewed_by       = COALESCE(${updates.reviewedBy ?? null},        fraud_alerts.reviewed_by),
        reviewed_by_email = COALESCE(${updates.reviewedByEmail ?? null},   fraud_alerts.reviewed_by_email),
        reviewed_at       = COALESCE(${updates.reviewedAt ?? null},        fraud_alerts.reviewed_at),
        review_notes      = COALESCE(${updates.reviewNotes ?? null},       fraud_alerts.review_notes),
        updated_at        = NOW()
    `;
  }, `neonUpdateFraudAlert(${id})`);
}

// ─────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────

export async function neonWriteSubscription(data: {
  id: string;
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerDocument?: string | null;
  tenantId?: string | null;
  productId?: string | null;
  productName?: string | null;
  orderId?: string | null;
  status?: string;
  billingCycle?: string | null;
  period?: string | null;
  amount?: number | null;
  currency?: string;
  recurringCount?: number;
  method?: string | null;
  autoRenew?: boolean;
  dunningAttempts?: number;
  nextBillingDate?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  createdAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO subscriptions (
        id, customer_id, customer_name, customer_email, customer_phone, customer_document,
        tenant_id, product_id, product_name, order_id,
        status, billing_cycle, period, amount, currency,
        recurring_count, method, auto_renew, dunning_attempts,
        next_billing_date, current_period_start, current_period_end,
        created_at, updated_at
      ) VALUES (
        ${data.id},
        ${data.customerId ?? null},
        ${data.customerName ?? null},
        ${data.customerEmail ?? null},
        ${data.customerPhone ?? null},
        ${data.customerDocument ?? null},
        ${data.tenantId ?? null},
        ${data.productId ?? null},
        ${data.productName ?? null},
        ${data.orderId ?? null},
        ${data.status ?? 'active'},
        ${data.billingCycle ?? null},
        ${data.period ?? null},
        ${data.amount ?? null},
        ${data.currency ?? 'BRL'},
        ${data.recurringCount ?? 1},
        ${data.method ?? null},
        ${data.autoRenew ?? false},
        ${data.dunningAttempts ?? 0},
        ${data.nextBillingDate ?? null},
        ${data.currentPeriodStart ?? null},
        ${data.currentPeriodEnd ?? null},
        ${data.createdAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        status         = EXCLUDED.status,
        recurring_count = EXCLUDED.recurring_count,
        updated_at     = NOW()
    `;
  }, `neonWriteSubscription(${data.id})`);
}

export async function neonUpdateSubscription(
  id: string,
  updates: {
    status?: string | null;
    recurringCount?: number | null;
    nextBillingDate?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelledAt?: Date | null;
    activatedAt?: Date | null;
    lastRenewalDate?: Date | null;
    autoRenew?: boolean | null;
    dunningAttempts?: number | null;
  }
): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO subscriptions (id, updated_at) VALUES (${id}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        status             = COALESCE(${updates.status ?? null},            subscriptions.status),
        recurring_count    = COALESCE(${updates.recurringCount ?? null},    subscriptions.recurring_count),
        next_billing_date  = COALESCE(${updates.nextBillingDate ?? null},   subscriptions.next_billing_date),
        current_period_end = COALESCE(${updates.currentPeriodEnd ?? null},  subscriptions.current_period_end),
        cancelled_at       = COALESCE(${updates.cancelledAt ?? null},       subscriptions.cancelled_at),
        activated_at       = COALESCE(${updates.activatedAt ?? null},       subscriptions.activated_at),
        last_renewal_date  = COALESCE(${updates.lastRenewalDate ?? null},   subscriptions.last_renewal_date),
        auto_renew         = COALESCE(${updates.autoRenew ?? null},         subscriptions.auto_renew),
        dunning_attempts   = COALESCE(${updates.dunningAttempts ?? null},   subscriptions.dunning_attempts),
        updated_at         = NOW()
    `;
  }, `neonUpdateSubscription(${id})`);
}
