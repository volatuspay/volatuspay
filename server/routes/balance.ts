/**
 * 💰 API ROUTES - SISTEMA DE SALDO UNIFICADO
 * Migrado para Neon PostgreSQL — Firebase usado apenas para Auth
 */

import { Router, Request, Response } from 'express';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth.js';
import { 
  reconcileSellerBalance, 
  reconcileAllSellers 
} from '../services/balance-reconciliation.js';
import { runReconciliationNow } from '../services/balance-scheduler.js';
import { neonQuery } from '../lib/neon-db.js';

const router = Router();

router.use((req, res, next) => {
  console.log(`🟢 [BALANCE-ROUTER] Requisição chegou: ${req.method} ${req.path}`);
  (req as any).bypassAllSecurity = true;
  next();
});

/**
 * 📊 GET /api/balance/summary
 * Dashboard completo do seller
 */
router.get('/summary', async (req: Request, res: Response) => {
  console.log('📊 [BALANCE-SUMMARY] Requisição recebida');

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const emptyBalance = {
    totals: {
      BRL: { available: 0, pending: 0, reserved: 0, withdrawn: 0 },
      USD: { available: 0, pending: 0, reserved: 0, withdrawn: 0 },
      EUR: { available: 0, pending: 0, reserved: 0, withdrawn: 0 }
    },
    breakdown: {},
    recentWithdrawals: [],
    metadata: { hasBalance: false, lastReconciliation: null }
  };

  try {
    // Extrair auth opcional
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      const { getAdmin, ensureFirebaseReady: ensureFB } = await import('../lib/firebase-admin.js');
      await ensureFB();
      const adminSdk = getAdmin();
      const decodedToken = await adminSdk.auth().verifyIdToken(idToken);
      const userRecord = await adminSdk.auth().getUser(decodedToken.uid);
      (req as any).user = {
        uid: decodedToken.uid,
        email: decodedToken.email || null,
        isAdmin: userRecord.customClaims?.admin === true || userRecord.customClaims?.superAdmin === true
      };
    }
  } catch (_) {}

  try {
    const user = (req as any).user;
    if (!user || !user.uid) {
      return res.json(emptyBalance);
    }

    const sellerId = user.uid;
    const isAdmin = user.isAdmin;

    if (isAdmin) {
      let totals = {
        BRL: { available: 0, pending: 0, reserved: 0, withdrawn: 0 },
        USD: { available: 0, pending: 0, reserved: 0, withdrawn: 0 },
        EUR: { available: 0, pending: 0, reserved: 0, withdrawn: 0 }
      };
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT
          COALESCE(SUM(balance_available_brl),0) as avail_brl,
          COALESCE(SUM(balance_pending_brl),0) as pend_brl,
          COALESCE(SUM(balance_reserved_brl),0) as res_brl,
          COALESCE(SUM(total_withdrawn_brl),0) as with_brl,
          COALESCE(SUM(balance_available_usd),0) as avail_usd,
          COALESCE(SUM(balance_pending_usd),0) as pend_usd,
          COALESCE(SUM(balance_reserved_usd),0) as res_usd,
          COALESCE(SUM(total_withdrawn_usd),0) as with_usd,
          COALESCE(SUM(balance_available_eur),0) as avail_eur,
          COALESCE(SUM(balance_pending_eur),0) as pend_eur,
          COALESCE(SUM(balance_reserved_eur),0) as res_eur,
          COALESCE(SUM(total_withdrawn_eur),0) as with_eur
        FROM seller_balances`;
        if (rows[0]) {
          const r = rows[0];
          totals.BRL = { available: Number(r.avail_brl), pending: Number(r.pend_brl), reserved: Number(r.res_brl), withdrawn: Number(r.with_brl) };
          totals.USD = { available: Number(r.avail_usd), pending: Number(r.pend_usd), reserved: Number(r.res_usd), withdrawn: Number(r.with_usd) };
          totals.EUR = { available: Number(r.avail_eur), pending: Number(r.pend_eur), reserved: Number(r.res_eur), withdrawn: Number(r.with_eur) };
        }
      }, 'adminBalanceSummary');
      return res.json({ totals, breakdown: {}, recentWithdrawals: [], metadata: { hasBalance: true } });
    }

    let balanceRow: any = null;
    let recentWithdrawals: any[] = [];

    await neonQuery(async (sql) => {
      const [bRows, wRows] = await Promise.all([
        sql`SELECT * FROM seller_balances WHERE seller_id = ${sellerId} LIMIT 1`,
        sql`SELECT * FROM withdrawals WHERE seller_id = ${sellerId} ORDER BY created_at DESC LIMIT 10`
      ]);
      balanceRow = bRows[0] || null;
      recentWithdrawals = wRows.map((w: any) => ({
        withdrawalId: w.id,
        amount: Number(w.amount_cents || 0),
        currency: w.currency || 'BRL',
        status: w.status,
        method: w.method || 'pix',
        requestedAt: w.created_at,
        completedAt: w.completed_at || null
      }));
    }, `balanceSummary:${sellerId}`);

    if (!balanceRow) {
      // Calcular das orders se não há saldo registrado
      let computedTotals = {
        BRL: { available: 0, pending: 0, reserved: 0, withdrawn: 0 },
        USD: { available: 0, pending: 0, reserved: 0, withdrawn: 0 },
        EUR: { available: 0, pending: 0, reserved: 0, withdrawn: 0 }
      };
      await neonQuery(async (sql) => {
        const orders = await sql`
          SELECT status, currency, net_amount_cents, payment_method, financial_data, paid_at
          FROM orders WHERE seller_id = ${sellerId} AND status IN ('paid','approved','completed','pending','processing','waiting_payment')
        `;
        const now = Date.now();
        for (const o of orders) {
          const cur = ((o.currency || 'BRL') as string).toUpperCase() as keyof typeof computedTotals;
          if (!computedTotals[cur]) continue;
          const net = Number(o.net_amount_cents || 0);
          const fin = o.financial_data || {};
          const isCardPending = fin.balance_type === 'pending' && !fin.card_balance_released;
          const releaseDate = fin.release_date ? new Date(fin.release_date) : null;
          switch (o.status) {
            case 'paid': case 'approved': case 'completed':
              if (isCardPending && releaseDate && releaseDate > new Date()) {
                computedTotals[cur].pending += net;
              } else {
                computedTotals[cur].available += net;
              }
              break;
            case 'pending': case 'processing': case 'waiting_payment':
              computedTotals[cur].pending += net;
              break;
          }
        }
        const withdrawals = await sql`
          SELECT amount_cents, currency, status FROM withdrawals WHERE seller_id = ${sellerId}
        `;
        for (const w of withdrawals) {
          const cur = ((w.currency || 'BRL') as string).toUpperCase() as keyof typeof computedTotals;
          if (!computedTotals[cur]) continue;
          const amt = Number(w.amount_cents || 0);
          if (w.status === 'completed' || w.status === 'approved') {
            computedTotals[cur].available -= amt;
            computedTotals[cur].withdrawn += amt;
          } else if (w.status === 'processing' || w.status === 'pending') {
            computedTotals[cur].available -= amt;
            computedTotals[cur].reserved += amt;
          }
        }
        for (const key of Object.keys(computedTotals) as Array<keyof typeof computedTotals>) {
          if (computedTotals[key].available < 0) computedTotals[key].available = 0;
        }
      }, `balanceFallback:${sellerId}`);
      return res.json({ totals: computedTotals, breakdown: {}, recentWithdrawals, metadata: { hasBalance: false, computedFromOrders: true } });
    }

    const totals = {
      BRL: { available: Number(balanceRow.balance_available_brl || 0), pending: Number(balanceRow.balance_pending_brl || 0), reserved: Number(balanceRow.balance_reserved_brl || 0), withdrawn: Number(balanceRow.total_withdrawn_brl || 0) },
      USD: { available: Number(balanceRow.balance_available_usd || 0), pending: Number(balanceRow.balance_pending_usd || 0), reserved: Number(balanceRow.balance_reserved_usd || 0), withdrawn: Number(balanceRow.total_withdrawn_usd || 0) },
      EUR: { available: Number(balanceRow.balance_available_eur || 0), pending: Number(balanceRow.balance_pending_eur || 0), reserved: Number(balanceRow.balance_reserved_eur || 0), withdrawn: Number(balanceRow.total_withdrawn_eur || 0) }
    };

    res.json({
      totals,
      breakdown: {},
      recentWithdrawals,
      metadata: {
        hasBalance: true,
        lastReconciliation: balanceRow.last_reconciliation_at,
        lastWithdrawal: balanceRow.last_withdrawal_at,
        totalOrders: Number(balanceRow.total_orders || 0),
        approvedOrders: Number(balanceRow.approved_orders || 0)
      }
    });

  } catch (error: any) {
    console.error('[API /balance/summary] Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar resumo de saldo', details: error.message });
  }
});

/**
 * 📊 GET /api/balance/:sellerId
 */
router.get('/:sellerId', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;
    const user = (req as any).user;
    if (!user.isAdmin && user.uid !== sellerId) {
      return res.status(403).json({ error: 'Acesso negado: você só pode ver seu próprio saldo' });
    }

    let balanceRow: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM seller_balances WHERE seller_id = ${sellerId} LIMIT 1`;
      balanceRow = rows[0] || null;
    }, `getBalance:${sellerId}`);

    const row = balanceRow || {};
    const zeroBalance = {
      available: 0, pending: 0, reserved: 0, lifetime: 0, withdrawn: 0
    };

    res.json({
      sellerId,
      BRL: {
        available: Number(row.balance_available_brl || 0),
        pending: Number(row.balance_pending_brl || 0),
        reserved: Number(row.balance_reserved_brl || 0),
        lifetime: Number(row.lifetime_revenue_brl || 0),
        withdrawn: Number(row.total_withdrawn_brl || 0)
      },
      USD: {
        available: Number(row.balance_available_usd || 0),
        pending: Number(row.balance_pending_usd || 0),
        reserved: Number(row.balance_reserved_usd || 0),
        lifetime: Number(row.lifetime_revenue_usd || 0),
        withdrawn: Number(row.total_withdrawn_usd || 0)
      },
      EUR: {
        available: Number(row.balance_available_eur || 0),
        pending: Number(row.balance_pending_eur || 0),
        reserved: Number(row.balance_reserved_eur || 0),
        lifetime: Number(row.lifetime_revenue_eur || 0),
        withdrawn: Number(row.total_withdrawn_eur || 0)
      },
      stats: {
        totalOrders: Number(row.total_orders || 0),
        approvedOrders: Number(row.approved_orders || 0)
      },
      metadata: {
        lastReconciliation: row.last_reconciliation_at || null,
        lastWithdrawal: row.last_withdrawal_at || null,
        updatedAt: row.updated_at || null,
        newSeller: !balanceRow
      }
    });

  } catch (error: any) {
    console.error('[API /balance/:sellerId] Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar saldo', details: error.message });
  }
});

