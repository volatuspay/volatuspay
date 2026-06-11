// 🛡️ SECURITY RESPONSE SERVICE - BANIMENTO AUTOMÁTICO INTELIGENTE
// Sistema unificado de resposta a incidentes de segurança com thresholds adaptativos

import { persistentBlacklist } from './persistent-ip-blacklist';

// 📊 TIPOS DE INCIDENTES
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentType = 
  | 'sql_injection' 
  | 'xss_attempt' 
  | 'command_injection'
  | 'pentest_tool'
  | 'python_scanner'
  | 'malicious_bot'
  | 'path_traversal'
  | 'rate_limit_exceeded'
  | 'honeypot_triggered'
  | 'brute_force';

interface SecurityIncident {
  ip: string;
  type: IncidentType;
  severity: IncidentSeverity;
  evidence: string;
  endpoint: string;
  userAgent?: string;
  timestamp: number;
}

interface IPIncidentRecord {
  ip: string;
  incidents: SecurityIncident[];
  totalScore: number;
  firstSeen: number;
  lastSeen: number;
  banCount: number;
  currentBanExpiry?: number;
}

// 🎯 CONFIGURAÇÃO DE THRESHOLDS
const SECURITY_THRESHOLDS = {
  // Pontuação por tipo de incidente
  scores: {
    sql_injection: 40,
    xss_attempt: 35,
    command_injection: 50,
    pentest_tool: 30,
    python_scanner: 25,
    malicious_bot: 20,
    path_traversal: 35,
    rate_limit_exceeded: 15,
    honeypot_triggered: 100,
    brute_force: 30
  },
  
  // Severidade por tipo
  severities: {
    sql_injection: 'high' as IncidentSeverity,
    xss_attempt: 'high' as IncidentSeverity,
    command_injection: 'critical' as IncidentSeverity,
    pentest_tool: 'medium' as IncidentSeverity,
    python_scanner: 'medium' as IncidentSeverity,
    malicious_bot: 'low' as IncidentSeverity,
    path_traversal: 'high' as IncidentSeverity,
    rate_limit_exceeded: 'low' as IncidentSeverity,
    honeypot_triggered: 'critical' as IncidentSeverity,
    brute_force: 'high' as IncidentSeverity
  },
  
  // Limites para banimento
  banThresholds: {
    immediate: 100,      // Ban imediato (honeypot, command injection)
    high: 80,            // Ban após acumular 80 pontos
    medium: 120,         // Ban após acumular 120 pontos
    low: 200             // Ban após acumular 200 pontos
  },
  
  // Duração de bans (ms)
  banDurations: {
    first: 4 * 60 * 60 * 1000,      // 4 horas - primeiro ban
    second: 24 * 60 * 60 * 1000,    // 24 horas - segundo ban
    third: 7 * 24 * 60 * 60 * 1000, // 7 dias - terceiro ban
    permanent: undefined             // Permanente - 4+ bans
  },
  
  // Janela de tempo para acúmulo (ms)
  incidentWindow: 15 * 60 * 1000,   // 15 minutos
  
  // Decay de pontos (por minuto)
  scoreDecayRate: 2
};

// 🔥 SINGLETON DO SERVIÇO DE RESPOSTA
class SecurityResponseService {
  private incidentRecords = new Map<string, IPIncidentRecord>();
  private bannedIPs = new Map<string, number>(); // IP -> ban expiry timestamp
  private metrics = {
    totalIncidents: 0,
    totalBans: 0,
    incidentsByType: {} as Record<IncidentType, number>,
    bansByReason: {} as Record<string, number>
  };
  
  constructor() {
    // Limpeza periódica de registros antigos
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // A cada 5 minutos
    console.log('🛡️ SecurityResponseService inicializado com banimento automático');
    
    // 🔥 HIDRATAÇÃO: Carregar bans persistidos do Firebase no startup
    this.hydrateBansFromPersistentStorage();
  }
  
  // 🔥 HIDRATAR BANS DO STORAGE PERSISTENTE (Firebase)
  private async hydrateBansFromPersistentStorage(): Promise<void> {
    try {
      // Aguardar reloadCache do persistentBlacklist
      await persistentBlacklist.reloadCache();
      console.log('🔄 SecurityResponseService: Bans persistidos hidratados do Firebase');
    } catch (error) {
      console.warn('⚠️ SecurityResponseService: Falha ao hidratar bans persistidos:', error);
    }
  }
  
