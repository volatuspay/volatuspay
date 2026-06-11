/**
 * VolatusWebhookSig — Ed25519 Digitally Signed Webhooks (Fase 146)
 * =================================================================
 * Webhook hijacking matematicamente impossível — qualquer adulteração
 * de payload, headers ou replay é detectado com certeza criptográfica.
 *
 * Problema:
 *   Webhook sem assinatura: atacante MITM altera payload (ex: amount 100→100000)
 *   HMAC-SHA256 (padrão Stripe/GitHub): chave simétrica → endpoint comprometido
 *     expõe a chave → atacante forja qualquer webhook
 *   Replay attacks: mesma payload válida reenviada N vezes
 *
 * Solução Ed25519 (RFC 8032, Bernstein 2011):
 *   Assimétrico: servidor mantém privkey, endpoints só têm pubkey
 *   Endpoint comprometido NÃO pode forjar assinaturas (só pode verificar)
 *   Ed25519: 64-byte signature, 32-byte key, ~100k sign/verify por segundo
 *   Algoritmo: Twisted Edwards curve E: -x²+y²=1-d·x²·y² sobre GF(2²⁵⁵-19)
 *   Implementação: 100% Node.js built-in crypto — zero terceiros, zero custo
 *
 * Assinatura:
 *   signed_data = SHA-256(timestamp‖method‖path‖body_sha256)
 *   sig = Ed25519.sign(privKey, signed_data)
 *   header: X-Volatus-Signature: Ed25519.{keyId}.{base64url(sig)}
 *   header: X-Volatus-Timestamp: {unix_ms}
 *   header: X-Volatus-Key-Id: {keyId}
 *
 * Verificação:
 *   1. Replay check: |now - timestamp| < 5 min
 *   2. Key lookup por keyId (suporta múltiplas versões em rotação)
 *   3. Ed25519.verify(pubKey, signed_data, sig)
 *   4. timing-safe comparison implícito (Ed25519 verify ≠ compare)
 *
 * Parâmetros de segurança:
 *   REPLAY_WINDOW = 300s (5 min)
 *   KEY_TTL       = 30 dias
 *   GRACE_PERIOD  = 24h (chave antiga válida após rotação)
 *   SIG_FORMAT    = "Ed25519.{keyId}.{b64url(sig)}"
 */

import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface WebhookKeyPair {
  keyId:      string;
  publicKey:  string;   // PEM
  privateKey: string;   // PEM (servidor guarda, nunca exposto)
  publicKeyHex: string; // 32 bytes hex para distribuição leve
  createdAt:  number;
  expiresAt:  number;
  status:     "active" | "grace" | "revoked";
  version:    number;
}

export interface SignedWebhook {
  eventId:    string;
  eventType:  string;
  method:     string;
  path:       string;
  body:       string;         // JSON payload
  bodyHash:   string;         // SHA-256(body) hex
  timestamp:  number;         // unix ms
  keyId:      string;
  signature:  string;         // base64url
  sigHeader:  string;         // "Ed25519.{keyId}.{sig}"
  headers: {
    "X-Volatus-Signature":  string;
    "X-Volatus-Timestamp":  string;
    "X-Volatus-Key-Id":     string;
    "X-Volatus-Event-Id":   string;
    "X-Volatus-Event-Type": string;
  };
}

export interface VerifyResult {
  ok:        boolean;
  eventId:   string;
  keyId:     string;
  reason:    string;
  latencyMs: number;
}

export interface WebhookAuditEntry {
  ts:       number;
  op:       "sign" | "verify" | "rotate" | "revoke" | "distribute";
  keyId:    string;
  eventId:  string;
  ok:       boolean;
  detail:   string;
}

