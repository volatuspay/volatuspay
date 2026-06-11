/**
 * 💰 ROTAS DE SAQUES
 * Migrado para Neon PostgreSQL — Firebase apenas para Auth
 */

import { Router, Request, Response } from 'express';
import { verifyFirebaseToken, requireAdmin, require2FAVerified, checkAdminAccess } from '../security/firebase-auth.js';
import { Withdrawal, WithdrawalStatus } from '../../shared/balance-schema.js';
import { nanoid } from 'nanoid';
import { analyzeFraud } from '../services/fraud-detection.js';
import { sendWithdrawalApprovedEmail, sendWithdrawalRejectedEmail } from '../lib/email-service.js';
import { replayProtectionMiddleware, idempotencyMiddleware } from '../security/idempotency.js';
import { userRateLimit } from '../security/user-rate-limiter.js';
import { neonQuery } from '../lib/neon-db.js';
import { getRTDB } from '../lib/firebase-admin.js';

const router = Router();

const DEFAULT_FEE_FIXED = 5; // R$

async function getWithdrawalFeeFixed(): Promise<number> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) return DEFAULT_FEE_FIXED;
    const snap = await rtdb.ref('config/withdrawalFeeFixed').once('value');
    const val = snap.val();
    if (typeof val === 'number' && val >= 0) return val;
    return DEFAULT_FEE_FIXED;
  } catch {
    return DEFAULT_FEE_FIXED;
  }
}

async function getSellerFeeFixed(sellerId: string): Promise<number> {
  try {
    let customFee: number | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT custom_withdrawal_fee_fixed FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (rows[0]?.custom_withdrawal_fee_fixed != null) {
        customFee = Number(rows[0].custom_withdrawal_fee_fixed);
      }
    }, `sellerFee:${sellerId}`);
    if (customFee !== null && customFee >= 0) return customFee;
  } catch {}
  return getWithdrawalFeeFixed();
}

/**
 * 📝 SOLICITAR SAQUE (POST /api/withdrawals)
 */