/**
 * 📜 GET /api/balance/:sellerId/movements
 */
router.get('/:sellerId/movements', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;
    const { currency, limit = 50, offset = 0 } = req.query;
    const user = (req as any).user;
    if (!user.isAdmin && user.uid !== sellerId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    let movements: any[] = [];
    await neonQuery(async (sql) => {
      if (currency) {
        movements = await sql`
          SELECT * FROM balance_movements WHERE seller_id = ${sellerId} AND currency = ${currency as string}
          ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}
        `;
      } else {
        movements = await sql`
          SELECT * FROM balance_movements WHERE seller_id = ${sellerId}
          ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}
        `;
      }
    }, `movements:${sellerId}`);

    res.json({ movements, total: movements.length, limit: Number(limit), hasMore: movements.length === Number(limit) });

  } catch (error: any) {
    console.error('[API /balance/:sellerId/movements] Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar movimentações', details: error.message });
  }
});

/**
 * 🔍 GET /api/balance/:sellerId/reconciliations
 */
router.get('/:sellerId/reconciliations', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;
    const { limit = 10 } = req.query;
    const user = (req as any).user;
    if (!user.isAdmin && user.uid !== sellerId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    let reconciliations: any[] = [];
    await neonQuery(async (sql) => {
      reconciliations = await sql`
        SELECT * FROM balance_reconciliations WHERE seller_id = ${sellerId}
        ORDER BY created_at DESC LIMIT ${Number(limit)}
      `;
    }, `reconciliations:${sellerId}`);

    res.json({ reconciliations, total: reconciliations.length });

  } catch (error: any) {
    console.error('[API /balance/:sellerId/reconciliations] Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar reconciliações', details: error.message });
  }
});

