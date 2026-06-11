/**
 * 🏦 ONZ FINANCE - Rotas de Admin e Webhook
 * Gerenciamento da integração ONZ Finance (Cash-in / Cash-out)
 */

import express from 'express';
import { requireAdmin as requireFirebaseAdmin } from '../security/firebase-auth.js';
import {
  saveOnzCertsToRTDB,
  saveOnzCredentialsToRTDB,
  loadOnzCredentials,
  loadOnzCerts,
  checkOnzStatus,
  clearOnzTokenCache,
  createOnzPixCharge,
  getOnzPixCharge,
  sendOnzPixCashOut,
  getOnzBalance,
  parseOnzWebhook,
  type OnzCredentials,
} from '../lib/onz-finance-api.js';
import { getRTDB } from '../lib/firebase-admin.js';
import { sendOrderStatusUpdate } from '../lib/utmify-service.js';
import { dispatchPurchaseEventToPixels } from '../lib/facebook-capi.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// ── Middleware: apenas admin ──────────────────────────────────────────────

const requireAdmin = requireFirebaseAdmin;

// ── GET /api/admin/onz/status ─────────────────────────────────────────────

router.get('/api/admin/onz/status', requireAdmin, async (req: any, res: any) => {
  try {
    const status = await checkOnzStatus();
    res.json({ ok: true, status });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/admin/onz/balance ─────────────────────────────────────────────

router.get('/api/admin/onz/balance', requireAdmin, async (req: any, res: any) => {
  try {
    const balance = await getOnzBalance();
    res.json({ ok: true, balance });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/admin/onz/credentials ──────────────────────────────────────

router.post('/api/admin/onz/credentials', requireAdmin, async (req: any, res: any) => {
  try {
    const { cashInClientId, cashInClientSecret, cashOutClientId, cashOutClientSecret, pixKey, environment, enabled } = req.body;

    if (!cashInClientId || !cashInClientSecret || !cashOutClientId || !cashOutClientSecret) {
      return res.status(400).json({ error: 'Credenciais incompletas' });
    }

    const creds: OnzCredentials = {
      cashInClientId:     cashInClientId.trim(),
      cashInClientSecret: cashInClientSecret.trim(),
      cashOutClientId:    cashOutClientId.trim(),
      cashOutClientSecret:cashOutClientSecret.trim(),
      pixKey:             (pixKey || '').trim(),
      environment:        environment || 'production',
      enabled:            enabled !== false,
    };

    await saveOnzCredentialsToRTDB(creds);
    clearOnzTokenCache();

    res.json({ ok: true, message: 'Credenciais ONZ Finance salvas eternamente no RTDB' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/admin/onz/upload-certs ─────────────────────────────────────
// Endpoint para reenviar certificados se necessário

router.post('/api/admin/onz/upload-certs', requireAdmin, express.json({ limit: '2mb' }), async (req: any, res: any) => {
  try {
    const { qrcodesCertB64, qrcodesKeyB64, accountsCertB64, accountsKeyB64 } = req.body;

    if (!qrcodesCertB64 || !qrcodesKeyB64 || !accountsCertB64 || !accountsKeyB64) {
      return res.status(400).json({ error: 'Todos os 4 arquivos são obrigatórios (base64)' });
    }

    const qrcodesCert  = Buffer.from(qrcodesCertB64, 'base64');
    const qrcodesKey   = Buffer.from(qrcodesKeyB64,  'base64');
    const accountsCert = Buffer.from(accountsCertB64, 'base64');
    const accountsKey  = Buffer.from(accountsKeyB64,  'base64');

    await saveOnzCertsToRTDB(qrcodesCert, qrcodesKey, accountsCert, accountsKey);
    clearOnzTokenCache();

    res.json({ ok: true, message: 'Certificados ONZ Finance salvos eternamente no RTDB' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/admin/onz/test-cashin ──────────────────────────────────────

router.post('/api/admin/onz/test-cashin', requireAdmin, async (req: any, res: any) => {
  try {
    const orderId = `TEST-${Date.now()}`;
    const charge = await createOnzPixCharge({
      orderId,
      amountBRL:   1, // R$ 0.01 de teste
      descricao:   'Teste de integração ONZ Finance Cash-in',
      expiracaoSegundos: 300,
    });
    res.json({ ok: true, charge });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/admin/onz/test-balance ─────────────────────────────────────

router.post('/api/admin/onz/test-balance', requireAdmin, async (req: any, res: any) => {
  try {
    const balance = await getOnzBalance();
    res.json({ ok: true, balance });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/admin/onz/charge/:txid ──────────────────────────────────────

router.get('/api/admin/onz/charge/:txid', requireAdmin, async (req: any, res: any) => {
  try {
    const charge = await getOnzPixCharge(req.params.txid);
    res.json({ ok: true, charge });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/admin/onz/credentials-get ───────────────────────────────────
// Retorna credenciais completas (somente admin)

router.get('/api/admin/onz/credentials-get', requireAdmin, async (req: any, res: any) => {
  try {
    const creds = await loadOnzCredentials();
    if (!creds) return res.json({ ok: false, error: 'Credenciais não configuradas' });

    // Mascarar secrets antes de retornar ao cliente
    res.json({
      ok: true,
      credentials: {
        cashInClientId:     creds.cashInClientId,
        cashInClientSecret: creds.cashInClientSecret ? `${creds.cashInClientSecret.slice(0,8)}...` : '',
        cashOutClientId:    creds.cashOutClientId,
        cashOutClientSecret:creds.cashOutClientSecret ? `${creds.cashOutClientSecret.slice(0,8)}...` : '',
        pixKey:             creds.pixKey,
        environment:        creds.environment,
        enabled:            creds.enabled,
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/admin/onz/reset-cache ─────────────────────────────────────

router.post('/api/admin/onz/reset-cache', requireAdmin, async (_req: any, res: any) => {
  clearOnzTokenCache();
  res.json({ ok: true, message: 'Cache ONZ Finance limpo' });
});

// ── POST /api/webhooks/onz-pix ───────────────────────────────────────────
// Webhook de notificação de PIX recebido (Cash-in)

router.post(['/api/webhooks/onz-pix', '/webhooks/onz-pix'], express.json(), async (req: any, res: any) => {
  try {
    const body = req.body;
    const webhook = parseOnzWebhook(body);

    if (!webhook.pix || webhook.pix.length === 0) {
      return res.status(200).json({ ok: true });
    }

    const rtdb = getRTDB();
    const db = (req as any).db; // injetado no index.ts se disponível

    for (const pix of webhook.pix) {
      const { txid, endToEndId, valor, pagador, horario } = pix;

      console.log(`💸 [ONZ Webhook] PIX recebido: txid=${txid} valor=R$${valor} e2e=${endToEndId}`);

      // Salvar no RTDB para auditoria
      if (rtdb) {
        await rtdb.ref(`${`tetri-system`}/onz-finance/webhooks/pix/${endToEndId}`).set({
          txid, endToEndId, valor, pagador, horario,
          receivedAt: new Date().toISOString(),
        });
      }

      // Se tiver txid, tenta marcar pedido como pago
      if (txid) {
        try {
          const { getFirestore } = await import('../lib/firebase-admin.js');
          const _onzDb = getFirestore();
          // Buscar pedido pelo txid armazenado
          const ordersSnap = await _onzDb.collection('orders')
            .where('onzTxid', '==', txid)
            .limit(1)
            .get();

          if (!ordersSnap.empty) {
            const orderDoc = ordersSnap.docs[0];
            const _onzOrderData = orderDoc.data();
            if (_onzOrderData?.status === 'paid') {
              console.log(`[ONZ Webhook] Pedido ${orderDoc.id} já pago — ignorando`);
            } else {
              await orderDoc.ref.update({
                status:           'paid',
                paidAt:           new Date().toISOString(),
                txid:             txid,
                gateway:          'onz',
                onzEndToEndId:    endToEndId,
                paymentGateway:   'onz',
                paymentMethod:    'pix',
              });
              console.log(`✅ [ONZ Webhook] Pedido ${orderDoc.id} marcado como pago`);
              const _onzTenantId = _onzOrderData?.tenantId || _onzOrderData?.sellerId;
              if (_onzTenantId) {
                const { syncOrderAfterUpdate: _onzSync } = await import('../lib/orders-sync.js');
                _onzSync(_onzTenantId, orderDoc.id, { status: 'paid', paidAt: new Date().toISOString(), gateway: 'onz' });

                // 💰 CREDITAR SALDO DO SELLER (atômico + deduplicado)
                try {
                  const { calculateDynamicFees } = await import('../index.js');
                  const _onzFee = await calculateDynamicFees(_onzOrderData.amount, 'pix', 1, 'onz', _onzTenantId);
                  const { processWebhookWithBalanceUpdate } = await import('../lib/atomic-balance.js');
                  const _onzBal = await processWebhookWithBalanceUpdate({
                    webhookId: `onz_${endToEndId}_${orderDoc.id}`,
                    provider: 'onz',
                    eventType: 'pix.paid',
                    sellerId: _onzTenantId,
                    amountCents: _onzFee.netAmount,
                    currency: 'BRL',
                    operation: 'add',
                    balanceType: 'available',
                    reason: `Pagamento PIX ONZ - Ordem ${orderDoc.id}`,
                    orderId: orderDoc.id,
                    metadata: {
                      method: 'pix',
                      acquirer: 'onz',
                      totalAmount: _onzOrderData.amount,
                      platformFee: _onzFee.platformFee,
                      gatewayFee: _onzFee.gatewayFee,
                    },
                  });
                  if (_onzBal.processed) {
                    console.log(`💰 [ONZ Webhook] Saldo creditado: +R$ ${(_onzFee.netAmount / 100).toFixed(2)}`);
                  } else {
                    console.log(`⚠️ [ONZ Webhook] Saldo já processado: ${_onzBal.reason}`);
                  }
                } catch (balErr: any) {
                  console.warn(`⚠️ [ONZ Webhook] Erro ao creditar saldo:`, balErr.message);
                }

                // 📊 UTMIFY
                sendOrderStatusUpdate(_onzTenantId, orderDoc.id, 'paid', { paidAt: new Date() })
                  .catch((err: any) => console.warn('[UTMify] ONZ paid update failed:', err?.message));
                // 🎯 FACEBOOK CAPI
                if (_onzOrderData?.checkoutId) {
                  dispatchPurchaseEventToPixels(_onzOrderData.checkoutId, {
                    id: orderDoc.id,
                    tenantId: _onzTenantId,
                    customerEmail: _onzOrderData.customerEmail,
                    customerName: _onzOrderData.customerName,
                    customerPhone: _onzOrderData.customerPhone,
                    amount: _onzOrderData.amount,
                    currency: _onzOrderData.currency || 'BRL',
                    productName: _onzOrderData.productName || _onzOrderData.checkoutTitle,
                    method: 'pix',
                  }).catch((err: any) => console.warn('[CAPI] ONZ purchase dispatch failed:', err?.message));
                }

                // 💸 COMISSÃO DE AFILIADO
                if (_onzOrderData?.affiliateCode || _onzOrderData?.affiliateUid) {
                  try {
                    const { storage: _st } = await import('../storage.js');
                    await (_st as any).processAffiliateCommission({ ..._onzOrderData, id: orderDoc.id });
                    console.log(`✅ [ONZ Webhook] Comissão de afiliado creditada para ordem ${orderDoc.id}`);
                  } catch (affErr: any) {
                    console.warn('⚠️ [ONZ Webhook] Erro comissão afiliado:', affErr?.message);
                  }
                }
              }
            }
          }
        } catch (err: any) {
          console.warn(`⚠️ [ONZ Webhook] Erro ao atualizar pedido: ${err.message}`);
        }
      }
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('❌ [ONZ Webhook] Erro:', err.message);
    res.status(200).json({ ok: true }); // sempre 200 para não re-tentar
  }
});

// ── POST /api/admin/onz/cashout ───────────────────────────────────────────
// Sacar/Transferir via PIX (uso interno para saques de vendedores)

router.post('/api/admin/onz/cashout', requireAdmin, async (req: any, res: any) => {
  try {
    const { pixKey, amountBRL, description, qrCode } = req.body;

    if (!amountBRL || amountBRL <= 0) {
      return res.status(400).json({ error: 'Valor inválido' });
    }

    if (!pixKey && !qrCode) {
      return res.status(400).json({ error: 'Informe pixKey ou qrCode' });
    }

    const idempotencyKey = crypto.randomBytes(20).toString('hex');

    const result = await sendOnzPixCashOut({
      pixKey,
      qrCode,
      amountBRL,
      idempotencyKey,
      description: description || 'Saque VolatusPay',
    });

    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Compat: /api/admin/onz-finance-credentials (GET) ─────────────────────
// Frontend usa /api/admin/onz-finance-credentials; mapeia para /api/admin/onz/credentials-get
// e inclui os campos de taxa salvos em RTDB separadamente.
router.get('/api/admin/onz-finance-credentials', requireAdmin, async (_req: any, res: any) => {
  try {
    const creds = await loadOnzCredentials();
    const rtdb = getRTDB();
    const feesSnap = await rtdb.ref(`${RTDB_PATH}/fees`).once('value');
    const fees = feesSnap.exists() ? feesSnap.val() : {};

    if (!creds) {
      return res.json({ success: true, credentials: null });
    }

    res.json({
      success: true,
      credentials: {
        clientIdCashIn:     creds.cashInClientId,
        clientSecretCashIn: creds.cashInClientSecret ? `${creds.cashInClientSecret.slice(0, 8)}...` : '',
        clientIdCashOut:    creds.cashOutClientId,
        clientSecretCashOut:creds.cashOutClientSecret ? `${creds.cashOutClientSecret.slice(0, 8)}...` : '',
        pixKey:             creds.pixKey,
        environment:        creds.environment,
        enabled:            creds.enabled,
        pixFeeFixed:        fees.pixFeeFixed   ?? 0,
        pixFeePercent:      fees.pixFeePercent  ?? 1.5,
        pixWithdrawalDays:  fees.pixWithdrawalDays ?? 1,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Compat: /api/admin/onz-finance-credentials (POST) ────────────────────
// Mapeia campos frontend (clientIdCashIn, etc.) → OnzCredentials (cashInClientId, etc.)
// e salva taxas em RTDB tetri-system/onz-finance/fees
router.post('/api/admin/onz-finance-credentials', requireAdmin, async (req: any, res: any) => {
  try {
    const {
      clientIdCashIn, clientSecretCashIn,
      clientIdCashOut, clientSecretCashOut,
      pixKey, environment, enabled,
      pixFeeFixed, pixFeePercent, pixWithdrawalDays,
    } = req.body;

    if (!clientIdCashIn?.trim() || !clientSecretCashIn?.trim() ||
        !clientIdCashOut?.trim()  || !clientSecretCashOut?.trim()) {
      return res.status(400).json({ success: false, message: 'Credenciais incompletas (clientId e clientSecret Cash-in e Cash-out obrigatórios)' });
    }

    const creds: OnzCredentials = {
      cashInClientId:      clientIdCashIn.trim(),
      cashInClientSecret:  clientSecretCashIn.trim(),
      cashOutClientId:     clientIdCashOut.trim(),
      cashOutClientSecret: clientSecretCashOut.trim(),
      pixKey:              (pixKey || '').trim(),
      environment:         environment || 'production',
      enabled:             enabled !== false,
    };

    await saveOnzCredentialsToRTDB(creds);

    // Salvar taxas separadamente no mesmo RTDB path
    const rtdb = getRTDB();
    await rtdb.ref(`${RTDB_PATH}/fees`).set({
      pixFeeFixed:       Number(pixFeeFixed   ?? 0),
      pixFeePercent:     Number(pixFeePercent  ?? 1.5),
      pixWithdrawalDays: Number(pixWithdrawalDays ?? 1),
      savedAt:           new Date().toISOString(),
    });

    clearOnzTokenCache();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
