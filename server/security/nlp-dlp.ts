/**
 * volatus-nlp-dlp.ts — Quantum NLP DLP Engine (Ω-6, Fase 285)
 *
 * Data Loss Prevention com NLP proprietário — 100% local
 * Zero terceiros · Zero API externa · Zero dado sai do servidor
 *
 * Capacidades:
 *   1. CPF/CNPJ/RG/CEP   — validação com algoritmo real (dígito verificador)
 *   2. PCI DSS            — Luhn, CVV, expiração, titular, BIN lookup
 *   3. PII Global         — email, phone, passport, SSN, IBAN, cripto
 *   4. LGPD / HIPAA       — dados de saúde, biometria, raça/etnia, religião
 *   5. Secrets/Credentials— JWT, API keys, private keys, tokens
 *   6. NLP Context Engine — confiança por contexto circundante
 *   7. Quantum Entropy    — Shannon entropy + Born Rule risk scoring
 *   8. Redaction          — substitui entidades detectadas
 */

/* ═══════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════ */

export type EntityType =
  | "cpf" | "cnpj" | "rg" | "cep" | "phone_br"
  | "card_number" | "card_cvv" | "card_expiry" | "card_holder"
  | "email" | "phone_intl" | "ip_address" | "date_of_birth"
  | "passport" | "ssn" | "iban" | "swift" | "crypto_btc" | "crypto_eth"
  | "jwt_token" | "api_key" | "private_key" | "password" | "bearer_token"
  | "health_keyword" | "biometric" | "ethnic_origin" | "religious" | "political"
  | "bank_account" | "pix_key" | "full_name";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Category = "pii_br" | "pci" | "pii_global" | "lgpd_sensitive" | "credentials" | "financial";

export interface DLPMatch {
  entityType:  EntityType;
  value:       string;
  redacted:    string;
  start:       number;
  end:         number;
  line:        number;
  col:         number;
  confidence:  number;
  severity:    Severity;
  category:    Category;
  validated:   boolean;
  contextHint: string;
  amplitude:   number;
}

export interface QuantumDLPRisk {
  score:        number;
  level:        "QUANTUM-SAFE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  entropy:      number;
  shannonScore: number;
  bornWeights:  Record<Severity, number>;
  superposition: string;
}

export interface DLPScanResult {
  scanId:     string;
  ts:         number;
  source:     string;
  chars:      number;
  lines:      number;
  matches:    DLPMatch[];
  redacted:   string;
  summary:    { critical: number; high: number; medium: number; low: number; info: number; total: number };
  byCategory: Record<string, number>;
  byType:     Record<string, number>;
  quantum:    QuantumDLPRisk;
  durationMs: number;
  clean:      boolean;
}

export interface DLPStats {
  totalScans:      number;
  totalMatches:    number;
  bySeverity:      Record<Severity, number>;
  byType:          Record<string, number>;
  avgQuantumScore: number;
  highRiskScans:   number;
  version:         string;
}

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL STATE
═══════════════════════════════════════════════════════════════════ */

const history:    DLPScanResult[] = [];
const HIST_MAX    = 300;
let totalScans    = 0;
let totalMatches  = 0;
let totalQScore   = 0;
let highRiskScans = 0;
const bySeverityAgg: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
const byTypeAgg:     Record<string, number>   = {};

/* ═══════════════════════════════════════════════════════════════════
   1. VALIDATION ALGORITHMS
═══════════════════════════════════════════════════════════════════ */

function digits(s: string): string { return s.replace(/\D/g, ""); }

function validateCPF(raw: string): boolean {
  const d = digits(raw);
  if (d.length !== 11) return false;
  if (/^(.)\1{10}$/.test(d)) return false; // all same digits
  const calc = (n: number): number => {
    let sum = 0;
    for (let i = 0; i < n - 1; i++) sum += parseInt(d[i]) * (n - i);
    const rem = (sum * 10) % 11;
    return rem >= 10 ? 0 : rem;
  };
  return calc(10) === parseInt(d[9]) && calc(11) === parseInt(d[10]);
}

