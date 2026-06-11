/**
 * VolatusCanary — Watermarking Rastreável em Cada Resposta de API
 *
 * CONCEITO ORIGINAL:
 *   "Canary token" vem da mineração de carvão: canários eram levados às minas
 *   porque morriam com CO₂ antes dos humanos — um alerta antecipado de perigo.
 *   Aqui, cada token é um "canário digital" — silencioso até ser acionado no
 *   lugar errado.
 *
 * PROBLEMA QUE RESOLVE:
 *   Hoje, se um atacante exfiltra dados da API, você nunca sabe QUAL request
 *   vazou QUAIS dados, para QUAL IP, em QUAL sessão. Os dados aparecem num
 *   fórum de venda, num repositório público, num scraper — e não há como
 *   traçar a origem.
 *
 * A SOLUÇÃO — WATERMARK INVISÍVEL POR REQUEST:
 *   Cada resposta de API recebe um token único no header X-Volatus-Trace.
 *   O token é HMAC-SHA256(secret, ip+session+endpoint+reqId+ts) — curto (16 chars),
 *   opaco (parece um hash genérico), mas internamente mapeia para metadados completos.
 *
 * COMO A DETECÇÃO FUNCIONA:
 *   1. Atacante recebe resposta com X-Volatus-Trace: abc123def456...
 *   2. Dados exfiltrados incluem o header (curl, log, screenshot, API replay)
 *   3. Atacante (ou ferramenta automática) chama GET /api/canary/hit/abc123def456
 *      OU inclui o token em requests subsequentes via X-Volatus-Trace header
 *   4. Sistema detecta: "token abc123 foi emitido para IP 1.2.3.4 sessão X,
 *      mas agora está sendo apresentado de IP 5.6.7.8 sessão Y"
 *   5. EXFILTRAÇÃO DETECTADA → score do IP original aumenta + sinal no threat engine
 *
 * VALOR FORENSE:
 *   Mesmo sem detecção em tempo real, se dados aparecerem vazados na internet:
 *   → Analista inclui o token no relatório de incidente
 *   → POST /api/canary/report {token: "abc123"} → resposta imediata:
 *     "Token emitido em 2026-04-10T22:16:08Z para IP 203.0.113.1, endpoint /api/files,
 *      sessão sess_abc, User-Agent Mozilla/5.0 (Kali Linux)"
 *   Identifica exatamente quem, quando, de onde.
 *
 * DETECÇÃO CROSS-SESSION:
 *   Se token da sessão A aparecer numa requisição da sessão B:
 *   → Indica session sharing ou token theft entre atacantes
 *   → Ambas as sessões são sinalizadas
 *
 * INTEGRAÇÃO COM SISTEMA EXISTENTE:
 *   Quando canary dispara com IP diferente → trackCanaryHit(ip) → PoW dificuldade max
 */

import { createHmac, randomBytes } from "crypto";
import { recordThreatEvent } from "./threat-engine-stub.js";
import { trackCanaryHit } from "./threat-engine-stub.js";

/* ─── Configuração ─── */
const HMAC_SECRET   = randomBytes(32).toString("hex");  // rotaciona por restart
const TOKEN_TTL_MS  = 24 * 60 * 60_000;  // tokens ficam no registry por 24h
const MAX_REGISTRY  = 100_000;            // máximo de tokens em memória

/* ─── Tipos ─── */
export interface CanaryToken {
  token:       string;
  issuedAt:    number;
  ip:          string;
  sessionId:   string | null;
  endpoint:    string;
  method:      string;
  userAgent:   string;
  reqId:       string;
  fired:       boolean;
  firedAt?:    number;
  firedFromIp?: string;
  firedFromSession?: string;
}

export interface CanaryHitResult {
  detected:      boolean;
  crossIp:       boolean;   // token apresentado de IP diferente do original
  crossSession:  boolean;   // token de sessão diferente
  original:      Omit<CanaryToken, "token">;
  threatLevel:   "none" | "suspicious" | "exfiltration";
}

/* ─── Estado in-memory ─── */
const registry = new Map<string, CanaryToken>();
let _issued    = 0;
let _fired     = 0;
let _crossIp   = 0;
let _exfiltrations = 0;

/* ─── Limpeza periódica ─── */
setInterval(() => {
  const now  = Date.now();
  let pruned = 0;
  for (const [k, t] of registry) {
    if (now - t.issuedAt > TOKEN_TTL_MS) { registry.delete(k); pruned++; }
  }
  // Se ainda muito grande, remove os mais antigos
  if (registry.size > MAX_REGISTRY) {
    const sorted = [...registry.entries()].sort(([,a],[,b]) => a.issuedAt - b.issuedAt);
    sorted.slice(0, registry.size - MAX_REGISTRY).forEach(([k]) => registry.delete(k));
  }
}, 5 * 60_000);

