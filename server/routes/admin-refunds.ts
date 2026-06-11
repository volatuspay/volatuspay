import { Router } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import { neonQuery } from '../lib/neon-db.js';

const router = Router();

// 🔐 MIDDLEWARE: Verificar se usuário é admin
function requireAdmin(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  // ✅ SECURITY: Verificar APENAS customClaims.admin (não confiar em tenantId ausente)
  const isAdmin = req.user.customClaims?.admin === true;
  
  if (!isAdmin) {
    console.warn(`⚠️ Tentativa de acesso admin negada para usuário: ${req.user.email} (uid: ${req.user.uid})`);
    return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
  }
  
  next();
}

// 📋 GET /api/admin/refund-requests - Listar todas as solicitações de reembolso
router.get('/refund-requests', requireAdmin, async (req, res) => {
  try {
    const { status, sellerId, limit } = req.query;
    
    let refundRequests;
    
    if (sellerId) {
      // Buscar solicitações de um seller específico
      const options = {
        statusFilter: status as string | undefined,
      };
      refundRequests = await storage.getRefundRequestsBySeller(sellerId as string, options);
      
      // Aplicar limit se fornecido
      if (limit) {
        const limitNum = parseInt(limit as string);
        refundRequests = refundRequests.slice(0, limitNum);
      }
    } else {
      // Admin pode ver TODAS as solicitações
      refundRequests = await storage.getAllRefundRequests({
        statusFilter: status as string | undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      });
    }
    
    return res.json(refundRequests);
  } catch (error) {
    console.error('❌ Erro ao listar refund requests:', error);
    return res.status(500).json({ error: 'Erro ao listar solicitações de reembolso' });
  }
});

// 📄 GET /api/admin/refund-requests/:id - Detalhes de uma solicitação
router.get('/refund-requests/:id', requireAdmin, async (req, res) => {
  try {
    const refundRequest = await storage.getRefundRequest(req.params.id);
    
    if (!refundRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada' });
    }
    
    // Admin pode ver qualquer solicitação
    return res.json(refundRequest);
  } catch (error) {
    console.error('❌ Erro ao buscar refund request:', error);
    return res.status(500).json({ error: 'Erro ao buscar solicitação' });
  }
});

// ✅ POST /api/admin/refund-requests/:id/approve - Aprovar solicitação
const approveSchema = z.object({
  reviewNotes: z.string().optional(),
  refundMethod: z.enum(['pix', 'credit_card', 'bank_transfer', 'manual']).optional(),
});