  // 📝 REGISTRAR INCIDENTE DE SEGURANÇA
  recordIncident(
    ip: string,
    type: IncidentType,
    evidence: string,
    endpoint: string,
    userAgent?: string
  ): { banned: boolean; reason?: string; expiresAt?: number } {
    const now = Date.now();
    const severity = SECURITY_THRESHOLDS.severities[type];
    const score = SECURITY_THRESHOLDS.scores[type];
    
    // Criar incidente
    const incident: SecurityIncident = {
      ip,
      type,
      severity,
      evidence: this.sanitizeEvidence(evidence),
      endpoint,
      userAgent,
      timestamp: now
    };
    
    // Buscar ou criar registro do IP
    let record = this.incidentRecords.get(ip);
    if (!record) {
      record = {
        ip,
        incidents: [],
        totalScore: 0,
        firstSeen: now,
        lastSeen: now,
        banCount: 0
      };
    }
    
    // Aplicar decay de pontos antigos
    record.totalScore = this.applyScoreDecay(record);
    
    // Adicionar incidente
    record.incidents.push(incident);
    record.totalScore += score;
    record.lastSeen = now;
    
    // Manter apenas incidentes recentes
    record.incidents = record.incidents.filter(
      i => now - i.timestamp < SECURITY_THRESHOLDS.incidentWindow
    );
    
    this.incidentRecords.set(ip, record);
    
    // Atualizar métricas
    this.metrics.totalIncidents++;
    this.metrics.incidentsByType[type] = (this.metrics.incidentsByType[type] || 0) + 1;
    
    // Log do incidente
    console.log(`🚨 SECURITY INCIDENT: ${type} from IP=${ip} Score=${score} Total=${record.totalScore} Evidence="${incident.evidence.substring(0, 100)}"`);
    
    // Verificar se deve banir
    return this.evaluateBan(ip, record, type);
  }
  
  // 🔒 AVALIAR SE DEVE BANIR O IP
  private evaluateBan(
    ip: string,
    record: IPIncidentRecord,
    lastIncidentType: IncidentType
  ): { banned: boolean; reason?: string; expiresAt?: number } {
    const severity = SECURITY_THRESHOLDS.severities[lastIncidentType];
    let shouldBan = false;
    let banReason = '';
    
    // Verificar ban imediato (critical)
    if (severity === 'critical' || record.totalScore >= SECURITY_THRESHOLDS.banThresholds.immediate) {
      shouldBan = true;
      banReason = `Immediate ban: ${lastIncidentType} (score: ${record.totalScore})`;
    }
    // Verificar threshold high
    else if (record.totalScore >= SECURITY_THRESHOLDS.banThresholds.high) {
      shouldBan = true;
      banReason = `Threshold exceeded: ${record.totalScore} points in ${record.incidents.length} incidents`;
    }
    
    if (shouldBan) {
      return this.banIP(ip, record, banReason);
    }
    
    return { banned: false };
  }
  
  // 🚫 BANIR IP
  private banIP(
    ip: string,
    record: IPIncidentRecord,
    reason: string
  ): { banned: boolean; reason: string; expiresAt?: number } {
    record.banCount++;
    
    // Determinar duração do ban
    let banDuration: number | undefined;
    if (record.banCount === 1) {
      banDuration = SECURITY_THRESHOLDS.banDurations.first;
    } else if (record.banCount === 2) {
      banDuration = SECURITY_THRESHOLDS.banDurations.second;
    } else if (record.banCount === 3) {
      banDuration = SECURITY_THRESHOLDS.banDurations.third;
    } else {
      banDuration = undefined; // Permanente
    }
    
    const expiresAt = banDuration ? Date.now() + banDuration : undefined;
    record.currentBanExpiry = expiresAt;
    
    // Registrar na blacklist persistente
    const severity = record.banCount >= 3 ? 'critical' : 
                     record.banCount === 2 ? 'high' : 'medium';
    
    persistentBlacklist.addToBlacklist(
      ip,
      reason,
      severity,
      true, // isManualBlock = true para forçar bloqueio
      banDuration
    );
    
    // Registrar no cache local
    this.bannedIPs.set(ip, expiresAt || Infinity);
    this.incidentRecords.set(ip, record);
    
    // Atualizar métricas
    this.metrics.totalBans++;
    this.metrics.bansByReason[reason.split(':')[0]] = 
      (this.metrics.bansByReason[reason.split(':')[0]] || 0) + 1;
    
    const durationStr = banDuration 
      ? `${Math.round(banDuration / (60 * 60 * 1000))} hours`
      : 'PERMANENT';
    
    console.log(`🚫 IP BANNED: ${ip} | Reason: ${reason} | Duration: ${durationStr} | Ban #${record.banCount}`);
    
    return { banned: true, reason, expiresAt };
  }
  
