/**
 * VolatusPay — Biometric Routes (Biometria Comportamental Contínua)
 * Monitora mouse, teclado, scroll e toque para detectar bots e account takeover.
 */

import { Router, type Request, type Response } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import {
  registerSession,
  reportBehavior,
  getSessionBiometric,
  getBiometricStats,
  getBiometricSnippet,
  type BehaviorVector,
} from "../security/biometric.js";

const router = Router();

/** POST /api/biometric/session — inicializa sessão (chamado no login) */
router.post("/api/biometric/session", (req: Request, res: Response) => {
  const { sessionId, credentialId } = (req.body ?? {}) as { sessionId?: string; credentialId?: string };
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 128) {
    res.status(400).json({ error: "sessionId obrigatório (max 128 chars)" });
    return;
  }
  registerSession(sessionId, credentialId);
  res.json({
    ok:         true,
    sessionId,
    message:    "Monitoramento comportamental iniciado",
    phase:      "baseline",
    interval:   10000,
    endpoint:   "/api/biometric/report",
    snippetUrl: `/api/biometric/snippet?sid=${encodeURIComponent(sessionId)}`,
  });
});

/** POST /api/biometric/report — browser envia vetor (fire-and-forget) */
router.post("/api/biometric/report", (req: Request, res: Response) => {
  const vec = req.body as BehaviorVector;
  if (!vec?.sessionId) {
    res.status(400).json({ error: "sessionId obrigatório no vetor" });
    return;
  }

  const sanitize = (n: unknown, min: number, max: number): number => {
    const v = Number(n);
    if (!isFinite(v) || isNaN(v)) return NaN;
    return Math.min(max, Math.max(min, v));
  };

  const cleaned: BehaviorVector = {
    sessionId:        vec.sessionId.slice(0, 128),
    mouseSpeedAvg:    sanitize(vec.mouseSpeedAvg,    0, 50),
    mouseAccelAvg:    sanitize(vec.mouseAccelAvg,    0, 10),
    mouseJitter:      sanitize(vec.mouseJitter,      0, 20),
    clickRate:        sanitize(vec.clickRate,         0, 300),
    scrollSpeedAvg:   sanitize(vec.scrollSpeedAvg,   0, 200),
    scrollSmoothness: sanitize(vec.scrollSmoothness,  0, 1),
    keyDwellAvg:      sanitize(vec.keyDwellAvg,       10, 500),
    keyFlightAvg:     sanitize(vec.keyFlightAvg,      10, 1000),
    typingRhythm:     sanitize(vec.typingRhythm,      0, 5),
    touchPressureAvg: sanitize(vec.touchPressureAvg,  0, 1),
    touchAreaAvg:     sanitize(vec.touchAreaAvg,      0, 10000),
    windowFocused:    Boolean(vec.windowFocused),
    sampleCount:      Math.max(0, Math.min(10000, Number(vec.sampleCount) || 0)),
    durationMs:       Math.max(0, Math.min(3_600_000, Number(vec.durationMs) || 0)),
  };

  const result = reportBehavior(cleaned);
  res.json(result);
});

/** GET /api/biometric/session/:id (admin) */
router.get(
  "/api/biometric/session/:id",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const info = getSessionBiometric(req.params["id"]!);
    if (!info) {
      res.status(404).json({ error: "Sessão não encontrada ou expirada" });
      return;
    }
    res.json(info);
  }
);

/** GET /api/biometric/stats (admin) */
router.get(
  "/api/biometric/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    res.json({ biometric: getBiometricStats(), generatedAt: new Date().toISOString() });
  }
);

/** GET /api/biometric/snippet?sid=... — JS client para embutir */
router.get("/api/biometric/snippet", (req: Request, res: Response) => {
  const sid      = (req.query["sid"] as string) ?? "anonymous";
  const interval = parseInt(req.query["interval"] as string ?? "10000", 10);
  const ms       = isNaN(interval) || interval < 5000 ? 10_000 : Math.min(interval, 60_000);
  res.setHeader("Content-Type", "application/javascript");
  res.send(getBiometricSnippet(sid.slice(0, 128), ms));
});

/** GET /api/biometric/health */
router.get("/api/biometric/health", (_req: Request, res: Response) => {
  const stats = getBiometricStats();
  res.json({ ok: true, module: "biometric", stats });
});

export default router;
