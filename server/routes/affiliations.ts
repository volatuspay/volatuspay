import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  verifyFirebaseToken,
  checkAdminAccess,
  AuthenticatedRequest
} from '../security/firebase-auth.js';
import { replayProtectionMiddleware, idempotencyMiddleware } from '../security/idempotency.js';
import { userRateLimit } from '../security/user-rate-limiter.js';
import { storage } from '../storage.js';
import { neonQuery } from '../lib/neon-db.js';

const affiliationsRouter = Router();

function getBaseDomain(): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '');
  }
  
  return 'https://volatuspay.com';
}

function normalizeTimestamps(obj: any, seen = new WeakSet()): any {
  if (obj === null || obj === undefined) return obj;
  
  if (obj?.toDate && typeof obj.toDate === 'function') {
    return obj.toDate().toISOString();
  }
  
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeTimestamps(item, seen));
  }
  
  if (typeof obj === 'object') {
    if (seen.has(obj)) {
      return '[Circular Reference]';
    }
    seen.add(obj);
    
    const normalized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        normalized[key] = normalizeTimestamps(obj[key], seen);
      }
    }
    return normalized;
  }
  
  return obj;
}

async function generateUniqueAffiliateSlug(
  affiliateName: string,
  productName: string,
  _db?: any
): Promise<string> {
  const normalizeSlug = (text: string): string => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30);
  };

  const affiliateSlugBase = normalizeSlug(affiliateName);
  const productSlugBase = normalizeSlug(productName);

  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const uniqueId = Math.random().toString(36).substring(2, 8);
    const candidateSlug = `aff-${affiliateSlugBase}-${productSlugBase}-${uniqueId}`;

    let exists = false;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM affiliates WHERE affiliate_slug = ${candidateSlug} LIMIT 1`;
      exists = rows.length > 0;
    }, `slugCheck:${candidateSlug}`);

    if (!exists) {
      console.log(`✅ Slug único gerado: ${candidateSlug}`);
      return candidateSlug;
    }

    console.warn(`⚠️ Slug ${candidateSlug} já existe, tentando novamente...`);
    attempts++;
  }

  const fallbackSlug = `aff-${affiliateSlugBase}-${Date.now()}`;
  console.warn(`⚠️ Usando fallback slug: ${fallbackSlug}`);
  return fallbackSlug;
}

const commissionSchema = z.object({
  customCommission: z.number().min(0).max(100)
});

// =============================================
// AFFILIATIONS CRUD ROUTES (/api/affiliations)
// =============================================

// POST /api/affiliations - Criar afiliação
affiliationsRouter.post('/api/affiliations', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const userEmail = req.user?.email || '';
    const userName = userEmail.split('@')[0] || 'Afiliado';

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { productId } = req.body;
    console.log(`📝 [POST /api/affiliations] userId=${userId}, productId=${productId}, body=`, req.body);

    if (!productId) {
      return res.status(400).json({ error: 'productId é obrigatório' });
    }

    // Buscar checkout do Neon
    let product: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM checkouts WHERE id = ${productId} LIMIT 1`;
      if (rows[0]) product = rows[0];
    }, `affiliationCreateCheckout:${productId}`);

    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const affiliateConfig = product.affiliate || product.config?.affiliateConfig || {};
    if (!affiliateConfig.enabled) {
      return res.status(400).json({ error: 'Este produto não aceita afiliados' });
    }

    // Verificar se já existe afiliação no Neon
    let existingAff: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status FROM affiliations WHERE affiliate_id = ${userId} AND product_id = ${productId} LIMIT 1`;
      if (rows[0]) existingAff = rows[0];
    }, `affiliationExistsCheck:${userId}:${productId}`);

    if (existingAff) {
      return res.status(400).json({ error: 'Você já é afiliado deste produto', affiliation: existingAff });
    }

    // Buscar seller do Neon
    let sellerName = 'Vendedor';
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT name, business_name FROM sellers WHERE id = ${product.tenant_id} LIMIT 1`;
      if (rows[0]) sellerName = rows[0].business_name || rows[0].name || 'Vendedor';
    }, `affiliationSellerLookup:${product.tenant_id}`);

    const { generateAffiliationId } = await import('../../shared/schema.js');
    const { generateUniqueAffiliateCode } = await import('../lib/affiliate-code-generator');
    const db = getFirestore();
    const affiliateCode = await generateUniqueAffiliateCode(db);
    const affiliationId = generateAffiliationId();

    const affiliateLink = `${getBaseDomain()}/c/${productId}?aff=${affiliateCode}`;
    const autoApprove = affiliateConfig.autoApprove !== false;
    const status = autoApprove ? 'approved' : 'pending';

    const commissionSnapshot = {
      single: affiliateConfig.commissions?.single ?? affiliateConfig.commissionPercent ?? 10,
      subscription: affiliateConfig.commissions?.subscription ?? affiliateConfig.commissionPercent ?? 10
    };

    const now = new Date();
    const affiliation = {
      id: affiliationId,
      affiliateId: userId,
      affiliateName: userName,
      affiliateEmail: userEmail,
      productId,
      productName: product.title || product.config?.name || 'Produto',
      sellerId: product.tenant_id,
      sellerName,
      status,
      affiliateCode,
      affiliateLink,
      commissionSnapshot,
      totalSales: 0,
      totalEarnings: 0,
      createdAt: now,
      approvedAt: autoApprove ? now : null,
      updatedAt: now
    };

    await neonQuery(async (sql) => {
      await sql`INSERT INTO affiliations (id, affiliate_id, affiliate_name, affiliate_email, product_id, product_name, seller_id, seller_name, status, affiliate_code, affiliate_link, commission_snapshot, total_sales, total_earnings, approved_at, created_at, updated_at)
        VALUES (${affiliationId}, ${userId}, ${userName}, ${userEmail}, ${productId},
          ${affiliation.productName}, ${product.tenant_id}, ${sellerName}, ${status},
          ${affiliateCode}, ${affiliateLink}, ${JSON.stringify(commissionSnapshot)}::jsonb,
          0, 0, ${autoApprove ? now : null}, ${now}, ${now})
        ON CONFLICT (id) DO NOTHING`;
    }, `affiliationInsert:${affiliationId}`);

    console.log(`✅ Afiliação criada no Neon: ${userId} → ${productId} (${status})`);

    res.json({
      success: true,
      affiliation,
      message: autoApprove ? 'Afiliação aprovada automaticamente!' : 'Sua solicitação de afiliação está pendente de aprovação'
    });

  } catch (error: any) {
    console.error('Erro ao criar afiliação:', error?.message || error);
    res.status(500).json({ error: 'Erro ao criar afiliação', details: error.message });
  }
});

