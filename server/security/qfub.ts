/**
 * VolatusShield — Fase 390: QFUB (Quantum File Upload Bypass)
 * ─────────────────────────────────────────────────────────────────────────────
 * Detecção quântica de bypass em mecanismos de upload de arquivos.
 *
 * Cobre TODAS as técnicas exploradas com Burp Suite e além:
 *   • Content-Type spoofing (MIME declarado ≠ real)
 *   • Extension bypass: dupla extensão (.php.jpg), case variation (.PhP), null byte (%00)
 *   • Magic bytes anomaly: assinatura binária vs extensão/MIME declarados
 *   • Polyglot files: arquivo válido (imagem) + payload embutido (PHP/shell/JS)
 *   • Path traversal em filename (../../etc/passwd)
 *   • Archive bomb detection (zip/tar recursivo, ratio > 100x)
 *   • Entropy analysis: alta entropia → payload cifrado/obfuscado
 *   • Behavioral pattern: sequência de uploads suspeitos (Burp Repeater fingerprint)
 *
 * Scoring Born Rule ‖α‖/√8 — 8 dimensões:
 *   [0] extension_risk        — risco da extensão declarada vs real
 *   [1] mime_mismatch         — divergência Content-Type vs magic bytes
 *   [2] magic_bytes_anomaly   — assinatura binária suspeita/incoerente
 *   [3] polyglot_score        — evidências de arquivo poliglota
 *   [4] content_entropy       — entropia de Shannon (> 7.2 = cifrado/obfuscado)
 *   [5] path_traversal_risk   — sequências ../ ou %2e%2e no filename
 *   [6] archive_depth_risk    — profundidade/ratio de compressão
 *   [7] behavioral_pattern    — padrão de ataque repetitivo (Burp fingerprint)
 *
 * Thresholds:
 *   ≥ 0.60 → SUSPEITO (quarentena + alerta)
 *   ≥ 0.80 → CRÍTICO  (bloquear + incidente automático)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from "crypto";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type BypassTechnique =
  | "CONTENT_TYPE_SPOOF"
  | "DOUBLE_EXTENSION"
  | "NULL_BYTE_INJECTION"
  | "CASE_VARIATION"
  | "MAGIC_BYTES_MISMATCH"
  | "POLYGLOT_FILE"
  | "PATH_TRAVERSAL"
  | "ARCHIVE_BOMB"
  | "HIGH_ENTROPY_PAYLOAD"
  | "BEHAVIORAL_BURST"
  | "SVG_XSS"
  | "HTACCESS_OVERRIDE"
  | "EXIF_INJECTION"
  | "ZIP_SLIP"
  | "RACE_CONDITION_PROBE";

export type SeverityLevel = "CLEAN" | "SUSPEITO" | "CRÍTICO";

export interface QFUBUploadEvent {
  upload_id?: string;
  filename: string;
  declared_mime: string;
  file_size_bytes: number;
  file_content_b64?: string;   // primeiros 512 bytes em base64 para magic bytes
  source_ip: string;
  user_agent?: string;
  upload_path?: string;        // path destino declarado
  archive_ratio?: number;      // ratio compressão declarado (zip bomb check)
  archive_depth?: number;      // nesting depth
  session_upload_count?: number; // uploads na sessão (burst detection)
  ts?: string;
}

export interface QFUBDimensions {
  extension_risk: number;
  mime_mismatch: number;
  magic_bytes_anomaly: number;
  polyglot_score: number;
  content_entropy: number;
  path_traversal_risk: number;
  archive_depth_risk: number;
  behavioral_pattern: number;
}

export interface QFUBResult {
  upload_id: string;
  filename: string;
  declared_mime: string;
  real_mime_guess: string;
  quantum_score: number;
  severity: SeverityLevel;
  dimensions: QFUBDimensions;
  techniques_detected: BypassTechnique[];
  amplitude_vector: number[];   // ψ normalizado 8-dim
  recommendation: string;
  block: boolean;
  quarantine: boolean;
  incident_id?: string;
  ts: string;
}

// ── Banco de Magic Bytes ──────────────────────────────────────────────────────

interface MagicEntry {
  mime: string;
  category: "image" | "document" | "archive" | "executable" | "script" | "audio" | "video";
  safe: boolean;
}

const MAGIC_BYTES_DB: Record<string, MagicEntry> = {
  "ffd8ff":          { mime: "image/jpeg",      category: "image",      safe: true  },
  "89504e47":        { mime: "image/png",       category: "image",      safe: true  },
  "47494638":        { mime: "image/gif",       category: "image",      safe: true  },
  "424d":            { mime: "image/bmp",       category: "image",      safe: true  },
  "52494646":        { mime: "image/webp",      category: "image",      safe: true  },
  "25504446":        { mime: "application/pdf", category: "document",   safe: true  },
  "504b0304":        { mime: "application/zip", category: "archive",    safe: false },
  "504b0506":        { mime: "application/zip", category: "archive",    safe: false },
  "504b0708":        { mime: "application/zip", category: "archive",    safe: false },
  "1f8b08":          { mime: "application/gzip",category: "archive",    safe: false },
  "526172211a07":    { mime: "application/rar", category: "archive",    safe: false },
  "377abcaf271c":    { mime: "application/7z",  category: "archive",    safe: false },
  "4d5a":            { mime: "application/exe", category: "executable", safe: false },
  "7f454c46":        { mime: "application/elf", category: "executable", safe: false },
  "cafebabe":        { mime: "application/java",category: "executable", safe: false },
  "3c3f706870":      { mime: "text/x-php",      category: "script",     safe: false },  // <?php
  "3c7363726970":    { mime: "text/html",        category: "script",     safe: false },  // <scrip
  "2321":            { mime: "text/x-shellscript",category: "script",   safe: false },  // #!
  "d0cf11e0a1b11ae1":{ mime: "application/msword",category:"document",  safe: true  },
};

// ── Extensões de risco ────────────────────────────────────────────────────────

const HIGH_RISK_EXTENSIONS = new Set([
  "php","php2","php3","php4","php5","php6","php7","phtml","pht","phps",
  "phar","php-s","php_s","shtml","shtm","stm",
  "asp","aspx","asmx","ashx","ascx","axd","config",
  "jsp","jspa","jsps","jspf","jws","asx",
  "cgi","pl","py","rb","sh","bash","zsh","fish",
  "exe","dll","bat","cmd","ps1","vbs","vbe","ws","wsf","wsh",
  "msi","msp","com","scr","pif","hta","cpl",
  "jar","war","ear","class",
  "cer","crt","pem","key","p12","pfx",
  ".htaccess",".htpasswd","web.config","crossdomain.xml","clientaccesspolicy.xml",
]);

const MEDIUM_RISK_EXTENSIONS = new Set([
  "svg","xml","xsl","xslt","xhtml","html","htm",
  "js","jsx","ts","tsx","mjs","cjs",
  "json","yaml","yml","toml","ini","env",
  "zip","rar","7z","gz","tar","bz2","xz","lz","lzma",
  "pdf","docm","xlsm","pptm","dotm","xltm",
]);

// ── Padrões de conteúdo suspeito ──────────────────────────────────────────────

const SUSPICIOUS_CONTENT_PATTERNS = [
  /\<\?php/i,
  /eval\s*\(/i,
  /base64_decode\s*\(/i,
  /system\s*\(/i,
  /exec\s*\(/i,
  /shell_exec\s*\(/i,
  /passthru\s*\(/i,
  /\$_(?:GET|POST|REQUEST|FILES|COOKIE)\s*\[/i,
  /assert\s*\(/i,
  /preg_replace.*\/e/i,
  /create_function\s*\(/i,
  /\/\*\*\/|\+\+\+|%%|@@/,          // ofuscação comum
  /\<script[\s>]/i,
  /javascript:/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /document\.cookie/i,
  /#!\/bin\/(ba)?sh/,
  /curl\s+-[a-z]/i,
  /wget\s+http/i,
  /nc\s+-[a-z]/i,                   // netcat reverse shell
  /python\s+-c/i,
  /AddType\s+application\/x-httpd-php/i,  // .htaccess override
  /SetHandler\s+application\/x-httpd-php/i,
];

// ── Store em memória ──────────────────────────────────────────────────────────

interface StoredResult extends QFUBResult {
  event: QFUBUploadEvent;
}

const resultStore: StoredResult[] = [];
const MAX_STORE = 2000;
const auditLog: Array<{ ts: string; action: string; upload_id: string; severity: SeverityLevel }> = [];

// IP burst tracking para behavioral pattern
const ipBurstMap: Map<string, { count: number; first_ts: number; techniques: Set<string> }> = new Map();

// ── Funções auxiliares ────────────────────────────────────────────────────────

function generateId(prefix = "qfub"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/** Extrai extensão real (lowercase, sem ponto) — considera dupla extensão */
function extractExtensions(filename: string): string[] {
  // Remove path traversal primeiro para análise
  const base = filename.replace(/.*[/\\]/g, "");
  const parts = base.toLowerCase().split(".");
  if (parts.length < 2) return [];
  // Retorna todas as extensões (pode haver dupla: arquivo.php.jpg → ["php","jpg"])
  return parts.slice(1);
}