/**
 * ▶️ POST /api/balance/reconciliation/run
 */
router.post('/reconciliation/run', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { sellerId, currency } = req.body;
    if (sellerId && currency) {
      const result = await reconcileSellerBalance(sellerId, currency);
      res.json({ success: true, message: 'Reconciliação concluída', result });
    } else {
      await runReconciliationNow();
      res.json({ success: true, message: 'Reconciliação de todos os sellers iniciada' });
    }
  } catch (error: any) {
    console.error('[API /balance/reconciliation/run] Erro:', error);
    res.status(500).json({ error: 'Erro ao executar reconciliação', details: error.message });
  }
});

/**
 * 📊 GET /api/balance/reconciliation/stats
 */
router.get('/reconciliation/stats', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    let stats: any[] = [];
    let discrepancies: any[] = [];
    await neonQuery(async (sql) => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      [stats, discrepancies] = await Promise.all([
        sql`SELECT * FROM reconciliation_stats ORDER BY created_at DESC LIMIT 10`,
        sql`SELECT * FROM balance_reconciliations WHERE match = false AND created_at >= ${sevenDaysAgo} LIMIT 100`
      ]);
    }, 'reconciliationStats');

    res.json({
      recentExecutions: stats,
      discrepancies: { last7Days: discrepancies.length, items: discrepancies }
    });
  } catch (error: any) {
    console.error('[API /balance/reconciliation/stats] Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas', details: error.message });
  }
});

/**
 * 🔧 POST /api/balance/fix-orphan-reserved
 */
