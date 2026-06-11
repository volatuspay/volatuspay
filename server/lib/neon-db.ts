/**
 * 🐘 NEON PostgreSQL — cliente singleton para o servidor
 * Usa @neondatabase/serverless (já instalado)
 * Dual-write: escreve em Firebase + Neon em paralelo durante migração
 */

import { neon, neonConfig } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;

export function getNeonSql() {
  if (!_sql) {
    const url = process.env.NEON_DATABASE_URL;
    if (!url) {
      throw new Error('NEON_DATABASE_URL não configurado');
    }
    neonConfig.fetchConnectionCache = true;
    _sql = neon(url);
  }
  return _sql;
}

/**
 * Executa uma query no Neon de forma segura (fire-and-forget ou awaited).
 * Nunca lança exceção — erros são logados mas não quebram o fluxo principal.
 */
export async function neonQuery(
  fn: (sql: ReturnType<typeof neon>) => Promise<any>,
  label = 'neon-query'
): Promise<any> {
  try {
    const sql = getNeonSql();
    return await fn(sql);
  } catch (err: any) {
    console.error(`❌ [NEON] ${label} falhou:`, err?.message || err);
    return null;
  }
}

/**
 * Garante que as tabelas de segurança existem no Neon.
 * Roda na inicialização do servidor.
 */
export async function ensureNeonSecurityTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS security_logs (
        id TEXT PRIMARY KEY,
        ip_address TEXT,
        threat_category TEXT NOT NULL,
        severity TEXT NOT NULL,
        endpoint TEXT,
        user_agent TEXT,
        risk_score INTEGER DEFAULT 0,
        action_taken TEXT,
        evidence TEXT,
        blocked BOOLEAN DEFAULT FALSE,
        count INTEGER DEFAULT 1,
        first_detected_at TIMESTAMPTZ,
        last_detected_at TIMESTAMPTZ,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS blocked_ips (
        id TEXT PRIMARY KEY,
        ip_address TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        blocked_by TEXT NOT NULL DEFAULT 'system',
        admin_name TEXT,
        attacks_blocked INTEGER DEFAULT 0,
        total_attempts INTEGER DEFAULT 1,
        threat_categories TEXT[] DEFAULT '{}',
        risk_score INTEGER DEFAULT 50,
        country TEXT,
        city TEXT,
        isp TEXT,
        is_proxy BOOLEAN DEFAULT FALSE,
        is_vpn BOOLEAN DEFAULT FALSE,
        is_tor BOOLEAN DEFAULT FALSE,
        last_attempt_at TIMESTAMPTZ,
        unlocked_at TIMESTAMPTZ,
        unblock_reason TEXT,
        unlocked_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS ip_blacklist (
        ip TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        attempts INTEGER DEFAULT 1,
        blocked_endpoints TEXT[] DEFAULT '{}',
        user_agent TEXT,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    console.log('✅ [NEON] Tabelas de segurança verificadas/criadas');
  }, 'ensureNeonSecurityTables');
}

/**
 * Garante que as tabelas financeiras existem no Neon.
 */
