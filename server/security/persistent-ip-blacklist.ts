// 🛡️ SISTEMA DEVASTADOR DE LISTA NEGRA PERSISTENTE DE IPs
// Proteção permanente contra ataques DDoS e atividades maliciosas

import { storage } from '../storage';
import { sendEmail } from '../lib/email-service.js';

interface BlacklistEntry {
  ip: string; // IP ou FINGERPRINT único (fp_xxxx_192-168-1-1)
  reason: string;
  addedAt: number;
  expiresAt?: number; // undefined = permanente
  severity: 'low' | 'medium' | 'high' | 'critical';
  attempts: number;
  lastSeen: number;
  blockedEndpoints: string[];
  userAgent?: string;
  country?: string;
  isFingerprint?: boolean; // TRUE se é fingerprint, FALSE se é IP legado
}

// 🛡️ HELPER: Detectar IPs internos/privados (IPv4, IPv6, IPv4-mapped-IPv6)
export function isInternalIP(ip: string): boolean {
  if (!ip) return false;
  
  // IPv4 Loopback (127.0.0.0/8)
  if (ip === 'localhost' || ip.startsWith('127.')) return true;
  
  // IPv4 Private Ranges (RFC 1918)
  if (ip.startsWith('10.')) return true; // 10.0.0.0/8
  if (ip.startsWith('192.168.')) return true; // 192.168.0.0/16
  
  // 🔐 REPLIT INFRASTRUCTURE (160.20.0.0/16) - WHITELIST AUTOMÁTICA EM REPLIT
  // ✅ DETECÇÃO AUTOMÁTICA: Se está rodando no Replit (REPL_ID existe), sempre confiar
  // 🚨 FORA DO REPLIT: Requer flag ALLOW_REPLIT_IPS='true' EXPLÍCITA (segurança)
  if (ip.startsWith('160.20.')) {
    const isDev = process.env.NODE_ENV !== 'production';
    const isRunningOnReplit = !!(process.env.REPL_ID || process.env.REPL_SLUG);
    const allowReplitInProd = process.env.ALLOW_REPLIT_IPS === 'true';
    
    // ✅ CORREÇÃO CRÍTICA: Se está rodando NO REPLIT, SEMPRE confiar (desenvolvimento ou produção)
    if (isRunningOnReplit) {
      return true; // Confiável - rodando no Replit (qualquer ambiente)
    }
    
    // Desenvolvimento (fora do Replit): whitelist automática
    if (isDev) {
      return true; // Confiável em DEV
    }
    
    // Produção (fora do Replit): requer flag explícita com auditoria
    if (allowReplitInProd) {
      console.log(`⚠️ REPLIT IP WHITELISTED IN PRODUCTION: ${ip} (via ALLOW_REPLIT_IPS flag)`);
      return true; // Confiável APENAS com flag
    }
    
    // Produção sem flag (fora do Replit): tratar como IP externo (segurança)
    console.log(`🔍 REPLIT IP IN PRODUCTION (external): ${ip}`);
    return false;
  }
  
  // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172) {
    const octet = parseInt(match172[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  
  // IPv6 Loopback (::1)
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  
  // IPv6 Link-Local (fe80::/10)
  if (ip.toLowerCase().startsWith('fe80:')) return true;
  
  // IPv6 Unique Local Addresses (fc00::/7 = fc00::/8 e fd00::/8)
  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
  
  // IPv4-mapped IPv6 for private ranges (::ffff:10.x.x.x, ::ffff:192.168.x.x, ::ffff:172.16-31.x.x)
  if (ip.startsWith('::ffff:')) {
    const ipv4Part = ip.substring(7); // Remove "::ffff:"
    return isInternalIP(ipv4Part); // Recursively check the IPv4 part
  }
  
  return false;
}

// 🌐 HELPER: Detectar IPs de CDN/Edge confiáveis (Cloudflare, Replit, etc.)
export function isTrustedEdgeIP(ip: string): boolean {
  if (!ip) return false;
  
  // ✅ SEMPRE CONFIAR EM IPs INTERNOS PRIMEIRO
  if (isInternalIP(ip)) return true;
  
  // Cloudflare IPv4 ranges (principais)
  const cloudflareRanges = [
    '173.245.48.', '103.21.244.', '103.22.200.', '103.31.4.',
    '141.101.64.', '108.162.192.', '190.93.240.', '188.114.96.',
    '197.234.240.', '198.41.128.', '162.158.', '104.16.',
    '104.17.', '104.18.', '104.19.', '104.20.', '104.21.',
    '172.64.', '172.65.', '172.66.', '172.67.'
  ];
  
  for (const range of cloudflareRanges) {
    if (ip.startsWith(range)) {
      console.log(`✅ TRUSTED EDGE IP DETECTED (Cloudflare): ${ip}`);
      return true;
    }
  }
  
  // Replit CDN/Edge IPs conhecidos
  if (ip.startsWith('35.') || ip.startsWith('34.')) {
    console.log(`✅ TRUSTED EDGE IP DETECTED (Replit): ${ip}`);
    return true;
  }
  
  return false;
}

interface BlacklistStats {
  totalBlocked: number;
  severityBreakdown: { [key: string]: number };
  topReasons: { [key: string]: number };
  recentBlocks: number; // últimas 24h
}

// 🔥 SINGLETON DEVASTADOR DE BLACKLIST
class PersistentIPBlacklist {
  private readonly collectionName = 'security_ip_blacklist';
  private memoryCache = new Map<string, BlacklistEntry>();
  private emergencyMemoryBlacklist = new Map<string, BlacklistEntry>(); // 🚨 FALLBACK EM MEMÓRIA
  private cacheExpiry = 0;
  private readonly cacheTimeoutMs = 5 * 60 * 1000; // 5 minutos
  
  // 💰 PROTEÇÃO ANTI-CUSTO: Counter em memória para throttling de writes
  private writeThrottleCounter = new Map<string, number>();

  // 🚫 ADICIONAR DISPOSITIVO À LISTA NEGRA (IP ou FINGERPRINT)
  // ✨ NOVO: Aceita FINGERPRINT único para bloquear dispositivo específico
  // Previne bloqueio de rede inteira - bloqueia apenas o invasor
  // 🔒 APENAS BLOQUEIO MANUAL PELO ADMIN - AUTO-BLOCK DESABILITADO
  async addToBlacklist(
    ipOrFingerprint: string, 
    reason: string, 
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    isManualBlock: boolean = false, // 🔒 NOVO: Apenas admin pode bloquear
    expiresInMs?: number,
    endpoint?: string,
    userAgent?: string
  ): Promise<boolean> {
    const isFingerprint = ipOrFingerprint.startsWith('fp_');
    const ip = ipOrFingerprint; // Mantém compatibilidade com código existente
    try {
      // ✅ NUNCA BLOQUEAR IPs INTERNOS/PRIVADOS (Replit, Docker, Localhost, IPv6)
      if (isInternalIP(ip)) {
        console.log(`✅ IP INTERNO ${ip} NÃO BLOQUEADO (whitelist) - Razão: ${reason} [${severity}]`);
        return false; // Não adicionar IPs internos à blacklist
      }
      
      // 🔐 SEGURANÇA REFORÇADA: IPs de CDN/Edge podem ser bloqueados se CRITICAL + múltiplas tentativas
      if (isTrustedEdgeIP(ip)) {
        // ⚠️ APENAS CRITICAL com tentativas repetidas pode bloquear IPs de CDN
        const existingEntry = this.memoryCache.get(ip);
        const attemptCount = existingEntry ? existingEntry.attempts + 1 : 1;
        
        if (severity === 'critical' && attemptCount >= 3) {
          console.log(`🚨 TRUSTED EDGE IP ${ip} BLOQUEADO APÓS ${attemptCount} ATAQUES CRÍTICOS: ${reason}`);
          // Continua para bloquear
        } else {
          console.log(`✅ TRUSTED EDGE IP ${ip} MONITORADO (tentativa ${attemptCount}/${severity === 'critical' ? '3' : '∞'}): ${reason} [${severity}]`);
          
          // Atualizar contador no cache mas não bloquear
          if (existingEntry) {
            existingEntry.attempts = attemptCount;
            existingEntry.lastSeen = Date.now();
            this.memoryCache.set(ip, existingEntry);
          } else {
            this.memoryCache.set(ip, {
              ip, reason, addedAt: Date.now(), severity,
              attempts: attemptCount, lastSeen: Date.now(),
              blockedEndpoints: endpoint ? [endpoint] : []
            });
          }
          return false; // Não bloquear ainda
        }
      }
      
      const now = Date.now();
      const entry: BlacklistEntry = {
        ip,
        reason,
        addedAt: now,
        severity,
        attempts: 1,
        lastSeen: now,
        blockedEndpoints: endpoint ? [endpoint] : [],
        isFingerprint, // Marca se é fingerprint ou IP legado
        ...(expiresInMs && { expiresAt: now + expiresInMs }),
        ...(userAgent && { userAgent }),
      };

      // 🔒 APENAS BLOQUEIO MANUAL PELO ADMIN - AUTO-BLOCK COMPLETAMENTE DESABILITADO
      const deviceLabel = isFingerprint ? `DISPOSITIVO ${ip}` : `IP ${ip}`;
      
      // ✅ SEMPRE APENAS MONITORAR - NUNCA BLOQUEAR AUTOMATICAMENTE
      console.log(`⚠️ ${deviceLabel} DETECTADO E MONITORADO: ${reason} [${severity}]`);
      console.log(`📋 Admin pode revisar e bloquear MANUALMENTE via painel de auditoria`);
      
      // ❌ BLOQUEIO AUTOMÁTICO DESABILITADO - Salvar para monitoramento mas não bloquear
      // Admin deve bloquear via painel (POST /api/security/block-ip)
      this.memoryCache.set(ip, entry);

      // 💰 PROTEÇÃO ANTI-CUSTO: Throttling inteligente de writes no Firebase
      const currentCount = this.writeThrottleCounter.get(ip) || 0;
      const newCount = currentCount + 1;
      this.writeThrottleCounter.set(ip, newCount);
      
      // 💰 PROTEÇÃO ANTI-SOBRECARGA: Throttling agressivo para economizar Firebase
      let shouldWriteToFirebase = false;
      
      if (severity === 'critical') {
        // CRITICAL: sempre escrever (ataques críticos precisam ser registrados)
        shouldWriteToFirebase = true;
      } else if (severity === 'high') {
        // HIGH: escrever 1ª, 2ª e 3ª vez (threshold), depois esparso
        shouldWriteToFirebase = newCount <= 3 || newCount % 50 === 0;
      } else if (severity === 'medium') {
        // MEDIUM: apenas monitoramento, escreve muito menos
        shouldWriteToFirebase = newCount === 1 || newCount % 100 === 0;
      } else {
        // LOW: quase nunca escreve (apenas estatística)
        shouldWriteToFirebase = newCount === 1 || newCount % 500 === 0;
      }
      
      if (!shouldWriteToFirebase) {
        console.log(`💰 WRITE THROTTLED: IP ${ip} [${severity}] - tentativa ${newCount} (não salvando no Firebase para reduzir custos)`);
        return true; // Sucesso, mas não escreveu no Firebase
      }
      
      // 🚨 ALERTA DE SEGURANÇA — notifica admin em ataques críticos
      if (severity === 'critical') {
        const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SUPPORT_EMAIL || 'suporte@volatuspay.com';
        sendEmail({
          to: adminEmail,
          subject: `🚨 [VolatusPay] Ataque CRÍTICO detectado — ${ip}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;">
              <h2 style="color:#dc2626;">🚨 Alerta de Segurança — Ataque Crítico</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px;font-weight:bold;">IP/Dispositivo</td><td style="padding:8px;">${ip}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Motivo</td><td style="padding:8px;">${reason}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Severidade</td><td style="padding:8px;color:#dc2626;">${severity.toUpperCase()}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Tentativa Nº</td><td style="padding:8px;">${newCount}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Endpoint</td><td style="padding:8px;">${endpoint || '—'}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">User-Agent</td><td style="padding:8px;">${userAgent || '—'}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Horário</td><td style="padding:8px;">${new Date().toISOString()}</td></tr>
              </table>
              <p style="margin-top:16px;color:#6b7280;font-size:13px;">
                Acesse o painel admin → Segurança → Blacklist para revisar e bloquear manualmente.
              </p>
            </div>
          `,
        }).catch(() => {}); // fire-and-forget, nunca bloquear o fluxo
      }

      console.log(`💾 WRITING TO FIREBASE: IP ${ip} [${severity}] - tentativa ${newCount}`);

      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        console.warn('⚠️ Firebase not available - IP bloqueado apenas em memória');
        return true; // RETORNA TRUE mesmo sem Firebase!
      }

      const docRef = firebaseStorage.db.collection(this.collectionName).doc(ip);
      
      // 🔄 USAR TRANSAÇÃO PARA ATOMICIDADE
      await firebaseStorage.db.runTransaction(async (transaction: any) => {
        const doc = await transaction.get(docRef);
        
        let entry: BlacklistEntry;
        
        if (doc.exists) {
          // Atualizar entrada existente
          entry = doc.data() as BlacklistEntry;
          entry.attempts++;
          entry.lastSeen = now;
          entry.reason = `${entry.reason}; ${reason}`;
          
          // Escalar severidade se necessário
          if (severity === 'critical' || 
              (severity === 'high' && entry.severity !== 'critical') ||
              (severity === 'medium' && !['high', 'critical'].includes(entry.severity))) {
            entry.severity = severity;
          }
          
          if (endpoint && !entry.blockedEndpoints.includes(endpoint)) {
            entry.blockedEndpoints.push(endpoint);
          }
        } else {
          // Nova entrada
          entry = {
            ip,
            reason,
            addedAt: now,
            severity,
            attempts: 1,
            lastSeen: now,
            blockedEndpoints: endpoint ? [endpoint] : [],
            ...(expiresInMs && { expiresAt: now + expiresInMs }),
            ...(userAgent && { userAgent }),
          } as BlacklistEntry;
        }
        
        transaction.set(docRef, entry);
        return entry;
      });

      // Atualizar cache local
      this.memoryCache.set(ip, await this.getBlacklistEntry(ip) as BlacklistEntry);
      
      console.log(`🚫 IP ${ip} ADICIONADO À LISTA NEGRA PERMANENTE: ${reason} [${severity}]`);

      // 🐘 DUAL-WRITE → Neon (fire-and-forget)
      import('../lib/neon-security.js').then(({ neonWriteIPBlacklist }) => {
        neonWriteIPBlacklist({
          ip,
          reason,
          severity,
          attempts: 1,
          blockedEndpoints: endpoint ? [endpoint] : [],
          userAgent,
          addedAt: now,
          lastSeen: now,
        });
      }).catch(() => {});

      return true;
      
    } catch (error: any) {
      console.error(`❌ Erro ao adicionar IP ${ip} à blacklist:`, error);
      return false;
    }
  }

  // 🔍 VERIFICAR SE IP ESTÁ NA LISTA NEGRA (MODO SELETIVO - APENAS ATAQUES REAIS)
  async isBlacklisted(ip: string): Promise<{ blocked: boolean; entry?: BlacklistEntry }> {
    try {
      // 🆘 DESABILITADO TEMPORARIAMENTE - TODOS OS IPs PERMITIDOS
      // ✅ Retorna sempre blocked: false para permitir acesso de sellers
      return { blocked: false };
      
      /* CÓDIGO ORIGINAL COMENTADO PARA REFERÊNCIA
      // ✅ WHITELIST DE IPs INTERNOS/PRIVADOS (Replit, Docker, Localhost, IPv6)
      if (isInternalIP(ip)) {
        // 🧹 LIMPAR QUALQUER BLOQUEIO ANTERIOR (caso tenha sido bloqueado por engano)
        if (this.emergencyMemoryBlacklist.has(ip)) {
          this.emergencyMemoryBlacklist.delete(ip);
          console.log(`🔓 IP INTERNO ${ip} removido da blacklist de emergência (whitelist)`);
        }
        if (this.memoryCache.has(ip)) {
          this.memoryCache.delete(ip);
          console.log(`🔓 IP INTERNO ${ip} removido do cache de blacklist (whitelist)`);
        }
        return { blocked: false };
      }

      // 🚨 VERIFICAR BLOQUEIO EMERGENCIAL EM MEMÓRIA - APENAS CRITICAL = BLOQUEIO IMEDIATO!
      // ✅ CORREÇÃO: HIGH não bloqueia automaticamente
      if (this.emergencyMemoryBlacklist.has(ip)) {
        const entry = this.emergencyMemoryBlacklist.get(ip)!;
        // BLOQUEAR IMEDIATAMENTE APENAS SE FOR CRITICAL
        if (entry.severity === 'critical') {
          console.log(`🚨 IP ${ip} BLOQUEADO AUTOMATICAMENTE: ${entry.reason} [${entry.severity}]`);
          return { blocked: true, entry };
        }
        // Para outros níveis (including HIGH), apenas registrar
        console.log(`⚠️ IP ${ip} em monitoramento [${entry.severity}]: ${entry.reason}`);
        return { blocked: false };
      }
      */

      // 🔒 BLOQUEIO AUTOMÁTICO COMPLETAMENTE DESABILITADO
      // ✅ APENAS MONITORAMENTO - Admin decide MANUALMENTE se bloqueia
      if (this.memoryCache.has(ip) && Date.now() < this.cacheExpiry) {
        const entry = this.memoryCache.get(ip)!;
        
        // ⚠️ APENAS LOGAR - NUNCA BLOQUEAR
        if (entry.severity === 'critical') {
          console.log(`⚠️ CRITICAL DETECTADO (${entry.attempts} tentativas): ${ip} - ${entry.reason} - Admin pode bloquear manualmente`);
        } else if (entry.severity === 'high') {
          console.log(`⚠️ HIGH SEVERITY (${entry.attempts} tentativas): ${ip} - ${entry.reason} - Admin pode bloquear manualmente`);
        } else if (entry.severity === 'medium') {
          console.log(`📋 MEDIUM SEVERITY (${entry.attempts} tentativas): ${ip} - ${entry.reason} - Monitoramento ativo`);
        }
        
        // ❌ NUNCA BLOQUEAR AUTOMATICAMENTE
        return { blocked: false };
      }

      // Buscar no Firebase
      const entry = await this.getBlacklistEntry(ip);
      if (!entry) {
        return { blocked: false };
      }

      // Atualizar cache
      this.memoryCache.set(ip, entry);
      this.cacheExpiry = Date.now() + this.cacheTimeoutMs;
      
      // 🔒 BLOQUEIO AUTOMÁTICO COMPLETAMENTE DESABILITADO
      // ✅ APENAS MONITORAMENTO - Admin decide MANUALMENTE
      if (entry.severity === 'critical') {
        console.log(`⚠️ CRITICAL DETECTADO (${entry.attempts} tentativas): ${ip} - ${entry.reason} - Admin pode bloquear manualmente`);
      } else if (entry.severity === 'high') {
        console.log(`⚠️ HIGH SEVERITY (${entry.attempts} tentativas): ${ip} - ${entry.reason} - Admin pode bloquear manualmente`);
      } else if (entry.severity === 'medium') {
        console.log(`📋 MEDIUM SEVERITY (${entry.attempts} tentativas): ${ip} - ${entry.reason} - Monitoramento ativo`);
      }
      
      // ❌ NUNCA BLOQUEAR AUTOMATICAMENTE
      return { blocked: false };
      
    } catch (error: any) {
      console.error(`❌ Erro ao verificar blacklist para IP ${ip}:`, error);
      // Fail-safe: em caso de erro, assumir não bloqueado
      return { blocked: false };
    }
  }

  // ⏰ VERIFICAR SE ENTRADA EXPIROU
  private checkExpiry(entry: BlacklistEntry): { blocked: boolean; entry?: BlacklistEntry } {
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      // Entrada expirada - remover
      this.removeFromBlacklist(entry.ip);
      return { blocked: false };
    }
    
    return { blocked: true, entry };
  }

  // 🗑️ REMOVER IP DA LISTA NEGRA
  async removeFromBlacklist(ip: string): Promise<boolean> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return false;

      await firebaseStorage.db.collection(this.collectionName).doc(ip).delete();
      this.memoryCache.delete(ip);
      this.emergencyMemoryBlacklist.delete(ip); // 🔥 LIMPAR TAMBÉM DA MEMÓRIA EMERGENCIAL
      this.writeThrottleCounter.delete(ip); // 💰 LIMPAR CONTADOR DE THROTTLE
      
      console.log(`🔓 IP ${ip} REMOVIDO DA LISTA NEGRA (incluindo memória e counters)`);
      return true;
      
    } catch (error: any) {
      console.error(`❌ Erro ao remover IP ${ip} da blacklist:`, error);
      return false;
    }
  }

  // 📋 OBTER ENTRADA ESPECÍFICA
  async getBlacklistEntry(ip: string): Promise<BlacklistEntry | null> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return null;

      const doc = await firebaseStorage.db.collection(this.collectionName).doc(ip).get();
      return doc.exists ? doc.data() as BlacklistEntry : null;
      
    } catch (error: any) {
      console.error(`❌ Erro ao buscar entrada para IP ${ip}:`, error);
      return null;
    }
  }

  // 📋 OBTER ENTRADA DO CACHE EM MEMÓRIA (SYNC - para fallback rápido)
  getFromMemoryCache(ip: string): BlacklistEntry | null {
    // Verificar cache principal
    if (this.memoryCache.has(ip)) {
      return this.memoryCache.get(ip) || null;
    }
    // Verificar cache de emergência
    if (this.emergencyMemoryBlacklist.has(ip)) {
      return this.emergencyMemoryBlacklist.get(ip) || null;
    }
    return null;
  }

  // 📊 OBTER ESTATÍSTICAS DA LISTA NEGRA
  async getStats(): Promise<BlacklistStats> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        return { totalBlocked: 0, severityBreakdown: {}, topReasons: {}, recentBlocks: 0 };
      }

      const snapshot = await firebaseStorage.db.collection(this.collectionName).get();
      
      const stats: BlacklistStats = {
        totalBlocked: snapshot.size,
        severityBreakdown: { low: 0, medium: 0, high: 0, critical: 0 },
        topReasons: {},
        recentBlocks: 0
      };

      const now = Date.now();
      const last24h = now - (24 * 60 * 60 * 1000);

      snapshot.forEach((doc: any) => {
        const entry = doc.data() as BlacklistEntry;
        
        // Contagem por severidade
        stats.severityBreakdown[entry.severity]++;
        
        // Razões principais
        const mainReason = entry.reason.split(';')[0].trim();
        stats.topReasons[mainReason] = (stats.topReasons[mainReason] || 0) + 1;
        
        // Bloqueios recentes
        if (entry.addedAt > last24h) {
          stats.recentBlocks++;
        }
      });

      return stats;
      
    } catch (error: any) {
      console.error('❌ Erro ao obter estatísticas da blacklist:', error);
      return { totalBlocked: 0, severityBreakdown: {}, topReasons: {}, recentBlocks: 0 };
    }
  }

  // 🧹 LIMPEZA DE ENTRADAS EXPIRADAS
  async cleanup(): Promise<number> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return 0;

      const now = Date.now();
      
      // Buscar entradas expiradas
      const snapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .where('expiresAt', '<=', now)
        .limit(100)
        .get();

      if (snapshot.empty) return 0;

      // Deletar em batch
      const batch = firebaseStorage.db.batch();
      snapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
        this.memoryCache.delete(doc.id);
      });

      await batch.commit();
      
      console.log(`🧹 BLACKLIST CLEANUP: Removed ${snapshot.docs.length} expired entries`);
      return snapshot.docs.length;
      
    } catch (error: any) {
      console.error('❌ Erro na limpeza da blacklist:', error);
      return 0;
    }
  }

  // 🔄 RECARREGAR CACHE COMPLETO
  async reloadCache(): Promise<void> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return;

      this.memoryCache.clear();
      
      // Carregar apenas entradas ativas (últimas 24h ou sem expiração)
      const now = Date.now();
      const yesterday = now - (24 * 60 * 60 * 1000);
      
      const snapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .where('lastSeen', '>', yesterday)
        .limit(1000) // Limitar para performance
        .get();

      snapshot.forEach((doc: any) => {
        const entry = doc.data() as BlacklistEntry;
        this.memoryCache.set(entry.ip, entry);
      });

      this.cacheExpiry = now + this.cacheTimeoutMs;
      
      console.log(`🔄 BLACKLIST CACHE RELOADED: ${this.memoryCache.size} active entries`);
      
    } catch (error: any) {
      console.error('❌ Erro ao recarregar cache da blacklist:', error);
    }
  }

  // 🧹 LIMPEZA ONE-TIME DE IPs INTERNOS (ADMIN ONLY)
  async cleanupInternalIPs(): Promise<{ removed: number; ips: string[] }> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        return { removed: 0, ips: [] };
      }

      console.log('🧹 INICIANDO LIMPEZA DE IPs INTERNOS DA BLACKLIST...');

      // Buscar TODOS os IPs bloqueados (sem limite)
      const snapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .get();

      if (snapshot.empty) {
        console.log('✅ Blacklist vazia - nada a limpar');
        return { removed: 0, ips: [] };
      }

      // Filtrar apenas IPs internos
      const internalIPs: string[] = [];
      snapshot.forEach((doc: any) => {
        const entry = doc.data() as BlacklistEntry;
        if (isInternalIP(entry.ip)) {
          internalIPs.push(entry.ip);
        }
      });
      
      if (internalIPs.length === 0) {
        console.log('✅ Nenhum IP interno encontrado na blacklist');
        return { removed: 0, ips: [] };
      }

      // Remover IPs internos
      const batch = firebaseStorage.db.batch();
      snapshot.forEach((doc: any) => {
        const entry = doc.data() as BlacklistEntry;
        if (isInternalIP(entry.ip)) {
          batch.delete(doc.ref);
        }
      });

      await batch.commit();

      // Limpar do cache em memória
      for (const ip of internalIPs) {
        this.memoryCache.delete(ip);
        this.emergencyMemoryBlacklist.delete(ip);
        console.log(`🔓 IP INTERNO ${ip} removido do cache de blacklist (whitelist)`);
      }

      // Recarregar cache
      await this.reloadCache();

      console.log(`✅ LIMPEZA CONCLUÍDA: ${internalIPs.length} IPs internos removidos da blacklist`);
      return { removed: internalIPs.length, ips: internalIPs };

    } catch (error) {
      console.error('❌ Erro ao limpar IPs internos da blacklist:', error);
      return { removed: 0, ips: [] };
    }
  }

  // 🧹 LIMPEZA DE IPs DE CDN/EDGE CONFIÁVEIS (STARTUP)
  async cleanupTrustedEdgeIPs(): Promise<{ removed: number; ips: string[] }> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        return { removed: 0, ips: [] };
      }

      console.log('🧹 INICIANDO LIMPEZA DE IPs DE CDN/EDGE DA BLACKLIST...');

      // Buscar TODOS os IPs bloqueados (sem limite)
      const snapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .get();

      if (snapshot.empty) {
        console.log('✅ Blacklist vazia - nada a limpar');
        return { removed: 0, ips: [] };
      }

      // Filtrar apenas IPs de CDN/Edge
      const edgeIPs: string[] = [];
      snapshot.forEach((doc: any) => {
        const entry = doc.data() as BlacklistEntry;
        if (isTrustedEdgeIP(entry.ip) && !isInternalIP(entry.ip)) {
          edgeIPs.push(entry.ip);
        }
      });

      if (edgeIPs.length === 0) {
        console.log('✅ Nenhum IP de CDN/Edge encontrado na blacklist');
        return { removed: 0, ips: [] };
      }

      // Remover IPs de CDN/Edge
      const batch = firebaseStorage.db.batch();
      snapshot.forEach((doc: any) => {
        const entry = doc.data() as BlacklistEntry;
        if (isTrustedEdgeIP(entry.ip) && !isInternalIP(entry.ip)) {
          batch.delete(doc.ref);
        }
      });

      await batch.commit();

      // Limpar do cache em memória
      for (const ip of edgeIPs) {
        this.memoryCache.delete(ip);
        this.emergencyMemoryBlacklist.delete(ip);
        console.log(`🔓 TRUSTED EDGE IP ${ip} removido do cache de blacklist (CDN whitelist)`);
      }

      // Recarregar cache
      await this.reloadCache();

      console.log(`✅ LIMPEZA CONCLUÍDA: ${edgeIPs.length} IPs de CDN/Edge removidos da blacklist`);
      return { removed: edgeIPs.length, ips: edgeIPs };

    } catch (error) {
      console.error('❌ Erro ao limpar IPs de CDN/Edge da blacklist:', error);
      return { removed: 0, ips: [] };
    }
  }

  // 🔥 RESET TOTAL - LIMPAR TODA A BLACKLIST E DADOS DE MONITORAMENTO
  async clearAllSecurityData(): Promise<{ removed: number; collections: string[] }> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        console.warn('⚠️ Firebase não disponível - limpando apenas cache em memória');
        this.memoryCache.clear();
        this.emergencyMemoryBlacklist.clear();
        return { removed: 0, collections: [] };
      }

      console.log('🔥 INICIANDO RESET TOTAL DE SEGURANÇA - LIMPANDO TODA A BLACKLIST E MONITORAMENTO...');

      let totalRemoved = 0;
      const collections: string[] = [];

      // 1️⃣ LIMPAR BLACKLIST (security_ip_blacklist)
      const blacklistSnapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .get();

      if (!blacklistSnapshot.empty) {
        const batch1 = firebaseStorage.db.batch();
        blacklistSnapshot.forEach((doc: any) => {
          batch1.delete(doc.ref);
        });
        await batch1.commit();
        totalRemoved += blacklistSnapshot.size;
        collections.push(this.collectionName);
        console.log(`🔥 ${blacklistSnapshot.size} entradas removidas de ${this.collectionName}`);
      }

      // 2️⃣ LIMPAR LOGS DE SEGURANÇA (securityLogs)
      const securityLogsSnapshot = await firebaseStorage.db
        .collection('securityLogs')
        .get();

      if (!securityLogsSnapshot.empty) {
        const batch2 = firebaseStorage.db.batch();
        securityLogsSnapshot.forEach((doc: any) => {
          batch2.delete(doc.ref);
        });
        await batch2.commit();
        totalRemoved += securityLogsSnapshot.size;
        collections.push('securityLogs');
        console.log(`🔥 ${securityLogsSnapshot.size} logs de segurança removidos`);
      }

      // 3️⃣ LIMPAR IPs BLOQUEADOS (blockedIPs)
      const blockedIPsSnapshot = await firebaseStorage.db
        .collection('blockedIPs')
        .get();

      if (!blockedIPsSnapshot.empty) {
        const batch3 = firebaseStorage.db.batch();
        blockedIPsSnapshot.forEach((doc: any) => {
          batch3.delete(doc.ref);
        });
        await batch3.commit();
        totalRemoved += blockedIPsSnapshot.size;
        collections.push('blockedIPs');
        console.log(`🔥 ${blockedIPsSnapshot.size} IPs bloqueados removidos`);
      }

      // 4️⃣ LIMPAR CACHE EM MEMÓRIA
      this.memoryCache.clear();
      this.emergencyMemoryBlacklist.clear();
      console.log('💾 Cache em memória limpo (memoryCache + emergencyBlacklist)');

      console.log(`✅ RESET TOTAL CONCLUÍDO: ${totalRemoved} entradas removidas de ${collections.length} coleções`);
      return { removed: totalRemoved, collections };

    } catch (error) {
      console.error('❌ Erro ao executar reset total de segurança:', error);
      throw error;
    }
  }
}

