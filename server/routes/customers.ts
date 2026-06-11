import { Router, Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import admin from 'firebase-admin';
import { 
  insertCustomerProfileSchema, 
  insertMemberEntitlementSchema,
  insertRefundRequestSchema,
  CustomerProfile 
} from '../../shared/schema';
import { firestoreCache, withFirestoreTimeout } from '../lib/firestore-cache.js';

const router = Router();

// 🔐 INTERFACE: Request autenticada com dados do cliente
interface CustomerAuthenticatedRequest extends Request {
  customer: CustomerProfile;
  firebaseUid: string;
}

// 🔐 MIDDLEWARE: Verificar autenticação do cliente
async function requireCustomerAuth(req: CustomerAuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticação não fornecido' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Buscar ou criar perfil do cliente
    let customer = await storage.getCustomerProfileByFirebaseUid(decodedToken.uid);
    
    if (!customer) {
      // Cliente autenticou mas ainda não tem perfil - criar automaticamente
      customer = await storage.createCustomerProfile({
        email: decodedToken.email || '',
        name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Cliente',
        firebaseUid: decodedToken.uid,
      });
    }
    
    req.customer = customer;
    req.firebaseUid = decodedToken.uid;
    next();
  } catch (error) {
    console.error('❌ Erro na autenticação de cliente:', error);
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// 👤 GET /api/customers/me - Dados do cliente autenticado
router.get('/me', requireCustomerAuth, async (req: CustomerAuthenticatedRequest, res: Response) => {
  try {
    return res.json(req.customer);
  } catch (error) {
    console.error('❌ Erro ao buscar dados do cliente:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📦 GET /api/customers/me/purchases - Compras do cliente
router.get('/me/purchases', requireCustomerAuth, async (req: CustomerAuthenticatedRequest, res: Response) => {
  try {
    // Buscar todas as orders deste cliente (sem composite index - query simples)
    const ordersRef = await admin.firestore()
      .collection('orders')
      .where('customer.email', '==', req.customer.email)
      .get();
    
    // Ordenar em memória para evitar composite index
    const orders = ordersRef.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || new Date(),
      }))
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return res.json(orders);
  } catch (error) {
    console.error('❌ Erro ao buscar compras:', error);
    return res.status(500).json({ error: 'Erro ao buscar compras' });
  }
});

// 🎓 GET /api/customers/me/entitlements - Entitlements do cliente (produtos com acesso)
router.get('/me/entitlements', requireCustomerAuth, async (req: CustomerAuthenticatedRequest, res: Response) => {
  try {
    const customerId = req.customer.id;
    const activeOnly = req.query.activeOnly === 'true';
    
    const entitlements = await storage.getMemberEntitlementsByCustomer(customerId, { activeOnly });
    
    return res.json(entitlements);
  } catch (error) {
    console.error('❌ Erro ao buscar entitlements:', error);
    return res.status(500).json({ error: 'Erro ao buscar entitlements' });
  }
});

// 🎓 GET /api/customers/me/entitlements/:id - Detalhes de um entitlement + conteúdo da member area
router.get('/me/entitlements/:id', requireCustomerAuth, async (req: CustomerAuthenticatedRequest, res: Response) => {
  try {
    const entitlementId = req.params.id;
    const customerId = req.customer.id;
    
    const entitlement = await storage.getMemberEntitlement(entitlementId);
    
    if (!entitlement) {
      return res.status(404).json({ error: 'Entitlement não encontrado' });
    }
    
    // Verificar se o entitlement pertence ao cliente
    if (entitlement.customerId !== customerId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    // Registrar acesso
    if (entitlement.status === 'active') {
      await storage.recordEntitlementAccess(entitlementId);
    } else {
      await storage.recordEntitlementDenial(entitlementId);
    }
    
    // Buscar conteúdo da member area do checkout
    // IMPORTANTE: usar checkoutId (não productId) pois é a chave primária no Firestore
    let memberAreaContent = null;
    const checkoutId = (entitlement as any).checkoutId || entitlement.productId;
    
    if (checkoutId) {
      try {
        const checkoutData = await firestoreCache.getCheckout(checkoutId);
        
        if (checkoutData) {
          memberAreaContent = checkoutData?.memberAreaContent || null;
        }
      } catch (err) {
        console.error('❌ Erro ao buscar memberAreaContent:', err);
      }
    }
    
    return res.json({
      ...entitlement,
      memberAreaContent
    });
  } catch (error) {
    console.error('❌ Erro ao buscar entitlement:', error);
    return res.status(500).json({ error: 'Erro ao buscar entitlement' });
  }
});

// 💰 POST /api/customers/me/refund-requests - Criar solicitação de reembolso
router.post('/me/refund-requests', requireCustomerAuth, async (req: CustomerAuthenticatedRequest, res: Response) => {
  try {
    const customerId = req.customer.id;
    const { orderId, reason, amount } = req.body;
    
    // Buscar a order primeiro (para validações)
    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    
    // Verificar se a order pertence ao cliente
    if (order.customer.email !== req.customer.email) {
      return res.status(403).json({ error: 'Este pedido não pertence a você' });
    }
    
    // Verificar se a order está paga
    if (order.status !== 'paid') {
      return res.status(400).json({ error: 'Apenas pedidos pagos podem ser reembolsados' });
    }
    
    // 🇧🇷 VALIDAÇÃO CDC: Verificar janela de 7 dias a partir da compra
    const paidAt = (order as any).paidAt?.toDate?.() || (order as any).createdAt?.toDate?.() || new Date((order as any).paidAt || (order as any).createdAt);
    const nowDate = new Date();
    const daysSincePurchase = Math.floor((nowDate.getTime() - paidAt.getTime()) / (1000 * 3600 * 24));
    if (daysSincePurchase > 7) {
      return res.status(400).json({ 
        error: 'Prazo para solicitar reembolso expirado. O prazo é de 7 dias após a compra (CDC Art. 49).' 
      });
    }
    
    // Verificar se já existe uma solicitação para esta order (pendente, aprovada ou completada)
    const existingRequests = await storage.getRefundRequestsByCustomer(customerId);
    const activeRequest = existingRequests.find(
      req => req.orderId === orderId && ['pending', 'approved', 'completed'].includes(req.status)
    );
    
    if (activeRequest) {
      return res.status(400).json({ error: 'Já existe uma solicitação de reembolso para este pedido' });
    }
    
    // Calcular e validar amount
    const refundAmount = amount !== undefined ? amount : order.amount;
    
    // ✅ VALIDAÇÃO CRÍTICA: amount deve estar entre 0 e order.amount
    if (refundAmount <= 0) {
      return res.status(400).json({ error: 'Valor do reembolso deve ser maior que zero' });
    }
    if (refundAmount > order.amount) {
      return res.status(400).json({ error: `Valor do reembolso (${refundAmount}) não pode ser maior que o valor do pedido (${order.amount})` });
    }
    
    const isPartialRefund = refundAmount < order.amount;
    
    // Preparar dados para validação Zod
    const refundData = {
      orderId,
      customerId,
      customerEmail: req.customer.email,
      reason,
      amount: refundAmount,
      orderAmount: order.amount,
      isPartialRefund,
      requestedAt: new Date(),
      sellerId: order.tenantId,
      sellerEmail: (order as any).seller?.email,
    };
    
    // ✅ VALIDAÇÃO COM SCHEMA ZOD
    const validation = insertRefundRequestSchema.safeParse(refundData);
    if (!validation.success) {
      console.error('❌ Validação de refund request falhou:', validation.error);
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validation.error.errors 
      });
    }
    
    // Criar solicitação de reembolso
    const refundRequest = await storage.createRefundRequest(validation.data);
    
    console.log('✅ Solicitação de reembolso criada:', refundRequest.id);

    // 🔒 BLOQUEAR ACESSO: atualizar enrollment e memberEntitlement imediatamente
    const firebaseStorage = storage as any;
    const db = firebaseStorage.db;
    if (db && order.productId && req.customer.email) {
      const productId = (order as any).productId || (order as any).items?.[0]?.productId;
      const customerEmail = req.customer.email;
      const now = new Date();
      if (productId && customerEmail) {
        try {
          const [enrollSnap, meSnap] = await Promise.all([
            db.collection('enrollments').where('productId', '==', productId).where('customerEmail', '==', customerEmail).limit(1).get(),
            db.collection('memberEntitlements').where('productId', '==', productId).where('customerEmail', '==', customerEmail).limit(1).get(),
          ]);
          if (!enrollSnap.empty) {
            await enrollSnap.docs[0].ref.update({ status: 'refund_requested', refundRequestedAt: now, updatedAt: now });
            console.log(`🔒 [CUSTOMER-REFUND] Enrollment bloqueado para ${customerEmail}`);
          }
          if (!meSnap.empty) {
            await meSnap.docs[0].ref.update({ status: 'refund_requested', refundRequestedAt: now, updatedAt: now });
            console.log(`🔒 [CUSTOMER-REFUND] memberEntitlement bloqueado para ${customerEmail}`);
          }
        } catch (blockErr) {
          console.error('❌ [CUSTOMER-REFUND] Erro ao bloquear acesso:', blockErr);
        }
      }
    }

    return res.status(201).json(refundRequest);
  } catch (error) {
    console.error('❌ Erro ao criar solicitação de reembolso:', error);
    return res.status(500).json({ error: 'Erro ao criar solicitação de reembolso' });
  }
});

// 💰 GET /api/customers/me/refund-requests - Lista de solicitações de reembolso
router.get('/me/refund-requests', requireCustomerAuth, async (req: CustomerAuthenticatedRequest, res: Response) => {
  try {
    const customerId = req.customer.id;
    
    const refundRequests = await storage.getRefundRequestsByCustomer(customerId);
    
    return res.json(refundRequests);
  } catch (error) {
    console.error('❌ Erro ao buscar solicitações de reembolso:', error);
    return res.status(500).json({ error: 'Erro ao buscar solicitações' });
  }
});

// 🔐 ROTA REMOVIDA POR SEGURANÇA: /auth/link-purchase-email
// Motivo: Account takeover vulnerability - permitia vincular email de terceiros
// Solução: requireCustomerAuth já cria/vincula perfil automaticamente via Firebase UID

// 🚫 ROTAS DE TESTE REMOVIDAS POR SEGURANÇA (Feb 2026 Audit)
// - POST /test/create-entitlement/:orderId (sem auth - permitia criar entitlements para qualquer order)
// - POST /test/enable-member-area/:checkoutId (sem auth - permitia habilitar member area em qualquer checkout)
// - GET /test/purchases/:email (sem auth - vazava dados de compras de qualquer email)

export default router;
