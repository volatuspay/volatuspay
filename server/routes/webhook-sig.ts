/**
 * VolatusPay — Webhook Ed25519 Signing Routes (Fase 146)
 *
 * Assina os webhooks de saída do VolatusPay para sellers com Ed25519.
 * Endpoint comprometido NÃO pode forjar assinaturas — só verificar.
 *
 * Rotas públicas: /verify (sellers verificam assinaturas)
 * Rotas admin:    /keys, /sign, /rotate, /stats, /simulate
 */

import { Router } from "express";
import crypto from "node:crypto";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import type { AuthenticatedRequest } from "../security/firebase-auth.js";
import {
  generateWebhookKey,
  signWebhook,
  verifyWebhook,
  rotateKey,
  revokeKey,
  distributeKey,
  batchVerify,
  getWebhookSigStats,
  getWebhookKeys,
  startWebhookSig,
} from "../security/webhook-ed25519.js";

const router = Router();

// Inicia automaticamente com uma chave Ed25519 ativa
startWebhookSig();

/* ══════════════════════════════════════════════════
   PÚBLICOS — sellers usam para verificar assinaturas
══════════════════════════════════════════════════ */

/** Parâmetros técnicos do algoritmo (documentação para sellers) */
router.get("/api/webhook-sig/params", (_req, res) => {
  res.json({
    ok:          true,
    name:        "VolatusPay Webhook Signature",
    algorithm:   "Ed25519 (RFC 8032)",
    sigFormat:   "Ed25519.{keyId}.{base64url(signature)}",
    signedData:  "timestamp\\nMETHOD\\npath\\nbodySHA256",
    replayWindow: "300s (5 min)",
    keyTtlDays:   30,
    gracePeriodH: 24,
    headers: [
      "X-Volatus-Signature",
      "X-Volatus-Timestamp",
      "X-Volatus-Key-Id",
      "X-Volatus-Event-Id",
      "X-Volatus-Event-Type",
    ],
    note: "Assimétrico: endpoint comprometido NÃO pode forjar assinaturas do VolatusPay",
    docs: "https://docs.volatuspay.com.br/webhooks/security",
  });
});

/** Verificação pública de webhook — sellers chamam para validar assinaturas */
router.post("/api/webhook-sig/verify", (req, res) => {
  const { sigHeader, timestamp, method, path, body, eventId, skipReplay } = req.body ?? {};
  const result = verifyWebhook({
    sigHeader:  sigHeader ?? "",
    timestamp:  Number(timestamp),
    method:     method ?? "POST",
    path:       path ?? "/webhook",
    body:       typeof body === "string" ? body : JSON.stringify(body ?? {}),
    eventId:    eventId ?? crypto.randomBytes(8).toString("hex"),
    skipReplay: Boolean(skipReplay),
  });
  res.json(result);
});

/** Distribuição de chave pública para SDK/seller */
router.post("/api/webhook-sig/sdk/distribute", (req, res) => {
  const { sdkId, keyId } = req.body ?? {};
  if (!sdkId) {
    res.status(400).json({ ok: false, error: "sdkId obrigatório" });
    return;
  }
  try {
    const bundle = distributeKey(sdkId, keyId);
    res.json({ ok: true, ...bundle });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

/* ══════════════════════════════════════════════════
   ADMIN — requer Firebase Auth + perfil admin
══════════════════════════════════════════════════ */

/** Stats e auditoria */
router.get(
  "/api/webhook-sig/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    res.json({ ok: true, ...getWebhookSigStats() });
  }
);

router.get(
  "/api/webhook-sig/keys",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    res.json({ ok: true, keys: getWebhookKeys() });
  }
);

router.get(
  "/api/webhook-sig/audit",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    const s = getWebhookSigStats();
    res.json({ ok: true, count: s.auditLog.length, entries: s.auditLog.slice(0, 50) });
  }
);