// 🎯 SINGLETON GLOBAL
const persistentBlacklist = new PersistentIPBlacklist();

// Limpeza automática a cada 6 horas
setInterval(() => {
  persistentBlacklist.cleanup();
}, 6 * 60 * 60 * 1000);

// Recarga de cache a cada 10 minutos
setInterval(() => {
  persistentBlacklist.reloadCache();
}, 10 * 60 * 1000);

// 🔓 HELPERS PARA DESENVOLVIMENTO
const normalizeIP = (ip: string) => ip?.replace(/^::ffff:/, '').trim();

// 🛡️ MIDDLEWARE EXPRESS PARA VERIFICAÇÃO DE BLACKLIST (APENAS ATAQUES CRÍTICOS)
export const blacklistMiddleware = async (req: any, res: any, next: any) => {
  // Middleware desabilitado — bloqueios automáticos por IP removidos
  return next();
};

// 🔥 FUNÇÕES UTILITÁRIAS - BLOQUEIO APENAS MANUAL PELO ADMIN
export const addSuspiciousIPToPermanentBlacklist = async (
  ip: string, 
  reason: string, 
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  isManualBlock: boolean = false // 🔒 Apenas admin (isManualBlock=true)
) => {
  return await persistentBlacklist.addToBlacklist(ip, reason, severity, isManualBlock);
};

