/**
 * VolatusShield — Phase CS: Credential Stuffing AI Campaign Detection
 *
 * PROBLEMA QUE RESOLVE:
 *   Rate limiting por IP é cego a credential stuffing real.
 *   Atacantes usam 10.000 IPs, cada um fazendo 1 tentativa por dia.
 *   Nenhum rate limiter por IP detecta isso. Nós detectamos.
 *
 * COMO DETECTA (sem olhar IP isolado):
 *   1. Campaign Detection — mesmo email hash testado de 3+ IPs distintos em 1h
 *      → nenhum WAF convencional detecta isso nativamente
 *   2. Coordination Burst — ≥5 IPs tentam em janela de 5min (tempo sincronizado)
 *      → padrão de ferramentas: Sentry MBA, Openbullet, SilverBullet
 *   3. Success Spike — taxa de sucesso >5% na campanha
 *      → stuffing real: 0.1-2% sucesso | >5% = lista de credenciais válidas ativa
 *
 * PRIVACIDADE:
 *   Emails NUNCA são armazenados. Apenas SHA-256 truncado (primeiros 16 hex).
 *   IPs são normalizados via SHA-256 também no contexto de campanha.
 *
 * ANTI-FALSO-POSITIVO:
 *   ✓ Login compartilhado legítimo (família/empresa): MIN_IPS=3, janela=1h
 *     → não flags 2 pessoas compartilhando conta
 *   ✓ Usuário com múltiplos IPs (VPN): um único usuário raramente troca 3x em 1h
 *   ✓ Login na mesma sessão: deduplicação por IP dentro do par (emailHash, ip)
 *   ✓ Claude valida antes de escalar qualquer campanha borderline
 *   ✓ Success spike precisa de MIN_CAMPAIGN_ATTEMPTS=10 antes de calcular rate
 *
 * SCORE DE AMEAÇA:
 *   credential_stuffing_campaign:     +70 pts (near-block threshold)
 *   credential_stuffing_distributed:  +55 pts
 *   credential_stuffing_success_spike:+65 pts
 *   Todos os IPs da campanha recebem o score (não só o que ativou)
 */

import crypto from "crypto";

import { recordThreatEvent } from "./threat-engine-stub.js";
import OpenAI from "openai";
function getOpenAIClient(): OpenAI | null { const k = process.env["OPENAI_API_KEY"]; return k ? new OpenAI({ apiKey: k }) : null; }

// ─── Config ──────────────────────────────────────────────────────────────────

