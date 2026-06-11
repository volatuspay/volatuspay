/**
 * 🔄 NEON DUAL-WRITE — Segurança
 * Espelha dados de segurança do Firebase → Neon em paralelo.
 * Firebase continua sendo a fonte primária de leitura nesta fase.
 * Após validação, as leituras serão migradas para o Neon.
 */

import { neonQuery } from './neon-db.js';

// ── SECURITY LOGS ─────────────────────────────────────────────────────────────

export async function neonWriteSecurityLog(log: {
  id: string;
  ipAddress?: string;
  threatCategory: string;
  severity: string;
  endpoint: string;
  userAgent?: string;
  riskScore?: number;
  actionTaken?: string;
  evidence?: string;
  blocked?: boolean;
  count?: number;
  firstDetectedAt?: Date;
  lastDetectedAt?: Date;
  detectedAt: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO security_logs (
        id, ip_address, threat_category, severity, endpoint,
        user_agent, risk_score, action_taken, evidence, blocked,
        count, first_detected_at, last_detected_at, detected_at
      ) VALUES (
        ${log.id},
        ${log.ipAddress ?? null},
        ${log.threatCategory},
        ${log.severity},
        ${log.endpoint},
        ${log.userAgent ?? null},
        ${log.riskScore ?? 0},
        ${log.actionTaken ?? null},
        ${log.evidence ?? null},
        ${log.blocked ?? false},
        ${log.count ?? 1},
        ${log.firstDetectedAt ?? null},
        ${log.lastDetectedAt ?? null},
        ${log.detectedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        count = EXCLUDED.count,
        last_detected_at = EXCLUDED.last_detected_at,
        risk_score = EXCLUDED.risk_score,
        blocked = EXCLUDED.blocked
    `;
  }, `writeSecurityLog:${log.id}`);
}

// ── BLOCKED IPs ───────────────────────────────────────────────────────────────

export async function neonWriteBlockedIP(data: {
  id: string;
  ipAddress: string;
  reason: string;
  severity?: string;
  isActive?: boolean;
  blockedBy?: string;
  adminName?: string;
  attacksBlocked?: number;
  totalAttempts?: number;
  threatCategories?: string[];
  riskScore?: number;
  lastAttemptAt?: Date;
}): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      INSERT INTO blocked_ips (
        id, ip_address, reason, severity, is_active, blocked_by,
        admin_name, attacks_blocked, total_attempts, threat_categories,
        risk_score, last_attempt_at
      ) VALUES (
        ${data.id},
        ${data.ipAddress},
        ${data.reason},
        ${data.severity ?? 'medium'},
        ${data.isActive ?? true},
        ${data.blockedBy ?? 'admin'},
        ${data.adminName ?? null},
        ${data.attacksBlocked ?? 0},
        ${data.totalAttempts ?? 1},
        ${data.threatCategories ?? []},
        ${data.riskScore ?? 60},
        ${data.lastAttemptAt ?? null}
      )
      ON CONFLICT (ip_address) DO UPDATE SET
        is_active = EXCLUDED.is_active,
        attacks_blocked = EXCLUDED.attacks_blocked,
        total_attempts = EXCLUDED.total_attempts,
        last_attempt_at = EXCLUDED.last_attempt_at,
        updated_at = NOW()
    `;
  }, `writeBlockedIP:${data.ipAddress}`);
}

export async function neonUnblockIP(ipAddress: string, reason: string, unlockedBy: string): Promise<void> {
  await neonQuery(async (sql) => {
    await sql`
      UPDATE blocked_ips
      SET is_active = FALSE,
          unlocked_at = NOW(),
          unblock_reason = ${reason},
          unlocked_by = ${unlockedBy},
          updated_at = NOW()
      WHERE ip_address = ${ipAddress}
    `;
  }, `unblockIP:${ipAddress}`);
}

// ── IP BLACKLIST (detecções automáticas) ─────────────────────────────────────

export async function neonWriteIPBlacklist(data: {
  ip: string;
  reason: string;
  severity?: string;
  attempts?: number;
  blockedEndpoints?: string[];
  userAgent?: string;
  addedAt?: number; // timestamp ms
  lastSeen?: number;
}): Promise<void> {
  await neonQuery(async (sql) => {
    const addedAt = data.addedAt ? new Date(data.addedAt) : new Date();
    const lastSeen = data.lastSeen ? new Date(data.lastSeen) : new Date();
    await sql`
      INSERT INTO ip_blacklist (
        ip, reason, severity, attempts, blocked_endpoints, user_agent, added_at, last_seen
      ) VALUES (
        ${data.ip},
        ${data.reason},
        ${data.severity ?? 'medium'},
        ${data.attempts ?? 1},
        ${data.blockedEndpoints ?? []},
        ${data.userAgent ?? null},
        ${addedAt},
        ${lastSeen}
      )
      ON CONFLICT (ip) DO UPDATE SET
        attempts = EXCLUDED.attempts,
        last_seen = EXCLUDED.last_seen,
        severity = EXCLUDED.severity
    `;
  }, `writeIPBlacklist:${data.ip}`);
}
