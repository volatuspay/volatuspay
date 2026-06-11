/**
 * 🌍 VITRINE PÚBLICA - Rota de Showcase de Produtos
 * GET /api/showcase/checkouts - Retorna produtos reais para vitrine
 */

import { Router } from 'express';
import { storage } from '../storage.js';
import { firestoreCache, withFirestoreTimeout } from '../lib/firestore-cache.js';

const router = Router();

async function getFirestoreDb(): Promise<any> {
  const fs = storage as any;
  if (fs.db) return fs.db;
  try {
    const { getAdmin, ensureFirebaseReady } = await import('../lib/firebase-admin.js');
    await ensureFirebaseReady();
    return getAdmin().firestore();
  } catch {
    return null;
  }
}

/** Resolve a imagem de um produto com fallback completo em todos os campos possíveis */
function isPublicUrl(url: any): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('/images/') ||
    trimmed.startsWith('/api/images/')
  );
}

function resolveProductImage(productData: any, checkoutData: any): string | null {
  // Tenta primeiro no produto real (prioridade máxima)
  if (productData && !productData.deleted && !productData.deletedAt) {
    const candidates = [
      productData.imageUrl,
      productData.image,
      productData.coverImage,
      productData.thumbnail,
      productData.productImage,
      productData.logoUrl,
      productData.bannerUrl,
      Array.isArray(productData.photos) && productData.photos.length > 0 ? productData.photos[0] : null,
    ];
    const fromProduct = candidates.find(isPublicUrl) ?? null;
    if (fromProduct) return fromProduct;
  }
  // Fallback no checkout — só URLs publicamente acessíveis
  if (checkoutData) {
    const candidates = [
      checkoutData.imageUrl,
      checkoutData.image,
      checkoutData.logoUrl,
      checkoutData.bannerUrl,
      checkoutData.thumbnail,
    ];
    return candidates.find(isPublicUrl) ?? null;
  }
  return null;
}

/**
 * 🌍 PUBLIC: GET /api/showcase/checkouts
 * Vitrine pública com produtos reais do Firebase
 */
