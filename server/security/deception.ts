/**
 * volatus-deception.ts — Deception Token Mesh (Ω-7, Fase 286)
 *
 * Honeytokens 100% proprietários — AWS keys falsas, JWTs, API keys,
 * documentos com tracking invisível, PIX keys, DB credentials,
 * private keys PEM, cartões com Luhn válido.
 *
 * Qualquer toque = alerta CRITICAL imediato + integração XDR
 * Zero terceiros · Zero callback externo · 100% local
 *
 * Arquitetura:
 *   1. Gerador de tokens (Born Rule entropy + UUID v4 proprietário)
 *   2. Registry in-memory (ring buffer 2000 tokens)
 *   3. WAF Sensor — middleware que escaneia todos os requests
 *   4. Alert Engine — alerta CRITICAL com score quântico
 *   5. Correlação por IP (múltiplos hits = amplitude maior)
 */

import { randomBytes, createHmac } from "crypto";

/* ═══════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════ */

export type TokenType =
  | "aws_access_key"     // AKIA... + secret
  | "aws_session_token"  // STS session token
  | "jwt_token"          // Header.Payload.Sig
  | "api_key_generic"    // sk-... / pk-... / key_...
  | "github_token"       // ghp_...
  | "stripe_key"         // sk_live_...
  | "openai_key"         // sk-...
  | "private_key_rsa"    // -----BEGIN RSA PRIVATE KEY-----
  | "private_key_ec"     // -----BEGIN EC PRIVATE KEY-----
  | "db_connection"      // postgresql://...
  | "redis_url"          // redis://:password@...
  | "pix_key"            // UUID PIX
  | "credit_card"        // Luhn válido + CVV + expiry
  | "password"           // Senha realista
  | "canary_document"    // JSON/texto com UUID oculto + URL trap
  | "bearer_token"       // Authorization: Bearer ...
  | "webhook_secret";    // HMAC webhook secret

export interface DeceptionToken {
  id:          string;
  type:        TokenType;
  label:       string;
  value:       string;           // O token em si (o que vai vazar)
  secret?:     string;           // Segredo associado (p/ AWS, etc.)
  document?:   string;           // Conteúdo do documento canary
  trapUrl:     string;           // URL que dispara o alerta se acessada
  triggerKey:  string;           // Padrão a buscar nos requests (substring)
  createdAt:   number;
  expiresAt:   number | null;
  active:      boolean;
  note:        string;
  hits:        number;
  lastHit:     number | null;
  createdBy:   string;
  quantumAmp:  number;           // Amplitude Born Rule (0–1)
  tags:        string[];
}

export interface DeceptionAlert {
  alertId:     string;
  tokenId:     string;
  tokenType:   TokenType;
  tokenLabel:  string;
  ts:          number;
  sourceIp:    string;
  userAgent:   string;
  path:        string;
  method:      string;
  body:        string;           // Trecho do body onde o token apareceu (redatado)
  headers:     Record<string, string>;
  severity:    "CRITICAL";
  quantumScore: number;
  superposition: string;
  hitCount:    number;           // Total de hits neste token
}

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL STATE
═══════════════════════════════════════════════════════════════════ */

const TOKEN_MAX  = 2000;
const ALERT_MAX  = 5000;
const registry   = new Map<string, DeceptionToken>();
const triggerIdx = new Map<string, string>();   // triggerKey → tokenId (busca rápida)
const alerts:  DeceptionAlert[] = [];
let totalHits  = 0;
let totalTokens = 0;

/* ═══════════════════════════════════════════════════════════════════
   1. PROPRIETARY UUID v4 (sem deps externas)
═══════════════════════════════════════════════════════════════════ */

function uuid4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function randB58(len: number): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  return Array.from(randomBytes(len)).map(b => alphabet[b % alphabet.length]).join("");
}

function randAlphaNum(len: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(randomBytes(len)).map(b => alphabet[b % alphabet.length]).join("");
}

function randAlpha(len: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from(randomBytes(len)).map(b => alphabet[b % alphabet.length]).join("");
}

function randNum(len: number): string {
  return Array.from(randomBytes(len)).map(b => b % 10).join("");
}

