/**
 * VolatusPay — Canary Token Routes
 * Tokens rastreáveis que detectam exfiltração de dados.
 */

import { Router, type Request, type Response } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import {
  processCanaryHit,
  lookupCanaryToken,
  getCanaryStats,
} from "../security/canary.js";

const router = Router();

/** GET /api/canary/health */
router.get("/api/canary/health", (_req: Request, res: Response) => {
  const stats = getCanaryStats();
  res.json({ ok: true, module: "canary", stats });
});

/** GET /api/canary/hit/:token — público, rastreável (o atacante não sabe que está se denunciando) */
router.get("/api/canary/hit/:token", (req: Request, res: Response) => {
  const token     = req.params["token"];
  const ip        = (req as any).clientIp ??
    (req.headers["x-forwarded-for"] as string ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
  const sessionId = (req as any).cookies?.["fm_session"] ?? null;

  if (!token || token.length < 8) {
    res.status(204).send();
    return;
  }

  const result = processCanaryHit(token, ip, sessionId);
  if (!result) {
    res.status(204).send();
    return;
  }

  res.status(200).json({ ok: true, ts: Date.now(), echo: token.slice(0, 4) + "..." });
});

/** POST /api/canary/report — lookup forense (admin) */
router.post(
  "/api/canary/report",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (!token) { res.status(400).json({ error: "token obrigatório" }); return; }

    const data = lookupCanaryToken(token);
    if (!data) {
      res.status(404).json({ error: "Token não encontrado ou expirado (TTL 24h)" });
      return;
    }

    res.json({
      found:        true,
      token:        data.token,
      issuedAt:     new Date(data.issuedAt).toISOString(),
      origin: {
        ip:         data.ip,
        sessionId:  data.sessionId ?? "anon",
        endpoint:   data.endpoint,
        method:     data.method,
        userAgent:  data.userAgent,
        reqId:      data.reqId,
      },
      fired:        data.fired,
      firedAt:      data.firedAt ? new Date(data.firedAt).toISOString() : null,
      firedFrom: data.fired ? { ip: data.firedFromIp, sessionId: data.firedFromSession ?? "anon" } : null,
      exfiltration: data.fired && data.firedFromIp !== data.ip,
    });
  }
);

/** GET /api/canary/stats (admin) */
router.get(
  "/api/canary/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    res.json({ canary: getCanaryStats(), generatedAt: new Date().toISOString() });
  }
);

export default router;
