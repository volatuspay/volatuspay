import { Router } from 'express';
import { Request, Response } from 'express';
import { getFirestore } from '../lib/firebase-admin.js';
import { getFirebaseHealth } from '../security/security-logger.js';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';

const router = Router();

// 💾 CACHE LEVE PARA LOGS (evita queries excessivas no Firebase)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class LightweightCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number; // Time to live em milliseconds
  
  constructor(ttlSeconds: number = 30) {
    this.ttl = ttlSeconds * 1000;
    
    // Limpeza automática a cada minuto
    setInterval(() => this.cleanup(), 60000);
  }
  
  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.ttl
    });
  }
  
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    // Verificar se expirou
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }
  
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
  
  getStats() {
    return {
      size: this.cache.size,
      ttl: this.ttl / 1000,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Caches específicos com TTLs otimizados
const statsCache = new LightweightCache<any>(30); // 30s para stats
const logsCache = new LightweightCache<any[]>(10); // 10s para logs
const blockedIPsCache = new LightweightCache<any[]>(15); // 15s para IPs bloqueados

// 🛡️ SISTEMA DE REPORTS DE SEGURANÇA IA
interface SecurityBreach {
  type: string;
  methods?: number;
  reasons?: string[];
  userAgent: string;
  timestamp: string;
  url: string;
  ip?: string;
  fingerprint?: string;
}

// 🤖 AI SECURITY ANALYTICS
const securityAnalytics = {
  breaches: new Map<string, SecurityBreach[]>(),
  threats: new Set<string>(),
  suspiciousIPs: new Set<string>(),
  
  addBreach(breach: SecurityBreach, ip: string) {
    const key = this.generateFingerprint(breach, ip);
    
    if (!this.breaches.has(key)) {
      this.breaches.set(key, []);
    }
    
    this.breaches.get(key)!.push(breach);
    
    // Mark IP as suspicious after 3 breaches
    const ipBreaches = Array.from(this.breaches.values())
      .flat()
      .filter((b: SecurityBreach) => b.ip === ip);
      
    if (ipBreaches.length >= 3) {
      this.suspiciousIPs.add(ip);
      console.log(`🚨 IP MARKED AS SUSPICIOUS: ${ip} (${ipBreaches.length} breaches)`);
    }
    
    // Learn threat patterns
    if (breach.reasons) {
      breach.reasons.forEach(reason => this.threats.add(reason));
    }
  },
  
  generateFingerprint(breach: SecurityBreach, ip: string): string {
    return `${ip}_${breach.userAgent.slice(0, 50)}_${breach.type}`;
  },
  
  isSuspiciousIP(ip: string): boolean {
    return this.suspiciousIPs.has(ip);
  },
  
  getStats() {
    return {
      totalBreaches: Array.from(this.breaches.values()).flat().length,
      uniqueAttackers: this.breaches.size,
      suspiciousIPs: this.suspiciousIPs.size,
      threatPatterns: this.threats.size,
      recentBreaches: Array.from(this.breaches.values())
        .flat()
        .filter((b: SecurityBreach) => new Date(b.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000))
        .length
    };
  }
};

// 🛡️ ENDPOINT PARA RECEBER REPORTS DE BREACH
router.post('/report-breach', (req: Request, res: Response) => {
  try {
    const breach: SecurityBreach = req.body;
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    // Add IP to breach data
    breach.ip = clientIP;
    breach.fingerprint = securityAnalytics.generateFingerprint(breach, clientIP);
    
    console.log(`🚨 SECURITY BREACH DETECTED:`, {
      type: breach.type,
      ip: clientIP,
      userAgent: breach.userAgent.slice(0, 100),
      methods: breach.methods,
      reasons: breach.reasons?.slice(0, 3) // Only log first 3 reasons
    });
    
    // Add to analytics
    securityAnalytics.addBreach(breach, clientIP);
    
    // 🤖 AI RESPONSE BASED ON THREAT LEVEL
    if (securityAnalytics.isSuspiciousIP(clientIP)) {
      console.log(`🔥 REPEAT OFFENDER DETECTED: ${clientIP}`);
      
      // Could trigger additional security measures here
      // Like rate limiting, IP blocking, etc.
    }
    
    res.status(200).json({
      success: true,
      message: 'Security breach logged',
      threatLevel: securityAnalytics.isSuspiciousIP(clientIP) ? 'HIGH' : 'MEDIUM',
      fingerprint: breach.fingerprint
    });
    
  } catch (error) {
    console.error('❌ Error processing security breach:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process security report'
    });
  }
});

// 🛡️ ENDPOINT PARA ADMIN VER ESTATÍSTICAS DE SEGURANÇA
// 🔒 CRITICAL SECURITY: Apenas admins podem ver estatísticas de segurança
router.get('/stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { period = '24h' } = req.query;
    const cacheKey = `stats_${period}`;
    
    // 💾 VERIFICAR CACHE PRIMEIRO
    const cached = statsCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }
    
    // ⏰ Calcular período
    const now = Date.now();
    const periodMs = period === '1h' ? 3600000 :
                      period === '24h' ? 86400000 :
                      period === '7d' ? 604800000 :
                      period === '30d' ? 2592000000 : 86400000;
    const cutoffTime = new Date(now - periodMs).toISOString();
    
    // 🔥 BUSCAR DADOS REAIS DO FIREBASE
    const db = getFirestore();
    
    // 📊 ESTATÍSTICAS DE AMEAÇAS (coleção securityLogs)
    const threatsSnapshot = await db.collection('securityLogs')
      .where('timestamp', '>=', cutoffTime)
      .get();
    
    const threats = threatsSnapshot.docs.map(doc => doc.data() as any);
    const totalThreats = threats.length;
    const threatsBlocked = threats.filter((t: any) => t.action === 'block' || t.blocked).length;
    
    // 📊 ESTATÍSTICAS DE IPs BLOQUEADOS (coleção blockedEntities)
    const blockedIPsSnapshot = await db.collection('blockedEntities')
      .where('active', '==', true)
      .where('type', '==', 'ip')
      .get();
    
    const blockedIPs = blockedIPsSnapshot.docs.map(doc => doc.data() as any);
    const totalBlockedIPs = blockedIPs.length;
    
    // 📊 IPs ÚNICOS ATACANTES
    const uniqueAttackerIPs = new Set(threats.map((t: any) => t.ip || t.sourceIp).filter(Boolean)).size;
    
    // 📊 AMEAÇAS POR CATEGORIA
    const threatsByCategory: Record<string, number> = {};
    threats.forEach((t: any) => {
      const category = t.threatCategory || t.category || 'unknown';
      threatsByCategory[category] = (threatsByCategory[category] || 0) + 1;
    });
    
    // 📊 AMEAÇAS POR SEVERIDADE
    const threatsBySeverity: Record<string, number> = {};
    threats.forEach((t: any) => {
      const severity = t.severity || 'unknown';
      threatsBySeverity[severity] = (threatsBySeverity[severity] || 0) + 1;
    });
    
    // 📊 AÇÕES TOMADAS
    const actionsTaken: Record<string, number> = {};
    threats.forEach((t: any) => {
      const action = t.action || 'log';
      actionsTaken[action] = (actionsTaken[action] || 0) + 1;
    });
    
    // 📊 PERFORMANCE
    const processingTimes = threats
      .map((t: any) => t.processingTime || t.responseTime || 0)
      .filter((t: number) => t > 0);
    const avgProcessingTime = processingTimes.length > 0
      ? Math.round(processingTimes.reduce((a: number, b: number) => a + b, 0) / processingTimes.length)
      : 0;
    
    // 🤖 ANÁLISE AI
    const aiAnalysisUsed = threats.filter((t: any) => t.aiAnalysis || t.aiScore).length;
    const aiConfidenceScores = threats
      .map((t: any) => t.aiConfidence || t.confidenceScore || 0)
      .filter((s: number) => s > 0);
    const avgAiConfidence = aiConfidenceScores.length > 0
      ? Math.round(aiConfidenceScores.reduce((a: number, b: number) => a + b, 0) / aiConfidenceScores.length)
      : 0;
    
    // 📊 TOP ATACANTES
    const ipCounts: Record<string, number> = {};
    threats.forEach((t: any) => {
      const ip = t.ip || t.sourceIp;
      if (ip) {
        ipCounts[ip] = (ipCounts[ip] || 0) + 1;
      }
    });
    const topAttackerIPs = Object.entries(ipCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, attempts]) => ({ ip, attempts }));
    
    const statsData = {
      success: true,
      period: period as string,
      totalThreats,
      threatsBlocked,
      totalBlockedIPs,
      uniqueAttackerIPs,
      threatsByCategory,
      threatsBySeverity,
      actionsTaken,
      avgProcessingTime,
      aiAnalysisUsed,
      avgAiConfidence,
      topAttackerIPs,
      generatedAt: new Date().toISOString()
    };
    
    // 💾 SALVAR NO CACHE
    statsCache.set(cacheKey, statsData);
    
    res.json(statsData);
    
  } catch (error) {
    console.error('❌ Error getting security stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get security stats'
    });
  }
});

