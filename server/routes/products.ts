import { Router } from 'express';
import { storage } from '../storage';
import { verifyFirebaseToken } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { firestoreCache, withFirestoreTimeout } from '../lib/firestore-cache.js';
import { getAdmin, ensureFirebaseReady } from '../lib/firebase-admin.js';

const router = Router();

// 📦 GET /api/products - Buscar produtos reais do Firestore
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.get('/', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId, productType, limit: queryLimit } = req.query;
    
    // 🔐 SECURITY: Verificar autenticação
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    // 🔐 SECURITY: Verificar ownership (admin pode ver qualquer tenant, seller só o próprio)
    const isAdmin = user.customClaims?.admin === true;
    
    if (!isAdmin && !tenantId) {
      return res.status(400).json({ error: 'tenantId é obrigatório para sellers' });
    }
    
    if (!isAdmin && tenantId && user.uid !== tenantId) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando acessar produtos do tenant ${tenantId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode ver seus próprios produtos' });
    }
    
    // 🚀 PAGINAÇÃO: Limitar resultados (default 100, max 9999)
    const limit = Math.min(parseInt(queryLimit as string) || 100, 9999);
    
    // 🐘 BUSCAR PRODUTOS DO NEON (fonte de verdade após migração)
    // Quando tenantId fornecido, usa NeonStorage; caso admin sem tenantId, usa Firestore
    if (tenantId) {
      console.log(`📦 Buscando produtos do Neon para tenant: ${tenantId}`);
      const neonProducts = await storage.getProductsByTenant(tenantId as string);
      const filtered = neonProducts.filter((p: any) => !p.deleted);
      console.log(`📦 ✅ ${filtered.length} produtos encontrados no Neon`);
      return res.json({ products: filtered, total: filtered.length });
    }

    // Admin sem tenantId — usa Firestore para ver tudo
    const filterType = (productType as string) || 'digital';
    console.log(`📦 [ADMIN] Buscando produtos do Firestore (tipo: ${filterType}, limit: ${limit})`);
    
    await ensureFirebaseReady();
    const adminSdkInst = getAdmin();
    const db = adminSdkInst.firestore();
    
    const query = db
      .collection('products')
      .where('productType', '==', filterType)
      .limit(limit);
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return res.json({ products: [], total: 0 });
    }
    
    const products = snapshot.docs
      .map((doc: any) => {
        const data = doc.data();
        if (data.deleted === true) return null;
        return {
          id: doc.id,
          name: data.name || data.title || 'Produto',
          productType: data.productType || 'digital',
          tenantId: data.tenantId,
          createdAt: data.createdAt,
          price: data.price || 0,
          description: data.description
        };
      })
      .filter(Boolean);
    
    console.log(`📦 ✅ ${products.length} produtos encontrados (Firestore)`);
    
    res.json({
      products,
      total: products.length
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos: ' + error.message });
  }
});

router.get('/by-tenant/:tenantId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const isAdmin = user.customClaims?.admin === true;
    if (!isAdmin && user.uid !== tenantId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const products = await storage.getProductsByTenant(tenantId);

    res.json(products);
  } catch (error: any) {
    console.error('Erro ao buscar produtos por tenant:', error.message);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

// 🌐 PUBLIC: Buscar produto por ID (usado pela página de oferta pós-compra)
// Retorna título, descrição e primeiro checkout do produto (sem dados sensíveis)
router.get('/public/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await firestoreCache.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // Buscar primeiro checkout ativo do produto para redirecionar
    let checkouts: { id: string; slug: string; title?: string }[] = [];
    try {
      const { getAdmin, ensureFirebaseReady } = await import('../lib/firebase-admin.js');
      await ensureFirebaseReady();
      const db = getAdmin().firestore();
      const snap = await db.collection('checkouts')
        .where('syncedProductId', '==', productId)
        .limit(5)
        .get();
      checkouts = snap.docs
        .filter((d: any) => !d.data().archived)
        .map((d: any) => ({ id: d.id, slug: d.data().slug, title: d.data().title }));
    } catch (_) {}

    res.json({
      product: {
        id: product.id,
        title: product.title,
        description: product.description,
        coverImage: (product as any).coverImage || null,
        checkouts,
      }
    });
  } catch (error: any) {
    console.error('Erro ao buscar produto público:', error.message);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

router.get('/detail/:productId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { productId } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const product = await firestoreCache.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const isAdmin = user.customClaims?.admin === true;
    if (!isAdmin && product.tenantId !== user.uid) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    res.json(product);
  } catch (error: any) {
    console.error('Erro ao buscar produto:', error.message);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

export default router;