router.post('/refund-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    const refundRequestId = req.params.id;
    const validation = approveSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validation.error.errors 
      });
    }
    
    const refundRequest = await storage.getRefundRequest(refundRequestId);
    if (!refundRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada' });
    }
    
    if (refundRequest.status !== 'pending') {
      return res.status(400).json({ error: `Solicitação já foi ${refundRequest.status === 'approved' ? 'aprovada' : 'negada'}` });
    }
    
    const adminName = req.user.email || 'Admin';
    const updatedRequest = await storage.approveRefundRequest(
      refundRequestId,
      req.user.uid,
      adminName
    );
    
    console.log(`✅ Refund request ${refundRequestId} aprovado por admin ${req.user.uid}`);

    // ✅ ATUALIZAR ENROLLMENT e ORDER via Neon
    {
      const effectiveProductId = (refundRequest as any).productId;
      const effectiveEmail = (refundRequest as any).customerEmail;
      const effectiveOrderId = (refundRequest as any).orderId;

      if (effectiveProductId && effectiveEmail) {
        try {
          await neonQuery(async (sql) => {
            await sql`UPDATE enrollments SET status = 'refunded', refunded_at = NOW(), updated_at = NOW() WHERE product_id = ${effectiveProductId} AND customer_email = ${effectiveEmail}`;
          }, `adminApprove:refundEnrollment:${effectiveProductId}`);
          console.log(`🔒 [APPROVE] Enrollment marcado como 'refunded' para ${effectiveEmail}`);
        } catch (e) {
          console.error('❌ [APPROVE] Erro ao atualizar enrollment:', e);
        }
      }

      if (effectiveOrderId) {
        try {
          await neonQuery(async (sql) => {
            await sql`UPDATE orders SET status = 'refunded', refunded_at = NOW(), updated_at = NOW() WHERE id = ${effectiveOrderId}`;
          }, `adminApprove:refundOrder:${effectiveOrderId}`);
          console.log(`💰 [APPROVE] Order ${effectiveOrderId} marcada como 'refunded'`);
        } catch (e) {
          console.error('❌ [APPROVE] Erro ao atualizar order:', e);
        }
      }

      const effectiveSellerId = (refundRequest as any).sellerId || (refundRequest as any).tenantId;
      const refundAmount = (refundRequest as any).amount || 0;

      if (effectiveSellerId && refundAmount > 0) {
        try {
          let resolvedPaymentMethod = (refundRequest as any).paymentMethod;
          let resolvedGateway = (refundRequest as any).gateway;
          if (!resolvedPaymentMethod && (refundRequest as any).orderId) {
            await neonQuery(async (sql) => {
              const rows = await sql`SELECT payment_method, gateway FROM orders WHERE id = ${(refundRequest as any).orderId} LIMIT 1`;
              if (rows[0]) { resolvedPaymentMethod = rows[0].payment_method || 'pix'; resolvedGateway = rows[0].gateway; }
            }, `adminApprove:getOrderMethod:${(refundRequest as any).orderId}`);
          }
          const isCard = resolvedPaymentMethod === 'card' || resolvedPaymentMethod === 'credit_card';
          const debitSource = isCard ? ((resolvedGateway === 'stripe' || resolvedGateway === 'adyen') ? 'cardGlobal' : 'cardBR') : 'pix';

          await neonQuery(async (sql) => {
            const existing = await sql`SELECT id FROM refund_balances WHERE id = ${'refund_' + refundRequestId} LIMIT 1`;
            if (existing.length > 0) { console.log(`⚠️ Débito já processado para refundRequest ${refundRequestId} - pulando`); return; }
            const sellers = await sql`SELECT withdrawal_balance, business_name, name FROM sellers WHERE id = ${effectiveSellerId} LIMIT 1`;
            const sellerRow = sellers[0] || {};
            const currentBalance = sellerRow.withdrawal_balance || 0;
            const newBalance = currentBalance - refundAmount;
            await sql`UPDATE sellers SET withdrawal_balance = ${newBalance}, negative_balance = ${newBalance < 0}, negative_balance_amount = ${newBalance < 0 ? Math.abs(newBalance) : 0}, updated_at = NOW() WHERE id = ${effectiveSellerId}`;

            let productTitle = (refundRequest as any).productTitle || '';
            let customerName = (refundRequest as any).customerName || '';
            if (!productTitle && (refundRequest as any).orderId) {
              const orderRows = await sql`SELECT product_title FROM orders WHERE id = ${(refundRequest as any).orderId} LIMIT 1`;
              if (orderRows[0]) productTitle = orderRows[0].product_title || 'Produto';
            }
            await sql`INSERT INTO refund_balances (id, customer_id, customer_email, customer_name, refund_id, amount, product_title, seller_name, seller_id, status, approved_at, created_at, updated_at) VALUES (${'refund_' + refundRequestId}, ${(refundRequest as any).customerId || ''}, ${(refundRequest as any).customerEmail || ''}, ${customerName}, ${refundRequestId}, ${refundAmount}, ${productTitle || 'Produto'}, ${sellerRow.business_name || sellerRow.name || 'Seller'}, ${effectiveSellerId}, 'available', NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`;
          }, `adminApprove:debitSeller:${effectiveSellerId}`);
          console.log(`💰 [ADMIN-APPROVE] Seller ${effectiveSellerId} debitado R$ ${(refundAmount/100).toFixed(2)} (refundRequest ${refundRequestId})`);
        } catch (debitError) {
          console.error(`❌ Erro ao debitar seller para refundRequest ${refundRequestId}:`, debitError);
        }
      }
    }
    
    return res.json(updatedRequest);
  } catch (error) {
    console.error('❌ Erro ao aprovar refund request:', error);
    return res.status(500).json({ error: 'Erro ao aprovar solicitação' });
  }
});