router.post('/', verifyFirebaseToken, userRateLimit('withdrawal'), replayProtectionMiddleware, idempotencyMiddleware, async (req: Request, res: Response) => {
  const { amount, currency, pixData, userType } = req.body;
  try {
    const user = (req as any).user;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });
    if (!currency || !['BRL', 'USD', 'EUR'].includes(currency)) return res.status(400).json({ error: 'Moeda inválida' });
    if (!pixData || !pixData.pixKey || !pixData.holderName || !pixData.holderEmail || !pixData.holderDocument) {
      return res.status(400).json({ error: 'Dados PIX incompletos (pixKey, holderName, holderEmail, holderDocument obrigatórios)' });
    }

    const cur = currency.toLowerCase();
    const availableCol = `balance_available_${cur}`;
    const reservedCol = `balance_reserved_${cur}`;

    // Auto-detectar tipo de usuário
    let detectedUserType = userType || 'seller';
    if (!userType) {
      await neonQuery(async (sql) => {
        const sbRows = await sql`SELECT ${sql(availableCol)} FROM seller_balances WHERE seller_id = ${user.uid} LIMIT 1`;
        if (sbRows[0] && Number(sbRows[0][availableCol] || 0) > 0) {
          detectedUserType = 'seller';
        } else {
          const abRows = await sql`SELECT balance_available_brl FROM affiliate_balances WHERE affiliate_id = ${user.uid} LIMIT 1`;
          if (abRows[0] && Number(abRows[0].balance_available_brl || 0) > 0) {
            detectedUserType = 'affiliate';
          }
        }
      }, `detectUserType:${user.uid}`);
    }

    if (detectedUserType === 'affiliate' && currency !== 'BRL') {
      return res.status(400).json({ error: 'Afiliados podem sacar apenas em BRL (Reais)' });
    }

    const withdrawalId = `wd_${Date.now()}_${nanoid(8)}`;
    const feeFixed = await getSellerFeeFixed(user.uid);
    const WITHDRAWAL_FEE_CENTAVOS = Math.round(feeFixed * 100);
    const totalToDebit = amount + WITHDRAWAL_FEE_CENTAVOS;
    const balanceTable = detectedUserType === 'affiliate' ? 'affiliate_balances' : 'seller_balances';
    const balanceIdCol = detectedUserType === 'affiliate' ? 'affiliate_id' : 'seller_id';

    // Verificar saldo e debitar atomicamente
    let available = 0;
    let balanceOk = false;

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT ${sql(availableCol)} FROM ${sql(balanceTable)} WHERE ${sql(balanceIdCol)} = ${user.uid} LIMIT 1`;
      if (!rows[0]) throw new Error('BALANCE_NOT_FOUND');
      available = Number(rows[0][availableCol] || 0);
      if (available < totalToDebit) throw new Error(`INSUFFICIENT_FUNDS_WITH_FEE:${available}:${amount}:${WITHDRAWAL_FEE_CENTAVOS}`);

      await sql`
        UPDATE ${sql(balanceTable)} SET
          ${sql(availableCol)} = ${sql(availableCol)} - ${totalToDebit},
          ${sql(reservedCol)} = ${sql(reservedCol)} + ${amount},
          updated_at = NOW()
        WHERE ${sql(balanceIdCol)} = ${user.uid}
      `;

      await sql`
        INSERT INTO withdrawals (id, seller_id, user_type, amount_cents, fee_cents, currency, status,
          pix_key, pix_key_type, holder_name, holder_email, holder_document, created_at, updated_at)
        VALUES (${withdrawalId}, ${user.uid}, ${detectedUserType}, ${amount}, ${WITHDRAWAL_FEE_CENTAVOS},
          ${currency}, 'pending', ${pixData.pixKey}, ${pixData.pixKeyType || 'unknown'},
          ${pixData.holderName}, ${pixData.holderEmail}, ${pixData.holderDocument}, NOW(), NOW())
      `;
      balanceOk = true;
    }, `createWithdrawal:${withdrawalId}`);

    if (!balanceOk) {
      return res.status(500).json({ error: 'Erro ao processar saque' });
    }

    console.log(`💰 [WITHDRAWAL] Saque solicitado: ${withdrawalId} - ${amount / 100} ${currency} (user: ${user.uid})`);

    // Análise de fraude assíncrona
    const wdObj = { withdrawalId, sellerId: user.uid, amount, currency, status: 'pending', pixData } as any;
    analyzeFraud(wdObj, available).catch(() => {});

    res.json({ success: true, withdrawalId, status: 'pending', message: 'Saque solicitado com sucesso! Aguardando aprovação do administrador.' });

  } catch (error: any) {
    console.error('[API /withdrawals POST] Erro:', error);
    if (error.message === 'BALANCE_NOT_FOUND') return res.status(404).json({ error: 'Saldo não encontrado. Você ainda não teve vendas.' });
    if (error.message === 'CURRENCY_NOT_FOUND') return res.status(400).json({ error: `Você não possui saldo em ${currency}` });
    if (error.message?.startsWith('INSUFFICIENT_FUNDS_WITH_FEE:')) {
      const [, avail, req2, fee] = error.message.split(':');
      const a = parseInt(avail); const r = parseInt(req2); const f = parseInt(fee);
      return res.status(400).json({ error: `Saldo insuficiente. Para sacar R$ ${(r/100).toFixed(2)}, você precisa de R$ ${((r+f)/100).toFixed(2)} (valor + R$ ${(f/100).toFixed(2)} de taxa). Disponível: R$ ${(a/100).toFixed(2)}`, available: a, requested: r, fee: f, totalNeeded: r+f, currency });
    }
    res.status(500).json({ error: 'Erro ao solicitar saque' });
  }
});

/**
 * 📋 LISTAR SAQUES (GET /api/withdrawals)
 */
router.get('/', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { status, limit = '50' } = req.query;
    const lim = parseInt(limit as string, 10);

    let isAdmin = user.isAdmin || (req as any).authUser?.isAdmin;
    if (!isAdmin) isAdmin = await checkAdminAccess(user.uid);

    let withdrawals: any[] = [];
    await neonQuery(async (sql) => {
      if (isAdmin) {
        if (status) {
          withdrawals = await sql`SELECT * FROM withdrawals WHERE status = ${status as string} ORDER BY created_at DESC LIMIT ${lim}`;
        } else {
          withdrawals = await sql`SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT ${lim}`;
        }
      } else {
        if (status) {
          withdrawals = await sql`SELECT * FROM withdrawals WHERE seller_id = ${user.uid} AND status = ${status as string} ORDER BY created_at DESC LIMIT ${lim}`;
        } else {
          withdrawals = await sql`SELECT * FROM withdrawals WHERE seller_id = ${user.uid} ORDER BY created_at DESC LIMIT ${lim}`;
        }
      }
    }, `listWithdrawals:${user.uid}`);

    const mapped = withdrawals.map((w: any) => ({
      id: w.id,
      withdrawalId: w.id,
      sellerId: w.seller_id,
      tenantId: w.seller_id,
      userType: w.user_type || 'seller',
      amount: Number(w.amount_cents || 0),
      fee: Number(w.fee_cents || 0),
      currency: w.currency || 'BRL',
      status: w.status,
      pixData: {
        pixKey: w.pix_key,
        pixKeyType: w.pix_key_type,
        holderName: w.holder_name,
        holderEmail: w.holder_email,
        holderDocument: w.holder_document
      },
      pixKey: w.pix_key,
      type: 'pix',
      netAmount: Number(w.amount_cents || 0),
      requestedAt: w.created_at,
      createdAt: w.created_at,
      approvedAt: w.approved_at,
      rejectedAt: w.rejected_at,
      rejectionReason: w.rejection_reason
    }));

    return res.json(mapped);

  } catch (error: any) {
    console.error('[API /withdrawals GET] Erro:', error);
    res.status(500).json({ error: 'Erro ao listar saques' });
  }
});

/**
 * ✅ APROVAR SAQUE - PATCH /:id/approve
 */
router.patch('/:id/approve', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    await approveWithdrawal(id, user, res);
  } catch (error: any) {
    handleWithdrawalError(error, res, 'approve');
  }
});

router.post('/:id/approve', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    await approveWithdrawal(id, user, res);
  } catch (error: any) {
    handleWithdrawalError(error, res, 'approve');
  }
});

async function approveWithdrawal(id: string, user: any, res: Response) {
  let wd: any = null;
  await neonQuery(async (sql) => {
    const rows = await sql`SELECT * FROM withdrawals WHERE id = ${id} LIMIT 1`;
    if (!rows[0]) throw new Error('WITHDRAWAL_NOT_FOUND');
    wd = rows[0];
    if (wd.status !== 'pending') throw new Error(`STATUS_CONFLICT:${wd.status}`);

    const cur = (wd.currency || 'BRL').toLowerCase();
    const reservedCol = `balance_reserved_${cur}`;
    const withdrawnCol = `total_withdrawn_${cur}`;
    const balanceTable = (wd.user_type || 'seller') === 'affiliate' ? 'affiliate_balances' : 'seller_balances';
    const balanceIdCol = (wd.user_type || 'seller') === 'affiliate' ? 'affiliate_id' : 'seller_id';

    const bRows = await sql`SELECT ${sql(reservedCol)} FROM ${sql(balanceTable)} WHERE ${sql(balanceIdCol)} = ${wd.seller_id} LIMIT 1`;
    if (!bRows[0]) throw new Error('BALANCE_NOT_FOUND');
    const reserved = Number(bRows[0][reservedCol] || 0);
    const amount = Number(wd.amount_cents || 0);
    if (reserved < amount) throw new Error(`INSUFFICIENT_RESERVED:${reserved}:${amount}`);

    await Promise.all([
      sql`UPDATE withdrawals SET status = 'approved', approved_at = NOW(), approved_by = ${user.uid}, approved_by_email = ${user.email || ''}, updated_at = NOW() WHERE id = ${id}`,
      sql`UPDATE ${sql(balanceTable)} SET ${sql(reservedCol)} = ${sql(reservedCol)} - ${amount}, ${sql(withdrawnCol)} = COALESCE(${sql(withdrawnCol)}, 0) + ${amount}, updated_at = NOW() WHERE ${sql(balanceIdCol)} = ${wd.seller_id}`
    ]);
  }, `approveWithdrawal:${id}`);

  const pixKey = wd?.pix_key || 'N/A';
  const sellerEmail = wd?.holder_email || '';
  const sellerName = wd?.holder_name || '';
  if (sellerEmail) {
    sendWithdrawalApprovedEmail({ sellerEmail, sellerName, amount: Number(wd.amount_cents), currency: wd.currency, pixKey, withdrawalId: id }).catch(() => {});
  }

  res.json({ success: true, withdrawalId: id, status: 'approved', message: 'Saque aprovado com sucesso!' });
}

/**
 * ❌ RECUSAR SAQUE - PATCH /:id/reject
 */
router.patch('/:id/reject', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: 'Motivo da recusa é obrigatório' });
    await rejectWithdrawal(id, user, reason, res);
  } catch (error: any) {
    handleWithdrawalError(error, res, 'reject');
  }
});

router.post('/:id/reject', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: 'Motivo da recusa é obrigatório' });
    await rejectWithdrawal(id, user, reason, res);
  } catch (error: any) {
    handleWithdrawalError(error, res, 'reject');
  }
});

async function rejectWithdrawal(id: string, user: any, reason: string, res: Response) {
  let wd: any = null;
  await neonQuery(async (sql) => {
    const rows = await sql`SELECT * FROM withdrawals WHERE id = ${id} LIMIT 1`;
    if (!rows[0]) throw new Error('WITHDRAWAL_NOT_FOUND');
    wd = rows[0];
    if (wd.status !== 'pending') throw new Error(`STATUS_CONFLICT:${wd.status}`);

    const cur = (wd.currency || 'BRL').toLowerCase();
    const reservedCol = `balance_reserved_${cur}`;
    const availableCol = `balance_available_${cur}`;
    const balanceTable = (wd.user_type || 'seller') === 'affiliate' ? 'affiliate_balances' : 'seller_balances';
    const balanceIdCol = (wd.user_type || 'seller') === 'affiliate' ? 'affiliate_id' : 'seller_id';

    const bRows = await sql`SELECT ${sql(reservedCol)} FROM ${sql(balanceTable)} WHERE ${sql(balanceIdCol)} = ${wd.seller_id} LIMIT 1`;
    if (!bRows[0]) throw new Error('BALANCE_NOT_FOUND');
    const reserved = Number(bRows[0][reservedCol] || 0);
    const amount = Number(wd.amount_cents || 0);
    if (reserved < amount) throw new Error(`INSUFFICIENT_RESERVED:${reserved}:${amount}`);

    const fee = Number(wd.fee_cents || 0);
    const totalReturn = amount + fee;

    await Promise.all([
      sql`UPDATE withdrawals SET status = 'rejected', rejected_at = NOW(), rejected_by = ${user.uid}, rejected_by_email = ${user.email || ''}, rejection_reason = ${reason}, updated_at = NOW() WHERE id = ${id}`,
      sql`UPDATE ${sql(balanceTable)} SET ${sql(reservedCol)} = ${sql(reservedCol)} - ${amount}, ${sql(availableCol)} = ${sql(availableCol)} + ${totalReturn}, updated_at = NOW() WHERE ${sql(balanceIdCol)} = ${wd.seller_id}`
    ]);
  }, `rejectWithdrawal:${id}`);

  const sellerEmail = wd?.holder_email || '';
  const sellerName = wd?.holder_name || '';
  const pixKey = wd?.pix_key || 'N/A';
  if (sellerEmail) {
    sendWithdrawalRejectedEmail({ sellerEmail, sellerName, amount: Number(wd.amount_cents), currency: wd.currency, pixKey, withdrawalId: id, reason }).catch(() => {});
  }

  res.json({ success: true, withdrawalId: id, status: 'rejected', message: 'Saque recusado com sucesso!' });
}

function handleWithdrawalError(error: any, res: Response, action: string) {
  console.error(`[WITHDRAWAL ${action}] Erro:`, error);
  if (error.message === 'WITHDRAWAL_NOT_FOUND') return res.status(404).json({ error: 'Saque não encontrado' });
  if (error.message?.startsWith('STATUS_CONFLICT:')) return res.status(409).json({ error: `Saque já processado (status: ${error.message.split(':')[1]})`, code: 'STATUS_CONFLICT' });
  if (error.message === 'BALANCE_NOT_FOUND') return res.status(404).json({ error: 'Saldo do vendedor não encontrado' });
  if (error.message?.startsWith('INSUFFICIENT_RESERVED:')) return res.status(400).json({ error: 'Saldo reservado insuficiente', code: 'INSUFFICIENT_RESERVED' });
  res.status(500).json({ error: `Erro ao ${action} saque`, details: error.message });
}

/**
 * GET /api/withdrawals/crypto — Saques cripto do seller
 */
router.get('/crypto', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    let items: any[] = [];
    await neonQuery(async (sql) => {
      items = await sql`SELECT * FROM crypto_withdrawals WHERE seller_id = ${user.uid} ORDER BY created_at DESC LIMIT 50`;
    }, `cryptoList:${user.uid}`);
    return res.json(items);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/withdrawals/crypto/rate — Cotação USD/BRL
 */
router.get('/crypto/rate', verifyFirebaseToken, async (_req: Request, res: Response) => {
  try {
    const resp = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('API unavailable');
    const data: any = await resp.json();
    const rate = parseFloat(data['USDBRL']?.bid || data['USDBRL']?.ask || '5.20');
    return res.json({ rate, source: 'awesomeapi', updatedAt: new Date().toISOString() });
  } catch {
    return res.json({ rate: 5.20, source: 'fallback', updatedAt: new Date().toISOString() });
  }
});

/**
 * POST /api/withdrawals/crypto — Solicitar saque em USDT
 */
router.post('/crypto', verifyFirebaseToken, userRateLimit('withdrawal'), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { amountBRL, walletAddress, usdtAmount, usdRate } = req.body;
    const MINIMUM_BRL = 40000;
    if (!amountBRL || amountBRL < MINIMUM_BRL) return res.status(400).json({ error: 'Valor mínimo para saque em cripto é R$ 400,00' });
    if (!walletAddress || String(walletAddress).trim().length < 10) return res.status(400).json({ error: 'Endereço de carteira inválido' });

    const id = nanoid();
    await neonQuery(async (sql) => {
      const bRows = await sql`SELECT balance_available_brl FROM seller_balances WHERE seller_id = ${user.uid} LIMIT 1`;
      if (!bRows[0]) throw new Error('BALANCE_NOT_FOUND');
      const available = Number(bRows[0].balance_available_brl || 0);
      if (available < amountBRL) throw new Error('INSUFFICIENT_FUNDS');

      await sql`
        INSERT INTO crypto_withdrawals (id, seller_id, seller_email, amount_brl, usdt_amount, usd_rate, wallet_address, status, created_at, updated_at)
        VALUES (${id}, ${user.uid}, ${user.email || ''}, ${amountBRL}, ${Number(usdtAmount)||0}, ${Number(usdRate)||0}, ${String(walletAddress).trim()}, 'pending', NOW(), NOW())
      `;
      await sql`
        UPDATE seller_balances SET balance_available_brl = balance_available_brl - ${amountBRL}, balance_reserved_brl = balance_reserved_brl + ${amountBRL}, updated_at = NOW()
        WHERE seller_id = ${user.uid}
      `;
    }, `cryptoWithdraw:${id}`);

    return res.json({ success: true, id });
  } catch (err: any) {
    if (err.message === 'BALANCE_NOT_FOUND') return res.status(404).json({ error: 'Saldo não encontrado.' });
    if (err.message === 'INSUFFICIENT_FUNDS') return res.status(400).json({ error: 'Saldo disponível insuficiente para este saque' });
    return res.status(500).json({ error: 'Erro ao solicitar saque em cripto' });
  }
});

/**
 * GET /api/withdrawals/admin/crypto-withdrawals
 */
router.get('/admin/crypto-withdrawals', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const isAdmin = authUser?.isAdmin || process.env.ADMIN_EMAIL && authUser?.email === process.env.ADMIN_EMAIL;
    if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' });

    let items: any[] = [];
    await neonQuery(async (sql) => {
      items = await sql`SELECT * FROM crypto_withdrawals ORDER BY created_at DESC LIMIT 200`;
    }, 'adminCryptoList');
    return res.json(items);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/withdrawals/admin/crypto-withdrawals/:id/approve
 */
router.post('/admin/crypto-withdrawals/:id/approve', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const isAdmin = authUser?.isAdmin || process.env.ADMIN_EMAIL && authUser?.email === process.env.ADMIN_EMAIL;
    if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' });
    const { id } = req.params;

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM crypto_withdrawals WHERE id = ${id} LIMIT 1`;
      if (!rows[0]) throw new Error('Saque não encontrado');
      const wd = rows[0];
      if (wd.status !== 'pending') throw new Error('Saque já processado');
      const amountBRL = Number(wd.amount_brl || 0);

      const bRows = await sql`SELECT balance_reserved_brl FROM seller_balances WHERE seller_id = ${wd.seller_id} LIMIT 1`;
      if (!bRows[0]) throw new Error('Saldo não encontrado');
      if (Number(bRows[0].balance_reserved_brl || 0) < amountBRL) throw new Error('Saldo reservado insuficiente');

      await Promise.all([
        sql`UPDATE crypto_withdrawals SET status = 'approved', approved_at = NOW(), approved_by = ${authUser?.uid || 'admin'}, updated_at = NOW() WHERE id = ${id}`,
        sql`UPDATE seller_balances SET balance_reserved_brl = balance_reserved_brl - ${amountBRL}, total_withdrawn_brl = COALESCE(total_withdrawn_brl,0) + ${amountBRL}, updated_at = NOW() WHERE seller_id = ${wd.seller_id}`
      ]);
    }, `approveCrypto:${id}`);

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/withdrawals/admin/crypto-withdrawals/:id/reject
 */