  // 🔍 VERIFICAR SE IP ESTÁ BANIDO (com fallback para persistentBlacklist)
  isIPBanned(ip: string): { banned: boolean; expiresAt?: number; reason?: string } {
    // 1️⃣ Verificar cache local primeiro (rápido)
    const banExpiry = this.bannedIPs.get(ip);
    
    if (banExpiry !== undefined) {
      if (banExpiry === Infinity) {
        return { banned: true, reason: 'Permanent ban' };
      }
      
      if (Date.now() < banExpiry) {
        return { banned: true, expiresAt: banExpiry };
      }
      
      // Ban expirou - remover
      this.bannedIPs.delete(ip);
    }
    
    // 2️⃣ Fallback: verificar persistentBlacklist (sync check via memoryCache)
    // Isso é necessário para bans que sobreviveram ao restart
    try {
      const entry = persistentBlacklist.getFromMemoryCache(ip);
      if (entry) {
        // Se expirou, não bloquear
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
          return { banned: false };
        }
        // Hidratar o cache local para próximas verificações
        this.bannedIPs.set(ip, entry.expiresAt || Infinity);
        return { 
          banned: true, 
          expiresAt: entry.expiresAt, 
          reason: entry.reason 
        };
      }
    } catch (e) {
      // Silenciosamente ignorar erros de fallback
    }
    
    return { banned: false };
  }
  
  // 📊 OBTER MÉTRICAS
  getMetrics() {
    return {
      ...this.metrics,
      activeIncidentRecords: this.incidentRecords.size,
      currentlyBannedIPs: this.bannedIPs.size
    };
  }
  
  // 🔢 APLICAR DECAY DE PONTOS
  private applyScoreDecay(record: IPIncidentRecord): number {
    const now = Date.now();
    const minutesSinceLastSeen = (now - record.lastSeen) / (60 * 1000);
    const decay = minutesSinceLastSeen * SECURITY_THRESHOLDS.scoreDecayRate;
    return Math.max(0, record.totalScore - decay);
  }
  
  // 🧹 SANITIZAR EVIDÊNCIA (REMOVER DADOS SENSÍVEIS)
  private sanitizeEvidence(evidence: string): string {
    return evidence
      .replace(/password[=:]["']?[^"'&\s]+/gi, 'password=***')
      .replace(/token[=:]["']?[^"'&\s]+/gi, 'token=***')
      .replace(/key[=:]["']?[^"'&\s]+/gi, 'key=***')
      .replace(/secret[=:]["']?[^"'&\s]+/gi, 'secret=***')
      .substring(0, 500);
  }
  
  // 🧹 LIMPEZA DE REGISTROS ANTIGOS
  private cleanup() {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hora
    
    // Limpar registros de incidentes antigos
    for (const [ip, record] of this.incidentRecords.entries()) {
      if (now - record.lastSeen > maxAge && !this.bannedIPs.has(ip)) {
        this.incidentRecords.delete(ip);
      }
    }
    
    // Limpar bans expirados
    for (const [ip, expiry] of this.bannedIPs.entries()) {
      if (expiry !== Infinity && now > expiry) {
        this.bannedIPs.delete(ip);
        console.log(`🔓 Ban expired for IP: ${ip}`);
      }
    }
  }
  
  // 📋 OBTER HISTÓRICO DE INCIDENTES DE UM IP
  getIPHistory(ip: string): IPIncidentRecord | null {
    return this.incidentRecords.get(ip) || null;
  }
  
  // 🔓 DESBANIR IP MANUALMENTE (ADMIN)
  unbanIP(ip: string): boolean {
    if (this.bannedIPs.has(ip)) {
      this.bannedIPs.delete(ip);
      persistentBlacklist.removeFromBlacklist(ip);
      console.log(`🔓 IP manually unbanned: ${ip}`);
      return true;
    }
    return false;
  }
}

// 🎯 SINGLETON EXPORTADO
export const securityResponseService = new SecurityResponseService();

// 🛡️ HELPER FUNCTIONS
export function recordSQLInjection(ip: string, payload: string, endpoint: string, ua?: string) {
  return securityResponseService.recordIncident(ip, 'sql_injection', payload, endpoint, ua);
}

export function recordXSSAttempt(ip: string, payload: string, endpoint: string, ua?: string) {
  return securityResponseService.recordIncident(ip, 'xss_attempt', payload, endpoint, ua);
}

export function recordCommandInjection(ip: string, payload: string, endpoint: string, ua?: string) {
  return securityResponseService.recordIncident(ip, 'command_injection', payload, endpoint, ua);
}

export function recordPentestTool(ip: string, toolSignature: string, endpoint: string, ua?: string) {
  return securityResponseService.recordIncident(ip, 'pentest_tool', toolSignature, endpoint, ua);
}

export function recordPythonScanner(ip: string, signature: string, endpoint: string, ua?: string) {
  return securityResponseService.recordIncident(ip, 'python_scanner', signature, endpoint, ua);
}

export function recordMaliciousBot(ip: string, signature: string, endpoint: string, ua?: string) {
  return securityResponseService.recordIncident(ip, 'malicious_bot', signature, endpoint, ua);
}

export function recordBruteForce(ip: string, target: string, endpoint: string, ua?: string) {
  return securityResponseService.recordIncident(ip, 'brute_force', target, endpoint, ua);
}
