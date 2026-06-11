/**
 * VolatusPay — ZKP Routes (Zero-Knowledge Proof of Innocence)
 * Schnorr/Ed25519 — o cliente prova identidade sem revelar a chave.
 */

import { Router, type Request, type Response } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import {
  issueChallenge,
  verifyProof,
  getZKPStats,
  getClientSnippet,
  getDemoHtml,
  checkKnownCredential,
  type ZKPProof,
} from "../security/zkp.js";

const router = Router();

/** POST /api/zkp/challenge — emite desafio Schnorr */
router.post("/api/zkp/challenge", (req: Request, res: Response) => {
  const ip     = (req.headers["x-real-ip"] as string) ?? req.ip ?? "unknown";
  const domain = (req.headers["host"] as string) ?? "default";
  const ch     = issueChallenge(ip, domain);
  res.json({
    challengeId: ch.id,
    challenge:   ch.challenge,
    expiresAt:   ch.expiresAt,
    algorithm:   "Schnorr/Ed25519 (RFC 8032) — Fiat-Shamir",
    note:        "Envie { challengeId, R, s, P } — prova Schnorr de posse da chave, sem revelar a chave",
  });
});

/** POST /api/zkp/prove — verifica prova e ajusta score de risco */
router.post("/api/zkp/prove", (req: Request, res: Response) => {
  const proof = req.body as ZKPProof;
  if (!proof?.challengeId || !proof.R || !proof.s || !proof.P) {
    res.status(400).json({ error: "Prova incompleta — obrigatórios: challengeId, R, s, P" });
    return;
  }

  const result = verifyProof(proof);
  if (result.valid) {
    if (result.credentialId) {
      res.cookie("_vzkp", result.credentialId, {
        httpOnly: true,
        secure:   process.env["NODE_ENV"] === "production",
        sameSite: "strict",
        maxAge:   30 * 24 * 60 * 60 * 1000,
      });
    }
    res.json({
      valid:           true,
      credentialId:    result.credentialId,
      knownCredential: result.knownCredential,
      scoreAdjustment: result.scoreAdjustment,
      message:         result.knownCredential
        ? "Credencial de inocência reconhecida — acesso liberado"
        : "Prova ZKP válida — identidade anônima registrada",
      privacyNote: "Nenhum dado pessoal foi coletado ou armazenado",
    });
  } else {
    res.status(403).json({ valid: false, reason: result.reason, message: "Prova ZKP inválida" });
  }
});

/** GET /api/zkp/check/:credentialId */
router.get("/api/zkp/check/:credentialId", (req: Request, res: Response) => {
  res.json(checkKnownCredential(req.params["credentialId"]!));
});

/** GET /api/zkp/stats (admin) */
router.get(
  "/api/zkp/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    res.json({ zkp: getZKPStats(), generatedAt: new Date().toISOString() });
  }
);

/** GET /api/zkp/snippet — JS client para embutir */
router.get("/api/zkp/snippet", (req: Request, res: Response) => {
  const ip     = (req.headers["x-real-ip"] as string) ?? req.ip ?? "unknown";
  const domain = (req.headers["host"] as string) ?? "default";
  const ch     = issueChallenge(ip, domain);
  res.setHeader("Content-Type", "application/javascript");
  res.send(getClientSnippet(ch.id, ch.challenge));
});

/** GET /api/zkp/demo — página de demonstração interativa */
router.get("/api/zkp/demo", (req: Request, res: Response) => {
  const ip     = (req.headers["x-real-ip"] as string) ?? req.ip ?? "unknown";
  const domain = (req.headers["host"] as string) ?? "default";
  const ch     = issueChallenge(ip, domain);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(getDemoHtml(ch));
});

/** GET /api/zkp/health */
router.get("/api/zkp/health", (_req: Request, res: Response) => {
  const stats = getZKPStats();
  res.json({ ok: true, module: "zkp", stats });
});

export default router;
