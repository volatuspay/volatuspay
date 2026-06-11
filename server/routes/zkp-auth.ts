/**
 * VolatusPay — ZKP-Auth Routes (Fase 131)
 * Zero-Knowledge Proof para Autenticação de API — BigInt Schnorr/DH.
 * O cliente prova que conhece o secret sem nunca transmiti-lo.
 */

import { Router, type Request, type Response } from "express";
import {
  ZKP_AUTH_PARAMS,
  generateKeyPair,
  registerClient,
  verifyProof,
  generateProof,
  getDemoSecret,
  revokeClient,
  validateSession,
  getZKPAuthStats,
  getZKAClients,
  getZKAAuditLog,
  getZKAProofHistory,
} from "../security/zkp-auth.js";

const router = Router();

/** GET /api/zkp-auth/params — parâmetros públicos (p, q, g) */
router.get("/api/zkp-auth/params", (_req: Request, res: Response) => {
  res.json({
    ...ZKP_AUTH_PARAMS,
    pDisplay: ZKP_AUTH_PARAMS.p.slice(0, 32) + "..." + ZKP_AUTH_PARAMS.p.slice(-8),
    qDisplay: ZKP_AUTH_PARAMS.q.slice(0, 32) + "..." + ZKP_AUTH_PARAMS.q.slice(-8),
    note: "Full p and q available in p/q fields. Client must verify Y^q mod p == 1.",
    howItWorks: [
      "1. Client generates secret x = random in [1, q-1]",
      "2. Client computes public key Y = g^x mod p",
      "3. Client registers only Y with the server (x never leaves client)",
      "4. To authenticate: client picks r=random, computes R=g^r mod p",
      "5. Challenge c = SHA256(clientId:R:Y:ts:nonce) mod q  [Fiat-Shamir]",
      "6. Response s = (r - c*x) mod q",
      "7. Server verifies: g^s * Y^c mod p == R  →  ZK proof accepted",
    ],
  });
});

/** POST /api/zkp-auth/keygen — gera par de chaves */
router.post("/api/zkp-auth/keygen", (req: Request, res: Response) => {
  const pair = generateKeyPair();
  const name = (req.body?.name as string | undefined) ?? "API Client";
  const org  = (req.body?.org  as string | undefined) ?? "Unknown Org";

  const reg = registerClient(pair.clientId, pair.publicKey, name, org);
  if (!reg.ok) {
    res.status(409).json({ error: reg.reason });
    return;
  }

  res.status(201).json({
    clientId:   pair.clientId,
    publicKey:  pair.publicKey,
    secret:     pair.secret,
    warning:    "Store your secret securely. It will NOT be shown again.",
    howToProve: "POST /api/zkp-auth/test/prove com {clientId, secret} para gerar prova (demo only)",
    source:     "VolatusZKP-Auth/v131",
  });
});

/** POST /api/zkp-auth/register — registra chave pública gerada pelo cliente */
router.post("/api/zkp-auth/register", (req: Request, res: Response) => {
  const { clientId, publicKey, name, org } = req.body ?? {};
  if (!clientId || !publicKey || !name || !org) {
    res.status(400).json({ error: "clientId, publicKey, name, org são obrigatórios" });
    return;
  }
  const r = registerClient(clientId as string, publicKey as string, name as string, org as string);
  if (!r.ok) {
    res.status(409).json({ error: r.reason });
    return;
  }
  res.status(201).json({ ok: true, clientId, message: "Chave pública registrada.", source: "VolatusZKP-Auth/v131" });
});

/** POST /api/zkp-auth/prove — prova ZKP gerada pelo cliente */
router.post("/api/zkp-auth/prove", (req: Request, res: Response) => {
  const { clientId, R, s, timestamp, nonce } = req.body ?? {};
  if (!clientId || !R || !s || !timestamp || !nonce) {
    res.status(400).json({ error: "clientId, R, s, timestamp, nonce são obrigatórios" });
    return;
  }
  const ip     = (req.headers["x-real-ip"] as string) ?? req.ip ?? "unknown";
  const result = verifyProof({ clientId, R, s, timestamp, nonce, ip });
  if (!result.ok) {
    res.status(401).json({ ok: false, error: result.reason, source: "VolatusZKP-Auth/v131" });
    return;
  }
  res.json({
    ok:            true,
    token:         result.session!.token,
    clientId:      result.session!.clientId,
    name:          result.session!.name,
    org:           result.session!.org,
    issuedAt:      result.session!.issuedAt,
    expiresAt:     result.session!.expiresAt,
    proofHash:     result.session!.proofHash,
    zeroKnowledge: "proof accepted — secret was never transmitted",
    source:        "VolatusZKP-Auth/v131",
  });
});