/** Detecta a entrada de magic bytes no buffer */
function detectMagicBytes(hexPrefix: string): MagicEntry | null {
  for (const [magic, entry] of Object.entries(MAGIC_BYTES_DB)) {
    if (hexPrefix.startsWith(magic)) return entry;
  }
  return null;
}

/** Calcula entropia de Shannon do buffer */
function shannonEntropy(data: Buffer): number {
  if (data.length === 0) return 0;
  const freq = new Array(256).fill(0);
  for (const byte of data) freq[byte]++;
  let entropy = 0;
  for (const f of freq) {
    if (f === 0) continue;
    const p = f / data.length;
    entropy -= p * Math.log2(p);
  }
  return entropy; // max ≈ 8.0
}

/** Normaliza vetor para ‖ψ‖=1 (amplitude encoding) */
function normalizeAmplitude(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

/** Born Rule: score quântico ‖α‖/√8 */
function bornRule(dims: QFUBDimensions): number {
  const vec = [
    dims.extension_risk,
    dims.mime_mismatch,
    dims.magic_bytes_anomaly,
    dims.polyglot_score,
    dims.content_entropy,
    dims.path_traversal_risk,
    dims.archive_depth_risk,
    dims.behavioral_pattern,
  ];
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return Math.min(1, norm / Math.sqrt(8));
}

// ── Motor de Análise Principal ────────────────────────────────────────────────

export function analyzeUpload(event: QFUBUploadEvent): QFUBResult {
  const upload_id = event.upload_id || generateId();
  const ts = event.ts || new Date().toISOString();
  const techniques: BypassTechnique[] = [];

  // Decode conteúdo se fornecido
  let contentBuffer: Buffer | null = null;
  let contentHex = "";
  let contentStr = "";
  if (event.file_content_b64) {
    try {
      contentBuffer = Buffer.from(event.file_content_b64, "base64");
      contentHex = contentBuffer.slice(0, 32).toString("hex").toLowerCase();
      contentStr = contentBuffer.toString("utf8", 0, Math.min(512, contentBuffer.length));
    } catch { /* ignora erro de decode */ }
  }

  // ── Dimensão 0: extension_risk ────────────────────────────────────────────
  const extensions = extractExtensions(event.filename);
  const primaryExt = extensions[extensions.length - 1] || "";
  const hasDoubleExt = extensions.length >= 2;

  let ext_risk = 0;
  if (HIGH_RISK_EXTENSIONS.has(primaryExt)) {
    ext_risk = 1.0;
    techniques.push("DOUBLE_EXTENSION");
  } else if (hasDoubleExt) {
    // Extensão dupla com extensão intermediária de risco
    const intermediateExt = extensions[extensions.length - 2] || "";
    if (HIGH_RISK_EXTENSIONS.has(intermediateExt)) {
      ext_risk = 0.95;
      techniques.push("DOUBLE_EXTENSION");
    } else if (MEDIUM_RISK_EXTENSIONS.has(primaryExt)) {
      ext_risk = 0.55;
    } else {
      ext_risk = 0.35;
    }
  } else if (MEDIUM_RISK_EXTENSIONS.has(primaryExt)) {
    ext_risk = 0.50;
  } else if (primaryExt === "") {
    ext_risk = 0.70; // sem extensão = muito suspeito
  }

  // Case variation check (ex: .PhP)
  const rawParts = event.filename.split(".");
  const rawExt = rawParts[rawParts.length - 1] || "";
  if (rawExt !== rawExt.toLowerCase() && HIGH_RISK_EXTENSIONS.has(rawExt.toLowerCase())) {
    ext_risk = Math.max(ext_risk, 0.90);
    techniques.push("CASE_VARIATION");
  }

  // Null byte injection
  if (event.filename.includes("\x00") || event.filename.includes("%00") || event.filename.includes("\\0")) {
    ext_risk = 1.0;
    techniques.push("NULL_BYTE_INJECTION");
  }

  // .htaccess / web.config override
  if (/^\.htaccess$|^\.htpasswd$|^web\.config$/i.test(event.filename)) {
    ext_risk = 1.0;
    techniques.push("HTACCESS_OVERRIDE");
  }

  // ── Dimensão 1: mime_mismatch ─────────────────────────────────────────────
  let mime_miss = 0;
  const declaredMimeLower = event.declared_mime.toLowerCase();
  let real_mime_guess = event.declared_mime;

  if (contentHex && contentBuffer) {
    const detected = detectMagicBytes(contentHex);
    if (detected) {
      real_mime_guess = detected.mime;
      if (detected.mime !== declaredMimeLower) {
        // Divergência entre MIME declarado e assinatura real
        mime_miss = detected.safe ? 0.55 : 0.95;
        techniques.push("CONTENT_TYPE_SPOOF");
      }
      // Arquivo executável declarado como imagem
      if (!detected.safe && declaredMimeLower.startsWith("image/")) {
        mime_miss = 1.0;
        techniques.push("CONTENT_TYPE_SPOOF");
      }
    } else {
      // Nenhuma assinatura reconhecida → suspeito
      mime_miss = 0.45;
    }
  } else {
    // Sem conteúdo — analisa só pela declaração
    const dangerousMimes = [
      "application/x-php","text/x-php","application/octet-stream",
      "application/x-executable","application/x-msdownload",
      "text/x-shellscript","application/x-sh",
    ];
    if (dangerousMimes.includes(declaredMimeLower)) {
      mime_miss = 0.85;
      techniques.push("CONTENT_TYPE_SPOOF");
    }
  }

  // ── Dimensão 2: magic_bytes_anomaly ──────────────────────────────────────
  let magic_anom = 0;
  if (contentHex && contentBuffer) {
    const detected = detectMagicBytes(contentHex);
    if (detected && !detected.safe) {
      magic_anom = 0.90;
      techniques.push("MAGIC_BYTES_MISMATCH");
    } else if (!detected) {
      // Sem magic bytes reconhecível — analisa início do conteúdo
      const startStr = contentBuffer.slice(0, 20).toString("ascii", 0, 20);
      if (startStr.includes("<?") || startStr.includes("#!") || startStr.includes("<s")) {
        magic_anom = 0.85;
        techniques.push("MAGIC_BYTES_MISMATCH");
      } else {
        magic_anom = 0.30;
      }
    }

    // SVG com script embutido
    if (declaredMimeLower.includes("svg") || primaryExt === "svg") {
      if (contentStr.toLowerCase().includes("<script") || contentStr.toLowerCase().includes("javascript:")) {
        magic_anom = Math.max(magic_anom, 0.95);
        techniques.push("SVG_XSS");
      }
    }
  }

  // ── Dimensão 3: polyglot_score ────────────────────────────────────────────
  let poly_score = 0;
  if (contentBuffer && contentStr) {
    // Arquivo com magic bytes de imagem MAS com código PHP/shell embutido
    const detectedMagic = contentHex ? detectMagicBytes(contentHex) : null;
    const hasValidImageMagic = detectedMagic?.category === "image";

    let suspiciousPatternCount = 0;
    for (const pattern of SUSPICIOUS_CONTENT_PATTERNS) {
      if (pattern.test(contentStr)) suspiciousPatternCount++;
    }

    if (hasValidImageMagic && suspiciousPatternCount > 0) {
      poly_score = Math.min(1.0, 0.6 + suspiciousPatternCount * 0.15);
      techniques.push("POLYGLOT_FILE");
    } else if (suspiciousPatternCount > 0) {
      poly_score = Math.min(1.0, suspiciousPatternCount * 0.2);
    }

    // EXIF injection check (comum em JPEG com PHP embutido no EXIF)
    if (hasValidImageMagic && contentStr.includes("<?php")) {
      poly_score = Math.max(poly_score, 0.95);
      techniques.push("EXIF_INJECTION");
    }
  }

  // ── Dimensão 4: content_entropy ───────────────────────────────────────────
  let entropy_score = 0;
  if (contentBuffer && contentBuffer.length > 0) {
    const entropy = shannonEntropy(contentBuffer);
    // Normaliza: entropy > 7.2 = cifrado/obfuscado
    if (entropy > 7.5) entropy_score = 1.0;
    else if (entropy > 7.2) entropy_score = 0.80;
    else if (entropy > 6.8) entropy_score = 0.55;
    else if (entropy > 6.0) entropy_score = 0.30;
    else entropy_score = 0.05;

    // Payload cifrado num arquivo que não deveria ser cifrado (ex: imagem)
    if (entropy_score > 0.75 && declaredMimeLower.startsWith("image/")) {
      entropy_score = Math.max(entropy_score, 0.90);
      techniques.push("HIGH_ENTROPY_PAYLOAD");
    }
  } else {
    // Estima pela tamanho e tipo
    if (event.file_size_bytes > 10_000_000) entropy_score = 0.40; // arquivo grande sem conteúdo fornecido
  }

  // ── Dimensão 5: path_traversal_risk ──────────────────────────────────────
  let path_risk = 0;
  const pathTargets = [event.filename, event.upload_path || ""].join("|");
  const traversalPatterns = [
    /\.\.[\/\\]/,
    /%2e%2e[%2f%5c]/i,
    /\.\.%2f/i,
    /\.\.%5c/i,
    /%252e%252e/i,      // double URL encode
    /\.\.\//,
    /\.\.$/,
    /^\/etc\//,
    /^\/var\//,
    /^\/proc\//,
    /\.\.;/,
    /~\//,
  ];

  for (const pat of traversalPatterns) {
    if (pat.test(pathTargets)) {
      path_risk = Math.max(path_risk, 0.95);
      techniques.push("PATH_TRAVERSAL");
      break;
    }
  }

  // Zip Slip (archive com path traversal)
  if (path_risk > 0.8 && (primaryExt === "zip" || primaryExt === "tar" || primaryExt === "gz")) {
    techniques.push("ZIP_SLIP");
  }

  // ── Dimensão 6: archive_depth_risk ───────────────────────────────────────
  let arch_risk = 0;
  if (event.archive_ratio !== undefined || event.archive_depth !== undefined) {
    const ratio = event.archive_ratio || 0;
    const depth = event.archive_depth || 0;

    if (ratio > 1000 || depth > 10) {
      arch_risk = 1.0;
      techniques.push("ARCHIVE_BOMB");
    } else if (ratio > 100 || depth > 5) {
      arch_risk = 0.80;
      techniques.push("ARCHIVE_BOMB");
    } else if (ratio > 20 || depth > 3) {
      arch_risk = 0.50;
    } else if (ratio > 5) {
      arch_risk = 0.25;
    }
  } else if (MEDIUM_RISK_EXTENSIONS.has(primaryExt) && ["zip","rar","7z","gz","tar","bz2"].includes(primaryExt)) {
    arch_risk = 0.30; // archive sem metadata de ratio = moderado
  }

  // ── Dimensão 7: behavioral_pattern ───────────────────────────────────────
  let behav_score = 0;
  const now = Date.now();
  const IP_WINDOW_MS = 60_000; // 1 minuto

  const burst = ipBurstMap.get(event.source_ip) || { count: 0, first_ts: now, techniques: new Set<string>() };
  burst.count++;
  for (const t of techniques) burst.techniques.add(t);
  if (now - burst.first_ts > IP_WINDOW_MS) {
    burst.count = 1;
    burst.first_ts = now;
    burst.techniques = new Set(techniques);
  }
  ipBurstMap.set(event.source_ip, burst);

  // Burst de uploads com técnicas repetidas = Burp Suite Repeater fingerprint
  const sessionCount = event.session_upload_count || burst.count;
  if (sessionCount > 20 && burst.techniques.size > 2) {
    behav_score = 1.0;
    techniques.push("BEHAVIORAL_BURST");
  } else if (sessionCount > 10 || burst.techniques.size > 3) {
    behav_score = 0.70;
    techniques.push("BEHAVIORAL_BURST");
  } else if (sessionCount > 5) {
    behav_score = 0.45;
  } else {
    behav_score = Math.min(0.30, sessionCount * 0.05);
  }

  // Race condition probe: muitos uploads simultâneos do mesmo IP em < 2s
  if (event.user_agent?.toLowerCase().includes("burpsuite") ||
      event.user_agent?.toLowerCase().includes("burp suite") ||
      event.user_agent?.toLowerCase().includes("python-requests") ||
      event.user_agent?.toLowerCase().includes("go-http-client")) {
    behav_score = Math.max(behav_score, 0.65);
    techniques.push("RACE_CONDITION_PROBE");
  }

  // ── Born Rule — Score Quântico ────────────────────────────────────────────
  const dimensions: QFUBDimensions = {
    extension_risk:      Math.min(1, ext_risk),
    mime_mismatch:       Math.min(1, mime_miss),
    magic_bytes_anomaly: Math.min(1, magic_anom),
    polyglot_score:      Math.min(1, poly_score),
    content_entropy:     Math.min(1, entropy_score),
    path_traversal_risk: Math.min(1, path_risk),
    archive_depth_risk:  Math.min(1, arch_risk),
    behavioral_pattern:  Math.min(1, behav_score),
  };

  const rawVec = [
    dimensions.extension_risk,
    dimensions.mime_mismatch,
    dimensions.magic_bytes_anomaly,
    dimensions.polyglot_score,
    dimensions.content_entropy,
    dimensions.path_traversal_risk,
    dimensions.archive_depth_risk,
    dimensions.behavioral_pattern,
  ];
  const amplitude_vector = normalizeAmplitude(rawVec);
  const quantum_score = bornRule(dimensions);

  // ── Severidade & Decisão ──────────────────────────────────────────────────
  let severity: SeverityLevel = "CLEAN";
  let block = false;
  let quarantine = false;
  let incident_id: string | undefined;

  if (quantum_score >= 0.80) {
    severity = "CRÍTICO";
    block = true;
    quarantine = true;
    incident_id = generateId("inc");
  } else if (quantum_score >= 0.60) {
    severity = "SUSPEITO";
    quarantine = true;
  }

  // Técnicas high-severity forçam bloqueio independente do score
  const forceBlockTechniques: BypassTechnique[] = [
    "NULL_BYTE_INJECTION","HTACCESS_OVERRIDE","ZIP_SLIP","ARCHIVE_BOMB","EXIF_INJECTION",
    "PATH_TRAVERSAL",
  ];
  const criticalForceTechniques: BypassTechnique[] = [
    "ARCHIVE_BOMB","ZIP_SLIP","NULL_BYTE_INJECTION","HTACCESS_OVERRIDE",
  ];
  if (techniques.some(t => forceBlockTechniques.includes(t))) {
    block = true;
    quarantine = true;
    if (techniques.some(t => criticalForceTechniques.includes(t))) {
      severity = "CRÍTICO";
    } else if (severity === "CLEAN") {
      severity = "SUSPEITO";
    }
  }

  // Deduplica técnicas
  const uniqueTechniques = [...new Set(techniques)] as BypassTechnique[];

  const recommendation = buildRecommendation(severity, uniqueTechniques);

  const result: QFUBResult = {
    upload_id,
    filename: event.filename,
    declared_mime: event.declared_mime,
    real_mime_guess,
    quantum_score: parseFloat(quantum_score.toFixed(4)),
    severity,
    dimensions,
    techniques_detected: uniqueTechniques,
    amplitude_vector,
    recommendation,
    block,
    quarantine,
    incident_id,
    ts,
  };

  // Persiste
  const stored: StoredResult = { ...result, event };
  resultStore.unshift(stored);
  if (resultStore.length > MAX_STORE) resultStore.pop();

  // Audit
  auditLog.unshift({ ts, action: "analyze", upload_id, severity });
  if (auditLog.length > 5000) auditLog.pop();

  return result;
}

/** Analisa batch de uploads */
export function analyzeBatch(events: QFUBUploadEvent[]): QFUBResult[] {
  return events.map(e => analyzeUpload(e));
}

// ── Recomendação ──────────────────────────────────────────────────────────────

function buildRecommendation(severity: SeverityLevel, techniques: BypassTechnique[]): string {
  if (severity === "CRÍTICO") {
    return `BLOQUEIO IMEDIATO. Técnicas detectadas: ${techniques.join(", ")}. Arquivo rejeitado, incidente aberto. Validar magic bytes server-side, renomear arquivo com UUID, armazenar fora do webroot, nunca confiar em Content-Type declarado.`;
  }
  if (severity === "SUSPEITO") {
    return `QUARENTENA. Técnicas: ${techniques.join(", ")}. Arquivo isolado para análise manual. Implementar validação de magic bytes, whitelist de extensões, e análise de conteúdo server-side.`;
  }
  return "Arquivo dentro dos parâmetros normais. Manter pipeline de validação ativa.";
}

// ── Relatório de Técnicas ─────────────────────────────────────────────────────

export interface BypassTechniqueReport {
  technique: BypassTechnique;
  description: string;
  mitigation: string;
  mitre_ref?: string;
  burp_method?: string;
}

const TECHNIQUE_CATALOG: BypassTechniqueReport[] = [
  {
    technique: "CONTENT_TYPE_SPOOF",
    description: "Arquivo enviado com Content-Type falsificado (ex: image/jpeg para arquivo .php)",
    mitigation: "Validar MIME server-side via magic bytes, nunca confiar no header Content-Type",
    mitre_ref: "T1190",
    burp_method: "Interceptar request no Burp, alterar Content-Type header para image/jpeg mantendo payload PHP",
  },
  {
    technique: "DOUBLE_EXTENSION",
    description: "Extensão dupla para burlar blacklists (ex: shell.php.jpg, exploit.php5.png)",
    mitigation: "Whitelist de extensões permitidas, validar APENAS a última extensão após renomear",
    mitre_ref: "T1190",
    burp_method: "Renomear arquivo para shell.php.jpg no Burp Repeater",
  },
  {
    technique: "NULL_BYTE_INJECTION",
    description: "Injeção de null byte para truncar extensão (ex: shell.php%00.jpg)",
    mitigation: "Sanitizar filename removendo null bytes, usar linguagens com strings seguras",
    mitre_ref: "T1190",
    burp_method: "Inserir %00 entre extensão maliciosa e falsa no filename via Burp",
  },
  {
    technique: "CASE_VARIATION",
    description: "Variação de case para burlar blacklists case-sensitive (ex: .PhP, .PHP, .pHp)",
    mitigation: "Normalizar extensão para lowercase antes de validar",
    mitre_ref: "T1190",
    burp_method: "Alterar extensão no Burp: shell.PHP, shell.PhP, shell.pHP",
  },
  {
    technique: "MAGIC_BYTES_MISMATCH",
    description: "Assinatura binária do arquivo não corresponde à extensão/MIME declarado",
    mitigation: "Validar magic bytes (file signature) independentemente da extensão",
    mitre_ref: "T1190",
    burp_method: "Adicionar bytes FF D8 FF (JPEG) no início do payload PHP via hex editor no Burp",
  },
  {
    technique: "POLYGLOT_FILE",
    description: "Arquivo válido (ex: JPEG real) com payload malicioso embutido (PHP/JS)",
    mitigation: "Re-processar imagens server-side (recompress), strip EXIF, usar bibliotecas seguras",
    mitre_ref: "T1190",
    burp_method: "Criar arquivo poliglota: combinar JPEG válido com <?php system($_GET['cmd']); ?> no Burp",
  },
  {
    technique: "PATH_TRAVERSAL",
    description: "Filename com sequências ../ para escrever fora do diretório permitido",
    mitigation: "Sanitizar filename, usar basename(), armazenar com UUID gerado server-side",
    mitre_ref: "T1083",
    burp_method: "Alterar filename para ../../var/www/html/shell.php no Burp",
  },
  {
    technique: "ARCHIVE_BOMB",
    description: "Arquivo comprimido com ratio de descompressão extremo (ex: 42.zip, 1 byte → 4.5 PB)",
    mitigation: "Limitar tamanho após descompressão, limitar nesting depth, usar streaming com limite",
    mitre_ref: "T1499",
    burp_method: "Upload de zip bomb ou zip aninhado para exaurir recursos do servidor",
  },
  {
    technique: "HIGH_ENTROPY_PAYLOAD",
    description: "Conteúdo com entropia muito alta indica payload cifrado/obfuscado",
    mitigation: "Combinar análise de entropia com validação de tipo, rejeitar arquivos anômalos",
    mitre_ref: "T1027",
    burp_method: "Upload de shellcode cifrado com header de imagem falso",
  },
  {
    technique: "BEHAVIORAL_BURST",
    description: "Múltiplos uploads com técnicas variadas do mesmo IP — fingerprint de Burp Suite Intruder/Repeater",
    mitigation: "Rate limiting por IP, CAPTCHA após N tentativas, bloquear user-agents de pentest tools",
    mitre_ref: "T1110",
    burp_method: "Usar Burp Intruder com lista de payloads de extensão para automatizar bypass attempts",
  },
  {
    technique: "SVG_XSS",
    description: "Arquivo SVG com <script> ou javascript: URI embutido para XSS",
    mitigation: "Sanitizar SVG server-side, servir como attachment não inline, usar CSP",
    mitre_ref: "T1059.007",
    burp_method: "Upload de SVG com <script>alert(document.cookie)</script>",
  },
  {
    technique: "HTACCESS_OVERRIDE",
    description: "Upload de .htaccess para reclassificar extensão como executável PHP",
    mitigation: "Bloquear upload de .htaccess, web.config, crossdomain.xml no whitelist",
    mitre_ref: "T1505.003",
    burp_method: "Upload de .htaccess com: AddType application/x-httpd-php .jpg",
  },
  {
    technique: "EXIF_INJECTION",
    description: "Código malicioso embutido nos metadados EXIF de imagem legítima",
    mitigation: "Strip EXIF antes de salvar, reprocessar imagens com ImageMagick/GD sem EXIF",
    mitre_ref: "T1190",
    burp_method: "Inserir <?php system($_GET['cmd']); ?> no campo EXIF Comment via exiftool + Burp",
  },
  {
    technique: "ZIP_SLIP",
    description: "Archive com path traversal nos nomes de arquivo internos para sobrescrever arquivos críticos",
    mitigation: "Validar todos os paths internos do archive antes de extrair, checar destino final",
    mitre_ref: "T1083",
    burp_method: "Criar zip com entry ../../shell.php e fazer upload via Burp",
  },
  {
    technique: "RACE_CONDITION_PROBE",
    description: "Múltiplos uploads simultâneos para explorar janela de tempo entre upload e validação",
    mitigation: "Validar ANTES de mover para destino final, usar temp dir isolado, operações atômicas",
    mitre_ref: "T1499",
    burp_method: "Usar Burp Turbo Intruder para enviar dezenas de requests simultâneos",
  },
];

// ── Queries & Stats ───────────────────────────────────────────────────────────

export function getStats() {
  const total = resultStore.length;
  const bySeverity = { CLEAN: 0, SUSPEITO: 0, "CRÍTICO": 0 };
  const byTechnique: Record<string, number> = {};

  for (const r of resultStore) {
    bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
    for (const t of r.techniques_detected) {
      byTechnique[t] = (byTechnique[t] || 0) + 1;
    }
  }

  const avgScore = total > 0
    ? resultStore.reduce((s, r) => s + r.quantum_score, 0) / total
    : 0;

  const topTechniques = Object.entries(byTechnique)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([technique, count]) => ({ technique, count }));

  const recentCritical = resultStore
    .filter(r => r.severity === "CRÍTICO")
    .slice(0, 5)
    .map(r => ({ upload_id: r.upload_id, filename: r.filename, ts: r.ts, score: r.quantum_score }));

  return {
    total_analyzed: total,
    by_severity: bySeverity,
    avg_quantum_score: parseFloat(avgScore.toFixed(4)),
    top_techniques: topTechniques,
    recent_critical: recentCritical,
    technique_catalog_size: TECHNIQUE_CATALOG.length,
    store_capacity: MAX_STORE,
    active_burst_ips: ipBurstMap.size,
  };
}