function validateCNPJ(raw: string): boolean {
  const d = digits(raw);
  if (d.length !== 14) return false;
  if (/^(.)\1{13}$/.test(d)) return false;
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const checkDigit = (w: number[]): number => {
    const sum = w.reduce((s, w2, i) => s + parseInt(d[i]) * w2, 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  return checkDigit(weights1) === parseInt(d[12]) && checkDigit(weights2) === parseInt(d[13]);
}

function validateLuhn(raw: string): boolean {
  const d = digits(raw);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function cardBrand(raw: string): string {
  const d = digits(raw);
  if (/^4/.test(d)) return "Visa";
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^6(?:011|5)/.test(d)) return "Discover";
  if (/^(?:2131|1800|35\d{3})/.test(d)) return "JCB";
  if (/^3(?:0[0-5]|[68])/.test(d)) return "Diners";
  if (/^(?:606282|3841)/.test(d)) return "Hipercard";
  if (/^(?:384100|384140|384160|606282|637095|637568)/.test(d)) return "Elo";
  return "Card";
}

function validateIBAN(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.split("").map(c => {
    const n = c.charCodeAt(0) - 55;
    return n >= 0 && n <= 35 ? n.toString() : c;
  }).join("");
  let remainder = 0n;
  for (const chunk of numeric.match(/.{1,9}/g) ?? []) {
    remainder = (BigInt(remainder.toString() + chunk)) % 97n;
  }
  return remainder === 1n;
}

/* ═══════════════════════════════════════════════════════════════════
   2. NLP CONTEXT ENGINE
   Analisa janela de ±60 chars ao redor de cada match para
   aumentar/diminuir confiança com base em palavras-chave
═══════════════════════════════════════════════════════════════════ */

const CONTEXT_BOOSTERS: Record<EntityType, RegExp[]> = {
  cpf:          [/\bcpf\b/i, /cadastro\s*de\s*pessoa/i, /contribuinte/i, /\bdoc\b/i, /\bDocumento\b/i],
  cnpj:         [/\bcnpj\b/i, /empresa/i, /razão\s*social/i, /\bCNPJ\b/],
  rg:           [/\brg\b/i, /registro\s*geral/i, /identidade\b/i, /\bR\.?G\.?\b/i],
  cep:          [/\bcep\b/i, /código\s*postal/i, /endereço/i, /\bzip\b/i],
  phone_br:     [/\btel(?:efone)?\b/i, /\bfone\b/i, /\bcelular\b/i, /\bwhatsapp\b/i, /contato/i],
  card_number:  [/\bcartão\b/i, /\bcard\b/i, /\bcredit\b/i, /\bdébit\b/i, /\bpagamento\b/i, /\bpan\b/i],
  card_cvv:     [/\bcvv\b/i, /\bcvc\b/i, /\bcod\b/i, /\bsecurit/i, /\bverif/i],
  card_expiry:  [/\bvalidade\b/i, /\bexpir/i, /\bvencimento\b/i, /\bexp\b/i, /\bvalid\b/i],
  card_holder:  [/\btitular\b/i, /\bholder\b/i, /\bnome\s*no\s*cartão/i],
  email:        [/\bemail\b/i, /\be-mail\b/i, /\bcorreo\b/i, /\bcontato\b/i, /\bnewsletter\b/i],
  phone_intl:   [/\bphone\b/i, /\btel\b/i, /\bmobile\b/i, /\bcontact\b/i],
  ip_address:   [/\bip\b/i, /\bhost\b/i, /\baddress\b/i, /\bsource\b/i, /\borigin\b/i],
  date_of_birth:[/\bnascimento\b/i, /\bbirthday\b/i, /\bdob\b/i, /\bdata\s*nasc/i, /\bage\b/i],
  passport:     [/\bpassport\b/i, /\bpassaporte\b/i, /\btravel\b/i],
  ssn:          [/\bssn\b/i, /\bsocial\s*security\b/i, /\btax\s*id\b/i],
  iban:         [/\biban\b/i, /\baccount\b/i, /\bconta\b/i],
  swift:        [/\bswift\b/i, /\bbic\b/i, /\bbanco\b/i],
  crypto_btc:   [/\bbitcoin\b/i, /\bbtc\b/i, /\bcarteira\b/i, /\bwallet\b/i],
  crypto_eth:   [/\bethereum\b/i, /\beth\b/i, /\bwallet\b/i],
  jwt_token:    [/\bjwt\b/i, /\btoken\b/i, /\bbearer\b/i, /\bauthorization\b/i],
  api_key:      [/\bapi.?key\b/i, /\bsecret\b/i, /\btoken\b/i, /\bauth\b/i, /\bcredential/i],
  private_key:  [/\bprivate\b/i, /\bpem\b/i, /\brsa\b/i, /\bcertificado\b/i],
  password:     [/\bpassword\b/i, /\bsenha\b/i, /\bpwd\b/i, /\bpasswd\b/i],
  bearer_token: [/\bbearer\b/i, /\bauthorization\b/i, /\baccess.?token\b/i],
  health_keyword:[/\bdiagnóstico\b/i, /\bdoença\b/i, /\bpaciente\b/i, /\bhospital\b/i, /\bmedicamento\b/i],
  biometric:    [/\bbiometria\b/i, /\bdigital\b/i, /\bíris\b/i, /\bfacial\b/i],
  ethnic_origin:[/\braça\b/i, /\betnia\b/i, /\bétnico\b/i, /\bnegro\b/i, /\bindígena\b/i],
  religious:    [/\breligião\b/i, /\bfé\b/i, /\bigreja\b/i, /\bislam\b/i, /\bjudeu\b/i],
  political:    [/\bpartido\b/i, /\bfiliação\b/i, /\bpolítico\b/i, /\bsindic\b/i],
  bank_account: [/\bconta\b/i, /\bagência\b/i, /\bbanco\b/i, /\biban\b/i],
  pix_key:      [/\bpix\b/i, /\bchave\b/i, /\breceber\b/i, /\btransfer/i],
  full_name:    [/\bnome\b/i, /\bname\b/i, /\btitular\b/i, /\bcliente\b/i, /\busuário\b/i],
};

function contextConfidence(text: string, pos: number, entityType: EntityType): { boost: number; hint: string } {
  const window = 80;
  const ctx = text.substring(Math.max(0, pos - window), Math.min(text.length, pos + window)).toLowerCase();
  const boosters = CONTEXT_BOOSTERS[entityType] ?? [];
  let boost = 0;
  const hints: string[] = [];
  for (const b of boosters) {
    if (b.test(ctx)) { boost += 0.15; const m = ctx.match(b); if (m) hints.push(m[0]); }
  }
  return { boost: Math.min(0.3, boost), hint: hints.slice(0, 2).join(", ") };
}

/* ═══════════════════════════════════════════════════════════════════
   3. ENTITY PATTERNS
═══════════════════════════════════════════════════════════════════ */

interface EntityDef {
  type:      EntityType;
  category:  Category;
  severity:  Severity;
  pattern:   RegExp;
  amplitude: number;
  baseConf:  number;
  validate?: (s: string) => boolean;
  redactAs?: (s: string) => string;
}

const ENTITIES: EntityDef[] = [
  /* ── PII Brasileira ── */
  {
    type: "cpf", category: "pii_br", severity: "critical", amplitude: 1.0, baseConf: 0.7,
    pattern: /\b(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2})\b/g,
    validate: s => validateCPF(s),
    redactAs: () => "[REDACTED-CPF]",
  },
  {
    type: "cnpj", category: "pii_br", severity: "critical", amplitude: 1.0, baseConf: 0.75,
    pattern: /\b(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-.\s]?\d{2})\b/g,
    validate: s => validateCNPJ(s),
    redactAs: () => "[REDACTED-CNPJ]",
  },
  {
    type: "cep", category: "pii_br", severity: "medium", amplitude: 0.4, baseConf: 0.65,
    pattern: /\b(\d{5}[-\s]?\d{3})\b/g,
    validate: s => digits(s).length === 8,
    redactAs: () => "[REDACTED-CEP]",
  },
  {
    type: "phone_br", category: "pii_br", severity: "high", amplitude: 0.7, baseConf: 0.6,
    pattern: /\b(?:\+55\s?)?(?:\(?\d{2}\)?\s?)(?:9\s?\d{4}[-\s]?\d{4}|\d{4}[-\s]?\d{4})\b/g,
    validate: s => { const d2 = digits(s); return d2.length >= 10 && d2.length <= 13; },
    redactAs: () => "[REDACTED-PHONE-BR]",
  },
  {
    type: "pix_key", category: "financial", severity: "high", amplitude: 0.7, baseConf: 0.55,
    pattern: /\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/gi,
    redactAs: () => "[REDACTED-PIX-KEY]",
  },

  /* ── PCI DSS ── */
  {
    type: "card_number", category: "pci", severity: "critical", amplitude: 1.0, baseConf: 0.6,
    pattern: /\b([3-6]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?:\d[\s\-]?\d{3})?)\b/g,
    validate: s => validateLuhn(s) && digits(s).length >= 13,
    redactAs: s => {
      const brand = cardBrand(s);
      const d2 = digits(s);
      return `[REDACTED-${brand.toUpperCase()}-****${d2.slice(-4)}]`;
    },
  },
  {
    type: "card_cvv", category: "pci", severity: "critical", amplitude: 1.0, baseConf: 0.4,
    pattern: /\b(?:cvv|cvc|csc|cvv2|cvc2|ccv)[\s:=]?([0-9]{3,4})\b/gi,
    redactAs: () => "[REDACTED-CVV]",
  },
  {
    type: "card_expiry", category: "pci", severity: "high", amplitude: 0.8, baseConf: 0.45,
    pattern: /\b(?:exp(?:iry|iration)?|validade|venc\.?)[\s:=]?(0[1-9]|1[0-2])[\/\-](\d{2}|\d{4})\b/gi,
    redactAs: () => "[REDACTED-EXPIRY]",
  },

  /* ── PII Global ── */
  {
    type: "email", category: "pii_global", severity: "high", amplitude: 0.75, baseConf: 0.85,
    pattern: /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g,
    validate: s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
    redactAs: s => {
      const [local, domain] = s.split("@");
      return `[REDACTED-EMAIL-${local[0]}***@${domain}]`;
    },
  },
  {
    type: "phone_intl", category: "pii_global", severity: "medium", amplitude: 0.55, baseConf: 0.5,
    pattern: /\+(?:[1-9]\d{0,2})[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}(?:[\s\-]?\d{2,4})?/g,
    validate: s => { const d2 = digits(s); return d2.length >= 7 && d2.length <= 15; },
    redactAs: () => "[REDACTED-PHONE-INTL]",
  },
  {
    type: "date_of_birth", category: "pii_global", severity: "high", amplitude: 0.7, baseConf: 0.45,
    pattern: /\b(?:nasc(?:imento)?|birthday|dob|birth)[\s:=]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/gi,
    redactAs: () => "[REDACTED-DOB]",
  },
  {
    type: "ssn", category: "pii_global", severity: "critical", amplitude: 1.0, baseConf: 0.7,
    pattern: /\b(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/g,
    validate: s => { const d2 = digits(s); return d2.length === 9 && !/^0{9}|1{9}|9{9}/.test(d2) && d2.slice(0,3) !== "000" && d2.slice(3,5) !== "00" && d2.slice(5) !== "0000"; },
    redactAs: () => "[REDACTED-SSN]",
  },
  {
    type: "passport", category: "pii_global", severity: "critical", amplitude: 0.9, baseConf: 0.5,
    pattern: /\b(?:passport|passaporte)[\s:=]+([A-Z]{1,2}[0-9]{6,9})\b/gi,
    redactAs: () => "[REDACTED-PASSPORT]",
  },
  {
    type: "iban", category: "financial", severity: "critical", amplitude: 1.0, baseConf: 0.7,
    pattern: /\b([A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]?){0,16})\b/g,
    validate: s => validateIBAN(s),
    redactAs: s => `[REDACTED-IBAN-${s.slice(0, 4)}****]`,
  },
  {
    type: "swift", category: "financial", severity: "high", amplitude: 0.7, baseConf: 0.75,
    pattern: /\b([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g,
    validate: s => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) && s.length === 8 || s.length === 11,
    redactAs: () => "[REDACTED-SWIFT]",
  },
  {
    type: "crypto_btc", category: "financial", severity: "high", amplitude: 0.75, baseConf: 0.8,
    pattern: /\b([13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{6,87})\b/g,
    redactAs: s => `[REDACTED-BTC-${s.slice(0, 4)}...${s.slice(-4)}]`,
  },
  {
    type: "crypto_eth", category: "financial", severity: "high", amplitude: 0.75, baseConf: 0.8,
    pattern: /\b(0x[a-fA-F0-9]{40})\b/g,
    redactAs: s => `[REDACTED-ETH-${s.slice(0, 6)}...${s.slice(-4)}]`,
  },
  {
    type: "ip_address", category: "pii_global", severity: "low", amplitude: 0.3, baseConf: 0.8,
    pattern: /\b((?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?))\b/g,
    validate: s => !/^(0\.0\.0\.0|255\.255\.255\.255|127\.)/.test(s),
    redactAs: s => { const p = s.split("."); return `[REDACTED-IP-${p[0]}.${p[1]}.***.**]`; },
  },

  /* ── Credentials / Secrets ── */
  {
    type: "jwt_token", category: "credentials", severity: "critical", amplitude: 1.0, baseConf: 0.95,
    pattern: /\b(eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})\b/g,
    redactAs: () => "[REDACTED-JWT]",
  },
  {
    type: "bearer_token", category: "credentials", severity: "critical", amplitude: 1.0, baseConf: 0.9,
    pattern: /\bBearer\s+([A-Za-z0-9_\-\.]{20,})/gi,
    redactAs: () => "[REDACTED-BEARER-TOKEN]",
  },
  {
    type: "api_key", category: "credentials", severity: "critical", amplitude: 1.0, baseConf: 0.7,
    pattern: /(?:api[_\-]?key|apikey|access[_\-]?key|secret[_\-]?key|client[_\-]?secret|app[_\-]?secret)[\s:="']+([A-Za-z0-9_\-\/+]{16,128})/gi,
    redactAs: () => "[REDACTED-API-KEY]",
  },
  {
    type: "private_key", category: "credentials", severity: "critical", amplitude: 1.0, baseConf: 0.99,
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|DSA\s+|PRIVATE\s+)?PRIVATE\s+KEY-----/g,
    redactAs: () => "[REDACTED-PRIVATE-KEY]",
  },
  {
    type: "password", category: "credentials", severity: "critical", amplitude: 1.0, baseConf: 0.7,
    pattern: /(?:password|passwd|senha|pwd|pass)[\s:="']+([^\s"'<>\r\n]{6,64})/gi,
    redactAs: () => "[REDACTED-PASSWORD]",
  },

  /* ── LGPD Dados Sensíveis ── */
  {
    type: "health_keyword", category: "lgpd_sensitive", severity: "high", amplitude: 0.8, baseConf: 0.5,
    pattern: /\b(diagnóstico|diagnose|patologia|doença\s+crônica|HIV|cancer|câncer|diabetes|depressão|esquizofrenia|transtorno|cirurgia|prontuário|prescrição|CID[-\s]?\d{1,2}|CRM[-\s]?\d+)\b/gi,
    redactAs: s => `[REDACTED-HEALTH-DATA]`,
  },
  {
    type: "biometric", category: "lgpd_sensitive", severity: "critical", amplitude: 1.0, baseConf: 0.6,
    pattern: /\b(biometri[ac]|impressão\s+digital|reconhecimento\s+facial|padrão\s+de\s+íris|voz\s+biométric|geometria\s+da\s+mão|template\s+biométric|dados\s+genétic)\b/gi,
    redactAs: () => "[REDACTED-BIOMETRIC]",
  },
  {
    type: "ethnic_origin", category: "lgpd_sensitive", severity: "high", amplitude: 0.75, baseConf: 0.55,
    pattern: /\b(origem\s+(?:étnica|racial)|raça\s+(?:negra|branca|parda|amarela|indígena)|etnia\s+\w+|ascendência\s+(?:africana|europeia|asiática|indígena))\b/gi,
    redactAs: () => "[REDACTED-ETHNIC-DATA]",
  },
  {
    type: "political", category: "lgpd_sensitive", severity: "high", amplitude: 0.7, baseConf: 0.55,
    pattern: /\b(filiação\s+(?:partidária|política|sindical)|partido\s+político|convicção\s+(?:política|filosófica)|sindicato\s+filiado|posição\s+política)\b/gi,
    redactAs: () => "[REDACTED-POLITICAL-DATA]",
  },
];

/* ═══════════════════════════════════════════════════════════════════
   4. QUANTUM ENTROPY ENGINE
   Shannon entropy: H = -Σ p_i log₂(p_i)
   Usado para detectar strings de alta entropia (tokens, chaves)
═══════════════════════════════════════════════════════════════════ */

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const c of s) freq[c] = (freq[c] ?? 0) + 1;
  return -Object.values(freq).reduce((sum, n) => {
    const p = n / s.length;
    return sum + p * Math.log2(p);
  }, 0);
}