router.post('/admin/crypto-withdrawals/:id/reject', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const isAdmin = authUser?.isAdmin || process.env.ADMIN_EMAIL && authUser?.email === process.env.ADMIN_EMAIL;
    if (!isAdmin) return res.status(403).json({ error: 'Acesso negado' });
    const { id } = req.params;
    const { reason } = req.body;

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM crypto_withdrawals WHERE id = ${id} LIMIT 1`;
      if (!rows[0]) throw new Error('NOT_FOUND');
      const wd = rows[0];
      if (wd.status !== 'pending') throw new Error('ALREADY_PROCESSED');
      const amountBRL = Number(wd.amount_brl || 0);

      await Promise.all([
        sql`UPDATE crypto_withdrawals SET status = 'rejected', rejected_at = NOW(), rejected_by = ${authUser?.uid || 'admin'}, rejection_reason = ${reason || ''}, updated_at = NOW() WHERE id = ${id}`,
        sql`UPDATE seller_balances SET balance_available_brl = balance_available_brl + ${amountBRL}, balance_reserved_brl = balance_reserved_brl - ${amountBRL}, updated_at = NOW() WHERE seller_id = ${wd.seller_id}`
      ]);
    }, `rejectCrypto:${id}`);

    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Saque não encontrado' });
    if (err.message === 'ALREADY_PROCESSED') return res.status(400).json({ error: 'Saque já processado' });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/withdrawals/fee
 */
router.get('/fee', verifyFirebaseToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const feeFixed = await getSellerFeeFixed(user.uid);
    const globalFixed = await getWithdrawalFeeFixed();
    return res.json({ feeFixed, isCustom: feeFixed !== globalFixed });
  } catch {
    return res.status(500).json({ error: 'Erro ao buscar taxa de saque' });
  }
});

/**
 * GET /api/withdrawals/admin/fee
 */
router.get('/admin/fee', verifyFirebaseToken, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const feeFixed = await getWithdrawalFeeFixed();
    return res.json({ feeFixed });
  } catch {
    return res.status(500).json({ error: 'Erro ao buscar taxa de saque' });
  }
});

/**
 * PUT /api/withdrawals/admin/fee
 */
router.put('/admin/fee', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { feeFixed } = req.body;
    if (typeof feeFixed !== 'number' || feeFixed < 0) return res.status(400).json({ error: 'feeFixed deve ser um número >= 0' });
    const rtdb = getRTDB();
    if (!rtdb) return res.status(500).json({ error: 'RTDB não disponível' });
    await rtdb.ref('config/withdrawalFeeFixed').set(feeFixed);
    // Limpar taxas individuais no Neon
    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET custom_withdrawal_fee_fixed = NULL WHERE custom_withdrawal_fee_fixed IS NOT NULL`;
    }, 'clearCustomFees');
    return res.json({ success: true, feeFixed });
  } catch {
    return res.status(500).json({ error: 'Erro ao salvar taxa de saque' });
  }
});