// ❌ POST /api/admin/refund-requests/:id/deny - Negar solicitação
const denySchema = z.object({
  reviewNotes: z.string().min(10, 'Motivo da negação deve ter pelo menos 10 caracteres'),
});

router.post('/refund-requests/:id/deny', requireAdmin, async (req, res) => {
  try {
    const refundRequestId = req.params.id;
    const validation = denySchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validation.error.errors 
      });
    }
    
    const { reviewNotes } = validation.data;
    
    // Buscar solicitação
    const refundRequest = await storage.getRefundRequest(refundRequestId);
    if (!refundRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada' });
    }
    
    // Verificar se já foi revisada
    if (refundRequest.status !== 'pending') {
      return res.status(400).json({ error: `Solicitação já foi ${refundRequest.status === 'approved' ? 'aprovada' : 'negada'}` });
    }
    
    // Negar - assinatura: (requestId, processedBy, processedByName, denialReason)
    const adminName = req.user.email || 'Admin';
    const updatedRequest = await storage.denyRefundRequest(
      refundRequestId,
      req.user.uid,
      adminName,
      reviewNotes
    );
    
    console.log(`❌ Refund request ${refundRequestId} negado por admin ${req.user.uid}`);

    // ✅ RESTAURAR ACESSO via Neon
    {
      const effectiveProductId = (refundRequest as any).productId;
      const effectiveEmail = (refundRequest as any).customerEmail;
      if (effectiveProductId && effectiveEmail) {
        try {
          await neonQuery(async (sql) => {
            await sql`UPDATE enrollments SET status = 'active', refund_denied_at = NOW(), updated_at = NOW() WHERE product_id = ${effectiveProductId} AND customer_email = ${effectiveEmail}`;
          }, `adminDeny:restoreEnrollment:${effectiveProductId}`);
          console.log(`✅ [DENY] Acesso restaurado (enrollment) para ${effectiveEmail}`);
        } catch (e) {
          console.error('❌ [DENY] Erro ao restaurar acesso:', e);
        }
      }
    }

    return res.json(updatedRequest);
  } catch (error) {
    console.error('❌ Erro ao negar refund request:', error);
    return res.status(500).json({ error: 'Erro ao negar solicitação' });
  }
});

// ✔️ POST /api/admin/refund-requests/:id/complete - Marcar como completado
const completeSchema = z.object({
  completionNotes: z.string().optional(),
  transactionId: z.string().optional(),
});

