// 🔍 IDS/IPS - INTRUSION DETECTION & PREVENTION SYSTEM
// Camada 3: Análise comportamental, honeypots, correlation engine
// Defense in Depth: Terceira linha de defesa

import { Request, Response, NextFunction } from 'express';

// 🍯 HONEYPOT ENDPOINTS (endpoints falsos para detectar reconhecimento)
const HONEYPOT_ENDPOINTS = new Set([
  '/admin.php',
  '/wp-admin',
  '/phpmyadmin',
  '/.env',
  '/.git/config',
  '/backup.sql',
  '/config.php',
  '/database.yml',
  '/.aws/credentials',
  '/server-status',
  '/.DS_Store',
  '/crossdomain.xml',
  '/elmah.axd',
  '/trace.axd',
  '/.well-known/security.txt',
]);

// ✅ WHITELIST - ROTAS LEGÍTIMAS (não detectar como ataques)
const LEGITIMATE_PATHS = new Set([
  '/api/admin',
  '/api/admin/sellers',
  '/api/admin/users',
  '/api/admin/payments',
  '/api/admin/settings',
  '/api/admin/dashboard',
]);

// Função para verificar se caminho é legítimo
function isLegitimateAdminPath(path: string): boolean {
  // Rotas API do admin
  if (path.startsWith('/api/admin')) return true;
  
  // Arquivos estáticos do admin (Vite)
  if (path.startsWith('/src/pages/admin/') || path.startsWith('/src/components/admin/')) return true;
  
  return false;
}

// 🚨 ATTACK PATTERNS (padrões de ataque conhecidos)
const ATTACK_PATTERNS = {
  // Reconhecimento
  RECONNAISSANCE: [
    /\.git\//,
    /\.svn\//,
    /\.env/,
    /phpinfo/i,
    /server-status/i,
    /\.bak$/,
    /\.old$/,
    /\.backup$/,
    /robots\.txt/,
    /sitemap\.xml/,
  ],

  // Directory Scanning (otimizado para reduzir falsos positivos)
  DIRECTORY_SCAN: [
    /\/wp-admin\//i,
    /\/phpmyadmin/i,
    /\/cpanel/i,
    /\/webmail/i,
    /\/backup\//i,
    /\/cgi-bin\//i,
  ],

  // Automated Tools
  AUTOMATED_TOOLS: [
    /nikto/i,
    /nmap/i,
    /masscan/i,
    /metasploit/i,
    /sqlmap/i,
    /havij/i,
    /acunetix/i,
    /nessus/i,
    /burp/i,
    /zap/i,
    /dirbuster/i,
    /wfuzz/i,
  ],

  // Suspicious User-Agents
  SUSPICIOUS_UA: [
    /python-requests/i,
    /curl\//i,
    /wget/i,
    /libwww/i,
    /scrapy/i,
    /go-http-client/i,
  ],
};

// 📊 TRAFFIC PATTERN ANALYSIS
interface TrafficPattern {
  ip: string;
  requestCount: number;
  endpoints: Set<string>;
  methods: Set<string>;
  userAgents: Set<string>;
  honeypotHits: number;
  suspiciousRequests: number;
  firstSeen: number;
  lastSeen: number;
}

// 🔗 CORRELATION ENGINE
interface AttackCorrelation {
  ips: Set<string>;
  pattern: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  startTime: number;
  detectedAt: number;
  attackType: string;
}

class IDSIPSEngine {
  private enabled = true;
  private honeypotEnabled = true;
  private correlationEnabled = true;
  
  // Traffic tracking (últimos 10 minutos)
  private trafficPatterns = new Map<string, TrafficPattern>();
  
  // Correlações detectadas
  private correlations: AttackCorrelation[] = [];
  
