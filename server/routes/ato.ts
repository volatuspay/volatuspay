/**
 * VolatusPay — ATO Routes (Account Takeover Detection)
 * Detecta login impossível, novo país, novo device, credential stuffing.
 */

import { Router } from "express";
import {
  checkAto,
  listAtoEvents,
  getAtoEventsByUser,
  getAtoChainStats,
  atoChainSelfTest,
} from "../security/ato-detector.js";

const router = Router();

/** POST /api/ato/check */
router.post("/api/ato/check", async (req, res) => {
  try {
    const b = req.body ?? {};
    if (!b.userId || !b.ip) {
      res.status(400).json({ ok: false, error: "userId e ip são obrigatórios" });
      return;
    }
    const event = await checkAto({
      userId:               String(b.userId),
      ip:                   String(b.ip),
      ua:                   b.ua ? String(b.ua) : undefined,
      country:              b.country ?? null,
      failedLoginsLastHour: typeof b.failedLoginsLastHour === "number" ? b.failedLoginsLastHour : undefined,
      newCountry:           !!b.newCountry,
      newDevice:            !!b.newDevice,
      impossibleTravel:     !!b.impossibleTravel,
    });
    res.json({ ok: true, event });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/** GET /api/ato/events */
router.get("/api/ato/events", (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 1000));
  res.json({ ok: true, events: listAtoEvents(limit) });
});

/** GET /api/ato/user/:id */
router.get("/api/ato/user/:id", (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 1000));
  res.json({ ok: true, userId: req.params["id"], events: getAtoEventsByUser(req.params["id"]!, limit) });
});

/** GET /api/ato/chain-stats */
router.get("/api/ato/chain-stats", (_req, res) => {
  res.json({ ok: true, ...getAtoChainStats() });
});

/** GET /api/ato/self-test */
router.get("/api/ato/self-test", async (_req, res) => {
  try {
    const r = await atoChainSelfTest();
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/** GET /api/ato/health */
router.get("/api/ato/health", (_req, res) => {
  const stats = getAtoChainStats();
  res.json({ ok: true, module: "ato", stats });
});

export default router;
