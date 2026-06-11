/**
 * VolatusShield — Fase 117: Adaptive Deception Engine
 *
 * Gera endpoints falsos dinâmicos e personalizados por atacante para confundir scanners.
 *
 *  A. GERAÇÃO DINÂMICA    — árvore de paths falsos baseada no perfil do atacante
 *  B. DECOY SERVICES      — 5 tipos: api_service, admin_panel, config_service,
 *                           db_interface, auth_service
 *  C. RESPOSTAS ADAPTATIVAS — templates determinísticos + QRNG sem API externa
 *  D. TARPIT COGNITIVO    — injeta links falsos para manter o scanner engajado
 *  E. ENGAJAMENTO         — rastreia tempo, hits, "dados extraídos" (todos falsos)
 *  F. AUTO-ATIVAÇÃO       — ativa no 2º hit de honeypot pelo mesmo IP
 *  G. INTEL FEED          — reporta engagement ao threat engine
 *
 * 100% infra própria · zero custo de terceiros · zero dependências físicas externas.
 */

import { createHash }     from "crypto";

import { recordThreatEvent } from "./threat-engine-stub.js";


/* ═══════════════════════════════════════════════════════════════════
   A. TIPOS
   ═══════════════════════════════════════════════════════════════════ */

export type DecoyType =
  | "api_service"
  | "admin_panel"
  | "config_service"
  | "db_interface"
  | "auth_service";

export interface DecoyEndpoint {
  path:        string;
  type:        DecoyType;
  ownerIp:     string | null; // null = global (qualquer IP pode ver)
  expiresAt:   number;
  hitsCount:   number;
  lastHit:     number;
  seed:        number;       // semente determinística para dados falsos
  contentType: string;
  statusCode:  number;
  delayMs:     number;       // tarpit cognitivo: delay artificial
}

export interface DeceptionProfile {
  ip:               string;
  active:           boolean;
  activatedAt:      number;
  lastSeen:         number;
  totalHits:        number;
  engagedMs:        number;   // tempo total que o atacante ficou "ocupado"
  categories:       Set<string>;
  generatedPaths:   Set<string>;
  exfilSimulated:   string[];  // registra o que "extraiu" (tudo falso)
  riskMultiplier:   number;
}

interface DeceptionStats {
  activeProfiles:     number;
  totalEndpoints:     number;
  totalHits:          number;
  totalEngagedMs:     number;
  topCategories:      Record<string, number>;
  autoActivations:    number;
  exfilSimulations:   number;
}

/* ═══════════════════════════════════════════════════════════════════
   B. ESTADO GLOBAL
   ═══════════════════════════════════════════════════════════════════ */

const MAX_ENDPOINTS   = 300;
const ENDPOINT_TTL_MS = 90 * 60_000;     // 90 min
const MAX_DELAY_MS    = 4_000;            // tarpit máximo 4s
const AUTO_ACTIVATE_THRESHOLD = 2;       // 2 hits = ativa deception

const deceptionEndpoints = new Map<string, DecoyEndpoint>();
const deceptionProfiles   = new Map<string, DeceptionProfile>();

const _stats: DeceptionStats = {
  activeProfiles: 0, totalEndpoints: 0, totalHits: 0,
  totalEngagedMs: 0, topCategories: {}, autoActivations: 0, exfilSimulations: 0,
};

/* ═══════════════════════════════════════════════════════════════════
   C. GERAÇÃO DETERMINÍSTICA DE DADOS FALSOS
      Baseada em hash do IP — o mesmo atacante vê sempre os mesmos dados.
      Isso aumenta a credibilidade (não muda a cada request) sem precisar de DB.
   ═══════════════════════════════════════════════════════════════════ */

function seedFromIp(ip: string): number {
  const h = createHash("sha256").update(ip).digest();
  return h.readUInt32LE(0);
}

function seededInt(seed: number, offset: number, max: number): number {
  const mix = (seed ^ (seed << 5) ^ (offset * 2654435761)) >>> 0;
  return mix % max;
}

function seededItem<T>(seed: number, offset: number, items: T[]): T {
  return items[seededInt(seed, offset, items.length)]!;
}

const FAKE_COMPANIES   = ["Acme Corp", "NexaCo", "CoreSys", "DataVault Inc", "HelixTech", "NovaNet"];
const FAKE_DOMAINS     = ["corp.internal", "prod.internal", "infra.local", "net.internal", "svc.local"];
const FAKE_NAMES       = ["alice", "bob", "charlie", "devops", "sysadmin", "superuser", "cloudops", "jenkins"];
const FAKE_DB_NAMES    = ["appdb_prod", "userdata_v2", "analytics_main", "billing_core", "auth_store"];
const FAKE_BUCKETS     = ["backups-prod", "uploads-main", "media-store", "logs-archive", "exports-daily"];
const FAKE_REGIONS     = ["us-east-1", "eu-west-1", "ap-southeast-2", "sa-east-1", "us-west-2"];
const FAKE_ACCESS_IDS  = () => "AKIA" + Math.random().toString(36).slice(2,18).toUpperCase();
const FAKE_SECRET_KEY  = (seed: number) => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/";
  let s = "";
  for (let i = 0; i < 40; i++) s += chars[seededInt(seed, i * 7 + 3, chars.length)];
  return s;
};