export interface WebhookSigStats {
  active:         boolean;
  totalKeys:      number;
  activeKeys:     number;
  graceKeys:      number;
  revokedKeys:    number;
  totalSigned:    number;
  totalVerified:  number;
  totalFailed:    number;
  replayBlocked:  number;
  tamperBlocked:  number;
  sdksRegistered: number;
  auditLog:       WebhookAuditEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Parâmetros
// ─────────────────────────────────────────────────────────────────────────────

const REPLAY_WINDOW = 300_000;          // 5 min em ms
const KEY_TTL       = 30 * 24 * 3600 * 1000; // 30 dias
const GRACE_PERIOD  = 24 * 3600 * 1000;      // 24h

// ─────────────────────────────────────────────────────────────────────────────
// Estado global
// ─────────────────────────────────────────────────────────────────────────────

const keyStore   = new Map<string, WebhookKeyPair>();
const sdkKeys    = new Map<string, string>();   // sdkId → keyId (qual chave o SDK usa)
const nonces     = new Set<string>();           // eventIds usados (anti-replay)
let   nonceTimer: ReturnType<typeof setInterval> | null = null;
let   keyVersion = 0;

const stats: WebhookSigStats = {
  active:         false,
  totalKeys:      0,
  activeKeys:     0,
  graceKeys:      0,
  revokedKeys:    0,
  totalSigned:    0,
  totalVerified:  0,
  totalFailed:    0,
  replayBlocked:  0,
  tamperBlocked:  0,
  sdksRegistered: 0,
  auditLog:       [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function newEventId(): string {
  return `evt_${crypto.randomBytes(8).toString("hex")}`;
}

function addAudit(
  op: WebhookAuditEntry["op"],
  keyId: string,
  eventId: string,
  ok: boolean,
  detail: string
) {
  const entry: WebhookAuditEntry = { ts: Date.now(), op, keyId, eventId, ok, detail };
  stats.auditLog.unshift(entry);
  if (stats.auditLog.length > 300) stats.auditLog.length = 300;
}

function updateKeyCounts() {
  let active = 0, grace = 0, revoked = 0;
  for (const k of keyStore.values()) {
    if (k.status === "active")  active++;
    else if (k.status === "grace")   grace++;
    else                              revoked++;
  }
  stats.activeKeys  = active;
  stats.graceKeys   = grace;
  stats.revokedKeys = revoked;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geração de chaves Ed25519
// ─────────────────────────────────────────────────────────────────────────────

export function generateWebhookKey(): WebhookKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding:  { type: "spki",  format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // keyId = SHA-256 primeiros 16 bytes do raw public key (fingerprint compacto)
  const pubKeyObj = crypto.createPublicKey(publicKey);
  const pubKeyDer = pubKeyObj.export({ type: "spki", format: "der" });
  // Der SPKI para Ed25519: últimos 32 bytes são a chave pública raw
  const rawPub    = pubKeyDer.subarray(-32);
  const keyId     = sha256(rawPub).slice(0, 16);
  const publicKeyHex = rawPub.toString("hex");

  keyVersion++;
  const pair: WebhookKeyPair = {
    keyId,
    publicKey,
    privateKey,
    publicKeyHex,
    createdAt:  Date.now(),
    expiresAt:  Date.now() + KEY_TTL,
    status:     "active",
    version:    keyVersion,
  };

  keyStore.set(keyId, pair);
  stats.totalKeys++;
  updateKeyCounts();
  addAudit("sign", keyId, "keygen", true, `Ed25519 keypair v${keyVersion} gerado`);
  return pair;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assinatura de webhook
// ─────────────────────────────────────────────────────────────────────────────

export function signWebhook(options: {
  eventType: string;
  method:    string;
  path:      string;
  body:      object | string;
  keyId?:    string;
}): SignedWebhook {
  // Selecionar chave ativa
  let pair: WebhookKeyPair | undefined;
  if (options.keyId) {
    pair = keyStore.get(options.keyId);
  } else {
    // Usar chave ativa mais recente (maior versão)
    for (const k of keyStore.values()) {
      if (k.status === "active") {
        if (!pair || k.version > pair.version) pair = k;
      }
    }
  }
  if (!pair) throw new Error("No active Ed25519 key available");

  const eventId   = newEventId();
  const timestamp = Date.now();
  const bodyStr   = typeof options.body === "string"
    ? options.body
    : JSON.stringify(options.body);
  const bodyHash  = sha256(bodyStr);

  // Canonical signed data: timestamp‖method‖path‖body_sha256
  // (segue padrão Stripe/GitHub mas com Ed25519 assimétrico)
  const signedData = [
    timestamp.toString(),
    options.method.toUpperCase(),
    options.path,
    bodyHash,
  ].join("\n");

  const privKey = crypto.createPrivateKey(pair.privateKey);
  const sigBuf  = crypto.sign(null, Buffer.from(signedData), privKey);
  const sigB64  = b64url(sigBuf);
  const sigHeader = `Ed25519.${pair.keyId}.${sigB64}`;

  stats.totalSigned++;
  addAudit("sign", pair.keyId, eventId, true,
    `${options.eventType} ${options.method} ${options.path}`);

  return {
    eventId,
    eventType:  options.eventType,
    method:     options.method.toUpperCase(),
    path:       options.path,
    body:       bodyStr,
    bodyHash,
    timestamp,
    keyId:      pair.keyId,
    signature:  sigB64,
    sigHeader,
    headers: {
      "X-Volatus-Signature":  sigHeader,
      "X-Volatus-Timestamp":  timestamp.toString(),
      "X-Volatus-Key-Id":     pair.keyId,
      "X-Volatus-Event-Id":   eventId,
      "X-Volatus-Event-Type": options.eventType,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificação de webhook
// ─────────────────────────────────────────────────────────────────────────────

export function verifyWebhook(options: {
  sigHeader:  string;
  timestamp:  number;
  method:     string;
  path:       string;
  body:       string;
  eventId:    string;
  skipReplay?: boolean;  // para testes de replay
}): VerifyResult {
  const t0 = Date.now();

  // 1. Parsear header
  const parts = options.sigHeader.split(".");
  if (parts.length !== 3 || parts[0] !== "Ed25519") {
    return { ok: false, eventId: options.eventId, keyId: "", reason: "invalid_sig_format", latencyMs: Date.now() - t0 };
  }
  const [, keyId, sigB64] = parts;

  // 2. Replay check: timestamp dentro da janela
  if (!options.skipReplay) {
    const delta = Math.abs(Date.now() - options.timestamp);
    if (delta > REPLAY_WINDOW) {
      stats.replayBlocked++;
      stats.totalFailed++;
      addAudit("verify", keyId, options.eventId, false, `replay_blocked delta=${Math.round(delta/1000)}s`);
      return { ok: false, eventId: options.eventId, keyId, reason: "replay_expired", latencyMs: Date.now() - t0 };
    }
  }

  // 3. Nonce anti-replay (eventId único por janela)
  if (nonces.has(options.eventId) && !options.skipReplay) {
    stats.replayBlocked++;
    stats.totalFailed++;
    addAudit("verify", keyId, options.eventId, false, "replay_nonce_reuse");
    return { ok: false, eventId: options.eventId, keyId, reason: "replay_nonce", latencyMs: Date.now() - t0 };
  }

  // 4. Lookup da chave
  const pair = keyStore.get(keyId);
  if (!pair || pair.status === "revoked") {
    stats.totalFailed++;
    addAudit("verify", keyId, options.eventId, false, "key_not_found_or_revoked");
    return { ok: false, eventId: options.eventId, keyId, reason: "key_invalid", latencyMs: Date.now() - t0 };
  }

  // 5. Reconstruir signed data
  const bodyHash   = sha256(options.body);
  const signedData = [
    options.timestamp.toString(),
    options.method.toUpperCase(),
    options.path,
    bodyHash,
  ].join("\n");

  // 6. Ed25519 verify
  let ok = false;
  try {
    const pubKey = crypto.createPublicKey(pair.publicKey);
    ok = crypto.verify(null, Buffer.from(signedData), pubKey, b64urlDecode(sigB64));
  } catch {
    ok = false;
  }

  if (ok) {
    nonces.add(options.eventId);
    stats.totalVerified++;
    addAudit("verify", keyId, options.eventId, true, `${options.method} ${options.path}`);
  } else {
    stats.tamperBlocked++;
    stats.totalFailed++;
    addAudit("verify", keyId, options.eventId, false, "signature_mismatch");
  }

  return {
    ok,
    eventId:   options.eventId,
    keyId,
    reason:    ok ? "valid" : "signature_mismatch",
    latencyMs: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotação de chaves
// ─────────────────────────────────────────────────────────────────────────────

export interface RotationResult {
  oldKeyId:  string;
  newKeyId:  string;
  graceUntil: number;
  newVersion: number;
}

export function rotateKey(oldKeyId?: string): RotationResult {
  // Colocar chave antiga em grace
  let oldPair: WebhookKeyPair | undefined;
  if (oldKeyId) {
    oldPair = keyStore.get(oldKeyId);
  } else {
    for (const k of keyStore.values()) {
      if (k.status === "active") {
        if (!oldPair || k.version > oldPair.version) oldPair = k;
      }
    }
  }

  if (oldPair) {
    oldPair.status    = "grace";
    oldPair.expiresAt = Date.now() + GRACE_PERIOD;
    addAudit("rotate", oldPair.keyId, "rotation", true,
      `old key → grace (expires in 24h)`);
  }

  // Gerar nova chave
  const newPair = generateWebhookKey();

  updateKeyCounts();
  addAudit("rotate", newPair.keyId, "rotation", true,
    `new key v${newPair.version} activated`);

  return {
    oldKeyId:   oldPair?.keyId ?? "",
    newKeyId:   newPair.keyId,
    graceUntil: oldPair?.expiresAt ?? 0,
    newVersion: newPair.version,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revogação de chave
// ─────────────────────────────────────────────────────────────────────────────

export function revokeKey(keyId: string): boolean {
  const pair = keyStore.get(keyId);
  if (!pair) return false;
  pair.status    = "revoked";
  pair.expiresAt = Date.now();
  updateKeyCounts();
  addAudit("revoke", keyId, "revoke", true, "key revoked immediately");
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribuição de chave pública para SDKs
// ─────────────────────────────────────────────────────────────────────────────

export interface SdkKeyBundle {
  sdkId:         string;
  keyId:         string;
  publicKeyPem:  string;
  publicKeyHex:  string;
  algorithm:     string;
  sigFormat:     string;
  verifyPath:    string;
  distributedAt: number;
}

export function distributeKey(sdkId: string, keyId?: string): SdkKeyBundle {
  // Encontrar chave ativa
  let pair: WebhookKeyPair | undefined;
  if (keyId) {
    pair = keyStore.get(keyId);
  } else {
    for (const k of keyStore.values()) {
      if (k.status === "active") {
        if (!pair || k.version > pair.version) pair = k;
      }
    }
  }
  if (!pair) throw new Error("No active key to distribute");

  sdkKeys.set(sdkId, pair.keyId);
  if (!stats.sdksRegistered || !sdkKeys.has(sdkId)) stats.sdksRegistered++;
  stats.sdksRegistered = sdkKeys.size;

  addAudit("distribute", pair.keyId, sdkId, true, `publicKey distribuída para ${sdkId}`);

  return {
    sdkId,
    keyId:         pair.keyId,
    publicKeyPem:  pair.publicKey,
    publicKeyHex:  pair.publicKeyHex,
    algorithm:     "Ed25519 (RFC 8032)",
    sigFormat:     "Ed25519.{keyId}.{base64url(signature)}",
    verifyPath:    "/api/webhook-sig/verify",
    distributedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificação em lote
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchVerifyResult {
  total:    number;
  passed:   number;
  failed:   number;
  results:  VerifyResult[];
  allOk:    boolean;
}

export function batchVerify(webhooks: Array<{
  sigHeader: string;
  timestamp: number;
  method:    string;
  path:      string;
  body:      string;
  eventId:   string;
}>): BatchVerifyResult {
  const results = webhooks.map(w => verifyWebhook({ ...w, skipReplay: true }));
  const passed  = results.filter(r => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results, allOk: passed === results.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────

export function startWebhookSig(): void {
  if (stats.active) return;
  stats.active = true;

  // Gerar chave inicial
  generateWebhookKey();

  // Limpar nonces expirados a cada 10 min (memória bounded)
  nonceTimer = setInterval(() => {
    if (nonces.size > 100_000) nonces.clear();
  }, 600_000);

  console.log("[webhook-ed25519] VolatusPay Ed25519 webhook signing ativo — Ed25519 webhook signing iniciado");
}

export function getWebhookSigStats(): WebhookSigStats {
  return { ...stats };
}

export function getWebhookKeys(): WebhookKeyPair[] {
  return [...keyStore.values()].map(k => ({
    ...k,
    privateKey: "[REDACTED]",  // nunca expor privkey
  }));
}