  // Cleanup automático (evitar memory leak)
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Limpar dados antigos a cada 5 minutos
    this.cleanupInterval = setInterval(() => this.cleanup(), 300000);
  }

  // Cleanup de dados antigos
  private cleanup() {
    const now = Date.now();
    const threshold = 10 * 60 * 1000; // 10 minutos

    for (const [ip, pattern] of this.trafficPatterns.entries()) {
      if (now - pattern.lastSeen > threshold) {
        this.trafficPatterns.delete(ip);
      }
    }

    // Limpar correlações antigas (>1 hora)
    this.correlations = this.correlations.filter(
      corr => now - corr.detectedAt < 3600000
    );
  }

  // Verificar se é honeypot
  private isHoneypot(path: string): boolean {
    return HONEYPOT_ENDPOINTS.has(path);
  }

  // Detectar padrões de ataque
  private detectAttackPattern(req: Request): string | null {
    const path = req.path;
    const ua = req.get('user-agent') || '';

    // ✅ Whitelist: ignorar rotas legítimas
    if (LEGITIMATE_PATHS.has(path) || isLegitimateAdminPath(path)) {
      return null;
    }

    // Verificar cada categoria
    for (const [category, patterns] of Object.entries(ATTACK_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(path) || pattern.test(ua)) {
          return category;
        }
      }
    }

    return null;
  }

  // Atualizar padrão de tráfego
  private updateTrafficPattern(req: Request): TrafficPattern {
    const ip = req.ip || 'unknown';
    const now = Date.now();

    let pattern = this.trafficPatterns.get(ip);
    
    if (!pattern) {
      pattern = {
        ip,
        requestCount: 0,
        endpoints: new Set(),
        methods: new Set(),
        userAgents: new Set(),
        honeypotHits: 0,
        suspiciousRequests: 0,
        firstSeen: now,
        lastSeen: now,
      };
      this.trafficPatterns.set(ip, pattern);
    }

    pattern.requestCount++;
    pattern.endpoints.add(req.path);
    pattern.methods.add(req.method);
    if (req.get('user-agent')) {
      pattern.userAgents.add(req.get('user-agent')!);
    }
    pattern.lastSeen = now;

    return pattern;
  }

  // Correlation Engine: Detectar ataques distribuídos
  private correlateAttacks(): AttackCorrelation | null {
    if (!this.correlationEnabled) return null;

    const now = Date.now();
    const suspiciousIPs = new Set<string>();

    // Encontrar IPs com comportamento suspeito
    for (const [ip, pattern] of this.trafficPatterns.entries()) {
      const duration = (pattern.lastSeen - pattern.firstSeen) / 1000; // segundos
      const requestRate = pattern.requestCount / duration;

      // Critérios de suspeita
      const isSuspicious = (
        pattern.honeypotHits > 0 ||
        pattern.suspiciousRequests > 3 ||
        requestRate > 10 ||
        pattern.endpoints.size > 20 ||
        pattern.userAgents.size > 3
      );

      if (isSuspicious) {
        suspiciousIPs.add(ip);
      }
    }

    // Se múltiplos IPs suspeitos, pode ser ataque distribuído
    if (suspiciousIPs.size >= 3) {
      const correlation: AttackCorrelation = {
        ips: suspiciousIPs,
        pattern: 'DISTRIBUTED_ATTACK',
        severity: 'CRITICAL',
        startTime: Math.min(...Array.from(suspiciousIPs).map(
          ip => this.trafficPatterns.get(ip)!.firstSeen
        )),
        detectedAt: now,
        attackType: 'DDoS or Coordinated Attack',
      };

      this.correlations.push(correlation);
      return correlation;
    }

    return null;
  }

  // Análise principal
  analyze(req: Request): { threat: boolean; reason?: string; severity?: string } {
    if (!this.enabled) return { threat: false };

    const pattern = this.updateTrafficPattern(req);

    // 1. Verificar Honeypot
    if (this.honeypotEnabled && this.isHoneypot(req.path)) {
      pattern.honeypotHits++;
      
      return {
        threat: true,
        reason: 'HONEYPOT_ACCESSED',
        severity: 'HIGH',
      };
    }

    // 2. Detectar padrões de ataque
    const attackType = this.detectAttackPattern(req);
    if (attackType) {
      pattern.suspiciousRequests++;
      
      return {
        threat: true,
        reason: attackType,
        severity: attackType === 'RECONNAISSANCE' ? 'MEDIUM' : 'HIGH',
      };
    }

    // 3. Análise comportamental
    const duration = (pattern.lastSeen - pattern.firstSeen) / 1000;
    const requestRate = pattern.requestCount / duration;

    if (requestRate > 20) {
      
      return {
        threat: true,
        reason: 'HIGH_REQUEST_RATE',
        severity: 'MEDIUM',
      };
    }

    // 4. Correlation Engine
    const correlation = this.correlateAttacks();
    if (correlation && correlation.ips.has(req.ip || 'unknown')) {
      
      return {
        threat: true,
        reason: 'CORRELATED_ATTACK',
        severity: 'CRITICAL',
      };
    }

    return { threat: false };
  }

  // Controles
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  setHoneypot(enabled: boolean) { this.honeypotEnabled = enabled; }
  setCorrelation(enabled: boolean) { this.correlationEnabled = enabled; }

  // Stats
  getStats() {
    return {
      activeIPs: this.trafficPatterns.size,
      correlations: this.correlations.length,
      honeypotHits: Array.from(this.trafficPatterns.values())
        .reduce((sum, p) => sum + p.honeypotHits, 0),
    };
  }

  // Destruir (cleanup)
  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

// 🌍 INSTÂNCIA GLOBAL
const idsEngine = new IDSIPSEngine();

// 🛡️ MIDDLEWARE IDS/IPS
export function idsipsProtection(req: Request, res: Response, next: NextFunction) {
  const analysis = idsEngine.analyze(req);

  if (analysis.threat) {
    // Silencioso - apenas analisa sem poluir logs
  }

  next();
}

// 🎛️ EXPORT CONTROLS
export const idsips = {
  middleware: idsipsProtection,
  setEnabled: (enabled: boolean) => idsEngine.setEnabled(enabled),
  setHoneypot: (enabled: boolean) => idsEngine.setHoneypot(enabled),
  setCorrelation: (enabled: boolean) => idsEngine.setCorrelation(enabled),
  getStats: () => idsEngine.getStats(),
};