// GET /api/affiliations - Listar minhas afiliações
affiliationsRouter.get('/api/affiliations', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    // Buscar affiliations e affiliates do Neon em paralelo
    let affiliationRows: any[] = [];
    let affiliateRows: any[] = [];

    await Promise.all([
      neonQuery(async (sql) => {
        affiliationRows = await sql`SELECT aff.*, c.title AS checkout_title, c.logo_url, c.pricing, c.affiliate AS checkout_affiliate, c.synced_product_id, c.active AS checkout_active, c.deleted AS checkout_deleted, c.config AS checkout_config, s.name AS seller_name_real, s.business_name AS seller_business_name
          FROM affiliations aff
          LEFT JOIN checkouts c ON c.id = aff.product_id
          LEFT JOIN sellers s ON s.id = aff.seller_id
          WHERE aff.affiliate_id = ${userId}
          ORDER BY aff.created_at DESC LIMIT 50`;
      }, `listAffiliations:${userId}`),
      neonQuery(async (sql) => {
        affiliateRows = await sql`SELECT af.*, c.title AS checkout_title, c.logo_url, c.pricing, c.active AS checkout_active, c.deleted AS checkout_deleted
          FROM affiliates af
          LEFT JOIN checkouts c ON c.id = af.checkout_id
          WHERE af.user_id = ${userId} AND af.status != 'rejected'
          ORDER BY af.created_at DESC LIMIT 50`;
      }, `listAffiliates:${userId}`)
    ]);

    const baseUrl = getBaseDomain();

    // Processar affiliations
    const processedAffiliations = affiliationRows
      .filter(r => {
        if (!r.checkout_title && !r.product_name) return false;
        if (r.checkout_deleted) return false;
        if (r.checkout_active === false) return false;
        const aff = r.checkout_affiliate || {};
        if (aff.enabled === false && aff.marketplaceEnabled === undefined) return false;
        return true;
      })
      .map(r => {
        const affiliateConfig = r.checkout_affiliate || r.checkout_config?.affiliateConfig || {};
        const pricing = r.pricing || {};
        const price = pricing.amount || 0;
        const commissionPercent = r.custom_commission ?? affiliateConfig.commissions?.single ?? affiliateConfig.commissionPercent ?? r.commission_snapshot?.single ?? 10;
        const commissionValue = Math.round((price * commissionPercent) / 100);

        const offers = price > 0 ? [{
          id: `${r.product_id}-default`,
          uuid: `${r.product_id}-default`,
          name: r.checkout_title || r.product_name || 'Oferta padrão',
          price,
          priceFormatted: `R$ ${(price / 100).toFixed(2).replace('.', ',')}`,
          commissionPercent,
          commissionValue,
          commissionFormatted: `R$ ${(commissionValue / 100).toFixed(2).replace('.', ',')}`,
        }] : [];

        const productImage = r.logo_url || r.checkout_config?.logoUrl || null;
        const affiliateLink = r.affiliate_link || `${baseUrl}/c/${r.product_id}?aff=${r.affiliate_code || ''}`;
        const offerUrls = offers.map((o: any) => ({
          offerId: o.id, offerName: o.name,
          url: `${baseUrl}/c/${r.product_id}`,
          affiliateUrl: affiliateLink,
          price: o.price,
          priceFormatted: o.priceFormatted
        }));

        return {
          id: r.id,
          affiliateId: r.affiliate_id,
          affiliateName: r.affiliate_name,
          affiliateEmail: r.affiliate_email,
          productId: r.product_id,
          productName: r.checkout_title || r.product_name || 'Produto',
          sellerId: r.seller_id,
          sellerName: r.seller_business_name || r.seller_name_real || r.seller_name || 'Vendedor',
          status: r.status,
          affiliateCode: r.affiliate_code,
          affiliateLink,
          commissionSnapshot: r.commission_snapshot || { single: commissionPercent, subscription: commissionPercent },
          customCommission: r.custom_commission,
          totalSales: r.total_sales || 0,
          totalEarnings: r.total_earnings || 0,
          createdAt: r.created_at,
          approvedAt: r.approved_at,
          realCommission: commissionPercent,
          offers,
          productImage,
          supportData: null,
          affiliateRules: null,
          salesPageUrl: '',
          affiliateSalesPageUrl: affiliateLink,
          offerUrls,
          _syncedProductId: r.synced_product_id || null,
          _source: 'affiliations'
        };
      });

    // Processar affiliates (cadastro público)
    const seenProductIds = new Set(processedAffiliations.map(a => a.productId));
    const extraAffiliates = affiliateRows
      .filter(r => !seenProductIds.has(r.checkout_id) && r.checkout_id)
      .map(r => {
        const price = (r.pricing as any)?.amount || 0;
        const commission = r.custom_commission ?? 10;
        const link = r.affiliate_link || `${baseUrl}/c/${r.checkout_id}?aff=${r.affiliate_code || r.affiliate_slug || ''}`;
        return {
          id: r.id,
          affiliateId: r.user_id,
          affiliateName: r.name || '',
          affiliateEmail: r.email || '',
          productId: r.checkout_id,
          productName: r.checkout_title || r.product_name || '',
          sellerId: r.seller_id,
          status: r.status,
          affiliateCode: r.affiliate_code || r.affiliate_slug || '',
          affiliateLink: link,
          commissionSnapshot: { single: commission, subscription: commission },
          customCommission: commission,
          totalSales: r.total_sales || 0,
          totalEarnings: r.total_commissions || 0,
          totalClicks: r.total_clicks || 0,
          createdAt: r.created_at,
          offers: [],
          _sourceCollection: 'affiliates'
        };
      });

    const deduplicated = [...processedAffiliations, ...extraAffiliates];
    console.log(`📋 Listando ${deduplicated.length} afiliações para usuário ${userId}`);

    res.json({ success: true, affiliations: deduplicated, total: deduplicated.length });

  } catch (error: any) {
    console.error('Erro ao listar afiliações:', error);
    res.status(500).json({ error: 'Erro ao listar afiliações', details: error.message });
  }
});

// GET /api/affiliations/stats - Estatísticas das afiliações
affiliationsRouter.get('/api/affiliations/stats', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    let statsRow: any = { total: 0, approved: 0, pending: 0, rejected: 0, total_sales: 0, total_earnings: 0 };
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COALESCE(SUM(total_sales), 0)::int AS total_sales,
        COALESCE(SUM(total_earnings), 0)::int AS total_earnings
        FROM affiliations WHERE affiliate_id = ${userId}`;
      if (rows[0]) statsRow = rows[0];
    }, `affiliationStats:${userId}`);

    const stats = {
      totalAffiliations: statsRow.total,
      approved: statsRow.approved,
      pending: statsRow.pending,
      rejected: statsRow.rejected,
      totalSales: statsRow.total_sales,
      totalEarnings: statsRow.total_earnings
    };

    console.log(`📊 Estatísticas de afiliações para ${userId}:`, stats);
    res.json({ success: true, stats });

  } catch (error: any) {
    console.error('Erro ao buscar estatísticas de afiliações:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas', details: error.message });
  }
});

// GET /api/products/:productId/affiliates - Listar afiliados de um produto (SELLER ONLY)
affiliationsRouter.get('/api/products/:productId/affiliates', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const { productId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    // Verificar que o seller é dono do produto
    let product: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT tenant_id FROM checkouts WHERE id = ${productId} LIMIT 1`;
      if (rows[0]) product = rows[0];
    }, `productAffiliatesOwnerCheck:${productId}`);

    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
    if (product.tenant_id !== userId) {
      const isAdmin = await checkAdminAccess(userId);
      if (!isAdmin) return res.status(403).json({ error: 'Sem permissão para gerenciar afiliados deste produto' });
    }

    let affiliationRows: any[] = [];
    let affiliateRows: any[] = [];
    await Promise.all([
      neonQuery(async (sql) => {
        affiliationRows = await sql`SELECT * FROM affiliations WHERE product_id = ${productId} ORDER BY created_at DESC LIMIT 200`;
      }, `productAffiliations:${productId}`),
      neonQuery(async (sql) => {
        affiliateRows = await sql`SELECT * FROM affiliates WHERE checkout_id = ${productId} ORDER BY created_at DESC LIMIT 200`;
      }, `productAffiliates:${productId}`)
    ]);

    const seenAffiliateIds = new Set<string>(affiliationRows.map(r => r.affiliate_id));
    const combined: any[] = [
      ...affiliationRows.map(r => ({
        id: r.id, _source: 'affiliations',
        affiliateId: r.affiliate_id, affiliateName: r.affiliate_name, affiliateEmail: r.affiliate_email,
        productId: r.product_id, sellerId: r.seller_id, status: r.status,
        affiliateCode: r.affiliate_code, affiliateLink: r.affiliate_link,
        commissionSnapshot: r.commission_snapshot || { single: r.custom_commission ?? 10 },
        customCommission: r.custom_commission, totalSales: r.total_sales || 0,
        totalEarnings: r.total_earnings || 0, createdAt: r.created_at, updatedAt: r.updated_at
      })),
      ...affiliateRows
        .filter(r => !seenAffiliateIds.has(r.user_id))
        .map(r => ({
          id: r.id, _source: 'affiliates',
          affiliateId: r.user_id, affiliateName: r.name, affiliateEmail: r.email,
          productId: r.checkout_id, sellerId: r.seller_id, status: r.status,
          affiliateCode: r.affiliate_code || r.affiliate_slug, affiliateLink: r.affiliate_link,
          commissionSnapshot: { single: r.custom_commission ?? 10, subscription: r.custom_commission ?? 10 },
          customCommission: r.custom_commission, totalSales: r.total_sales || 0,
          totalEarnings: r.total_commissions || 0, totalClicks: r.total_clicks || 0,
          createdAt: r.created_at, updatedAt: r.updated_at
        }))
    ];

    combined.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    console.log(`📊 Produto ${productId}: ${combined.length} afiliados`);
    res.json({ success: true, affiliates: combined });

  } catch (error: any) {
    console.error('Erro ao listar afiliados do produto:', error);
    res.status(500).json({ error: 'Erro ao listar afiliados', details: error.message });
  }
});

