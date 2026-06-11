/**
 * VolatusPay — Adaptive Deception Routes
 * Ativa endereços falsos dinamicamente por IP suspeito.
 */

import { Router } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import {
  getAdaptiveDeceptionStats,
  getActiveEndpoints,
  getDeceptionProfiles,
  activateDeception,
  purgeDeception,
} from "../security/adaptive-deception.js";

const router = Router();

router.get(
  "/api/adaptive-deception/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req, res) => res.json(getAdaptiveDeceptionStats())
);

router.get(
  "/api/adaptive-deception/endpoints",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req, res) => {
    const endpoints = getActiveEndpoints();
    res.json({ endpoints, total: endpoints.length });
  }
);

router.get(
  "/api/adaptive-deception/profiles",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req, res) => {
    const profiles = getDeceptionProfiles();
    res.json({ profiles, total: profiles.length });
  }
);

router.post(
  "/api/adaptive-deception/activate/:ip",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req, res) => {
    const ip = req.params["ip"] ?? "";
    if (!ip) { res.status(400).json({ error: "IP required" }); return; }
    activateDeception(ip);
    res.json({ activated: true, ip });
  }
);

router.delete(
  "/api/adaptive-deception/purge",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req, res) => {
    purgeDeception();
    res.json({ purged: true });
  }
);

router.get("/api/adaptive-deception/health", (_req, res) => {
  const stats = getAdaptiveDeceptionStats();
  res.json({ ok: true, module: "adaptive-deception", stats });
});

export default router;
