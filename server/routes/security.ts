import { Router } from 'express';
import type { Response } from 'express';
import { verifyFirebaseToken, requireAdmin, requireSuperAdmin } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { ensureFirebaseReady, getAdmin, getFirestore } from '../lib/firebase-admin.js';
import { getFirebaseHealth } from '../security/security-logger.js';
import { neonQuery } from '../lib/neon-db.js';
import { secretsManager } from '../lib/secrets-manager.js';
import { entityBlocker } from '../security/entity-blocker.js';
import { adminShield } from '../security/admin-shield.js';
import { persistentBlacklist, clearPrivilegeEscalationBlocks, clearNonCriticalBlocks } from '../security/persistent-ip-blacklist.js';
import { userRateLimit } from '../security/user-rate-limiter.js';

const router = Router();

// 📊 API ADMIN - LISTAR LOGS DE SEGURANÇA (COM AGREGAÇÃO INTELIGENTE)
router.get('/api/security/logs', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { limit = '50', category, severity, startDate, endDate } = req.query;
    console.log('🛡️ ADMIN: Buscando logs de segurança...');

    // ✅ USAR AGREGADOR INTELIGENTE - Retorna logs únicos com contadores de ocorrências
    const { logAggregator } = await import('../security/log-aggregator');
    const logs = await logAggregator.getAggregatedLogs({
      limit: parseInt(limit as string),
      category: category as string,
      severity: severity as string
    });

    // Formatar timestamps para o frontend
    const formattedLogs = logs.map(log => ({
      id: log.id,
      ipAddress: log.ipAddress,
      threatCategory: log.threatCategory,
      severity: log.severity,
      endpoint: log.endpoint,
      userAgent: log.userAgent,
      riskScore: log.riskScore,
      actionTaken: log.actionTaken,
      evidence: log.evidence,
      count: log.count || 1, // ⭐ CONTADOR DE OCORRÊNCIAS
      detectedAt: log.detectedAt.toISOString(),
      firstDetectedAt: log.firstDetectedAt?.toISOString() || log.detectedAt.toISOString(),
      lastDetectedAt: log.lastDetectedAt?.toISOString() || log.detectedAt.toISOString()
    }));

    console.log(`✅ ${formattedLogs.length} logs de segurança encontrados (agregados)`);
    res.json(formattedLogs);

  } catch (error) {
    console.error('❌ Erro ao buscar logs de segurança:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚫 API ADMIN - LISTAR IPs BLOQUEADOS
// Lê de DUAS coleções e faz merge:
//  - blockedIPs → bloqueios manuais pelo admin
//  - security_ip_blacklist → detecções automáticas do sistema
router.get('/api/security/blocked-ips', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { active = 'true' } = req.query;
    console.log('🛡️ ADMIN: Buscando IPs bloqueados (blockedIPs + security_ip_blacklist)...');

    let manualIPs: any[] = [];
    let autoIPs: any[] = [];
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT id, ip_address, reason, severity, is_active, blocked_by, admin_name,
               attacks_blocked, total_attempts, threat_categories, risk_score,
               created_at, last_attempt_at, unlocked_at, unblock_reason
        FROM blocked_ips ORDER BY created_at DESC LIMIT 300
      `;
      manualIPs = rows.map(r => ({
        id: r.id,
        _source: 'manual',
        ipAddress: r.ip_address,
        reason: r.reason || '',
        severity: r.severity || 'medium',
        isActive: r.is_active ?? true,
        blockedBy: r.blocked_by || 'admin',
        attacksBlocked: Number(r.attacks_blocked) || 0,
        totalAttempts: Number(r.total_attempts) || 1,
        threatCategories: r.threat_categories || [],
        riskScore: Number(r.risk_score) || 60,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        lastAttemptAt: r.last_attempt_at ? new Date(r.last_attempt_at).toISOString() : undefined,
        unlockedAt: r.unlocked_at ? new Date(r.unlocked_at).toISOString() : undefined,
        unblockReason: r.unblock_reason,
        adminName: r.admin_name,
      }));
    }, 'getBlockedIPs').catch(() => {});

    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT ip, reason, severity, attempts, last_seen, blocked_endpoints, user_agent, added_at
        FROM security_ip_blacklist ORDER BY added_at DESC LIMIT 300
      `;
      const manualIPSet = new Set(manualIPs.map((e: any) => e.ipAddress));
      autoIPs = rows.filter(r => !manualIPSet.has(r.ip)).map(r => ({
          id: `auto_${r.ip}`,
          _source: 'auto',
          ipAddress: r.ip,
          reason: r.reason || 'Detecção automática',
          severity: r.severity || 'medium',
          isActive: false,
          blockedBy: 'system' as const,
          attacksBlocked: 0,
          totalAttempts: Number(r.attempts) || 1,
          threatCategories: r.blocked_endpoints || [],
          riskScore: r.severity === 'critical' ? 90 : r.severity === 'high' ? 70 : 50,
          createdAt: r.added_at ? new Date(r.added_at).toISOString() : new Date().toISOString(),
          lastAttemptAt: r.last_seen ? new Date(r.last_seen).toISOString() : undefined,
          userAgent: r.user_agent,
        }));
    }, 'getAutoBlacklist').catch(() => {});

    let merged: any[] = [...manualIPs, ...autoIPs];

    // Filtrar se pedido
    if (active === 'true') {
      // Mostrar todos os manuais ativos + todas as detecções automáticas
      merged = merged.filter(ip => ip.isActive === true || ip._source === 'auto');
    }

    // Ordenar por data mais recente
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    console.log(`✅ ${merged.length} IPs encontrados (${manualIPs.length} manuais + ${autoIPs.length} automáticos)`);
    res.json(merged);

  } catch (error) {
    console.error('❌ Erro ao buscar IPs bloqueados:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔓 API ADMIN - DESBLOQUEAR IP ESPECÍFICO
router.delete('/api/security/blocked-ips/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Desbloqueado pelo administrador' } = req.body;
    
    console.log(`🔓 ADMIN: Desbloqueando IP: ${id}`);

    let ipAddress: string | undefined;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT ip_address FROM blocked_ips WHERE id = ${id} LIMIT 1`;
      if (rows.length === 0) return;
      ipAddress = rows[0].ip_address;
      await sql`UPDATE blocked_ips SET is_active = false, unlocked_by = ${req.user?.uid || 'admin'}, unlocked_at = NOW(), unblock_reason = ${reason}, updated_at = NOW() WHERE id = ${id}`;
    }, `unblockIP:${id}`);

    if (!ipAddress) {
      return res.status(404).json({ error: 'IP bloqueado não encontrado' });
    }

    // Remover do cache in-memory
    const { securityCache } = await import('../security/threatguard.js');
    securityCache.unblockIP(ipAddress);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-security.js').then(({ neonUnblockIP }) => {
      neonUnblockIP(ipAddress, reason, req.user?.uid || 'admin');
    }).catch(() => {});

    console.log(`✅ IP desbloqueado com sucesso: ${ipAddress}`);
    res.json({
      success: true,
      message: `IP ${ipAddress} desbloqueado com sucesso`,
      ipAddress,
      unblockReason: reason
    });

  } catch (error) {
    console.error('❌ Erro ao desbloquear IP:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚫 API ADMIN - BLOQUEAR IP
router.post('/api/security/block-ip', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { ipAddress, reason = 'Bloqueado pelo administrador', severity = 'high' } = req.body;
    
    if (!ipAddress) {
      return res.status(400).json({ error: 'Endereço IP é obrigatório' });
    }

    console.log(`🚫 ADMIN: Bloqueando IP: ${ipAddress} - Razão: ${reason}`);

    let alreadyBlocked = false;
    let newId = '';
    await neonQuery(async (sql) => {
      const existing = await sql`SELECT id FROM blocked_ips WHERE ip_address = ${ipAddress} AND is_active = true LIMIT 1`;
      if (existing.length > 0) { alreadyBlocked = true; return; }
      const riskScore = severity === 'critical' ? 100 : severity === 'high' ? 80 : 60;
      const { nanoid } = await import('nanoid');
      newId = nanoid(20);
      await sql`
        INSERT INTO blocked_ips (id, ip_address, reason, severity, is_active, blocked_by, admin_name, attacks_blocked, total_attempts, threat_categories, risk_score, created_at, last_attempt_at)
        VALUES (${newId}, ${ipAddress}, ${reason}, ${severity}, true, 'admin', ${req.user?.email || 'admin'}, 0, 1, ARRAY['manual_block'], ${riskScore}, NOW(), NOW())
      `;
    }, `blockIP:${ipAddress}`);

    if (alreadyBlocked) {
      return res.status(409).json({ error: `IP ${ipAddress} já está bloqueado` });
    }

    // Adicionar à blacklist persistente
    const { persistentBlacklist } = await import('../security/persistent-ip-blacklist.js');
    await persistentBlacklist.addToBlacklist(
      ipAddress,
      reason,
      severity as 'low' | 'medium' | 'high' | 'critical'
    );

    console.log(`✅ IP bloqueado com sucesso: ${ipAddress}`);
    res.json({
      success: true,
      message: `IP ${ipAddress} bloqueado com sucesso`,
      ipAddress,
      reason,
      severity
    });

  } catch (error) {
    console.error('❌ Erro ao bloquear IP:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔓 API ADMIN - DESBLOQUEAR IP POR ENDEREÇO
router.post('/api/security/unblock-ip', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { ipAddress, reason = 'Desbloqueado pelo administrador' } = req.body;
    
    if (!ipAddress) {
      return res.status(400).json({ error: 'Endereço IP é obrigatório' });
    }

    console.log(`🔓 ADMIN: Desbloqueando IP por endereço: ${ipAddress}`);

    let count = 0;
    await neonQuery(async (sql) => {
      const result = await sql`
        UPDATE blocked_ips SET is_active = false, unlocked_by = ${req.user?.uid || 'admin'}, unlocked_at = NOW(), unblock_reason = ${reason}, updated_at = NOW()
        WHERE ip_address = ${ipAddress} AND is_active = true
        RETURNING id
      `;
      count = result.length;
    }, `unblockIPByAddr:${ipAddress}`);

    if (count === 0) {
      return res.status(404).json({ error: `IP ${ipAddress} não está bloqueado` });
    }

    // Remover do cache in-memory
    const { securityCache } = await import('../security/threatguard.js');
    securityCache.unblockIP(ipAddress);

    // 🔥 TAMBÉM REMOVER DA BLACKLIST PERSISTENTE
    const { persistentBlacklist } = await import('../security/persistent-ip-blacklist.js');
    await persistentBlacklist.removeFromBlacklist(ipAddress);

    console.log(`✅ ${count} registros desbloqueados para IP: ${ipAddress} (incluindo blacklist persistente)`);
    res.json({
      success: true,
      message: `IP ${ipAddress} desbloqueado com sucesso`,
      ipAddress,
      recordsUpdated: count,
      unblockReason: reason
    });

  } catch (error) {
    console.error('❌ Erro ao desbloquear IP por endereço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🧹 API ADMIN - LIMPAR APENAS IPs INTERNOS DA BLACKLIST (ONE-TIME CLEANUP)
router.post('/api/security/cleanup-internal-ips', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🧹 ADMIN: Limpando IPs internos da blacklist...');

    const { persistentBlacklist } = await import('../security/persistent-ip-blacklist.js');
    const result = await persistentBlacklist.cleanupInternalIPs();

    console.log(`✅ Limpeza de IPs internos concluída: ${result.removed} IPs removidos`);
    res.json({
      success: true,
      message: 'IPs internos removidos da blacklist com sucesso',
      removed: result.removed,
      ips: result.ips
    });

  } catch (error) {
    console.error('❌ Erro ao limpar IPs internos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🧹 API ADMIN - LIMPAR BLACKLIST COMPLETA (RESETAR TUDO)
router.post('/api/security/clear-blacklist', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🧹 ADMIN: Limpando blacklist completa...');

    let blacklistCount = 0;
    let blockedIPsCount = 0;

    await neonQuery(async (sql) => {
      const r1 = await sql`DELETE FROM security_ip_blacklist RETURNING ip`;
      blacklistCount = r1.length;
      const r2 = await sql`
        UPDATE blocked_ips SET is_active = false, unlocked_by = ${req.user?.uid || 'admin'}, unlocked_at = NOW(), unblock_reason = 'Limpeza completa da blacklist pelo administrador', updated_at = NOW()
        WHERE is_active = true RETURNING id
      `;
      blockedIPsCount = r2.length;
    }, 'clearBlacklist');

    // Recarregar cache da blacklist
    const { persistentBlacklist } = await import('../security/persistent-ip-blacklist.js');
    await persistentBlacklist.reloadCache();

    console.log(`✅ Blacklist limpa: ${blacklistCount} entradas persistentes + ${blockedIPsCount} registros de IPs bloqueados`);
    res.json({
      success: true,
      message: 'Blacklist completamente limpa',
      persistentEntriesRemoved: blacklistCount,
      blockedIPsDeactivated: blockedIPsCount
    });

  } catch (error) {
    console.error('❌ Erro ao limpar blacklist:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 API ADMIN - ESTATÍSTICAS DE SEGURANÇA
router.get('/api/security/stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { period = '24h' } = req.query;
    console.log(`📊 ADMIN: Calculando estatísticas de segurança (${period})...`);

    // Calcular período
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case '1h':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Buscar logs de segurança no período
    let logs: any[] = [];
    let totalBlockedIPs = 0;
    let autoBlacklistIPs: string[] = [];

    await neonQuery(async (sql) => {
      const [logsRows, blockedRows, autoRows] = await Promise.all([
        sql`SELECT * FROM audit_logs WHERE created_at >= ${startDate} LIMIT 500`,
        sql`SELECT COUNT(*) as cnt FROM blocked_ips WHERE is_active = true`,
        sql`SELECT ip FROM security_ip_blacklist LIMIT 500`,
      ]);
      logs = logsRows;
      totalBlockedIPs = Number(blockedRows[0]?.cnt || 0) + autoRows.length;
      autoBlacklistIPs = autoRows.map((r: any) => r.ip);
    }, 'securityStats').catch(() => {});

    const stats = {
      period,
      totalThreats: logs.length + autoBlacklistIPs.length,
      threatsBlocked: logs.filter((log: any) => log.blocked).length,
      totalBlockedIPs,
      uniqueAttackerIPs: new Set([
        ...logs.map((log: any) => log.source_ip).filter(Boolean),
        ...autoBlacklistIPs,
      ]).size,
      threatsByCategory: logs.reduce((acc: any, log: any) => {
        acc[log.threat_category || log.action] = (acc[log.threat_category || log.action] || 0) + 1;
        return acc;
      }, {}),
      threatsBySeverity: logs.reduce((acc: any, log: any) => {
        acc[log.severity] = (acc[log.severity] || 0) + 1;
        return acc;
      }, {}),
      actionsTaken: logs.reduce((acc: any, log: any) => {
        acc[log.action] = (acc[log.action] || 0) + 1;
        return acc;
      }, {}),
      avgProcessingTime: 0,
      aiAnalysisUsed: 0,
      avgAiConfidence: 0,
      topAttackerIPs: Object.entries(
        logs.reduce((acc: any, log: any) => {
          acc[log.source_ip] = (acc[log.source_ip] || 0) + 1;
          return acc;
        }, {})
      )
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, attempts: count })),
      generatedAt: now.toISOString()
    };

    console.log(`✅ Estatísticas calculadas: ${stats.totalThreats} ameaças, ${stats.totalBlockedIPs} IPs bloqueados`);
    res.json(stats);

  } catch (error) {
    console.error('❌ Erro ao calcular estatísticas de segurança:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔄 API ADMIN - RECARREGAR CACHE DE SEGURANÇA
router.post('/api/security/reload-cache', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔄 ADMIN: Recarregando cache de segurança...');

    const { loadBlockedIPsFromFirebase } = await import('../security/threatguard.js');
    await loadBlockedIPsFromFirebase();

    console.log('✅ Cache de segurança recarregado com sucesso');
    res.json({
      success: true,
      message: 'Cache de segurança recarregado com sucesso',
      reloadedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erro ao recarregar cache de segurança:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔐 API ADMIN - MONITORAR SECRETS MANAGER / HSM
router.get('/api/admin/security/secrets-stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔐 ADMIN: Consultando estatísticas do Secrets Manager...');

    const stats = secretsManager.getStats();
    const auditLog = secretsManager.getAuditLog(50);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats,
      recentActivity: auditLog.map(log => ({
        secret: log.secret,
        action: log.action,
        timestamp: log.timestamp
      }))
    });

  } catch (error) {
    console.error('❌ Erro ao consultar secrets stats:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔄 API ADMIN - ROTACIONAR SECRET
router.post('/api/admin/security/rotate-secret', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { secretName, newValue } = req.body;

    if (!secretName || !newValue) {
      return res.status(400).json({ error: 'secretName e newValue são obrigatórios' });
    }

    console.log(`🔄 ADMIN: Rotacionando secret '${secretName}'...`);

    secretsManager.rotateSecret(secretName, newValue);

    console.log(`✅ Secret '${secretName}' rotacionado com sucesso`);
    res.json({
      success: true,
      message: `Secret '${secretName}' rotacionado com sucesso`,
      rotatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erro ao rotacionar secret:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// 🚫 API ADMIN - BLOQUEAR ENTIDADE (UID + IP + DEVICE FINGERPRINT)
router.post('/api/admin/security/block-entity', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { uid, ip, deviceFingerprint, reason, severity, accountData, deviceData, notes, expiresAt } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Motivo do bloqueio é obrigatório' });
    }
    
    if (!uid && !ip && !deviceFingerprint) {
      return res.status(400).json({ error: 'Pelo menos um identificador (UID, IP ou Device Fingerprint) é obrigatório' });
    }
    
    console.log('🚫 ADMIN: Bloqueando entidade...', { uid, ip, deviceFingerprint, reason });
    
    const blockedBy = req.user?.uid || 'unknown';
    const block = await entityBlocker.blockEntity({
      uid,
      ip,
      deviceFingerprint,
      reason,
      severity: severity || 'high',
      blockedBy,
      accountData,
      deviceData,
      notes,
      expiresAt
    });
    
    res.json({
      success: true,
      message: 'Entidade bloqueada com sucesso',
      block
    });
    
  } catch (error) {
    console.error('❌ Erro ao bloquear entidade:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ✅ API ADMIN - DESBLOQUEAR ENTIDADE
router.post('/api/admin/security/unblock-entity', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { blockId, unlockReason } = req.body;
    
    if (!blockId || !unlockReason) {
      return res.status(400).json({ error: 'blockId e unlockReason são obrigatórios' });
    }
    
    console.log('✅ ADMIN: Desbloqueando entidade...', { blockId });
    
    const unlockedBy = req.user?.uid || 'unknown';
    await entityBlocker.unblockEntity(blockId, unlockedBy, unlockReason);
    
    res.json({
      success: true,
      message: 'Entidade desbloqueada com sucesso'
    });
    
  } catch (error) {
    console.error('❌ Erro ao desbloquear entidade:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
});

// 📊 API ADMIN - TELEMETRIA DO ENTITY BLOCKER
router.get('/api/admin/security/entity-blocker-telemetry', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const telemetry = entityBlocker.getTelemetry();
    const isReady = entityBlocker.isReady();
    
    res.json({
      success: true,
      telemetry,
      status: {
        ready: isReady,
        message: isReady ? 'Sistema operacional' : 'Sistema não inicializado'
      }
    });
  } catch (error) {
    console.error('❌ Erro ao obter telemetria:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
});

// 📊 API ADMIN - TELEMETRIA DO ADMIN SHIELD
router.get('/api/admin/security/admin-shield-telemetry', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const telemetry = adminShield.getTelemetry();
    
    res.json({
      success: true,
      telemetry,
      status: {
        message: 'Admin Shield operacional'
      }
    });
  } catch (error) {
    console.error('❌ Erro ao obter telemetria do Admin Shield:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
});

// 🤖 API ADMIN - AI SECURITY STATUS
router.get('/api/admin/security/ai-status', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { listConfiguredEnvVars } = await import('../lib/env-validator.js');
    const envStatus = listConfiguredEnvVars();
    
    res.json({
      success: true,
      aiSecurity: {
        enabled: true,
        mode: 'log_only',
        autoBlock: false,
        confidenceThreshold: 80,
        model: 'gpt-4o',
        status: 'operational'
      },
      environment: {
        openaiConfigured: envStatus.critical.find(e => e.name === 'AI_INTEGRATIONS_OPENAI_API_KEY')?.configured || false,
        firebaseConfigured: envStatus.critical.filter(e => e.name.includes('FIREBASE')).every(e => e.configured)
      },
      message: '🤖 AI Security System Active - GPT-4o Powered Threat Detection'
    });
  } catch (error) {
    console.error('❌ Erro ao obter status do AI Security:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
});

// 🧪 API ADMIN - TESTAR AI SECURITY (Simular ameaças)
router.post('/api/admin/security/ai-test', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { analyzeSecurityThreat } = await import('../security/ai-threat-analyzer.js');
    const { testType = 'sql_injection' } = req.body;
    
    console.log(`🧪 ADMIN: Testando AI Security com cenário: ${testType}`);
    
    // Cenários de teste predefinidos
    const scenarios: Record<string, any> = {
      sql_injection: {
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        endpoint: '/api/orders',
        method: 'POST',
        suspicionScore: 85,
        detectedPatterns: ['sql_injection', 'malicious_payload']
      },
      bot_attack: {
        ip: '10.0.0.50',
        userAgent: 'Python-urllib/3.9',
        endpoint: '/api/login',
        method: 'POST',
        suspicionScore: 90,
        detectedPatterns: ['bot_user_agent', 'credential_stuffing']
      },
      ddos: {
        ip: '203.0.113.45',
        userAgent: 'curl/7.68.0',
        endpoint: '/api/products',
        method: 'GET',
        suspicionScore: 95,
        detectedPatterns: ['high_request_rate', 'ddos_attack']
      },
      normal: {
        ip: '172.16.0.10',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        endpoint: '/api/products',
        method: 'GET',
        suspicionScore: 10,
        detectedPatterns: []
      }
    };
    
    const scenario = scenarios[testType] || scenarios.normal;
    
    // Executar análise com IA
    const analysis = await analyzeSecurityThreat(scenario);
    
    res.json({
      success: true,
      test: {
        scenario: testType,
        input: scenario,
        analysis,
        timestamp: new Date().toISOString()
      },
      message: `Teste de ameaça '${testType}' executado com sucesso`
    });
  } catch (error) {
    console.error('❌ Erro ao testar AI Security:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
});

// 📋 API ADMIN - LISTAR BLOQUEIOS
router.get('/api/admin/security/blocked-entities', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { active, type, severity, limit } = req.query;
    
    console.log('📋 ADMIN: Listando bloqueios...', { active, type, severity, limit });
    
    const filters: {
      active?: boolean;
      type?: 'uid' | 'ip' | 'deviceFingerprint' | 'multi';
      severity?: 'critical' | 'high' | 'medium';
      limit?: number;
    } = {};
    
    // Converter active de string para boolean
    if (active === 'true') {
      filters.active = true;
    } else if (active === 'false') {
      filters.active = false;
    }
    // Se active for 'all', não adicionar filtro (undefined)
    
    if (type && type !== 'all') {
      filters.type = type as any;
    }
    
    if (severity && severity !== 'all') {
      filters.severity = severity as any;
    }
    
    if (limit) {
      filters.limit = parseInt(limit as string);
    }
    
    const blocks = await entityBlocker.listBlocks(filters);
    
    console.log(`✅ ${blocks.length} bloqueios encontrados`);
    if (blocks.length > 0) {
      console.log('📋 Primeiro bloqueio:', blocks[0]);
    }
    
    res.json({
      success: true,
      blocks,
      count: blocks.length
    });
    
  } catch (error) {
    console.error('❌ Erro ao listar bloqueios:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔍 API ADMIN - VERIFICAR SE ENTIDADE ESTÁ BLOQUEADA
router.post('/api/admin/security/check-block', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { uid, ip, deviceFingerprint } = req.body;
    
    console.log('🔍 ADMIN: Verificando bloqueio...', { uid, ip, deviceFingerprint });
    
    const result = await entityBlocker.isBlocked({ uid, ip, deviceFingerprint });
    
    res.json({
      success: true,
      blocked: result.blocked,
      block: result.block
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao verificar bloqueio:', error?.message || error);
    console.error('❌ Stack:', error?.stack);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔍 SHADOW MODE - APROVAÇÃO HUMANA DE BLOQUEIOS
router.get('/api/admin/shadow-mode/pending-blocks', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { limit = '50' } = req.query;
    console.log('📋 ADMIN: Buscando bloqueios pendentes de aprovação...');
    
    const { shadowModeManager } = await import('../security/shadow-mode.js');
    const pendingBlocks = await shadowModeManager.getPendingBlocks(parseInt(limit as string));
    
    res.json({ success: true, pendingBlocks });
  } catch (error: any) {
    console.error('❌ Erro ao buscar bloqueios pendentes:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/shadow-mode/pending-blocks/:id/approve', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const adminUid = req.user!.uid;
    
    console.log(`✅ ADMIN: Aprovando bloqueio pendente ${id}...`);
    
    const { shadowModeManager } = await import('../security/shadow-mode.js');
    const blockedEntityId = await shadowModeManager.approveBlock(id, adminUid, notes);
    
    res.json({ success: true, blockedEntityId, message: 'Bloqueio aprovado com sucesso!' });
  } catch (error: any) {
    console.error('❌ Erro ao aprovar bloqueio:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/shadow-mode/pending-blocks/:id/reject', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const adminUid = req.user!.uid;
    
    console.log(`❌ ADMIN: Rejeitando bloqueio pendente ${id}...`);
    
    const { shadowModeManager } = await import('../security/shadow-mode.js');
    await shadowModeManager.rejectBlock(id, adminUid, notes);
    
    res.json({ success: true, message: 'Bloqueio rejeitado com sucesso!' });
  } catch (error: any) {
    console.error('❌ Erro ao rejeitar bloqueio:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/admin/shadow-mode/config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('⚙️ ADMIN: Buscando configuração Shadow Mode...');
    
    const { shadowModeManager } = await import('../security/shadow-mode.js');
    const config = await shadowModeManager.getConfig();
    
    res.json({ success: true, config });
  } catch (error: any) {
    console.error('❌ Erro ao buscar configuração:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/api/admin/shadow-mode/config', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { enabled, autoBlockThreshold, requireApprovalBelow } = req.body;
    const adminUid = req.user!.uid;
    
    console.log('⚙️ ADMIN: Atualizando configuração Shadow Mode...', { enabled, autoBlockThreshold, requireApprovalBelow });
    
    const { shadowModeManager } = await import('../security/shadow-mode.js');
    await shadowModeManager.updateConfig({ enabled, autoBlockThreshold, requireApprovalBelow }, adminUid);
    
    res.json({ success: true, message: 'Configuração atualizada com sucesso!' });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar configuração:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/admin/shadow-mode/stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📊 ADMIN: Buscando estatísticas Shadow Mode...');
    
    const { shadowModeManager } = await import('../security/shadow-mode.js');
    const stats = await shadowModeManager.getStats();
    
    res.json({ success: true, stats });
  } catch (error: any) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🚨 API - PROCESSAR TENTATIVAS DE INSPEÇÃO - SECURITY: RATE LIMITED
router.post('/api/security/block-inspector', userRateLimit, async (req, res) => {
  try {
    const { reason, details, deviceInfo, timestamp, url, referrer, detection_count } = req.body;
    const sourceIp = req.ip || req.connection.remoteAddress || 'unknown';
    
    console.log(`🚨 TENTATIVA DE INSPEÇÃO DETECTADA: ${reason} - IP: ${sourceIp}`);
    
    // 🔍 EXTRAIR INFORMAÇÕES DETALHADAS
    const inspectionData = {
      reason,
      sourceIp,
      userAgent: req.get('User-Agent') || 'unknown',
      details: {
        ...details,
        deviceInfo: {
          ...deviceInfo,
          headers: {
            'accept': req.get('Accept'),
            'accept-language': req.get('Accept-Language'),
            'accept-encoding': req.get('Accept-Encoding'),
            'connection': req.get('Connection'),
            'host': req.get('Host'),
            'origin': req.get('Origin'),
            'referer': req.get('Referer'),
            'sec-fetch-dest': req.get('Sec-Fetch-Dest'),
            'sec-fetch-mode': req.get('Sec-Fetch-Mode'),
            'sec-fetch-site': req.get('Sec-Fetch-Site'),
            'x-forwarded-for': req.get('X-Forwarded-For'),
            'x-real-ip': req.get('X-Real-IP')
          },
          network: {
            remoteAddress: req.connection.remoteAddress,
            remotePort: req.connection.remotePort,
            localAddress: req.connection.localAddress,
            localPort: req.connection.localPort
          }
        }
      },
      url,
      referrer,
      detection_count,
      timestamp: timestamp || new Date().toISOString(),
      severity: 'CRITICAL',
      category: 'INSPECTION_ATTEMPT',
      action: 'BLOCKED'
    };

    // 💾 REGISTRAR NO NEON + BLOQUEAR IP
    await neonQuery(async (sql) => {
      const { nanoid } = await import('nanoid');
      const logId = nanoid(20);
      await sql`
        INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata, created_at)
        VALUES (${logId}, 'INSPECTION_ATTEMPT', 'ip', ${sourceIp}, ${JSON.stringify(inspectionData)}::jsonb, NOW())
        ON CONFLICT DO NOTHING
      `;
      const blockId = nanoid(20);
      await sql`
        INSERT INTO blocked_ips (id, ip_address, reason, severity, is_active, blocked_by, created_at, updated_at)
        VALUES (${blockId}, ${sourceIp}, ${'INSPECTION ATTEMPT: ' + reason}, 'critical', true, 'system', NOW(), NOW())
        ON CONFLICT (ip_address) DO UPDATE SET is_active = true, reason = EXCLUDED.reason, updated_at = NOW()
      `;
    }, `blockInspectionIP:${sourceIp}`).catch(() => {});

    // 🔄 ATUALIZAR CACHE IN-MEMORY 
    const { securityCache } = await import('../security/threatguard.js');
    securityCache.blockIP(sourceIp, `INSPECTION ATTEMPT: ${reason}`);

    console.log(`🛡️ IP ${sourceIp} BLOQUEADO PERMANENTEMENTE por tentativa de inspeção: ${reason}`);

    res.json({ 
      success: true, 
      message: 'Inspeção detectada e IP bloqueado',
      blocked: true,
      ip: sourceIp,
      reason: reason
    });

  } catch (error) {
    console.error('❌ Erro ao processar tentativa de inspeção:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚨 API - AUTO-BLACKLIST IP (PÚBLICO - SEM AUTENTICAÇÃO)
// Sistema inteligente: bloqueia APENAS o IP específico do invasor
router.post('/api/security/auto-blacklist', userRateLimit, async (req, res) => {
  try {
    const { addSuspiciousIPToPermanentBlacklist } = await import('../security/persistent-ip-blacklist.js');
    
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const { reason = 'DevTools aberto - Tentativa de inspeção', deviceInfo } = req.body;
    
    console.log(`🚨 AUTO-BLACKLIST TRIGGERED: ${clientIP} - ${reason}`);
    
    // Adicionar IP na blacklist permanente
    await addSuspiciousIPToPermanentBlacklist(
      clientIP,
      `Auto-block: ${reason} | UserAgent: ${deviceInfo?.userAgent || 'unknown'}`,
      'high'
    );
    
    console.log(`✅ IP ${clientIP} adicionado na blacklist automaticamente`);
    
    res.status(200).json({
      success: true,
      message: 'IP registrado com sucesso',
      ip: clientIP
    });
    
  } catch (error) {
    console.error('❌ Error auto-blacklisting IP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process request'
    });
  }
});

// 🚨 ENDPOINT DE SEGURANÇA - LOG TENTATIVAS DE DEVTOOLS - SECURITY: RATE LIMITED
router.post('/api/security/devtools-attempt', userRateLimit, (req, res) => {
  try {
    const { reason, timestamp, userAgent, url } = req.body;
    
    // 🔍 LOG SEGURO (SEM DADOS SENSÍVEIS)
    console.log('🚨 SECURITY BREACH DETECTED:', {
      reason,
      timestamp,
      userAgent: userAgent?.substring(0, 100) || 'unknown',
      url: url?.replace(/[?&]token=[^&]+/g, '?token=[HIDDEN]') || 'unknown',
      ip: req.ip || req.connection?.remoteAddress || 'unknown'
    });

    res.json({ logged: true });
  } catch (error) {
    // Silent fail para não expor informações
    res.status(200).json({ logged: false });
  }
});

// 🛡️ SECURITY SYSTEM HEALTH - ENDPOINT PARA DASHBOARD DE SEGURANÇA
router.get('/api/security/system-health', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const firebaseHealth = getFirebaseHealth();
    const cacheStats = { stats: { size: 0 }, logs: { size: 0 }, blockedIPs: { size: 0 } };
    
    res.json({
      success: true,
      system: {
        firebase: {
          healthy: firebaseHealth.healthy,
          status: firebaseHealth.status,
          consecutiveErrors: firebaseHealth.consecutiveErrors,
          lastError: firebaseHealth.lastError ? firebaseHealth.lastError.toISOString() : null
        },
        cache: {
          totalEntries: 0,
          stats: cacheStats.stats,
          logs: cacheStats.logs,
          blockedIPs: cacheStats.blockedIPs
        },
        analytics: {
          totalBreaches: 0,
          uniqueAttackers: 0,
          suspiciousIPs: 0
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting system health:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system health'
    });
  }
});

// 🔓 LIMPAR BLOQUEIOS INCORRETOS DE SEGURANÇA - SUPER ADMIN ONLY
router.post('/api/admin/security/clear-incorrect-blocks', verifyFirebaseToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔓 [ADMIN] Limpando bloqueios incorretos de privilege escalation...');
    
    const result = await clearPrivilegeEscalationBlocks();
    
    res.json({
      success: true,
      message: `${result.removed} IPs desbloqueados com sucesso`,
      removed: result.removed,
      ips: result.ips
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao limpar bloqueios:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao limpar bloqueios',
      details: error.message
    });
  }
});

// 🆘 ENDPOINT DE EMERGÊNCIA - LIMPAR BLOQUEIOS (REQUER ADMIN)
router.post('/api/emergency/unlock-access', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    console.log('🆘 EMERGÊNCIA: Desbloqueando acessos não-critical...');
    
    const result = await clearNonCriticalBlocks();
    
    res.json({
      success: true,
      message: `✅ Sistema desbloqueado! ${result.removed} bloqueios removidos. Você pode fazer login agora.`,
      removed: result.removed
    });
  } catch (error: any) {
    console.error('❌ Erro ao desbloquear:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao desbloquear acesso',
      message: error.message
    });
  }
});

// 🧹 LIMPAR TODOS OS BLOQUEIOS NÃO-CRITICAL (MEDIUM, HIGH, LOW) - SUPER ADMIN ONLY
router.post('/api/admin/security/clear-non-critical-blocks', verifyFirebaseToken, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🧹 [ADMIN] Limpando TODOS os bloqueios não-critical (medium, high, low)...');
    
    const result = await clearNonCriticalBlocks();
    
    res.json({
      success: true,
      message: `${result.removed} IPs não-critical desbloqueados (mantidos apenas CRITICAL)`,
      removed: result.removed,
      ips: result.ips
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao limpar bloqueios não-critical:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao limpar bloqueios não-critical',
      details: error.message
    });
  }
});

// 🔥 RESET TOTAL DE SEGURANÇA - LIMPAR TODA BLACKLIST E DADOS DE MONITORAMENTO - SUPER ADMIN ONLY
router.post('/api/admin/security/reset-all-security-data', async (req: any, res) => {
  try {
    // 🔑 AUTENTICAÇÃO DUPLA: Token Firebase OU Master Key
    const { masterKey } = req.body;
    const MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY;
    if (!MASTER_KEY) {
      return res.status(503).json({ error: 'ENCRYPTION_MASTER_KEY não configurada no servidor' });
    }
    
    // Verificar se tem master key válida (para emergências)
    const hasMasterKey = masterKey && masterKey === MASTER_KEY;
    
    // Verificar se tem token de admin válido
    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const admin = getAdmin();
        const decodedToken = await admin.auth().verifyIdToken(token);
        const userEmail = decodedToken.email;
        isAdmin = (process.env.ADMIN_EMAIL ? userEmail === process.env.ADMIN_EMAIL : false) || decodedToken.isAdmin === true;
      } catch (e) {
        // Token inválido, tentar master key
      }
    }
    
    // Requer master key OU ser super admin
    if (!hasMasterKey && !isAdmin) {
      return res.status(403).json({
        error: 'Acesso negado - Apenas Super Admin ou Master Key',
        hint: 'Use masterKey no body ou token de super admin'
      });
    }
    
    console.log(`🔥 [${hasMasterKey ? 'MASTER KEY' : 'SUPER ADMIN'}] RESET TOTAL DE SEGURANÇA - Limpando TODA blacklist, logs e dados de monitoramento...`);
    
    const result = await persistentBlacklist.clearAllSecurityData();
    
    res.json({
      success: true,
      message: `🔥 RESET TOTAL CONCLUÍDO! ${result.removed} entradas removidas de ${result.collections.length} coleções. Sistema de segurança zerado - começando do ZERO!`,
      removed: result.removed,
      collections: result.collections,
      details: {
        blacklistCleared: result.collections.includes('security_ip_blacklist'),
        securityLogsCleared: result.collections.includes('securityLogs'),
        blockedIPsCleared: result.collections.includes('blockedIPs'),
        memoryCacheCleared: true
      }
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao executar reset total de segurança:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao executar reset total de segurança',
      details: error.message
    });
  }
});

// 🔥 ROTA EMERGENCIAL - LIMPAR BLOQUEIOS RAPIDAMENTE (COM MASTERKEY)
router.post('/api/emergency/clear-blocks', async (req: any, res) => {
  try {
    const { masterKey } = req.body;
    const MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY;
    if (!MASTER_KEY) {
      return res.status(503).json({ error: 'ENCRYPTION_MASTER_KEY não configurada no servidor' });
    }
    if (masterKey !== MASTER_KEY) {
      return res.status(403).json({
        error: 'Master key inválida',
        hint: 'Use a ENCRYPTION_MASTER_KEY correta'
      });
    }
    
    console.log('🔥 [EMERGENCY] Limpando TODOS os bloqueios de IP...');
    
    // Limpar blacklist em memória
    const { clearBlacklist } = await import('../security/anti-cheat.js');
    const memoryCleared = clearBlacklist();
    
    // Limpar blacklist persistente do Firebase
    const result = await persistentBlacklist.clearAllSecurityData();
    
    console.log(`✅ [EMERGENCY] ${memoryCleared} IPs removidos da memória, ${result.removed} do Firebase`);
    
    res.json({
      success: true,
      message: '🔥 TODOS OS BLOQUEIOS REMOVIDOS! Acesso liberado!',
      memoryCleared,
      firebaseCleared: result.removed,
      collections: result.collections
    });
    
  } catch (error: any) {
    console.error('❌ Erro emergencial ao limpar bloqueios:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao limpar bloqueios',
      details: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 9116 — security.txt
// Permite que pesquisadores de segurança saibam onde reportar vulnerabilidades.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/.well-known/security.txt', (_req, res) => {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const expires = nextYear.toISOString().replace(/\.\d{3}Z$/, '.000Z');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(
`Contact: mailto:seguranca@volatuspay.com
Expires: ${expires}
Preferred-Languages: pt-BR, en
Canonical: https://volatuspay.com/.well-known/security.txt
Policy: https://volatuspay.com/politica-de-seguranca
Acknowledgments: https://volatuspay.com/hall-da-fama-seguranca
`
  );
});

export default router;