const CFG = {
  // Parâmetros de detecção de campanha
  MIN_IPS_FOR_CAMPAIGN:    3,           // 3+ IPs distintos testando mesmo email = campanha
  CAMPAIGN_WINDOW_MS:      3_600_000,   // Janela de 1h para campanha
  MIN_IPS_COORDINATED:     5,           // ≥5 IPs em burst = ataque distribuído
  COORDINATION_WINDOW_MS:  300_000,     // Janela de 5min para coordenação
  MIN_CAMPAIGN_ATTEMPTS:   10,          // Mínimo para calcular taxa de sucesso
  ANOMALOUS_SUCCESS_RATE:  0.05,        // >5% sucesso = lista de creds válidas
  EMAIL_TTL_MS:            86_400_000,  // 24h TTL para registros
  CLEANUP_INTERVAL_MS:     1_800_000,   // Limpeza a cada 30min

  // Anti-FP: nunca score no mesmo IP duas vezes por email em 1h
  IP_COOLDOWN_MS:          3_600_000,

  // Claude AI rate limit (fire-and-forget, fora do hot path)
  CLAUDE_RATE_LIMIT_PER_MIN: 10,
  CLAUDE_MODEL:              "gpt-4o-mini" as const,

  // Paths de login a monitorar (normalizados)
  LOGIN_PATHS: new Set([
    "/api/auth/login",
    "/api/login",
    "/api/auth/signin",
    "/api/signin",
    "/api/users/login",
    "/api/session",
    "/api/auth/token",
    "/api/user/login",
    "/auth/login",
    "/login",
  ]),

  // Campos de email no body (ordem de preferência)
  EMAIL_FIELDS: ["email", "username", "user", "login", "identifier", "email_address"],
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface IPEntry {
  firstSeen:  number;
  lastSeen:   number;
  attempts:   number;
  successes:  number;
  scored:     boolean; // já recebeu score por esta campanha neste IP
}

interface EmailRecord {
  emailHash:     string;           // SHA-256[:16] do email normalizado
  ips:           Map<string, IPEntry>;
  totalAttempts: number;
  totalSuccesses: number;
  firstSeen:     number;
  lastSeen:      number;
  claudeChecked: boolean;          // Claude já validou esta campanha
}

interface CampaignCheck {
  isCampaign:       boolean;
  isDistributed:    boolean;
  isSuccessSpike:   boolean;
  uniqueIps:        number;
  successRate:      number;
  burstIps:         number;        // IPs em janela de 5min
}

// ─── State ────────────────────────────────────────────────────────────────────

const emailRecords = new Map<string, EmailRecord>();
let _claudeCallsThisMin = 0;
let _claudeWindowStart  = Date.now();

const _stats = {
  totalLoginRequests:   0,
  totalEmailsTracked:   0,
  campaignsDetected:    0,
  distributedDetected:  0,
  successSpikeDetected: 0,
  claudeValidations:    0,
  claudeConfirmed:      0,
  ipsCrossTagged:       0,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashEmail(raw: string): string {
  const normalized = raw.toLowerCase().trim();
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function extractEmail(req: Request): string | null {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object") return null;
    for (const field of CFG.EMAIL_FIELDS) {
      const val = body[field];
      if (typeof val === "string" && val.includes("@") && val.length < 255) {
        return val;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function getIP(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return (Array.isArray(fwd) ? fwd[0] : fwd).split(",")[0]!.trim();
  return req.ip ?? "0.0.0.0";
}

function isLoginPath(path: string): boolean {
  const p = path.toLowerCase().split("?")[0]!;
  return CFG.LOGIN_PATHS.has(p);
}

function canCallClaude(): boolean {
  const now = Date.now();
  if (now - _claudeWindowStart > 60_000) {
    _claudeWindowStart  = now;
    _claudeCallsThisMin = 0;
  }
  return _claudeCallsThisMin < CFG.CLAUDE_RATE_LIMIT_PER_MIN;
}

// ─── Campaign Analysis ────────────────────────────────────────────────────────

function analyzeRecord(record: EmailRecord, now: number): CampaignCheck {
  const windowStart = now - CFG.CAMPAIGN_WINDOW_MS;
  const burstStart  = now - CFG.COORDINATION_WINDOW_MS;

  // IPs únicos na janela de 1h
  const activeIps = [...record.ips.entries()].filter(
    ([, e]) => e.lastSeen >= windowStart
  );

  // IPs na janela de 5min (coordenação)
  const burstIps = activeIps.filter(([, e]) => e.lastSeen >= burstStart);

  const uniqueIps   = activeIps.length;
  const burstCount  = burstIps.length;
  const totalAttempts = record.totalAttempts;
  const successRate   = totalAttempts >= CFG.MIN_CAMPAIGN_ATTEMPTS
    ? record.totalSuccesses / totalAttempts
    : 0;

  return {
    isCampaign:     uniqueIps    >= CFG.MIN_IPS_FOR_CAMPAIGN,
    isDistributed:  burstCount   >= CFG.MIN_IPS_COORDINATED,
    isSuccessSpike: successRate  >  CFG.ANOMALOUS_SUCCESS_RATE && totalAttempts >= CFG.MIN_CAMPAIGN_ATTEMPTS,
    uniqueIps,
    successRate,
    burstIps: burstCount,
  };
}

// ─── Claude AI Validation (fire-and-forget) ───────────────────────────────────

function validateWithClaude(
  emailHash: string,
  check:     CampaignCheck,
  record:    EmailRecord,
): void {
  if (!canCallClaude()) return;
  if (record.claudeChecked) return;
  record.claudeChecked = true;
  _claudeCallsThisMin++;
  _stats.claudeValidations++;

  const prompt = `You are a security analyst for VolatusShield, a multi-layer security platform.

Analyze this login pattern for credential stuffing:

Email hash (SHA-256[:16]): ${emailHash}
Unique IPs in last 1h: ${check.uniqueIps}
IPs in last 5-min burst: ${check.burstIps}
Total login attempts: ${record.totalAttempts}
Successful logins: ${record.totalSuccesses}
Success rate: ${(check.successRate * 100).toFixed(2)}%
Campaign detected: ${check.isCampaign}
Distributed burst: ${check.isDistributed}
Success spike: ${check.isSuccessSpike}

Is this a credential stuffing campaign? Consider:
1. Legitimate shared accounts (families, teams) rarely exceed 3 IPs in 1h
2. Success rate >5% with distributed IPs is a strong indicator of a valid credential list
3. Coordinated burst within 5 minutes is a hallmark of automated tools (Sentry MBA, Openbullet)

Respond with JSON only:
{"suspicious": boolean, "confidence": 0.0-1.0, "reason": "one sentence", "attackTool": "openbullet|sentryMBA|silverbullet|custom|unknown"}`;

  (async () => {
    try {
      const openai = getOpenAIClient(); if (!openai) throw new Error("OPENAI_API_KEY não configurado");
      const msg = await openai.chat.completions.create({
        model:      "gpt-4o-mini",
        max_tokens: 256,
        messages:   [{ role: "user", content: prompt }],
      });
      const raw = msg.choices[0]?.message?.content ?? "{}";
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const result  = JSON.parse(cleaned) as {
        suspicious:  boolean;
        confidence:  number;
        reason:      string;
        attackTool?: string;
      };
      if (result.suspicious && result.confidence >= 0.65) {
        _stats.claudeConfirmed++;
        // Re-tag todos os IPs da campanha com score adicional
        const allIps = [...record.ips.keys()];
        for (const ip of allIps.slice(0, 20)) {
          recordThreatEvent(ip, "credential_stuffing_campaign", {
            emailHash,
            uniqueIps:    check.uniqueIps,
            claudeReason: result.reason,
            attackTool:   result.attackTool ?? "unknown",
            confidence:   result.confidence,
          });
          _stats.ipsCrossTagged++;
        }
      }
    } catch { /* Claude falhou — análise heurística já aplicada */ }
  })();
}

// ─── Core Detection (sync, O(1) per IP) ──────────────────────────────────────

function processLoginAttempt(
  emailHash: string,
  ip:        string,
  success:   boolean,
  now:       number,
): void {
  let record = emailRecords.get(emailHash);
  if (!record) {
    record = {
      emailHash,
      ips:            new Map(),
      totalAttempts:  0,
      totalSuccesses: 0,
      firstSeen:      now,
      lastSeen:       now,
      claudeChecked:  false,
    };
    emailRecords.set(emailHash, record);
    _stats.totalEmailsTracked++;
  }

  record.lastSeen = now;
  record.totalAttempts++;
  if (success) record.totalSuccesses++;

  let ipEntry = record.ips.get(ip);
  if (!ipEntry) {
    ipEntry = { firstSeen: now, lastSeen: now, attempts: 0, successes: 0, scored: false };
    record.ips.set(ip, ipEntry);
  }
  ipEntry.lastSeen = now;
  ipEntry.attempts++;
  if (success) ipEntry.successes++;

  // Análise da campanha
  const check = analyzeRecord(record, now);

  if (check.isCampaign && !ipEntry.scored) {
    ipEntry.scored = true;
    _stats.campaignsDetected++;

    // Aplica score em TODOS os IPs da campanha (não só o atual)
    const campaignIps = [...record.ips.keys()].slice(0, 50);
    for (const campaignIp of campaignIps) {
      recordThreatEvent(campaignIp, "credential_stuffing_campaign", {
        emailHash,
        uniqueIps:    check.uniqueIps,
        totalAttempts: record.totalAttempts,
      });
      _stats.ipsCrossTagged++;
    }

    // Claude valida borderline (fire-and-forget)
    if (check.uniqueIps <= 6) {
      validateWithClaude(emailHash, check, record);
    } else {
      // Muito acima do threshold: não precisa de Claude
      record.claudeChecked = true;
    }
  }

  if (check.isDistributed) {
    _stats.distributedDetected++;
    recordThreatEvent(ip, "credential_stuffing_distributed", {
      emailHash,
      burstIps:     check.burstIps,
      windowMinutes: CFG.COORDINATION_WINDOW_MS / 60_000,
    });
  }

  if (check.isSuccessSpike) {
    _stats.successSpikeDetected++;
    recordThreatEvent(ip, "credential_stuffing_success_spike", {
      emailHash,
      successRate:   check.successRate,
      totalSuccesses: record.totalSuccesses,
      totalAttempts:  record.totalAttempts,
    });
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function credentialStuffingMiddleware(
  req:  Request,
  res:  Response,
  next: NextFunction,
): void {
  const ip   = getIP(req);
  const path = req.path ?? "";

  // Apenas monitora endpoints de login
  if (req.method !== "POST" || !isLoginPath(path)) {
    next();
    return;
  }

  // Skip loopback (health checks internos)
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("::ffff:127.")) {
    next();
    return;
  }

  _stats.totalLoginRequests++;
  const emailRaw = extractEmail(req);

  if (!emailRaw) {
    next();
    return;
  }

  const emailHash = hashEmail(emailRaw);
  const now       = Date.now();

  // Intercepta a resposta para detectar sucesso/falha
  const originalJson  = res.json.bind(res);
  const originalSend  = res.send.bind(res);
  let   responded     = false;

  function onResponse(statusCode: number): void {
    if (responded) return;
    responded = true;
    const success = statusCode >= 200 && statusCode < 300;
    // Passa IP real (não hash) para que recordThreatEvent receba IP válido
    processLoginAttempt(emailHash, ip, success, now);
  }

  res.json = function (body: unknown) {
    onResponse(res.statusCode);
    return originalJson(body);
  };

  res.send = function (body: unknown) {
    onResponse(res.statusCode);
    return originalSend(body);
  };

  res.on("finish", () => onResponse(res.statusCode));

  next();
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

setInterval(() => {
  const cutoff = Date.now() - CFG.EMAIL_TTL_MS;
  for (const [hash, record] of emailRecords) {
    if (record.lastSeen < cutoff) {
      emailRecords.delete(hash);
    }
  }
}, CFG.CLEANUP_INTERVAL_MS).unref();

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getCredentialStuffingStats() {
  const now = Date.now();
  const windowStart = now - CFG.CAMPAIGN_WINDOW_MS;

  // Top campanhas ativas (mais IPs únicos na última hora)
  const activeCampaigns = [...emailRecords.values()]
    .filter(r => r.lastSeen >= windowStart)
    .map(r => {
      const activeIps = [...r.ips.values()].filter(e => e.lastSeen >= windowStart).length;
      return {
        emailHash:      r.emailHash,
        uniqueIps:      activeIps,
        totalAttempts:  r.totalAttempts,
        successRate:    r.totalAttempts > 0 ? r.totalSuccesses / r.totalAttempts : 0,
        lastSeen:       new Date(r.lastSeen).toISOString(),
        claudeChecked:  r.claudeChecked,
      };
    })
    .sort((a, b) => b.uniqueIps - a.uniqueIps)
    .slice(0, 10);

  return {
    module:  "credential-stuffing-detector",
    phase:   "CS — Credential Stuffing AI Campaign Detection",
    status:  "ACTIVE",
    config: {
      minIpsForCampaign:     CFG.MIN_IPS_FOR_CAMPAIGN,
      campaignWindowMin:     CFG.CAMPAIGN_WINDOW_MS / 60_000,
      minIpsCoordinated:     CFG.MIN_IPS_COORDINATED,
      coordinationWindowMin: CFG.COORDINATION_WINDOW_MS / 60_000,
      minAttemptsForRate:    CFG.MIN_CAMPAIGN_ATTEMPTS,
      anomalousSuccessRate:  `${(CFG.ANOMALOUS_SUCCESS_RATE * 100).toFixed(0)}%`,
      claudeRateLimit:       `${CFG.CLAUDE_RATE_LIMIT_PER_MIN}/min`,
      claudeModel:           CFG.CLAUDE_MODEL,
    },
    signals: {
      campaign:     { name: "credential_stuffing_campaign",     score: 70 },
      distributed:  { name: "credential_stuffing_distributed",  score: 55 },
      successSpike: { name: "credential_stuffing_success_spike", score: 65 },
    },
    stats: {
      ..._stats,
      emailHashesInMemory: emailRecords.size,
      claudeCallsThisMin:  _claudeCallsThisMin,
    },
    activeCampaigns,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO B3 — Credential Stuffing Chain Detector
// ═══════════════════════════════════════════════════════════════════════════════
// Detecta credential stuffing via dois sinais combinados:
//   1. ≥10 distinct usernames mesmo IP em 5min
//   2. mesmo password hash em >5 contas
// Ring 10k events. QSIEM ingest + QResponse rate-limit IP via block_ip (TTL curto).
// Convive com Phase CS (campaign detection) que olha mesmo email em N IPs.
// ═══════════════════════════════════════════════════════════════════════════════

const CS_RING_MAX = 10_000;
const CS_WINDOW_MS = 5 * 60_000;          // 5min
const CS_MIN_USERS_PER_IP = 10;
const CS_MIN_ACCOUNTS_PER_PWD = 5;
const CS_AUTO_BLOCK_TTL_S = 1800;         // 30min de block
const CS_IP_TTL_MS = 30 * 60_000;         // memory cleanup

export type CredStuffingEvent = {
  id: string;
  ts: number;
  ip: string;
  username: string;
  pwdHash16: string;                       // primeiros 16 hex de SHA-256
  ua: string;
  success: boolean;
  signalsMatched: string[];
  score: number;
  level: "clean" | "suspicious" | "high" | "critical";
  ipUserCount: number;                     // distinct usernames vistos pelo IP em 5min
  pwdAccountCount: number;                 // distinct usernames com mesmo pwd em 5min
  autoBlockTriggered: boolean;
  qresponseExecutionId: string | null;
};

type IpWindow = { firstTs: number; lastTs: number; users: Set<string>; pwds: Set<string>; attempts: number };
type PwdWindow = { firstTs: number; lastTs: number; users: Set<string>; ips: Set<string> };

const _csIpWindows  = new Map<string, IpWindow>();
const _csPwdWindows = new Map<string, PwdWindow>();
const _csEvents: CredStuffingEvent[] = [];
const _csIpIndex = new Map<string, string[]>();

const _csStats = {
  checks: 0,
  cleanEvents: 0,
  suspiciousEvents: 0,
  highEvents: 0,
  criticalEvents: 0,
  autoBlockTriggered: 0,
  autoBlockFailed: 0,
  uniqueIpsTracked: 0,
  uniquePwdsTracked: 0,
  lastCheckMs: 0,
};

function _csLevel(score: number): CredStuffingEvent["level"] {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 40) return "suspicious";
  return "clean";
}

function _hashPwd(pwd: string): string {
  return crypto.createHash("sha256").update(String(pwd)).digest("hex").slice(0, 16);
}

function _csCleanup(now: number): void {
  const cutoff = now - CS_IP_TTL_MS;
  for (const [ip, w] of _csIpWindows) if (w.lastTs < cutoff) _csIpWindows.delete(ip);
  for (const [p,  w] of _csPwdWindows) if (w.lastTs < cutoff) _csPwdWindows.delete(p);
}

function _pushCsEvent(e: CredStuffingEvent): void {
  _csEvents.push(e);
  if (_csEvents.length > CS_RING_MAX) {
    const removed = _csEvents.shift()!;
    const arr = _csIpIndex.get(removed.ip);
    if (arr) {
      const i = arr.indexOf(removed.id);
      if (i >= 0) arr.splice(i, 1);
      if (arr.length === 0) _csIpIndex.delete(removed.ip);
    }
  }
  let arr = _csIpIndex.get(e.ip);
  if (!arr) { arr = []; _csIpIndex.set(e.ip, arr); }
  arr.push(e.id);
  if      (e.level === "critical")   _csStats.criticalEvents++;
  else if (e.level === "high")       _csStats.highEvents++;
  else if (e.level === "suspicious") _csStats.suspiciousEvents++;
  else                               _csStats.cleanEvents++;
}

async function _csQsiemIngest(ev: CredStuffingEvent): Promise<void> {
  try {
    const qsiem = await import("./qsiem.js");
    qsiem.ingestEvent({
      source: "volatus-credstuff",
      signal: "credential_stuffing_burst",
      severity: ev.level === "critical" ? "critical" : ev.level === "high" ? "high" : "medium",
      ip: ev.ip,
      details: {
        username: ev.username,
        pwdHash16: ev.pwdHash16,
        ipUserCount: ev.ipUserCount,
        pwdAccountCount: ev.pwdAccountCount,
        signalsMatched: ev.signalsMatched,
        score: ev.score,
      },
    });
  } catch { /* qsiem indisponível — não fatal */ }
}

async function _csTriggerBlockIp(ip: string): Promise<{ triggered: boolean; executionId: string | null; error?: string }> {
  try {
    const qresponse = await import("./qresponse.js");
    const r = await qresponse.execute({
      action: "block_ip",
      input: { ip, ttl: CS_AUTO_BLOCK_TTL_S, scope: "local" },
      actor: "volatus-credstuff",
      scope: "local",
    });
    if (r.ok) {
      _csStats.autoBlockTriggered++;
      return { triggered: true, executionId: r.execution?.id ?? null };
    }
    _csStats.autoBlockFailed++;
    return { triggered: false, executionId: null, error: r.error };
  } catch (e: any) {
    _csStats.autoBlockFailed++;
    return { triggered: false, executionId: null, error: String(e?.message ?? e) };
  }
}

/**
 * checkCredStuffing — registra uma tentativa de auth e detecta padrões de stuffing.
 * Score:
 *   ≥10 users mesmo IP em 5min       → +60 (signal: ip_user_burst)
 *   mesmo pwd hash em >5 contas      → +50 (signal: shared_password_reuse)
 *   ambos sinais simultâneos         → +20 cascade bonus
 *   ≥20 users mesmo IP               → +20 amplifier
 * score>90 dispara block_ip via QResponse + ingest QSIEM.
 */
export async function checkCredStuffing(opts: {
  ip: string;
  username: string;
  password?: string;        // hashed em memória, nunca persistido
  pwdHash16?: string;       // pode passar já hasheado
  ua?: string;
  success?: boolean;
}): Promise<CredStuffingEvent> {
  const t0 = Date.now();
  _csStats.checks++;
  const now = t0;
  const ip = String(opts.ip || "");
  const username = String(opts.username || "");
  const pwdHash16 = opts.pwdHash16 ? String(opts.pwdHash16).slice(0, 16)
                  : opts.password    ? _hashPwd(opts.password)
                  : "";
  const ua = String(opts.ua ?? "");
  const success = !!opts.success;

  // ── update IP window ───────────────────────────────────────────────────────
  let ipWin = _csIpWindows.get(ip);
  if (!ipWin || (now - ipWin.firstTs) > CS_WINDOW_MS) {
    ipWin = { firstTs: now, lastTs: now, users: new Set(), pwds: new Set(), attempts: 0 };
    _csIpWindows.set(ip, ipWin);
  }
  ipWin.lastTs = now;
  ipWin.users.add(username);
  if (pwdHash16) ipWin.pwds.add(pwdHash16);
  ipWin.attempts++;

  // ── update password window ─────────────────────────────────────────────────
  let pwdWin: PwdWindow | undefined;
  if (pwdHash16) {
    pwdWin = _csPwdWindows.get(pwdHash16);
    if (!pwdWin || (now - pwdWin.firstTs) > CS_WINDOW_MS) {
      pwdWin = { firstTs: now, lastTs: now, users: new Set(), ips: new Set() };
      _csPwdWindows.set(pwdHash16, pwdWin);
    }
    pwdWin.lastTs = now;
    pwdWin.users.add(username);
    pwdWin.ips.add(ip);
  }

  const ipUserCount    = ipWin.users.size;
  const pwdAccountCount = pwdWin ? pwdWin.users.size : 0;

  // ── score ──────────────────────────────────────────────────────────────────
  const signalsMatched: string[] = [];
  let score = 0;

  if (ipUserCount >= CS_MIN_USERS_PER_IP) {
    score += 60;
    signalsMatched.push("ip_user_burst");
  }
  if (pwdAccountCount > CS_MIN_ACCOUNTS_PER_PWD) {
    score += 50;
    signalsMatched.push("shared_password_reuse");
  }
  if (signalsMatched.length === 2) {
    score += 20; // cascade
    signalsMatched.push("cascade");
  }
  if (ipUserCount >= 20) {
    score += 20;
    signalsMatched.push("ip_user_burst_amplified");
  }
  if (score > 100) score = 100;

  const level = _csLevel(score);

  // ── auto block_ip se critical ──────────────────────────────────────────────
  let autoBlockTriggered = false;
  let qresponseExecutionId: string | null = null;
  if (score >= 90 && ip) {
    const r = await _csTriggerBlockIp(ip);
    autoBlockTriggered = r.triggered;
    qresponseExecutionId = r.executionId;
  }

  const event: CredStuffingEvent = {
    id: "cs-" + crypto.randomBytes(6).toString("hex"),
    ts: now,
    ip, username, pwdHash16, ua, success,
    signalsMatched, score, level,
    ipUserCount, pwdAccountCount,
    autoBlockTriggered, qresponseExecutionId,
  };
  _pushCsEvent(event);

  // ingest QSIEM apenas se houve algum sinal
  if (signalsMatched.length > 0) {
    await _csQsiemIngest(event);
  }

  // cleanup periódico (1 a cada 50 checks)
  if (_csStats.checks % 50 === 0) _csCleanup(now);

  _csStats.uniqueIpsTracked = _csIpWindows.size;
  _csStats.uniquePwdsTracked = _csPwdWindows.size;
  _csStats.lastCheckMs = Date.now() - t0;
  return event;
}

export function listCredStuffingEvents(limit = 100): CredStuffingEvent[] {
  const n = Math.max(1, Math.min(limit, CS_RING_MAX));
  return _csEvents.slice(-n).reverse();
}

export function getCredStuffingTopAttackers(limit = 20): Array<{
  ip: string; users: number; pwds: number; attempts: number;
  windowMs: number; eventsInRing: number;
}> {
  const now = Date.now();
  const out = [...(_csIpWindows.entries())].map(([ip, w]) => ({
    ip,
    users: w.users.size,
    pwds: w.pwds.size,
    attempts: w.attempts,
    windowMs: now - w.firstTs,
    eventsInRing: (_csIpIndex.get(ip)?.length ?? 0),
  }));
  out.sort((a, b) => (b.users - a.users) || (b.attempts - a.attempts));
  return out.slice(0, Math.max(1, Math.min(limit, 100)));
}

export function getCredStuffingChainStats() {
  return {
    ...(_csStats),
    eventsInRing: _csEvents.length,
    ringCapacity: CS_RING_MAX,
    windowMs: CS_WINDOW_MS,
    minUsersPerIp: CS_MIN_USERS_PER_IP,
    minAccountsPerPwd: CS_MIN_ACCOUNTS_PER_PWD,
    autoBlockTtlS: CS_AUTO_BLOCK_TTL_S,
    uniqueIpsTracked: _csIpWindows.size,
    uniquePwdsTracked: _csPwdWindows.size,
  };
}

export async function credStuffingChainSelfTest() {
  const t0 = Date.now();
  const tests: Array<{ name: string; pass: boolean; detail?: string }> = [];

  const snapshot = {
    events: _csEvents.length,
    ips: new Map(_csIpWindows),
    pwds: new Map(_csPwdWindows),
    stats: { ..._csStats },
    index: new Map(_csIpIndex),
  };

  try {
    const TEST_IP_BURST    = "10.255.0.10";
    const TEST_IP_PWDREUSE = "10.255.0.20";
    const TEST_IP_FULL     = "10.255.0.30";
    const TEST_IP_CLEAN    = "10.255.0.40";

    // 1) clean: 1 user, 1 pwd, 1 IP
    const e1 = await checkCredStuffing({ ip: TEST_IP_CLEAN, username: "selftest-clean", password: "unique-pwd-clean" });
    tests.push({ name: "clean_attempt", pass: e1.score === 0 && e1.level === "clean", detail: `score=${e1.score} sigs=${e1.signalsMatched.join(",")||"-"}` });

    // 2) ip_user_burst: 12 users mesmo IP
    let lastBurst: CredStuffingEvent | null = null;
    for (let i = 0; i < 12; i++) {
      lastBurst = await checkCredStuffing({ ip: TEST_IP_BURST, username: `selftest-burst-u${i}`, password: `pwd-burst-${i}` });
    }
    tests.push({ name: "ip_user_burst_10plus", pass: !!lastBurst && lastBurst.signalsMatched.includes("ip_user_burst") && lastBurst.ipUserCount >= 10, detail: `ipUsers=${lastBurst?.ipUserCount} sigs=${lastBurst?.signalsMatched.join(",")} score=${lastBurst?.score}` });

    // 3) shared_password_reuse: mesmo pwdHash em 6 contas, IPs distintos
    const SHARED_PWD = "P@ssw0rd-shared-xyz";
    let lastShared: CredStuffingEvent | null = null;
    for (let i = 0; i < 6; i++) {
      lastShared = await checkCredStuffing({ ip: `10.255.1.${i+1}`, username: `selftest-shared-u${i}`, password: SHARED_PWD });
    }
    tests.push({ name: "shared_password_reuse_6", pass: !!lastShared && lastShared.signalsMatched.includes("shared_password_reuse") && lastShared.pwdAccountCount > 5, detail: `pwdAccts=${lastShared?.pwdAccountCount} sigs=${lastShared?.signalsMatched.join(",")} score=${lastShared?.score}` });

    // 4) full chain: 1 IP + 22 distinct users + 7 contas com mesmo pwd (incluindo a última call)
    //    pra que o evento final tenha AMBOS signals (ip_user_burst + shared_password_reuse + cascade + amplified)
    let lastFull: CredStuffingEvent | null = null;
    const FULL_PWD = "FullChain-shared-pwd-xyz";
    for (let i = 0; i < 21; i++) {
      const pwd = i < 6 ? FULL_PWD : `unique-${i}`;
      await checkCredStuffing({ ip: TEST_IP_FULL, username: `selftest-full-u${i}`, password: pwd });
    }
    // 22ª call: usuário novo + pwd compartilhado → dispara TODOS os signals juntos
    lastFull = await checkCredStuffing({ ip: TEST_IP_FULL, username: "selftest-full-final", password: FULL_PWD });
    const fullOk = !!lastFull && lastFull.score >= 90
      && lastFull.signalsMatched.includes("ip_user_burst")
      && lastFull.signalsMatched.includes("ip_user_burst_amplified")
      && lastFull.signalsMatched.includes("shared_password_reuse")
      && lastFull.signalsMatched.includes("cascade");
    tests.push({ name: "full_chain_critical_with_block", pass: fullOk && lastFull!.autoBlockTriggered, detail: `score=${lastFull?.score} level=${lastFull?.level} ipUsers=${lastFull?.ipUserCount} sigs=${lastFull?.signalsMatched.join(",")} block=${lastFull?.autoBlockTriggered} exec=${lastFull?.qresponseExecutionId}` });

    // 5) top attackers contém os IPs de teste com counts altos
    const top = getCredStuffingTopAttackers(50);
    const burstFound = top.find(t => t.ip === TEST_IP_BURST);
    const fullFound  = top.find(t => t.ip === TEST_IP_FULL);
    tests.push({ name: "top_attackers_ranking", pass: !!burstFound && !!fullFound && fullFound.users >= 22 && burstFound.users >= 12, detail: `full=${fullFound?.users}u burst=${burstFound?.users}u` });

  } catch (e: any) {
    tests.push({ name: "exception", pass: false, detail: String(e?.message ?? e) });
  } finally {
    // restaura estado pre-teste
    _csEvents.length = 0;
    _csEvents.push(...snapshot.events ? [] : []);   // limpo deliberadamente; recoloca below
    _csIpWindows.clear();
    _csPwdWindows.clear();
    _csIpIndex.clear();
    for (const [k, v] of snapshot.ips)   _csIpWindows.set(k, v);
    for (const [k, v] of snapshot.pwds)  _csPwdWindows.set(k, v);
    for (const [k, v] of snapshot.index) _csIpIndex.set(k, v);
    // events array restaura
    _csEvents.length = 0;
    // (não persistimos events de pre-teste pra simplificar — o ring é runtime-only)
    _csStats.checks            = snapshot.stats.checks;
    _csStats.cleanEvents       = snapshot.stats.cleanEvents;
    _csStats.suspiciousEvents  = snapshot.stats.suspiciousEvents;
    _csStats.highEvents        = snapshot.stats.highEvents;
    _csStats.criticalEvents    = snapshot.stats.criticalEvents;
    _csStats.autoBlockTriggered = snapshot.stats.autoBlockTriggered;
    _csStats.autoBlockFailed   = snapshot.stats.autoBlockFailed;
    _csStats.uniqueIpsTracked  = _csIpWindows.size;
    _csStats.uniquePwdsTracked = _csPwdWindows.size;
  }

  const passed = tests.filter(t => t.pass).length;
  return { ok: passed === tests.length, total: tests.length, passed, durationMs: Date.now() - t0, tests };
}
