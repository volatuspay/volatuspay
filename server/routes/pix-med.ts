import { Router } from 'express';
import { storage } from '../storage';
import { getWooviRefunds, getWooviChargeStatus, listWooviCharges } from '../lib/woovi-api';
import { getEfiBankPixRefunds, listEfiBankPixWithRefunds } from '../lib/efibank-refunds-api.js';
import { verifyFirebaseToken } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  
  const isAdmin = req.user.customClaims?.admin === true;
  
  if (!isAdmin) {
    console.warn(`Tentativa de acesso admin negada para usuário: ${req.user.email}`);
    return res.status(403).json({ error: 'Acesso negado - apenas administradores' });
  }
  
  next();
}

/**
 * GET /api/admin/pix/med/:orderId
 * Consultar MEDs/devoluções de um pedido específico
 */
router.get('/med/:orderId', requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    console.log(`🔍 Consultando MEDs para ordem: ${orderId}`);
    
    // Buscar ordem no banco
    const order = await storage.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    
    if (order.method !== 'pix') {
      return res.status(400).json({ error: 'Este pedido não é PIX' });
    }
    
    // Consultar devoluções na API do Woovi usando o orderId (correlationID)
    const refundsResponse = await getWooviRefunds(orderId);
    
    // Consultar status atual da cobrança
    const chargeStatus = await getWooviChargeStatus(orderId);
    
    return res.json({
      orderId,
      orderStatus: order.status,
      orderAmount: order.amount,
      customer: order.customer,
      chargeStatus: chargeStatus?.charge?.status || 'UNKNOWN',
      refunds: refundsResponse?.refunds || [],
      hasMED: (refundsResponse?.refunds || []).some(r => r.type === 'MED' || r.comment?.toLowerCase().includes('med')),
      totalRefunded: (refundsResponse?.refunds || []).reduce((sum, r) => sum + r.value, 0),
      consultedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Erro ao consultar MEDs:', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar MEDs' });
  }
});

/**
 * GET /api/admin/pix/med/check/:correlationId
 * Consultar MEDs direto na Woovi por correlationID (para debug)
 */
router.get('/med/check/:correlationId', requireAdmin, async (req, res) => {
  try {
    const { correlationId } = req.params;
    
    console.log(`🔍 Consultando MEDs direto na Woovi: ${correlationId}`);
    
    // Consultar devoluções na API do Woovi
    const refundsResponse = await getWooviRefunds(correlationId);
    const chargeStatus = await getWooviChargeStatus(correlationId);
    
    return res.json({
      correlationId,
      charge: chargeStatus?.charge || null,
      refunds: refundsResponse?.refunds || [],
      hasMED: (refundsResponse?.refunds || []).length > 0,
      consultedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Erro ao consultar MEDs:', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar MEDs' });
  }
});

/**
 * GET /api/admin/pix/med/scan
 * Escanear todos os pedidos PIX pagos recentemente para verificar MEDs
 * Query params: days (padrão 7)
 */
router.get('/med/scan', requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const limit = parseInt(req.query.limit as string) || 50;
    
    console.log(`🔍 Escaneando MEDs dos últimos ${days} dias...`);
    
    // Buscar pedidos PIX pagos recentes
    const firebaseStorage = storage as any;
    await firebaseStorage.ensureFirebaseReady();
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const ordersSnapshot = await firebaseStorage.db
      .collection('orders')
      .where('method', '==', 'pix')
      .where('status', '==', 'paid')
      .orderBy('paidAt', 'desc')
      .limit(limit)
      .get();
    
    const orders: any[] = [];
    ordersSnapshot.forEach((doc: any) => {
      const data = doc.data();
      orders.push({ id: doc.id, ...data });
    });
    
    console.log(`📋 Encontrados ${orders.length} pedidos PIX para escanear`);
    
    // Verificar MEDs para cada pedido
    const results: any[] = [];
    const medsFound: any[] = [];
    
    for (const order of orders) {
      try {
        const refundsResponse = await getWooviRefunds(order.id);
        const hasRefunds = (refundsResponse?.refunds || []).length > 0;
        
        if (hasRefunds) {
          const medInfo = {
            orderId: order.id,
            customer: order.customer?.name || order.customer?.email,
            amount: order.amount,
            paidAt: order.paidAt,
            refunds: refundsResponse?.refunds,
            totalRefunded: (refundsResponse?.refunds || []).reduce((sum: number, r: any) => sum + r.value, 0)
          };
          medsFound.push(medInfo);
          console.log(`⚠️ MED/Devolução encontrada para ordem ${order.id}`);
        }
        
        results.push({
          orderId: order.id,
          hasRefunds,
          refundsCount: refundsResponse?.refunds?.length || 0
        });
        
        // Pequeno delay para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        console.error(`Erro ao verificar MED para ${order.id}:`, error.message);
        results.push({
          orderId: order.id,
          hasRefunds: false,
          error: error.message
        });
      }
    }
    
    // Se encontrou MEDs, salvar alerta no Firestore
    if (medsFound.length > 0) {
      try {
        await firebaseStorage.db.collection('medAlerts').add({
          scannedAt: new Date(),
          scannedBy: req.user.email,
          totalScanned: orders.length,
          medsFound: medsFound.length,
          meds: medsFound,
          notified: false
        });
        console.log(`💾 Alerta de MED salvo: ${medsFound.length} encontrados`);
      } catch (e) {
        console.error('Erro ao salvar alerta de MED:', e);
      }
    }
    
    return res.json({
      scannedOrders: orders.length,
      daysScanned: days,
      medsFound: medsFound.length,
      meds: medsFound,
      summary: results,
      scannedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Erro ao escanear MEDs:', error);
    return res.status(500).json({ error: error.message || 'Erro ao escanear MEDs' });
  }
});