// Helper: buscar afiliação ou affiliate do Neon por id
async function findAffiliationOrAffiliate(id: string): Promise<{ row: any; table: 'affiliations' | 'affiliates' } | null> {
  let found: any = null;
  let table: 'affiliations' | 'affiliates' = 'affiliations';
  await neonQuery(async (sql) => {
    const rows = await sql`SELECT * FROM affiliations WHERE id = ${id} LIMIT 1`;
    if (rows[0]) found = rows[0];
  }, `findAffiliation:${id}`);
  if (!found) {
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM affiliates WHERE id = ${id} LIMIT 1`;
      if (rows[0]) { found = rows[0]; table = 'affiliates'; }
    }, `findAffiliate:${id}`);
  }
  return found ? { row: found, table } : null;
}

// PATCH /api/affiliations/:id/approve - Aprovar afiliação (SELLER ONLY)
affiliationsRouter.patch('/api/affiliations/:id/approve', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const found = await findAffiliationOrAffiliate(id);
    if (!found) return res.status(404).json({ error: 'Afiliação não encontrada' });
    const { row, table } = found;
    const sellerId = row.seller_id;
    if (sellerId !== userId) return res.status(403).json({ error: 'Sem permissão para aprovar esta afiliação' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Só é possível aprovar afiliações pendentes', currentStatus: row.status });

    const now = new Date();
    if (table === 'affiliations') {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliations SET status = 'approved', approved_at = ${now}, updated_at = ${now} WHERE id = ${id}`;
      }, `approveAffiliation:${id}`);
    } else {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliates SET status = 'approved', approved_at = ${now}, updated_at = ${now} WHERE id = ${id}`;
      }, `approveAffiliate:${id}`);
    }

    console.log(`✅ Afiliação ${id} APROVADA por ${userId} [${table}]`);
    res.json({ success: true, message: 'Afiliação aprovada com sucesso' });

  } catch (error: any) {
    console.error('Erro ao aprovar afiliação:', error);
    res.status(500).json({ error: 'Erro ao aprovar afiliação', details: error.message });
  }
});

// PATCH /api/affiliations/:id/reject - Rejeitar afiliação (SELLER ONLY)
affiliationsRouter.patch('/api/affiliations/:id/reject', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const found = await findAffiliationOrAffiliate(id);
    if (!found) return res.status(404).json({ error: 'Afiliação não encontrada' });
    const { row, table } = found;
    if (row.seller_id !== userId) return res.status(403).json({ error: 'Sem permissão para rejeitar esta afiliação' });
    if (row.status !== 'pending' && row.status !== 'approved') {
      return res.status(400).json({ error: 'Só é possível rejeitar afiliações pendentes ou aprovadas', currentStatus: row.status });
    }

    const now = new Date();
    if (table === 'affiliations') {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliations SET status = 'rejected', updated_at = ${now} WHERE id = ${id}`;
      }, `rejectAffiliation:${id}`);
    } else {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliates SET status = 'rejected', updated_at = ${now} WHERE id = ${id}`;
      }, `rejectAffiliate:${id}`);
    }

    console.log(`❌ Afiliação ${id} REJEITADA por ${userId} [${table}]`);
    res.json({ success: true, message: 'Afiliação rejeitada' });

  } catch (error: any) {
    console.error('Erro ao rejeitar afiliação:', error);
    res.status(500).json({ error: 'Erro ao rejeitar afiliação', details: error.message });
  }
});

// DELETE /api/affiliations/:id - Remover afiliação (SELLER ONLY)
affiliationsRouter.delete('/api/affiliations/:id', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const found = await findAffiliationOrAffiliate(id);
    if (!found) return res.status(404).json({ error: 'Afiliação não encontrada' });
    const { row, table } = found;
    if (row.seller_id !== userId) return res.status(403).json({ error: 'Sem permissão para remover esta afiliação' });

    const now = new Date();
    if (table === 'affiliations') {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliations SET status = 'removed', updated_at = ${now} WHERE id = ${id}`;
      }, `removeAffiliation:${id}`);
    } else {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliates SET status = 'removed', updated_at = ${now} WHERE id = ${id}`;
      }, `removeAffiliate:${id}`);
    }

    console.log(`🗑️ Afiliação ${id} REMOVIDA por ${userId} [${table}]`);
    res.json({ success: true, message: 'Afiliação removida com sucesso' });

  } catch (error: any) {
    console.error('Erro ao remover afiliação:', error);
    res.status(500).json({ error: 'Erro ao remover afiliação', details: error.message });
  }
});

// PATCH /api/affiliations/:id/commission - Alterar comissão individual (SELLER ONLY)
affiliationsRouter.patch('/api/affiliations/:id/commission', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const validation = commissionSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: 'Dados inválidos', details: validation.error.flatten().fieldErrors });
    const { customCommission } = validation.data;

    const found = await findAffiliationOrAffiliate(id);
    if (!found) return res.status(404).json({ error: 'Afiliação não encontrada' });
    const { row, table } = found;
    if (row.seller_id !== userId) return res.status(403).json({ error: 'Sem permissão para alterar comissão desta afiliação' });
    if (row.status !== 'approved') return res.status(400).json({ error: 'Só é possível alterar comissão de afiliações aprovadas', currentStatus: row.status });

    const now = new Date();
    if (table === 'affiliations') {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliations SET custom_commission = ${customCommission}, updated_at = ${now} WHERE id = ${id}`;
      }, `commissionAffiliation:${id}`);
    } else {
      await neonQuery(async (sql) => {
        await sql`UPDATE affiliates SET custom_commission = ${customCommission}, updated_at = ${now} WHERE id = ${id}`;
      }, `commissionAffiliate:${id}`);
    }

    console.log(`💰 Comissão do afiliado ${id} atualizada para ${customCommission}% por ${userId} [${table}]`);
    res.json({ success: true, message: 'Comissão atualizada com sucesso', customCommission });

  } catch (error: any) {
    console.error('Erro ao atualizar comissão:', error);
    res.status(500).json({ error: 'Erro ao atualizar comissão', details: error.message });
  }
});

// =============================================
// AFFILIATE MY-ORDERS ROUTE
// =============================================

