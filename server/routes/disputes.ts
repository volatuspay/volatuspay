/**
 * 🔴 DISPUTES ROUTES - Endpoints para MEDs/Disputas/Chargebacks
 * Consulta unificada de todos os gateways: Stripe, EfíBank, Woovi
 */

import { Router } from 'express';
import admin from 'firebase-admin';
import {
  getAllDisputes,
  getStripeDisputes,
  getStripeDisputeById,
  scanWooviMeds,
  getEfiBankRefunds,
  saveDisputeAlert,
  listDisputeAlerts,
  acknowledgeDisputeAlert,
} from '../lib/disputes-api.js';

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
 * GET /api/admin/disputes
 * Listar todas as disputas/MEDs de todos os gateways
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 50;
    const gateways = (req.query.gateways as string)?.split(',') as ('stripe' | 'woovi' | 'efibank')[] || undefined;

    console.log(`🔴 Consultando disputas: days=${days}, limit=${limit}, gateways=${gateways?.join(',') || 'all'}`);

    const result = await getAllDisputes(db, { days, limit, gateways });

    return res.json(result);
  } catch (error: any) {
    const errMsg = error?.message || error?.toString() || 'Erro desconhecido';
    console.error('❌ Erro ao listar disputas:', errMsg, error?.stack || '');
    return res.status(500).json({ error: errMsg });
  }
});

/**
 * GET /api/admin/disputes/stripe
 * Listar disputas apenas do Stripe
 */
router.get('/stripe', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;

    const disputes = await getStripeDisputes(db, { limit, status });

    return res.json({
      gateway: 'stripe',
      disputes,
      count: disputes.length,
      scannedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Erro ao listar disputas Stripe:', error);
    return res.status(500).json({ error: error.message || 'Erro ao listar disputas Stripe' });
  }
});

/**
 * GET /api/admin/disputes/stripe/:disputeId
 * Detalhes de uma disputa específica do Stripe
 */
router.get('/stripe/:disputeId', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const { disputeId } = req.params;
    const dispute = await getStripeDisputeById(db, disputeId);

    if (!dispute) {
      return res.status(404).json({ error: 'Disputa não encontrada' });
    }

    return res.json(dispute);
  } catch (error: any) {
    console.error('Erro ao buscar disputa Stripe:', error);
    return res.status(500).json({ error: error.message || 'Erro ao buscar disputa' });
  }
});

/**
 * GET /api/admin/disputes/woovi
 * Escanear MEDs do Woovi
 */
router.get('/woovi', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 100;

    const meds = await scanWooviMeds(db, { days, limit });

    return res.json({
      gateway: 'woovi',
      meds,
      count: meds.length,
      scannedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Erro ao escanear MEDs Woovi:', error);
    return res.status(500).json({ error: error.message || 'Erro ao escanear MEDs' });
  }
});

/**
 * GET /api/admin/disputes/efibank
 * Listar devoluções do EfíBank
 */
router.get('/efibank', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 100;

    const refunds = await getEfiBankRefunds(db, { days, limit });

    return res.json({
      gateway: 'efibank',
      refunds,
      count: refunds.length,
      scannedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Erro ao listar devoluções EfíBank:', error);
    return res.status(500).json({ error: error.message || 'Erro ao listar devoluções' });
  }
});

/**
 * GET /api/admin/disputes/alerts
 * Listar alertas de disputas salvos
 */
router.get('/alerts', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const limit = parseInt(req.query.limit as string) || 50;
    const acknowledged = req.query.acknowledged === 'true' ? true :
                         req.query.acknowledged === 'false' ? false : undefined;

    const alerts = await listDisputeAlerts(db, { limit, acknowledged });

    return res.json({
      alerts,
      count: alerts.length,
    });
  } catch (error: any) {
    console.error('Erro ao listar alertas:', error);
    return res.status(500).json({ error: error.message || 'Erro ao listar alertas' });
  }
});

/**
 * POST /api/admin/disputes/scan
 * Escanear todos os gateways e salvar alertas para novas disputas
 */
router.post('/scan', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const days = parseInt(req.body.days) || 7;
    const userEmail = req.user?.email || 'system';

    console.log(`🔴 Escaneando disputas dos últimos ${days} dias...`);

    const result = await getAllDisputes(db, { days });

    // Salvar alertas para cada disputa encontrada
    const savedAlerts: string[] = [];
    for (const dispute of result.disputes) {
      // Verificar se já existe alerta para esta disputa
      const existingAlert = await db.collection('disputeAlerts')
        .where('disputeId', '==', dispute.id)
        .limit(1)
        .get();

      if (existingAlert.empty) {
        const alertId = await saveDisputeAlert(db, dispute, userEmail);
        savedAlerts.push(alertId);
      }
    }

    return res.json({
      scannedAt: new Date().toISOString(),
      scannedBy: userEmail,
      daysScanned: days,
      totalDisputes: result.disputes.length,
      newAlerts: savedAlerts.length,
      disputes: result.disputes,
    });
  } catch (error: any) {
    const errMsg = error?.message || error?.toString() || 'Erro desconhecido';
    console.error('❌ Erro ao escanear disputas:', errMsg, error?.stack || '');
    return res.status(500).json({ error: errMsg });
  }
});

/**
 * POST /api/admin/disputes/alerts/:alertId/acknowledge
 * Marcar alerta como reconhecido
 */
router.post('/alerts/:alertId/acknowledge', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const { alertId } = req.params;
    const userEmail = req.user?.email || 'unknown';

    await acknowledgeDisputeAlert(db, alertId, userEmail);

    return res.json({ success: true, alertId, acknowledgedBy: userEmail });
  } catch (error: any) {
    console.error('Erro ao reconhecer alerta:', error);
    return res.status(500).json({ error: error.message || 'Erro ao reconhecer alerta' });
  }
});

/**
 * GET /api/admin/disputes/summary
 * Resumo de disputas por gateway e status
 */
router.get('/summary', requireAdmin, async (req, res) => {
  try {
    const db = admin.firestore();

    const days = parseInt(req.query.days as string) || 30;
    const result = await getAllDisputes(db, { days });

    // Agrupar por gateway
    const byGateway: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalAmount = 0;

    for (const dispute of result.disputes) {
      byGateway[dispute.gateway] = (byGateway[dispute.gateway] || 0) + 1;
      byStatus[dispute.status] = (byStatus[dispute.status] || 0) + 1;
      byType[dispute.type] = (byType[dispute.type] || 0) + 1;
      totalAmount += dispute.amount;
    }

    return res.json({
      totalDisputes: result.disputes.length,
      totalAmount,
      byGateway,
      byStatus,
      byType,
      daysAnalyzed: days,
      scannedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    const errMsg = error?.message || error?.toString() || 'Erro desconhecido';
    console.error('❌ Erro ao gerar resumo:', errMsg, error?.stack || '');
    return res.status(500).json({ error: errMsg });
  }
});

export default router;
