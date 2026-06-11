/**
 * 🐘 NEON — Dual-write para products, checkouts, coupons
 * Fire-and-forget: nunca bloqueia o fluxo Firebase principal
 */

import { neonQuery } from './neon-db.js';

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

export async function neonWriteProduct(data: {
  productId: string;
  tenantId?: string;
  title?: string;
  description?: string;
  productType?: string;
  imageUrl?: string;
  active?: boolean;
  accessDuration?: number | null;
  notifyExpirationDays?: number[];
  hasAccess?: boolean;
  checkoutId?: string;
  deleted?: boolean;
  metadata?: Record<string, any>;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO products (
        id, tenant_id, title, description, product_type, image_url,
        active, access_duration, notify_expiration_days, has_access,
        checkout_id, deleted, metadata, created_at, updated_at
      ) VALUES (
        ${data.productId},
        ${data.tenantId ?? null},
        ${data.title ?? null},
        ${data.description ?? null},
        ${data.productType ?? 'digital'},
        ${data.imageUrl ?? null},
        ${data.active ?? true},
        ${data.accessDuration ?? null},
        ${data.notifyExpirationDays ? JSON.stringify(data.notifyExpirationDays) : null},
        ${data.hasAccess ?? false},
        ${data.checkoutId ?? null},
        ${data.deleted ?? false},
        ${data.metadata ? JSON.stringify(data.metadata) : null},
        NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id              = EXCLUDED.tenant_id,
        title                  = EXCLUDED.title,
        description            = EXCLUDED.description,
        product_type           = EXCLUDED.product_type,
        image_url              = EXCLUDED.image_url,
        active                 = EXCLUDED.active,
        access_duration        = EXCLUDED.access_duration,
        notify_expiration_days = EXCLUDED.notify_expiration_days,
        has_access             = EXCLUDED.has_access,
        checkout_id            = EXCLUDED.checkout_id,
        deleted                = EXCLUDED.deleted,
        metadata               = EXCLUDED.metadata,
        updated_at             = NOW()
    `;
  }, `neonWriteProduct(${data.productId})`);
}

export async function neonUpdateProduct(id: string, updates: Record<string, any>): Promise<void> {
  if (!id || Object.keys(updates).length === 0) return;
  await neonQuery(async (sql) => {
    await sql`
      UPDATE products SET
        title       = COALESCE(${updates.title ?? null}, title),
        description = COALESCE(${updates.description ?? null}, description),
        image_url   = COALESCE(${updates.imageUrl ?? null}, image_url),
        active      = COALESCE(${updates.active ?? null}, active),
        deleted     = COALESCE(${updates.deleted ?? null}, deleted),
        metadata    = COALESCE(${updates.metadata ? JSON.stringify(updates.metadata) : null}::jsonb, metadata),
        updated_at  = NOW()
      WHERE id = ${id}
    `;
  }, `neonUpdateProduct(${id})`);
}

export async function neonSoftDeleteProduct(id: string): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`UPDATE products SET deleted = TRUE, updated_at = NOW() WHERE id = ${id}`;
  }, `neonSoftDeleteProduct(${id})`);
}

// ─────────────────────────────────────────────
// CHECKOUTS
// ─────────────────────────────────────────────

export async function neonWriteCheckout(data: {
  checkoutId: string;
  tenantId?: string;
  slug?: string;
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  productType?: string;
  currency?: string;
  active?: boolean;
  testMode?: boolean;
  productId?: string;
  syncedProductId?: string;
  pricing?: Record<string, any>;
  methods?: Record<string, any>;
  theme?: Record<string, any>;
  affiliate?: Record<string, any>;
  globalSettings?: Record<string, any>;
  fields?: Record<string, any>;
  deleted?: boolean;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO checkouts (
        id, tenant_id, slug, title, subtitle, logo_url,
        product_type, currency, active, test_mode,
        product_id, synced_product_id,
        pricing, methods, theme, affiliate, global_settings, fields,
        deleted, created_at, updated_at
      ) VALUES (
        ${data.checkoutId},
        ${data.tenantId ?? null},
        ${data.slug ?? data.checkoutId},
        ${data.title ?? null},
        ${data.subtitle ?? null},
        ${data.logoUrl ?? null},
        ${data.productType ?? 'digital'},
        ${data.currency ?? 'BRL'},
        ${data.active ?? true},
        ${data.testMode ?? false},
        ${data.productId ?? null},
        ${data.syncedProductId ?? null},
        ${data.pricing ? JSON.stringify(data.pricing) : null},
        ${data.methods ? JSON.stringify(data.methods) : null},
        ${data.theme ? JSON.stringify(data.theme) : null},
        ${data.affiliate ? JSON.stringify(data.affiliate) : null},
        ${data.globalSettings ? JSON.stringify(data.globalSettings) : null},
        ${data.fields ? JSON.stringify(data.fields) : null},
        ${data.deleted ?? false},
        NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id       = EXCLUDED.tenant_id,
        slug            = EXCLUDED.slug,
        title           = EXCLUDED.title,
        subtitle        = EXCLUDED.subtitle,
        logo_url        = EXCLUDED.logo_url,
        product_type    = EXCLUDED.product_type,
        currency        = EXCLUDED.currency,
        active          = EXCLUDED.active,
        test_mode       = EXCLUDED.test_mode,
        product_id      = EXCLUDED.product_id,
        synced_product_id = EXCLUDED.synced_product_id,
        pricing         = EXCLUDED.pricing,
        methods         = EXCLUDED.methods,
        theme           = EXCLUDED.theme,
        affiliate       = EXCLUDED.affiliate,
        global_settings = EXCLUDED.global_settings,
        fields          = EXCLUDED.fields,
        deleted         = EXCLUDED.deleted,
        updated_at      = NOW()
    `;
  }, `neonWriteCheckout(${data.checkoutId})`);
}