router.get('/checkouts', async (req, res) => {
  try {
    const { search = '', category = 'all', affiliateOnly = 'false' } = req.query;

    // Tentar usar cache do Firestore primeiro
    const cachedShowcase = firestoreCache.getShowcaseFromCache('all');
    if (cachedShowcase !== undefined) {
      let filtered = cachedShowcase;
      if (search) {
        filtered = filtered.filter((c: any) => 
          c.title?.toLowerCase().includes(String(search).toLowerCase()) ||
          c.description?.toLowerCase().includes(String(search).toLowerCase()) ||
          c.seller?.name?.toLowerCase().includes(String(search).toLowerCase())
        );
      }
      if (category && category !== 'all' && category !== 'profitable') {
        const normalizedCategory = category === 'subscriptions' ? 'subscription' : category;
        filtered = filtered.filter((c: any) => c.productType === normalizedCategory);
      }
      if (affiliateOnly === 'true') {
        filtered = filtered.filter((c: any) => c.isAffiliate);
      }
      return res.json(filtered);
    }

    // Obter firebaseStorage.db via Firebase Admin SDK (fallback se storage não tiver .db)
    const firebaseStorage = storage as any;
    let firestoreDb = firebaseStorage.db;
    if (!firestoreDb) {
      try {
        const { getAdmin, ensureFirebaseReady } = await import('../lib/firebase-admin.js');
        await ensureFirebaseReady();
        firestoreDb = getAdmin().firestore();
      } catch (_e) {
        firestoreDb = null;
      }
    }

    if (!firestoreDb) {
      // Fallback completo: usar Neon para vitrine
      const { neonQuery } = await import('../lib/neon-db.js');
      let checkouts: any[] = [];
      await neonQuery(async (sql) => {
        checkouts = await sql`
          SELECT c.id, c.title, c.subtitle, c.logo_url, c.pricing, c.affiliate, c.product_type, c.tenant_id,
                 c.sales_count, c.created_at, s.business_name, s.photo_url AS seller_photo
          FROM checkouts c
          LEFT JOIN sellers s ON s.id = c.tenant_id
          WHERE c.active = TRUE AND (c.deleted = FALSE OR c.deleted IS NULL)
            AND (c.affiliate->>'enabled')::boolean = TRUE
            AND (c.affiliate->>'marketplaceEnabled')::boolean = TRUE
          ORDER BY c.created_at DESC LIMIT 200
        `;
      }, 'showcaseNeonFallback');

      const formatted = checkouts.map((c: any) => {
        const pricing = typeof c.pricing === 'string' ? JSON.parse(c.pricing || '{}') : (c.pricing || {});
        const affiliate = typeof c.affiliate === 'string' ? JSON.parse(c.affiliate || '{}') : (c.affiliate || {});
        const price = pricing.amount || 0;
        const commission = affiliate.commissionPercent || affiliate.commissions?.single || 10;
        const title = c.title || '';
        const description = c.subtitle || '';
        const safeSlug = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50) || c.id;
        return {
          id: c.id,
          productId: c.id,
          title,
          description,
          pricing: { amount: price },
          price,
          image: c.logo_url || null,
          logoUrl: c.logo_url || null,
          imageUrl: c.logo_url || null,
          productType: c.product_type || 'digital',
          isAffiliate: true,
          affiliate: { enabled: true, autoApprove: affiliate.autoApprove || false, commissionPercent: commission },
          commission,
          category: 'all',
          seller: { name: c.business_name || 'Vendedor', businessName: c.business_name || 'Vendedor', avatar: c.seller_photo || null, uid: c.tenant_id },
          tenantId: c.tenant_id,
          sellerId: c.tenant_id,
          offers: [{ id: `synthetic_${c.id}`, uuid: `synthetic_${c.id}`, slug: safeSlug, name: title, title, price, affiliateCommission: commission, checkoutId: c.id }],
          totalSales: Number(c.sales_count || 0),
          totalRevenue: 0,
          stats: { sales: Number(c.sales_count || 0), revenue: 0, rating: 0, reviews: 0 },
          createdAt: c.created_at,
        };
      }).filter(c => c.title && c.title !== 'Sem título' && c.price > 0);

      let result = formatted;
      if (search) result = result.filter(c => c.title.toLowerCase().includes(String(search).toLowerCase()) || c.description.toLowerCase().includes(String(search).toLowerCase()));
      if (affiliateOnly === 'true') result = result.filter(c => c.isAffiliate);
      return res.json(result);
    }

    // Buscar TODOS os checkouts do Firestore
    const snapshot = await withFirestoreTimeout(firestoreDb.collection('checkouts').get()) as any;

    // Filtrar checkouts válidos para vitrine (filtros básicos apenas)
    const validCheckoutsPromises = snapshot.docs
      .filter(doc => {
        const data = doc.data();
        
        // Deve estar ativo e não deletado (soft-delete ou hard-delete)
        if (data.deleted || data.deletedAt || !data.active) return false;
        
        // 🔒 ADMIN OVERRIDE: Se admin ocultou da vitrine, não exibir
        if (data.adminHidden === true) {
          console.log(`🔒 Produto ${doc.id} oculto pelo ADMIN - não exibir na vitrine`);
          return false;
        }
        
        // ✅ CRÍTICO: Para aparecer na vitrine, AMBAS condições devem ser verdadeiras:
        // 1. Programa de afiliados habilitado (affiliateConfig.enabled)
        // 2. Exibir no marketplace habilitado (affiliateConfig.marketplaceEnabled)
        const affiliationEnabled = data.affiliateConfig?.enabled ?? data.affiliate?.enabled ?? false;
        const marketplaceEnabled = data.affiliateConfig?.marketplaceEnabled ?? data.showcase?.enabled ?? false;
        
        // Se afiliação está desabilitada, não aparecer na vitrine
        if (!affiliationEnabled) {
          console.log(`⏭️ Produto ${doc.id} com afiliação DESABILITADA - não exibir na vitrine`);
          return false;
        }
        
        // Se marketplace está desabilitado, não aparecer na vitrine
        if (!marketplaceEnabled) {
          console.log(`⏭️ Produto ${doc.id} com marketplace DESABILITADO - não exibir na vitrine`);
          return false;
        }
        
        return true;
      })
      .map(async doc => {
        const data = doc.data();
        // 🔑 BUSCAR PREÇO CORRETO: primeiro pricing.amount, depois price
        const realPrice = data.pricing?.amount || data.price || 0;
        // 🎯 BUSCAR DADOS DE AFILIADOS: primeiro de affiliate, depois de affiliateConfig
        const affiliateEnabled = data.affiliate?.enabled || data.affiliateConfig?.enabled || false;
        const affiliateData = data.affiliate || data.affiliateConfig || { enabled: false, autoApprove: false, commissionPercent: 0 };
        const commissionPercent = data.affiliate?.commissionPercent || data.affiliateConfig?.commissions?.single || data.affiliateConfig?.commissionPercent || 10;
        
        // 🔥 CRÍTICO: Usar productId correto - syncedProductId > productId > checkoutId
        const productIdToUse = data.syncedProductId || data.productId || doc.id;
        
        // 🔥 BUSCAR DADOS DO PRODUTO REAL (se existir)
        let productData = null;
        let productTitle = data.name || data.title || 'Sem título';
        let productDescription = data.description || '';
        let productImage: string | null = null;
        let productDeleted = false; // Flag para verificar se produto foi deletado
        
        try {
          const cachedProduct = await firestoreCache.getProduct(productIdToUse);
          if (cachedProduct) {
            productData = cachedProduct;
            
            // 🔥 VERIFICAR SE PRODUTO FOI DELETADO
            if (productData.deleted === true || productData.deletedAt) {
              console.log(`🗑️ Produto ${productIdToUse} está DELETADO - ignorando`);
              productDeleted = true;
            } else {
              // ✅ PRIORIZAR DADOS DO PRODUTO REAL sobre dados do checkout
              productTitle = productData.name || productData.title || productTitle;
              productDescription = productData.description || productDescription;
            }
          }
        } catch (error) {
          console.error(`⚠️ Produto ${productIdToUse} não encontrado em products collection`);
        }
        
        // Resolver imagem com fallback completo (produto → checkout)
        productImage = resolveProductImage(productData, data);
        console.log(`📦 Produto ${productIdToUse}: ${productTitle} (foto: ${productImage ? 'SIM' : 'NÃO'})`);
        
        // 🔥 IGNORAR PRODUTOS DELETADOS
        if (productDeleted) {
          return null;
        }
        
        // 🔒 VERIFICAR SE PRODUTO ESTÁ OCULTO PELO ADMIN (verificação adicional)
        if (productData?.adminHidden === true) {
          console.log(`🔒 Produto ${productIdToUse} oculto via products collection - ignorando`);
          return null;
        }
        
        // 🔥 BUSCAR DADOS DO SELLER REAL (Nome de Exibição configurado no perfil)
        let sellerBusinessName = 'Empresa';
        let sellerAvatar = null;
        
        try {
          const cachedSeller = await firestoreCache.getSeller(data.tenantId);
          if (cachedSeller) {
            // ✅ PRIORIZAR businessName configurado no perfil do seller
            sellerBusinessName = cachedSeller.businessName || cachedSeller.name || cachedSeller.displayName || sellerBusinessName;
            sellerAvatar = cachedSeller.profilePhotoUrl || cachedSeller.avatar || null;
            console.log(`👤 Seller ${data.tenantId}: ${sellerBusinessName}`);
          }
        } catch (error) {
          console.error(`⚠️ Seller ${data.tenantId} não encontrado em sellers collection`);
        }
        
        // 🔥 BUSCAR OFERTAS ATIVAS (não deletadas, não inativas)
        let offers = [];
        try {
          // ✅ CORRIGIDO: Buscar apenas ofertas ATIVAS (false = não incluir inativas)
          const allOffers = await (firebaseStorage as any).listOffersByProduct(productIdToUse, false);
          
          // 🔧 FILTRAR por selectedOffers do vendedor (se configurado)
          const selectedOfferIds = data.affiliateConfig?.selectedOffers || [];
          let filteredOffers = allOffers;
          if (Array.isArray(selectedOfferIds) && selectedOfferIds.length > 0) {
            console.log(`🎯 [SHOWCASE] Filtrando por selectedOffers: ${selectedOfferIds.join(', ')}`);
            filteredOffers = allOffers.filter((offer: any) => {
              const offerId = offer.id || offer.uuid;
              return selectedOfferIds.includes(offerId);
            });
            console.log(`📦 [SHOWCASE] Ofertas após filtro: ${filteredOffers.length} de ${allOffers.length}`);
          }
          
          offers = filteredOffers.map((offer: any) => ({
            id: offer.id,
            uuid: offer.uuid || offer.id,
            slug: offer.slug,
            name: offer.name || offer.title,
            title: offer.title || offer.name,
            price: offer.price || 0,
            affiliateCommission: offer.affiliateCommission || commissionPercent,
            checkoutId: doc.id
          }));
        } catch (error) {
          console.error(`❌ Erro ao buscar ofertas do produto ${doc.id}:`, error);
        }
        
        // ✅ FALLBACK: Se não há ofertas cadastradas, criar oferta sintética do checkout
        if (offers.length === 0) {
          console.log(`🔄 Produto ${doc.id} sem ofertas - gerando oferta sintética do checkout`);
          
          // Gerar slug seguro (lowercase, sem caracteres especiais)
          const safeSlug = (productTitle || 'oferta-principal')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 50) || doc.id.toLowerCase();
          
          offers = [{
            id: `synthetic_${doc.id}`,
            uuid: `synthetic_${doc.id}`,
            slug: safeSlug,
            name: productTitle || 'Oferta Principal',
            title: productTitle || 'Oferta Principal',
            price: realPrice,
            affiliateCommission: commissionPercent,
            checkoutId: doc.id,
            productId: productIdToUse,
            tenantId: data.tenantId
          }];
        }
        
        // 🔥 BUSCAR TOTAL DE VENDAS E RECEITA REAL do produto (orders com status paid/completed)
        let totalSalesCount = data.salesCount || 0;
        let totalRevenue = 0; // 💰 RECEITA TOTAL EM CENTAVOS
        const processedOrderIds = new Set<string>();
        
        try {
          // Buscar vendas confirmadas deste produto/checkout
          const ordersSnapshot = await firestoreDb.collection('orders')
            .where('checkoutId', '==', doc.id)
            .where('status', 'in', ['paid', 'completed', 'approved', 'confirmed'])
            .get();
          
          if (!ordersSnapshot.empty) {
            for (const orderDoc of ordersSnapshot.docs) {
              if (!processedOrderIds.has(orderDoc.id)) {
                processedOrderIds.add(orderDoc.id);
                const orderData = orderDoc.data();
                // Somar valor da venda (amount, totalAmount, pricing.amount, price)
                const orderValue = orderData.amount || orderData.totalAmount || orderData.pricing?.amount || orderData.price || 0;
                totalRevenue += orderValue;
              }
            }
            totalSalesCount = processedOrderIds.size;
            console.log(`📊 Produto ${doc.id}: ${totalSalesCount} vendas, R$ ${(totalRevenue / 100).toFixed(2)} receita`);
          }
          
          // Também buscar por productId se diferente do checkoutId
          if (productIdToUse !== doc.id) {
            const productOrdersSnapshot = await firestoreDb.collection('orders')
              .where('productId', '==', productIdToUse)
              .where('status', 'in', ['paid', 'completed', 'approved', 'confirmed'])
              .get();
            
            if (!productOrdersSnapshot.empty) {
              for (const orderDoc of productOrdersSnapshot.docs) {
                if (!processedOrderIds.has(orderDoc.id)) {
                  processedOrderIds.add(orderDoc.id);
                  const orderData = orderDoc.data();
                  const orderValue = orderData.amount || orderData.totalAmount || orderData.pricing?.amount || orderData.price || 0;
                  totalRevenue += orderValue;
                }
              }
              totalSalesCount = processedOrderIds.size;
            }
          }
        } catch (error) {
          console.error(`⚠️ Erro ao buscar vendas do produto ${doc.id}:`, error);
        }
        
        return {
          id: doc.id,
          productId: productIdToUse, // ID do produto real
          canonicalProductId: productIdToUse, // 🔑 Chave canônica para deduplicação (syncedProductId > productId > checkoutId)
          title: productTitle,
          description: productDescription,
          pricing: { amount: realPrice },
          price: realPrice,
          image: productImage,
          logoUrl: productImage,
          imageUrl: productImage,
          productType: data.productType || 'digital',
          isAffiliate: affiliateEnabled,
          isActive: !data.deleted && data.active, // 🎯 Flag de ativação para re-validação
          showInMarketplace: data.affiliateConfig?.marketplaceEnabled ?? data.showcase?.enabled ?? true, // 🎯 Flag marketplace
          affiliate: { 
            enabled: affiliateEnabled,
            autoApprove: affiliateData.autoApprove || false,
            commissionPercent: commissionPercent,
            showInMarketplace: data.affiliate?.showInMarketplace ?? true
          },
          commission: commissionPercent,
          category: data.category || 'all',
          seller: {
            name: sellerBusinessName,
            businessName: sellerBusinessName,
            avatar: sellerAvatar,
            uid: data.tenantId
          },
          tenantId: data.tenantId,
          sellerId: data.tenantId,
          offers: offers,
          createdAt: data.createdAt || Date.now(),
          totalSales: totalSalesCount, // Quantidade de vendas
          totalRevenue: totalRevenue, // 💰 RECEITA TOTAL EM CENTAVOS (usado para ordenação e hype)
          stats: {
            sales: totalSalesCount,
            revenue: totalRevenue,
            rating: 0,
            reviews: 0
          }
        };
      });

    // Aguardar todas as promessas de ofertas
    const validCheckoutsRaw = await Promise.all(validCheckoutsPromises);
    
    // 🎯 FILTROS DE QUALIDADE (após enriquecimento)
    const validCheckouts = validCheckoutsRaw.filter((c: any) => {
      if (!c) return false;
      
      const title = c.title || '';
      const price = c.price || 0;
      
      // Bloquear títulos vazios ou genéricos
      if (!title || title === 'Sem título' || title.includes('Produto Digital ')) {
        console.log(`⏭️ Produto ${c.id} bloqueado - título inválido: "${title}"`);
        return false;
      }
      
      // Bloquear produtos com preço R$0 (exceto se explicitamente gratuito)
      if (price === 0 && !title.toLowerCase().includes('grátis') && !title.toLowerCase().includes('free') && !title.toLowerCase().includes('gratuito')) {
        console.log(`⏭️ Produto ${c.id} bloqueado - preço R$0`);
        return false;
      }
      
      return true;
    });
    
    console.log(`✅ Checkouts válidos: ${validCheckouts.length} (antes de deduplicação)`);

    // 🔄 DEDUPLICAÇÃO: Agrupar por canonicalProductId (cada produto aparece apenas UMA VEZ)
    const productMap = new Map<string, any>();
    
    for (const checkout of validCheckouts) {
      // Chave única: usar checkout.canonicalProductId (syncedProductId > productId > checkoutId)
      const canonicalKey = checkout.canonicalProductId || checkout.id;
      
      if (!productMap.has(canonicalKey)) {
        // Primeiro checkout deste produto - adicionar
        productMap.set(canonicalKey, checkout);
      } else {
        // Produto já existe - escolher o representante com menor preço
        const existing = productMap.get(canonicalKey);
        
        // Re-validar elegibilidade antes de substituir (defesa em profundidade)
        const isEligible = checkout.isActive && checkout.showInMarketplace;
        
        // Se este checkout tem preço menor E está elegível, substituir
        if (isEligible && checkout.price < existing.price) {
          productMap.set(canonicalKey, checkout);
        }
      }
    }
    
    // Converter Map para Array (sem metadados internos)
    const deduplicatedProducts = Array.from(productMap.values());
    
    console.log(`✅ Vitrine: ${deduplicatedProducts.length} produtos únicos (deduplicados de ${validCheckouts.length} checkouts)`);

    firestoreCache.setShowcaseCache('all', deduplicatedProducts);

    // Aplicar filtros nos produtos deduplicados
    let filtered = deduplicatedProducts;

    // Filtro de busca
    if (search) {
      filtered = filtered.filter((c: any) => 
        c.title.toLowerCase().includes(String(search).toLowerCase()) ||
        c.description.toLowerCase().includes(String(search).toLowerCase()) ||
        c.seller.name.toLowerCase().includes(String(search).toLowerCase())
      );
    }

    // Filtro de categoria - NORMALIZAR "subscriptions" → "subscription"
    if (category && category !== 'all' && category !== 'profitable') {
      const normalizedCategory = category === 'subscriptions' ? 'subscription' : category;
      filtered = filtered.filter((c: any) => c.productType === normalizedCategory);
    }

    // Filtro de afiliação
    if (affiliateOnly === 'true') {
      filtered = filtered.filter((c: any) => c.isAffiliate);
    }

    res.json(filtered);
  } catch (error: any) {
    console.error('❌ Erro ao buscar showcase checkouts:', error);
    res.status(500).json({ error: 'Erro ao buscar checkouts', details: error.message });
  }
});