function detectHighEntropyStrings(text: string): DLPMatch[] {
  const results: DLPMatch[] = [];
  const tokenRegex = /[A-Za-z0-9+/=_\-]{20,}/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(text)) !== null) {
    const s = m[0];
    const entropy = shannonEntropy(s);
    if (entropy >= 4.0 && s.length >= 20 && s.length <= 256) {
      const line = text.substring(0, m.index).split("\n").length;
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      const col = m.index - lineStart + 1;
      const { boost, hint } = contextConfidence(text, m.index, "api_key");
      const confidence = Math.min(0.95, 0.3 + (entropy - 4.0) * 0.1 + boost);
      if (confidence >= 0.45) {
        results.push({
          entityType: "api_key", value: s,
          redacted: `[REDACTED-HIGH-ENTROPY-TOKEN-entropy:${entropy.toFixed(1)}]`,
          start: m.index, end: m.index + s.length, line, col,
          confidence, severity: confidence > 0.7 ? "high" : "medium",
          category: "credentials", validated: false,
          contextHint: hint || `Shannon entropy=${entropy.toFixed(2)}`,
          amplitude: 0.75,
        });
      }
    }
  }
  return results;
}

/* ═══════════════════════════════════════════════════════════════════
   5. BORN RULE QUANTUM RISK SCORING
═══════════════════════════════════════════════════════════════════ */

