/**
 * VolatusShield — Phase ATO: Account Takeover AI
 *
 * PROBLEMA QUE RESOLVE:
 *   Biometria comportamental (Phase 25-B) monitora a sessão ATIVA.
 *   Mas e quando o atacante usa as credenciais corretas em um novo
 *   dispositivo, de outra cidade, às 3am?
 *   Rate limiting não bloqueia — é 1 login, do IP "limpo" do atacante.
 *   Geo-blocking não funciona — o usuário pode ter viajado.
 *   Credential Stuffing detector não viu — foi 1 tentativa bem-sucedida.
 *
 *   Este módulo compara o comportamento HISTÓRICO da conta com o momento
 *   atual e detecta "esse usuário mudou 180 graus" — comprometimento real.
 *
 * DIMENSÕES ANALISADAS:
 *   1. Geográfica  — IP /16 prefix nunca visto nesta conta
 *   2. Temporal    — horário completamente fora do padrão histórico
 *   3. Browser/UA  — fingerprint de browser nunca usado por esta conta
 *   4. Infra       — primeiro login via VPS/datacenter quando sempre foi residencial
 *   5. Viagem impossível — mesmo usuário em 2 locais em <2h
 *
 * DIFERENCIAL vs Módulos Existentes:
 *   - Phase 25-B (UEBA): analisa comportamento dentro da sessão ativa
 *   - Phase CS (Stuffing): analisa padrões cross-IP para mesmo email
 *   - Phase ATO (este): compara baseline histórico DA CONTA vs sessão atual
 *     → detecta comprometimento mesmo com IP limpo, 1 tentativa, UA válido
 *
 * ANTI-FALSO-POSITIVO:
 *   ✓ Cold-start: mínimo 5 logins históricos antes de ativar
 *   ✓ Viagem: só impossible_travel se prefixo diferente E tempo < 2h
 *   ✓ VPN: usuário com >30% VPS histórico não é penalizado por VPS
 *   ✓ Horário: buffer ±2h ao redor da faixa típica
 *   ✓ Claude valida antes de escalar (fire-and-forget)
 *   ✓ Max 1 ATO flag por conta em 24h
 *   ✓ Nunca bloqueia — score apenas (decisão fica com o threat-engine)
 *
 * SCORE:
 *   ato_behavioral_deviation:  +75 pts
 *   ato_impossible_travel:     +80 pts
 */

import crypto from "crypto";

import { recordThreatEvent } from "./threat-engine-stub.js";
import OpenAI from "openai";
function getOpenAIClient(): OpenAI | null { const k = process.env["OPENAI_API_KEY"]; return k ? new OpenAI({ apiKey: k }) : null; }

// ─── Config ──────────────────────────────────────────────────────────────────