/**
 * 🎯 PUBLIC: GET /api/showcase/checkouts/:checkoutId
 * Buscar checkout específico para página de convite de afiliado
 */
router.get('/checkouts/:checkoutId', async (req, res) => {
  try {
    const { checkoutId } = req.params;
    
    if (!checkoutId) {
      return res.status(400).json({ error: 'checkoutId é obrigatório' });
    }

    const checkoutData = await firestoreCache.getCheckout(checkoutId);
    
    if (!checkoutData) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const data = checkoutData;
    
    // Verificar se está ativo e não deletado
    if (data.deleted || data.deletedAt || !data.active) {
      return res.status(404).json({ error: 'Produto não disponível' });
    }

    // Buscar dados do produto real (se existir)
    const productIdToUse = data.syncedProductId || data.productId || checkoutId;
    let productData = null;
    let productTitle = data.name || data.title || 'Sem título';
    let productDescription = data.description || '';
    let productImage: string | null = null;

    try {
      const cachedProduct = await firestoreCache.getProduct(productIdToUse);
      if (cachedProduct) {
        productData = cachedProduct;
        if (!productData.deleted && !productData.deletedAt) {
          productTitle = productData.name || productData.title || productTitle;
          productDescription = productData.description || productDescription;
        }
      }
    } catch (error) {
      console.error(`⚠️ Produto ${productIdToUse} não encontrado em products collection`);
    }
    
    productImage = resolveProductImage(productData, data);

    // Buscar dados do seller
    let sellerBusinessName = 'Produtor';
    try {
      const cachedSeller = await firestoreCache.getSeller(data.tenantId);
      if (cachedSeller) {
        sellerBusinessName = cachedSeller.businessName || cachedSeller.name || cachedSeller.displayName || sellerBusinessName;
      }
    } catch (error) {
      console.error(`⚠️ Seller ${data.tenantId} não encontrado`);
    }

    // Dados de afiliação
    const affiliateEnabled = data.affiliate?.enabled || data.affiliateConfig?.enabled || false;
    const commissionPercent = data.affiliate?.commissionPercent || data.affiliateConfig?.commissions?.single || data.affiliateConfig?.commissionPercent || 0;
    const autoApprove = data.affiliate?.autoApprove || data.affiliateConfig?.autoApprove || false;
    const realPrice = data.pricing?.amount || data.price || 0;

    // Buscar vendas totais
    let salesCount = data.salesCount || 0;
    try {
      const fsDb2 = await getFirestoreDb();
      const ordersSnapshot = fsDb2 ? await fsDb2.collection('orders')
        .where('checkoutId', '==', checkoutId)
        .where('status', 'in', ['paid', 'completed', 'approved', 'confirmed'])
        .get() : null;
      if (ordersSnapshot && !ordersSnapshot.empty) {
        salesCount = ordersSnapshot.size;
      }
    } catch (error) {
      console.error(`⚠️ Erro ao buscar vendas do checkout ${checkoutId}`);
    }

    res.json({
      id: checkoutId,
      productId: productIdToUse,
      name: productTitle,
      title: productTitle,
      description: productDescription,
      imageUrl: productImage,
      image: productImage,
      price: realPrice,
      productType: data.productType || 'digital',
      sellerName: sellerBusinessName,
      salesCount: salesCount,
      affiliateCommission: commissionPercent,
      affiliateApproval: autoApprove ? 'automatic' : 'manual',
      affiliate: {
        enabled: affiliateEnabled,
        commissionPercent: commissionPercent,
        autoApprove: autoApprove,
        rules: data.affiliate?.rules || data.affiliateConfig?.rules || null
      },
      salesPageUrl: data.salesPageUrl || null,
      tenantId: data.tenantId
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar checkout:', error);
    res.status(500).json({ error: 'Erro ao buscar checkout', details: error.message });
  }
});

/**
 * 📊 GET /api/showcase/stats
 * Estatísticas da vitrine
 */
router.get('/stats', async (req, res) => {
  try {
    const fsDbStats = await getFirestoreDb();
    if (!fsDbStats) {
      return res.json({ totalProducts: 0, totalSellers: 0 });
    }

    const snapshot = await withFirestoreTimeout(fsDbStats.collection('checkouts').get()) as any;
    
    const products = snapshot.docs
      .filter(doc => {
        const data = doc.data();
        return !data.deleted && data.active && data.showcase?.enabled !== false;
      });

    const uniqueSellers = new Set(products.map(doc => doc.data().tenantId));

    res.json({
      totalProducts: products.length,
      totalSellers: uniqueSellers.size
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar stats:', error);
    res.json({ totalProducts: 0, totalSellers: 0 });
  }
});

/**
 * 🏆 GET /api/showcase/top-sales
 * Top vendedores/produtos
 */
router.get('/top-sales', async (req, res) => {
  try {
    const fsDbTop = await getFirestoreDb();
    if (!fsDbTop) {
      return res.json([]);
    }

    const snapshot = await withFirestoreTimeout(fsDbTop.collection('checkouts').get()) as any;
    
    const products = snapshot.docs
      .filter(doc => {
        const data = doc.data();
        return !data.deleted && data.active && data.showcase?.enabled !== false;
      })
      .map(doc => ({
        id: doc.id,
        name: doc.data().name || 'Sem título',
        sales: doc.data().salesCount || 0,
        rating: 0
      }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);

    res.json(products);
  } catch (error: any) {
    console.error('❌ Erro ao buscar top sales:', error);
    res.json([]);
  }
});

/**
 * 🧪 GET /api/showcase/test-offer-creation
 * TEMPORÁRIO: Criar oferta de teste
 */
// 🚫 ROTA DE TESTE REMOVIDA POR SEGURANÇA (Feb 2026 Audit)
// test-offer-creation sem auth - criava ofertas em qualquer produto

export default router;

/**
 * 📦 GET /api/showcase/offers - Retorna todas as ofertas para a vitrine
 */
router.get('/offers', async (req, res) => {
  try {
    const fsDbOffers = await getFirestoreDb();
    if (!fsDbOffers) {
      return res.json([]);
    }

    // Buscar todas as ofertas do Firestore
    const offersSnapshot = await fsDbOffers.collection('productOffers').get();
    const offers = [];

    for (const offerDoc of offersSnapshot.docs) {
      const offerData = offerDoc.data();
      
      // Buscar o produto relacionado para pegar a foto
      let productImage: string | null = null;
      let productTitle = 'Produto';
      
      if (offerData.productId) {
        const productDoc = await fsDbOffers
          .collection('products')
          .doc(offerData.productId)
          .get();
        
        if (productDoc.exists) {
          const productData = productDoc.data();
          productImage = resolveProductImage(productData, null);
          productTitle = productData?.title || productData?.name || 'Produto';
        }
      }

      // Construir URL de checkout se disponível
      let checkoutUrl = '';
      if (offerData.checkoutId) {
        const checkoutDoc = await fsDbOffers
          .collection('checkouts')
          .doc(offerData.checkoutId)
          .get();
        
        if (checkoutDoc.exists) {
          checkoutUrl = `https://volatuspay.com/checkout/${offerData.checkoutId}`;
        }
      }

      offers.push({
        id: offerDoc.id,
        name: offerData.name || 'Oferta',
        description: offerData.description || '',
        price: offerData.price || 0,
        productId: offerData.productId,
        productTitle,
        productImage,
        checkoutUrl,
      });
    }

    res.json(offers);
  } catch (error: any) {
    console.error('❌ Erro ao buscar ofertas:', error);
    res.status(500).json({ error: 'Erro ao buscar ofertas', details: error.message });
  }
});

/**
 * 🌍 PUBLIC: GET /api/showcase/:sellerId
 * Showcase público de um seller específico — deve ficar APÓS todos os routes estáticos
 */
router.get('/:sellerId', async (req, res) => {
  const { sellerId } = req.params;

  try {
    const { neonQuery } = await import('../lib/neon-db.js');

    let seller: any = null;
    let checkouts: any[] = [];

    await Promise.all([
      neonQuery(async (sql) => {
        const rows = await sql`SELECT id, business_name, email, status, profile_photo, photo_url FROM sellers WHERE id = ${sellerId} LIMIT 1`;
        if (rows[0]) seller = rows[0];
      }, `showcaseSeller:${sellerId}`),
      neonQuery(async (sql) => {
        checkouts = await sql`
          SELECT id, title, subtitle, logo_url, pricing, active, affiliate, created_at
          FROM checkouts
          WHERE tenant_id = ${sellerId} AND (deleted = FALSE OR deleted IS NULL) AND active = TRUE
          ORDER BY created_at DESC LIMIT 50
        `;
      }, `showcaseCheckouts:${sellerId}`)
    ]);

    if (!seller) {
      return res.status(404).json({ error: 'Seller não encontrado' });
    }

    const products = checkouts.map((c: any) => ({
      id: c.id,
      title: c.title || 'Produto',
      description: c.subtitle || '',
      imageUrl: c.logo_url || null,
      price: c.pricing?.amount || 0,
      currency: 'BRL',
      isAffiliate: c.affiliate?.enabled === true,
      createdAt: c.created_at,
    }));

    res.json({
      seller: {
        id: seller.id,
        businessName: seller.business_name || 'Vendedor',
        email: seller.email,
        status: seller.status,
        photoUrl: seller.photo_url || seller.profile_photo || null,
      },
      products,
      total: products.length,
    });
  } catch (error: any) {
    console.error('❌ GET /api/showcase/:sellerId error:', error?.message);
    res.status(500).json({ error: error?.message || 'Erro interno' });
  }
});