/**
 * GET /api/admin/pix/efibank/e2eid/:e2eId
 * Consultar PIX específico pelo e2eId diretamente na API EFI Bank
 */
router.get('/efibank/e2eid/:e2eId', requireAdmin, async (req, res) => {
  try {
    const { e2eId } = req.params;
    
    console.log(`🔍 Consultando PIX EFI Bank pelo e2eId: ${e2eId}`);
    
    const firebaseStorage = storage as any;
    await firebaseStorage.ensureFirebaseReady();
    
    const result = await getEfiBankPixRefunds(firebaseStorage.db, e2eId);
    
    if (!result.success) {
      return res.status(400).json({ 
        success: false, 
        error: result.error,
        e2eId,
        consultedAt: new Date().toISOString()
      });
    }
    
    // Verificar se há MEDs
    const meds = result.refunds.filter(r => 
      r.natureza === 'MED_FRAUDE' || r.natureza === 'MED_OPERACIONAL'
    );
    
    return res.json({
      success: true,
      e2eId,
      totalRefunds: result.refunds.length,
      hasMED: meds.length > 0,
      meds,
      allRefunds: result.refunds,
      consultedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Erro ao consultar PIX EFI Bank:', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar PIX EFI Bank' });
  }
});

/**
 * GET /api/admin/pix/efibank/refunds
 * Listar todos os PIX com devoluções/MEDs da API EFI Bank
 */
router.get('/efibank/refunds', requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 100;
    
    console.log(`🔍 Consultando PIX com devoluções EFI Bank (últimos ${days} dias)...`);
    
    const firebaseStorage = storage as any;
    await firebaseStorage.ensureFirebaseReady();
    
    const result = await listEfiBankPixWithRefunds(firebaseStorage.db, { days, limit });
    
    if (!result.success) {
      return res.status(400).json({ 
        success: false, 
        error: result.error,
        consultedAt: new Date().toISOString()
      });
    }
    
    // Separar MEDs de devoluções normais
    const medsFound: any[] = [];
    const refundsFound: any[] = [];
    
    for (const pix of result.pix) {
      for (const refund of pix.devolucoes || []) {
        const isMed = refund.natureza === 'MED_FRAUDE' || refund.natureza === 'MED_OPERACIONAL';
        const item = {
          e2eId: pix.endToEndId,
          txid: pix.txid,
          valor: pix.valor,
          pagador: pix.pagador?.nome,
          refund: {
            id: refund.id,
            rtrId: refund.rtrId,
            valor: refund.valor,
            status: refund.status,
            natureza: refund.natureza,
            motivo: refund.motivo,
            solicitacao: refund.horario.solicitacao,
            liquidacao: refund.horario.liquidacao
          }
        };
        
        if (isMed) {
          medsFound.push(item);
        } else {
          refundsFound.push(item);
        }
      }
    }
    
    return res.json({
      success: true,
      days,
      totalPix: result.pix.length,
      totalRefunds: result.totalRefunds,
      totalMeds: medsFound.length,
      meds: medsFound,
      refunds: refundsFound,
      consultedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Erro ao consultar devoluções EFI Bank:', error);
    return res.status(500).json({ error: error.message || 'Erro ao consultar devoluções EFI Bank' });
  }
});

/**
 * GET /api/admin/pix/med/alerts
 * Listar alertas de MED salvos
 */
router.get('/med/alerts', requireAdmin, async (req, res) => {
  try {
    const firebaseStorage = storage as any;
    await firebaseStorage.ensureFirebaseReady();
    
    const alertsSnapshot = await firebaseStorage.db
      .collection('medAlerts')
      .orderBy('scannedAt', 'desc')
      .limit(20)
      .get();
    
    const alerts: any[] = [];
    alertsSnapshot.forEach((doc: any) => {
      alerts.push({ id: doc.id, ...doc.data() });
    });
    
    return res.json(alerts);
  } catch (error: any) {
    console.error('Erro ao listar alertas de MED:', error);
    return res.status(500).json({ error: error.message || 'Erro ao listar alertas' });
  }
});

export default router;