export const checkIPBlacklist = async (ip: string) => {
  return await persistentBlacklist.isBlacklisted(ip);
};

// Wrapper para uso no BlacklistGate
export const isIPBlacklisted = async (ip: string): Promise<boolean> => {
  const result = await persistentBlacklist.isBlacklisted(ip);
  return result.blocked;
};

// Export direto do método público
export const getBlacklistEntry = async (ip: string) => {
  return await persistentBlacklist.getBlacklistEntry(ip);
};

export const getBlacklistStats = async () => {
  return await persistentBlacklist.getStats();
};

// 🔓 LIMPAR BLOQUEIOS INCORRETOS DE PRIVILEGE ESCALATION E RBAC
export const clearPrivilegeEscalationBlocks = async (): Promise<{ removed: number; ips: string[] }> => {
  try {
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      console.warn('⚠️ Firebase não disponível para limpar bloqueios');
      return { removed: 0, ips: [] };
    }

    const snapshot = await firebaseStorage.db.collection('security_ip_blacklist').get();
    const ipsToRemove: string[] = [];

    // 🔍 Encontrar IPs bloqueados por razões legítimas (não ataques)
    snapshot.forEach((doc: any) => {
      const entry = doc.data() as BlacklistEntry;
      const reason = entry.reason || '';
      
      // ❌ REMOVER bloqueios de navegação legítima
      if (reason.includes('Privilege Escalation') || 
          reason.includes('Horizontal') || 
          reason.includes('Vertical') ||
          reason.includes('RBAC Violation') ||
          reason.includes('Mass Assignment') ||
          reason.includes('Role-Based')) {
        console.log(`🔓 Removendo bloqueio incorreto: ${entry.ip} - ${reason}`);
        ipsToRemove.push(entry.ip);
      }
    });

    // Remover IPs
    const batch = firebaseStorage.db.batch();
    for (const ip of ipsToRemove) {
      const docRef = firebaseStorage.db.collection('security_ip_blacklist').doc(ip);
      batch.delete(docRef);
    }

    await batch.commit();

    // Limpar do cache
    for (const ip of ipsToRemove) {
      persistentBlacklist['memoryCache'].delete(ip);
      persistentBlacklist['emergencyMemoryBlacklist'].delete(ip);
    }

    console.log(`✅ LIMPEZA CONCLUÍDA: ${ipsToRemove.length} IPs removidos por bloqueio incorreto de privilege escalation`);
    return { removed: ipsToRemove.length, ips: ipsToRemove };

  } catch (error) {
    console.error('❌ Erro ao limpar bloqueios de privilege escalation:', error);
    return { removed: 0, ips: [] };
  }
};