/* ════════════════════════════════════════════════════
   API PÚBLICA
════════════════════════════════════════════════════ */

/**
 * Emite um token canary para um request específico.
 * Chamado pelo middleware de resposta.
 */
export function issueCanaryToken(
  ip:        string,
  sessionId: string | null,
  endpoint:  string,
  method:    string,
  userAgent: string,
  reqId:     string,
): string {
  const ts      = Date.now();
  const payload = `${ip}|${sessionId ?? "anon"}|${endpoint}|${reqId}|${ts}`;
  const token   = createHmac("sha256", HMAC_SECRET)
    .update(payload)
    .digest("hex")
    .slice(0, 20);   // 20 chars hex — parece hash genérico, curto o suficiente

  const canary: CanaryToken = {
    token,
    issuedAt:  ts,
    ip,
    sessionId,
    endpoint,
    method,
    userAgent: userAgent.slice(0, 200),
    reqId,
    fired:     false,
  };

  registry.set(token, canary);
  _issued++;
  return token;
}

/**
 * Processa um canary hit — token apresentado de volta ao sistema.
 * Chamado quando alguém acessa GET /api/canary/hit/:token.
 */
export function processCanaryHit(
  token:          string,
  fromIp:         string,
  fromSessionId:  string | null,
): CanaryHitResult | null {
  const canary = registry.get(token);
  if (!canary) return null;

  canary.fired           = true;
  canary.firedAt         = Date.now();
  canary.firedFromIp     = fromIp;
  canary.firedFromSession = fromSessionId ?? undefined;
  _fired++;

  const crossIp      = canary.ip !== fromIp;
  const crossSession = !!(canary.sessionId && fromSessionId && canary.sessionId !== fromSessionId);

  let threatLevel: CanaryHitResult["threatLevel"] = "none";

  if (crossIp) {
    _crossIp++;
    // Token emitido para IP X, apresentado de IP Y = exfiltração
    threatLevel = "exfiltration";
    _exfiltrations++;

    // Sinaliza AMBOS os IPs no threat engine
    recordThreatEvent(canary.ip,  "canary_token_hit");    // IP que recebeu os dados
    recordThreatEvent(fromIp,     "canary_token_hit");    // IP que está usando os dados
    trackCanaryHit(fromIp);                               // PoW máximo para este IP

    console.warn(
      `[volatus-canary] ⚠️  EXFILTRAÇÃO DETECTADA — token ${token}\n` +
      `  Emitido:   IP ${canary.ip} · sessão ${canary.sessionId ?? "anon"} · ${canary.endpoint}\n` +
      `  Apresentado: IP ${fromIp} · sessão ${fromSessionId ?? "anon"}`
    );
  } else if (crossSession) {
    // Mesmo IP, sessão diferente — pode ser múltiplas tabs ou token compartilhado
    threatLevel = "suspicious";
    recordThreatEvent(fromIp, "repeated_auth_failure");
  }

  return {
    detected:     true,
    crossIp,
    crossSession,
    original: {
      issuedAt:   canary.issuedAt,
      ip:         canary.ip,
      sessionId:  canary.sessionId,
      endpoint:   canary.endpoint,
      method:     canary.method,
      userAgent:  canary.userAgent,
      reqId:      canary.reqId,
      fired:      canary.fired,
      firedAt:    canary.firedAt,
      firedFromIp: canary.firedFromIp,
      firedFromSession: canary.firedFromSession,
    },
    threatLevel,
  };
}

/**
 * Lookup forense — dado um token, retorna os metadados completos.
 * Usado para investigação de incidentes.
 */
export function lookupCanaryToken(token: string): CanaryToken | null {
  return registry.get(token) ?? null;
}

export function getCanaryStats() {
  const fired = [...registry.values()].filter(t => t.fired);
  return {
    issued:             _issued,
    fired:              _fired,
    crossIpDetections:  _crossIp,
    exfiltrations:      _exfiltrations,
    activeTokens:       registry.size,
    recentExfiltrations: fired
      .filter(t => t.firedFromIp && t.ip !== t.firedFromIp)
      .slice(-10)
      .map(t => ({
        token:         t.token,
        originalIp:    t.ip,
        firedFromIp:   t.firedFromIp,
        endpoint:      t.endpoint,
        issuedAt:      new Date(t.issuedAt).toISOString(),
        firedAt:       t.firedAt ? new Date(t.firedAt).toISOString() : null,
      })),
  };
}

console.log("[volatus-canary] 🐦 Canary Tokens ativos — watermark por request · rastreamento de exfiltração");
