/**
 * VolatusPay — Device Trust Routes
 * Vincula chave pública ECDSA P-256 à sessão — detecta roubo de cookie.
 */

import { Router, type Request, type Response } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import {
  registerDevice,
  issueDeviceChallenge,
  verifyDeviceSignature,
  isDeviceBound,
  getDeviceTrustLevel,
  getDeviceStats,
} from "../security/device-trust.js";

const router = Router();

function extractSessionId(req: Request): string | null {
  return (req as any).cookies?.["fm_session"] ?? null;
}

function extractClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string ?? req.socket?.remoteAddress ?? "unknown")
    .split(",")[0].trim();
}

/** POST /api/device/register */
router.post("/api/device/register", (req: Request, res: Response) => {
  const sessionId = extractSessionId(req);
  if (!sessionId) {
    res.status(401).json({ error: "Sessão não encontrada — faça login primeiro" });
    return;
  }

  const { publicKeyJwk, fingerprint } = req.body as {
    publicKeyJwk?: Record<string, string>;
    fingerprint?: string;
  };

  if (!publicKeyJwk || typeof publicKeyJwk !== "object") {
    res.status(400).json({ error: "publicKeyJwk obrigatório (formato JWK ECDSA P-256)" });
    return;
  }

  if (publicKeyJwk["kty"] !== "EC" || publicKeyJwk["crv"] !== "P-256") {
    res.status(400).json({ error: "Somente ECDSA P-256 suportado (kty:'EC', crv:'P-256')" });
    return;
  }

  const ip = (req as any).clientIp ?? extractClientIp(req);
  try {
    const { deviceId, isNew } = registerDevice(sessionId, ip, publicKeyJwk, fingerprint);
    res.json({
      ok:      true,
      deviceId,
      isNew,
      message: isNew
        ? "Dispositivo registrado — sessão vinculada criptograficamente"
        : "Dispositivo já registrado para esta sessão",
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** POST /api/device/challenge */
router.post("/api/device/challenge", (req: Request, res: Response) => {
  const sessionId = extractSessionId(req);
  if (!sessionId) { res.status(401).json({ error: "Sessão não encontrada" }); return; }

  const challenge = issueDeviceChallenge(sessionId);
  if (!challenge) {
    res.status(404).json({ error: "Dispositivo não registrado para esta sessão", hint: "Chame POST /api/device/register primeiro" });
    return;
  }

  res.json({
    challengeId: challenge.challengeId,
    nonce:       challenge.nonce,
    sessionId:   challenge.sessionId,
    expiresAt:   challenge.expiresAt,
    signPayload: `${challenge.nonce}|${challenge.sessionId}|{timestamp_ms}`,
    algorithm:   "ECDSA",
    hash:        "SHA-256",
  });
});

/** POST /api/device/verify */
router.post("/api/device/verify", (req: Request, res: Response) => {
  const sessionId = extractSessionId(req);
  if (!sessionId) { res.status(401).json({ error: "Sessão não encontrada" }); return; }

  const { challengeId, signature, timestamp } = req.body as {
    challengeId?: string; signature?: string; timestamp?: number;
  };

  if (!challengeId || !signature || !timestamp) {
    res.status(400).json({ error: "challengeId, signature (hex) e timestamp obrigatórios" });
    return;
  }

  const ip     = (req as any).clientIp ?? extractClientIp(req);
  const result = verifyDeviceSignature(sessionId, challengeId, signature, timestamp, ip);

  if (!result.valid) {
    res.status(401).json({
      valid:   false,
      reason:  result.reason,
      message: result.reason === "invalid_signature"
        ? "⚠️  Assinatura inválida — este dispositivo não é o dono da sessão"
        : `Verificação falhou: ${result.reason}`,
    });
    return;
  }

  res.json({
    valid:         true,
    deviceId:      result.deviceId,
    trusted:       result.trusted,
    verifications: result.verifications,
    scoreDelta:    result.scoreDelta,
    message:       result.trusted
      ? `✓ Dispositivo TRUSTED (${result.verifications} verificações)`
      : `✓ Assinatura válida (${result.verifications}/5 para trust)`,
  });
});

/** GET /api/device/status */
router.get("/api/device/status", (req: Request, res: Response) => {
  const sessionId = extractSessionId(req);
  if (!sessionId) {
    res.json({ bound: false, trust: "none", message: "Sem sessão ativa" });
    return;
  }

  const bound = isDeviceBound(sessionId);
  const trust = getDeviceTrustLevel(sessionId);
  res.json({
    bound,
    trust,
    message: !bound
      ? "Sessão sem dispositivo vinculado — suscetível a roubo de cookie"
      : trust === "trusted"
      ? "✓ Dispositivo trusted — sessão protegida criptograficamente (30 dias)"
      : "✓ Dispositivo registrado — acumulando verificações para trust completo",
  });
});

/** GET /api/device/stats (admin) */
router.get(
  "/api/device/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    res.json({ device: getDeviceStats(), generatedAt: new Date().toISOString() });
  }
);

/** GET /api/device/health */
router.get("/api/device/health", (_req: Request, res: Response) => {
  res.json({ ok: true, module: "device-trust", stats: getDeviceStats() });
});

export default router;