// GET /api/affiliate/my-orders - Listar orders do afiliado
affiliationsRouter.get('/api/affiliate/my-orders', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const affiliateUid = req.user.uid;
    console.log(`📊 GET /api/affiliate/my-orders - Afiliado: ${affiliateUid}`);

    // Buscar todos affiliate_codes do usuário do Neon
    let affiliateCodes: string[] = [affiliateUid];
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT affiliate_code, affiliate_slug FROM affiliations WHERE affiliate_id = ${affiliateUid}
        UNION
        SELECT affiliate_code, affiliate_slug FROM affiliates WHERE user_id = ${affiliateUid}`;
      rows.forEach((r: any) => {
        if (r.affiliate_code && !affiliateCodes.includes(r.affiliate_code)) affiliateCodes.push(r.affiliate_code);
        if (r.affiliate_slug && !affiliateCodes.includes(r.affiliate_slug)) affiliateCodes.push(r.affiliate_slug);
      });
    }, `affiliateCodesForOrders:${affiliateUid}`);

    let orders: any[] = [];
    await neonQuery(async (sql) => {
      orders = await sql`
        SELECT o.*, s.name AS seller_name, s.business_name AS seller_business_name
        FROM orders o
        LEFT JOIN sellers s ON s.id = o.tenant_id
        WHERE o.affiliate_uid = ANY(${affiliateCodes}::text[])
           OR o.affiliate_id = ANY(${affiliateCodes}::text[])
           OR o.affiliate_code = ANY(${affiliateCodes}::text[])
        ORDER BY o.created_at DESC LIMIT 200`;
    }, `affiliateOrders:${affiliateUid}`);

    const mapped = orders.map((o: any) => ({
      ...o,
      id: o.id,
      sellerName: o.seller_business_name || o.seller_name || 'Vendedor',
      affiliateCommission: typeof o.affiliate_commission === 'number'
        ? { amount: o.affiliate_commission, percentage: 0 }
        : o.affiliate_commission,
      isMyAffiliateSale: true
    }));

    console.log(`✅ ${mapped.length} orders de afiliado encontradas para ${affiliateUid}`);
    res.json({ success: true, orders: mapped, data: mapped, total: mapped.length });
  } catch (error: any) {
    console.error('❌ Erro ao buscar orders do afiliado:', error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor', message: error.message });
  }
});

// =============================================
// AFFILIATE OPERATIONS ROUTES (/api/affiliate)
// =============================================

// GET /api/affiliate/my-products/:affiliateId
affiliationsRouter.get('/api/affiliate/my-products/:affiliateId', async (req, res) => {
  try {
    const { affiliateId } = req.params;
    console.log(`🔗 Buscando produtos APROVADOS do afiliado: ${affiliateId}`);

    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`
        SELECT aff.affiliate_link, aff.affiliate_code, c.*, s.name AS seller_name, s.business_name, s.email AS seller_email, c.id AS checkout_id
        FROM (
          SELECT affiliate_link, affiliate_code, product_id AS checkout_id FROM affiliations WHERE affiliate_id = ${affiliateId} AND status = 'approved'
          UNION
          SELECT affiliate_link, affiliate_code, checkout_id FROM affiliates WHERE user_id = ${affiliateId} AND status = 'approved'
        ) aff
        JOIN checkouts c ON c.id = aff.checkout_id
        LEFT JOIN sellers s ON s.id = c.tenant_id
        ORDER BY c.created_at DESC LIMIT 100`;
    }, `affiliateMyProducts:${affiliateId}`);

    const checkouts = rows.map(r => ({
      id: r.checkout_id,
      title: r.title, tenantId: r.tenant_id, pricing: r.pricing, config: r.config,
      affiliateLink: r.affiliate_link,
      affiliateCode: r.affiliate_code,
      seller: r.tenant_id ? { id: r.tenant_id, name: r.business_name || r.seller_name || 'Seller', email: r.seller_email || '' } : null
    }));

    console.log(`✅ ${checkouts.length} produtos aprovados retornados`);
    res.json(checkouts);
  } catch (error) {
    console.error('❌ Erro ao buscar produtos de afiliação aprovados:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/affiliate/balance - Consultar saldo calculado das orders de afiliado (Neon)
affiliationsRouter.get('/api/affiliate/balance', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Usuário não autenticado' });

    // Verificar se seller está bloqueado/rejeitado
    let sellerStatus: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT status FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (rows[0]) sellerStatus = rows[0].status;
    }, `affiliateBalanceSellerCheck:${userId}`);
    if (sellerStatus === 'rejected' || sellerStatus === 'blocked') {
      return res.status(403).json({ error: 'Conta suspensa ou rejeitada. Entre em contato com o suporte.' });
    }

    console.log(`💼 Consultando saldo do afiliado: ${userId}`);

    // Buscar todos códigos do afiliado
    let affiliateCodes: string[] = [userId];
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT affiliate_code, affiliate_slug FROM affiliations WHERE affiliate_id = ${userId} AND affiliate_code IS NOT NULL
        UNION
        SELECT affiliate_code, affiliate_slug FROM affiliates WHERE user_id = ${userId} AND affiliate_code IS NOT NULL`;
      rows.forEach((r: any) => {
        if (r.affiliate_code && !affiliateCodes.includes(r.affiliate_code)) affiliateCodes.push(r.affiliate_code);
        if (r.affiliate_slug && !affiliateCodes.includes(r.affiliate_slug)) affiliateCodes.push(r.affiliate_slug);
      });
    }, `affiliateCodesForBalance:${userId}`);

    // Buscar orders de afiliado do Neon
    let orders: any[] = [];
    await neonQuery(async (sql) => {
      orders = await sql`SELECT id, status, payment_method, paid_at, created_at, affiliate_commission, affiliate_commission_net, commission_amount, financial
        FROM orders
        WHERE affiliate_uid = ANY(${affiliateCodes}::text[])
           OR affiliate_id = ANY(${affiliateCodes}::text[])
           OR affiliate_code = ANY(${affiliateCodes}::text[])
        LIMIT 500`;
    }, `affiliateOrdersForBalance:${userId}`);

    let available = 0, pending = 0, reserved = 0, lifetime = 0;
    let totalSales = 0, pendingCount = 0, approvedCount = 0;
    let lastCommissionDate: Date | null = null, firstCommissionDate: Date | null = null;
    const nowMs = Date.now();

    for (const o of orders) {
      const affComm = o.affiliate_commission;
      const commission = o.affiliate_commission_net || o.commission_amount ||
        (typeof affComm === 'number' ? affComm : (affComm as any)?.amount) || 0;
      if (commission <= 0) continue;
      totalSales++;
      const orderDate = o.paid_at || o.created_at ? new Date(o.paid_at || o.created_at) : null;
      if (['paid', 'approved', 'completed'].includes(o.status || '')) {
        const isCard = ['credit_card','card','efibank_card','creditCard'].includes(o.payment_method || '');
        const fin = o.financial || {};
        let stillPending = false;
        if (isCard && fin.releaseDate) {
          const rdMs = new Date(fin.releaseDate).getTime();
          stillPending = rdMs > nowMs;
        }
        if (stillPending) { pending += commission; pendingCount++; }
        else {
          available += commission; lifetime += commission; approvedCount++;
          if (orderDate) {
            if (!lastCommissionDate || orderDate > lastCommissionDate) lastCommissionDate = orderDate;
            if (!firstCommissionDate || orderDate < firstCommissionDate) firstCommissionDate = orderDate;
          }
        }
      } else if (['pending', 'processing', 'waiting_payment'].includes(o.status || '')) {
        pending += commission; pendingCount++;
      }
    }

    // Subtrair saques já processados
    let totalWithdrawn = 0;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT amount, status FROM withdrawals WHERE seller_id = ${userId} AND source = 'affiliate'
        UNION ALL
        SELECT amount, status FROM affiliate_withdrawals WHERE user_id = ${userId}`;
      for (const w of rows) {
        if (w.status === 'completed' || w.status === 'approved') { totalWithdrawn += (w.amount || 0); available -= (w.amount || 0); }
        else if (w.status === 'processing' || w.status === 'pending') { reserved += (w.amount || 0); available -= (w.amount || 0); }
      }
    }, `affiliateWithdrawalsForBalance:${userId}`);
    if (available < 0) available = 0;

    console.log(`✅ Saldo afiliado: Available=${available}, Pending=${pending}, Lifetime=${lifetime}`);
    res.json({
      userId, balanceAvailable_BRL: available, balancePending_BRL: pending, balanceReserved_BRL: reserved,
      lifetimeCommissions_BRL: lifetime, totalWithdrawn_BRL: totalWithdrawn,
      totalSales, totalCommissions: totalSales, pendingCommissions: pendingCount, approvedCommissions: approvedCount,
      lastCommissionDate, firstCommissionDate, lastWithdrawal: null, createdAt: null, updatedAt: null, computedFromOrders: true
    });
  } catch (error: any) {
    console.error('❌ Erro ao consultar saldo do afiliado:', error);
    res.status(500).json({ error: 'Erro ao consultar saldo' });
  }
});

// GET /api/affiliate/by-seller/:sellerId - Produtos por seller com afiliação ativa
affiliationsRouter.get('/api/affiliate/by-seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    console.log(`🔗 Buscando produtos do seller para afiliação: ${sellerId}`);

    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`SELECT id, title, tenant_id, pricing, affiliate, config
        FROM checkouts WHERE tenant_id = ${sellerId} AND deleted IS NOT TRUE AND active = true
        AND (affiliate->>'enabled' = 'true' OR config->'affiliateConfig'->>'enabled' = 'true')
        ORDER BY created_at DESC LIMIT 100`;
    }, `affiliateBySeller:${sellerId}`);

    const checkouts = rows.map(r => ({ id: r.id, title: r.title, tenantId: r.tenant_id, pricing: r.pricing, affiliateEnabled: true, config: r.config }));
    console.log(`✅ ${checkouts.length} produtos com afiliação do seller ${sellerId}`);
    res.json(checkouts);
  } catch (error) {
    console.error('❌ Erro ao buscar produtos por seller:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/affiliate/register - Registro de novo afiliado
affiliationsRouter.post('/api/affiliate/register', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎯 ENDPOINT AFFILIATE/REGISTER CHAMADO!', req.method, req.url);
    const { productId, checkoutId: checkoutIdFromBody, sellerId, autoApprove } = req.body;
    const userId = req.user.uid;
    const checkoutId = productId || checkoutIdFromBody;

    if (!userId || !checkoutId || !sellerId) {
      return res.status(400).json({ error: 'Dados obrigatórios faltando: userId, checkoutId, sellerId' });
    }
    console.log(`🔗 REGISTRANDO AFILIADO: User ${userId} para produto ${checkoutId} do seller ${sellerId}`);

    // Buscar seller do Neon para dados do afiliado
    let affiliateName = 'Afiliado', affiliateEmail = '', affiliateDocument = '', affiliatePhone = '', affiliatePixKey = '';
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT name, business_name, email, banking_data FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (rows[0]) {
        const s = rows[0];
        affiliateName = s.name || s.business_name || 'Afiliado';
        affiliateEmail = s.email || '';
        const bd = s.banking_data || {};
        affiliatePixKey = bd.pixKey || s.email || '';
      }
    }, `affiliateRegisterSeller:${userId}`);

    // Verificar duplicata no Neon
    let existing: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status FROM affiliates WHERE user_id = ${userId} AND checkout_id = ${checkoutId} AND seller_id = ${sellerId} LIMIT 1`;
      if (rows[0]) existing = rows[0];
    }, `affiliateRegisterCheck:${userId}`);
    if (existing) return res.status(409).json({ error: 'Você já é afiliado deste produto', affiliate: existing });

    // Buscar checkout do Neon
    let checkoutData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, title, tenant_id, affiliate, config FROM checkouts WHERE id = ${checkoutId} LIMIT 1`;
      if (rows[0]) checkoutData = rows[0];
    }, `affiliateRegisterCheckout:${checkoutId}`);
    if (!checkoutData) return res.status(404).json({ error: 'Produto não encontrado' });

    const aff = checkoutData.affiliate || {};
    if (!aff.enabled) return res.status(403).json({ error: 'Este produto não permite afiliados' });

    let affiliateStatus = 'pending';
    let approvedAt: Date | null = null;
    if (userId === sellerId || aff.autoApprove === true || autoApprove === true) {
      affiliateStatus = 'approved';
      approvedAt = new Date();
    }

    const affiliateId = `aff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const productName = checkoutData.title || 'produto';
    const affiliateSlug = await generateUniqueAffiliateSlug(affiliateName, productName, null);
    const affiliateLink = `${getBaseDomain()}/c/${checkoutId}?aff=${affiliateSlug}`;
    const customCommission = aff.commissionPercent ?? 10;

    await neonQuery(async (sql) => {
      await sql`INSERT INTO affiliates
        (id, user_id, checkout_id, seller_id, name, email, document, phone, pix_key, status, custom_commission,
         affiliate_link, affiliate_slug, affiliate_code, total_clicks, total_sales, total_commissions, approved_at, created_at, updated_at)
        VALUES (${affiliateId}, ${userId}, ${checkoutId}, ${sellerId}, ${affiliateName}, ${affiliateEmail},
          ${affiliateDocument}, ${affiliatePhone}, ${affiliatePixKey}, ${affiliateStatus}, ${customCommission},
          ${affiliateLink}, ${affiliateSlug}, ${affiliateSlug}, 0, 0, 0,
          ${approvedAt}, ${now}, ${now})
        ON CONFLICT (id) DO NOTHING`;
    }, `affiliateRegisterInsert:${affiliateId}`);

    console.log(`✅ AFILIADO REGISTRADO: ${affiliateId} - Status: ${affiliateStatus}`);
    res.json({
      success: true,
      message: affiliateStatus === 'approved' ? 'Cadastro aprovado automaticamente!' : 'Cadastro enviado para análise do vendedor',
      affiliate: { id: affiliateId, userId, checkoutId, sellerId, name: affiliateName, email: affiliateEmail, status: affiliateStatus, customCommission, affiliateLink, affiliateSlug, affiliateCode: affiliateSlug }
    });

  } catch (error) {
    console.error('❌ Erro ao registrar afiliado:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// PUT /api/affiliate/manage/:affiliateId - Gerenciar afiliado
affiliationsRouter.put('/api/affiliate/manage/:affiliateId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { affiliateId } = req.params;
    const { status, customCommission, sellerId } = req.body;
    const userId = req.user.uid;
    console.log(`🔗 GERENCIANDO AFILIADO: ${affiliateId} por usuário ${userId}`);

    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, seller_id FROM affiliates WHERE id = ${affiliateId} LIMIT 1`;
      if (rows[0]) row = rows[0];
    }, `affiliateManageGet:${affiliateId}`);
    if (!row) return res.status(404).json({ error: 'Afiliado não encontrado' });
    if (row.seller_id !== userId && !sellerId) return res.status(403).json({ error: 'Sem permissão para gerenciar este afiliado' });

    const now = new Date();
    const newStatus = status || null;
    const newComm = customCommission !== undefined ? Number(customCommission) : null;
    const newApprovedAt = status === 'approved' ? now : null;
    await neonQuery(async (sql) => {
      await sql`UPDATE affiliates SET
        ${newStatus ? sql`status = ${newStatus},` : sql``}
        ${newApprovedAt ? sql`approved_at = ${newApprovedAt},` : sql``}
        ${newComm !== null ? sql`custom_commission = ${newComm},` : sql``}
        updated_at = ${now}
        WHERE id = ${affiliateId}`;
    }, `affiliateManageUpdate:${affiliateId}`);

    console.log(`✅ AFILIADO ATUALIZADO: ${affiliateId}`);
    res.json({ success: true, message: 'Afiliado atualizado com sucesso', updates: { status: newStatus, customCommission: newComm } });

  } catch (error) {
    console.error('❌ Erro ao gerenciar afiliado:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/affiliate/approve - Aprovar afiliado
affiliationsRouter.post('/api/affiliate/approve', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { affiliateId } = req.body;
    const userId = req.user.uid;
    console.log(`✅ APROVANDO AFILIADO: ${affiliateId} por seller ${userId}`);

    const found = await findAffiliationOrAffiliate(affiliateId);
    if (!found) return res.status(404).json({ error: 'Afiliado não encontrado' });
    if (found.row.seller_id !== userId) return res.status(403).json({ error: 'Sem permissão para aprovar este afiliado' });

    const now = new Date();
    const tbl = found.table;
    await neonQuery(async (sql) => {
      await sql`UPDATE ${sql(tbl)} SET status = 'approved', approved_at = ${now}, updated_at = ${now} WHERE id = ${affiliateId}`;
    }, `approveAffiliate2:${affiliateId}`);

    console.log(`✅ AFILIADO APROVADO: ${affiliateId}`);
    res.json({ success: true, message: 'Afiliado aprovado com sucesso' });

  } catch (error) {
    console.error('❌ Erro ao aprovar afiliado:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/affiliate/reject - Rejeitar afiliado
affiliationsRouter.post('/api/affiliate/reject', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { affiliateId } = req.body;
    const userId = req.user.uid;
    console.log(`❌ REJEITANDO AFILIADO: ${affiliateId} por seller ${userId}`);

    const found = await findAffiliationOrAffiliate(affiliateId);
    if (!found) return res.status(404).json({ error: 'Afiliado não encontrado' });
    if (found.row.seller_id !== userId) return res.status(403).json({ error: 'Sem permissão para rejeitar este afiliado' });

    const now = new Date();
    const tbl = found.table;
    await neonQuery(async (sql) => {
      await sql`UPDATE ${sql(tbl)} SET status = 'rejected', updated_at = ${now} WHERE id = ${affiliateId}`;
    }, `rejectAffiliate2:${affiliateId}`);

    console.log(`❌ AFILIADO REJEITADO: ${affiliateId}`);
    res.json({ success: true, message: 'Afiliado rejeitado' });

  } catch (error) {
    console.error('❌ Erro ao rejeitar afiliado:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/affiliate/track-click - Rastrear clique (public, no auth)
affiliationsRouter.post('/api/affiliate/track-click', async (req, res) => {
  try {
    const { affiliateId, checkoutId, referrer } = req.body;
    if (!affiliateId || !checkoutId) return res.status(400).json({ error: 'affiliateId e checkoutId são obrigatórios' });
    console.log(`🎯 RASTREANDO CLIQUE: Afiliado ${affiliateId} → Produto ${checkoutId}`);

    // Verificar se afiliado e checkout existem no Neon
    let sellerId: string | null = null;
    let affFound = false;
    let affTable: 'affiliates' | 'affiliations' = 'affiliates';

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, seller_id FROM affiliates WHERE id = ${affiliateId} LIMIT 1`;
      if (rows[0]) { affFound = true; sellerId = rows[0].seller_id; affTable = 'affiliates'; }
    }, `trackClickAffiliateCheck:${affiliateId}`);

    if (!affFound) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT id, seller_id FROM affiliations WHERE id = ${affiliateId} AND product_id = ${checkoutId} LIMIT 1`;
        if (rows[0]) { affFound = true; sellerId = rows[0].seller_id; affTable = 'affiliations'; }
      }, `trackClickAffiliationCheck:${affiliateId}`);
    }

    if (!affFound) {
      // Tentar por checkout/seller da orders — registrar click mesmo sem afiliado direto
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT tenant_id FROM checkouts WHERE id = ${checkoutId} LIMIT 1`;
        if (rows[0]) sellerId = rows[0].tenant_id;
      }, `trackClickCheckout:${checkoutId}`);
    }

    const clickId = `click_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';

    await neonQuery(async (sql) => {
      await sql`INSERT INTO affiliate_clicks (id, affiliate_id, checkout_id, seller_id, ip_address, user_agent, referrer, converted, clicked_at, created_at)
        VALUES (${clickId}, ${affiliateId}, ${checkoutId}, ${sellerId}, ${ip}, ${ua}, ${referrer || ''}, false, ${now}, ${now})
        ON CONFLICT (id) DO NOTHING`;
    }, `trackClickInsert:${clickId}`);

    // Incrementar total_clicks no afiliado
    if (affFound) {
      await neonQuery(async (sql) => {
        if (affTable === 'affiliates') {
          await sql`UPDATE affiliates SET total_clicks = COALESCE(total_clicks,0) + 1, updated_at = ${now} WHERE id = ${affiliateId}`;
        } else {
          await sql`UPDATE affiliations SET total_clicks = COALESCE(total_clicks,0) + 1, updated_at = ${now} WHERE id = ${affiliateId}`;
        }
      }, `trackClickIncrement:${affiliateId}`);
    }

    console.log(`✅ CLIQUE RASTREADO: ${clickId}`);
    res.json({ success: true, clickId, message: 'Clique rastreado com sucesso' });

  } catch (error) {
    console.error('❌ Erro ao rastrear clique:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/affiliate/commissions/:userId - Buscar comissões
affiliationsRouter.get('/api/affiliate/commissions/:userId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;
    const requesterId = req.user.uid;
    if (userId !== requesterId) {
      const isAdmin = await checkAdminAccess(requesterId);
      if (!isAdmin) return res.status(403).json({ error: 'Sem permissão para ver comissões de outro usuário' });
    }
    console.log(`💰 BUSCANDO COMISSÕES: usuário ${userId}, status: ${status || 'todos'}`);

    let commissions: any[] = [];
    await neonQuery(async (sql) => {
      if (status && status !== 'all') {
        commissions = await sql`SELECT * FROM affiliate_commissions WHERE affiliate_id = ${userId} AND status = ${status as string} ORDER BY created_at DESC LIMIT 100`;
      } else {
        commissions = await sql`SELECT * FROM affiliate_commissions WHERE affiliate_id = ${userId} ORDER BY created_at DESC LIMIT 100`;
      }
    }, `affiliateCommissions:${userId}`);

    console.log(`✅ ${commissions.length} comissões encontradas`);
    res.json(commissions);
  } catch (error) {
    console.error('❌ Erro ao buscar comissões:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/affiliate/clicks/:userId - Buscar cliques por usuário
affiliationsRouter.get('/api/affiliate/clicks/:userId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { userId } = req.params;
    const requesterId = req.user.uid;
    if (userId !== requesterId) {
      const isAdmin = await checkAdminAccess(requesterId);
      if (!isAdmin) return res.status(403).json({ error: 'Acesso negado - apenas admins podem consultar dados de outros usuários' });
    }
    console.log(`🔗 BUSCANDO CLIQUES para usuário: ${userId}`);

    let clicks: any[] = [];
    await neonQuery(async (sql) => {
      clicks = await sql`SELECT * FROM affiliate_clicks WHERE affiliate_id = ${userId} ORDER BY clicked_at DESC LIMIT 100`;
    }, `affiliateClicks:${userId}`);

    console.log(`✅ ${clicks.length} cliques encontrados para usuário ${userId}`);
    res.json(clicks);
  } catch (error) {
    console.error('❌ Erro ao buscar cliques:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/affiliate/commissions/direct/:affiliateUid - Buscar comissões diretas
affiliationsRouter.get('/api/affiliate/commissions/direct/:affiliateUid', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { affiliateUid } = req.params;
    const requesterId = req.user.uid;
    if (affiliateUid !== requesterId) {
      const isAdmin = await checkAdminAccess(requesterId);
      if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' });
    }
    console.log(`💰 BUSCANDO COMISSÕES DIRETAS: ${affiliateUid}`);

    let commissions: any[] = [];
    await neonQuery(async (sql) => {
      commissions = await sql`SELECT * FROM affiliate_commissions WHERE affiliate_id = ${affiliateUid} ORDER BY created_at DESC LIMIT 50`;
    }, `affiliateCommissionsDirect:${affiliateUid}`);

    console.log(`✅ ${commissions.length} comissões encontradas (diretas)`);
    res.json(commissions);
  } catch (error) {
    console.error('❌ Erro ao buscar comissões diretas:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/affiliate/product-affiliates/:productId/:sellerId - Buscar afiliados de um produto
affiliationsRouter.get('/api/affiliate/product-affiliates/:productId/:sellerId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId, sellerId } = req.params;
    const userId = req.user.uid;
    if (sellerId !== userId) {
      const isAdmin = await checkAdminAccess(userId);
      if (!isAdmin) return res.status(403).json({ error: 'Sem permissão para ver afiliados deste produto' });
    }
    console.log(`🔍 BUSCANDO AFILIADOS: Produto ${productId}, Seller ${sellerId}`);

    let affiliates: any[] = [];
    await neonQuery(async (sql) => {
      const fromAffiliates = await sql`SELECT * FROM affiliates WHERE checkout_id = ${productId} AND seller_id = ${sellerId} ORDER BY created_at DESC`;
      const fromAffiliations = await sql`SELECT * FROM affiliations WHERE product_id = ${productId} AND seller_id = ${sellerId} ORDER BY created_at DESC`;
      affiliates = [...fromAffiliates, ...fromAffiliations];
    }, `affiliateProductAffiliates:${productId}`);

    console.log(`✅ ${affiliates.length} afiliados encontrados para produto ${productId}`);
    res.json(affiliates);
  } catch (error) {
    console.error('❌ Erro ao buscar afiliados do produto:', error);
    res.json([]);
  }
});

// POST /api/affiliate/batch/approve - Aprovar todos pendentes (batch)
affiliationsRouter.post('/api/affiliate/batch/approve', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.body;
    const userId = req.user.uid;
    if (!checkoutId) return res.status(400).json({ error: 'checkoutId é obrigatório' });
    console.log(`✅ APROVANDO TODOS AFILIADOS PENDENTES: Produto ${checkoutId}, Seller ${userId}`);

    const now = new Date();
    let count = 0;
    await neonQuery(async (sql) => {
      const r1 = await sql`UPDATE affiliates SET status = 'approved', approved_at = ${now}, updated_at = ${now}
        WHERE checkout_id = ${checkoutId} AND seller_id = ${userId} AND status = 'pending'`;
      const r2 = await sql`UPDATE affiliations SET status = 'approved', approved_at = ${now}, updated_at = ${now}
        WHERE product_id = ${checkoutId} AND seller_id = ${userId} AND status = 'pending'`;
      count = (r1.count || 0) + (r2.count || 0);
    }, `affiliateBatchApprove:${checkoutId}`);

    console.log(`✅ ${count} AFILIADOS APROVADOS EM LOTE`);
    res.json({ success: true, message: `${count} afiliado(s) aprovado(s) com sucesso`, count });
  } catch (error) {
    console.error('❌ Erro ao aprovar afiliados em lote:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/affiliate/batch/reject - Rejeitar todos pendentes (batch)
affiliationsRouter.post('/api/affiliate/batch/reject', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId } = req.body;
    const userId = req.user.uid;
    if (!checkoutId) return res.status(400).json({ error: 'checkoutId é obrigatório' });
    console.log(`❌ REJEITANDO TODOS AFILIADOS PENDENTES: Produto ${checkoutId}, Seller ${userId}`);

    const now = new Date();
    let count = 0;
    await neonQuery(async (sql) => {
      const r1 = await sql`UPDATE affiliates SET status = 'rejected', updated_at = ${now}
        WHERE checkout_id = ${checkoutId} AND seller_id = ${userId} AND status = 'pending'`;
      const r2 = await sql`UPDATE affiliations SET status = 'rejected', updated_at = ${now}
        WHERE product_id = ${checkoutId} AND seller_id = ${userId} AND status = 'pending'`;
      count = (r1.count || 0) + (r2.count || 0);
    }, `affiliateBatchReject:${checkoutId}`);

    console.log(`❌ ${count} AFILIADOS REJEITADOS EM LOTE`);
    res.json({ success: true, message: `${count} afiliado(s) rejeitado(s)`, count });
  } catch (error) {
    console.error('❌ Erro ao rejeitar afiliados em lote:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/affiliate/batch/update-commission - Atualizar comissão de todos (batch)
affiliationsRouter.post('/api/affiliate/batch/update-commission', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, customCommission } = req.body;
    const userId = req.user.uid;
    if (!checkoutId || customCommission === undefined) return res.status(400).json({ error: 'checkoutId e customCommission são obrigatórios' });
    if (customCommission < 0 || customCommission > 100) return res.status(400).json({ error: 'Comissão deve estar entre 0 e 100' });
    console.log(`💰 ATUALIZANDO COMISSÃO DE TODOS: Produto ${checkoutId}, Comissão ${customCommission}%`);

    const now = new Date();
    let count = 0;
    await neonQuery(async (sql) => {
      const r1 = await sql`UPDATE affiliates SET custom_commission = ${Number(customCommission)}, updated_at = ${now}
        WHERE checkout_id = ${checkoutId} AND seller_id = ${userId} AND status = 'approved'`;
      const r2 = await sql`UPDATE affiliations SET custom_commission = ${Number(customCommission)}, updated_at = ${now}
        WHERE product_id = ${checkoutId} AND seller_id = ${userId} AND status = 'approved'`;
      count = (r1.count || 0) + (r2.count || 0);
    }, `affiliateBatchCommission:${checkoutId}`);

    console.log(`✅ COMISSÃO ATUALIZADA PARA ${count} AFILIADOS: ${customCommission}%`);
    res.json({ success: true, message: `Comissão de ${count} afiliado(s) atualizada para ${customCommission}%`, count, customCommission });
  } catch (error) {
    console.error('❌ Erro ao atualizar comissão em lote:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/affiliate/request - Solicitar afiliação (alternativo ao register)
affiliationsRouter.post('/api/affiliate/request', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { checkoutId, sellerId } = req.body;
    const userId = req.user.uid;
    if (!checkoutId || !sellerId) return res.status(400).json({ error: 'checkoutId e sellerId são obrigatórios' });
    console.log(`🔗 SOLICITAÇÃO DE AFILIAÇÃO: User ${userId} para produto ${checkoutId}`);

    // Verificar duplicata no Neon
    let existing: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status FROM affiliates WHERE user_id = ${userId} AND checkout_id = ${checkoutId} AND seller_id = ${sellerId} LIMIT 1`;
      if (rows[0]) existing = rows[0];
    }, `affiliateRequestCheck:${userId}`);
    if (existing) return res.status(409).json({ error: 'Você já solicitou afiliação para este produto', affiliate: existing });

    // Buscar dados do seller do Neon
    let affiliateName = 'Afiliado', affiliateEmail = '';
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT name, business_name, email FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (rows[0]) { affiliateName = rows[0].name || rows[0].business_name || 'Afiliado'; affiliateEmail = rows[0].email || ''; }
    }, `affiliateRequestSeller:${userId}`);

    const affiliateId = `aff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    await neonQuery(async (sql) => {
      await sql`INSERT INTO affiliates
        (id, user_id, checkout_id, seller_id, name, email, status, custom_commission, total_clicks, total_sales, total_commissions, created_at, updated_at)
        VALUES (${affiliateId}, ${userId}, ${checkoutId}, ${sellerId}, ${affiliateName}, ${affiliateEmail}, 'pending', 10, 0, 0, 0, ${now}, ${now})
        ON CONFLICT (id) DO NOTHING`;
    }, `affiliateRequestInsert:${affiliateId}`);

    console.log(`✅ SOLICITAÇÃO DE AFILIAÇÃO CRIADA: ${affiliateId}`);
    res.json({ success: true, message: 'Solicitação de afiliação enviada para análise', affiliate: { id: affiliateId, userId, checkoutId, sellerId, name: affiliateName, email: affiliateEmail, status: 'pending' } });

  } catch (error) {
    console.error('❌ Erro ao solicitar afiliação:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// POST /api/affiliate/withdrawals - Solicitar saque de afiliado
affiliationsRouter.post('/api/affiliate/withdrawals', verifyFirebaseToken, userRateLimit('withdrawal'), replayProtectionMiddleware, idempotencyMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { paymentMethod, amount } = req.body;
    const userId = req.user.uid;
    if (!paymentMethod || !['pix', 'card', 'boleto'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Método de pagamento inválido (pix, card ou boleto)' });
    }
    console.log(`💸 SOLICITAÇÃO DE SAQUE DE AFILIADO: ${userId} - Método: ${paymentMethod}`);

    // Calcular saldo disponível do Neon (mesma lógica do GET balance mas simplificada)
    let affiliateCodes: string[] = [userId];
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT affiliate_code FROM affiliates WHERE user_id = ${userId} AND affiliate_code IS NOT NULL
        UNION SELECT affiliate_code FROM affiliations WHERE affiliate_id = ${userId} AND affiliate_code IS NOT NULL`;
      rows.forEach((r: any) => { if (r.affiliate_code && !affiliateCodes.includes(r.affiliate_code)) affiliateCodes.push(r.affiliate_code); });
    }, `affiliateWithdrawalCodes:${userId}`);

    let available = 0;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT COALESCE(SUM(COALESCE(affiliate_commission_net, commission_amount, 0)), 0) AS total
        FROM orders WHERE status IN ('paid','approved','completed')
        AND (affiliate_uid = ANY(${affiliateCodes}::text[]) OR affiliate_id = ANY(${affiliateCodes}::text[]) OR affiliate_code = ANY(${affiliateCodes}::text[]))`;
      available = Number(rows[0]?.total || 0);
    }, `affiliateWithdrawalBalance:${userId}`);

    // Subtrair saques anteriores
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT COALESCE(SUM(amount),0) AS total FROM affiliate_withdrawals WHERE user_id = ${userId} AND status IN ('pending','processing','completed','approved')`;
      available -= Number(rows[0]?.total || 0);
    }, `affiliateWithdrawalPrevious:${userId}`);
    if (available < 0) available = 0;

    const withdrawAmount = amount || available;
    if (withdrawAmount <= 0) return res.status(400).json({ error: 'Saldo insuficiente para saque' });

    const withdrawalId = `aff_wd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    await neonQuery(async (sql) => {
      await sql`INSERT INTO affiliate_withdrawals (id, user_id, amount, payment_method, status, created_at, updated_at)
        VALUES (${withdrawalId}, ${userId}, ${withdrawAmount}, ${paymentMethod}, 'pending', ${now}, ${now})
        ON CONFLICT (id) DO NOTHING`;
    }, `affiliateWithdrawalInsert:${withdrawalId}`);

    console.log(`✅ SAQUE SOLICITADO: ${withdrawalId} - R$ ${withdrawAmount}`);
    res.json({ success: true, message: 'Solicitação de saque enviada para análise', withdrawal: { id: withdrawalId, amount: withdrawAmount, paymentMethod, status: 'pending' } });

  } catch (error) {
    console.error('❌ Erro ao solicitar saque de afiliado:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/affiliate/withdrawals - Histórico de saques de afiliado
affiliationsRouter.get('/api/affiliate/withdrawals', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user.uid;
    console.log(`📊 BUSCANDO HISTÓRICO DE SAQUES DE AFILIADO: ${userId}`);

    let withdrawals: any[] = [];
    await neonQuery(async (sql) => {
      withdrawals = await sql`SELECT * FROM affiliate_withdrawals WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`;
    }, `affiliateWithdrawals:${userId}`);

    console.log(`✅ ${withdrawals.length} saques encontrados`);
    res.json(withdrawals);
  } catch (error) {
    console.error('❌ Erro ao buscar histórico de saques:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// GET /api/affiliate/dashboard-stats - Dashboard stats para seller
affiliationsRouter.get('/api/affiliate/dashboard-stats', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user.uid;
    console.log(`📊 BUSCANDO ESTATÍSTICAS DE AFILIADOS: ${sellerId}`);

    let stats: any = { totalAffiliates: 0, totalAffiliateSales: 0, totalRevenue: 0, totalCommissionsPaid: 0, netProfit: 0 };
    await neonQuery(async (sql) => {
      const [affRow] = await sql`SELECT COUNT(*) AS total FROM (
        SELECT id FROM affiliations WHERE seller_id = ${sellerId} AND status = 'approved'
        UNION ALL SELECT id FROM affiliates WHERE seller_id = ${sellerId} AND status = 'approved'
      ) t`;
      const [salesRow] = await sql`SELECT COUNT(*) AS total, COALESCE(SUM(COALESCE(net_amount, seller_net_amount, amount, 0)),0) AS revenue,
        COALESCE(SUM(COALESCE(affiliate_commission_net, commission_amount, 0)),0) AS commissions
        FROM orders WHERE tenant_id = ${sellerId} AND is_affiliate_sale = true AND status IN ('paid','approved','completed')`;
      stats.totalAffiliates = Number(affRow?.total || 0);
      stats.totalAffiliateSales = Number(salesRow?.total || 0);
      stats.totalRevenue = Number(salesRow?.revenue || 0);
      stats.totalCommissionsPaid = Number(salesRow?.commissions || 0);
      stats.netProfit = stats.totalRevenue - stats.totalCommissionsPaid;
    }, `affiliateDashboardStats:${sellerId}`);

    console.log(`✅ Stats: Afiliados=${stats.totalAffiliates}, Vendas=${stats.totalAffiliateSales}`);
    res.json(stats);
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas de afiliados:', error);
    res.status(500).json({ error: 'Erro interno do servidor', details: error instanceof Error ? error.message : String(error) });
  }
});

// =============================================
// COOKIE-BASED AFFILIATE TRACKING (Enterprise)
// =============================================

const COOKIE_DURATIONS: Record<string, number> = {
  '60': 60 * 24 * 60 * 60 * 1000,
  '90': 90 * 24 * 60 * 60 * 1000,
  '120': 120 * 24 * 60 * 60 * 1000,
  '180': 180 * 24 * 60 * 60 * 1000,
};

type AttributionModel = 'first_click' | 'last_click' | 'multi_touch';

interface AffiliateClickData {
  affiliateCode: string;
  affiliateId: string;
  productId: string;
  checkoutSlug: string;
  clickedAt: string;
  attributionModel: AttributionModel;
  cookieDurationDays: number;
}

affiliationsRouter.get('/api/affiliate/track', async (req, res) => {
  try {
    const { aff, ref, slug, productId } = req.query;
    const affiliateCode = (aff || ref) as string;

    if (!affiliateCode || !slug) {
      return res.redirect(`/checkout/${slug || ''}`);
    }

    // Buscar afiliação no Neon por code/slug
    let affiliation: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT id, affiliate_id, product_id AS checkout_id, seller_id FROM affiliations
        WHERE (affiliate_id = ${affiliateCode} OR affiliate_code = ${affiliateCode}) AND status = 'approved' LIMIT 5
        UNION
        SELECT id, user_id AS affiliate_id, checkout_id, seller_id FROM affiliates
        WHERE (affiliate_code = ${affiliateCode} OR affiliate_slug = ${affiliateCode}) AND status = 'approved' LIMIT 5`;
      if (productId) {
        affiliation = rows.find((r: any) => r.checkout_id === productId) || rows[0] || null;
      } else {
        affiliation = rows[0] || null;
      }
    }, `affiliateTrack:${affiliateCode}`);

    if (!affiliation) return res.redirect(`/checkout/${slug}`);

    // Buscar config do checkout no Neon
    let cookieDurationDays = 90;
    let attributionModel: AttributionModel = 'last_click';
    if (productId) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT affiliate, config FROM checkouts WHERE id = ${productId as string} LIMIT 1`;
        if (rows[0]) {
          const aff = rows[0].affiliate || {};
          const cfg = rows[0].config || {};
          cookieDurationDays = aff.cookieDurationDays || cfg.affiliateConfig?.cookieDurationDays || 90;
          attributionModel = aff.attributionModel || cfg.affiliateConfig?.attributionModel || 'last_click';
        }
      }, `affiliateTrackCheckout:${productId}`);
    }

    const cookieMaxAge = COOKIE_DURATIONS[String(cookieDurationDays)] || COOKIE_DURATIONS['90'];

    const clickData: AffiliateClickData = {
      affiliateCode,
      affiliateId: affiliation.affiliate_id,
      productId: affiliation.checkout_id || (productId as string) || '',
      checkoutSlug: slug as string,
      clickedAt: new Date().toISOString(),
      attributionModel,
      cookieDurationDays
    };

    const cookieName = `cc_aff_${(slug as string).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const existingCookie = req.cookies?.[cookieName];
    let shouldSetCookie = true;
    if (existingCookie && attributionModel === 'first_click') {
      try {
        const existing = JSON.parse(existingCookie);
        if (existing.affiliateCode && existing.clickedAt) shouldSetCookie = false;
      } catch {}
    }
    if (shouldSetCookie) {
      res.cookie(cookieName, JSON.stringify(clickData), {
        maxAge: cookieMaxAge, httpOnly: false,
        secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/'
      });
    }

    // Registrar click no Neon (fire-and-forget)
    const clickId = `click_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    neonQuery(async (sql) => {
      await sql`INSERT INTO affiliate_clicks (id, affiliate_id, checkout_id, seller_id, ip_address, user_agent, referrer, converted, clicked_at, created_at)
        VALUES (${clickId}, ${affiliation.affiliate_id}, ${affiliation.checkout_id || ''}, ${affiliation.seller_id || null},
          ${((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown')},
          ${req.headers['user-agent'] || ''}, ${req.headers['referer'] || ''}, false, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING`;
    }, `affiliateTrackClick:${clickId}`).catch(() => {});

    return res.redirect(`/checkout/${slug}?aff=${affiliateCode}`);
  } catch (error) {
    console.error('❌ Erro no tracking de afiliado:', error);
    return res.redirect(`/checkout/${req.query.slug || ''}`);
  }
});

affiliationsRouter.post('/api/affiliate/resolve', async (req, res) => {
  try {
    const { checkoutSlug, affiliateUidFromUrl, cookieData, productId } = req.body;
    if (!checkoutSlug && !productId) return res.status(400).json({ error: 'checkoutSlug ou productId obrigatório' });

    // Buscar attributionModel do checkout no Neon
    let attributionModel: AttributionModel = 'last_click';
    if (productId) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT affiliate, config FROM checkouts WHERE id = ${productId} LIMIT 1`;
        if (rows[0]) {
          const aff = rows[0].affiliate || {};
          const cfg = rows[0].config || {};
          attributionModel = aff.attributionModel || cfg.affiliateConfig?.attributionModel || 'last_click';
        }
      }, `affiliateResolveCheckout:${productId}`);
    }

    let resolvedAffiliateUid: string | null = null;
    let resolvedSource = 'none';
    let touchPoints: AffiliateClickData[] = [];

    if (cookieData) {
      try {
        const parsed = typeof cookieData === 'string' ? JSON.parse(cookieData) : cookieData;
        if (parsed.affiliateCode) touchPoints.push(parsed);
      } catch {}
    }

    switch (attributionModel) {
      case 'first_click':
        resolvedAffiliateUid = touchPoints[0]?.affiliateCode || affiliateUidFromUrl || null;
        resolvedSource = touchPoints[0]?.affiliateCode ? 'cookie_first_click' : (affiliateUidFromUrl ? 'url_param' : 'none');
        break;
      case 'last_click':
        resolvedAffiliateUid = affiliateUidFromUrl || touchPoints[touchPoints.length - 1]?.affiliateCode || null;
        resolvedSource = affiliateUidFromUrl ? 'url_param' : (touchPoints.length > 0 ? 'cookie_last_click' : 'none');
        break;
      case 'multi_touch':
        resolvedAffiliateUid = affiliateUidFromUrl || touchPoints[touchPoints.length - 1]?.affiliateCode || null;
        resolvedSource = affiliateUidFromUrl ? 'url_param_multi' : (touchPoints.length > 0 ? 'cookie_multi_touch' : 'none');
        break;
    }

    res.json({ affiliateUid: resolvedAffiliateUid, source: resolvedSource, attributionModel, touchPoints: touchPoints.length, resolved: !!resolvedAffiliateUid });
  } catch (error) {
    console.error('❌ Erro ao resolver afiliado:', error);
    res.status(500).json({ error: 'Erro interno', affiliateUid: null, resolved: false });
  }
});