const CFG = {
  MIN_LOGINS_FOR_BASELINE:  5,            // precisa de 5 logins históricos para ativar
  MAX_HISTORY_PER_USER:     100,          // mantém até 100 logins por conta
  DEVIATION_THRESHOLD:      0.70,         // compound deviation >70% = suspeito
  IMPOSSIBLE_TRAVEL_HOURS:  2,            // <2h entre locais distintos = impossível
  HOUR_BUFFER:              2,            // ±2h de tolerância no horário típico
  VPS_RATIO_EXEMPT:         0.30,         // >30% logins VPS históricos → não penaliza VPS
  ATO_COOLDOWN_MS:          86_400_000,   // 1 flag ATO por conta a cada 24h
  USER_TTL_MS:              2_592_000_000, // 30 dias de histórico
  CLEANUP_INTERVAL_MS:      3_600_000,    // limpeza a cada 1h

  CLAUDE_MODEL:             "gpt-4o-mini" as const,
  CLAUDE_RATE_LIMIT:        10,           // calls/min (fire-and-forget)

  // Pesos no desvio composto (somam 1.0)
  WEIGHT_GEO:   0.40,
  WEIGHT_TIME:  0.25,
  WEIGHT_UA:    0.25,
  WEIGHT_VPS:   0.10,

  LOGIN_PATHS: new Set([
    "/api/auth/login", "/api/login", "/api/auth/signin", "/api/signin",
    "/api/users/login", "/api/session", "/api/auth/token",
    "/api/user/login", "/auth/login", "/login",
  ]),

  EMAIL_FIELDS: ["email", "username", "user", "login", "identifier", "email_address"],

  // Faixas de IP de provedores cloud/datacenter (primeiros octetos)
  VPS_FIRST_OCTETS: new Set([
    3, 13, 15, 18, 34, 35, 52, 54,   // AWS
    20, 40, 51, 52, 104,              // Azure
    8, 34, 35, 130, 142, 146, 172,   // GCP
    45, 64, 82, 85, 91, 92, 141,     // VPS/bulletproof common ranges
    185, 188, 193, 194, 195, 196,    // European DC
    104, 108, 130, 131, 138, 139,    // CDN/DC
  ]),
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoginEvent {
  timestamp:     number;
  ipPrefix:      string;   // IPv4 /16 ou IPv6 /48
  hourOfDay:     number;   // 0–23
  uaFingerprint: string;   // "chrome-windows" etc.
  isVps:         boolean;
  ip:            string;   // hashed for privacy
}

interface UserProfile {
  emailHash:      string;
  history:        LoginEvent[];
  lastAtoFlag:    number;   // timestamp do último flag ATO (anti-repeat)
  claudeChecked:  Set<string>; // ipPrefix+hour combinations já analisados
}

interface DeviationResult {
  compound:  number;   // 0.0–1.0
  geoScore:  number;
  timeScore: number;
  uaScore:   number;
  vpsScore:  number;
  details:   string;
  baseline:  BaselineSummary;
}

interface BaselineSummary {
  knownPrefixCount: number;
  typicalHourMin:   number;
  typicalHourMax:   number;
  knownUAs:         string[];
  vpsRatio:         number;
  loginCount:       number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const profiles = new Map<string, UserProfile>();
let _claudeCalls = 0;
let _claudeWindowStart = Date.now();

const _stats = {
  totalLoginsTracked:    0,
  profilesInMemory:      0,
  deviationsDetected:    0,
  impossibleTravels:     0,
  claudeValidations:     0,
  claudeConfirmed:       0,
  accountsFlagged:       0,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashEmail(raw: string): string {
  return crypto.createHash("sha256").update(raw.toLowerCase().trim()).digest("hex").slice(0, 16);
}

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function getIP(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return (Array.isArray(fwd) ? fwd[0] : fwd).split(",")[0]!.trim();
  return req.ip ?? "0.0.0.0";
}

function extractEmail(req: Request): string | null {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object") return null;
    for (const field of CFG.EMAIL_FIELDS) {
      const val = body[field];
      if (typeof val === "string" && val.length > 2 && val.length < 255) return val;
    }
  } catch { /* ignore */ }
  return null;
}

function getIpPrefix(ip: string): string {
  // IPv4: primeiros 2 octetos ("45.155")
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})/);
  if (v4) return `${v4[1]}.${v4[2]}`;
  // IPv6: primeiros 3 grupos ("2001:db8:85a3")
  const v6parts = ip.split(":");
  return v6parts.slice(0, 3).join(":");
}

function isVpsIp(ip: string): boolean {
  const firstOctet = parseInt(ip.split(".")[0] ?? "0", 10);
  return CFG.VPS_FIRST_OCTETS.has(firstOctet);
}

function extractUAFingerprint(ua: string): string {
  const s = ua.toLowerCase();
  // Browser
  let browser = "unknown";
  if (s.includes("edg/") || s.includes("edge/"))  browser = "edge";
  else if (s.includes("opr/") || s.includes("opera")) browser = "opera";
  else if (s.includes("firefox"))  browser = "firefox";
  else if (s.includes("safari") && !s.includes("chrome")) browser = "safari";
  else if (s.includes("chrome"))   browser = "chrome";
  else if (s.includes("curl") || s.includes("python") || s.includes("go-http")) browser = "tool";

  // OS
  let os = "unknown";
  if (s.includes("windows"))      os = "windows";
  else if (s.includes("android")) os = "android";
  else if (s.includes("iphone") || s.includes("ipad")) os = "ios";
  else if (s.includes("mac os") || s.includes("macintosh")) os = "macos";
  else if (s.includes("linux"))   os = "linux";

  return `${browser}-${os}`;
}

function canCallClaude(): boolean {
  const now = Date.now();
  if (now - _claudeWindowStart > 60_000) {
    _claudeWindowStart = now;
    _claudeCalls = 0;
  }
  return _claudeCalls < CFG.CLAUDE_RATE_LIMIT;
}

// ─── Baseline + Deviation Computation ────────────────────────────────────────