function randBase64(bytes: number): string {
  return randomBytes(bytes).toString("base64").replace(/\+/g, "+").replace(/\//g, "/").replace(/=/g, "");
}

function randHex(bytes: number): string { return randomBytes(bytes).toString("hex"); }

/* ═══════════════════════════════════════════════════════════════════
   2. LUHN — gerar cartão com dígito verificador válido
═══════════════════════════════════════════════════════════════════ */

function luhnComplete(partial: string): string {
  const pad = partial + "0";
  let sum = 0; let alt = false;
  for (let i = pad.length - 1; i >= 0; i--) {
    let n = parseInt(pad[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  const check = (10 - (sum % 10)) % 10;
  return partial + check.toString();
}

function genCard(): { number: string; cvv: string; expiry: string; brand: string } {
  const prefixes = [
    { p: "4", brand: "Visa", len: 16 },
    { p: "51", brand: "Mastercard", len: 16 },
    { p: "34", brand: "Amex", len: 15 },
    { p: "606282", brand: "Hipercard", len: 16 },
  ];
  const tpl = prefixes[randomBytes(1)[0] % prefixes.length];
  const partial = tpl.p + randNum(tpl.len - tpl.p.length - 1);
  const number  = luhnComplete(partial);
  const cvv     = randNum(tpl.brand === "Amex" ? 4 : 3);
  const month   = String((randomBytes(1)[0] % 12) + 1).padStart(2, "0");
  const year    = String(2026 + (randomBytes(1)[0] % 5)).slice(-2);
  return { number, cvv, expiry: `${month}/${year}`, brand: tpl.brand };
}

/* ═══════════════════════════════════════════════════════════════════
   3. TOKEN GENERATORS
═══════════════════════════════════════════════════════════════════ */

const BASE_URL = "https://volatusshield.com";

function trapUrl(tokenId: string): string {
  return `${BASE_URL}/api/deception/trigger/${tokenId}`;
}

const GENERATORS: Record<TokenType, (id: string, label: string) => Partial<DeceptionToken>> = {
  aws_access_key: (id) => {
    const accessKey = "AKIA" + randAlpha(4) + randAlphaNum(12);
    const secretKey = randBase64(30);
    return {
      value:      accessKey,
      secret:     secretKey,
      triggerKey: accessKey,
      quantumAmp: 1.0,
      document:   `[default]\naws_access_key_id = ${accessKey}\naws_secret_access_key = ${secretKey}\nregion = us-east-1\n# INTERNAL — do not share\n# Ref: ${trapUrl(id)}`,
    };
  },
  aws_session_token: (id) => {
    const token = "FwoGZXIv" + randBase64(120);
    return {
      value: token, triggerKey: token.substring(0, 20),
      quantumAmp: 1.0,
      document: `AWS_SESSION_TOKEN=${token}\n# ${trapUrl(id)}`,
    };
  },
  jwt_token: (id) => {
    const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: uuid4(), iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400 * 30,
      iss: "volatusshield.com",
      jti: id,  // ID do token oculto no JWT (rastreável)
      scope: "admin:read admin:write",
    })).toString("base64url");
    const sig = createHmac("sha256", randomBytes(32)).update(`${header}.${payload}`).digest("base64url");
    const jwt = `${header}.${payload}.${sig}`;
    return { value: jwt, triggerKey: id, quantumAmp: 0.95 };
  },
  api_key_generic: (id) => {
    const key = "key_live_" + randAlphaNum(32) + "_" + id.replace(/-/g, "").slice(0, 8);
    return { value: key, triggerKey: id.replace(/-/g, "").slice(0, 8), quantumAmp: 0.85 };
  },
  github_token: (id) => {
    const token = "ghp_" + randAlphaNum(36);
    return { value: token, triggerKey: token.substring(0, 20), quantumAmp: 0.9 };
  },
  stripe_key: (id) => {
    const key = "sk_live_" + randAlphaNum(48);
    return { value: key, triggerKey: key.substring(0, 24), quantumAmp: 1.0 };
  },
  openai_key: (id) => {
    const key = "sk-" + randAlphaNum(48);
    return { value: key, triggerKey: key.substring(0, 20), quantumAmp: 0.9 };
  },
  private_key_rsa: (id) => {
    const body = randBase64(400).match(/.{1,64}/g)!.join("\n");
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n# ${id}`;
    return { value: pem, triggerKey: id, quantumAmp: 1.0 };
  },
  private_key_ec: (id) => {
    const body = randBase64(120).match(/.{1,64}/g)!.join("\n");
    const pem = `-----BEGIN EC PRIVATE KEY-----\n${body}\n-----END EC PRIVATE KEY-----\n# ${id}`;
    return { value: pem, triggerKey: id, quantumAmp: 1.0 };
  },
  db_connection: (id) => {
    const password = randAlphaNum(24);
    const host     = `db-${randAlpha(4).toLowerCase()}.internal.volatusshield.com`;
    const conn     = `postgresql://volatusadmin:${password}@${host}:5432/volatusdb_prod?sslmode=require`;
    return { value: conn, triggerKey: password, quantumAmp: 1.0 };
  },
  redis_url: (id) => {
    const pass = randAlphaNum(32);
    const url  = `redis://:${pass}@cache.internal.volatusshield.com:6379/0`;
    return { value: url, triggerKey: pass, quantumAmp: 0.8 };
  },
  pix_key: () => {
    const key = uuid4();
    return { value: key, triggerKey: key, quantumAmp: 0.7 };
  },
  credit_card: (id) => {
    const c = genCard();
    const doc = JSON.stringify({
      number: c.number, cvv: c.cvv, expiry: c.expiry, brand: c.brand,
      holder: "VOLATUS SHIELD LTDA", billingId: id,
    }, null, 2);
    return { value: c.number, secret: c.cvv, triggerKey: c.number.replace(/\s/g, ""), quantumAmp: 1.0, document: doc };
  },
  password: (id) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    const pass  = Array.from(randomBytes(20)).map(b => chars[b % chars.length]).join("");
    return { value: pass, triggerKey: pass.substring(0, 8), quantumAmp: 0.8 };
  },
  canary_document: (id) => {
    const trap = trapUrl(id);
    const doc = JSON.stringify({
      _meta: { version: "1.0", checksum: randHex(16), ref: id },
      company: "VolatusShield Tecnologia Ltda",
      internal: "CONFIDENCIAL — Acesso restrito",
      apiEndpoint: `https://api.volatusshield.com`,
      adminToken: randAlphaNum(32),
      dbHost: `db.internal.volatusshield.com`,
      _verify: trap,
      employees: Array.from({ length: 3 }, (_, i) => ({
        id: uuid4(), name: `Colaborador ${i + 1}`, role: "Engenheiro Sênior",
      })),
    }, null, 2);
    return { value: trap, triggerKey: id, document: doc, quantumAmp: 0.75 };
  },
  bearer_token: (id) => {
    const token = randBase64(48);
    return { value: `Bearer ${token}`, triggerKey: token.substring(0, 16), quantumAmp: 0.85 };
  },
  webhook_secret: (id) => {
    const secret = "whsec_" + randBase64(32);
    return { value: secret, triggerKey: secret.substring(0, 20), quantumAmp: 0.8 };
  },
};