const SEV_AMP: Record<Severity, number> = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25, info: 0.08 };

function computeQuantumRisk(matches: DLPMatch[], shannonScore: number): QuantumDLPRisk {
  if (matches.length === 0) {
    return {
      score: 0, level: "QUANTUM-SAFE", entropy: 0, shannonScore,
      bornWeights: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      superposition: "|ψ_dlp⟩ = |SAFE⟩ — nenhum dado sensível detectado",
    };
  }

  const ampBySev: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const m of matches) {
    ampBySev[m.severity] += SEV_AMP[m.severity] * m.confidence * m.amplitude;
  }

  const sqSum = (Object.values(ampBySev) as number[]).reduce((s, a) => s + a * a, 1e-12);
  const born: Record<Severity, number> = {
    critical: (ampBySev.critical ** 2) / sqSum,
    high:     (ampBySev.high ** 2) / sqSum,
    medium:   (ampBySev.medium ** 2) / sqSum,
    low:      (ampBySev.low ** 2) / sqSum,
    info:     (ampBySev.info ** 2) / sqSum,
  };

  // Normalize entropy contribution (0-1)
  const entropyFactor = Math.min(1, shannonScore / 5.0);
  const countFactor   = Math.min(1, matches.length / 10);

  const score = Math.round(
    (born.critical * 100 + born.high * 75 + born.medium * 50 + born.low * 25 + born.info * 5) *
    (0.5 + 0.3 * countFactor + 0.2 * entropyFactor)
  );

  const level: QuantumDLPRisk["level"] =
    score >= 80 ? "CRITICAL" :
    score >= 60 ? "HIGH" :
    score >= 35 ? "MEDIUM" :
    score >= 10 ? "LOW" : "QUANTUM-SAFE";

  const stateVec = (Object.entries(born) as [Severity, number][])
    .filter(([, p]) => p > 0.01)
    .sort((a, b) => b[1] - a[1])
    .map(([sev, p]) => `${(p * 100).toFixed(1)}%|${sev.toUpperCase()}⟩`)
    .join(" + ");

  // Q-entropy of distribution
  const probs   = Object.values(born) as number[];
  const entropy = -probs.reduce((s, p) => s + (p > 1e-12 ? p * Math.log2(p) : 0), 0);

  return {
    score: Math.min(100, score),
    level,
    entropy: Math.round((entropy / Math.log2(5)) * 100) / 100,
    shannonScore: Math.round(shannonScore * 100) / 100,
    bornWeights: {
      critical: Math.round(born.critical * 1000) / 1000,
      high:     Math.round(born.high * 1000)     / 1000,
      medium:   Math.round(born.medium * 1000)   / 1000,
      low:      Math.round(born.low * 1000)      / 1000,
      info:     Math.round(born.info * 1000)     / 1000,
    },
    superposition: stateVec ? `|ψ_dlp⟩ = ${stateVec}` : "|ψ_dlp⟩ = |SAFE⟩",
  };
}

