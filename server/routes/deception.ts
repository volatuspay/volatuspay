/**
 * VolatusPay — Deception Token Mesh Routes (Honeytokens)
 * Cria e monitora tokens-armadilha que detectam exfiltração.
 */

import { Router, type Request, type Response } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import {
  createDeceptionToken,
  listTokens,
  getToken,
  deactivateToken,
  getAlerts,
  getDeceptionStats,
  getAvailableTypes,
  triggerToken,
  type TokenType,
} from "../security/deception.js";

const router = Router();

/** POST /api/deception/tokens/generate (admin) */
router.post(
  "/api/deception/tokens/generate",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const body    = req.body as Record<string, unknown>;
    const type    = body["type"] as TokenType;
    const label   = typeof body["label"]   === "string" ? (body["label"] as string).trim()   : "";
    const note    = typeof body["note"]    === "string" ? (body["note"] as string).trim()    : "";
    const ttlDays = typeof body["ttlDays"] === "number" ? body["ttlDays"] as number         : undefined;
    const tags    = Array.isArray(body["tags"])
      ? (body["tags"] as unknown[]).filter((t): t is string => typeof t === "string")
      : undefined;

    const types = getAvailableTypes().map(t => t.type);
    if (!type || !types.includes(type)) {
      res.status(400).json({ error: `Tipo inválido. Disponíveis: ${types.join(", ")}` });
      return;
    }
    if (!label) { res.status(400).json({ error: "Campo 'label' obrigatório" }); return; }

    const token = createDeceptionToken({ type, label, note, ttlDays, tags });
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(token);
  }
);

/** GET /api/deception/tokens (admin) */
router.get(
  "/api/deception/tokens",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const active = req.query["active"] === undefined ? undefined : req.query["active"] === "true";
    const type   = req.query["type"] as TokenType | undefined;
    const limit  = Math.min(200, parseInt(req.query["limit"] as string) || 100);
    const tokens = listTokens({ active, type, limit });
    res.setHeader("Cache-Control", "no-store");
    res.json({ tokens, total: tokens.length });
  }
);

/** GET /api/deception/tokens/:id (admin) */
router.get(
  "/api/deception/tokens/:id",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const token = getToken(req.params["id"]!);
    if (!token) { res.status(404).json({ error: "Token não encontrado" }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json(token);
  }
);

/** DELETE /api/deception/tokens/:id (admin) */
router.delete(
  "/api/deception/tokens/:id",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const ok = deactivateToken(req.params["id"]!);
    if (!ok) { res.status(404).json({ error: "Token não encontrado ou já inativo" }); return; }
    res.json({ ok: true, message: "Token desativado com sucesso" });
  }
);

/** GET /api/deception/alerts (admin) */
router.get(
  "/api/deception/alerts",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const limit = Math.min(500, parseInt(req.query["limit"] as string) || 50);
    const all   = getAlerts(limit);
    res.setHeader("Cache-Control", "no-store");
    res.json({ alerts: all, total: all.length });
  }
);

/** GET /api/deception/alerts/:alertId (admin) */
router.get(
  "/api/deception/alerts/:alertId",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const all   = getAlerts(5000);
    const alert = all.find(a => a.alertId === req.params["alertId"]);
    if (!alert) { res.status(404).json({ error: "Alerta não encontrado" }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json(alert);
  }
);

/** GET /api/deception/stats (admin) */
router.get(
  "/api/deception/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getDeceptionStats());
  }
);

/** GET /api/deception/types (admin) */
router.get(
  "/api/deception/types",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ types: getAvailableTypes() });
  }
);

/** GET /api/deception/trigger/:id — PÚBLICO (armadilha rastreável) */
router.get("/api/deception/trigger/:id", (req: Request, res: Response) => {
  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") safeHeaders[k] = k.toLowerCase().includes("cookie") ? "[redacted]" : v;
  }

  const alert = triggerToken(req.params["id"]!, {
    ip:      (req.headers["x-forwarded-for"] as string ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim(),
    ua:      req.headers["user-agent"] ?? "unknown",
    path:    req.path,
    method:  req.method,
    body:    `GET ${req.path} Referer:${req.headers["referer"] ?? "-"}`,
    headers: safeHeaders,
  });

  if (!alert) { res.status(404).send("Not Found"); return; }
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send("OK");
});

/** GET /api/deception/health */
router.get("/api/deception/health", (_req: Request, res: Response) => {
  const stats = getDeceptionStats();
  res.json({ ok: true, module: "deception", types: getAvailableTypes().length, stats });
});

export default router;