function fakeJwt(seed: number): string {
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: `usr_${seededInt(seed, 1, 999999)}`,
    email: `${seededItem(seed, 2, FAKE_NAMES)}@${seededItem(seed, 3, FAKE_DOMAINS)}`,
    role: seededItem(seed, 4, ["admin", "superadmin", "operator"]),
    iat: Math.floor(Date.now() / 1000) - 3600,
    exp: Math.floor(Date.now() / 1000) + 86400,
  })).toString("base64url");
  const sig = createHash("sha256").update(`${header}.${payload}seed${seed}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function fakeUsers(seed: number, count = 5): object[] {
  return Array.from({ length: count }, (_, i) => ({
    id:         seededInt(seed, i + 100, 99999) + 1,
    username:   seededItem(seed, i + 10, FAKE_NAMES),
    email:      `${seededItem(seed, i + 10, FAKE_NAMES)}@${seededItem(seed, i + 20, FAKE_DOMAINS)}`,
    role:       seededItem(seed, i + 30, ["admin", "user", "operator", "readonly", "superadmin"]),
    created_at: new Date(Date.now() - seededInt(seed, i + 40, 86400000 * 365)).toISOString(),
    last_login: new Date(Date.now() - seededInt(seed, i + 50, 86400000)).toISOString(),
    mfa:        seededInt(seed, i + 60, 2) === 1,
    api_key:    createHash("md5").update(`key_${seed}_${i}`).digest("hex"),
  }));
}

function fakeEnvFile(seed: number): string {
  const company = seededItem(seed, 1, FAKE_COMPANIES);
  const domain  = seededItem(seed, 2, FAKE_DOMAINS);
  const dbName  = seededItem(seed, 3, FAKE_DB_NAMES);
  return [
    `NODE_ENV=production`,
    `PORT=3000`,
    `APP_NAME=${company.replace(/ /g,"_").toUpperCase()}`,
    `DB_HOST=db.${domain}`,
    `DB_PORT=5432`,
    `DB_NAME=${dbName}`,
    `DB_USER=appuser`,
    `DB_PASS=${createHash("md5").update(`pw_${seed}`).digest("hex").slice(0,16)}`,
    `REDIS_URL=redis://cache.${domain}:6379`,
    `JWT_SECRET=${createHash("sha256").update(`jwt_${seed}`).digest("hex")}`,
    `SESSION_SECRET=${createHash("sha256").update(`sess_${seed}`).digest("hex")}`,
    `AWS_ACCESS_KEY_ID=AKIA${createHash("md5").update(`ak_${seed}`).digest("hex").toUpperCase().slice(0,16)}`,
    `AWS_SECRET_ACCESS_KEY=${FAKE_SECRET_KEY(seed)}`,
    `AWS_DEFAULT_REGION=${seededItem(seed, 5, FAKE_REGIONS)}`,
    `S3_BUCKET=${seededItem(seed, 6, FAKE_BUCKETS)}`,
    `STRIPE_SECRET=sk_live_${createHash("md5").update(`stripe_${seed}`).digest("hex")}`,
    `SENDGRID_API_KEY=SG.${createHash("md5").update(`sg_${seed}`).digest("hex")}`,
    `OPENAI_API_KEY=sk-proj-${createHash("md5").update(`oai_${seed}`).digest("hex")}`,
  ].join("\n");
}

function fakeAwsCredentials(seed: number): string {
  return [
    "[default]",
    `aws_access_key_id = AKIA${createHash("md5").update(`ak_${seed}`).digest("hex").toUpperCase().slice(0,16)}`,
    `aws_secret_access_key = ${FAKE_SECRET_KEY(seed)}`,
    `region = ${seededItem(seed, 7, FAKE_REGIONS)}`,
    "",
    "[prod]",
    `aws_access_key_id = AKIA${createHash("md5").update(`ak2_${seed}`).digest("hex").toUpperCase().slice(0,16)}`,
    `aws_secret_access_key = ${FAKE_SECRET_KEY(seed + 1)}`,
    `region = ${seededItem(seed, 8, FAKE_REGIONS)}`,
  ].join("\n");
}