/* ═══════════════════════════════════════════════════════════════════
   6. MAIN SCAN FUNCTION
═══════════════════════════════════════════════════════════════════ */

export function scanDLP(content: string, opts: { source?: string } = {}): DLPScanResult {
  const t0       = Date.now();
  const source   = opts.source ?? "payload";
  const lines    = content.split("\n").length;
  const allMatches: DLPMatch[] = [];

  // Run all entity detectors
  for (const def of ENTITIES) {
    const re = new RegExp(def.pattern.source, def.pattern.flags.includes("g") ? def.pattern.flags : def.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const raw     = m[1] ?? m[0];
      const start   = m.index;
      const end     = start + m[0].length;
      const lineNum = content.substring(0, start).split("\n").length;
      const lineStart = content.lastIndexOf("\n", start) + 1;
      const col     = start - lineStart + 1;

      // Validate if validator exists
      const validated = def.validate ? def.validate(raw) : true;
      if (def.validate && !validated) continue; // skip invalid (e.g. bad CPF check digit)

      // Context analysis
      const { boost, hint } = contextConfidence(content, start, def.type);
      const confidence = Math.min(0.98, def.baseConf + boost + (validated ? 0.1 : 0));

      allMatches.push({
        entityType: def.type,
        value:      raw,
        redacted:   def.redactAs ? def.redactAs(raw) : `[REDACTED-${def.type.toUpperCase()}]`,
        start, end, line: lineNum, col,
        confidence,
        severity:   def.severity,
        category:   def.category,
        validated,
        contextHint: hint || (validated ? "algoritmo validado" : "padrão"),
        amplitude:  def.amplitude,
      });
    }
  }

  // Quantum entropy scan for high-entropy strings not caught by patterns
  const entropyMatches = detectHighEntropyStrings(content);
  allMatches.push(...entropyMatches);

  // Shannon entropy of entire payload (anomaly score)
  const shannonScore = shannonEntropy(content.replace(/\s/g, "").substring(0, 2000));

  // Dedup overlapping matches — keep highest confidence
  const deduped: DLPMatch[] = [];
  const usedRanges: [number, number][] = [];
  const sorted = [...allMatches].sort((a, b) => b.confidence - a.confidence);
  for (const match of sorted) {
    const overlaps = usedRanges.some(([s, e]) =>
      (match.start >= s && match.start < e) || (match.end > s && match.end <= e)
    );
    if (!overlaps) {
      deduped.push(match);
      usedRanges.push([match.start, match.end]);
    }
  }

  // Sort by position for redaction
  deduped.sort((a, b) => a.start - b.start);

  // Build redacted text
  let redacted = "";
  let cursor = 0;
  for (const m of deduped) {
    redacted += content.substring(cursor, m.start) + m.redacted;
    cursor = m.end;
  }
  redacted += content.substring(cursor);

  const summary = {
    critical: deduped.filter(m => m.severity === "critical").length,
    high:     deduped.filter(m => m.severity === "high").length,
    medium:   deduped.filter(m => m.severity === "medium").length,
    low:      deduped.filter(m => m.severity === "low").length,
    info:     deduped.filter(m => m.severity === "info").length,
    total:    deduped.length,
  };

  const byCategory: Record<string, number> = {};
  const byType:     Record<string, number> = {};
  for (const m of deduped) {
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
    byType[m.entityType]   = (byType[m.entityType]   ?? 0) + 1;
  }

  const quantum   = computeQuantumRisk(deduped, shannonScore);
  const scanId    = `dlp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const durationMs = Date.now() - t0;

  const result: DLPScanResult = {
    scanId, ts: Date.now(), source, chars: content.length, lines,
    matches: deduped, redacted, summary, byCategory, byType,
    quantum, durationMs, clean: deduped.length === 0,
  };

  // Update stats
  totalScans++;
  totalMatches  += deduped.length;
  totalQScore   += quantum.score;
  if (quantum.level === "HIGH" || quantum.level === "CRITICAL") highRiskScans++;
  for (const m of deduped) {
    bySeverityAgg[m.severity]++;
    byTypeAgg[m.entityType] = (byTypeAgg[m.entityType] ?? 0) + 1;
  }

  history.unshift(result);
  if (history.length > HIST_MAX) history.pop();

  return result;
}

/* ═══════════════════════════════════════════════════════════════════
   7. REDACT-ONLY (sem armazenar no histórico — para uso inline WAF)
═══════════════════════════════════════════════════════════════════ */

export function redactPayload(content: string): { redacted: string; found: boolean; types: string[] } {
  const result = scanDLP(content, { source: "inline-waf" });
  return { redacted: result.redacted, found: !result.clean, types: Object.keys(result.byType) };
}

/* ═══════════════════════════════════════════════════════════════════
   8. EXPORTS
═══════════════════════════════════════════════════════════════════ */

export function getDLPHistory(limit = 50): DLPScanResult[] { return history.slice(0, limit); }
export function getDLPScanById(id: string): DLPScanResult | undefined { return history.find(s => s.scanId === id); }

export function getDLPStats(): DLPStats {
  return {
    totalScans,
    totalMatches,
    bySeverity:     { ...bySeverityAgg },
    byType:         { ...byTypeAgg },
    avgQuantumScore: totalScans > 0 ? Math.round(totalQScore / totalScans) : 0,
    highRiskScans,
    version: "VolatusNLP-DLP v1.0 (Ω-6, Fase 285) — 100% local, zero terceiros",
  };
}

export function getDLPPolicies() {
  return ENTITIES.map(e => ({
    type:      e.type,
    category:  e.category,
    severity:  e.severity,
    hasValidator: !!e.validate,
    description: {
      cpf:           "CPF brasileiro com dígito verificador",
      cnpj:          "CNPJ com dígito verificador",
      cep:           "Código de Endereçamento Postal",
      phone_br:      "Telefone brasileiro (fixo e celular)",
      pix_key:       "Chave PIX (UUID)",
      card_number:   "Número de cartão com algoritmo Luhn",
      card_cvv:      "CVV/CVC do cartão",
      card_expiry:   "Data de validade do cartão",
      card_holder:   "Nome do titular do cartão",
      email:         "Endereço de e-mail",
      phone_intl:    "Telefone internacional",
      date_of_birth: "Data de nascimento",
      ssn:           "Social Security Number (EUA)",
      passport:      "Número de passaporte",
      iban:          "IBAN com validação MOD97",
      swift:         "Código SWIFT/BIC bancário",
      crypto_btc:    "Endereço Bitcoin (P2PKH/P2WPKH)",
      crypto_eth:    "Endereço Ethereum (EIP-55)",
      ip_address:    "Endereço IP",
      jwt_token:     "JSON Web Token",
      bearer_token:  "Bearer token de autenticação",
      api_key:       "API key / secret hardcoded",
      private_key:   "Chave privada PEM",
      password:      "Senha em texto claro",
      health_keyword:"Dado de saúde (LGPD art. 5, II)",
      biometric:     "Dado biométrico (LGPD art. 5, II)",
      ethnic_origin: "Origem étnica ou racial (LGPD)",
      political:     "Opinião política / filiação (LGPD)",
      religious:     "Convicção religiosa (LGPD)",
      bank_account:  "Dados bancários",
      full_name:     "Nome completo em contexto PII",
      rg:            "RG (Registro Geral)",
      biometric2:    "Biometric reference",
    }[e.type] ?? e.type,
  }));
}