router.post('/fix-orphan-reserved', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const sellerId = req.body.sellerId || user.uid;

    let reservedAmount = 0;
    let totalPendingAmount = 0;

    await neonQuery(async (sql) => {
      const [balRows, pendRows] = await Promise.all([
        sql`SELECT balance_reserved_brl FROM seller_balances WHERE seller_id = ${sellerId} LIMIT 1`,
        sql`SELECT COALESCE(SUM(amount_cents),0) as total FROM withdrawals WHERE seller_id = ${sellerId} AND status = 'pending'`
      ]);
      reservedAmount = Number(balRows[0]?.balance_reserved_brl || 0);
      totalPendingAmount = Number(pendRows[0]?.total || 0);
    }, `fixOrphan:${sellerId}`);

    if (reservedAmount === 0) {
      return res.json({ success: true, message: 'Nenhum saldo reservado para corrigir', fixed: 0 });
    }

    const orphanAmount = reservedAmount - totalPendingAmount;
    if (orphanAmount <= 0) {
      return res.json({ success: true, message: 'Saldo reservado corresponde aos saques pendentes', fixed: 0 });
    }

    await neonQuery(async (sql) => {
      await sql`
        UPDATE seller_balances SET
          balance_reserved_brl = balance_reserved_brl - ${orphanAmount},
          balance_available_brl = balance_available_brl + ${orphanAmount},
          updated_at = NOW()
        WHERE seller_id = ${sellerId}
      `;
    }, `fixOrphanUpdate:${sellerId}`);

    res.json({
      success: true,
      message: `Saldo órfão corrigido: R$ ${(orphanAmount / 100).toFixed(2)} movido de reservado para disponível`,
      fixed: orphanAmount / 100
    });

  } catch (error: any) {
    console.error('[API /balance/fix-orphan-reserved] Erro:', error);
    res.status(500).json({ error: 'Erro ao corrigir saldo', details: error.message });
  }
});

/**
 * 🔄 POST /api/balance/initialize
 */
router.post('/initialize', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const sellerId = req.body.sellerId || user.uid;
    const isAdmin = user.isAdmin || (req as any).authUser?.isAdmin;
    if (sellerId !== user.uid && !isAdmin) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    let existing: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT seller_id, balance_available_brl, balance_pending_brl, balance_reserved_brl FROM seller_balances WHERE seller_id = ${sellerId} LIMIT 1`;
      existing = rows[0] || null;
    }, `balanceInit:${sellerId}`);

    if (existing) {
      return res.json({
        success: true,
        message: 'Documento de saldo já existe',
        initialized: false,
        balance: {
          available_BRL: Number(existing.balance_available_brl || 0),
          pending_BRL: Number(existing.balance_pending_brl || 0),
          reserved_BRL: Number(existing.balance_reserved_brl || 0)
        }
      });
    }

    // Calcular saldo das orders pagas
    let totalGross = 0;
    let totalNet = 0;
    let totalWithdrawn = 0;
    let orderCount = 0;

    await neonQuery(async (sql) => {
      const [orders, withdrawals] = await Promise.all([
        sql`SELECT amount_cents, net_amount_cents FROM orders WHERE seller_id = ${sellerId} AND status = 'paid'`,
        sql`SELECT COALESCE(SUM(amount_cents),0) as total FROM withdrawals WHERE seller_id = ${sellerId} AND status IN ('approved','completed')`
      ]);
      orderCount = orders.length;
      for (const o of orders) {
        totalGross += Number(o.amount_cents || 0);
        totalNet += Number(o.net_amount_cents || o.amount_cents || 0);
      }
      totalWithdrawn = Number(withdrawals[0]?.total || 0);

      const netBalance = Math.max(0, totalNet - totalWithdrawn);
      await sql`
        INSERT INTO seller_balances (seller_id, balance_available_brl, total_withdrawn_brl, lifetime_revenue_brl, total_orders, created_at, updated_at)
        VALUES (${sellerId}, ${netBalance}, ${totalWithdrawn}, ${totalNet}, ${orderCount}, NOW(), NOW())
        ON CONFLICT (seller_id) DO NOTHING
      `;
    }, `balanceInitCalc:${sellerId}`);

    const netBalance = Math.max(0, totalNet - totalWithdrawn);
    res.json({
      success: true,
      message: 'Saldo inicializado com sucesso',
      initialized: true,
      balance: { available_BRL: netBalance, pending_BRL: 0, reserved_BRL: 0 },
      calculation: {
        totalOrders: orderCount,
        totalGross: totalGross / 100,
        totalWithdrawn: totalWithdrawn / 100,
        netBalance: netBalance / 100
      }
    });

  } catch (error: any) {
    console.error('[API /balance/initialize] Erro:', error);
    res.status(500).json({ error: 'Erro ao inicializar saldo', details: error.message });
  }
});

export default router;