/** POST /api/zkp-auth/test/prove — prova gerada pelo servidor (demo/SDK) */
router.post("/api/zkp-auth/test/prove", (req: Request, res: Response) => {
  const { clientId, secret: rawSecret } = req.body ?? {};
  if (!clientId) {
    res.status(400).json({ error: "clientId é obrigatório" });
    return;
  }

  const secret = (rawSecret as string | undefined) ?? getDemoSecret(clientId as string) ?? "";
  if (!secret) {
    res.status(400).json({ error: "secret obrigatório (ou use um clientId demo)" });
    return;
  }

  const proof = generateProof({ clientId: clientId as string, secret });
  if (!proof) {
    const demoSec = getDemoSecret(clientId as string);
    if (!demoSec) { res.status(404).json({ error: "client_not_found_or_revoked" }); return; }
    const proof2 = generateProof({ clientId: clientId as string, secret: demoSec });
    if (!proof2) { res.status(500).json({ error: "proof_generation_failed" }); return; }
    const ip2  = (req.headers["x-real-ip"] as string) ?? req.ip ?? "unknown";
    const res2 = verifyProof({ clientId: clientId as string, ...proof2, ip: ip2 });
    if (!res2.ok) { res.status(401).json({ ok: false, error: res2.reason }); return; }
    res.json({ ok: true, proof: proof2, token: res2.session!.token, source: "VolatusZKP-Auth/v131" });
    return;
  }

  const ip     = (req.headers["x-real-ip"] as string) ?? req.ip ?? "unknown";
  const result = verifyProof({ clientId: clientId as string, ...proof, ip });
  if (!result.ok) {
    res.status(401).json({ ok: false, error: result.reason, proof });
    return;
  }
  res.json({
    ok:            true,
    proof,
    token:         result.session!.token,
    clientId:      result.session!.clientId,
    name:          result.session!.name,
    org:           result.session!.org,
    issuedAt:      result.session!.issuedAt,
    expiresAt:     result.session!.expiresAt,
    proofHash:     result.session!.proofHash,
    zeroKnowledge: "proof accepted — secret never transmitted",
    note:          "In production, client computes proof locally.",
    source:        "VolatusZKP-Auth/v131",
  });
});

/** GET /api/zkp-auth/session — valida sessão via Bearer token */
router.get("/api/zkp-auth/session", (req: Request, res: Response) => {
  const authHeader = req.headers["authorization"] ?? "";
  const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (req.query["token"] as string);
  if (!token) {
    res.status(400).json({ error: "Bearer token ou ?token= obrigatório" });
    return;
  }
  const sess = validateSession(token);
  if (!sess) {
    res.status(401).json({ ok: false, active: false, error: "session_invalid_or_expired" });
    return;
  }
  res.json({
    ok: true, active: sess.active, clientId: sess.clientId, name: sess.name, org: sess.org,
    issuedAt: sess.issuedAt, expiresAt: sess.expiresAt, proofHash: sess.proofHash,
    source: "VolatusZKP-Auth/v131",
  });
});

/** POST /api/zkp-auth/revoke */
router.post("/api/zkp-auth/revoke", (req: Request, res: Response) => {
  const { clientId } = req.body ?? {};
  if (!clientId) { res.status(400).json({ error: "clientId obrigatório" }); return; }
  const ok = revokeClient(clientId as string);
  if (!ok) { res.status(404).json({ error: "client_not_found" }); return; }
  res.json({ ok: true, clientId, message: "Cliente revogado. Todas as sessões invalidadas.", source: "VolatusZKP-Auth/v131" });
});

/** GET /api/zkp-auth/stats */
router.get("/api/zkp-auth/stats", (_req: Request, res: Response) => res.json(getZKPAuthStats()));

/** GET /api/zkp-auth/clients */
router.get("/api/zkp-auth/clients", (_req: Request, res: Response) => {
  res.json({
    clients: getZKAClients().map(c => ({
      clientId:        c.clientId,
      name:            c.name,
      org:             c.org,
      publicKeyPrefix: c.publicKey.slice(0, 16) + "...",
      registeredAt:    c.registeredAt,
      lastProofAt:     c.lastProofAt,
      proofsTotal:     c.proofsTotal,
      proofsFailed:    c.proofsFailed,
      sessionCount:    c.sessionCount,
      revoked:         c.revoked,
    })),
    source: "VolatusZKP-Auth/v131",
  });
});

/** GET /api/zkp-auth/audit */
router.get("/api/zkp-auth/audit", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query["limit"] as string ?? "50"), 500);
  res.json({ entries: getZKAAuditLog(limit), source: "VolatusZKP-Auth/v131" });
});

/** GET /api/zkp-auth/proofs */
router.get("/api/zkp-auth/proofs", (req: Request, res: Response) => {
  const limit    = Math.min(parseInt(req.query["limit"] as string ?? "50"), 500);
  const clientId = req.query["clientId"] as string | undefined;
  res.json({ proofs: getZKAProofHistory(limit, clientId), source: "VolatusZKP-Auth/v131" });
});

/** GET /api/zkp-auth/health */
router.get("/api/zkp-auth/health", (_req: Request, res: Response) => {
  const stats = getZKPAuthStats();
  res.json({ ok: true, module: "zkp-auth", stats });
});

export default router;