// 📋 ENDPOINT PARA LISTAR LOGS DE SEGURANÇA
// 🔒 CRITICAL SECURITY: Apenas admins podem ver logs de segurança
router.get('/logs', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category, severity, search, limit = '100' } = req.query;
    const cacheKey = `logs_${category}_${severity}_${search}_${limit}`;
    
    // 💾 VERIFICAR CACHE PRIMEIRO
    const cached = logsCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    // 🔥 BUSCAR LOGS DO FIREBASE
    const db = getFirestore();
    let query = db.collection('securityLogs')
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit as string));
    
    // Aplicar filtros se fornecidos
    if (category && category !== 'all') {
      query = query.where('threatCategory', '==', category) as any;
    }
    if (severity && severity !== 'all') {
      query = query.where('severity', '==', severity) as any;
    }
    
    const snapshot = await query.get();
    let logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Filtro por busca (client-side pois Firebase não suporta LIKE)
    if (search) {
      const searchLower = (search as string).toLowerCase();
      logs = logs.filter((log: any) => 
        (log.ip || log.sourceIp || '').toLowerCase().includes(searchLower) ||
        (log.endpoint || '').toLowerCase().includes(searchLower) ||
        (log.threatCategory || '').toLowerCase().includes(searchLower)
      );
    }
    
    // 💾 SALVAR NO CACHE
    logsCache.set(cacheKey, logs);
    
    res.json(logs);
    
  } catch (error) {
    console.error('❌ Error getting security logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get security logs'
    });
  }
});

