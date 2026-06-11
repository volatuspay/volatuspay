/**
 * 🐘 NeonStorage — IStorage completo usando PostgreSQL/Neon
 * Substitui FirebaseStorage (exceto Firebase Auth que permanece)
 */

import { getNeonSql, neonQuery } from './neon-db.js';
import { nanoid } from 'nanoid';
import type {
  Seller, InsertSeller,
  Checkout, InsertCheckout,
  Order, InsertOrder,
  Product, InsertProduct,
  ProductOffer, InsertProductOffer,
  Module, InsertModule,
  Lesson, InsertLesson,
  Member, InsertMember,
  Enrollment, InsertEnrollment,
  Progress, InsertProgress,
  Banner, InsertBanner,
  Subscription, InsertSubscription,
  CustomerProfile, InsertCustomerProfile, UpdateCustomerProfile,
  MemberEntitlement, InsertMemberEntitlement, UpdateMemberEntitlement,
  RefundRequest, InsertRefundRequest, UpdateRefundRequest,
} from '../../shared/schema.js';
import type { IStorage } from '../storage.js';

// ─── Row → object helpers ────────────────────────────────────────────────────

function ts(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  return new Date(v);
}
function tsOrNull(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  return new Date(v);
}
function tsOrUndef(v: any): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  return new Date(v);
}

function rowToSeller(r: any): Seller {
  const meta: any = r.metadata || {};
  return {
    id: r.id,
    tenantId: r.tenant_id,
    email: r.email,
    name: r.name,
    businessName: r.business_name,
    status: r.status,
    phone: r.phone,
    document: r.document,
    personalDocumentNumber: r.personal_document_number,
    supportEmail: r.support_email,
    plan: r.plan,
    profileComplete: r.profile_complete,
    approvedAt: tsOrUndef(r.approved_at),
    approvedBy: r.approved_by,
    blockedAt: tsOrUndef(r.blocked_at),
    blockedBy: r.blocked_by,
    acquirers: r.acquirers || {},
    bankingData: r.banking_data || {},
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...meta,
  } as Seller;
}

function rowToCheckout(r: any): Checkout {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    logoUrl: r.logo_url,
    productType: r.product_type,
    currency: r.currency,
    active: r.active,
    testMode: r.test_mode,
    productId: r.product_id,
    syncedProductId: r.synced_product_id,
    salesCount: r.sales_count,
    pricing: r.pricing || {},
    methods: r.methods || {},
    theme: r.theme || {},
    affiliate: r.affiliate || {},
    globalSettings: r.global_settings || {},
    fields: r.fields || {},
    deleted: r.deleted,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Checkout;
}