function fakeDbDump(seed: number): string {
  const dbName = seededItem(seed, 3, FAKE_DB_NAMES);
  const users  = fakeUsers(seed).map((u: any) =>
    `INSERT INTO users VALUES (${u.id}, '${u.username}', '${u.email}', ` +
    `'$2b$12$${createHash("sha256").update(`pw_${seed}_${u.id}`).digest("hex").slice(0,53)}', ` +
    `'${u.role}', '${u.created_at}');`
  ).join("\n");
  return [
    `-- MySQL dump 10.13 for ${dbName}`,
    `-- Host: db.${seededItem(seed, 2, FAKE_DOMAINS)}  Database: ${dbName}`,
    `-- Date: ${new Date().toISOString()}`,
    ``,
    `/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;`,
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`,
    `USE \`${dbName}\`;`,
    ``,
    `CREATE TABLE \`users\` (`,
    `  \`id\` int NOT NULL AUTO_INCREMENT,`,
    `  \`username\` varchar(255) NOT NULL,`,
    `  \`email\` varchar(255) NOT NULL,`,
    `  \`password_hash\` varchar(60) NOT NULL,`,
    `  \`role\` enum('user','admin','superadmin') DEFAULT 'user',`,
    `  \`created_at\` timestamp NOT NULL,`,
    `  PRIMARY KEY (\`id\`)`,
    `) ENGINE=InnoDB;`,
    ``,
    users,
  ].join("\n");
}

function fakeK8sSecrets(seed: number): object {
  const domain = seededItem(seed, 2, FAKE_DOMAINS);
  return {
    apiVersion: "v1",
    kind: "SecretList",
    metadata: { resourceVersion: seededInt(seed, 99, 999999).toString() },
    items: [
      {
        apiVersion: "v1", kind: "Secret",
        metadata: { name: "db-credentials", namespace: "default", creationTimestamp: new Date(Date.now() - 86400000 * 30).toISOString() },
        type: "Opaque",
        data: {
          password: Buffer.from(createHash("md5").update(`dbpw_${seed}`).digest("hex").slice(0,16)).toString("base64"),
          username: Buffer.from("appuser").toString("base64"),
          host: Buffer.from(`db.${domain}`).toString("base64"),
        }
      },
      {
        apiVersion: "v1", kind: "Secret",
        metadata: { name: "tls-cert", namespace: "default" },
        type: "kubernetes.io/tls",
        data: {
          "tls.crt": Buffer.from("-----BEGIN CERTIFICATE-----\nMIIB...").toString("base64"),
          "tls.key": Buffer.from("-----BEGIN PRIVATE KEY-----\nMIIE...").toString("base64"),
        }
      }
    ]
  };
}