affiliationsRouter.put('/api/products/:productId/affiliate-config/attribution', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const { productId } = req.params;
    const { attributionModel, cookieDurationDays } = req.body;

    const validModels: AttributionModel[] = ['first_click', 'last_click', 'multi_touch'];
    if (attributionModel && !validModels.includes(attributionModel)) return res.status(400).json({ error: 'Modelo de atribuição inválido' });
    const validDurations = [60, 90, 120, 180];
    if (cookieDurationDays && !validDurations.includes(cookieDurationDays)) return res.status(400).json({ error: 'Duração do cookie inválida' });

    // Verificar propriedade no Neon
    let product: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id, affiliate, config FROM checkouts WHERE id = ${productId} LIMIT 1`;
      if (rows[0]) product = rows[0];
    }, `affiliateAttrConfigGet:${productId}`);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
    if (product.tenant_id !== userId) return res.status(403).json({ error: 'Sem permissão' });

    // Atualizar affiliate jsonb no Neon
    const currentAff = product.affiliate || {};
    const newAff = {
      ...currentAff,
      ...(attributionModel ? { attributionModel } : {}),
      ...(cookieDurationDays ? { cookieDurationDays } : {}),
    };
    const now = new Date();
    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET affiliate = ${JSON.stringify(newAff)}, updated_at = ${now} WHERE id = ${productId}`;
    }, `affiliateAttrConfigUpdate:${productId}`);

    res.json({
      success: true, message: 'Configuração de atribuição atualizada',
      attributionModel: attributionModel || currentAff.attributionModel || 'last_click',
      cookieDurationDays: cookieDurationDays || currentAff.cookieDurationDays || 90
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar config de atribuição:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

affiliationsRouter.get('/api/affiliate/clicks/:productId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const { productId } = req.params;
    const { days = '30' } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days as string, 10));

    let clicks: any[] = [];
    await neonQuery(async (sql) => {
      clicks = await sql`SELECT id, affiliate_id, affiliate_id AS affiliate_code, clicked_at, referrer, created_at
        FROM affiliate_clicks WHERE checkout_id = ${productId} AND created_at >= ${daysAgo}
        ORDER BY created_at DESC LIMIT 500`;
    }, `affiliateClicksProduct:${productId}`);

    const uniqueAffiliates = new Set(clicks.map((c: any) => c.affiliate_id)).size;
    const clicksByDay = clicks.reduce((acc: Record<string, number>, click: any) => {
      const day = click.clicked_at?.toISOString?.()?.split('T')[0] || 'unknown';
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    res.json({ totalClicks: clicks.length, uniqueAffiliates, clicksByDay, clicks: clicks.slice(0, 100) });
  } catch (error) {
    console.error('❌ Erro ao buscar clicks:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/admin/affiliate/reprocess-commission - Reprocessar comissão de afiliado para uma ordem
affiliationsRouter.post('/api/admin/affiliate/reprocess-commission', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId é obrigatório' });

    let orderData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
      if (rows[0]) orderData = rows[0];
    }, `adminReprocessOrder:${orderId}`);
    if (!orderData) return res.status(404).json({ error: 'Ordem não encontrada' });

    const affiliateIdentifier = orderData.affiliate_code || orderData.affiliate_uid || orderData.affiliate_id;
    if (!affiliateIdentifier) return res.status(400).json({ error: 'Ordem não possui código de afiliado' });

    const status = orderData.status;
    if (status !== 'paid' && status !== 'completed' && status !== 'CONCLUIDA') {
      return res.status(400).json({ error: `Ordem não está paga (status: ${status})` });
    }

    console.log(`🔄 [ADMIN] Reprocessando comissão para ordem ${orderId}, afiliado: ${affiliateIdentifier}`);
    await storage.processAffiliateCommission({ ...orderData, id: orderId });

    console.log(`✅ [ADMIN] Comissão reprocessada com sucesso para ordem ${orderId}`);
    res.json({ success: true, message: `Comissão reprocessada para afiliado ${affiliateIdentifier}` });
  } catch (error: any) {
    console.error('❌ [ADMIN] Erro ao reprocessar comissão:', error);
    res.status(500).json({ error: error.message || 'Erro ao reprocessar comissão' });
  }
});