function rowToOrder(r: any): Order {
  return {
    id: r.id,
    checkoutId: r.checkout_id,
    productId: r.product_id,
    tenantId: r.tenant_id,
    sellerId: r.seller_id,
    status: r.status,
    method: r.method,
    paymentMethod: r.payment_method,
    paymentProcessor: r.payment_processor,
    amount: r.amount,
    currency: r.currency,
    installments: r.installments,
    productType: r.product_type,
    marketTarget: r.market_target,
    subscriptionPeriod: r.subscription_period,
    efiChargeId: r.efi_charge_id,
    efiTxid: r.efi_txid,
    efiStatus: r.efi_status,
    cardMask: r.card_mask,
    offerSlug: r.offer_slug,
    offerTitle: r.offer_title,
    couponCode: r.coupon_code,
    affiliateUid: r.affiliate_uid,
    gatewayFee: r.gateway_fee,
    gatewayFeePercent: r.gateway_fee_percent,
    platformFee: r.platform_fee,
    platformFeePercent: r.platform_fee_percent,
    netAmount: r.net_amount,
    customer: r.customer || {},
    customerAddress: r.customer_address || {},
    checkoutSnapshot: r.checkout_snapshot || {},
    financialData: r.financial_data || {},
    financial: r.financial || {},
    trackingParameters: r.tracking_parameters || {},
    selectedOrderBumps: r.selected_order_bumps || [],
    orderBumps: r.order_bumps || [],
    metadata: r.metadata || {},
    paidAt: tsOrUndef(r.paid_at),
    refundedAt: tsOrUndef(r.refunded_at),
    expiresAt: tsOrUndef(r.expires_at),
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Order;
}

function rowToProduct(r: any): Product {
  const meta: any = r.metadata || {};
  return {
    id: r.id,
    tenantId: r.tenant_id,
    title: r.title,
    description: r.description,
    productType: r.product_type,
    imageUrl: r.image_url,
    active: r.active,
    accessDuration: r.access_duration,
    notifyExpirationDays: r.notify_expiration_days,
    hasAccess: r.has_access,
    checkoutId: r.checkout_id,
    deleted: r.deleted,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...meta,
  } as Product;
}

function rowToOffer(r: any): ProductOffer {
  return {
    id: r.id,
    productId: r.product_id,
    tenantId: r.tenant_id,
    name: r.name,
    slug: r.slug,
    price: r.price,
    originalPrice: r.original_price,
    active: r.active,
    deleted: r.deleted,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as ProductOffer;
}

function rowToModule(r: any): Module {
  return {
    id: r.id,
    productId: r.product_id,
    tenantId: r.tenant_id,
    title: r.title,
    description: r.description,
    position: r.position,
    active: r.active,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Module;
}

function rowToLesson(r: any): Lesson {
  return {
    id: r.id,
    moduleId: r.module_id,
    productId: r.product_id,
    tenantId: r.tenant_id,
    title: r.title,
    description: r.description,
    contentUrl: r.content_url,
    contentType: r.content_type,
    position: r.position,
    durationSeconds: r.duration_seconds,
    active: r.active,
    freePreview: r.free_preview,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Lesson;
}

function rowToMember(r: any): Member {
  return {
    id: r.id,
    userId: r.user_id,
    email: r.email,
    name: r.name,
    phone: r.phone,
    document: r.document,
    avatarUrl: r.avatar_url,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Member;
}

function rowToEnrollment(r: any): Enrollment {
  return {
    id: r.id,
    memberId: r.member_id,
    productId: r.product_id,
    tenantId: r.tenant_id,
    orderId: r.order_id,
    checkoutId: r.checkout_id,
    status: r.status,
    enrolledAt: tsOrUndef(r.enrolled_at),
    expiresAt: tsOrNull(r.expires_at),
    accessDuration: r.access_duration,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Enrollment;
}

function rowToProgress(r: any): Progress {
  return {
    id: r.id,
    memberId: r.member_id,
    lessonId: r.lesson_id,
    productId: r.product_id,
    moduleId: r.module_id,
    tenantId: r.tenant_id,
    status: r.status,
    progressPercent: r.progress_percent,
    completedAt: tsOrUndef(r.completed_at),
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Progress;
}

function rowToSubscription(r: any): Subscription {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    checkoutId: r.checkout_id,
    productId: r.product_id,
    productName: r.product_name,
    orderId: r.order_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    customerPhone: r.customer_phone,
    customerDocument: r.customer_document,
    customerAddress: r.customer_address,
    status: r.status,
    billingCycle: r.billing_cycle,
    period: r.period,
    amount: r.amount,
    currency: r.currency,
    recurringCount: r.recurring_count,
    method: r.method,
    paymentMethod: r.payment_method,
    autoRenew: r.auto_renew,
    dunningAttempts: r.dunning_attempts,
    startDate: ts(r.start_date || r.current_period_start || r.activated_at || r.created_at),
    nextBillingDate: ts(r.next_billing_date),
    expiresAt: ts(r.expires_at || r.current_period_end || r.next_billing_date),
    lastPaymentDate: tsOrNull(r.last_payment_date || r.last_renewal_date),
    cancelledAt: tsOrNull(r.cancelled_at),
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as Subscription;
}

function rowToBanner(r: any): Banner {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    title: r.title,
    imageUrl: r.image_url,
    link: r.link,
    isActive: r.is_active,
    position: r.position,
    priority: r.priority,
    description: r.description,
    targetBlank: r.target_blank,
    startDate: tsOrUndef(r.start_date),
    endDate: tsOrUndef(r.end_date),
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
  } as Banner;
}

function rowToCustomerProfile(r: any): CustomerProfile {
  return {
    id: r.id,
    firebaseUid: r.firebase_uid,
    email: r.email,
    name: r.name,
    phone: r.phone,
    document: r.document,
    address: r.address,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as CustomerProfile;
}

function rowToMemberEntitlement(r: any): MemberEntitlement {
  return {
    id: r.id,
    customerId: r.customer_id,
    orderId: r.order_id,
    productId: r.product_id,
    tenantId: r.tenant_id,
    status: r.status,
    accessType: r.access_type,
    accessStartDate: ts(r.access_start_date || r.created_at),
    accessEndDate: tsOrNull(r.access_end_date),
    expiresAt: tsOrUndef(r.expires_at),
    revokedAt: tsOrUndef(r.revoked_at),
    revokeReason: r.revoke_reason,
    accessCount: r.access_count || 0,
    denialCount: r.denial_count || 0,
    lastAccessAt: tsOrUndef(r.last_accessed_at),
    cancelledAt: tsOrUndef(r.revoked_at),
    cancelReason: r.revoke_reason,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...(r.metadata || {}),
  } as MemberEntitlement;
}

function rowToRefundRequest(r: any): RefundRequest {
  const meta: any = r.metadata || {};
  return {
    id: r.id,
    sellerId: r.seller_id,
    customerId: r.customer_id,
    orderId: r.order_id,
    tenantId: r.tenant_id,
    amount: r.amount,
    currency: r.currency,
    reason: r.reason,
    status: r.status,
    processedBy: r.processed_by,
    processedByName: r.processed_by_name,
    processedAt: tsOrUndef(r.processed_at),
    denialReason: r.denial_reason,
    refundedAmount: r.refunded_amount,
    refundMethod: r.refund_method,
    refundTransactionId: r.refund_transaction_id,
    requestedAt: ts(r.created_at),
    isPartialRefund: meta.isPartialRefund || false,
    createdAt: ts(r.created_at),
    updatedAt: ts(r.updated_at),
    ...meta,
  } as RefundRequest;
}

// ─── NeonStorage class ───────────────────────────────────────────────────────

export class NeonStorage implements IStorage {

  private get sql() {
    return getNeonSql();
  }

  // ── Readiness ──────────────────────────────────────────────────────────────
  get isReady(): boolean { return true; }
  async ensureReady(): Promise<void> { return; }
  getDb(): any { return null; }
  clearSellerCache(): Promise<void> { return Promise.resolve(); }

  // ── Sellers ────────────────────────────────────────────────────────────────

  async getSeller(id: string): Promise<Seller | undefined> {
    const rows = await this.sql`SELECT * FROM sellers WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToSeller(rows[0]);
  }

  async createSeller(seller: InsertSeller): Promise<Seller> {
    const sql = this.sql;
    const now = new Date();
    const {
      id, tenantId, email, name, businessName, status, phone, document,
      personalDocumentNumber, supportEmail, plan, profileComplete,
      approvedAt, approvedBy, blockedAt, blockedBy, acquirers, bankingData,
      createdAt, updatedAt, ...extra
    } = seller as any;

    await sql`
      INSERT INTO sellers (
        id, tenant_id, email, name, business_name, status, phone, document,
        personal_document_number, support_email, plan, profile_complete,
        approved_at, approved_by, blocked_at, blocked_by, acquirers, banking_data,
        metadata, created_at, updated_at
      ) VALUES (
        ${id}, ${tenantId ?? null}, ${email ?? null}, ${name ?? null}, ${businessName ?? null},
        ${status ?? 'pending'}, ${phone ?? null}, ${document ?? null},
        ${personalDocumentNumber ?? null}, ${supportEmail ?? null}, ${plan ?? null},
        ${profileComplete ?? false},
        ${approvedAt ?? null}, ${approvedBy ?? null}, ${blockedAt ?? null}, ${blockedBy ?? null},
        ${JSON.stringify(acquirers ?? {})}, ${JSON.stringify(bankingData ?? {})},
        ${JSON.stringify(extra)},
        ${createdAt ?? now}, ${updatedAt ?? now}
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id, email = EXCLUDED.email, name = EXCLUDED.name,
        business_name = EXCLUDED.business_name, status = EXCLUDED.status,
        phone = EXCLUDED.phone, document = EXCLUDED.document,
        personal_document_number = EXCLUDED.personal_document_number,
        support_email = EXCLUDED.support_email, plan = EXCLUDED.plan,
        profile_complete = EXCLUDED.profile_complete,
        acquirers = EXCLUDED.acquirers, banking_data = EXCLUDED.banking_data,
        metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    return (await this.getSeller(id))!;
  }

  async getAllSellers(options?: { force?: boolean }): Promise<Seller[]> {
    const rows = await this.sql`SELECT * FROM sellers ORDER BY created_at DESC`;
    return rows.map(rowToSeller);
  }

  async updateSeller(id: string, updates: Partial<Seller>): Promise<Seller> {
    const sql = this.sql;
    const now = new Date();
    const {
      tenantId, email, name, businessName, status, phone, document,
      personalDocumentNumber, supportEmail, plan, profileComplete,
      approvedAt, approvedBy, blockedAt, blockedBy, acquirers, bankingData,
      updatedAt, createdAt, id: _id, ...extra
    } = updates as any;

    await sql`
      UPDATE sellers SET
        tenant_id = COALESCE(${tenantId ?? null}, tenant_id),
        email = COALESCE(${email ?? null}, email),
        name = COALESCE(${name ?? null}, name),
        business_name = COALESCE(${businessName ?? null}, business_name),
        status = COALESCE(${status ?? null}, status),
        phone = COALESCE(${phone ?? null}, phone),
        document = COALESCE(${document ?? null}, document),
        personal_document_number = COALESCE(${personalDocumentNumber ?? null}, personal_document_number),
        support_email = COALESCE(${supportEmail ?? null}, support_email),
        plan = COALESCE(${plan ?? null}, plan),
        profile_complete = COALESCE(${profileComplete ?? null}, profile_complete),
        approved_at = COALESCE(${approvedAt ?? null}, approved_at),
        approved_by = COALESCE(${approvedBy ?? null}, approved_by),
        blocked_at = COALESCE(${blockedAt ?? null}, blocked_at),
        blocked_by = COALESCE(${blockedBy ?? null}, blocked_by),
        acquirers = CASE WHEN ${acquirers !== undefined} THEN ${JSON.stringify(acquirers ?? {})}::jsonb ELSE acquirers END,
        banking_data = CASE WHEN ${bankingData !== undefined} THEN ${JSON.stringify(bankingData ?? {})}::jsonb ELSE banking_data END,
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(extra)}::jsonb,
        updated_at = ${now}
      WHERE id = ${id}
    `;
    const result = await this.getSeller(id);
    if (!result) throw new Error(`Seller ${id} não encontrado após update`);
    return result;
  }

  // ── Checkouts ──────────────────────────────────────────────────────────────

  async getCheckout(id: string): Promise<Checkout | undefined> {
    const rows = await this.sql`SELECT * FROM checkouts WHERE id = ${id} AND (deleted = FALSE OR deleted IS NULL) LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToCheckout(rows[0]);
  }

  async createCheckout(checkout: InsertCheckout): Promise<Checkout> {
    const sql = this.sql;
    const now = new Date();
    const c = checkout as any;
    const id = c.id || `checkout_${nanoid(21)}`;

    await sql`
      INSERT INTO checkouts (
        id, tenant_id, slug, title, subtitle, logo_url, product_type, currency, active, test_mode,
        product_id, synced_product_id, sales_count, pricing, methods, theme, affiliate,
        global_settings, fields, deleted, metadata, created_at, updated_at
      ) VALUES (
        ${id}, ${c.tenantId ?? null}, ${c.slug ?? null}, ${c.title ?? null}, ${c.subtitle ?? null},
        ${c.logoUrl ?? null}, ${c.productType ?? 'digital'}, ${c.currency ?? 'BRL'},
        ${c.active !== false}, ${c.testMode ?? false},
        ${c.productId ?? null}, ${c.syncedProductId ?? null}, ${c.salesCount ?? 0},
        ${JSON.stringify(c.pricing ?? {})}, ${JSON.stringify(c.methods ?? {})},
        ${JSON.stringify(c.theme ?? {})}, ${JSON.stringify(c.affiliate ?? {})},
        ${JSON.stringify(c.globalSettings ?? {})}, ${JSON.stringify(c.fields ?? {})},
        ${c.deleted ?? false}, ${JSON.stringify(c.metadata ?? {})},
        ${c.createdAt ?? now}, ${c.updatedAt ?? now}
      )
      ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
        slug = EXCLUDED.slug, logo_url = EXCLUDED.logo_url, product_type = EXCLUDED.product_type,
        currency = EXCLUDED.currency, active = EXCLUDED.active, test_mode = EXCLUDED.test_mode,
        product_id = EXCLUDED.product_id, synced_product_id = EXCLUDED.synced_product_id,
        pricing = EXCLUDED.pricing, methods = EXCLUDED.methods, theme = EXCLUDED.theme,
        affiliate = EXCLUDED.affiliate, global_settings = EXCLUDED.global_settings,
        fields = EXCLUDED.fields, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    return (await this.getCheckout(id))!;
  }

  async getCheckoutsByTenant(tenantId: string): Promise<Checkout[]> {
    const sql = this.sql;
    if (tenantId === 'ALL') {
      const rows = await sql`SELECT * FROM checkouts WHERE (deleted = FALSE OR deleted IS NULL) ORDER BY created_at DESC LIMIT 500`;
      return rows.map(rowToCheckout);
    }
    const rows = await sql`SELECT * FROM checkouts WHERE tenant_id = ${tenantId} AND (deleted = FALSE OR deleted IS NULL) ORDER BY created_at DESC LIMIT 500`;
    return rows.map(rowToCheckout);
  }

  async updateCheckout(id: string, updates: Partial<Checkout>): Promise<Checkout | undefined> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    const fields: string[] = [];

    await sql`
      UPDATE checkouts SET
        title = COALESCE(${u.title ?? null}, title),
        subtitle = COALESCE(${u.subtitle ?? null}, subtitle),
        slug = COALESCE(${u.slug ?? null}, slug),
        logo_url = COALESCE(${u.logoUrl ?? null}, logo_url),
        product_type = COALESCE(${u.productType ?? null}, product_type),
        currency = COALESCE(${u.currency ?? null}, currency),
        active = COALESCE(${u.active ?? null}, active),
        test_mode = COALESCE(${u.testMode ?? null}, test_mode),
        product_id = COALESCE(${u.productId ?? null}, product_id),
        synced_product_id = COALESCE(${u.syncedProductId ?? null}, synced_product_id),
        sales_count = COALESCE(${u.salesCount ?? null}, sales_count),
        pricing = CASE WHEN ${u.pricing !== undefined} THEN ${JSON.stringify(u.pricing ?? {})}::jsonb ELSE pricing END,
        methods = CASE WHEN ${u.methods !== undefined} THEN ${JSON.stringify(u.methods ?? {})}::jsonb ELSE methods END,
        theme = CASE WHEN ${u.theme !== undefined} THEN ${JSON.stringify(u.theme ?? {})}::jsonb ELSE theme END,
        affiliate = CASE WHEN ${u.affiliate !== undefined} THEN ${JSON.stringify(u.affiliate ?? {})}::jsonb ELSE affiliate END,
        global_settings = CASE WHEN ${u.globalSettings !== undefined} THEN ${JSON.stringify(u.globalSettings ?? {})}::jsonb ELSE global_settings END,
        fields = CASE WHEN ${u.fields !== undefined} THEN ${JSON.stringify(u.fields ?? {})}::jsonb ELSE fields END,
        deleted = COALESCE(${u.deleted ?? null}, deleted),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(u.metadata ?? {})}::jsonb,
        updated_at = ${now}
      WHERE id = ${id}
    `;
    return this.getCheckout(id);
  }

  async deleteCheckout(id: string): Promise<boolean> {
    await this.sql`UPDATE checkouts SET deleted = TRUE, updated_at = NOW() WHERE id = ${id}`;
    return true;
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  async createOrder(order: InsertOrder): Promise<Order> {
    const sql = this.sql;
    const now = new Date();
    const o = order as any;
    const id = o.id || `order_${nanoid(21)}`;

    await sql`
      INSERT INTO orders (
        id, checkout_id, product_id, tenant_id, seller_id, status, method, payment_method,
        payment_processor, amount, currency, installments, product_type, market_target,
        subscription_period, efi_charge_id, efi_txid, efi_status, card_mask,
        offer_slug, offer_title, coupon_code, affiliate_uid,
        gateway_fee, gateway_fee_percent, platform_fee, platform_fee_percent, net_amount,
        customer, customer_address, checkout_snapshot, financial_data, financial,
        tracking_parameters, selected_order_bumps, order_bumps, metadata,
        paid_at, refunded_at, expires_at, created_at, updated_at
      ) VALUES (
        ${id}, ${o.checkoutId ?? null}, ${o.productId ?? null}, ${o.tenantId}, ${o.sellerId},
        ${o.status ?? 'pending'}, ${o.method ?? 'pix'}, ${o.paymentMethod ?? null},
        ${o.paymentProcessor ?? null}, ${o.amount ?? 0}, ${o.currency ?? 'BRL'},
        ${o.installments ?? 1}, ${o.productType ?? null}, ${o.marketTarget ?? null},
        ${o.subscriptionPeriod ?? null}, ${o.efiChargeId ?? null}, ${o.efiTxid ?? null},
        ${o.efiStatus ?? null}, ${o.cardMask ?? null},
        ${o.offerSlug ?? null}, ${o.offerTitle ?? null}, ${o.couponCode ?? null}, ${o.affiliateUid ?? null},
        ${o.gatewayFee ?? 0}, ${o.gatewayFeePercent ?? 0}, ${o.platformFee ?? 0}, ${o.platformFeePercent ?? 0},
        ${o.netAmount ?? 0},
        ${JSON.stringify(o.customer ?? {})}, ${JSON.stringify(o.customerAddress ?? {})},
        ${JSON.stringify(o.checkoutSnapshot ?? {})}, ${JSON.stringify(o.financialData ?? {})},
        ${JSON.stringify(o.financial ?? {})}, ${JSON.stringify(o.trackingParameters ?? {})},
        ${JSON.stringify(o.selectedOrderBumps ?? [])}, ${JSON.stringify(o.orderBumps ?? [])},
        ${JSON.stringify(o.metadata ?? {})},
        ${o.paidAt ?? null}, ${o.refundedAt ?? null}, ${o.expiresAt ?? null},
        ${o.createdAt ?? now}, ${o.updatedAt ?? now}
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, efi_charge_id = EXCLUDED.efi_charge_id,
        efi_txid = EXCLUDED.efi_txid, efi_status = EXCLUDED.efi_status,
        paid_at = COALESCE(EXCLUDED.paid_at, orders.paid_at),
        refunded_at = COALESCE(EXCLUDED.refunded_at, orders.refunded_at),
        net_amount = EXCLUDED.net_amount, metadata = EXCLUDED.metadata,
        financial = EXCLUDED.financial, financial_data = EXCLUDED.financial_data,
        updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM orders WHERE id = ${id} LIMIT 1`;
    return rowToOrder(rows[0]);
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const rows = await this.sql`SELECT * FROM orders WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToOrder(rows[0]);
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async createProduct(product: InsertProduct): Promise<Product> {
    const sql = this.sql;
    const now = new Date();
    const p = product as any;
    const id = p.id || `prod_${nanoid(21)}`;
    const { title, description, productType, imageUrl, active, accessDuration,
      notifyExpirationDays, hasAccess, checkoutId, tenantId, deleted,
      createdAt, updatedAt, id: _id, ...extra } = p;

    await sql`
      INSERT INTO products (
        id, tenant_id, title, description, product_type, image_url, active,
        access_duration, notify_expiration_days, has_access, checkout_id,
        deleted, metadata, created_at, updated_at
      ) VALUES (
        ${id}, ${tenantId ?? null}, ${title ?? null}, ${description ?? null},
        ${productType ?? 'digital'}, ${imageUrl ?? null}, ${active !== false},
        ${accessDuration ?? null}, ${notifyExpirationDays ?? null}, ${hasAccess ?? false},
        ${checkoutId ?? null}, ${deleted ?? false}, ${JSON.stringify(extra)},
        ${createdAt ?? now}, ${updatedAt ?? now}
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, description = EXCLUDED.description,
        product_type = EXCLUDED.product_type, image_url = EXCLUDED.image_url,
        active = EXCLUDED.active, access_duration = EXCLUDED.access_duration,
        notify_expiration_days = EXCLUDED.notify_expiration_days,
        has_access = EXCLUDED.has_access, checkout_id = EXCLUDED.checkout_id,
        deleted = EXCLUDED.deleted, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM products WHERE id = ${id} LIMIT 1`;
    return rowToProduct(rows[0]);
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const rows = await this.sql`SELECT * FROM products WHERE id = ${id} AND (deleted = FALSE OR deleted IS NULL) LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToProduct(rows[0]);
  }

  async getProductsByTenant(tenantId: string): Promise<Product[]> {
    const rows = await this.sql`SELECT * FROM products WHERE tenant_id = ${tenantId} AND (deleted = FALSE OR deleted IS NULL) ORDER BY created_at DESC LIMIT 500`;
    return rows.map(rowToProduct);
  }

  async getAllProducts(options?: { force?: boolean }): Promise<Product[]> {
    const rows = await this.sql`SELECT * FROM products ORDER BY created_at DESC LIMIT 2000`;
    return rows.map(rowToProduct);
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | undefined> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    const { title, description, productType, imageUrl, active, accessDuration,
      notifyExpirationDays, hasAccess, checkoutId, deleted, id: _id,
      tenantId, createdAt, updatedAt, ...extra } = u;

    await sql`
      UPDATE products SET
        title = COALESCE(${title ?? null}, title),
        description = COALESCE(${description ?? null}, description),
        product_type = COALESCE(${productType ?? null}, product_type),
        image_url = COALESCE(${imageUrl ?? null}, image_url),
        active = COALESCE(${active ?? null}, active),
        access_duration = COALESCE(${accessDuration ?? null}, access_duration),
        notify_expiration_days = COALESCE(${notifyExpirationDays ?? null}, notify_expiration_days),
        has_access = COALESCE(${hasAccess ?? null}, has_access),
        checkout_id = COALESCE(${checkoutId ?? null}, checkout_id),
        deleted = COALESCE(${deleted ?? null}, deleted),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(extra)}::jsonb,
        updated_at = ${now}
      WHERE id = ${id}
    `;
    return this.getProduct(id);
  }

  async deleteProduct(productId: string, options?: { mode: 'archive' | 'hard', deleteCheckout?: boolean }): Promise<{ success: boolean, message: string, details: any }> {
    const sql = this.sql;
    if (options?.mode === 'hard') {
      await sql`DELETE FROM products WHERE id = ${productId}`;
    } else {
      await sql`UPDATE products SET deleted = TRUE, active = FALSE, updated_at = NOW() WHERE id = ${productId}`;
    }
    return { success: true, message: 'Produto deletado', details: { productId } };
  }

  // ── Product Offers ─────────────────────────────────────────────────────────

  async listOffersByProduct(productId: string, includeInactive = false): Promise<ProductOffer[]> {
    const sql = this.sql;
    const rows = includeInactive
      ? await sql`SELECT * FROM product_offers WHERE product_id = ${productId} AND (deleted = FALSE OR deleted IS NULL) ORDER BY created_at DESC`
      : await sql`SELECT * FROM product_offers WHERE product_id = ${productId} AND active = TRUE AND (deleted = FALSE OR deleted IS NULL) ORDER BY created_at DESC`;
    return rows.map(rowToOffer);
  }

  async getOffer(id: string): Promise<ProductOffer | undefined> {
    const rows = await this.sql`SELECT * FROM product_offers WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToOffer(rows[0]);
  }

  async getOfferBySlug(productId: string, slug: string): Promise<ProductOffer | undefined> {
    const rows = await this.sql`SELECT * FROM product_offers WHERE product_id = ${productId} AND slug = ${slug} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToOffer(rows[0]);
  }

  async createOffer(offer: InsertProductOffer): Promise<ProductOffer> {
    const sql = this.sql;
    const now = new Date();
    const o = offer as any;
    const id = o.id || `offer_${nanoid(21)}`;
    const { name, slug, price, originalPrice, active, deleted, productId, tenantId,
      createdAt, updatedAt, id: _id, ...extra } = o;

    await sql`
      INSERT INTO product_offers (id, product_id, tenant_id, name, slug, price, original_price, active, deleted, metadata, created_at, updated_at)
      VALUES (${id}, ${productId ?? null}, ${tenantId ?? null}, ${name ?? null}, ${slug ?? null}, ${price ?? 0}, ${originalPrice ?? null}, ${active !== false}, ${deleted ?? false}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, price = EXCLUDED.price, original_price = EXCLUDED.original_price, active = EXCLUDED.active, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    return (await this.getOffer(id))!;
  }

  async updateOffer(id: string, updates: Partial<ProductOffer>): Promise<ProductOffer | undefined> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    await sql`
      UPDATE product_offers SET
        name = COALESCE(${u.name ?? null}, name),
        slug = COALESCE(${u.slug ?? null}, slug),
        price = COALESCE(${u.price ?? null}, price),
        original_price = COALESCE(${u.originalPrice ?? null}, original_price),
        active = COALESCE(${u.active ?? null}, active),
        deleted = COALESCE(${u.deleted ?? null}, deleted),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ ...u })}::jsonb,
        updated_at = ${now}
      WHERE id = ${id}
    `;
    return this.getOffer(id);
  }

  async deleteOffer(id: string): Promise<boolean> {
    await this.sql`UPDATE product_offers SET deleted = TRUE, active = FALSE, updated_at = NOW() WHERE id = ${id}`;
    return true;
  }

  // ── Modules ────────────────────────────────────────────────────────────────

  async createModule(module: InsertModule): Promise<Module> {
    const sql = this.sql;
    const now = new Date();
    const m = module as any;
    const id = m.id || `mod_${nanoid(21)}`;
    const { title, description, position, active, productId, tenantId, createdAt, updatedAt, id: _id, ...extra } = m;
    await sql`
      INSERT INTO modules (id, product_id, tenant_id, title, description, position, active, metadata, created_at, updated_at)
      VALUES (${id}, ${productId ?? null}, ${tenantId ?? null}, ${title ?? null}, ${description ?? null}, ${position ?? 0}, ${active !== false}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, position = EXCLUDED.position, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM modules WHERE id = ${id} LIMIT 1`;
    return rowToModule(rows[0]);
  }

  async getModule(id: string): Promise<Module | undefined> {
    const rows = await this.sql`SELECT * FROM modules WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToModule(rows[0]);
  }

  async listModulesByProduct(productId: string): Promise<Module[]> {
    const rows = await this.sql`SELECT * FROM modules WHERE product_id = ${productId} ORDER BY position ASC, created_at ASC`;
    return rows.map(rowToModule);
  }

  async listModulesByTenant(tenantId: string): Promise<Module[]> {
    const rows = await this.sql`SELECT * FROM modules WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`;
    return rows.map(rowToModule);
  }

  // ── Lessons ────────────────────────────────────────────────────────────────

  async createLesson(lesson: InsertLesson): Promise<Lesson> {
    const sql = this.sql;
    const now = new Date();
    const l = lesson as any;
    const id = l.id || `lesson_${nanoid(21)}`;
    const { title, description, contentUrl, contentType, position, durationSeconds, active,
      freePreview, moduleId, productId, tenantId, createdAt, updatedAt, id: _id, ...extra } = l;
    await sql`
      INSERT INTO lessons (id, module_id, product_id, tenant_id, title, description, content_url, content_type, position, duration_seconds, active, free_preview, metadata, created_at, updated_at)
      VALUES (${id}, ${moduleId ?? null}, ${productId ?? null}, ${tenantId ?? null}, ${title ?? null}, ${description ?? null}, ${contentUrl ?? null}, ${contentType ?? null}, ${position ?? 0}, ${durationSeconds ?? null}, ${active !== false}, ${freePreview ?? false}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, content_url = EXCLUDED.content_url, position = EXCLUDED.position, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM lessons WHERE id = ${id} LIMIT 1`;
    return rowToLesson(rows[0]);
  }

  async getLesson(id: string): Promise<Lesson | undefined> {
    const rows = await this.sql`SELECT * FROM lessons WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToLesson(rows[0]);
  }

  async listLessonsByModule(moduleId: string): Promise<Lesson[]> {
    const rows = await this.sql`SELECT * FROM lessons WHERE module_id = ${moduleId} ORDER BY position ASC, created_at ASC`;
    return rows.map(rowToLesson);
  }

  // ── Members ────────────────────────────────────────────────────────────────

  async createMember(member: InsertMember): Promise<Member> {
    const sql = this.sql;
    const now = new Date();
    const m = member as any;
    const id = m.id || `member_${nanoid(21)}`;
    const { userId, email, name, phone, document, avatarUrl, createdAt, updatedAt, id: _id, ...extra } = m;
    await sql`
      INSERT INTO members (id, user_id, email, name, phone, document, avatar_url, metadata, created_at, updated_at)
      VALUES (${id}, ${userId ?? null}, ${email ?? null}, ${name ?? null}, ${phone ?? null}, ${document ?? null}, ${avatarUrl ?? null}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM members WHERE id = ${id} LIMIT 1`;
    return rowToMember(rows[0]);
  }

  async getMember(id: string): Promise<Member | undefined> {
    const rows = await this.sql`SELECT * FROM members WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToMember(rows[0]);
  }

  // ── Enrollments ────────────────────────────────────────────────────────────

  async createEnrollment(enrollment: InsertEnrollment): Promise<Enrollment> {
    const sql = this.sql;
    const now = new Date();
    const e = enrollment as any;
    const id = e.id || `enrollment_${nanoid(21)}`;
    const { memberId, productId, tenantId, orderId, checkoutId, status, enrolledAt, expiresAt, accessDuration, createdAt, updatedAt, id: _id, ...extra } = e;
    await sql`
      INSERT INTO enrollments (id, member_id, product_id, tenant_id, order_id, checkout_id, status, enrolled_at, expires_at, access_duration, metadata, created_at, updated_at)
      VALUES (${id}, ${memberId ?? null}, ${productId ?? null}, ${tenantId ?? null}, ${orderId ?? null}, ${checkoutId ?? null}, ${status ?? 'active'}, ${enrolledAt ?? now}, ${expiresAt ?? null}, ${accessDuration ?? null}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM enrollments WHERE id = ${id} LIMIT 1`;
    return rowToEnrollment(rows[0]);
  }

  async getEnrollment(id: string): Promise<Enrollment | undefined> {
    const rows = await this.sql`SELECT * FROM enrollments WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToEnrollment(rows[0]);
  }

  async listEnrollmentsByProduct(productId: string): Promise<Enrollment[]> {
    const rows = await this.sql`SELECT * FROM enrollments WHERE product_id = ${productId} ORDER BY created_at DESC`;
    return rows.map(rowToEnrollment);
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  async createProgress(progress: InsertProgress): Promise<Progress> {
    const sql = this.sql;
    const now = new Date();
    const p = progress as any;
    const id = p.id || `prog_${nanoid(21)}`;
    const { memberId, lessonId, productId, moduleId, tenantId, status, progressPercent, completedAt, createdAt, updatedAt, id: _id, ...extra } = p;
    await sql`
      INSERT INTO progress (id, member_id, lesson_id, product_id, module_id, tenant_id, status, progress_percent, completed_at, metadata, created_at, updated_at)
      VALUES (${id}, ${memberId ?? null}, ${lessonId ?? null}, ${productId ?? null}, ${moduleId ?? null}, ${tenantId ?? null}, ${status ?? 'started'}, ${progressPercent ?? 0}, ${completedAt ?? null}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, progress_percent = EXCLUDED.progress_percent, completed_at = EXCLUDED.completed_at, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM progress WHERE id = ${id} LIMIT 1`;
    return rowToProgress(rows[0]);
  }

  async getProgress(id: string): Promise<Progress | undefined> {
    const rows = await this.sql`SELECT * FROM progress WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToProgress(rows[0]);
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const sql = this.sql;
    const now = new Date();
    const s = subscription as any;
    const id = s.id || `sub_${nanoid(21)}`;
    const {
      tenantId, checkoutId, productId, productName, orderId,
      customerId, customerName, customerEmail, customerPhone, customerDocument, customerAddress,
      status, billingCycle, period, amount, currency, recurringCount, method, paymentMethod,
      autoRenew, dunningAttempts, startDate, nextBillingDate, expiresAt, lastPaymentDate,
      cancelledAt, createdAt, updatedAt, id: _id, ...extra
    } = s;

    await sql`
      INSERT INTO subscriptions (
        id, tenant_id, checkout_id, product_id, product_name, order_id,
        customer_id, customer_name, customer_email, customer_phone, customer_document, customer_address,
        status, billing_cycle, period, amount, currency, recurring_count, method, payment_method,
        auto_renew, dunning_attempts, start_date, next_billing_date, expires_at, last_payment_date,
        cancelled_at, metadata, created_at, updated_at
      ) VALUES (
        ${id}, ${tenantId ?? null}, ${checkoutId ?? null}, ${productId ?? null}, ${productName ?? null}, ${orderId ?? null},
        ${customerId ?? null}, ${customerName ?? null}, ${customerEmail ?? null}, ${customerPhone ?? null},
        ${customerDocument ?? null}, ${JSON.stringify(customerAddress ?? {})},
        ${status ?? 'active'}, ${billingCycle ?? null}, ${period ?? 'mensal'},
        ${amount ?? 0}, ${currency ?? 'BRL'}, ${recurringCount ?? 1}, ${method ?? null}, ${paymentMethod ?? null},
        ${autoRenew ?? false}, ${dunningAttempts ?? 0},
        ${startDate ?? now}, ${nextBillingDate ?? null}, ${expiresAt ?? null}, ${lastPaymentDate ?? null},
        ${cancelledAt ?? null}, ${JSON.stringify(extra)},
        ${createdAt ?? now}, ${updatedAt ?? now}
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, next_billing_date = EXCLUDED.next_billing_date,
        expires_at = EXCLUDED.expires_at, last_payment_date = EXCLUDED.last_payment_date,
        cancelled_at = EXCLUDED.cancelled_at, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM subscriptions WHERE id = ${id} LIMIT 1`;
    return rowToSubscription(rows[0]);
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    const rows = await this.sql`SELECT * FROM subscriptions WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToSubscription(rows[0]);
  }

  async getSubscriptionsByTenant(tenantId: string): Promise<Subscription[]> {
    const rows = await this.sql`SELECT * FROM subscriptions WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`;
    return rows.map(rowToSubscription);
  }

  async getSubscriptionByCustomerAndProduct(tenantId: string, customerEmail: string, checkoutId: string): Promise<Subscription | undefined> {
    const rows = await this.sql`SELECT * FROM subscriptions WHERE tenant_id = ${tenantId} AND customer_email = ${customerEmail} AND checkout_id = ${checkoutId} LIMIT 1`;
    if (!rows.length) return undefined;
    return rowToSubscription(rows[0]);
  }

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    await sql`
      UPDATE subscriptions SET
        status = COALESCE(${u.status ?? null}, status),
        next_billing_date = COALESCE(${u.nextBillingDate ?? null}, next_billing_date),
        expires_at = COALESCE(${u.expiresAt ?? null}, expires_at),
        last_payment_date = COALESCE(${u.lastPaymentDate ?? null}, last_payment_date),
        cancelled_at = COALESCE(${u.cancelledAt ?? null}, cancelled_at),
        auto_renew = COALESCE(${u.autoRenew ?? null}, auto_renew),
        dunning_attempts = COALESCE(${u.dunningAttempts ?? null}, dunning_attempts),
        recurring_count = COALESCE(${u.recurringCount ?? null}, recurring_count),
        amount = COALESCE(${u.amount ?? null}, amount),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(u.metadata ?? {})}::jsonb,
        updated_at = ${now}
      WHERE id = ${id}
    `;
    const result = await this.getSubscription(id);
    if (!result) throw new Error(`Subscription ${id} não encontrada após update`);
    return result;
  }

  async cancelSubscription(id: string): Promise<Subscription> {
    const subscription = await this.updateSubscription(id, {
      status: 'cancelled',
      cancelledAt: new Date(),
    });
    await this.updateEnrollmentStatusByEmail(
      subscription.tenantId,
      subscription.customerEmail,
      subscription.checkoutId,
      'cancelled'
    );
    return subscription;
  }

  private async updateEnrollmentStatusByEmail(tenantId: string, email: string, checkoutId: string, status: string): Promise<void> {
    await neonQuery(async (sql) => {
      await sql`
        UPDATE enrollments
        SET status = ${status}, updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND checkout_id = ${checkoutId}
          AND (metadata->>'customerEmail' = ${email} OR metadata->>'email' = ${email} OR member_id = ${email})
      `;
    }, 'updateEnrollmentStatusByEmail');
  }

  // ── Enrollment on payment ──────────────────────────────────────────────────

  async createEnrollmentOnPayment(orderData: any): Promise<void> {
    try {
      const sql = this.sql;
      console.log(`🎯 [NEON] CRIANDO ENROLLMENT AUTOMÁTICO para order: ${orderData.id}`);

      const checkoutRows = await sql`SELECT * FROM checkouts WHERE id = ${orderData.checkoutId} LIMIT 1`;
      if (!checkoutRows.length) {
        console.log(`❌ [NEON] Checkout não encontrado: ${orderData.checkoutId}`);
        return;
      }
      const checkoutData = checkoutRows[0];
      const productOwnerTenantId = checkoutData.tenant_id;
      if (!productOwnerTenantId) return;

      const realProductId = checkoutData.synced_product_id || orderData.checkoutId;
      const productTitle = orderData.checkoutSnapshot?.title || checkoutData.title || `Produto ${orderData.checkoutId}`;
      const productAmount = orderData.amount;

      const customerEmail = orderData.customer?.email;
      if (!customerEmail) {
        console.log(`⚠️ [NEON] ENROLLMENT SKIP: sem customer.email`);
        return;
      }

      let realPurchaseDate: Date;
      if (orderData.paidAt instanceof Date) realPurchaseDate = orderData.paidAt;
      else if (orderData.paidAt) realPurchaseDate = new Date(orderData.paidAt);
      else realPurchaseDate = new Date();

      const guaranteeDays = 7;
      const guaranteeExpiresAt = new Date(realPurchaseDate.getTime() + guaranteeDays * 86400000);

      const existing = await sql`
        SELECT id FROM enrollments
        WHERE tenant_id = ${productOwnerTenantId}
          AND product_id = ${realProductId}
          AND status = 'active'
          AND (metadata->>'customerEmail' = ${customerEmail} OR member_id = ${customerEmail})
        LIMIT 1
      `;

      const allowMultiple = (checkoutData.global_settings as any)?.allowMultiplePurchases;
      if (!existing.length || allowMultiple) {
        const enrollmentId = `enrollment_${Date.now()}_${orderData.id}_${nanoid(12)}`;
        await sql`
          INSERT INTO enrollments (
            id, member_id, product_id, tenant_id, order_id, checkout_id, status,
            enrolled_at, expires_at, metadata, created_at, updated_at
          ) VALUES (
            ${enrollmentId}, ${customerEmail}, ${realProductId}, ${productOwnerTenantId},
            ${orderData.id}, ${orderData.checkoutId}, 'active',
            ${realPurchaseDate}, NULL,
            ${JSON.stringify({
              customerEmail,
              customerName: orderData.customer?.name,
              productTitle,
              amount: productAmount,
              method: orderData.method,
              guaranteeExpiresAt: guaranteeExpiresAt.toISOString(),
              autoCreated: true,
            })},
            ${realPurchaseDate}, ${new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        console.log(`🎉 [NEON] ENROLLMENT CRIADO: ${enrollmentId}`);
      } else {
        console.log(`✅ [NEON] Enrollment já existe para ${customerEmail}`);
      }

      // Se subscription, criar subscription automaticamente
      const isSubscription = orderData.productType === 'subscription' || orderData.checkoutSnapshot?.productType === 'subscription';
      if (isSubscription) {
        const subPeriod = orderData.subscriptionPeriod || orderData.checkoutSnapshot?.pricing?.subscriptionPeriod || 'mensal';
        let daysToAdd = 30;
        switch (subPeriod) {
          case 'trimestral': case 'quarterly': daysToAdd = 90; break;
          case 'semestral': case 'semiannual': daysToAdd = 180; break;
          case 'anual': case 'annual': case 'yearly': daysToAdd = 365; break;
        }

        const existingSub = await this.getSubscriptionByCustomerAndProduct(productOwnerTenantId, customerEmail, orderData.checkoutId);
        if (!existingSub) {
          const nextBilling = new Date(realPurchaseDate.getTime() + daysToAdd * 86400000);
          await this.createSubscription({
            tenantId: productOwnerTenantId,
            checkoutId: orderData.checkoutId,
            orderId: orderData.id,
            customerId: customerEmail,
            customerName: orderData.customer?.name || '',
            customerEmail,
            customerPhone: orderData.customer?.phone || '',
            customerDocument: orderData.customer?.document || '',
            customerAddress: orderData.customerAddress,
            productName: productTitle,
            amount: productAmount,
            period: subPeriod,
            status: 'active',
            startDate: realPurchaseDate,
            nextBillingDate: nextBilling,
            expiresAt: nextBilling,
            lastPaymentDate: realPurchaseDate,
            paymentMethod: orderData.method === 'pix' ? 'pix' : 'card',
          } as any);
          console.log(`🔄 [NEON] SUBSCRIPTION criada para ${customerEmail}`);
        } else if (existingSub.status === 'expired' || existingSub.status === 'cancelled') {
          const nextBilling = new Date(realPurchaseDate.getTime() + daysToAdd * 86400000);
          await this.updateSubscription(existingSub.id, {
            status: 'active',
            nextBillingDate: nextBilling,
            expiresAt: nextBilling,
            lastPaymentDate: realPurchaseDate,
          });
        }
      }
    } catch (error: any) {
      console.error('❌ [NEON] Erro ao criar enrollment automático:', error);
    }
  }

  // ── Affiliate commission ───────────────────────────────────────────────────

  async calculateAffiliateCommission(orderData: any): Promise<{
    hasAffiliate: boolean; affiliateId?: string; grossCommission: number;
    netCommission: number; commissionPercent: number; adminFeePercent: number; productType: string;
  }> {
    const noAff = { hasAffiliate: false, grossCommission: 0, netCommission: 0, commissionPercent: 0, adminFeePercent: 0, productType: 'digital' };
    try {
      const sql = this.sql;
      const affiliateIdentifier = orderData.affiliateCode || orderData.affiliateUid;
      if (!affiliateIdentifier) return noAff;

      const affiliateData = await this._findAffiliate(affiliateIdentifier);
      if (!affiliateData) return noAff;

      const checkoutRows = await sql`SELECT * FROM checkouts WHERE id = ${orderData.checkoutId} LIMIT 1`;
      if (!checkoutRows.length) return noAff;
      const checkoutData = checkoutRows[0];

      const isRecurring = orderData.productType === 'subscription' || checkoutData.product_type === 'subscription';
      const affiliateObj = affiliateData.row;
      const snapshotSingle = affiliateObj.commission_snapshot?.single;
      const snapshotRecurring = affiliateObj.commission_snapshot?.subscription;
      const customCommission = affiliateObj.custom_commission;
      const affiliateCheckout = checkoutData.affiliate as any || {};

      const commissionPercent = isRecurring
        ? (snapshotRecurring ?? affiliateCheckout.recurringCommissionPercent ?? 0)
        : (customCommission ?? snapshotSingle ?? affiliateCheckout.commissionPercent ?? 10);

      const adminFeePercent = affiliateCheckout.adminFeePercent ?? 5;
      const grossCommission = Math.round(orderData.amount * (commissionPercent / 100));
      const adminFee = Math.round(grossCommission * (adminFeePercent / 100));
      const netCommission = grossCommission - adminFee;
      const productType = isRecurring ? 'subscription' : (orderData.productType || checkoutData.product_type || 'digital');

      return { hasAffiliate: true, affiliateId: affiliateData.uid, grossCommission, netCommission, commissionPercent, adminFeePercent, productType };
    } catch (error) {
      console.error('❌ [NEON] Erro ao calcular comissão:', error);
      return noAff;
    }
  }

  private async _findAffiliate(identifier: string): Promise<{ row: any; uid: string; source: string } | null> {
    const sql = this.sql;

    let rows = await sql`SELECT *, 'affiliates' AS _src FROM affiliates WHERE affiliate_code = ${identifier} AND status = 'approved' LIMIT 1`;
    if (!rows.length) rows = await sql`SELECT *, 'affiliates' AS _src FROM affiliates WHERE user_id = ${identifier} AND status = 'approved' LIMIT 1`;
    if (!rows.length) rows = await sql`SELECT *, 'affiliates' AS _src FROM affiliates WHERE affiliate_slug = ${identifier} AND status = 'approved' LIMIT 1`;
    if (!rows.length) rows = await sql`SELECT *, 'affiliations' AS _src FROM affiliations WHERE affiliate_code = ${identifier} AND status = 'approved' LIMIT 1`;
    if (!rows.length) rows = await sql`SELECT *, 'affiliations' AS _src FROM affiliations WHERE affiliate_id = ${identifier} AND status = 'approved' LIMIT 1`;
    if (!rows.length) return null;

    const row = rows[0];
    const uid = row.affiliate_id || row.user_id || row.id;
    return { row, uid, source: row._src };
  }

  async processAffiliateCommission(orderData: any): Promise<void> {
    try {
      const sql = this.sql;
      const affiliateIdentifier = orderData.affiliateCode || orderData.affiliateUid;
      if (!affiliateIdentifier) return;

      const orderId = orderData.id || orderData.orderId;
      if (!orderId) return;

      console.log(`💰 [NEON] PROCESSANDO COMISSÃO para: ${affiliateIdentifier}, ordem: ${orderId}`);

      const affiliateData = await this._findAffiliate(affiliateIdentifier);
      if (!affiliateData) {
        console.log(`❌ [NEON] Afiliado não encontrado: ${affiliateIdentifier}`);
        return;
      }

      const checkoutRows = await sql`SELECT * FROM checkouts WHERE id = ${orderData.checkoutId} LIMIT 1`;
      if (!checkoutRows.length) return;
      const checkoutData = checkoutRows[0];

      const { row: affiliateRow, uid: affiliateUid } = affiliateData;
      const isRecurring = orderData.productType === 'subscription' || checkoutData.product_type === 'subscription';
      const affiliateCheckout = checkoutData.affiliate as any || {};

      const snapshotSingle = affiliateRow.commission_snapshot?.single;
      const snapshotRecurring = affiliateRow.commission_snapshot?.subscription;
      const customCommission = affiliateRow.custom_commission;

      const commissionPercent = isRecurring
        ? (snapshotRecurring ?? affiliateCheckout.recurringCommissionPercent ?? 0)
        : (customCommission ?? snapshotSingle ?? affiliateCheckout.commissionPercent ?? 10);

      const paymentDelay = orderData.financial?.releaseDays ?? orderData.financialData?.releaseDays ?? affiliateCheckout.paymentDelay ?? 30;
      const orderAmount = orderData.amount;
      const grossCommission = Math.round(orderAmount * (commissionPercent / 100));
      const adminFeePercent = affiliateCheckout.adminFeePercent ?? 5;
      const adminFee = Math.round(grossCommission * (adminFeePercent / 100));
      const netCommission = grossCommission - adminFee;

      let paidDate: Date;
      if (orderData.paidAt instanceof Date) paidDate = orderData.paidAt;
      else paidDate = new Date(orderData.paidAt || Date.now());

      const releaseDate = new Date(paidDate);
      releaseDate.setDate(releaseDate.getDate() + paymentDelay);

      const commissionId = `commission_${orderId}_${affiliateUid}`;
      const isPixPayment = (orderData.method || '').toLowerCase() === 'pix';

      // Insert commission (idempotente via ON CONFLICT DO NOTHING)
      await sql`
        INSERT INTO affiliate_commissions (
          id, tenant_id, affiliate_id, affiliate_code, affiliate_name, affiliate_email,
          order_id, checkout_id, product_id, product_name, product_type,
          customer_email, customer_name, order_amount, commission_percent,
          amount, gross_amount, admin_fee, net_amount, admin_fee_percent,
          status, payment_method, balance_credited, release_date, paid_at, created_at, updated_at
        ) VALUES (
          ${commissionId}, ${orderData.tenantId ?? null}, ${affiliateUid},
          ${affiliateRow.affiliate_code ?? affiliateIdentifier},
          ${affiliateRow.name ?? affiliateRow.affiliate_name ?? null},
          ${affiliateRow.email ?? affiliateRow.affiliate_email ?? null},
          ${orderId}, ${orderData.checkoutId ?? null}, ${orderData.productId ?? null},
          ${orderData.checkoutSnapshot?.title ?? null},
          ${isRecurring ? 'subscription' : (orderData.productType || 'digital')},
          ${orderData.customer?.email ?? null}, ${orderData.customer?.name ?? null},
          ${orderAmount}, ${commissionPercent},
          ${grossCommission}, ${grossCommission}, ${adminFee}, ${netCommission}, ${adminFeePercent},
          ${isPixPayment ? 'approved' : 'pending'}, ${orderData.method ?? null},
          TRUE, ${releaseDate}, ${paidDate}, NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;

      // Upsert affiliate_balances
      await sql`
        INSERT INTO affiliate_balances (
          user_id, balance_available_brl, balance_pending_brl, balance_reserved_brl,
          lifetime_commissions_brl, total_sales, total_commissions,
          pending_commissions, approved_commissions, last_commission_date, created_at, updated_at
        ) VALUES (
          ${affiliateUid},
          ${isPixPayment ? netCommission : 0}, ${isPixPayment ? 0 : netCommission}, 0,
          ${netCommission}, 1, 1,
          ${isPixPayment ? 0 : 1}, ${isPixPayment ? 1 : 0},
          NOW(), NOW(), NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          balance_available_brl = affiliate_balances.balance_available_brl + ${isPixPayment ? netCommission : 0},
          balance_pending_brl = affiliate_balances.balance_pending_brl + ${isPixPayment ? 0 : netCommission},
          lifetime_commissions_brl = affiliate_balances.lifetime_commissions_brl + ${netCommission},
          total_sales = affiliate_balances.total_sales + 1,
          total_commissions = affiliate_balances.total_commissions + 1,
          pending_commissions = affiliate_balances.pending_commissions + ${isPixPayment ? 0 : 1},
          approved_commissions = affiliate_balances.approved_commissions + ${isPixPayment ? 1 : 0},
          last_commission_date = NOW(), updated_at = NOW()
      `;

      // Update order: comissão processada
      await sql`
        UPDATE orders SET
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            commissionProcessed: true,
            affiliateCommission: grossCommission,
            affiliateCommissionNet: netCommission,
          })}::jsonb,
          net_amount = GREATEST(0, net_amount - ${grossCommission}),
          updated_at = NOW()
        WHERE id = ${orderId} AND NOT COALESCE((metadata->>'commissionProcessed')::boolean, FALSE)
      `;

      // Mark affiliate click as converted
      await neonQuery(async (s) => {
        await s`
          UPDATE affiliate_clicks SET converted = TRUE, updated_at = NOW()
          WHERE affiliate_id = ${affiliateIdentifier} AND converted = FALSE
          ORDER BY clicked_at DESC LIMIT 1
        `;
      }, 'markAffiliateClickConverted');

      console.log(`🎉 [NEON] COMISSÃO processada: R$ ${(netCommission / 100).toFixed(2)} para ${affiliateUid}`);
    } catch (error: any) {
      console.error('❌ [NEON] Erro ao processar comissão de afiliado:', error);
    }
  }

  // ── Seller balance ─────────────────────────────────────────────────────────

  async creditSellerBalance(sellerId: string, amountCentavos: number, metadata: {
    orderId: string; type: string; description: string; availableImmediately?: boolean;
  }): Promise<void> {
    if (amountCentavos <= 0) return;
    try {
      const sql = this.sql;

      // Idempotência: verificar se order já foi creditada
      const orderRows = await sql`SELECT metadata FROM orders WHERE id = ${metadata.orderId} LIMIT 1`;
      if (orderRows.length && (orderRows[0].metadata as any)?.balanceCredited) {
        console.log(`🔒 [NEON] Ordem ${metadata.orderId} já creditada - SKIP`);
        return;
      }

      const isImmediate = metadata.availableImmediately !== false;

      await sql`
        INSERT INTO seller_balances (
          seller_id, balance_available_brl, balance_pending_brl, balance_reserved_brl,
          lifetime_revenue_brl, available_balance, total_balance, updated_at
        ) VALUES (
          ${sellerId},
          ${isImmediate ? amountCentavos : 0},
          ${isImmediate ? 0 : amountCentavos},
          0, ${amountCentavos},
          ${isImmediate ? amountCentavos : 0},
          ${amountCentavos},
          NOW()
        )
        ON CONFLICT (seller_id) DO UPDATE SET
          balance_available_brl = seller_balances.balance_available_brl + ${isImmediate ? amountCentavos : 0},
          balance_pending_brl = seller_balances.balance_pending_brl + ${isImmediate ? 0 : amountCentavos},
          lifetime_revenue_brl = seller_balances.lifetime_revenue_brl + ${amountCentavos},
          available_balance = seller_balances.available_balance + ${isImmediate ? amountCentavos : 0},
          total_balance = seller_balances.total_balance + ${amountCentavos},
          updated_at = NOW()
      `;

      // Marcar order como creditada
      await sql`
        UPDATE orders
        SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ balanceCredited: true, balanceCreditedAt: new Date().toISOString(), balanceCreditedAmount: amountCentavos })}::jsonb,
            updated_at = NOW()
        WHERE id = ${metadata.orderId}
      `;

      // Inserir movement
      await neonQuery(async (s) => {
        await s`
          INSERT INTO balance_movements (seller_id, amount_cents, currency, balance_type, operation, reason, order_id, metadata)
          VALUES (${sellerId}, ${amountCentavos}, 'BRL', ${isImmediate ? 'available' : 'pending'}, 'credit', ${metadata.description}, ${metadata.orderId}, ${JSON.stringify(metadata)})
        `;
      }, 'insertBalanceMovement');

      console.log(`💰 [NEON] Saldo creditado: Seller ${sellerId} +R$ ${(amountCentavos / 100).toFixed(2)}`);
    } catch (error: any) {
      console.error(`❌ [NEON] Erro ao creditar saldo do seller ${sellerId}:`, error?.message);
    }
  }

  // ── Banners ────────────────────────────────────────────────────────────────

  async getBannersByTenant(tenantId: string): Promise<Banner[]> {
    const rows = await this.sql`SELECT * FROM banners WHERE tenant_id = ${tenantId} ORDER BY priority DESC, created_at DESC`;
    return rows.map(rowToBanner);
  }

  async getBanner(id: string, tenantId: string): Promise<Banner | null> {
    const rows = await this.sql`SELECT * FROM banners WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`;
    if (!rows.length) return null;
    return rowToBanner(rows[0]);
  }

  async createBanner(banner: InsertBanner, tenantId: string): Promise<Banner> {
    const sql = this.sql;
    const now = new Date();
    const b = banner as any;
    const id = b.id || `banner_${nanoid(21)}`;
    await sql`
      INSERT INTO banners (id, tenant_id, title, image_url, link, is_active, position, priority, description, target_blank, start_date, end_date, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${b.title ?? null}, ${b.imageUrl}, ${b.link ?? null}, ${b.isActive !== false}, ${b.position ?? 'dashboard_top'}, ${b.priority ?? 0}, ${b.description ?? null}, ${b.targetBlank ?? false}, ${b.startDate ?? null}, ${b.endDate ?? null}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, image_url = EXCLUDED.image_url, link = EXCLUDED.link, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at
    `;
    return (await this.getBanner(id, tenantId))!;
  }

  async updateBanner(id: string, tenantId: string, updates: Partial<Banner>): Promise<Banner> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    await sql`
      UPDATE banners SET
        title = COALESCE(${u.title ?? null}, title),
        image_url = COALESCE(${u.imageUrl ?? null}, image_url),
        link = COALESCE(${u.link ?? null}, link),
        is_active = COALESCE(${u.isActive ?? null}, is_active),
        position = COALESCE(${u.position ?? null}, position),
        priority = COALESCE(${u.priority ?? null}, priority),
        description = COALESCE(${u.description ?? null}, description),
        target_blank = COALESCE(${u.targetBlank ?? null}, target_blank),
        start_date = COALESCE(${u.startDate ?? null}, start_date),
        end_date = COALESCE(${u.endDate ?? null}, end_date),
        updated_at = ${now}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    const result = await this.getBanner(id, tenantId);
    if (!result) throw new Error(`Banner ${id} não encontrado`);
    return result;
  }

  async deleteBanner(id: string, tenantId: string): Promise<void> {
    await this.sql`DELETE FROM banners WHERE id = ${id} AND tenant_id = ${tenantId}`;
  }

  async getActiveBannersByPosition(position: string, tenantId: string): Promise<Banner[]> {
    const now = new Date();
    const rows = await this.sql`
      SELECT * FROM banners
      WHERE tenant_id = ${tenantId} AND position = ${position} AND is_active = TRUE
        AND (start_date IS NULL OR start_date <= ${now})
        AND (end_date IS NULL OR end_date >= ${now})
      ORDER BY priority DESC
    `;
    return rows.map(rowToBanner);
  }

  // ── Showcase ───────────────────────────────────────────────────────────────

  async getPublicShowcaseCheckouts(filters?: { search?: string; category?: string; affiliateOnly?: boolean; limit?: number }): Promise<Checkout[]> {
    const sql = this.sql;
    const limit = filters?.limit || 50;
    let rows: any[];
    if (filters?.affiliateOnly) {
      rows = await sql`
        SELECT c.* FROM checkouts c
        WHERE c.active = TRUE AND (c.deleted = FALSE OR c.deleted IS NULL)
          AND (c.affiliate->>'enabled')::boolean = TRUE
        ORDER BY c.sales_count DESC, c.created_at DESC
        LIMIT ${limit}
      `;
    } else if (filters?.search) {
      rows = await sql`
        SELECT c.* FROM checkouts c
        WHERE c.active = TRUE AND (c.deleted = FALSE OR c.deleted IS NULL)
          AND c.title ILIKE ${'%' + filters.search + '%'}
        ORDER BY c.sales_count DESC, c.created_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT c.* FROM checkouts c
        WHERE c.active = TRUE AND (c.deleted = FALSE OR c.deleted IS NULL)
        ORDER BY c.sales_count DESC, c.created_at DESC
        LIMIT ${limit}
      `;
    }
    return rows.map(rowToCheckout);
  }

  // ── Testimonials ───────────────────────────────────────────────────────────

  async createTestimonial(data: any): Promise<any> {
    const sql = this.sql;
    const now = new Date();
    const id = data.id || `test_${nanoid(21)}`;
    await sql`
      INSERT INTO testimonials (id, checkout_id, tenant_id, customer_name, customer_email, rating, comment, approved, metadata, created_at, updated_at)
      VALUES (${id}, ${data.checkoutId ?? null}, ${data.tenantId ?? null}, ${data.customerName ?? null}, ${data.customerEmail ?? null}, ${data.rating ?? null}, ${data.comment ?? null}, ${data.approved ?? false}, ${JSON.stringify(data)}, ${now}, ${now})
      ON CONFLICT (id) DO NOTHING
    `;
    const rows = await sql`SELECT * FROM testimonials WHERE id = ${id} LIMIT 1`;
    return this._testimonialRow(rows[0]);
  }

  async getTestimonial(id: string): Promise<any | null> {
    const rows = await this.sql`SELECT * FROM testimonials WHERE id = ${id} LIMIT 1`;
    if (!rows.length) return null;
    return this._testimonialRow(rows[0]);
  }

  async getTestimonialsByCheckout(checkoutId: string, tenantId: string): Promise<any[]> {
    const rows = await this.sql`SELECT * FROM testimonials WHERE checkout_id = ${checkoutId} AND tenant_id = ${tenantId} ORDER BY created_at DESC`;
    return rows.map(r => this._testimonialRow(r));
  }

  async updateTestimonial(id: string, updates: any): Promise<any> {
    const sql = this.sql;
    const now = new Date();
    await sql`
      UPDATE testimonials SET
        customer_name = COALESCE(${updates.customerName ?? null}, customer_name),
        rating = COALESCE(${updates.rating ?? null}, rating),
        comment = COALESCE(${updates.comment ?? null}, comment),
        approved = COALESCE(${updates.approved ?? null}, approved),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(updates)}::jsonb,
        updated_at = ${now}
      WHERE id = ${id}
    `;
    return this.getTestimonial(id);
  }

  async deleteTestimonial(id: string): Promise<void> {
    await this.sql`DELETE FROM testimonials WHERE id = ${id}`;
  }

  private _testimonialRow(r: any): any {
    if (!r) return null;
    return { id: r.id, checkoutId: r.checkout_id, tenantId: r.tenant_id, customerName: r.customer_name, customerEmail: r.customer_email, rating: r.rating, comment: r.comment, approved: r.approved, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), ...(r.metadata || {}) };
  }

  // ── Managed pixels (checkout_pixels) ──────────────────────────────────────

  async createManagedPixel(pixel: any): Promise<any> {
    const sql = this.sql;
    const now = new Date();
    const id = pixel.id || pixel.pixelId || `px_${nanoid(21)}`;
    await sql`
      INSERT INTO checkout_pixels (id, checkout_id, tenant_id, platform, name, pixel_id, access_token, measurement_id, enabled, events, is_legacy, metadata, created_at, updated_at)
      VALUES (${id}, ${pixel.checkoutId ?? null}, ${pixel.tenantId ?? null}, ${pixel.platform ?? 'facebook'}, ${pixel.name ?? null}, ${pixel.pixelId ?? pixel.id ?? null}, ${pixel.accessToken ?? null}, ${pixel.measurementId ?? null}, ${pixel.enabled !== false}, ${JSON.stringify(pixel.events ?? {})}, ${pixel.isLegacy ?? false}, ${JSON.stringify(pixel)}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET platform = EXCLUDED.platform, name = EXCLUDED.name, pixel_id = EXCLUDED.pixel_id, access_token = EXCLUDED.access_token, enabled = EXCLUDED.enabled, events = EXCLUDED.events, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM checkout_pixels WHERE id = ${id} LIMIT 1`;
    return this._pixelRow(rows[0]);
  }

  async getManagedPixel(pixelId: string, checkoutId: string): Promise<any | null> {
    const rows = await this.sql`SELECT * FROM checkout_pixels WHERE id = ${pixelId} AND checkout_id = ${checkoutId} LIMIT 1`;
    if (!rows.length) return null;
    return this._pixelRow(rows[0]);
  }

  async getManagedPixelsByCheckout(checkoutId: string, tenantId: string): Promise<any[]> {
    const rows = await this.sql`SELECT * FROM checkout_pixels WHERE checkout_id = ${checkoutId} AND tenant_id = ${tenantId} ORDER BY created_at DESC`;
    return rows.map(r => this._pixelRow(r));
  }

  async updateManagedPixel(pixelId: string, checkoutId: string, updates: any): Promise<any> {
    const sql = this.sql;
    const now = new Date();
    await sql`
      UPDATE checkout_pixels SET
        platform = COALESCE(${updates.platform ?? null}, platform),
        name = COALESCE(${updates.name ?? null}, name),
        pixel_id = COALESCE(${updates.pixelId ?? null}, pixel_id),
        access_token = COALESCE(${updates.accessToken ?? null}, access_token),
        measurement_id = COALESCE(${updates.measurementId ?? null}, measurement_id),
        enabled = COALESCE(${updates.enabled ?? null}, enabled),
        events = CASE WHEN ${updates.events !== undefined} THEN ${JSON.stringify(updates.events ?? {})}::jsonb ELSE events END,
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(updates)}::jsonb,
        updated_at = ${now}
      WHERE id = ${pixelId} AND checkout_id = ${checkoutId}
    `;
    return this.getManagedPixel(pixelId, checkoutId);
  }

  async deleteManagedPixel(pixelId: string, checkoutId: string): Promise<void> {
    await this.sql`DELETE FROM checkout_pixels WHERE id = ${pixelId} AND checkout_id = ${checkoutId}`;
  }

  private _pixelRow(r: any): any {
    if (!r) return null;
    return { id: r.id, checkoutId: r.checkout_id, tenantId: r.tenant_id, platform: r.platform, name: r.name, pixelId: r.pixel_id, accessToken: r.access_token, measurementId: r.measurement_id, enabled: r.enabled, events: r.events, isLegacy: r.is_legacy, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), ...(r.metadata || {}) };
  }

  // ── Product pixels ─────────────────────────────────────────────────────────

  async createProductPixel(pixel: any): Promise<any> {
    const sql = this.sql;
    const now = new Date();
    const id = pixel.id || pixel.pixelId || `ppx_${nanoid(21)}`;
    await sql`
      INSERT INTO product_pixels (id, product_id, tenant_id, platform, name, pixel_id, enabled, events, metadata, created_at, updated_at)
      VALUES (${id}, ${pixel.productId ?? null}, ${pixel.tenantId ?? null}, ${pixel.platform ?? 'facebook'}, ${pixel.name ?? null}, ${pixel.pixelId ?? pixel.id ?? null}, ${pixel.enabled !== false}, ${JSON.stringify(pixel.events ?? {})}, ${JSON.stringify(pixel)}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET platform = EXCLUDED.platform, name = EXCLUDED.name, pixel_id = EXCLUDED.pixel_id, enabled = EXCLUDED.enabled, events = EXCLUDED.events, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM product_pixels WHERE id = ${id} LIMIT 1`;
    return this._productPixelRow(rows[0]);
  }

  async getProductPixel(pixelId: string, productId: string): Promise<any | null> {
    const rows = await this.sql`SELECT * FROM product_pixels WHERE id = ${pixelId} AND product_id = ${productId} LIMIT 1`;
    if (!rows.length) return null;
    return this._productPixelRow(rows[0]);
  }

  async getManagedPixelsByProduct(productId: string, tenantId: string): Promise<any[]> {
    const rows = await this.sql`SELECT * FROM product_pixels WHERE product_id = ${productId} AND tenant_id = ${tenantId} ORDER BY created_at DESC`;
    return rows.map(r => this._productPixelRow(r));
  }

  async updateProductPixel(pixelId: string, productId: string, updates: any): Promise<any> {
    const sql = this.sql;
    const now = new Date();
    await sql`
      UPDATE product_pixels SET
        platform = COALESCE(${updates.platform ?? null}, platform),
        name = COALESCE(${updates.name ?? null}, name),
        pixel_id = COALESCE(${updates.pixelId ?? null}, pixel_id),
        enabled = COALESCE(${updates.enabled ?? null}, enabled),
        events = CASE WHEN ${updates.events !== undefined} THEN ${JSON.stringify(updates.events ?? {})}::jsonb ELSE events END,
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(updates)}::jsonb,
        updated_at = ${now}
      WHERE id = ${pixelId} AND product_id = ${productId}
    `;
    return this.getProductPixel(pixelId, productId);
  }

  async deleteProductPixel(pixelId: string, productId: string): Promise<void> {
    await this.sql`DELETE FROM product_pixels WHERE id = ${pixelId} AND product_id = ${productId}`;
  }

  private _productPixelRow(r: any): any {
    if (!r) return null;
    return { id: r.id, productId: r.product_id, tenantId: r.tenant_id, platform: r.platform, name: r.name, pixelId: r.pixel_id, enabled: r.enabled, events: r.events, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), ...(r.metadata || {}) };
  }

  // ── Customer profiles ──────────────────────────────────────────────────────

  async createCustomerProfile(profile: InsertCustomerProfile): Promise<CustomerProfile> {
    const sql = this.sql;
    const now = new Date();
    const p = profile as any;
    const id = p.id || `cust_${nanoid(21)}`;
    const { firebaseUid, email, name, phone, document, address, createdAt, updatedAt, id: _id, ...extra } = p;
    await sql`
      INSERT INTO customer_profiles (id, firebase_uid, email, name, phone, document, address, metadata, created_at, updated_at)
      VALUES (${id}, ${firebaseUid ?? null}, ${email ?? null}, ${name ?? null}, ${phone ?? null}, ${document ?? null}, ${JSON.stringify(address ?? {})}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, document = EXCLUDED.document, address = EXCLUDED.address, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM customer_profiles WHERE id = ${id} LIMIT 1`;
    return rowToCustomerProfile(rows[0]);
  }

  async getCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
    const rows = await this.sql`SELECT * FROM customer_profiles WHERE id = ${customerId} LIMIT 1`;
    if (!rows.length) return null;
    return rowToCustomerProfile(rows[0]);
  }

  async getCustomerProfileByEmail(email: string): Promise<CustomerProfile | null> {
    const rows = await this.sql`SELECT * FROM customer_profiles WHERE email = ${email} LIMIT 1`;
    if (!rows.length) return null;
    return rowToCustomerProfile(rows[0]);
  }

  async getCustomerProfileByFirebaseUid(firebaseUid: string): Promise<CustomerProfile | null> {
    const rows = await this.sql`SELECT * FROM customer_profiles WHERE firebase_uid = ${firebaseUid} LIMIT 1`;
    if (!rows.length) return null;
    return rowToCustomerProfile(rows[0]);
  }

  async updateCustomerProfile(customerId: string, updates: UpdateCustomerProfile): Promise<CustomerProfile> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    const { firebaseUid, email, name, phone, document, address, id: _id, ...extra } = u;
    await sql`
      UPDATE customer_profiles SET
        firebase_uid = COALESCE(${firebaseUid ?? null}, firebase_uid),
        email = COALESCE(${email ?? null}, email),
        name = COALESCE(${name ?? null}, name),
        phone = COALESCE(${phone ?? null}, phone),
        document = COALESCE(${document ?? null}, document),
        address = CASE WHEN ${address !== undefined} THEN ${JSON.stringify(address ?? {})}::jsonb ELSE address END,
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(extra)}::jsonb,
        updated_at = ${now}
      WHERE id = ${customerId}
    `;
    const result = await this.getCustomerProfile(customerId);
    if (!result) throw new Error(`CustomerProfile ${customerId} não encontrado`);
    return result;
  }

  async linkFirebaseUidToCustomer(customerId: string, firebaseUid: string): Promise<CustomerProfile> {
    return this.updateCustomerProfile(customerId, { firebaseUid } as any);
  }

  // ── Member entitlements ────────────────────────────────────────────────────

  async createMemberEntitlement(entitlement: InsertMemberEntitlement): Promise<MemberEntitlement> {
    const sql = this.sql;
    const now = new Date();
    const e = entitlement as any;
    const id = e.id || `ent_${nanoid(21)}`;
    const { customerId, orderId, productId, tenantId, status, accessType, accessStartDate,
      accessEndDate, expiresAt, createdAt, updatedAt, id: _id, ...extra } = e;
    await sql`
      INSERT INTO member_entitlements (id, customer_id, order_id, product_id, tenant_id, status, access_type, access_start_date, access_end_date, expires_at, metadata, created_at, updated_at)
      VALUES (${id}, ${customerId ?? null}, ${orderId ?? null}, ${productId ?? null}, ${tenantId ?? null}, ${status ?? 'active'}, ${accessType ?? null}, ${accessStartDate ?? now}, ${accessEndDate ?? null}, ${expiresAt ?? null}, ${JSON.stringify(extra)}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, access_end_date = EXCLUDED.access_end_date, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
    `;
    const rows = await sql`SELECT * FROM member_entitlements WHERE id = ${id} LIMIT 1`;
    return rowToMemberEntitlement(rows[0]);
  }

  async getMemberEntitlement(entitlementId: string): Promise<MemberEntitlement | null> {
    const rows = await this.sql`SELECT * FROM member_entitlements WHERE id = ${entitlementId} LIMIT 1`;
    if (!rows.length) return null;
    return rowToMemberEntitlement(rows[0]);
  }

  async getMemberEntitlementsByCustomer(customerId: string, options?: { activeOnly?: boolean }): Promise<MemberEntitlement[]> {
    const sql = this.sql;
    const rows = options?.activeOnly
      ? await sql`SELECT * FROM member_entitlements WHERE customer_id = ${customerId} AND status = 'active' ORDER BY created_at DESC`
      : await sql`SELECT * FROM member_entitlements WHERE customer_id = ${customerId} ORDER BY created_at DESC`;
    return rows.map(rowToMemberEntitlement);
  }

  async getMemberEntitlementByOrder(orderId: string): Promise<MemberEntitlement | null> {
    const rows = await this.sql`SELECT * FROM member_entitlements WHERE order_id = ${orderId} LIMIT 1`;
    if (!rows.length) return null;
    return rowToMemberEntitlement(rows[0]);
  }

  async updateMemberEntitlement(entitlementId: string, updates: UpdateMemberEntitlement): Promise<MemberEntitlement> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    await sql`
      UPDATE member_entitlements SET
        status = COALESCE(${u.status ?? null}, status),
        access_type = COALESCE(${u.accessType ?? null}, access_type),
        access_start_date = COALESCE(${u.accessStartDate ?? null}, access_start_date),
        access_end_date = COALESCE(${u.accessEndDate ?? null}, access_end_date),
        expires_at = COALESCE(${u.expiresAt ?? null}, expires_at),
        revoked_at = COALESCE(${u.revokedAt ?? u.cancelledAt ?? null}, revoked_at),
        revoke_reason = COALESCE(${u.revokeReason ?? u.cancelReason ?? null}, revoke_reason),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(u)}::jsonb,
        updated_at = ${now}
      WHERE id = ${entitlementId}
    `;
    const result = await this.getMemberEntitlement(entitlementId);
    if (!result) throw new Error(`MemberEntitlement ${entitlementId} não encontrado`);
    return result;
  }

  async revokeMemberEntitlement(entitlementId: string, reason: string): Promise<MemberEntitlement> {
    const now = new Date();
    return this.updateMemberEntitlement(entitlementId, { status: 'cancelled', cancelledAt: now, cancelReason: reason } as any);
  }

  async recordEntitlementAccess(entitlementId: string): Promise<void> {
    await this.sql`UPDATE member_entitlements SET access_count = COALESCE(access_count, 0) + 1, last_accessed_at = NOW(), updated_at = NOW() WHERE id = ${entitlementId}`;
  }

  async recordEntitlementDenial(entitlementId: string): Promise<void> {
    await this.sql`UPDATE member_entitlements SET denial_count = COALESCE(denial_count, 0) + 1, updated_at = NOW() WHERE id = ${entitlementId}`;
  }

  // ── Refund requests ────────────────────────────────────────────────────────

  async createRefundRequest(request: InsertRefundRequest): Promise<RefundRequest> {
    const sql = this.sql;
    const now = new Date();
    const r = request as any;
    let id = `ref_${nanoid(21)}`;
    const { sellerId, customerId, orderId, tenantId, amount, currency, reason, status,
      isPartialRefund, createdAt, updatedAt, id: _id, ...extra } = r;
    await sql`
      INSERT INTO refund_requests (id, seller_id, customer_id, order_id, tenant_id, amount, currency, reason, status, metadata, created_at, updated_at)
      VALUES (${id}, ${sellerId ?? null}, ${customerId ?? null}, ${orderId ?? null}, ${tenantId ?? null}, ${amount ?? 0}, ${currency ?? 'BRL'}, ${reason ?? null}, ${status ?? 'pending'}, ${JSON.stringify({ isPartialRefund: isPartialRefund ?? false, ...extra })}, ${createdAt ?? now}, ${updatedAt ?? now})
      ON CONFLICT (id) DO NOTHING
    `;
    const rows = await sql`SELECT * FROM refund_requests WHERE id = ${id} LIMIT 1`;
    return rowToRefundRequest(rows[0]);
  }

  async getRefundRequest(requestId: string): Promise<RefundRequest | null> {
    const rows = await this.sql`SELECT * FROM refund_requests WHERE id = ${requestId} LIMIT 1`;
    if (!rows.length) return null;
    return rowToRefundRequest(rows[0]);
  }

  async getRefundRequestsByCustomer(customerId: string): Promise<RefundRequest[]> {
    const rows = await this.sql`SELECT * FROM refund_requests WHERE customer_id = ${customerId} ORDER BY created_at DESC`;
    return rows.map(rowToRefundRequest);
  }

  async getRefundRequestsBySeller(sellerId: string, options?: { statusFilter?: string }): Promise<RefundRequest[]> {
    const sql = this.sql;
    const rows = options?.statusFilter
      ? await sql`SELECT * FROM refund_requests WHERE seller_id = ${sellerId} AND status = ${options.statusFilter} ORDER BY created_at DESC`
      : await sql`SELECT * FROM refund_requests WHERE seller_id = ${sellerId} ORDER BY created_at DESC`;
    return rows.map(rowToRefundRequest);
  }

  async getAllRefundRequests(options?: { statusFilter?: string; limit?: number }): Promise<RefundRequest[]> {
    const sql = this.sql;
    const lim = options?.limit || 500;
    const rows = options?.statusFilter
      ? await sql`SELECT * FROM refund_requests WHERE status = ${options.statusFilter} ORDER BY created_at DESC LIMIT ${lim}`
      : await sql`SELECT * FROM refund_requests ORDER BY created_at DESC LIMIT ${lim}`;
    return rows.map(rowToRefundRequest);
  }

  async updateRefundRequest(requestId: string, updates: UpdateRefundRequest): Promise<RefundRequest> {
    const sql = this.sql;
    const now = new Date();
    const u = updates as any;
    await sql`
      UPDATE refund_requests SET
        status = COALESCE(${u.status ?? null}, status),
        processed_by = COALESCE(${u.processedBy ?? null}, processed_by),
        processed_by_name = COALESCE(${u.processedByName ?? null}, processed_by_name),
        processed_at = COALESCE(${u.processedAt ?? null}, processed_at),
        denial_reason = COALESCE(${u.denialReason ?? null}, denial_reason),
        refunded_amount = COALESCE(${u.refundedAmount ?? null}, refunded_amount),
        refund_method = COALESCE(${u.refundMethod ?? null}, refund_method),
        refund_transaction_id = COALESCE(${u.refundTransactionId ?? null}, refund_transaction_id),
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(u)}::jsonb,
        updated_at = ${now}
      WHERE id = ${requestId}
    `;
    const result = await this.getRefundRequest(requestId);
    if (!result) throw new Error(`RefundRequest ${requestId} não encontrado`);
    return result;
  }

  async approveRefundRequest(requestId: string, processedBy: string, processedByName: string): Promise<RefundRequest> {
    return this.updateRefundRequest(requestId, { status: 'approved', processedBy, processedByName, processedAt: new Date() } as any);
  }

  async denyRefundRequest(requestId: string, processedBy: string, processedByName: string, denialReason: string): Promise<RefundRequest> {
    return this.updateRefundRequest(requestId, { status: 'denied', processedBy, processedByName, processedAt: new Date(), denialReason } as any);
  }

  async markRefundAsCompleted(requestId: string, refundData: { refundedAmount: number; refundMethod: string; refundTransactionId?: string }): Promise<RefundRequest> {
    return this.updateRefundRequest(requestId, { status: 'completed', refundedAmount: refundData.refundedAmount, refundMethod: refundData.refundMethod, refundTransactionId: refundData.refundTransactionId } as any);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  async countOrdersByCheckout(checkoutId: string): Promise<number> {
    const rows = await this.sql`SELECT COUNT(*) AS cnt FROM orders WHERE checkout_id = ${checkoutId}`;
    return parseInt(rows[0]?.cnt || '0', 10);
  }

  async listProductsByTenant(tenantId: string): Promise<Product[]> {
    return this.getProductsByTenant(tenantId);
  }

  // ── Cron job methods — delegate to Firestore (subscriptions still on Firebase) ──

  async processExpiredSubscriptions(): Promise<number> {
    try {
      const { getAdmin, ensureFirebaseReady } = await import('./firebase-admin.js');
      await ensureFirebaseReady();
      const db = getAdmin().firestore();

      const now = new Date();
      let processedCount = 0;
      const snapshot = await db.collection('subscriptions').where('status', '==', 'active').get();
      console.log(`📊 [NeonStorage] ${snapshot.size} subscriptions ativas para verificar`);

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const nbDate: any = data?.nextBillingDate;
        let nextBillingDate: Date;
        if (nbDate?.toDate) nextBillingDate = nbDate.toDate();
        else if (nbDate?._seconds) nextBillingDate = new Date(nbDate._seconds * 1000);
        else if (nbDate?.seconds) nextBillingDate = new Date(nbDate.seconds * 1000);
        else nextBillingDate = new Date(nbDate);

        if (nextBillingDate <= now && data.autoRenew !== true) {
          await docSnap.ref.update({ status: 'expired', updatedAt: new Date() });
          processedCount++;
          console.log(`⏰ [NeonStorage] Subscription expirada: ${docSnap.id}`);
        }
      }

      console.log(`✅ [NeonStorage] processExpiredSubscriptions: ${processedCount} processadas`);
      return processedCount;
    } catch (error: any) {
      console.error('[NeonStorage] processExpiredSubscriptions error:', error?.message || String(error));
      return 0;
    }
  }

  async processDunningRetries(): Promise<number> {
    try {
      const { getAdmin, ensureFirebaseReady } = await import('./firebase-admin.js');
      await ensureFirebaseReady();
      const db = getAdmin().firestore();

      const now = new Date();
      let processed = 0;
      const snapshot = await db.collection('subscriptions').where('status', '==', 'past_due').get();
      console.log(`💳 [NeonStorage] ${snapshot.size} subscriptions past_due para dunning`);

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const nr: any = data.nextRetryDate;
        let nextRetry: Date;
        if (nr?.toDate) nextRetry = nr.toDate();
        else if (nr?._seconds) nextRetry = new Date(nr._seconds * 1000);
        else nextRetry = new Date(nr);

        if (nextRetry > now) continue;

        const attempts = (data.dunningAttempts || 0) + 1;
        const MAX_ATTEMPTS = 3;

        if (attempts >= MAX_ATTEMPTS) {
          await docSnap.ref.update({ status: 'cancelled', cancelledReason: 'dunning_failed', updatedAt: new Date() });
          console.log(`❌ [NeonStorage] Dunning cancelado após ${MAX_ATTEMPTS} tentativas: ${docSnap.id}`);
        } else {
          const nextRetryDate = new Date(now.getTime() + attempts * 2 * 24 * 60 * 60 * 1000);
          await docSnap.ref.update({ dunningAttempts: attempts, nextRetryDate, updatedAt: new Date() });
          console.log(`⚠️ [NeonStorage] Dunning tentativa ${attempts}: ${docSnap.id}`);
        }
        processed++;
      }

      console.log(`✅ [NeonStorage] processDunningRetries: ${processed} processadas`);
      return processed;
    } catch (error: any) {
      console.error('[NeonStorage] processDunningRetries error:', error?.message || String(error));
      return 0;
    }
  }
}