function computeBaseline(history: LoginEvent[]): BaselineSummary {
  const prefixes = new Set(history.map(e => e.ipPrefix));
  const hours    = history.map(e => e.hourOfDay).sort((a, b) => a - b);
  const uas      = [...new Set(history.map(e => e.uaFingerprint))];
  const vpsCount = history.filter(e => e.isVps).length;

  // Horário típico: percentil 10–90 (remove outliers)
  const p10 = hours[Math.floor(hours.length * 0.10)] ?? hours[0] ?? 0;
  const p90 = hours[Math.floor(hours.length * 0.90)] ?? hours[hours.length - 1] ?? 23;

  return {
    knownPrefixCount: prefixes.size,
    typicalHourMin:   p10,
    typicalHourMax:   p90,
    knownUAs:         uas,
    vpsRatio:         vpsCount / history.length,
    loginCount:       history.length,
  };
}

function computeDeviation(current: LoginEvent, history: LoginEvent[]): DeviationResult {
  const baseline = computeBaseline(history);
  const knownPrefixes = new Set(history.map(e => e.ipPrefix));
  const knownUAs      = new Set(history.map(e => e.uaFingerprint));

  // 1. Geo score — 0=prefixo conhecido, 1=nunca visto
  const geoScore = knownPrefixes.has(current.ipPrefix) ? 0.0 : 1.0;

  // 2. Time score — 0=dentro do horário típico±buffer, 1=completamente fora
  const minH = Math.max(0,  baseline.typicalHourMin - CFG.HOUR_BUFFER);
  const maxH = Math.min(23, baseline.typicalHourMax + CFG.HOUR_BUFFER);
  const hourInRange = current.hourOfDay >= minH && current.hourOfDay <= maxH;
  const timeScore = hourInRange ? 0.0 : Math.min(
    Math.abs(current.hourOfDay - minH),
    Math.abs(current.hourOfDay - maxH)
  ) / 12.0; // normaliza por 12h (metade do dia)

  // 3. UA score — 0=fingerprint conhecido, 1=nunca visto
  const uaScore = knownUAs.has(current.uaFingerprint) ? 0.0 : 1.0;

  // 4. VPS score — 0=VPS já usado ou usuário tem histórico VPS, 1=primeiro VPS
  let vpsScore = 0.0;
  if (current.isVps && baseline.vpsRatio < CFG.VPS_RATIO_EXEMPT) {
    // Primeiro login VPS para conta predominantly residential
    const hadVpsBefore = history.some(e => e.isVps);
    vpsScore = hadVpsBefore ? 0.3 : 1.0;
  }

  // Compound (ponderado)
  const compound =
    geoScore  * CFG.WEIGHT_GEO  +
    timeScore * CFG.WEIGHT_TIME +
    uaScore   * CFG.WEIGHT_UA   +
    vpsScore  * CFG.WEIGHT_VPS;

  const details = [
    geoScore  > 0 ? `geo:${current.ipPrefix}(novo)` : `geo:known`,
    timeScore > 0 ? `time:${current.hourOfDay}h(fora_de_${minH}-${maxH}h)` : `time:ok`,
    uaScore   > 0 ? `ua:${current.uaFingerprint}(novo)` : `ua:known`,
    vpsScore  > 0 ? `vps:datacenter(primeira_vez)` : `vps:ok`,
  ].join(" | ");

  return { compound, geoScore, timeScore, uaScore, vpsScore, details, baseline };
}

// ─── Impossible Travel ────────────────────────────────────────────────────────

function checkImpossibleTravel(current: LoginEvent, history: LoginEvent[]): boolean {
  if (history.length === 0) return false;
  const last = history[history.length - 1]!;
  const timeDeltaMs = current.timestamp - last.timestamp;
  const travelWindowMs = CFG.IMPOSSIBLE_TRAVEL_HOURS * 3_600_000;

  // Prefixos diferentes E tempo < janela de viagem
  return (
    last.ipPrefix !== current.ipPrefix &&
    timeDeltaMs   > 0 &&
    timeDeltaMs   < travelWindowMs
  );
}

// ─── Claude AI Validation (fire-and-forget) ───────────────────────────────────