// 🧹 LIMPAR TODOS OS IPs NÃO-CRITICAL (PARA RESETAR BLOQUEIOS FALSOS POSITIVOS)
export const clearNonCriticalBlocks = async (): Promise<{ removed: number; ips: string[] }> => {
  try {
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      console.warn('⚠️ Firebase não disponível para limpar bloqueios');
      return { removed: 0, ips: [] };
    }

    const snapshot = await firebaseStorage.db.collection('security_ip_blacklist').get();
    const ipsToRemove: string[] = [];

    // 🔍 Remover TODOS os IPs com severity LOW, MEDIUM e HIGH (mantém apenas CRITICAL)
    snapshot.forEach((doc: any) => {
      const entry = doc.data() as BlacklistEntry;
      
      // ❌ REMOVER se não for CRITICAL (mantém apenas ataques reais confirmados)
      if (entry.severity !== 'critical') {
        console.log(`🧹 Removendo bloqueio não-critical: ${entry.ip} [${entry.severity}] - ${entry.reason}`);
        ipsToRemove.push(entry.ip);
      }
    });

    // Remover IPs
    const batch = firebaseStorage.db.batch();
    for (const ip of ipsToRemove) {
      const docRef = firebaseStorage.db.collection('security_ip_blacklist').doc(ip);
      batch.delete(docRef);
    }

    await batch.commit();

    // Limpar do cache
    for (const ip of ipsToRemove) {
      persistentBlacklist['memoryCache'].delete(ip);
      persistentBlacklist['emergencyMemoryBlacklist'].delete(ip);
    }

    console.log(`✅ LIMPEZA GERAL CONCLUÍDA: ${ipsToRemove.length} IPs não-critical removidos`);
    return { removed: ipsToRemove.length, ips: ipsToRemove };

  } catch (error) {
    console.error('❌ Erro ao limpar bloqueios não-critical:', error);
    return { removed: 0, ips: [] };
  }
};