// 🚫 ENDPOINT PARA LISTAR IPs BLOQUEADOS
// 🔒 CRITICAL SECURITY: Apenas admins podem ver IPs bloqueados
router.get('/blocked-ips', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { active = 'true', search } = req.query;
    const cacheKey = `blocked_${active}_${search}`;
    
    // 💾 VERIFICAR CACHE PRIMEIRO
    const cached = blockedIPsCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    // 🔥 BUSCAR IPs BLOQUEADOS DO FIREBASE
    const db = getFirestore();
    let query = db.collection('blockedEntities');
    
    // Filtrar apenas IPs ativos se solicitado
    if (active === 'true') {
      query = query.where('active', '==', true) as any;
    }
    
    const snapshot = await query.get();
    let blockedIPs = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ipAddress: data.ip || data.ipAddress,
        reason: data.reason,
        threatCategories: data.threatCategories || [],
        severity: data.severity,
        riskScore: data.riskScore || 0,
        blockedBy: data.blockedBy || 'system',
        adminName: data.adminName,
        attacksBlocked: data.attacksBlocked || 0,
        lastAttemptAt: data.lastAttemptAt || data.lastSeen,
        totalAttempts: data.totalAttempts || data.attempts || 1,
        isActive: data.active !== undefined ? data.active : data.isActive,
        country: data.country,
        createdAt: data.timestamp || data.createdAt || data.addedAt,
        unlockedAt: data.unlockedAt,
        unblockReason: data.unlockReason || data.unblockReason
      };
    });
    
    // Filtro de busca (client-side)
    if (search) {
      const searchLower = (search as string).toLowerCase();
      blockedIPs = blockedIPs.filter((ip: any) => 
        (ip.ipAddress || '').toLowerCase().includes(searchLower) ||
        (ip.reason || '').toLowerCase().includes(searchLower) ||
        (ip.country || '').toLowerCase().includes(searchLower)
      );
    }
    
    // 💾 SALVAR NO CACHE
    blockedIPsCache.set(cacheKey, blockedIPs);
    
    res.json(blockedIPs);
    
  } catch (error) {
    console.error('❌ Error getting blocked IPs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get blocked IPs'
    });
  }
});

