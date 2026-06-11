/**
 * 🚨 ROTAS DE ALERTAS DE FRAUDE - ORÁCULO PAY
 * 
 * Endpoints para monitoramento de alertas AI de fraude em saques
 * - Admin lista todos os alertas
 * - Filtros: riskLevel, reviewStatus
 * - Paginação cursor-based
 */

import { Router, Request, Response } from 'express';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth.js';
import { getFirestore, ensureFirebaseReady } from '../lib/firebase-admin.js';
import type { FraudAlert } from '../../shared/balance-schema.js';

const router = Router();

/**
 * 📋 LISTAR ALERTAS DE FRAUDE (ADMIN ONLY)
 * 
 * GET /api/admin/fraud-alerts?reviewStatus=unreviewed&riskLevel=high&limit=50
 * AUTH: Admin only
 * 
 * Query params:
 * - reviewStatus: 'unreviewed' | 'reviewed' | 'false_positive' | 'confirmed_fraud' | 'disputed'
 * - riskLevel: 'low' | 'medium' | 'high' | 'critical'
 * - limit: number (default 50)
 * - cursor: string (para paginação)
 */
router.get('/', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { reviewStatus, riskLevel, limit = '50', cursor } = req.query;

    await ensureFirebaseReady();
    const db = getFirestore();

    let query = db.collection('fraudAlerts').orderBy('createdAt', 'desc');

    // ✅ FILTRO POR STATUS DE REVISÃO
    if (reviewStatus) {
      query = query.where('reviewStatus', '==', reviewStatus) as any;
    }

    // ✅ FILTRO POR NÍVEL DE RISCO
    if (riskLevel) {
      query = query.where('riskLevel', '==', riskLevel) as any;
    }

    // ✅ CURSOR-BASED PAGINATION (high-volume)
    if (cursor) {
      const cursorDoc = await db.collection('fraudAlerts').doc(cursor as string).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc) as any;
      }
    }

    query = query.limit(parseInt(limit as string)) as any;

    const snapshot = await query.get();
    const alerts = snapshot.docs.map(doc => ({
      ...doc.data(),
      alertId: doc.id
    })) as FraudAlert[];

    // ✅ PRÓXIMO CURSOR
    const nextCursor = snapshot.docs.length > 0 
      ? snapshot.docs[snapshot.docs.length - 1].id 
      : null;

    console.log(`🚨 [FRAUD ALERTS] Listados ${alerts.length} alertas (reviewStatus: ${reviewStatus || 'all'}, riskLevel: ${riskLevel || 'all'})`);

    res.json({ 
      alerts,
      nextCursor,
      hasMore: snapshot.docs.length === parseInt(limit as string)
    });

  } catch (error: any) {
    console.error('[API /admin/fraud-alerts GET] Erro:', error);
    res.status(500).json({ error: 'Erro ao listar alertas de fraude' });
  }
});

/**
 * 📝 BUSCAR ALERTA POR ID (ADMIN ONLY)
 * 
 * GET /api/admin/fraud-alerts/:id
 * AUTH: Admin only
 */
router.get('/:id', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await ensureFirebaseReady();
    const db = getFirestore();

    const alertDoc = await db.collection('fraudAlerts').doc(id).get();

    if (!alertDoc.exists) {
      return res.status(404).json({ error: 'Alerta não encontrado' });
    }

    const alert = { ...alertDoc.data(), alertId: alertDoc.id } as FraudAlert;

    res.json({ alert });

  } catch (error: any) {
    console.error('[API /admin/fraud-alerts/:id GET] Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar alerta' });
  }
});

/**
 * ✅ MARCAR COMO REVISADO (ADMIN ONLY)
 * 
 * PATCH /api/admin/fraud-alerts/:id/review
 * AUTH: Admin only
 * 
 * Body: {
 *   reviewStatus: 'reviewed' | 'false_positive' | 'confirmed_fraud' | 'disputed',
 *   reviewNotes?: string
 * }
 */