// GET /api/admin/affiliate/pending-commissions - Ordens pagas com afiliado sem comissão
affiliationsRouter.get('/api/admin/affiliate/pending-commissions', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    let orders: any[] = [];
    await neonQuery(async (sql) => {
      orders = await sql`SELECT id, affiliate_code, affiliate_uid, affiliate_id, amount, status, created_at
        FROM orders WHERE status = 'paid' AND affiliate_commission_processed IS NOT TRUE
        AND (affiliate_code IS NOT NULL OR affiliate_uid IS NOT NULL OR affiliate_id IS NOT NULL)
        ORDER BY created_at DESC LIMIT 50`;
    }, `adminPendingCommissions`);

    res.json({ count: orders.length, orders });
  } catch (error: any) {
    console.error('❌ Erro ao listar comissões pendentes:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Aliases para compatibilidade com frontend ──────────────────────────────

affiliationsRouter.get('/api/affiliates/my-links', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    let links: any[] = [];
    await neonQuery(async (sql) => {
      links = await sql`
        SELECT aff.id, aff.affiliate_code, aff.affiliate_link, aff.status,
               aff.total_sales, aff.total_earnings, aff.commission_snapshot, aff.created_at,
               c.title AS product_name, c.logo_url AS product_image, c.id AS checkout_id
        FROM affiliations aff
        LEFT JOIN checkouts c ON c.id = aff.product_id
        WHERE aff.affiliate_id = ${userId}
        ORDER BY aff.created_at DESC LIMIT 100
      `;
    }, `affiliateMyLinks:${userId}`);

    const affiliateLinks = links.map(l => ({
      id: l.id,
      affiliateCode: l.affiliate_code,
      affiliateLink: l.affiliate_link,
      status: l.status,
      totalSales: l.total_sales || 0,
      totalEarnings: l.total_earnings || 0,
      commissionSnapshot: l.commission_snapshot,
      productName: l.product_name || 'Produto',
      productImage: l.product_image || null,
      checkoutId: l.checkout_id,
      createdAt: l.created_at,
    }));

    res.json({ links: affiliateLinks, total: affiliateLinks.length });
  } catch (error: any) {
    console.error('❌ GET /api/affiliates/my-links error:', error?.message);
    res.status(500).json({ error: error?.message || 'Erro interno' });
  }
});