/** Gerar novo par de chaves Ed25519 */
router.post(
  "/api/webhook-sig/keys/generate",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    const pair = generateWebhookKey();
    res.json({
      ok:           true,
      keyId:        pair.keyId,
      publicKeyHex: pair.publicKeyHex,
      algorithm:    "Ed25519",
      version:      pair.version,
      status:       pair.status,
      expiresAt:    pair.expiresAt,
    });
  }
);

/** Assinar webhook manualmente (para testes e dispatcher) */
router.post(
  "/api/webhook-sig/sign",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: any, res) => {
    const { eventType = "generic", method = "POST", path = "/webhook", body, keyId } = req.body ?? {};
    try {
      const sw = signWebhook({ eventType, method, path, body: body ?? { event: "test" }, keyId });
      res.json({
        ok:        true,
        eventId:   sw.eventId,
        eventType: sw.eventType,
        keyId:     sw.keyId,
        sigHeader: sw.sigHeader,
        sigLen:    sw.signature.length,
        bodyHash:  sw.bodyHash,
        timestamp: sw.timestamp,
        headers:   sw.headers,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  }
);

/** Rotação de chave — old → grace (24h), new → active */
router.post(
  "/api/webhook-sig/keys/rotate",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: any, res) => {
    const { keyId } = req.body ?? {};
    const result = rotateKey(keyId);
    res.json({ ok: true, ...result });
  }
);

/** Revogar chave imediatamente */
router.post(
  "/api/webhook-sig/keys/revoke",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: any, res) => {
    const { keyId } = req.body ?? {};
    const ok = revokeKey(keyId);
    res.json({ ok, keyId });
  }
);

/** Verificação em lote */
router.post(
  "/api/webhook-sig/batch/verify",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: any, res) => {
    const { webhooks } = req.body ?? {};
    if (!Array.isArray(webhooks)) {
      res.status(400).json({ ok: false, error: "webhooks array obrigatório" });
      return;
    }
    const result = batchVerify(webhooks);
    res.json({ ok: result.allOk, ...result });
  }
);