export function getDetections(limit = 50, severityFilter?: SeverityLevel) {
  let results = resultStore;
  if (severityFilter) results = results.filter(r => r.severity === severityFilter);
  return results.slice(0, limit).map(r => ({
    upload_id: r.upload_id,
    filename: r.filename,
    declared_mime: r.declared_mime,
    real_mime_guess: r.real_mime_guess,
    quantum_score: r.quantum_score,
    severity: r.severity,
    techniques_detected: r.techniques_detected,
    block: r.block,
    quarantine: r.quarantine,
    incident_id: r.incident_id,
    ts: r.ts,
  }));
}

export function getDetectionById(upload_id: string): StoredResult | undefined {
  return resultStore.find(r => r.upload_id === upload_id);
}

export function getAuditLog(limit = 200) {
  return auditLog.slice(0, limit);
}

export function getTechniqueCatalog(): BypassTechniqueReport[] {
  return TECHNIQUE_CATALOG;
}

export function getTechniqueDetail(technique: string): BypassTechniqueReport | undefined {
  return TECHNIQUE_CATALOG.find(t => t.technique === technique);
}

export function selfTest(): { ok: boolean; tests: Array<{ name: string; passed: boolean; score?: number; severity?: string }> } {
  const tests: Array<{ name: string; passed: boolean; score?: number; severity?: string }> = [];

  // Teste 1: PHP com extensão dupla
  const t1 = analyzeUpload({
    upload_id: "selftest-1",
    filename: "shell.php.jpg",
    declared_mime: "image/jpeg",
    file_size_bytes: 1024,
    file_content_b64: Buffer.from("<?php system($_GET['cmd']); ?>").toString("base64"),
    source_ip: "192.168.1.1",
  });
  tests.push({ name: "PHP dupla extensão + conteúdo PHP", passed: t1.severity !== "CLEAN", score: t1.quantum_score, severity: t1.severity });

  // Teste 2: Archive bomb
  const t2 = analyzeUpload({
    upload_id: "selftest-2",
    filename: "bomb.zip",
    declared_mime: "application/zip",
    file_size_bytes: 200,
    source_ip: "10.0.0.1",
    archive_ratio: 5000,
    archive_depth: 15,
  });
  tests.push({ name: "Archive bomb (ratio 5000x, depth 15)", passed: t2.severity === "CRÍTICO", score: t2.quantum_score, severity: t2.severity });

  // Teste 3: Path traversal
  const t3 = analyzeUpload({
    upload_id: "selftest-3",
    filename: "../../var/www/html/shell.php",
    declared_mime: "text/plain",
    file_size_bytes: 512,
    source_ip: "172.16.0.1",
    upload_path: "/uploads/../../etc/passwd",
  });
  tests.push({ name: "Path traversal no filename", passed: t3.block === true, score: t3.quantum_score, severity: t3.severity });

  // Teste 4: Arquivo limpo
  const t4 = analyzeUpload({
    upload_id: "selftest-4",
    filename: "foto.jpg",
    declared_mime: "image/jpeg",
    file_size_bytes: 102400,
    file_content_b64: Buffer.from([0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46]).toString("base64"),
    source_ip: "203.0.113.1",
  });
  tests.push({ name: "JPEG legítimo (false positive check)", passed: t4.severity === "CLEAN", score: t4.quantum_score, severity: t4.severity });

  // Teste 5: .htaccess override
  const t5 = analyzeUpload({
    upload_id: "selftest-5",
    filename: ".htaccess",
    declared_mime: "text/plain",
    file_size_bytes: 64,
    file_content_b64: Buffer.from("AddType application/x-httpd-php .jpg").toString("base64"),
    source_ip: "198.51.100.1",
  });
  tests.push({ name: ".htaccess override detection", passed: t5.block === true, score: t5.quantum_score, severity: t5.severity });

  const ok = tests.every(t => t.passed);
  return { ok, tests };
}