function validateWithClaude(
  emailHash:  string,
  current:    LoginEvent,
  deviation:  DeviationResult,
  impossible: boolean,
  ip:         string,
): void {
  if (!canCallClaude()) return;
  _claudeCalls++;
  _stats.claudeValidations++;

  const baseline = deviation.baseline;
  const prompt   = `You are a security analyst for VolatusShield.

Analyze this account login for Account Takeover (ATO):

Account (hash): ${emailHash}
Historical baseline (${baseline.loginCount} logins):
  - Known IP regions: ${baseline.knownPrefixCount} distinct /16 prefixes
  - Typical login hours: ${baseline.typicalHourMin}h–${baseline.typicalHourMax}h
  - Known browsers/OS: ${baseline.knownUAs.join(", ")}
  - VPS/datacenter usage rate: ${(baseline.vpsRatio * 100).toFixed(0)}%

Current session:
  - IP region: ${current.ipPrefix}.x.x ${current.isVps ? "(datacenter/VPS)" : "(residential)"}
  - Hour: ${current.hourOfDay}:00
  - Browser/OS: ${current.uaFingerprint}
  - Deviation details: ${deviation.details}
  - Compound deviation score: ${(deviation.compound * 100).toFixed(0)}% (threshold: 70%)
  - Impossible travel detected: ${impossible}

Is this a compromised account (ATO)? Consider:
1. Legitimate travel: user could be in a different time zone
2. New device: VPN or work laptop changes IP/browser
3. Multiple indicators simultaneously = higher confidence
4. Impossible travel is a very strong ATO indicator

Respond with JSON only:
{"suspicious": boolean, "confidence": 0.0-1.0, "reason": "one sentence max", "scenario": "ato|travel|new_device|legitimate"}`;

  (async () => {
    try {
      const openai = getOpenAIClient(); if (!openai) throw new Error("OPENAI_API_KEY não configurado");
      const msg = await openai.chat.completions.create({
        model:      "gpt-4o-mini",
        max_tokens: 256,
        messages:   [{ role: "user", content: prompt }],
      });
      const raw     = msg.choices[0]?.message?.content ?? "{}";
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const result  = JSON.parse(cleaned) as {
        suspicious:  boolean;
        confidence:  number;
        reason:      string;
        scenario?:   string;
      };
      if (result.suspicious && result.confidence >= 0.65) {
        _stats.claudeConfirmed++;
        recordThreatEvent(ip, "ato_behavioral_deviation", {
          emailHash,
          deviationScore:  deviation.compound,
          claudeReason:    result.reason,
          claudeScenario:  result.scenario ?? "ato",
          confidence:      result.confidence,
          details:         deviation.details,
        });
      }
    } catch { /* Claude falhou — análise heurística já aplicada */ }
  })();
}

// ─── Core Detection ───────────────────────────────────────────────────────────