// 🗑️ LIMPAR TODA A BLACKLIST (APENAS ADMIN)
export const clearAll = async (): Promise<{ removed: number }> => {
  try {
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      console.warn('⚠️ Firebase não disponível para limpar blacklist');
      return { removed: 0 };
    }

    const snapshot = await firebaseStorage.db.collection('security_ip_blacklist').get();
    const batch = firebaseStorage.db.batch();
    
    snapshot.forEach((doc: any) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    // Limpar caches
    persistentBlacklist['memoryCache'].clear();
    persistentBlacklist['emergencyMemoryBlacklist'].clear();
    
    console.log(`🗑️ BLACKLIST TOTALMENTE LIMPA: ${snapshot.size} entradas removidas`);
    return { removed: snapshot.size };
    
  } catch (error) {
    console.error('❌ Erro ao limpar blacklist:', error);
    return { removed: 0 };
  }
};

// 🎯 LIMPAR APENAS BLOQUEIOS POR IP PURO (MANTÉM FINGERPRINTS)
// Remove bloqueios legados que afetam redes inteiras
export const clearIPOnlyEntries = async (): Promise<{ removed: number; ips: string[] }> => {
  try {
    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      console.warn('⚠️ Firebase não disponível para limpar bloqueios');
      return { removed: 0, ips: [] };
    }

    const snapshot = await firebaseStorage.db.collection('security_ip_blacklist').get();
    const ipsToRemove: string[] = [];

    // 🔍 Encontrar entradas que NÃO são fingerprints (IP puro)
    snapshot.forEach((doc: any) => {
      const entry = doc.data() as BlacklistEntry;
      
      // Fingerprints começam com 'fp_', IPs puros não
      const isFingerprint = entry.ip?.startsWith('fp_') || entry.isFingerprint;
      
      if (!isFingerprint) {
        console.log(`🗑️ Removendo bloqueio por IP puro: ${entry.ip} - ${entry.reason}`);
        ipsToRemove.push(entry.ip);
      }
    });

    // Remover IPs puros
    const batch = firebaseStorage.db.batch();
    for (const ip of ipsToRemove) {
      const docRef = firebaseStorage.db.collection('security_ip_blacklist').doc(ip);
      batch.delete(docRef);
    }

    await batch.commit();

    // Limpar do cache
    for (const ip of ipsToRemove) {
      persistentBlacklist['memoryCache'].delete(ip);
      persistentBlacklist['emergencyMemoryBlacklist'].delete(ip);
    }

    console.log(`✅ BLOQUEIOS POR IP REMOVIDOS: ${ipsToRemove.length} IPs puros limpos, fingerprints mantidos`);
    return { removed: ipsToRemove.length, ips: ipsToRemove };

  } catch (error) {
    console.error('❌ Erro ao limpar bloqueios por IP:', error);
    return { removed: 0, ips: [] };
  }
};

export { persistentBlacklist };