// 🔓 ENDPOINT PARA DESBLOQUEAR IP
// 🔒 CRITICAL SECURITY: Apenas admins podem desbloquear IPs
router.delete('/blocked-ips/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason = 'Desbloqueio manual via admin' } = req.body;
    
    // 🔥 DESBLOQUEAR NO FIREBASE
    const db = getFirestore();
    const docRef = db.collection('blockedEntities').doc(id);
    
    await docRef.update({
      active: false,
      isActive: false,
      unlockedAt: new Date().toISOString(),
      unlockReason: reason,
      unlockedBy: 'admin'
    });
    
    console.log(`🔓 IP desbloqueado: ${id} - ${reason}`);
    
    // 💾 LIMPAR CACHE RELACIONADO
    blockedIPsCache.clear();
    statsCache.clear();
    
    res.json({
      success: true,
      message: 'IP desbloqueado com sucesso'
    });
    
  } catch (error) {
    console.error('❌ Error unblocking IP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock IP'
    });
  }
});

// 🚫 ENDPOINT PARA BLOQUEAR IP MANUALMENTE
// 🔒 CRITICAL SECURITY: Apenas admins podem bloquear IPs manualmente
router.post('/block-ip', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ipAddress, reason, severity = 'high' } = req.body;
    
    if (!ipAddress || !reason) {
      return res.status(400).json({
        success: false,
        message: 'IP e motivo são obrigatórios'
      });
    }
    
    // 🔥 BLOQUEAR NO FIREBASE
    const db = getFirestore();
    const blockId = `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const blockData = {
      id: blockId,
      type: 'ip',
      ip: ipAddress,
      ipAddress,
      reason,
      severity,
      blockedBy: 'admin',
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      active: true,
      isActive: true,
      totalAttempts: 0,
      attacksBlocked: 0
    };
    
    await db.collection('blockedEntities').doc(blockId).set(blockData);
    
    console.log(`🚫 IP bloqueado manualmente: ${ipAddress} - ${reason}`);
    
    // 💾 LIMPAR CACHE RELACIONADO
    blockedIPsCache.clear();
    statsCache.clear();
    
    res.json({
      success: true,
      message: 'IP bloqueado com sucesso',
      ipAddress
    });
    
  } catch (error) {
    console.error('❌ Error blocking IP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block IP'
    });
  }
});

// 📊 ENDPOINT PARA VER STATS DO CACHE (SEM LIMPAR)
// 🔒 CRITICAL SECURITY: Apenas admins podem ver estatísticas de cache
router.get('/cache-stats', verifyFirebaseToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({
      success: true,
      caches: {
        stats: statsCache.getStats(),
        logs: logsCache.getStats(),
        blockedIPs: blockedIPsCache.getStats()
      },
      totalEntries: statsCache.getStats().size + logsCache.getStats().size + blockedIPsCache.getStats().size
    });
  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cache stats'
    });
  }
});

// 🏥 ENDPOINT PARA MONITORAR SAÚDE DO FIREBASE
// 🔒 CRITICAL SECURITY: Apenas admins podem ver saúde do Firebase
router.get('/firebase-health', verifyFirebaseToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const health = getFirebaseHealth();
    
    res.json({
      success: true,
      firebase: {
        healthy: health.healthy,
        status: health.status,
        consecutiveErrors: health.consecutiveErrors,
        lastError: health.lastError ? health.lastError.toISOString() : null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting Firebase health:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Firebase health'
    });
  }
});

// 🔍 ENDPOINT PARA SISTEMA DE MONITORAMENTO COMPLETO
// 🔒 CRITICAL SECURITY: Apenas admins podem ver saúde do sistema
router.get('/system-health', verifyFirebaseToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const firebaseHealth = getFirebaseHealth();
    const cacheStats = {
      stats: statsCache.getStats(),
      logs: logsCache.getStats(),
      blockedIPs: blockedIPsCache.getStats()
    };
    
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
          totalEntries: cacheStats.stats.size + cacheStats.logs.size + cacheStats.blockedIPs.size,
          stats: cacheStats.stats,
          logs: cacheStats.logs,
          blockedIPs: cacheStats.blockedIPs
        },
        analytics: {
          totalBreaches: Array.from(securityAnalytics.breaches.values()).flat().length,
          uniqueAttackers: securityAnalytics.breaches.size,
          suspiciousIPs: securityAnalytics.suspiciousIPs.size
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

// 🔄 ENDPOINT PARA RECARREGAR CACHE
// 🔒 CRITICAL SECURITY: Apenas admins podem recarregar cache
router.post('/reload-cache', verifyFirebaseToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    // Limpar cache em memória
    securityAnalytics.breaches.clear();
    securityAnalytics.threats.clear();
    securityAnalytics.suspiciousIPs.clear();
    
    // Limpar caches do Firebase
    statsCache.clear();
    logsCache.clear();
    blockedIPsCache.clear();
    
    console.log('🔄 Cache de segurança recarregado (analytics + Firebase)');
    
    res.json({
      success: true,
      message: 'Cache recarregado com sucesso',
      cacheStats: {
        stats: statsCache.getStats(),
        logs: logsCache.getStats(),
        blockedIPs: blockedIPsCache.getStats()
      }
    });
    
  } catch (error) {
    console.error('❌ Error reloading cache:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reload cache'
    });
  }
});

// 🛡️ ENDPOINT PARA VERIFICAR SE IP É SUSPEITO
// 🔒 CRITICAL SECURITY: Apenas admins podem verificar IPs suspeitos
router.get('/check-ip/:ip', verifyFirebaseToken, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ip } = req.params;
    const isSuspicious = securityAnalytics.isSuspiciousIP(ip);
    
    res.json({
      success: true,
      ip,
      suspicious: isSuspicious,
      breachCount: Array.from(securityAnalytics.breaches.values())
        .flat()
        .filter(b => b.ip === ip)
        .length
    });
    
  } catch (error) {
    console.error('❌ Error checking IP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check IP'
    });
  }
});

// 🧹 CLEANUP TASK: Remove old breaches (older than 7 days)
setInterval(() => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  securityAnalytics.breaches.forEach((breaches, key) => {
    const recentBreaches = breaches.filter(b => new Date(b.timestamp) > weekAgo);
    
    if (recentBreaches.length === 0) {
      securityAnalytics.breaches.delete(key);
    } else {
      securityAnalytics.breaches.set(key, recentBreaches);
    }
  });
  
  console.log(`🧹 Security cleanup: ${securityAnalytics.breaches.size} active breach patterns`);
}, 24 * 60 * 60 * 1000); // Run daily

// 🚨 ENDPOINT: AUTO-BLACKLIST IP QUANDO DEVTOOLS DETECTADO
// Sistema inteligente: bloqueia APENAS o IP do invasor, não todos os usuários
router.post('/auto-blacklist', async (req: Request, res: Response) => {
  try {
    const { addSuspiciousIPToPermanentBlacklist } = await import('../security/persistent-ip-blacklist');
    
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const { reason = 'DevTools aberto - Tentativa de inspeção', deviceInfo } = req.body;
    
    console.log(`🚨 AUTO-BLACKLIST TRIGGERED: ${clientIP} - ${reason}`);
    
    // Adicionar IP na blacklist permanente
    await addSuspiciousIPToPermanentBlacklist(
      clientIP,
      `Auto-block: ${reason}`,
      'high' // Severidade alta
    );
    
    console.log(`✅ IP ${clientIP} adicionado na blacklist automaticamente`);
    
    // 💾 LIMPAR CACHE RELACIONADO (dados críticos de segurança)
    blockedIPsCache.clear();
    statsCache.clear();
    
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

// 🗑️ ENDPOINT DE ADMIN: LIMPAR BLACKLIST DO FIREBASE
// ⚠️ USO: Remover bloqueios antigos por IP puro, manter apenas fingerprints
// 🔒 CRITICAL SECURITY: Apenas admins podem limpar blacklist
router.post('/admin/clear-blacklist', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 🔐 IMPORTAR MÓDULOS DE SEGURANÇA
    const { clearAll, clearIPOnlyEntries } = await import('../security/persistent-ip-blacklist');
    
    // ✅ NOTA: Verificação de admin deve ser feita externamente com middleware
    
    const { clearType = 'ip-only' } = req.body; // 'all' ou 'ip-only'
    
    // 🗑️ LIMPAR BLACKLIST
    let removedCount = 0;
    
    if (clearType === 'all') {
      // Limpar TUDO
      const result = await clearAll();
      removedCount = result.removed;
      console.log('🗑️ BLACKLIST TOTALMENTE LIMPA (admin request)');
    } else {
      // Limpar APENAS IPs puros (não-fingerprints)
      // Isso remove bloqueios legados que afetam redes inteiras
      const result = await clearIPOnlyEntries();
      removedCount = result.removed;
      console.log('🗑️ BLOQUEIOS POR IP REMOVIDOS, FINGERPRINTS MANTIDOS (admin request)');
    }
    
    res.json({
      success: true,
      message: clearType === 'all' 
        ? 'Blacklist completamente limpa' 
        : 'Bloqueios por IP removidos, fingerprints mantidos',
      removedCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('❌ Error clearing blacklist:', error);
    
    // Se erro de autenticação, retornar 403
    if (error.message?.includes('admin') || error.message?.includes('forbidden')) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado - apenas admin'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro ao limpar blacklist'
    });
  }
});

// 🌍 CONSULTAR INTELIGÊNCIA DE IP (GEOLOCALIZAÇÃO + VPS/PROXY DETECTION)
// GET /api/security/ip-intel/:ip
router.get('/ip-intel/:ip', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ip } = req.params;
    
    if (!ip) {
      return res.status(400).json({
        success: false,
        message: 'IP address is required'
      });
    }
    
    // Importar módulo de IP Intelligence
    const { analyzeIP, saveIPAnalysis } = await import('../security/ip-intelligence');
    
    // Analisar IP
    const intel = await analyzeIP(ip);
    
    if (!intel) {
      return res.status(404).json({
        success: false,
        message: 'Unable to analyze IP address',
        ip
      });
    }
    
    // Salvar análise no Firestore para histórico
    await saveIPAnalysis(intel);
    
    res.json({
      success: true,
      data: intel,
      analyzedAt: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('❌ Error analyzing IP:', error);
    res.status(500).json({
      success: false,
      message: 'Error analyzing IP address',
      error: error.message
    });
  }
});

// 📊 ESTATÍSTICAS DE IPs ANALISADOS
// GET /api/security/ip-stats
router.get('/ip-stats', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { getIPStats } = await import('../security/ip-intelligence');
    const stats = await getIPStats();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('❌ Error getting IP stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting IP statistics',
      error: error.message
    });
  }
});

export default router;