const TYPE_LABELS: Record<TokenType, string> = {
  aws_access_key:    "AWS Access Key (AKIA)",
  aws_session_token: "AWS STS Session Token",
  jwt_token:         "JWT Admin Token",
  api_key_generic:   "API Key Genérica",
  github_token:      "GitHub Personal Access Token",
  stripe_key:        "Stripe Live Secret Key",
  openai_key:        "OpenAI API Key",
  private_key_rsa:   "RSA Private Key PEM",
  private_key_ec:    "EC Private Key PEM",
  db_connection:     "PostgreSQL Connection String",
  redis_url:         "Redis URL com Password",
  pix_key:           "Chave PIX (UUID)",
  credit_card:       "Cartão de Crédito (Luhn válido)",
  password:          "Senha de Sistema",
  canary_document:   "Documento Canário com Tracking",
  bearer_token:      "Bearer Token HTTP",
  webhook_secret:    "Webhook Signing Secret",
};

/* ═══════════════════════════════════════════════════════════════════
   4. CREATE TOKEN
═══════════════════════════════════════════════════════════════════ */

export function createDeceptionToken(opts: {
  type:    TokenType;
  label:   string;
  note?:   string;
  ttlDays?: number;
  createdBy?: string;
  tags?:   string[];
}): DeceptionToken {
  const id  = uuid4();
  const gen = GENERATORS[opts.type](id, opts.label);

  const token: DeceptionToken = {
    id,
    type:       opts.type,
    label:      opts.label,
    value:      gen.value ?? "",
    secret:     gen.secret,
    document:   gen.document,
    trapUrl:    trapUrl(id),
    triggerKey: gen.triggerKey ?? id,
    createdAt:  Date.now(),
    expiresAt:  opts.ttlDays ? Date.now() + opts.ttlDays * 86400_000 : null,
    active:     true,
    note:       opts.note ?? "",
    hits:       0,
    lastHit:    null,
    createdBy:  opts.createdBy ?? "admin",
    quantumAmp: gen.quantumAmp ?? 0.8,
    tags:       opts.tags ?? [opts.type],
  };

  // Enforce ring buffer
  if (registry.size >= TOKEN_MAX) {
    const oldest = [...registry.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0][0];
    const removedToken = registry.get(oldest)!;
    triggerIdx.delete(removedToken.triggerKey);
    registry.delete(oldest);
  }

  registry.set(id, token);
  triggerIdx.set(token.triggerKey, id);
  totalTokens++;
  return token;
}