export async function neonUpdateCheckout(id: string, updates: Record<string, any>): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO checkouts (id, updated_at)
      VALUES (${id}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        title           = COALESCE(${updates.title ?? null}, checkouts.title),
        subtitle        = COALESCE(${updates.subtitle ?? null}, checkouts.subtitle),
        logo_url        = COALESCE(${updates.logoUrl ?? null}, checkouts.logo_url),
        active          = COALESCE(${updates.active ?? null}, checkouts.active),
        product_id      = COALESCE(${updates.productId ?? null}, checkouts.product_id),
        synced_product_id = COALESCE(${updates.syncedProductId ?? null}, checkouts.synced_product_id),
        pricing         = COALESCE(${updates.pricing ? JSON.stringify(updates.pricing) : null}::jsonb, checkouts.pricing),
        methods         = COALESCE(${updates.methods ? JSON.stringify(updates.methods) : null}::jsonb, checkouts.methods),
        theme           = COALESCE(${updates.theme ? JSON.stringify(updates.theme) : null}::jsonb, checkouts.theme),
        global_settings = COALESCE(${updates.globalSettings ? JSON.stringify(updates.globalSettings) : null}::jsonb, checkouts.global_settings),
        deleted         = COALESCE(${updates.deleted ?? null}, checkouts.deleted),
        updated_at      = NOW()
    `;
  }, `neonUpdateCheckout(${id})`);
}

export async function neonSoftDeleteCheckout(id: string): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`UPDATE checkouts SET deleted = TRUE, updated_at = NOW() WHERE id = ${id}`;
  }, `neonSoftDeleteCheckout(${id})`);
}

// ─────────────────────────────────────────────
// COUPONS
// ─────────────────────────────────────────────

export async function neonWriteCoupon(data: {
  couponId: string;
  tenantId?: string;
  productId?: string;
  checkoutId?: string;
  code?: string;
  discountType?: string;
  discountValue?: number;
  maxUses?: number | null;
  usedCount?: number;
  validFrom?: Date | null;
  validUntil?: Date | null;
  active?: boolean;
  metadata?: Record<string, any>;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO coupons (
        id, tenant_id, product_id, checkout_id, code,
        discount_type, discount_value, max_uses, used_count,
        valid_from, valid_until, active, metadata,
        created_at, updated_at
      ) VALUES (
        ${data.couponId},
        ${data.tenantId ?? null},
        ${data.productId ?? null},
        ${data.checkoutId ?? null},
        ${data.code ?? null},
        ${data.discountType ?? 'percent'},
        ${data.discountValue ?? 0},
        ${data.maxUses ?? null},
        ${data.usedCount ?? 0},
        ${data.validFrom ?? null},
        ${data.validUntil ?? null},
        ${data.active ?? true},
        ${data.metadata ? JSON.stringify(data.metadata) : null},
        NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id      = EXCLUDED.tenant_id,
        product_id     = EXCLUDED.product_id,
        checkout_id    = EXCLUDED.checkout_id,
        code           = EXCLUDED.code,
        discount_type  = EXCLUDED.discount_type,
        discount_value = EXCLUDED.discount_value,
        max_uses       = EXCLUDED.max_uses,
        used_count     = EXCLUDED.used_count,
        valid_from     = EXCLUDED.valid_from,
        valid_until    = EXCLUDED.valid_until,
        active         = EXCLUDED.active,
        metadata       = EXCLUDED.metadata,
        updated_at     = NOW()
    `;
  }, `neonWriteCoupon(${data.couponId})`);
}

export async function neonUpdateCoupon(id: string, updates: Record<string, any>): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO coupons (id, updated_at)
      VALUES (${id}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        code           = COALESCE(${updates.code ?? null}, coupons.code),
        discount_type  = COALESCE(${updates.discountType ?? null}, coupons.discount_type),
        discount_value = COALESCE(${updates.discountValue ?? null}, coupons.discount_value),
        max_uses       = COALESCE(${updates.maxUses ?? null}, coupons.max_uses),
        used_count     = COALESCE(${updates.usedCount ?? null}, coupons.used_count),
        active         = COALESCE(${updates.active ?? null}, coupons.active),
        valid_until    = COALESCE(${updates.validUntil ?? null}, coupons.valid_until),
        updated_at     = NOW()
    `;
  }, `neonUpdateCoupon(${id})`);
}

export async function neonDeleteCoupon(id: string): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`DELETE FROM coupons WHERE id = ${id}`;
  }, `neonDeleteCoupon(${id})`);
}

export async function neonIncrementCouponUsage(id: string): Promise<void> {
  if (!id) return;
  await neonQuery(async (sql) => {
    await sql`UPDATE coupons SET used_count = used_count + 1, updated_at = NOW() WHERE id = ${id}`;
  }, `neonIncrementCouponUsage(${id})`);
}
