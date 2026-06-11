/**
 * VolatusPay — Autonomous Deception Network Routes
 * 8 honeypot nodes MITRE ATT&CK mapped — harvesta TTPs de atacantes.
 */

import { Router } from "express";
import {
  processTrapHit,
  simulateAttackerSession,
  getDeceptionStats,
  getNodes,
  getProfiles,
  getTechniques,
  getIntelligence,
  NODES,
  type TrapHit,
} from "../security/deception-net.js";

const router = Router();

/** POST /api/deception/trap */
router.post("/api/deception/trap", (req, res) => {
  const { nodeId, ip, payload = "", method = "GET", headers = {} } = req.body as Partial<TrapHit> & {
    method?: string; headers?: Record<string, string>;
  };

  if (!nodeId || !ip) {
    res.status(400).json({ error: "nodeId e ip são obrigatórios." });
    return;
  }
  if (!NODES.find(n => n.id === nodeId)) {
    res.status(400).json({ error: `nodeId inválido. Válidos: ${NODES.map(n => n.id).join(", ")}` });
    return;
  }

  const result = processTrapHit({ nodeId, ip, payload: String(payload).slice(0, 512), method, headers });

  res.json({
    ok:        true,
    logId:     result.logId,
    node:      { id: result.nodeId, type: result.nodeType },
    ip:        result.ip,
    harvested: {
      severity:   result.harvested.severity,
      kcStage:    result.harvested.kcStage,
      techniques: result.harvested.techniques.map((t: any) => ({ id: t.id, name: t.name, tactic: t.tactic })),
      signals:    result.harvested.signals,
    },
    rule: {
      id:         result.rule.id,
      action:     result.rule.action,
      confidence: Number((result.rule.confidence * 100).toFixed(1)) + "%",
      ttlSec:     Math.round((result.rule.expiresAt - Date.now()) / 1000),
      mitreTtps:  result.rule.mitreTtps,
    },
    profile:      result.profile,
    fakeResponse: {
      statusCode: result.fakeResponse.statusCode,
      delayMs:    result.fakeResponse.delayMs,
      note:       "Resposta falsa enviada ao atacante (QRNG-seeded)",
    },
    kc3Fed: result.kc3Fed,
  });
});

/** GET /api/deception/status */
router.get("/api/deception/status", (_req, res) => {
  const stats = getDeceptionStats();
  res.json({
    phase:   214,
    engine:  "Autonomous Deception Network",
    version: "1.0.0",
    status:  "operational",
    nodes:   NODES.length,
    stats: {
      totalHits:       stats.totalHits,
      uniqueAttackers: stats.uniqueAttackers,
      totalTechniques: stats.totalTechniques,
      rulesGenerated:  stats.rulesGenerated,
      activeRules:     stats.activeRules,
      aptCount:        stats.aptCount,
      criticalEvents:  stats.criticalEvents,
    },
  });
});

/** GET /api/deception/nodes */
router.get("/api/deception/nodes", (_req, res) => {
  res.json({ total: NODES.length, nodes: getNodes() });
});

/** GET /api/deception/profiles */
router.get("/api/deception/profiles", (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 20), 100);
  res.json({ total: getProfiles(limit).length, profiles: getProfiles(limit) });
});

/** GET /api/deception/techniques */
router.get("/api/deception/techniques", (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  res.json({ total: limit, techniques: getTechniques(limit) });
});

/** GET /api/deception/intelligence */
router.get("/api/deception/intelligence", (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 30), 100);
  const intel = getIntelligence(limit);
  res.json({
    activeRules: intel.length,
    rules: intel,
    note: "Regras geradas automaticamente pelo Autonomous Deception Network",
  });
});

/** POST /api/deception/simulate */
router.post("/api/deception/simulate", (req, res) => {
  const { ip, scenario = "targeted" } = req.body as {
    ip?: string; scenario?: "script-kiddie" | "targeted" | "apt";
  };

  const validScenarios = ["script-kiddie", "targeted", "apt"];
  if (!validScenarios.includes(scenario)) {
    res.status(400).json({ error: `scenario inválido. Valores: ${validScenarios.join(", ")}` });
    return;
  }

  const result = simulateAttackerSession(ip, scenario);
  res.json({
    ok:           true,
    sessionId:    result.sessionId,
    ip:           result.ip,
    scenario,
    steps:        result.steps,
    durationMs:   result.durationMs,
    verdict:      result.verdict,
    finalProfile: result.finalProfile,
    hits: result.hits.map((h: any) => ({
      node:      { id: h.nodeId, type: h.nodeType },
      severity:  h.harvested.severity,
      kcStage:   h.harvested.kcStage,
      techniques: h.harvested.techniques.map((t: any) => t.id),
      action:    h.rule.action,
    })),
  });
});

/** GET /api/deception/net-health */
router.get("/api/deception/net-health", (_req, res) => {
  const stats = getDeceptionStats();
  res.json({ ok: true, module: "deception-net", nodes: NODES.length, stats });
});

export default router;