/* ═══════════════════════════════════════════════════════════════════
   5. WAF SENSOR — escaneia requests em busca de deception tokens
═══════════════════════════════════════════════════════════════════ */

import type { Request, Response, NextFunction } from "express";

function redactForAlert(text: string, triggerKey: string): string {
  const idx = text.indexOf(triggerKey);
  if (idx === -1) return text.substring(0, 100);
  const start = Math.max(0, idx - 30);
  const end   = Math.min(text.length, idx + triggerKey.length + 30);
  return `...${text.substring(start, idx)}[HONEY-TOKEN-DETECTED]${text.substring(idx + triggerKey.length, end)}...`;
}

function buildQuantumAlert(token: DeceptionToken, sourceIp: string, userAgent: string, path: string, method: string, body: string, headers: Record<string, string>): DeceptionAlert {
  token.hits++;
  token.lastHit = Date.now();
  totalHits++;

  // Born Rule: mais hits = maior amplitude = maior score
  const hitAmp    = Math.min(1, 0.5 + token.hits * 0.1);
  const raw       = token.quantumAmp * hitAmp;
  const score     = Math.round(Math.min(100, 60 + raw * 40));
  const state     = `${(raw * raw * 100).toFixed(1)}%|CRITICAL⟩ + ${((1 - raw * raw) * 100).toFixed(1)}%|HIGH⟩`;

  const alert: DeceptionAlert = {
    alertId:     uuid4(),
    tokenId:     token.id,
    tokenType:   token.type,
    tokenLabel:  token.label,
    ts:          Date.now(),
    sourceIp,
    userAgent,
    path,
    method,
    body:        redactForAlert(body, token.triggerKey),
    headers,
    severity:    "CRITICAL",
    quantumScore: score,
    superposition: `|ψ_deception⟩ = ${state}`,
    hitCount:    token.hits,
  };

  alerts.unshift(alert);
  if (alerts.length > ALERT_MAX) alerts.pop();
  return alert;
}

export function deceptionWafMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Skip the trigger endpoint itself and deception management endpoints
  if (req.path.startsWith("/api/deception/")) { next(); return; }

  const haystack = [
    req.path,
    JSON.stringify(req.headers).toLowerCase(),
    typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? ""),
    req.query ? JSON.stringify(req.query) : "",
  ].join(" ");

  for (const [triggerKey, tokenId] of triggerIdx.entries()) {
    const token = registry.get(tokenId);
    if (!token || !token.active) continue;
    if (token.expiresAt && token.expiresAt < Date.now()) { token.active = false; continue; }
    if (haystack.includes(triggerKey)) {
      const safeHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") safeHeaders[k] = k.toLowerCase().includes("cookie") ? "[redacted]" : v;
      }
      buildQuantumAlert(
        token,
        (req.headers["x-forwarded-for"] as string ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim(),
        req.headers["user-agent"] ?? "unknown",
        req.path,
        req.method,
        haystack.substring(0, 500),
        safeHeaders,
      );
    }
  }
  next();
}