export async function ensureNeonFinancialTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        checkout_id TEXT,
        product_id TEXT,
        tenant_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        status TEXT NOT NULL,
        method TEXT NOT NULL,
        payment_method TEXT,
        payment_processor TEXT,
        amount INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'BRL',
        installments INTEGER DEFAULT 1,
        product_type TEXT,
        market_target TEXT,
        subscription_period TEXT,
        efi_charge_id TEXT,
        efi_txid TEXT,
        efi_status TEXT,
        card_mask TEXT,
        offer_slug TEXT,
        offer_title TEXT,
        coupon_code TEXT,
        affiliate_uid TEXT,
        gateway_fee INTEGER DEFAULT 0,
        gateway_fee_percent NUMERIC(6,4) DEFAULT 0,
        platform_fee INTEGER DEFAULT 0,
        platform_fee_percent NUMERIC(6,4) DEFAULT 0,
        net_amount INTEGER DEFAULT 0,
        customer JSONB,
        customer_address JSONB,
        checkout_snapshot JSONB,
        financial_data JSONB,
        financial JSONB,
        tracking_parameters JSONB,
        selected_order_bumps JSONB,
        order_bumps JSONB,
        metadata JSONB,
        paid_at TIMESTAMPTZ,
        refunded_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS orders_seller_id_idx   ON orders(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS orders_tenant_id_idx   ON orders(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS orders_status_idx      ON orders(status)`;
    await sql`CREATE INDEX IF NOT EXISTS orders_created_at_idx  ON orders(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS orders_checkout_id_idx ON orders(checkout_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS seller_balances (
        seller_id TEXT PRIMARY KEY,
        total_balance INTEGER NOT NULL DEFAULT 0,
        available_balance INTEGER NOT NULL DEFAULT 0,
        pending_balance INTEGER NOT NULL DEFAULT 0,
        reserved_balance INTEGER NOT NULL DEFAULT 0,
        balance_available_brl INTEGER NOT NULL DEFAULT 0,
        balance_pending_brl INTEGER NOT NULL DEFAULT 0,
        balance_reserved_brl INTEGER NOT NULL DEFAULT 0,
        lifetime_revenue_brl INTEGER NOT NULL DEFAULT 0,
        balance_available_usd INTEGER NOT NULL DEFAULT 0,
        balance_pending_usd INTEGER NOT NULL DEFAULT 0,
        balance_reserved_usd INTEGER NOT NULL DEFAULT 0,
        lifetime_revenue_usd INTEGER NOT NULL DEFAULT 0,
        balance_available_eur INTEGER NOT NULL DEFAULT 0,
        balance_pending_eur INTEGER NOT NULL DEFAULT 0,
        balance_reserved_eur INTEGER NOT NULL DEFAULT 0,
        lifetime_revenue_eur INTEGER NOT NULL DEFAULT 0,
        total_withdrawn_brl INTEGER NOT NULL DEFAULT 0,
        total_withdrawn_usd INTEGER NOT NULL DEFAULT 0,
        total_withdrawn_eur INTEGER NOT NULL DEFAULT 0,
        by_method JSONB,
        balances_detail JSONB,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS balance_movements (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        seller_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'BRL',
        balance_type TEXT NOT NULL,
        operation TEXT NOT NULL,
        reason TEXT NOT NULL,
        order_id TEXT,
        subscription_id TEXT,
        webhook_id TEXT,
        provider TEXT,
        event_type TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS bm_seller_id_idx   ON balance_movements(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS bm_order_id_idx    ON balance_movements(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS bm_created_at_idx  ON balance_movements(created_at DESC)`;

    console.log('✅ [NEON] Tabelas financeiras verificadas/criadas');
  }, 'ensureNeonFinancialTables');
}

/**
 * Garante que as tabelas de saques e comissões existem no Neon.
 */
export async function ensureNeonWithdrawalTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        tenant_id TEXT,
        user_type TEXT DEFAULT 'seller',
        amount INTEGER NOT NULL DEFAULT 0,
        fee INTEGER DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'BRL',
        status TEXT NOT NULL DEFAULT 'pending',
        breakdown JSONB,
        pix_key TEXT,
        pix_key_type TEXT,
        holder_name TEXT,
        holder_email TEXT,
        holder_document TEXT,
        approved_by TEXT,
        approved_by_email TEXT,
        rejected_by TEXT,
        rejected_by_email TEXT,
        rejection_reason TEXT,
        metadata JSONB,
        requested_at TIMESTAMPTZ,
        approved_at TIMESTAMPTZ,
        processing_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS withdrawals_seller_id_idx  ON withdrawals(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS withdrawals_status_idx     ON withdrawals(status)`;
    await sql`CREATE INDEX IF NOT EXISTS withdrawals_created_at_idx ON withdrawals(created_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_commissions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        affiliate_id TEXT NOT NULL,
        affiliate_code TEXT,
        affiliate_name TEXT,
        affiliate_email TEXT,
        order_id TEXT,
        checkout_id TEXT,
        product_id TEXT,
        product_name TEXT,
        product_type TEXT,
        customer_email TEXT,
        customer_name TEXT,
        order_amount INTEGER DEFAULT 0,
        commission_percent NUMERIC(6,4) DEFAULT 0,
        amount INTEGER DEFAULT 0,
        gross_amount INTEGER DEFAULT 0,
        admin_fee INTEGER DEFAULT 0,
        net_amount INTEGER DEFAULT 0,
        admin_fee_percent NUMERIC(6,4) DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT,
        balance_credited BOOLEAN DEFAULT FALSE,
        release_date TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS ac_affiliate_id_idx ON affiliate_commissions(affiliate_id)`;
    await sql`CREATE INDEX IF NOT EXISTS ac_order_id_idx     ON affiliate_commissions(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS ac_tenant_id_idx    ON affiliate_commissions(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS ac_status_idx       ON affiliate_commissions(status)`;

    console.log('✅ [NEON] Tabelas de saques/comissões verificadas/criadas');
  }, 'ensureNeonWithdrawalTables');
}

/**
 * Garante que as tabelas de produtos, checkouts e cupons existem no Neon.
 */
export async function ensureNeonProductTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id                     TEXT PRIMARY KEY,
        tenant_id              TEXT,
        title                  TEXT,
        name                   TEXT,
        description            TEXT,
        product_type           TEXT NOT NULL DEFAULT 'digital',
        type                   TEXT,
        image_url              TEXT,
        price                  INTEGER,
        currency               TEXT,
        category               TEXT,
        active                 BOOLEAN NOT NULL DEFAULT TRUE,
        access_duration        INTEGER,
        notify_expiration_days TEXT,
        has_access             BOOLEAN DEFAULT FALSE,
        checkout_id            TEXT,
        deleted                BOOLEAN NOT NULL DEFAULT FALSE,
        metadata               JSONB,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS products_tenant_id_idx  ON products(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS products_type_idx        ON products(product_type)`;
    await sql`CREATE INDEX IF NOT EXISTS products_deleted_idx     ON products(deleted)`;

    await sql`
      CREATE TABLE IF NOT EXISTS checkouts (
        id               TEXT PRIMARY KEY,
        tenant_id        TEXT,
        slug             TEXT,
        title            TEXT,
        subtitle         TEXT,
        logo_url         TEXT,
        product_type     TEXT NOT NULL DEFAULT 'digital',
        currency         TEXT NOT NULL DEFAULT 'BRL',
        active           BOOLEAN NOT NULL DEFAULT TRUE,
        test_mode        BOOLEAN NOT NULL DEFAULT FALSE,
        product_id       TEXT,
        synced_product_id TEXT,
        sales_count      INTEGER NOT NULL DEFAULT 0,
        pricing          JSONB,
        methods          JSONB,
        theme            JSONB,
        affiliate        JSONB,
        global_settings  JSONB,
        fields           JSONB,
        metadata         JSONB,
        showcase         JSONB,
        config           JSONB,
        deleted          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS checkouts_tenant_id_idx       ON checkouts(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS checkouts_product_id_idx      ON checkouts(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS checkouts_synced_product_idx  ON checkouts(synced_product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS checkouts_slug_idx            ON checkouts(slug)`;
    await sql`CREATE INDEX IF NOT EXISTS checkouts_deleted_idx         ON checkouts(deleted)`;

    await sql`
      CREATE TABLE IF NOT EXISTS coupons (
        id             TEXT PRIMARY KEY,
        tenant_id      TEXT,
        product_id     TEXT,
        checkout_id    TEXT,
        code           TEXT,
        discount_type  TEXT NOT NULL DEFAULT 'percent',
        discount_value NUMERIC(10,4) NOT NULL DEFAULT 0,
        max_uses       INTEGER,
        used_count     INTEGER NOT NULL DEFAULT 0,
        valid_from     TIMESTAMPTZ,
        valid_until    TIMESTAMPTZ,
        active         BOOLEAN NOT NULL DEFAULT TRUE,
        metadata       JSONB,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS coupons_tenant_id_idx  ON coupons(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS coupons_product_id_idx ON coupons(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS coupons_code_idx       ON coupons(code)`;

    console.log('✅ [NEON] Tabelas de produtos/checkouts/cupons verificadas/criadas');
  }, 'ensureNeonProductTables');
}

/**
 * Garante que as tabelas de afiliados existem no Neon.
 */
export async function ensureNeonAffiliateTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS affiliations (
        id                  TEXT PRIMARY KEY,
        affiliate_id        TEXT,
        affiliate_name      TEXT,
        affiliate_email     TEXT,
        product_id          TEXT,
        product_name        TEXT,
        seller_id           TEXT,
        seller_name         TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        affiliate_code      TEXT,
        affiliate_link      TEXT,
        commission_snapshot JSONB,
        total_sales         INTEGER NOT NULL DEFAULT 0,
        total_earnings      INTEGER NOT NULL DEFAULT 0,
        approved_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS affiliations_affiliate_id_idx ON affiliations(affiliate_id)`;
    await sql`CREATE INDEX IF NOT EXISTS affiliations_product_id_idx   ON affiliations(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS affiliations_seller_id_idx    ON affiliations(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS affiliations_status_idx       ON affiliations(status)`;

    await sql`
      CREATE TABLE IF NOT EXISTS affiliates (
        id                TEXT PRIMARY KEY,
        user_id           TEXT,
        checkout_id       TEXT,
        seller_id         TEXT,
        name              TEXT,
        email             TEXT,
        document          TEXT,
        phone             TEXT,
        pix_key           TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        custom_commission NUMERIC(6,4) NOT NULL DEFAULT 10,
        affiliate_link    TEXT,
        affiliate_slug    TEXT,
        affiliate_code    TEXT,
        total_clicks      INTEGER NOT NULL DEFAULT 0,
        total_sales       INTEGER NOT NULL DEFAULT 0,
        total_commissions INTEGER NOT NULL DEFAULT 0,
        approved_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS affiliates_user_id_idx     ON affiliates(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS affiliates_checkout_id_idx ON affiliates(checkout_id)`;
    await sql`CREATE INDEX IF NOT EXISTS affiliates_seller_id_idx   ON affiliates(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS affiliates_status_idx      ON affiliates(status)`;
    await sql`CREATE INDEX IF NOT EXISTS affiliates_code_idx        ON affiliates(affiliate_code)`;

    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_balances (
        user_id                  TEXT PRIMARY KEY,
        balance_available_brl    INTEGER NOT NULL DEFAULT 0,
        balance_pending_brl      INTEGER NOT NULL DEFAULT 0,
        balance_reserved_brl     INTEGER NOT NULL DEFAULT 0,
        lifetime_commissions_brl INTEGER NOT NULL DEFAULT 0,
        total_withdrawn_brl      INTEGER NOT NULL DEFAULT 0,
        total_sales              INTEGER NOT NULL DEFAULT 0,
        total_commissions        INTEGER NOT NULL DEFAULT 0,
        pending_commissions      INTEGER NOT NULL DEFAULT 0,
        approved_commissions     INTEGER NOT NULL DEFAULT 0,
        last_commission_date     TIMESTAMPTZ,
        first_commission_date    TIMESTAMPTZ,
        last_withdrawal          TIMESTAMPTZ,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS affiliate_clicks (
        id           TEXT PRIMARY KEY,
        affiliate_id TEXT,
        checkout_id  TEXT,
        seller_id    TEXT,
        ip_address   TEXT,
        user_agent   TEXT,
        referrer     TEXT,
        converted    BOOLEAN NOT NULL DEFAULT FALSE,
        clicked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS aff_clicks_affiliate_id_idx ON affiliate_clicks(affiliate_id)`;
    await sql`CREATE INDEX IF NOT EXISTS aff_clicks_checkout_id_idx  ON affiliate_clicks(checkout_id)`;
    await sql`CREATE INDEX IF NOT EXISTS aff_clicks_clicked_at_idx   ON affiliate_clicks(clicked_at DESC)`;

    console.log('✅ [NEON] Tabelas de afiliados verificadas/criadas');
  }, 'ensureNeonAffiliateTables');
}

/**
 * Garante que as tabelas de sellers/users existem no Neon.
 */
export async function ensureNeonSellerTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS sellers (
        id                       TEXT PRIMARY KEY,
        tenant_id                TEXT,
        email                    TEXT,
        name                     TEXT,
        business_name            TEXT,
        status                   TEXT NOT NULL DEFAULT 'pending',
        phone                    TEXT,
        document                 TEXT,
        personal_document_number TEXT,
        support_email            TEXT,
        plan                     TEXT,
        profile_complete         BOOLEAN NOT NULL DEFAULT FALSE,
        approved_at              TIMESTAMPTZ,
        approved_by              TEXT,
        blocked_at               TIMESTAMPTZ,
        blocked_by               TEXT,
        acquirers                JSONB,
        banking_data             JSONB,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sellers_email_idx    ON sellers(email)`;
    await sql`CREATE INDEX IF NOT EXISTS sellers_status_idx   ON sellers(status)`;
    await sql`CREATE INDEX IF NOT EXISTS sellers_tenant_id_idx ON sellers(tenant_id)`;

    // ── Extra columns added progressively ──────────────────────────────────
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS name                     TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS business_name            TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS profile_complete         BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS is_approved              BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS is_blocked               BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS blocked_reason           TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS rejection_reason         TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS rejected_at              TIMESTAMPTZ`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS facial_verification      TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS documents_urls           JSONB`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS profile_photo            TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS photo_url                TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS birth_date               TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS personal_document_type   TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS company_name             TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS business_niche           TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS product_type             TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS products_description     TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS address                  JSONB`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_pix_fixed_fee          NUMERIC`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_pix_percent_fee        NUMERIC`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_card_fixed_fee         NUMERIC`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_card_percent_fee       NUMERIC`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_stripe_fixed_fee       NUMERIC`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_stripe_percent_fee     NUMERIC`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_card_withdrawal_days   INTEGER`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_stripe_withdrawal_days INTEGER`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS device_fingerprint        JSONB`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS registration_ip           TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS accepted_data_tracking    BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS data_tracking_consent_date      TIMESTAMPTZ`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS data_tracking_consent_version   TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS device_history            JSONB`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS accepted_terms            BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS terms_accepted_at         TIMESTAMPTZ`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS acquirer_config           JSONB`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS document_type             TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS initial_api_key           TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS initial_api_key_id        TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS has_api_key               BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS webhook_url               TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS webhook_enabled           BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS webhook_updated_at        TIMESTAMPTZ`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS last_webhook_test         JSONB`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS custom_withdrawal_fee_fixed NUMERIC`;
    // ── EFibank Marketplace / Split ──────────────────────────────────────────
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS efi_account_id           TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS efi_account_status        TEXT`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS efi_account_created_at    TIMESTAMPTZ`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS efi_split_enabled         BOOLEAN   DEFAULT FALSE`;
    await sql`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS efi_pix_key               TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS sellers_efi_account_id_idx ON sellers(efi_account_id)`;

    // ── Tenants table (created on seller approval) ──────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS tenants (
        id         TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS tenants_owner_id_idx ON tenants(owner_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        email       TEXT,
        webhook_url TEXT,
        settings    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS users_email_idx ON users(email)`;

    console.log('✅ [NEON] Tabelas de sellers/users verificadas/criadas');
  }, 'ensureNeonSellerTables');
}

/**
 * Garante que as tabelas de paymentConfig e apiKeys existem no Neon.
 */
export async function ensureNeonPaymentTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS payment_config (
        id                TEXT PRIMARY KEY,
        seller_id         TEXT,
        default_acquirers JSONB,
        fees              JSONB,
        config            JSONB,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS payment_config_seller_idx ON payment_config(seller_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id             TEXT PRIMARY KEY,
        seller_id      TEXT NOT NULL,
        name           TEXT NOT NULL,
        permissions    JSONB NOT NULL DEFAULT '[]',
        key_hash       TEXT NOT NULL,
        last4          TEXT,
        active         BOOLEAN NOT NULL DEFAULT TRUE,
        auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
        usage_count    INTEGER NOT NULL DEFAULT 0,
        last_used_at   TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS api_keys_seller_idx  ON api_keys(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS api_keys_active_idx  ON api_keys(active)`;
    await sql`CREATE INDEX IF NOT EXISTS api_keys_hash_idx    ON api_keys(key_hash)`;

    console.log('✅ [NEON] Tabelas de paymentConfig/apiKeys verificadas/criadas');
  }, 'ensureNeonPaymentTables');
}

/**
 * Garante que as tabelas de webhookLogs, fraudAlerts e subscriptions existem no Neon.
 */
export async function ensureNeonSubscriptionTables(): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id              TEXT PRIMARY KEY,
        tenant_id       TEXT,
        event           TEXT,
        webhook_url     TEXT,
        payload         JSONB,
        response        JSONB,
        response_status INTEGER,
        success         BOOLEAN NOT NULL DEFAULT FALSE,
        attempts        INTEGER NOT NULL DEFAULT 0,
        error           TEXT,
        sent_at         TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS wh_logs_tenant_idx  ON webhook_logs(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS wh_logs_event_idx   ON webhook_logs(event)`;
    await sql`CREATE INDEX IF NOT EXISTS wh_logs_success_idx ON webhook_logs(success)`;
    await sql`CREATE INDEX IF NOT EXISTS wh_logs_sent_at_idx ON webhook_logs(sent_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS fraud_alerts (
        id                TEXT PRIMARY KEY,
        withdrawal_id     TEXT,
        seller_id         TEXT,
        risk_score        INTEGER,
        risk_level        TEXT,
        risk_factors      JSONB,
        ai_analysis       JSONB,
        context           JSONB,
        review_status     TEXT NOT NULL DEFAULT 'unreviewed',
        reviewed_by       TEXT,
        reviewed_by_email TEXT,
        reviewed_at       TIMESTAMPTZ,
        review_notes      TEXT,
        notification_sent BOOLEAN NOT NULL DEFAULT FALSE,
        detection_version TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS fraud_seller_idx        ON fraud_alerts(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS fraud_risk_level_idx    ON fraud_alerts(risk_level)`;
    await sql`CREATE INDEX IF NOT EXISTS fraud_review_status_idx ON fraud_alerts(review_status)`;

    await sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                   TEXT PRIMARY KEY,
        customer_id          TEXT,
        customer_name        TEXT,
        customer_email       TEXT,
        customer_phone       TEXT,
        customer_document    TEXT,
        tenant_id            TEXT,
        product_id           TEXT,
        product_name         TEXT,
        order_id             TEXT,
        status               TEXT NOT NULL DEFAULT 'active',
        billing_cycle        TEXT,
        period               TEXT,
        amount               INTEGER,
        currency             TEXT NOT NULL DEFAULT 'BRL',
        recurring_count      INTEGER NOT NULL DEFAULT 1,
        method               TEXT,
        auto_renew           BOOLEAN NOT NULL DEFAULT FALSE,
        dunning_attempts     INTEGER NOT NULL DEFAULT 0,
        next_billing_date    TIMESTAMPTZ,
        current_period_start TIMESTAMPTZ,
        current_period_end   TIMESTAMPTZ,
        activated_at         TIMESTAMPTZ,
        cancelled_at         TIMESTAMPTZ,
        last_renewal_date    TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sub_tenant_idx  ON subscriptions(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS sub_customer_idx ON subscriptions(customer_email)`;
    await sql`CREATE INDEX IF NOT EXISTS sub_status_idx  ON subscriptions(status)`;
    await sql`CREATE INDEX IF NOT EXISTS sub_product_idx ON subscriptions(product_id)`;

    console.log('✅ [NEON] Tabelas de webhook_logs/fraud_alerts/subscriptions verificadas/criadas');
  }, 'ensureNeonSubscriptionTables');
}

/**
 * Garante que as tabelas extras existem no Neon:
 * product_offers, modules, lessons, members, enrollments, progress,
 * banners, testimonials, checkout_pixels, product_pixels,
 * customer_profiles, member_entitlements, refund_requests.
 * Também adiciona colunas que faltam em subscriptions.
 */
export async function ensureNeonExtraTables(): Promise<void> {
  await neonQuery(async (sql) => {

    // ── subscriptions: colunas extras ──────────────────────────────────────
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS checkout_id TEXT`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_address JSONB`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_method TEXT`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMPTZ`;
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS metadata JSONB`;

    // ── checkouts: colunas extras ──────────────────────────────────────────
    await sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS metadata JSONB`;
    await sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS showcase  JSONB`;
    await sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS config    JSONB`;

    // ── products: colunas extras ───────────────────────────────────────────
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS name     TEXT`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS price    INTEGER`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS currency TEXT`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS type     TEXT`;

    // ── product_offers ──────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS product_offers (
        id             TEXT PRIMARY KEY,
        product_id     TEXT,
        tenant_id      TEXT,
        name           TEXT,
        slug           TEXT,
        price          INTEGER NOT NULL DEFAULT 0,
        original_price INTEGER,
        active         BOOLEAN NOT NULL DEFAULT TRUE,
        deleted        BOOLEAN NOT NULL DEFAULT FALSE,
        metadata       JSONB,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS po_product_id_idx ON product_offers(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS po_tenant_id_idx  ON product_offers(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS po_slug_idx        ON product_offers(slug)`;

    // ── modules ─────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS modules (
        id          TEXT PRIMARY KEY,
        product_id  TEXT,
        tenant_id   TEXT,
        title       TEXT,
        description TEXT,
        position    INTEGER NOT NULL DEFAULT 0,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS modules_product_id_idx ON modules(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS modules_tenant_id_idx  ON modules(tenant_id)`;

    // ── lessons ─────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS lessons (
        id               TEXT PRIMARY KEY,
        module_id        TEXT,
        product_id       TEXT,
        tenant_id        TEXT,
        title            TEXT,
        description      TEXT,
        content_url      TEXT,
        content_type     TEXT,
        position         INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER,
        active           BOOLEAN NOT NULL DEFAULT TRUE,
        free_preview     BOOLEAN NOT NULL DEFAULT FALSE,
        metadata         JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS lessons_module_id_idx  ON lessons(module_id)`;
    await sql`CREATE INDEX IF NOT EXISTS lessons_product_id_idx ON lessons(product_id)`;

    // ── members ─────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS members (
        id         TEXT PRIMARY KEY,
        user_id    TEXT,
        email      TEXT,
        name       TEXT,
        phone      TEXT,
        document   TEXT,
        avatar_url TEXT,
        metadata   JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS members_email_idx   ON members(email)`;
    await sql`CREATE INDEX IF NOT EXISTS members_user_id_idx ON members(user_id)`;

    // ── enrollments ─────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS enrollments (
        id              TEXT PRIMARY KEY,
        member_id       TEXT,
        product_id      TEXT,
        tenant_id       TEXT,
        order_id        TEXT,
        checkout_id     TEXT,
        status          TEXT NOT NULL DEFAULT 'active',
        enrolled_at     TIMESTAMPTZ,
        expires_at      TIMESTAMPTZ,
        access_duration INTEGER,
        metadata        JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS enrollments_member_id_idx  ON enrollments(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS enrollments_product_id_idx ON enrollments(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS enrollments_tenant_id_idx  ON enrollments(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS enrollments_status_idx     ON enrollments(status)`;

    // ── progress ────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS progress (
        id               TEXT PRIMARY KEY,
        member_id        TEXT,
        lesson_id        TEXT,
        product_id       TEXT,
        module_id        TEXT,
        tenant_id        TEXT,
        status           TEXT NOT NULL DEFAULT 'not_started',
        progress_percent INTEGER NOT NULL DEFAULT 0,
        completed_at     TIMESTAMPTZ,
        metadata         JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS progress_member_id_idx ON progress(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS progress_lesson_id_idx ON progress(lesson_id)`;

    // ── banners ─────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS banners (
        id           TEXT PRIMARY KEY,
        tenant_id    TEXT NOT NULL,
        title        TEXT,
        image_url    TEXT NOT NULL,
        link         TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        position     TEXT NOT NULL DEFAULT 'dashboard_top',
        priority     INTEGER NOT NULL DEFAULT 0,
        description  TEXT,
        target_blank BOOLEAN NOT NULL DEFAULT FALSE,
        start_date   TIMESTAMPTZ,
        end_date     TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS banners_tenant_id_idx ON banners(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS banners_position_idx  ON banners(position)`;
    await sql`CREATE INDEX IF NOT EXISTS banners_is_active_idx ON banners(is_active)`;

    // ── testimonials ────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS testimonials (
        id             TEXT PRIMARY KEY,
        checkout_id    TEXT,
        tenant_id      TEXT,
        customer_name  TEXT,
        customer_email TEXT,
        rating         INTEGER NOT NULL DEFAULT 5,
        comment        TEXT,
        approved       BOOLEAN NOT NULL DEFAULT FALSE,
        metadata       JSONB,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS testimonials_checkout_id_idx ON testimonials(checkout_id)`;
    await sql`CREATE INDEX IF NOT EXISTS testimonials_tenant_id_idx   ON testimonials(tenant_id)`;

    // ── checkout_pixels (managed pixels) ────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS checkout_pixels (
        id              TEXT PRIMARY KEY,
        checkout_id     TEXT,
        tenant_id       TEXT,
        platform        TEXT NOT NULL DEFAULT 'facebook',
        name            TEXT,
        pixel_id        TEXT,
        access_token    TEXT,
        measurement_id  TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        events          JSONB,
        is_legacy       BOOLEAN NOT NULL DEFAULT FALSE,
        metadata        JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS cp_checkout_id_idx ON checkout_pixels(checkout_id)`;
    await sql`CREATE INDEX IF NOT EXISTS cp_tenant_id_idx   ON checkout_pixels(tenant_id)`;

    // ── product_pixels ──────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS product_pixels (
        id         TEXT PRIMARY KEY,
        product_id TEXT,
        tenant_id  TEXT,
        platform   TEXT NOT NULL DEFAULT 'facebook',
        name       TEXT,
        pixel_id   TEXT,
        enabled    BOOLEAN NOT NULL DEFAULT TRUE,
        events     JSONB,
        metadata   JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS pp_product_id_idx ON product_pixels(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS pp_tenant_id_idx  ON product_pixels(tenant_id)`;

    // ── customer_profiles ───────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS customer_profiles (
        id           TEXT PRIMARY KEY,
        firebase_uid TEXT,
        email        TEXT,
        name         TEXT,
        phone        TEXT,
        document     TEXT,
        address      JSONB,
        metadata     JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS cprofiles_email_idx       ON customer_profiles(email)`;
    await sql`CREATE INDEX IF NOT EXISTS cprofiles_firebase_uid_idx ON customer_profiles(firebase_uid)`;

    // ── member_entitlements ─────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS member_entitlements (
        id               TEXT PRIMARY KEY,
        customer_id      TEXT,
        order_id         TEXT,
        product_id       TEXT,
        tenant_id        TEXT,
        status           TEXT NOT NULL DEFAULT 'active',
        access_type      TEXT,
        access_start_date TIMESTAMPTZ,
        access_end_date  TIMESTAMPTZ,
        expires_at       TIMESTAMPTZ,
        revoked_at       TIMESTAMPTZ,
        revoke_reason    TEXT,
        access_count     INTEGER NOT NULL DEFAULT 0,
        denial_count     INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TIMESTAMPTZ,
        metadata         JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS me_customer_id_idx ON member_entitlements(customer_id)`;
    await sql`CREATE INDEX IF NOT EXISTS me_order_id_idx    ON member_entitlements(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS me_product_id_idx  ON member_entitlements(product_id)`;
    await sql`CREATE INDEX IF NOT EXISTS me_status_idx      ON member_entitlements(status)`;

    // ── refund_requests ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS refund_requests (
        id                    TEXT PRIMARY KEY,
        seller_id             TEXT,
        customer_id           TEXT,
        order_id              TEXT,
        tenant_id             TEXT,
        amount                INTEGER NOT NULL DEFAULT 0,
        currency              TEXT NOT NULL DEFAULT 'BRL',
        reason                TEXT,
        status                TEXT NOT NULL DEFAULT 'pending',
        processed_by          TEXT,
        processed_by_name     TEXT,
        processed_at          TIMESTAMPTZ,
        denial_reason         TEXT,
        refunded_amount       INTEGER,
        refund_method         TEXT,
        refund_transaction_id TEXT,
        metadata              JSONB,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS rr_seller_id_idx   ON refund_requests(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS rr_customer_id_idx ON refund_requests(customer_id)`;
    await sql`CREATE INDEX IF NOT EXISTS rr_order_id_idx    ON refund_requests(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS rr_status_idx      ON refund_requests(status)`;

    console.log('✅ [NEON] Tabelas extras verificadas/criadas');

    // ── refunds ─────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS refunds (
        id                TEXT PRIMARY KEY,
        order_id          TEXT,
        seller_id         TEXT,
        tenant_id         TEXT,
        customer_id       TEXT,
        customer_email    TEXT,
        customer_name     TEXT,
        product_id        TEXT,
        product_title     TEXT,
        amount            INTEGER NOT NULL DEFAULT 0,
        refund_amount     INTEGER NOT NULL DEFAULT 0,
        currency          TEXT NOT NULL DEFAULT 'BRL',
        status            TEXT NOT NULL DEFAULT 'pending',
        reason            TEXT,
        payment_method    TEXT,
        gateway           TEXT,
        seller_response   TEXT,
        approved_by       TEXT,
        approved_at       TIMESTAMPTZ,
        rejected_by       TEXT,
        rejected_at       TIMESTAMPTZ,
        rejection_reason  TEXT,
        auto_approved     BOOLEAN NOT NULL DEFAULT FALSE,
        metadata          JSONB,
        requested_at      TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS refunds_order_id_idx   ON refunds(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS refunds_seller_id_idx  ON refunds(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS refunds_tenant_id_idx  ON refunds(tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS refunds_status_idx     ON refunds(status)`;

    // ── refund_balances ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS refund_balances (
        id              TEXT PRIMARY KEY,
        refund_id       TEXT,
        customer_id     TEXT,
        customer_email  TEXT,
        customer_name   TEXT,
        seller_id       TEXT,
        seller_name     TEXT,
        product_title   TEXT,
        amount          INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'available',
        approved_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS rb_refund_id_idx    ON refund_balances(refund_id)`;
    await sql`CREATE INDEX IF NOT EXISTS rb_customer_id_idx  ON refund_balances(customer_id)`;
    await sql`CREATE INDEX IF NOT EXISTS rb_seller_id_idx    ON refund_balances(seller_id)`;

    // ── refund_debits ───────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS refund_debits (
        id               TEXT PRIMARY KEY,
        type             TEXT NOT NULL DEFAULT 'refund_debit',
        tenant_id        TEXT,
        refund_id        TEXT,
        amount           INTEGER NOT NULL DEFAULT 0,
        method           TEXT,
        source           TEXT,
        auto_approved    BOOLEAN NOT NULL DEFAULT FALSE,
        approved_by      TEXT,
        previous_balance INTEGER,
        new_balance      INTEGER,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS rdebits_refund_id_idx  ON refund_debits(refund_id)`;
    await sql`CREATE INDEX IF NOT EXISTS rdebits_tenant_id_idx  ON refund_debits(tenant_id)`;

    // ── idempotency_keys ────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id             TEXT PRIMARY KEY,
        status         TEXT NOT NULL DEFAULT 'processing',
        result         JSONB,
        error          TEXT,
        created_at_ms  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
        expires_at_ms  BIGINT NOT NULL,
        completed_at   TIMESTAMPTZ,
        failed_at      TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idem_expires_idx ON idempotency_keys(expires_at_ms)`;
    await sql`CREATE INDEX IF NOT EXISTS idem_status_idx  ON idempotency_keys(status)`;

    // ── seller_sessions ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS seller_sessions (
        id              TEXT PRIMARY KEY,
        uid             TEXT NOT NULL,
        browser_id      TEXT,
        ip              TEXT,
        browser         TEXT,
        os              TEXT,
        device          TEXT,
        city            TEXT,
        region          TEXT,
        country         TEXT,
        location_label  TEXT,
        last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS ss_uid_idx ON seller_sessions(uid)`;
    await sql`CREATE INDEX IF NOT EXISTS ss_ip_browser_os_idx ON seller_sessions(uid, ip, browser, os)`;

    // ── personal_sales ──────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS personal_sales (
        id          TEXT PRIMARY KEY,
        seller_id   TEXT NOT NULL,
        tenant_id   TEXT,
        order_id    TEXT,
        amount      INTEGER NOT NULL DEFAULT 0,
        currency    TEXT NOT NULL DEFAULT 'BRL',
        status      TEXT NOT NULL DEFAULT 'active',
        customer    JSONB,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS ps_seller_id_idx ON personal_sales(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS ps_order_id_idx  ON personal_sales(order_id)`;

    // ── support_tickets ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id          TEXT PRIMARY KEY,
        seller_id   TEXT NOT NULL,
        tenant_id   TEXT,
        subject     TEXT,
        status      TEXT NOT NULL DEFAULT 'open',
        priority    TEXT NOT NULL DEFAULT 'normal',
        category    TEXT,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS st_seller_id_idx ON support_tickets(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS st_status_idx    ON support_tickets(status)`;

    // ── support_messages ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS support_messages (
        id         TEXT PRIMARY KEY,
        ticket_id  TEXT NOT NULL,
        sender_id  TEXT,
        sender     TEXT,
        content    TEXT,
        is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
        metadata   JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sm_ticket_id_idx ON support_messages(ticket_id)`;

    // ── seller_team_members ──────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS seller_team_members (
        id          TEXT PRIMARY KEY,
        seller_id   TEXT NOT NULL,
        user_id     TEXT,
        email       TEXT,
        name        TEXT,
        role        TEXT NOT NULL DEFAULT 'member',
        permissions JSONB,
        status      TEXT NOT NULL DEFAULT 'active',
        invited_at  TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS stm_seller_id_idx ON seller_team_members(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS stm_email_idx     ON seller_team_members(email)`;

    // ── premiations ──────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS premiations (
        id          TEXT PRIMARY KEY,
        seller_id   TEXT NOT NULL,
        tenant_id   TEXT,
        title       TEXT,
        description TEXT,
        amount      INTEGER NOT NULL DEFAULT 0,
        currency    TEXT NOT NULL DEFAULT 'BRL',
        type        TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS prem_seller_id_idx ON premiations(seller_id)`;

    // ── seller_daily_totals ──────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS seller_daily_totals (
        id            TEXT PRIMARY KEY,
        seller_id     TEXT NOT NULL,
        date          TEXT NOT NULL,
        total_cents   INTEGER NOT NULL DEFAULT 0,
        count         INTEGER NOT NULL DEFAULT 0,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sdt_seller_date_idx ON seller_daily_totals(seller_id, date)`;

    // ── seller_transaction_limits ─────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS seller_transaction_limits (
        seller_id     TEXT PRIMARY KEY,
        max_per_tx    INTEGER,
        max_per_day   INTEGER,
        notes         TEXT,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ── audit_logs ───────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          TEXT PRIMARY KEY,
        seller_id   TEXT,
        user_id     TEXT,
        action      TEXT NOT NULL,
        resource    TEXT,
        resource_id TEXT,
        ip          TEXT,
        details     JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS al_seller_id_idx ON audit_logs(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS al_action_idx    ON audit_logs(action)`;

    // ── dispute_alerts ───────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS dispute_alerts (
        id              TEXT PRIMARY KEY,
        order_id        TEXT,
        seller_id       TEXT,
        tenant_id       TEXT,
        type            TEXT,
        status          TEXT NOT NULL DEFAULT 'open',
        amount          INTEGER,
        gateway         TEXT,
        reason          TEXT,
        acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
        acknowledged_at TIMESTAMPTZ,
        metadata        JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        alerted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS da_order_id_idx  ON dispute_alerts(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS da_seller_id_idx ON dispute_alerts(seller_id)`;
    await sql`CREATE INDEX IF NOT EXISTS da_status_idx    ON dispute_alerts(status)`;

    // ── admin_config ─────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS admin_config (
        id         TEXT PRIMARY KEY,
        data       JSONB NOT NULL DEFAULT '{}',
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ── seller_companies ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS seller_companies (
        seller_id   TEXT PRIMARY KEY,
        cnpj        TEXT,
        razao_social TEXT,
        nome_fantasia TEXT,
        endereco    JSONB,
        metadata    JSONB,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ── coproduction_contracts ───────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS coproduction_contracts (
        id              TEXT PRIMARY KEY,
        product_id      TEXT NOT NULL,
        owner_seller_id TEXT NOT NULL,
        coprod_seller_id TEXT NOT NULL,
        commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
        status          TEXT NOT NULL DEFAULT 'active',
        metadata        JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS cc_product_id_idx ON coproduction_contracts(product_id)`;

    // ── balance_reconciliations ──────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS balance_reconciliations (
        id          TEXT PRIMARY KEY,
        seller_id   TEXT NOT NULL,
        period      TEXT,
        status      TEXT NOT NULL DEFAULT 'completed',
        details     JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS brec_seller_id_idx ON balance_reconciliations(seller_id)`;

    console.log('✅ [NEON] Todas as tabelas extras verificadas/criadas (v2)');
  }, 'ensureNeonExtraTables');
}