/**
 * GET /api/withdrawals/admin/fee/:sellerId
 */
router.get('/admin/fee/:sellerId', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;
    let customFeeFixed: number | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT custom_withdrawal_fee_fixed FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      customFeeFixed = rows[0]?.custom_withdrawal_fee_fixed ?? null;
    }, `adminSellerFee:${sellerId}`);
    const globalFixed = await getWithdrawalFeeFixed();
    return res.json({ customFeeFixed, globalFeeFixed: globalFixed, effectiveFeeFixed: customFeeFixed ?? globalFixed, isCustom: customFeeFixed !== null });
  } catch {
    return res.status(500).json({ error: 'Erro ao buscar taxa do seller' });
  }
});

/**
 * PUT /api/withdrawals/admin/fee/:sellerId
 */
router.put('/admin/fee/:sellerId', verifyFirebaseToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;
    const { feeFixed } = req.body;
    await neonQuery(async (sql) => {
      if (feeFixed === null || feeFixed === undefined) {
        await sql`UPDATE sellers SET custom_withdrawal_fee_fixed = NULL WHERE id = ${sellerId}`;
      } else {
        if (typeof feeFixed !== 'number' || feeFixed < 0) throw new Error('INVALID_FEE');
        await sql`UPDATE sellers SET custom_withdrawal_fee_fixed = ${feeFixed} WHERE id = ${sellerId}`;
      }
    }, `setSellerFee:${sellerId}`);
    return res.json({ success: true, feeFixed: feeFixed ?? null });
  } catch (err: any) {
    if (err.message === 'INVALID_FEE') return res.status(400).json({ error: 'feeFixed deve ser um número >= 0' });
    return res.status(500).json({ error: 'Erro ao salvar taxa do seller' });
  }
});

export default router;