function processSuccessfulLogin(emailHash: string, ipRaw: string, ua: string, now: number): void {
  const ipPrefix  = getIpPrefix(ipRaw);
  const ipHashed  = hashIp(ipRaw);
  const hourOfDay = new Date(now).getUTCHours();
  const uaFp      = extractUAFingerprint(ua);
  const isVps     = isVpsIp(ipRaw);

  const current: LoginEvent = {
    timestamp: now, ipPrefix, hourOfDay,
    uaFingerprint: uaFp, isVps, ip: ipHashed,
  };

  let profile = profiles.get(emailHash);
  if (!profile) {
    profile = {
      emailHash,
      history:      [],
      lastAtoFlag:  0,
      claudeChecked: new Set(),
    };
    profiles.set(emailHash, profile);
    _stats.profilesInMemory = profiles.size;
  }

  const history = profile.history;

  // Impossible travel (antes de adicionar ao histórico)
  const impossible = history.length >= 1 && checkImpossibleTravel(current, history);

  // Adiciona ao histórico
  history.push(current);
  if (history.length > CFG.MAX_HISTORY_PER_USER) history.shift();
  _stats.totalLoginsTracked++;

  // Cold-start guard
  if (history.length < CFG.MIN_LOGINS_FOR_BASELINE + 1) return;

  // Anti-repeat: máx 1 flag ATO por conta em 24h
  const cooldownOk = now - profile.lastAtoFlag > CFG.ATO_COOLDOWN_MS;
  if (!cooldownOk) return;

  // Impossible travel — sinal mais forte, não precisa de Claude
  if (impossible) {
    _stats.impossibleTravels++;
    profile.lastAtoFlag = now;
    recordThreatEvent(ipRaw, "ato_impossible_travel", {
      emailHash,
      currentPrefix: ipPrefix,
      lastPrefix:    history[history.length - 2]?.ipPrefix ?? "?",
      timeDeltaMin:  Math.round((now - (history[history.length - 2]?.timestamp ?? now)) / 60_000),
      travelWindowH: CFG.IMPOSSIBLE_TRAVEL_HOURS,
    });
    _stats.accountsFlagged++;
  }

  // Behavioral deviation — precisa de histórico suficiente
  const historicalBaseline = history.slice(0, -1); // todos menos o atual
  const deviation = computeDeviation(current, historicalBaseline);

  if (deviation.compound >= CFG.DEVIATION_THRESHOLD) {
    _stats.deviationsDetected++;

    const cacheKey = `${ipPrefix}-${hourOfDay}-${uaFp}`;
    if (!profile.claudeChecked.has(cacheKey)) {
      profile.claudeChecked.add(cacheKey);
      if (!impossible) {
        profile.lastAtoFlag = now;
        _stats.accountsFlagged++;
      }
      // Claude valida (fire-and-forget)
      validateWithClaude(emailHash, current, deviation, impossible, ipRaw);
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function atoDetectorMiddleware(
  req:  Request,
  res:  Response,
  next: NextFunction,
): void {
  const ip   = getIP(req);
  const path = req.path ?? "";

  // Apenas monitora endpoints de login
  if (req.method !== "POST" || !CFG.LOGIN_PATHS.has(path.toLowerCase().split("?")[0]!)) {
    next();
    return;
  }

  // Skip loopback
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("::ffff:127.")) {
    next();
    return;
  }

  const emailRaw = extractEmail(req);
  if (!emailRaw) { next(); return; }

  const emailHash = hashEmail(emailRaw);
  const ua        = String(req.headers["user-agent"] ?? "");
  const now       = Date.now();

  // Intercepta a resposta — só processa logins BEM-SUCEDIDOS
  let responded = false;

  function onResponse(statusCode: number): void {
    if (responded) return;
    responded = true;
    if (statusCode >= 200 && statusCode < 300) {
      processSuccessfulLogin(emailHash, ip, ua, now);
    }
  }

  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);

  res.json = function (body: unknown) {
    onResponse(res.statusCode);
    return origJson(body);
  };
  res.send = function (body: unknown) {
    onResponse(res.statusCode);
    return origSend(body);
  };
  res.on("finish", () => onResponse(res.statusCode));

  next();
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

setInterval(() => {
  const cutoff = Date.now() - CFG.USER_TTL_MS;
  for (const [hash, profile] of profiles) {
    const lastLogin = profile.history[profile.history.length - 1]?.timestamp ?? 0;
    if (lastLogin < cutoff) profiles.delete(hash);
  }
  _stats.profilesInMemory = profiles.size;
}, CFG.CLEANUP_INTERVAL_MS).unref();

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getATOStats() {
  const topProfiles = [...profiles.values()]
    .sort((a, b) => b.history.length - a.history.length)
    .slice(0, 5)
    .map(p => {
      const baseline = p.history.length >= CFG.MIN_LOGINS_FOR_BASELINE
        ? computeBaseline(p.history)
        : null;
      return {
        emailHash:    p.emailHash,
        loginCount:   p.history.length,
        lastLogin:    p.history.length > 0
          ? new Date(p.history[p.history.length - 1]!.timestamp).toISOString()
          : null,
        lastAtoFlag:  p.lastAtoFlag > 0 ? new Date(p.lastAtoFlag).toISOString() : null,
        baseline:     baseline ? {
          knownRegions: baseline.knownPrefixCount,
          typicalHours: `${baseline.typicalHourMin}h–${baseline.typicalHourMax}h`,
          knownUAs:     baseline.knownUAs,
          vpsRatio:     `${(baseline.vpsRatio * 100).toFixed(0)}%`,
        } : "learning (< " + CFG.MIN_LOGINS_FOR_BASELINE + " logins)",
      };
    });

  return {
    module:  "ato-detector",
    phase:   "ATO — Account Takeover AI Behavioral Baseline",
    status:  "ACTIVE",
    config: {
      minLoginsForBaseline:   CFG.MIN_LOGINS_FOR_BASELINE,
      maxHistoryPerUser:      CFG.MAX_HISTORY_PER_USER,
      deviationThreshold:     `${(CFG.DEVIATION_THRESHOLD * 100).toFixed(0)}%`,
      impossibleTravelHours:  CFG.IMPOSSIBLE_TRAVEL_HOURS,
      hourBuffer:             `±${CFG.HOUR_BUFFER}h`,
      vpsRatioExempt:         `${(CFG.VPS_RATIO_EXEMPT * 100).toFixed(0)}%`,
      atoCooldownHours:       CFG.ATO_COOLDOWN_MS / 3_600_000,
      claudeModel:            CFG.CLAUDE_MODEL,
      claudeRateLimit:        `${CFG.CLAUDE_RATE_LIMIT}/min`,
    },
    signals: {
      behavioralDeviation: { name: "ato_behavioral_deviation", score: 75 },
      impossibleTravel:    { name: "ato_impossible_travel",    score: 80 },
    },
    weights: {
      geo:  `${CFG.WEIGHT_GEO  * 100}%`,
      time: `${CFG.WEIGHT_TIME * 100}%`,
      ua:   `${CFG.WEIGHT_UA   * 100}%`,
      vps:  `${CFG.WEIGHT_VPS  * 100}%`,
    },
    stats: {
      ..._stats,
      profilesInMemory: profiles.size,
      claudeCallsThisMin: _claudeCalls,
    },
    topProfiles,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO B2 — Account Takeover Detection (ATO chain analyzer)
// ═══════════════════════════════════════════════════════════════════════════════
// Detecta padrões ATO via threat-engine signals existentes:
//   multiple_failed_login + new_country + new_device + impossible_travel
// em janela 1h. Persiste 10k events ring. Integra com QUEBA (baseline) e
// QResponse (auto disable_user se score>90).
// ═══════════════════════════════════════════════════════════════════════════════

import { getIpRecord } from "./threat-engine-stub.js";

const ATO_RING_MAX = 10_000;
const ATO_WINDOW_MS = 60 * 60_000;          // 1h
const ATO_AUTO_DISABLE_THRESHOLD = 90;
const ATO_HIGH_RISK_BASELINE = 60;          // queba riskScore considerado alto

export type AtoEvent = {
  id: string;
  ts: number;
  userId: string;
  ip: string;
  ua: string;
  country: string | null;
  score: number;
  level: "clean" | "suspicious" | "high" | "critical";
  reasons: string[];
  signalsMatched: string[];
  qubeaRiskScore: number | null;
  autoDisableTriggered: boolean;
  qresponseExecutionId: string | null;
};

const _atoEvents: AtoEvent[] = [];
const _atoUserIndex = new Map<string, string[]>();   // userId → eventId[]
const _atoStats = {
  checks: 0,
  cleanEvents: 0,
  suspiciousEvents: 0,
  highEvents: 0,
  criticalEvents: 0,
  autoDisableTriggered: 0,
  autoDisableFailed: 0,
  lastCheckMs: 0,
};

function _atoLevel(score: number): AtoEvent["level"] {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 40) return "suspicious";
  return "clean";
}

function _pushAtoEvent(e: AtoEvent): void {
  _atoEvents.push(e);
  if (_atoEvents.length > ATO_RING_MAX) {
    const removed = _atoEvents.shift()!;
    const arr = _atoUserIndex.get(removed.userId);
    if (arr) {
      const i = arr.indexOf(removed.id);
      if (i >= 0) arr.splice(i, 1);
      if (arr.length === 0) _atoUserIndex.delete(removed.userId);
    }
  }
  let userArr = _atoUserIndex.get(e.userId);
  if (!userArr) { userArr = []; _atoUserIndex.set(e.userId, userArr); }
  userArr.push(e.id);
  if      (e.level === "critical")   _atoStats.criticalEvents++;
  else if (e.level === "high")       _atoStats.highEvents++;
  else if (e.level === "suspicious") _atoStats.suspiciousEvents++;
  else                               _atoStats.cleanEvents++;
}

async function _readQubeaBaseline(userId: string): Promise<number | null> {
  try {
    const queba = await import("./queba.js");
    const fn = (queba as any).getBaselineDetail ?? (queba as any).getBaseline;
    if (typeof fn !== "function") return null;
    const b = await fn(userId);
    if (!b) return null;
    return typeof b.riskScore === "number" ? b.riskScore : (b.risk_score ?? null);
  } catch {
    return null;
  }
}

async function _triggerAutoDisable(userId: string, reasons: string[]): Promise<{ triggered: boolean; executionId: string | null; error?: string }> {
  try {
    const qresponse = await import("./qresponse.js");
    const r = await qresponse.execute({
      action: "disable_user",
      input: { user_id: userId },
      actor: "volatus-ato",
      scope: "local",
      forceProd: true,
    });
    if (r.ok) {
      _atoStats.autoDisableTriggered++;
      return { triggered: true, executionId: r.execution?.id ?? null };
    }
    _atoStats.autoDisableFailed++;
    return { triggered: false, executionId: null, error: r.error };
  } catch (e: any) {
    _atoStats.autoDisableFailed++;
    return { triggered: false, executionId: null, error: String(e?.message ?? e) };
  }
}

/**
 * checkAto — analisa um evento de login/auth e gera um AtoEvent.
 * Combina:
 *   - threat-engine signals do IP em janela 1h (multiple_failed_login,
 *     new_country, new_device, impossible_travel-ish via geo/ua)
 *   - queba baseline riskScore do usuário
 * Score: cada signal pesa, baseline alto bonus. score>90 → auto disable_user.
 */
export async function checkAto(opts: {
  userId: string;
  ip: string;
  ua?: string;
  country?: string | null;
  failedLoginsLastHour?: number;
  newCountry?: boolean;
  newDevice?: boolean;
  impossibleTravel?: boolean;
}): Promise<AtoEvent> {
  const t0 = Date.now();
  _atoStats.checks++;
  const userId  = String(opts.userId || "unknown");
  const ip      = String(opts.ip || "");
  const ua      = String(opts.ua ?? "");
  const country = opts.country ?? null;
  const reasons: string[] = [];
  const signalsMatched: string[] = [];
  let score = 0;

  // 1. Sinal explícito do caller (multiple_failed_login)
  const fails = opts.failedLoginsLastHour ?? 0;
  if (fails >= 5) {
    score += 30;
    signalsMatched.push("multiple_failed_login");
    reasons.push(`${fails} failed logins in last hour`);
  }
  if (opts.newCountry) {
    score += 25;
    signalsMatched.push("new_country");
    reasons.push(`new country${country ? `: ${country}` : ""}`);
  }
  if (opts.newDevice) {
    score += 20;
    signalsMatched.push("new_device");
    reasons.push("device fingerprint never seen");
  }
  if (opts.impossibleTravel) {
    score += 35;
    signalsMatched.push("impossible_travel");
    reasons.push("impossible travel: 2 distant locations <2h");
  }

  // 2. Cross-reference threat-engine signals do IP (janela 1h)
  if (ip && ip !== "::1" && ip !== "127.0.0.1") {
    try {
      const rec = getIpRecord(ip);
      const cutoff = Date.now() - ATO_WINDOW_MS;
      const recent = rec.signals.filter(s => new Date(s.lastAt).getTime() >= cutoff);
      const sigSet = new Set(recent.map(s => s.signal));

      const failCount = recent
        .filter(s => s.signal === "browser_auth_fail" || (s.signal as string) === "multiple_failed_login")
        .reduce((acc, s) => acc + s.count, 0);
      if (failCount >= 5 && !signalsMatched.includes("multiple_failed_login")) {
        score += 30;
        signalsMatched.push("multiple_failed_login");
        reasons.push(`threat-engine: ${failCount} failed auths from this IP`);
      }
      if (sigSet.has("ato_impossible_travel" as any) && !signalsMatched.includes("impossible_travel")) {
        score += 35;
        signalsMatched.push("impossible_travel");
        reasons.push("threat-engine flagged impossible travel");
      }
      if (sigSet.has("ato_behavioral_deviation" as any)) {
        score += 20;
        signalsMatched.push("behavioral_deviation");
        reasons.push("ATO behavioral deviation flagged");
      }
      if (rec.score >= 60) {
        score += 10;
        reasons.push(`IP threat score: ${rec.score}`);
      }
    } catch { /* IP unknown to threat-engine — ignora */ }
  }

  // 3. QUEBA baseline — usuário com riskScore alto amplifica
  const qubeaRiskScore = await _readQubeaBaseline(userId);
  if (qubeaRiskScore !== null && qubeaRiskScore >= ATO_HIGH_RISK_BASELINE) {
    score += 15;
    reasons.push(`QUEBA baseline risk: ${qubeaRiskScore}`);
  }

  if (score > 100) score = 100;
  const level = _atoLevel(score);

  // 4. Auto disable_user se >90
  let autoDisableTriggered = false;
  let qresponseExecutionId: string | null = null;
  if (score > ATO_AUTO_DISABLE_THRESHOLD) {
    const r = await _triggerAutoDisable(userId, reasons);
    autoDisableTriggered = r.triggered;
    qresponseExecutionId = r.executionId;
  }

  const event: AtoEvent = {
    id: "ato-" + crypto.randomBytes(6).toString("hex"),
    ts: Date.now(),
    userId, ip, ua, country,
    score, level, reasons, signalsMatched,
    qubeaRiskScore,
    autoDisableTriggered,
    qresponseExecutionId,
  };
  _pushAtoEvent(event);
  _atoStats.lastCheckMs = Date.now() - t0;
  return event;
}

export function listAtoEvents(limit = 100): AtoEvent[] {
  const n = Math.max(1, Math.min(limit, ATO_RING_MAX));
  return _atoEvents.slice(-n).reverse();
}

export function getAtoEventsByUser(userId: string, limit = 100): AtoEvent[] {
  const ids = _atoUserIndex.get(userId) ?? [];
  const set = new Set(ids);
  const out: AtoEvent[] = [];
  for (let i = _atoEvents.length - 1; i >= 0 && out.length < limit; i--) {
    const e = _atoEvents[i]!;
    if (set.has(e.id)) out.push(e);
  }
  return out;
}

export function getAtoChainStats() {
  return {
    ...(_atoStats),
    eventsInRing: _atoEvents.length,
    ringCapacity: ATO_RING_MAX,
    uniqueUsers: _atoUserIndex.size,
    windowMs: ATO_WINDOW_MS,
    autoDisableThreshold: ATO_AUTO_DISABLE_THRESHOLD,
    qubeaHighRiskBaseline: ATO_HIGH_RISK_BASELINE,
  };
}

export async function atoChainSelfTest() {
  const t0 = Date.now();
  const tests: Array<{ name: string; pass: boolean; detail?: string }> = [];
  const snapshot = {
    events: _atoEvents.length,
    users: _atoUserIndex.size,
    stats: { ..._atoStats },
  };

  try {
    const e1 = await checkAto({ userId: "selftest-user-clean", ip: "10.0.0.1" });
    tests.push({ name: "clean_login", pass: e1.score === 0 && e1.level === "clean", detail: `score=${e1.score} level=${e1.level}` });

    const e2 = await checkAto({ userId: "selftest-user-fails", ip: "10.0.0.2", failedLoginsLastHour: 7 });
    tests.push({ name: "multiple_failed_login", pass: e2.signalsMatched.includes("multiple_failed_login") && e2.score >= 30, detail: `score=${e2.score} sigs=${e2.signalsMatched.join(",")}` });

    const e3 = await checkAto({ userId: "selftest-user-geo", ip: "10.0.0.3", newCountry: true, newDevice: true, country: "BR" });
    tests.push({ name: "new_country_and_device", pass: e3.signalsMatched.includes("new_country") && e3.signalsMatched.includes("new_device") && e3.score >= 45, detail: `score=${e3.score} sigs=${e3.signalsMatched.join(",")}` });

    const e4 = await checkAto({ userId: "selftest-user-travel", ip: "10.0.0.4", impossibleTravel: true });
    tests.push({ name: "impossible_travel", pass: e4.signalsMatched.includes("impossible_travel") && e4.score >= 35, detail: `score=${e4.score} sigs=${e4.signalsMatched.join(",")}` });

    const e5 = await checkAto({
      userId: "selftest-user-fullato",
      ip: "10.0.0.5",
      failedLoginsLastHour: 8,
      newCountry: true,
      newDevice: true,
      impossibleTravel: true,
      country: "RU",
    });
    const fullChain = e5.signalsMatched.length >= 4 && e5.score >= 90 && e5.level === "critical";
    tests.push({ name: "full_ato_chain_critical", pass: fullChain, detail: `score=${e5.score} level=${e5.level} sigs=${e5.signalsMatched.length} autoDisable=${e5.autoDisableTriggered}` });
  } catch (e: any) {
    tests.push({ name: "exception", pass: false, detail: String(e?.message ?? e) });
  } finally {
    // Cleanup self-test events para não poluir ring/index/stats
    const SELFTEST_USERS = new Set(["selftest-user-clean","selftest-user-fails","selftest-user-geo","selftest-user-travel","selftest-user-fullato"]);
    for (let i = _atoEvents.length - 1; i >= 0; i--) {
      if (SELFTEST_USERS.has(_atoEvents[i]!.userId)) _atoEvents.splice(i, 1);
    }
    for (const u of SELFTEST_USERS) _atoUserIndex.delete(u);
    _atoStats.checks            = snapshot.stats.checks;
    _atoStats.cleanEvents       = snapshot.stats.cleanEvents;
    _atoStats.suspiciousEvents  = snapshot.stats.suspiciousEvents;
    _atoStats.highEvents        = snapshot.stats.highEvents;
    _atoStats.criticalEvents    = snapshot.stats.criticalEvents;
    _atoStats.autoDisableTriggered = snapshot.stats.autoDisableTriggered;
    _atoStats.autoDisableFailed = snapshot.stats.autoDisableFailed;
  }

  const passed = tests.filter(t => t.pass).length;
  return { ok: passed === tests.length, total: tests.length, passed, durationMs: Date.now() - t0, tests };
}