router.post('/refund-requests/:id/complete', requireAdmin, async (req, res) => {
  try {
    const refundRequestId = req.params.id;
    const validation = completeSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos', 
        details: validation.error.errors 
      });
    }
    
    const { completionNotes, transactionId } = validation.data;
    
    // Buscar solicitação
    const refundRequest = await storage.getRefundRequest(refundRequestId);
    if (!refundRequest) {
      return res.status(404).json({ error: 'Solicitação não encontrada' });
    }
    
    // Verificar se foi aprovada
    if (refundRequest.status !== 'approved') {
      return res.status(400).json({ error: 'Apenas solicitações aprovadas podem ser marcadas como completadas' });
    }
    
    // Marcar como completado - assinatura: (requestId, refundData)
    const updatedRequest = await storage.markRefundAsCompleted(
      refundRequestId,
      {
        refundedAmount: refundRequest.amount,
        refundMethod: 'manual',
        refundTransactionId: transactionId
      }
    );
    
    console.log(`✔️ Refund request ${refundRequestId} marcado como completado`);
    
    // TODO: Enviar email ao cliente confirmando reembolso processado
    
    return res.json(updatedRequest);
  } catch (error) {
    console.error('❌ Erro ao marcar refund como completado:', error);
    return res.status(500).json({ error: 'Erro ao completar reembolso' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROTAS USADAS PELO PAINEL ADMIN FRONTEND (/api/admin/refunds/*)
// Consulta as duas coleções: 'refunds' (legado) + 'refundRequests' (novo)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeRefundDoc(id: string, data: any, source: 'refunds' | 'refundRequests'): any {
  if (source === 'refunds') {
    return {
      id,
      orderId: data.orderId || '',
      customerId: data.customerId || '',
      customerEmail: data.customerEmail || '',
      sellerId: data.sellerId || data.tenantId || '',
      sellerEmail: data.sellerEmail || '',
      productId: data.productId || '',
      productName: data.productTitle || data.productName || 'Produto',
      amount: data.refundAmount || data.amount || 0,
      currency: data.currency || 'BRL',
      reason: data.reason || '',
      status: data.status === 'denied' ? 'rejected' : (data.status || 'pending'),
      requestedAt: data.createdAt || data.requestedAt || null,
      approvedAt: data.approvedAt || null,
      rejectedAt: data.rejectedAt || data.deniedAt || null,
      approvedBy: data.approvedBy || data.processedBy || null,
      _source: 'refunds',
    };
  }
  return {
    id,
    orderId: data.orderId || '',
    customerId: data.customerId || '',
    customerEmail: data.customerEmail || '',
    sellerId: data.sellerId || '',
    sellerEmail: data.sellerEmail || '',
    productId: data.productId || '',
    productName: data.productTitle || data.productName || 'Produto',
    amount: data.amount || 0,
    currency: data.currency || 'BRL',
    reason: data.reason || '',
    status: data.status === 'denied' ? 'rejected' : (data.status || 'pending'),
    requestedAt: data.requestedAt || data.createdAt || null,
    approvedAt: data.processedAt || null,
    rejectedAt: data.processedAt && data.status === 'denied' ? data.processedAt : null,
    approvedBy: data.processedBy || null,
    _source: 'refundRequests',
  };
}

// 📋 GET /api/admin/refunds - Lista reembolsos do Neon
router.get('/refunds', requireAdmin, async (req, res) => {
  try {
    let rows: any[] = [];
    await neonQuery(async (sql) => {
      rows = await sql`SELECT * FROM refunds ORDER BY created_at DESC LIMIT 200`;
    }, 'adminRefunds:listRefunds');
    const all = rows.map((r) => normalizeRefundDoc(r.id, r, 'refunds'));
    return res.json({ refunds: all });
  } catch (error) {
    console.error('❌ Erro ao listar refunds:', error);
    return res.status(500).json({ error: 'Erro ao listar reembolsos' });
  }
});

// ✅ POST /api/admin/refunds/:id/approve - Aprovar reembolso via Neon
router.post('/refunds/:id/approve', requireAdmin, async (req, res) => {
  try {
    const refundId = req.params.id;

    let refundData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM refunds WHERE id = ${refundId} LIMIT 1`;
      if (rows[0]) refundData = rows[0];
    }, `adminRefundsApprove:get:${refundId}`);

    if (!refundData) return res.status(404).json({ error: 'Reembolso não encontrado' });
    if (refundData.status !== 'pending') return res.status(400).json({ error: 'Reembolso já foi processado' });

    await neonQuery(async (sql) => {
      await sql`UPDATE refunds SET status = 'approved', processed_at = NOW(), processed_by = ${req.user.uid}, processed_by_name = ${req.user.email || 'Admin'}, updated_at = NOW() WHERE id = ${refundId}`;
    }, `adminRefundsApprove:approve:${refundId}`);

    const effectiveProductId = refundData.product_id;
    const effectiveEmail = refundData.customer_email;
    const effectiveOrderId = refundData.order_id;

    if (effectiveProductId && effectiveEmail) {
      try {
        await neonQuery(async (sql) => {
          await sql`UPDATE enrollments SET status = 'refunded', refunded_at = NOW(), updated_at = NOW() WHERE product_id = ${effectiveProductId} AND customer_email = ${effectiveEmail}`;
        }, `adminRefundsApprove:enrollment:${effectiveProductId}`);
        console.log(`🔒 [REFUNDS-APPROVE] Enrollment 'refunded' para ${effectiveEmail}`);
      } catch (e) { console.error('❌ [REFUNDS-APPROVE] Erro enrollment:', e); }
    }

    if (effectiveOrderId) {
      try {
        await neonQuery(async (sql) => {
          await sql`UPDATE orders SET status = 'refunded', refunded_at = NOW(), updated_at = NOW() WHERE id = ${effectiveOrderId}`;
        }, `adminRefundsApprove:order:${effectiveOrderId}`);
        console.log(`💰 [REFUNDS-APPROVE] Order ${effectiveOrderId} → 'refunded'`);
      } catch (e) { console.error('❌ [REFUNDS-APPROVE] Erro order:', e); }
    }

    const effectiveSellerId = refundData.seller_id || refundData.tenant_id;
    const refundAmount = refundData.refund_amount || refundData.amount || 0;
    if (effectiveSellerId && refundAmount > 0) {
      try {
        await neonQuery(async (sql) => {
          const existing = await sql`SELECT id FROM refund_balances WHERE id = ${'refund_' + refundId} LIMIT 1`;
          if (existing.length > 0) return;
          const sellers = await sql`SELECT withdrawal_balance FROM sellers WHERE id = ${effectiveSellerId} LIMIT 1`;
          const currentBalance = sellers[0]?.withdrawal_balance || 0;
          const newBalance = currentBalance - refundAmount;
          await sql`UPDATE sellers SET withdrawal_balance = ${newBalance}, negative_balance = ${newBalance < 0}, negative_balance_amount = ${newBalance < 0 ? Math.abs(newBalance) : 0}, updated_at = NOW() WHERE id = ${effectiveSellerId}`;
          await sql`INSERT INTO refund_balances (id, customer_id, customer_email, refund_id, amount, product_title, seller_id, status, approved_at, created_at, updated_at) VALUES (${'refund_' + refundId}, ${refundData.customer_id || ''}, ${effectiveEmail || ''}, ${refundId}, ${refundAmount}, ${refundData.product_title || refundData.product_name || 'Produto'}, ${effectiveSellerId}, 'available', NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`;
        }, `adminRefundsApprove:debitSeller:${effectiveSellerId}`);
        console.log(`💰 [REFUNDS-APPROVE] Seller ${effectiveSellerId} debitado R$ ${(refundAmount / 100).toFixed(2)}`);
      } catch (e) { console.error('❌ [REFUNDS-APPROVE] Erro ao debitar seller:', e); }
    }

    return res.json({ success: true, message: 'Reembolso aprovado com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao aprovar refund:', error);
    return res.status(500).json({ error: 'Erro ao aprovar reembolso' });
  }
});

// ❌ POST /api/admin/refunds/:id/reject - Rejeitar reembolso via Neon
router.post('/refunds/:id/reject', requireAdmin, async (req, res) => {
  try {
    const refundId = req.params.id;
    const { reason } = req.body;

    let refundData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM refunds WHERE id = ${refundId} LIMIT 1`;
      if (rows[0]) refundData = rows[0];
    }, `adminRefundsReject:get:${refundId}`);

    if (!refundData) return res.status(404).json({ error: 'Reembolso não encontrado' });
    if (refundData.status !== 'pending') return res.status(400).json({ error: 'Reembolso já foi processado' });

    await neonQuery(async (sql) => {
      await sql`UPDATE refunds SET status = 'denied', denial_reason = ${reason || ''}, processed_at = NOW(), processed_by = ${req.user.uid}, processed_by_name = ${req.user.email || 'Admin'}, updated_at = NOW() WHERE id = ${refundId}`;
    }, `adminRefundsReject:deny:${refundId}`);

    const effectiveProductId = refundData.product_id;
    const effectiveEmail = refundData.customer_email;

    if (effectiveProductId && effectiveEmail) {
      try {
        await neonQuery(async (sql) => {
          await sql`UPDATE enrollments SET status = 'active', refund_denied_at = NOW(), updated_at = NOW() WHERE product_id = ${effectiveProductId} AND customer_email = ${effectiveEmail}`;
        }, `adminRefundsReject:restoreEnrollment:${effectiveProductId}`);
        console.log(`✅ [REFUNDS-REJECT] Acesso restaurado (enrollment) para ${effectiveEmail}`);
      } catch (e) { console.error('❌ [REFUNDS-REJECT] Erro ao restaurar enrollment:', e); }
    }

    console.log(`❌ [REFUNDS-REJECT] Reembolso ${refundId} rejeitado por ${req.user.uid}`);
    return res.json({ success: true, message: 'Reembolso rejeitado e acesso restaurado' });
  } catch (error) {
    console.error('❌ Erro ao rejeitar refund:', error);
    return res.status(500).json({ error: 'Erro ao rejeitar reembolso' });
  }
});

export default router;