/* ═══════════════════════════════════════════════════════════════════
   6. MANUAL TRIGGER (endpoint GET /api/deception/trigger/:id)
      Permite que qualquer sistema externo notifique sem auth
═══════════════════════════════════════════════════════════════════ */

export function triggerToken(tokenId: string, meta: { ip: string; ua: string; path: string; method: string; body: string; headers: Record<string, string> }): DeceptionAlert | null {
  const token = registry.get(tokenId);
  if (!token) return null;
  if (!token.active) return null;
  return buildQuantumAlert(token, meta.ip, meta.ua, meta.path, meta.method, meta.body, meta.headers);
}

/* ═══════════════════════════════════════════════════════════════════
   7. QUERY APIS
═══════════════════════════════════════════════════════════════════ */

export function listTokens(opts: { active?: boolean; type?: TokenType; limit?: number } = {}): DeceptionToken[] {
  let result = [...registry.values()];
  if (opts.active !== undefined) result = result.filter(t => t.active === opts.active);
  if (opts.type) result = result.filter(t => t.type === opts.type);
  return result
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, opts.limit ?? 200);
}

export function getToken(id: string): DeceptionToken | undefined { return registry.get(id); }

export function deactivateToken(id: string): boolean {
  const t = registry.get(id);
  if (!t) return false;
  t.active = false;
  triggerIdx.delete(t.triggerKey);
  return true;
}

export function getAlerts(limit = 100): DeceptionAlert[] { return alerts.slice(0, limit); }

export function getDeceptionStats() {
  const types = [...registry.values()].reduce((acc, t) => {
    acc[t.type] = (acc[t.type] ?? 0) + 1; return acc;
  }, {} as Record<string, number>);
  return {
    totalTokens,
    activeTokens:    [...registry.values()].filter(t => t.active).length,
    totalHits,
    totalAlerts:     alerts.length,
    uniqueAttackers: new Set(alerts.map(a => a.sourceIp)).size,
    byType:          types,
    lastAlert:       alerts[0] ?? null,
    version:         "VolatusDeception v1.0 (Ω-7, Fase 286) — 100% local, zero terceiros",
  };
}

export function getAvailableTypes(): { type: TokenType; label: string }[] {
  return (Object.keys(GENERATORS) as TokenType[]).map(t => ({ type: t, label: TYPE_LABELS[t] }));
}

/* ═══════════════════════════════════════════════════════════════════
   8. PRE-SEED — cria tokens de demonstração na inicialização
═══════════════════════════════════════════════════════════════════ */

export function seedDeceptionTokens(): void {
  const seeds: Array<{ type: TokenType; label: string; note: string }> = [
    { type: "aws_access_key",   label: "AWS Prod Backup Key",         note: "Deploy em bucket de backup — rastrear se vazar" },
    { type: "jwt_token",        label: "Admin JWT Token",             note: "Token de sessão admin — nunca deve aparecer em requests" },
    { type: "db_connection",    label: "PostgreSQL Prod Connection",  note: "String de conexão banco principal" },
    { type: "private_key_rsa",  label: "RSA Deploy Key",              note: "Chave de deploy da VPS — qualquer uso é incidente" },
    { type: "canary_document",  label: "Relatório Financeiro Q1",     note: "Documento interno — qualquer acesso externo = vazamento" },
    { type: "github_token",     label: "GitHub CI/CD Token",          note: "Token de automação do pipeline" },
    { type: "stripe_key",       label: "Stripe Live Key (Backup)",    note: "Chave de pagamento de contingência" },
    { type: "credit_card",      label: "Cartão Teste Produção",       note: "Cartão de homologação — Luhn válido, nunca usar em prod real" },
  ];
  for (const s of seeds) {
    createDeceptionToken({ ...s, createdBy: "system-seed", tags: ["seed", s.type] });
  }
}