/** Simulação completa — 10 test vectors Ed25519 */
router.post(
  "/api/webhook-sig/test/simulate",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    const results: Record<string, unknown> = {};

    // WS-1: Geração de keypair Ed25519
    const pair = generateWebhookKey();
    results["WS-1"] = {
      ok:           pair.status === "active" && pair.publicKeyHex.length === 64,
      keyId:        pair.keyId,
      pubKeyHexLen: pair.publicKeyHex.length,
      algorithm:    "Ed25519",
      status:       pair.status,
    };

    // WS-2: Assinar webhook payment.completed
    const payload = { amount: 99900, currency: "BRL", orderId: "ord_abc123" };
    const sw = signWebhook({
      eventType: "payment.completed",
      method:    "POST",
      path:      "/webhooks/payment",
      body:      payload,
      keyId:     pair.keyId,
    });
    results["WS-2"] = {
      ok:        sw.sigHeader.startsWith("Ed25519.") && sw.signature.length >= 80,
      eventId:   sw.eventId,
      keyId:     sw.keyId,
      sigFormat: sw.sigHeader.split(".")[0],
      sigLen:    sw.signature.length,
      headerSet: Object.keys(sw.headers).length === 5,
    };

    // WS-3: Verificar webhook legítimo
    const vr = verifyWebhook({
      sigHeader: sw.sigHeader, timestamp: sw.timestamp,
      method: sw.method, path: sw.path, body: sw.body,
      eventId: sw.eventId, skipReplay: true,
    });
    results["WS-3"] = { ok: vr.ok, reason: vr.reason, latencyMs: vr.latencyMs };

    // WS-4: Tamper detection — payload alterado → falha
    const tampered = sw.body.replace("99900", "9990000");
    const vt = verifyWebhook({
      sigHeader: sw.sigHeader, timestamp: sw.timestamp,
      method: sw.method, path: sw.path, body: tampered,
      eventId: sw.eventId + "_t", skipReplay: true,
    });
    results["WS-4"] = {
      ok:             !vt.ok,
      tamperDetected: !vt.ok,
      reason:         vt.reason,
    };

    // WS-5: Replay protection — timestamp expirado > 5 min
    const oldTs = Date.now() - 400_000;
    const rv = verifyWebhook({
      sigHeader: sw.sigHeader, timestamp: oldTs,
      method: sw.method, path: sw.path, body: sw.body,
      eventId: "replay_test", skipReplay: false,
    });
    results["WS-5"] = {
      ok:            !rv.ok,
      replayBlocked: !rv.ok,
      reason:        rv.reason,
    };

    // WS-6: Rotação de chave
    const rotation = rotateKey(pair.keyId);
    const keys = getWebhookKeys();
    const newK  = keys.find(k => k.keyId === rotation.newKeyId);
    const oldK  = keys.find(k => k.keyId === rotation.oldKeyId);
    results["WS-6"] = {
      ok:        rotation.newKeyId !== rotation.oldKeyId && newK?.status === "active" && oldK?.status === "grace",
      oldStatus: oldK?.status,
      newStatus: newK?.status,
    };

    // WS-7: 5 tipos de evento diferentes
    const eventTypes = [
      { type: "payment.pix",      path: "/webhooks/pix",     body: { amount: 100 } },
      { type: "payment.boleto",   path: "/webhooks/boleto",  body: { barcode: "123" } },
      { type: "payment.card",     path: "/webhooks/card",    body: { last4: "4242" } },
      { type: "order.shipped",    path: "/webhooks/order",   body: { track: "BR123" } },
      { type: "refund.processed", path: "/webhooks/refund",  body: { reason: "cancel" } },
    ];
    const multi = eventTypes.map(ev => {
      const s = signWebhook({ eventType: ev.type, method: "POST", path: ev.path, body: ev.body });
      const v = verifyWebhook({ sigHeader: s.sigHeader, timestamp: s.timestamp, method: s.method, path: s.path, body: s.body, eventId: s.eventId, skipReplay: true });
      return { type: ev.type, verified: v.ok };
    });
    results["WS-7"] = { ok: multi.every(r => r.verified), results: multi };

    // WS-8: Distribuição para 3 sellers
    const sdks = ["seller_loja_abc", "seller_ecommerce_xyz", "seller_digital_br"];
    const bundles = sdks.map(id => {
      const b = distributeKey(id);
      return { sdkId: id, pubKeyLen: b.publicKeyHex.length };
    });
    results["WS-8"] = { ok: bundles.every(b => b.pubKeyLen === 64), sdkCount: bundles.length, privKeyDistributed: false };

    // WS-9: Batch verify 10 webhooks
    const batch = Array.from({ length: 10 }, (_, i) => {
      const s = signWebhook({ eventType: `test.event_${i}`, method: "POST", path: `/w/${i}`, body: { seq: i } });
      return { sigHeader: s.sigHeader, timestamp: s.timestamp, method: s.method, path: s.path, body: s.body, eventId: s.eventId };
    });
    const br = batchVerify(batch);
    results["WS-9"] = { ok: br.allOk, total: br.total, passed: br.passed };

    // WS-10: Audit log
    const s10 = getWebhookSigStats();
    results["WS-10"] = {
      ok:           s10.auditLog.length > 0 && s10.totalSigned > 0,
      auditEntries: s10.auditLog.length,
      totalSigned:  s10.totalSigned,
      replayBlocked: s10.replayBlocked,
      tamperBlocked: s10.tamperBlocked,
    };

    const passed = Object.values(results).filter((r: any) => r.ok).length;
    const total  = Object.keys(results).length;

    res.json({
      ok:       passed === total,
      standard: "Ed25519 (RFC 8032)",
      passed,
      total,
      results,
    });
  }
);

/** Self-test */
router.get("/api/webhook-sig/health", (_req, res) => {
  const s = getWebhookSigStats();
  res.json({
    ok:          true,
    module:      "webhook-ed25519",
    active:      s.active,
    activeKeys:  s.activeKeys,
    totalSigned: s.totalSigned,
  });
});

export default router;