router.patch('/:id/review', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reviewStatus, reviewNotes } = req.body;

    // ✅ VALIDAÇÕES
    const validStatuses = ['reviewed', 'false_positive', 'confirmed_fraud', 'disputed'];
    if (!reviewStatus || !validStatuses.includes(reviewStatus)) {
      return res.status(400).json({ 
        error: 'reviewStatus inválido. Use: reviewed, false_positive, confirmed_fraud ou disputed' 
      });
    }

    await ensureFirebaseReady();
    const db = getFirestore();
    const admin = (await import('../lib/firebase-admin.js')).getAdmin();

    const alertRef = db.collection('fraudAlerts').doc(id);
    const alertDoc = await alertRef.get();

    if (!alertDoc.exists) {
      return res.status(404).json({ error: 'Alerta não encontrado' });
    }

    // ✅ ATUALIZAR STATUS DE REVISÃO
    const now = admin.firestore.Timestamp.now();
    await alertRef.update({
      reviewStatus,
      reviewedBy: user.uid,
      reviewedByEmail: user.email,
      reviewedAt: now,
      reviewNotes: reviewNotes || null,
      updatedAt: now
    });

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-subscriptions.js').then(({ neonUpdateFraudAlert }) => {
      neonUpdateFraudAlert(id, {
        reviewStatus,
        reviewedBy: user.uid,
        reviewedByEmail: user.email,
        reviewedAt: now.toDate ? now.toDate() : new Date(),
        reviewNotes: reviewNotes || null,
      });
    }).catch(() => {});

    console.log(`✅ [FRAUD ALERT] Alerta ${id} revisado como ${reviewStatus} por ${user.email}`);

    res.json({
      success: true,
      alertId: id,
      reviewStatus,
      message: 'Alerta revisado com sucesso!'
    });

  } catch (error: any) {
    console.error('[API /admin/fraud-alerts/:id/review PATCH] Erro:', error);
    res.status(500).json({ error: 'Erro ao revisar alerta' });
  }
});

/**
 * 📊 ESTATÍSTICAS DE ALERTAS (ADMIN ONLY)
 * 
 * GET /api/admin/fraud-alerts/stats
 * AUTH: Admin only
 */
router.get('/stats/summary', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    await ensureFirebaseReady();
    const db = getFirestore();

    // Buscar últimos 1000 alertas para estatísticas rápidas
    const snapshot = await db.collection('fraudAlerts')
      .orderBy('createdAt', 'desc')
      .limit(1000)
      .get();

    const alerts = snapshot.docs.map(d => d.data() as FraudAlert);

    // Calcular estatísticas
    const stats = {
      total: alerts.length,
      byRiskLevel: {
        low: alerts.filter(a => a.riskLevel === 'low').length,
        medium: alerts.filter(a => a.riskLevel === 'medium').length,
        high: alerts.filter(a => a.riskLevel === 'high').length,
        critical: alerts.filter(a => a.riskLevel === 'critical').length
      },
      byReviewStatus: {
        unreviewed: alerts.filter(a => a.reviewStatus === 'unreviewed').length,
        reviewed: alerts.filter(a => a.reviewStatus === 'reviewed').length,
        false_positive: alerts.filter(a => a.reviewStatus === 'false_positive').length,
        confirmed_fraud: alerts.filter(a => a.reviewStatus === 'confirmed_fraud').length,
        disputed: alerts.filter(a => a.reviewStatus === 'disputed').length
      },
      averageRiskScore: alerts.length > 0 
        ? Math.round(alerts.reduce((sum, a) => sum + a.riskScore, 0) / alerts.length)
        : 0
    };

    console.log(`📊 [FRAUD STATS] Estatísticas calculadas: ${stats.total} alertas, ${stats.byReviewStatus.unreviewed} não revisados`);

    res.json({ stats });

  } catch (error: any) {
    console.error('[API /admin/fraud-alerts/stats/summary GET] Erro:', error);
    res.status(500).json({ error: 'Erro ao calcular estatísticas' });
  }
});

export default router;