affiliationsRouter.post('/api/affiliates/links', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const productId = req.body.productId || req.body.checkoutId || req.body.product_id;
  if (!productId) return res.status(400).json({ error: 'productId é obrigatório' });
  req.body.productId = productId;

  const userId = req.user?.uid;
  const userEmail = req.user?.email || '';

  try {
    let product: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM checkouts WHERE id = ${productId} LIMIT 1`;
      if (rows[0]) product = rows[0];
    }, `affiliateLinkCheckout:${productId}`);

    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

    const affiliateConfig = product.affiliate || product.config?.affiliateConfig || {};
    if (!affiliateConfig.enabled) return res.status(400).json({ error: 'Este produto não aceita afiliados' });

    let existingAff: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status FROM affiliations WHERE affiliate_id = ${userId} AND product_id = ${productId} LIMIT 1`;
      if (rows[0]) existingAff = rows[0];
    }, `affiliateLinkExists:${userId}:${productId}`);

    if (existingAff) return res.status(400).json({ error: 'Você já é afiliado deste produto', affiliation: existingAff });

    const { generateAffiliationId } = await import('../../shared/schema.js');
    const { generateUniqueAffiliateCode } = await import('../lib/affiliate-code-generator');
    const { getFirestore } = await import('../lib/firebase-admin.js');
    const db = getFirestore();
    const affiliateCode = await generateUniqueAffiliateCode(db);
    const affiliationId = generateAffiliationId();
    const affiliateLink = `${getBaseDomain()}/c/${productId}?aff=${affiliateCode}`;
    const autoApprove = affiliateConfig.autoApprove !== false;
    const status = autoApprove ? 'approved' : 'pending';

    let sellerName = 'Vendedor';
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT name, business_name FROM sellers WHERE id = ${product.tenant_id} LIMIT 1`;
      if (rows[0]) sellerName = rows[0].business_name || rows[0].name || 'Vendedor';
    }, `affiliateLinkSeller:${product.tenant_id}`);

    const now = new Date();
    await neonQuery(async (sql) => {
      await sql`INSERT INTO affiliations (id, affiliate_id, affiliate_name, affiliate_email, product_id, product_name, seller_id, seller_name, status, affiliate_code, affiliate_link, commission_snapshot, total_sales, total_earnings, approved_at, created_at, updated_at)
        VALUES (${affiliationId}, ${userId}, ${userEmail.split('@')[0]}, ${userEmail}, ${productId}, ${product.title || 'Produto'}, ${product.tenant_id}, ${sellerName}, ${status}, ${affiliateCode}, ${affiliateLink}, ${JSON.stringify({ single: affiliateConfig.commissions?.single ?? 10 })}::jsonb, 0, 0, ${autoApprove ? now : null}, ${now}, ${now})`;
    }, `affiliateLinkCreate:${affiliationId}`);

    res.status(201).json({ id: affiliationId, affiliateCode, affiliateLink, status });
  } catch (error: any) {
    console.error('❌ POST /api/affiliates/links error:', error?.message);
    res.status(500).json({ error: error?.message || 'Erro interno' });
  }
});

export default affiliationsRouter;
