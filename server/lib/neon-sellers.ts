/**
 * 🐘 NEON — Dual-write para sellers e users
 * Fire-and-forget: nunca bloqueia o fluxo Firebase principal
 */

import { neonQuery } from './neon-db.js';

// ─────────────────────────────────────────────
// SELLERS
// ─────────────────────────────────────────────

export async function neonWriteSeller(data: {
  id: string;
  tenantId?: string;
  email?: string;
  name?: string;
  businessName?: string;
  status?: string;
  phone?: string;
  document?: string;
  personalDocumentNumber?: string;
  supportEmail?: string;
  plan?: string;
  profileComplete?: boolean;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  acquirers?: Record<string, any>;
  bankingData?: Record<string, any>;
  createdAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO sellers (
        id, tenant_id, email, name, business_name,
        status, phone, document, personal_document_number, support_email,
        plan, profile_complete, approved_at, approved_by,
        acquirers, banking_data, created_at, updated_at
      ) VALUES (
        ${data.id},
        ${data.tenantId ?? null},
        ${data.email ?? null},
        ${data.name ?? null},
        ${data.businessName ?? null},
        ${data.status ?? 'pending'},
        ${data.phone ?? null},
        ${data.document ?? null},
        ${data.personalDocumentNumber ?? null},
        ${data.supportEmail ?? null},
        ${data.plan ?? null},
        ${data.profileComplete ?? false},
        ${data.approvedAt ?? null},
        ${data.approvedBy ?? null},
        ${data.acquirers ? JSON.stringify(data.acquirers) : null},
        ${data.bankingData ? JSON.stringify(data.bankingData) : null},
        ${data.createdAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id               = COALESCE(EXCLUDED.tenant_id, sellers.tenant_id),
        email                   = COALESCE(EXCLUDED.email, sellers.email),
        name                    = COALESCE(EXCLUDED.name, sellers.name),
        business_name           = COALESCE(EXCLUDED.business_name, sellers.business_name),
        status                  = EXCLUDED.status,
        phone                   = COALESCE(EXCLUDED.phone, sellers.phone),
        document                = COALESCE(EXCLUDED.document, sellers.document),
        personal_document_number = COALESCE(EXCLUDED.personal_document_number, sellers.personal_document_number),
        support_email           = COALESCE(EXCLUDED.support_email, sellers.support_email),
        plan                    = COALESCE(EXCLUDED.plan, sellers.plan),
        profile_complete        = EXCLUDED.profile_complete,
        approved_at             = COALESCE(EXCLUDED.approved_at, sellers.approved_at),
        approved_by             = COALESCE(EXCLUDED.approved_by, sellers.approved_by),
        acquirers               = COALESCE(EXCLUDED.acquirers, sellers.acquirers),
        banking_data            = COALESCE(EXCLUDED.banking_data, sellers.banking_data),
        updated_at              = NOW()
    `;
  }, `neonWriteSeller(${data.id})`);
}

export async function neonUpdateSellerStatus(
  id: string,
  status: string,
  extra?: {
    blockedAt?: Date;
    blockedBy?: string;
    unblockedAt?: Date;
    approvedAt?: Date;
    approvedBy?: string;
  }
): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO sellers (id, status, updated_at)
      VALUES (${id}, ${status}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        status       = ${status},
        approved_at  = COALESCE(${extra?.approvedAt ?? null}, sellers.approved_at),
        approved_by  = COALESCE(${extra?.approvedBy ?? null}, sellers.approved_by),
        blocked_at   = COALESCE(${extra?.blockedAt ?? null}, sellers.blocked_at),
        blocked_by   = COALESCE(${extra?.blockedBy ?? null}, sellers.blocked_by),
        updated_at   = NOW()
    `;
  }, `neonUpdateSellerStatus(${id}, ${status})`);
}

export async function neonUpdateSeller(
  id: string,
  updates: {
    name?: string;
    businessName?: string;
    phone?: string | null;
    supportEmail?: string;
    bankingData?: Record<string, any>;
    plan?: string;
    profileComplete?: boolean;
  }
): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO sellers (id, updated_at)
      VALUES (${id}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name              = COALESCE(${updates.name ?? null},          sellers.name),
        business_name     = COALESCE(${updates.businessName ?? null},  sellers.business_name),
        phone             = CASE WHEN ${updates.phone !== undefined} THEN ${updates.phone ?? null} ELSE sellers.phone END,
        support_email     = COALESCE(${updates.supportEmail ?? null},  sellers.support_email),
        banking_data      = COALESCE(${updates.bankingData ? JSON.stringify(updates.bankingData) : null}, sellers.banking_data),
        plan              = COALESCE(${updates.plan ?? null},          sellers.plan),
        profile_complete  = COALESCE(${updates.profileComplete ?? null}, sellers.profile_complete),
        updated_at        = NOW()
    `;
  }, `neonUpdateSeller(${id})`);
}

// ─────────────────────────────────────────────
// USERS (config / settings)
// ─────────────────────────────────────────────

export async function neonWriteUser(data: {
  id: string;
  email?: string;
  webhookUrl?: string;
  settings?: Record<string, any>;
  createdAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO users (id, email, webhook_url, settings, created_at, updated_at)
      VALUES (
        ${data.id},
        ${data.email ?? null},
        ${data.webhookUrl ?? null},
        ${data.settings ? JSON.stringify(data.settings) : null},
        ${data.createdAt ?? new Date()},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        email       = COALESCE(EXCLUDED.email, users.email),
        webhook_url = COALESCE(EXCLUDED.webhook_url, users.webhook_url),
        settings    = COALESCE(EXCLUDED.settings, users.settings),
        updated_at  = NOW()
    `;
  }, `neonWriteUser(${data.id})`);
}

export async function neonUpdateUser(
  id: string,
  updates: { webhookUrl?: string; settings?: Record<string, any>; email?: string }
): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO users (id, updated_at)
      VALUES (${id}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        email       = COALESCE(${updates.email ?? null},       users.email),
        webhook_url = COALESCE(${updates.webhookUrl ?? null},  users.webhook_url),
        settings    = COALESCE(${updates.settings ? JSON.stringify(updates.settings) : null}, users.settings),
        updated_at  = NOW()
    `;
  }, `neonUpdateUser(${id})`);
}