function fakeAdminHtml(seed: number, subPath: string): string {
  const company = seededItem(seed, 1, FAKE_COMPANIES);
  const users   = fakeUsers(seed, 8);
  const userRows = users.map((u: any) =>
    `<tr><td>${u.id}</td><td>${u.username}</td><td>${u.email}</td>` +
    `<td><span class="badge ${u.role === "admin" ? "badge-danger" : "badge-secondary"}">${u.role}</span></td>` +
    `<td>${new Date(u.last_login).toLocaleDateString()}</td>` +
    `<td><a href="/admin/users/${u.id}/edit">Edit</a> | <a href="/admin/users/${u.id}/delete">Delete</a></td></tr>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${company} — Admin Panel</title>
<link rel="stylesheet" href="/admin/assets/bootstrap.min.css">
<style>
  body{font-family:Arial,sans-serif;background:#1a1a2e;color:#eee}
  .sidebar{width:220px;background:#16213e;height:100vh;position:fixed;padding:20px}
  .content{margin-left:240px;padding:30px}
  .card{background:#0f3460;border-radius:8px;padding:20px;margin-bottom:20px}
  .badge-danger{background:#e74c3c;color:#fff;padding:2px 8px;border-radius:4px}
  .badge-secondary{background:#555;color:#fff;padding:2px 8px;border-radius:4px}
  table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #333;text-align:left}
</style>
</head>
<body>
<div class="sidebar">
  <h3>🛡 ${company}</h3>
  <ul style="list-style:none;padding:0">
    <li><a href="/admin/dashboard" style="color:#aaf">Dashboard</a></li>
    <li><a href="/admin/users" style="color:#aaf">Users (${seededInt(seed, 77, 9000) + 100})</a></li>
    <li><a href="/admin/settings" style="color:#aaf">Settings</a></li>
    <li><a href="/admin/logs" style="color:#aaf">Audit Logs</a></li>
    <li><a href="/admin/backup" style="color:#aaf">Backups</a></li>
    <li><a href="/admin/api-keys" style="color:#aaf">API Keys</a></li>
    <li><a href="/admin/integrations" style="color:#aaf">Integrations</a></li>
    <li><a href="/admin/billing" style="color:#aaf">Billing</a></li>
    <li style="margin-top:20px"><a href="/admin/logout" style="color:#f66">Logout</a></li>
  </ul>
</div>
<div class="content">
  <div class="card">
    <h4>System Overview</h4>
    <div style="display:flex;gap:30px">
      <div>Users: <strong>${seededInt(seed, 77, 9000) + 100}</strong></div>
      <div>Revenue (MRR): <strong>$${(seededInt(seed, 88, 500) + 10).toLocaleString()},000</strong></div>
      <div>Uptime: <strong>99.97%</strong></div>
      <div>DB Size: <strong>${seededInt(seed, 66, 90) + 10}GB</strong></div>
    </div>
  </div>
  <h4>${subPath.includes("users") ? "User Management" : "Admin Panel"}</h4>
  <table>
    <tr><th>ID</th><th>Username</th><th>Email</th><th>Role</th><th>Last Login</th><th>Actions</th></tr>
    ${userRows}
  </table>
  <p style="margin-top:20px;color:#aaa;font-size:12px">
    <!-- debug: db_host=${seededItem(seed, 2, FAKE_DOMAINS)} | ver=2.4.1 | env=production -->
  </p>
</div>
</body>
</html>`;
}

function fakePhpMyAdminHtml(seed: number): string {
  const dbName = seededItem(seed, 3, FAKE_DB_NAMES);
  const domain = seededItem(seed, 2, FAKE_DOMAINS);
  return `<!DOCTYPE html>
<html><head><title>phpMyAdmin — ${domain}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f4f4}
.nav{background:#2d4a22;color:#fff;padding:10px 20px}
.panel{background:#fff;margin:20px;padding:20px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.2)}
table{width:100%;border-collapse:collapse}th{background:#e8f5e9;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #eee}
</style></head>
<body>
<div class="nav">🐬 phpMyAdmin 5.2.1 &nbsp;|&nbsp; Server: db.${domain} &nbsp;|&nbsp; DB: <strong>${dbName}</strong></div>
<div class="panel">
<p><strong>Database:</strong> ${dbName} &nbsp; <strong>Tables:</strong> 24 &nbsp; <strong>Size:</strong> ${seededInt(seed, 44, 800) + 50}MB</p>
<h4>Tables</h4>
<table>
<tr><th>Table</th><th>Rows</th><th>Size</th><th>Actions</th></tr>
${["users","sessions","products","orders","payments","api_keys","audit_log","settings"].map((t,i) => `
<tr><td><a href="/phpmyadmin/?db=${dbName}&table=${t}&action=browse">${t}</a></td>
<td>${seededInt(seed, i+200, 90000)+100}</td><td>${seededInt(seed,i+300,900)+5}MB</td>
<td><a href="/phpmyadmin/?db=${dbName}&table=${t}&action=browse">Browse</a> | <a href="/phpmyadmin/?db=${dbName}&table=${t}&action=export">Export</a></td></tr>`).join("")}
</table>
</div>
<div class="panel" style="font-size:12px;color:#777">
<!-- config: PMA_HOST=db.${domain} PMA_PORT=3306 PMA_USER=root -->
</div>
</body></html>`;
}

/* ═══════════════════════════════════════════════════════════════════
   D. GERAÇÃO DE ENDPOINTS — árvore baseada em perfil do atacante
   ═══════════════════════════════════════════════════════════════════ */

const CATEGORY_PATH_TREES: Record<string, Array<{path: string; type: DecoyType}>> = {
  admin_probe: [
    { path: "/admin/users",           type: "admin_panel"  },
    { path: "/admin/settings",        type: "admin_panel"  },
    { path: "/admin/logs",            type: "admin_panel"  },
    { path: "/admin/backup",          type: "config_service"},
    { path: "/admin/api-keys",        type: "api_service"  },
    { path: "/admin/export-users",    type: "db_interface" },
    { path: "/administrator/users",   type: "admin_panel"  },
    { path: "/manage/accounts",       type: "admin_panel"  },
  ],
  config_leak: [
    { path: "/config/app.yml",        type: "config_service"},
    { path: "/config/database.yml",   type: "config_service"},
    { path: "/.env.staging",          type: "config_service"},
    { path: "/.env.backup",           type: "config_service"},
    { path: "/settings/production.json", type: "config_service"},
    { path: "/app/config/secrets.json",  type: "config_service"},
  ],
  git_leak: [
    { path: "/.git/refs/heads/main",  type: "config_service"},
    { path: "/.git/COMMIT_EDITMSG",   type: "config_service"},
    { path: "/.git/stash",            type: "config_service"},
  ],
  cloud_probe: [
    { path: "/iam/security-credentials/production",  type: "config_service"},
    { path: "/metadata/v1/token",                    type: "auth_service"  },
    { path: "/metadata/v1/config",                   type: "config_service"},
    { path: "/.aws/credentials",                     type: "config_service"},
    { path: "/.gcloud/application_default_credentials.json", type: "config_service"},
    { path: "/storage/v1/b?project=prod",            type: "api_service"  },
  ],
  container_escape: [
    { path: "/api/v1/configmaps",     type: "api_service"  },
    { path: "/api/v1/serviceaccounts",type: "api_service"  },
    { path: "/apis/apps/v1/deployments", type: "api_service"},
    { path: "/v2/",                   type: "api_service"  },
    { path: "/v2/images/json",        type: "api_service"  },
  ],
  credential_stuff: [
    { path: "/api/v1/auth/refresh",   type: "auth_service" },
    { path: "/api/v1/users/me",       type: "api_service"  },
    { path: "/api/v1/users/list",     type: "api_service"  },
    { path: "/api/v1/admin/token",    type: "auth_service" },
    { path: "/oauth/authorize",       type: "auth_service" },
  ],
  data_exfil: [
    { path: "/backup_latest.sql.gz",  type: "db_interface" },
    { path: "/exports/users.csv",     type: "db_interface" },
    { path: "/exports/payments.csv",  type: "db_interface" },
    { path: "/dumps/2025_full.tar.gz",type: "db_interface" },
    { path: "/db_backup.zip",         type: "db_interface" },
  ],
  dev_tools: [
    { path: "/kibana/app/discover",   type: "admin_panel"  },
    { path: "/_nodes/stats",          type: "api_service"  },
    { path: "/_all/_search",          type: "db_interface" },
    { path: "/grafana/api/org/users", type: "api_service"  },
    { path: "/jupyter/api/kernels",   type: "api_service"  },
  ],
  exploit_specific: [
    { path: "/manager/html/upload",   type: "admin_panel"  },
    { path: "/console/login.portal",  type: "admin_panel"  },
    { path: "/web.config.bak",        type: "config_service"},
    { path: "/WEB-INF/classes/",      type: "config_service"},
  ],
  iot_exploit: [
    { path: "/cgi-bin/config.cgi",    type: "config_service"},
    { path: "/cgi-bin/export.cgi",    type: "config_service"},
    { path: "/api/camera/config",     type: "api_service"  },
  ],
  cms_scan: [
    { path: "/wp-json/wp/v2/users",   type: "api_service"  },
    { path: "/wp-json/wp/v2/settings",type: "api_service"  },
    { path: "/wp-admin/user-edit.php",type: "admin_panel"  },
    { path: "/xmlrpc.php",            type: "config_service"},
  ],
  supply_chain: [
    { path: "/api/packages/private",  type: "api_service"  },
    { path: "/.npmrc",                type: "config_service"},
    { path: "/pip.conf",              type: "config_service"},
  ],
};

function generateEndpointsForProfile(profile: DeceptionProfile): DecoyEndpoint[] {
  const generated: DecoyEndpoint[] = [];
  const seed = seedFromIp(profile.ip);

  for (const category of profile.categories) {
    const tree = CATEGORY_PATH_TREES[category] ?? CATEGORY_PATH_TREES["admin_probe"]!;
    for (const item of tree) {
      if (deceptionEndpoints.has(item.path) || profile.generatedPaths.has(item.path)) continue;
      const endpoint: DecoyEndpoint = {
        path:        item.path,
        type:        item.type,
        ownerIp:     profile.ip,
        expiresAt:   Date.now() + ENDPOINT_TTL_MS,
        hitsCount:   0,
        lastHit:     0,
        seed,
        contentType: contentTypeForDecoy(item.type),
        statusCode:  statusCodeForDecoy(item.type),
        delayMs:     Math.min(MAX_DELAY_MS, seededInt(seed, generated.length + 77, 2500) + 500),
      };
      generated.push(endpoint);
      profile.generatedPaths.add(item.path);
    }
  }
  return generated;
}

function contentTypeForDecoy(type: DecoyType): string {
  switch (type) {
    case "api_service":    return "application/json";
    case "admin_panel":    return "text/html";
    case "config_service": return "text/plain";
    case "db_interface":   return "text/html";
    case "auth_service":   return "application/json";
  }
}

function statusCodeForDecoy(type: DecoyType): number {
  if (type === "auth_service") return 200;
  return 200;
}

/* ═══════════════════════════════════════════════════════════════════
   E. GERAÇÃO DE RESPOSTA — converte endpoint + seed em body convincente
   ═══════════════════════════════════════════════════════════════════ */

function buildDecoyResponse(ep: DecoyEndpoint, path: string): string {
  const s = ep.seed;

  switch (ep.type) {
    case "api_service": {
      if (path.includes("user")) {
        return JSON.stringify({ success: true, data: fakeUsers(s), total: seededInt(s,77,9000)+100, page: 1 }, null, 2);
      }
      if (path.includes("secret") || path.includes("configmap")) {
        return JSON.stringify(fakeK8sSecrets(s), null, 2);
      }
      if (path.includes("package") || path.includes("module")) {
        return JSON.stringify({
          packages: [
            { name: "@internal/core-lib",    version: "3.2.1", registry: "private" },
            { name: "@internal/auth-sdk",    version: "1.8.4", registry: "private" },
            { name: "@internal/data-access", version: "2.1.0", registry: "private" },
          ]
        }, null, 2);
      }
      if (path.includes("token") || path.includes("kernel")) {
        return JSON.stringify([
          { id: createHash("md5").update(`k1_${s}`).digest("hex"), name: "python3", last_activity: new Date().toISOString() },
          { id: createHash("md5").update(`k2_${s}`).digest("hex"), name: "bash",    last_activity: new Date(Date.now()-3600000).toISOString() },
        ], null, 2);
      }
      return JSON.stringify({
        status: "ok",
        version: "2.4.1",
        environment: "production",
        instance_id: createHash("md5").update(`inst_${s}`).digest("hex").slice(0,12),
        region: seededItem(s, 9, FAKE_REGIONS),
        uptime_seconds: seededInt(s, 55, 86400 * 7),
        db: { host: `db.${seededItem(s, 2, FAKE_DOMAINS)}`, status: "connected", pool: 20 },
        cache: { host: `redis.${seededItem(s, 2, FAKE_DOMAINS)}`, status: "connected" },
      }, null, 2);
    }

    case "admin_panel": {
      if (path.includes("phpmyadmin") || path.includes("pma")) {
        return fakePhpMyAdminHtml(s);
      }
      return fakeAdminHtml(s, path);
    }

    case "config_service": {
      if (path.includes(".env") || path.endsWith("env")) return fakeEnvFile(s);
      if (path.includes("aws") || path.includes("credential")) return fakeAwsCredentials(s);
      if (path.includes("gcloud") || path.includes("google")) {
        return JSON.stringify({
          type: "service_account",
          project_id: `${seededItem(s, 1, FAKE_COMPANIES).toLowerCase().replace(/ /g,"-")}-prod`,
          private_key_id: createHash("md5").update(`gcp_${s}`).digest("hex"),
          private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA2a...[truncated]\n-----END RSA PRIVATE KEY-----",
          client_email: `svc-account@${seededItem(s, 1, FAKE_COMPANIES).toLowerCase().replace(/ /g,"-")}.iam.gserviceaccount.com`,
        }, null, 2);
      }
      if (path.includes("npmrc")) {
        return [
          `registry=https://registry.${seededItem(s, 2, FAKE_DOMAINS)}`,
          `//registry.${seededItem(s, 2, FAKE_DOMAINS)}/:_authToken=${createHash("sha256").update(`npm_${s}`).digest("hex")}`,
          `always-auth=true`,
        ].join("\n");
      }
      if (path.endsWith(".yml") || path.endsWith(".yaml")) {
        const dbName = seededItem(s, 3, FAKE_DB_NAMES);
        const domain = seededItem(s, 2, FAKE_DOMAINS);
        return [
          `app:`,
          `  name: ${seededItem(s, 1, FAKE_COMPANIES)}`,
          `  env: production`,
          `  secret_key: ${createHash("sha256").update(`app_${s}`).digest("hex")}`,
          ``,
          `database:`,
          `  adapter: postgresql`,
          `  host: db.${domain}`,
          `  port: 5432`,
          `  database: ${dbName}`,
          `  username: appuser`,
          `  password: ${createHash("md5").update(`dbpw_${s}`).digest("hex").slice(0,16)}`,
          ``,
          `redis:`,
          `  host: redis.${domain}`,
          `  port: 6379`,
          `  password: ${createHash("md5").update(`rpw_${s}`).digest("hex").slice(0,16)}`,
        ].join("\n");
      }
      const domain = seededItem(s, 2, FAKE_DOMAINS);
      return [
        `# Production Configuration — ${seededItem(s, 1, FAKE_COMPANIES)}`,
        `HOST=${domain}`,
        `DB_URL=postgresql://appuser:${createHash("md5").update(`dbpw_${s}`).digest("hex").slice(0,16)}@db.${domain}:5432/${seededItem(s,3,FAKE_DB_NAMES)}`,
        `REDIS_URL=redis://:${createHash("md5").update(`rpw_${s}`).digest("hex").slice(0,16)}@redis.${domain}:6379`,
        `HMAC_SECRET=${createHash("sha256").update(`hmac_${s}`).digest("hex")}`,
      ].join("\n");
    }

    case "db_interface": {
      if (path.endsWith(".sql") || path.endsWith(".sql.gz")) return fakeDbDump(s);
      if (path.endsWith(".csv")) {
        const header = "id,email,name,created_at,role\n";
        const rows = fakeUsers(s, 10).map((u: any) =>
          `${u.id},${u.email},${u.username},${u.created_at},${u.role}`
        ).join("\n");
        return header + rows;
      }
      return fakePhpMyAdminHtml(s);
    }

    case "auth_service": {
      if (path.includes("refresh") || path.includes("token")) {
        return JSON.stringify({
          access_token:  fakeJwt(s),
          refresh_token: createHash("sha256").update(`rt_${s}_${Date.now()}`).digest("hex"),
          token_type:    "Bearer",
          expires_in:    86400,
          scope:         "admin:read admin:write user:all",
        }, null, 2);
      }
      return JSON.stringify({
        success:      true,
        user:         fakeUsers(s, 1)[0],
        token:        fakeJwt(s),
        permissions:  ["read", "write", "delete", "admin"],
        session_id:   createHash("md5").update(`sess_${s}_${Date.now()}`).digest("hex"),
      }, null, 2);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   F. TARPIT COGNITIVO — links falsos injetados nas respostas
   ═══════════════════════════════════════════════════════════════════ */

function injectDeceptionLinks(body: string, contentType: string, profile: DeceptionProfile): string {
  const paths = [...profile.generatedPaths].slice(0, 6);
  if (paths.length === 0) return body;

  if (contentType.includes("html")) {
    const links = paths.map(p => `<a href="${p}" style="display:none">${p}</a>`).join("\n");
    return body.replace("</body>", `<!-- navigation -->\n${links}\n</body>`);
  }
  if (contentType.includes("json") && body.startsWith("{")) {
    try {
      const obj = JSON.parse(body);
      obj._links = Object.fromEntries(paths.map(p => [p.split("/").pop() ?? p, p]));
      return JSON.stringify(obj, null, 2);
    } catch { return body; }
  }
  if (contentType.includes("text/plain")) {
    const comment = "\n# Related endpoints:\n" + paths.map(p => `# ${p}`).join("\n");
    return body + comment;
  }
  return body;
}

/* ═══════════════════════════════════════════════════════════════════
   G. PERFIL & ATIVAÇÃO
   ═══════════════════════════════════════════════════════════════════ */

function getOrCreateProfile(ip: string): DeceptionProfile {
  if (!deceptionProfiles.has(ip)) {
    deceptionProfiles.set(ip, {
      ip, active: false,
      activatedAt: 0, lastSeen: 0,
      totalHits: 0, engagedMs: 0,
      categories: new Set(), generatedPaths: new Set(),
      exfilSimulated: [], riskMultiplier: 1.0,
    });
  }
  return deceptionProfiles.get(ip)!;
}

/**
 * Chamado pelo honeypot network quando um IP acumula hits.
 * Após AUTO_ACTIVATE_THRESHOLD hits, activa a deception tree para esse IP.
 */
export function notifyHoneypotHit(ip: string, category: string, hitCount: number): void {
  const profile     = getOrCreateProfile(ip);
  const isNewCat    = !profile.categories.has(category);
  profile.categories.add(category);
  profile.lastSeen  = Date.now();

  if (!profile.active && hitCount >= AUTO_ACTIVATE_THRESHOLD) {
    activateDeception(ip);
  } else if (profile.active && isNewCat) {
    /* Gera endpoints adicionais para a nova categoria descoberta */
    gcEndpoints();
    const newEndpoints = generateEndpointsForProfile(profile);
    for (const ep of newEndpoints) {
      deceptionEndpoints.set(ep.path, ep);
    }
    _stats.totalEndpoints = deceptionEndpoints.size;
    if (newEndpoints.length > 0) {
      console.log(`[adaptive-deception] ➕ ${newEndpoints.length} novos decoys para ${ip} (nova cat: ${category})`);
    }
  }
}

export function activateDeception(ip: string): void {
  const profile = getOrCreateProfile(ip);
  if (profile.active) return;

  profile.active      = true;
  profile.activatedAt = Date.now();
  _stats.autoActivations++;

  /* Gera a árvore de endpoints */
  gcEndpoints();
  const newEndpoints = generateEndpointsForProfile(profile);
  for (const ep of newEndpoints) {
    deceptionEndpoints.set(ep.path, ep);
  }

  _stats.activeProfiles  = [...deceptionProfiles.values()].filter(p => p.active).length;
  _stats.totalEndpoints  = deceptionEndpoints.size;

  console.log(
    `[adaptive-deception] 🎭 Deception ativada para ${ip} — ` +
    `${newEndpoints.length} endpoints gerados | cats: ${[...profile.categories].join(",")}`
  );

  recordThreatEvent(ip, "honeypot_triggered");
}

/* ═══════════════════════════════════════════════════════════════════
   H. GC — remove endpoints expirados para não vazar memória
   ═══════════════════════════════════════════════════════════════════ */

function gcEndpoints(): void {
  const now = Date.now();
  for (const [path, ep] of deceptionEndpoints) {
    if (ep.expiresAt < now) deceptionEndpoints.delete(path);
  }
  if (deceptionEndpoints.size > MAX_ENDPOINTS) {
    const sorted = [...deceptionEndpoints.entries()].sort((a,b) => a[1].lastHit - b[1].lastHit);
    for (const [path] of sorted.slice(0, deceptionEndpoints.size - MAX_ENDPOINTS)) {
      deceptionEndpoints.delete(path);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   I. MIDDLEWARE — intercepta hits em endpoints gerados dinamicamente
   ═══════════════════════════════════════════════════════════════════ */

export function adaptiveDeceptionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawPath  = req.path.split("?")[0] ?? "";
  const ep       = deceptionEndpoints.get(rawPath);

  if (!ep || ep.expiresAt < Date.now()) { next(); return; }

  const ip = ((req as any).clientIp ?? (req.headers["x-forwarded-for"] as string ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim());
  const profile = getOrCreateProfile(ip);

  /* Registra o hit */
  const hitStart = Date.now();
  ep.hitsCount++;
  ep.lastHit = hitStart;
  profile.totalHits++;
  profile.lastSeen = hitStart;
  _stats.totalHits++;

  /* Classifica como exfil simulado se for dado sensível */
  const isSensitiveExfil = ["data_exfil","config_service","auth_service"].includes(ep.type);
  if (isSensitiveExfil && profile.exfilSimulated.length < 20) {
    profile.exfilSimulated.push(rawPath);
    _stats.exfilSimulations++;
    _stats.topCategories[ep.type] = (_stats.topCategories[ep.type] ?? 0) + 1;
  }

  console.warn(
    `[adaptive-deception] 🎭 DECOY HIT — ${req.method} ${rawPath}\n` +
    `  IP: ${ip} | Type: ${ep.type} | hits: ${ep.hitsCount} | delay: ${ep.delayMs}ms`
  );

  /* Gera resposta falsa */
  const body = injectDeceptionLinks(
    buildDecoyResponse(ep, rawPath),
    ep.contentType,
    profile,
  );

  /* Tarpit cognitivo: delay antes de responder — desperdiça tempo do scanner */
  const respond = (): void => {
    const elapsed = Date.now() - hitStart;
    profile.engagedMs += elapsed;
    _stats.totalEngagedMs += elapsed;

    /* Registra no threat engine com bonus de score */
    recordThreatEvent(ip, "honeypot_triggered");

    res.type(ep.contentType).status(ep.statusCode).send(body);
  };

  if (ep.delayMs > 0) {
    setTimeout(respond, ep.delayMs);
  } else {
    respond();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   J. API PÚBLICA — STATS & GETTERS
   ═══════════════════════════════════════════════════════════════════ */

export function getAdaptiveDeceptionStats(): object {
  return {
    ..._stats,
    totalEndpoints:  deceptionEndpoints.size,
    activeProfiles:  [...deceptionProfiles.values()].filter(p => p.active).length,
    totalProfiles:   deceptionProfiles.size,
    topEngagedMs:    Math.round(_stats.totalEngagedMs / 1000) + "s attacker time wasted",
  };
}

export function getActiveEndpoints(): object[] {
  const now = Date.now();
  return [...deceptionEndpoints.values()]
    .filter(ep => ep.expiresAt > now)
    .map(ep => ({
      path:      ep.path,
      type:      ep.type,
      ownerIp:   ep.ownerIp,
      hitsCount: ep.hitsCount,
      expiresIn: Math.round((ep.expiresAt - now) / 60000) + "min",
    }));
}

export function getDeceptionProfiles(): object[] {
  return [...deceptionProfiles.values()].map(p => ({
    ip:              p.ip,
    active:          p.active,
    totalHits:       p.totalHits,
    categories:      [...p.categories],
    generatedPaths:  p.generatedPaths.size,
    engagedSeconds:  Math.round(p.engagedMs / 1000),
    exfilSimulated:  p.exfilSimulated,
  }));
}

export function purgeDeception(): void {
  deceptionEndpoints.clear();
  deceptionProfiles.forEach(p => { p.active = false; p.generatedPaths.clear(); });
  _stats.totalEndpoints = 0;
  _stats.activeProfiles = 0;
}

/* ═══════════════════════════════════════════════════════════════════
   K. STARTUP
   ═══════════════════════════════════════════════════════════════════ */

export function startAdaptiveDeception(): void {
  setInterval(gcEndpoints, 5 * 60_000); // GC a cada 5 min

  console.log(
    "[adaptive-deception] 🎭 Adaptive Deception Engine ativo — Fase 117 | " +
    `${Object.values(CATEGORY_PATH_TREES).flat().length} path templates | ` +
    "tarpit cognitivo | QRNG variation | auto-ativação 2+ honeypot hits | " +
    "GET /api/adaptive-deception/stats"
  );
}
