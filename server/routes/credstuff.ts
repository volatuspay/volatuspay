/**
 * VolatusPay — Credential Stuffing Detection Routes
 */

import { Router } from "express";
import {
  checkCredStuffing,
  listCredStuffingEvents,
  getCredStuffingTopAttackers,
  getCredStuffingChainStats,
  credStuffingChainSelfTest,
} from "../security/credential-stuffing.js";

const router = Router();

router.post("/api/credstuff/check", async (req, res) => {
  try {
    const b = req.body ?? {};
    if (!b.ip || !b.username) {
      res.status(400).json({ ok: false, error: "ip e username são obrigatórios" });
      return;
    }
    const event = await checkCredStuffing({
      ip:        String(b.ip),
      username:  String(b.username),
      password:  b.password  ? String(b.password)  : undefined,
      pwdHash16: b.pwdHash16 ? String(b.pwdHash16) : undefined,
      ua:        b.ua ? String(b.ua) : undefined,
      success:   !!b.success,
    });
    res.json({ ok: true, event });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/api/credstuff/events", (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 1000));
  res.json({ ok: true, events: listCredStuffingEvents(limit) });
});

router.get("/api/credstuff/top-attackers", (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(String(req.query["limit"] ?? "20"), 10) || 20, 100));
  res.json({ ok: true, attackers: getCredStuffingTopAttackers(limit) });
});

router.get("/api/credstuff/chain-stats", (_req, res) => {
  res.json({ ok: true, ...getCredStuffingChainStats() });
});

router.get("/api/credstuff/self-test", async (_req, res) => {
  try {
    const r = await credStuffingChainSelfTest();
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/api/credstuff/health", (_req, res) => {
  const stats = getCredStuffingChainStats();
  res.json({ ok: true, module: "credstuff", stats });
});

export default router;
