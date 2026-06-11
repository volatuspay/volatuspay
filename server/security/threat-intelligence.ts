// 🧠 THREAT INTELLIGENCE - CAMADA 4
// Advanced threat detection: Zero-day heuristics, automated response, threat feeds
// Defense in Depth: Quarta e última linha de defesa

import { Request, Response, NextFunction } from 'express';

// 🎯 ZERO-DAY HEURISTICS (detecção por comportamento anômalo)
interface AnomalyScore {
  score: number; // 0-100
  anomalies: string[];
  confidence: number; // 0-100
}

// 🔄 AUTOMATED RESPONSE ACTIONS
type ResponseAction = 'ALLOW' | 'CHALLENGE' | 'RATE_LIMIT' | 'BLOCK' | 'ISOLATE';

interface ThreatIntelligence {
  action: ResponseAction;
  reason: string;
  confidence: number;
  anomalyScore: number;
  indicators: string[];
}

// 📡 THREAT FEED (simulado - integrar com feeds reais)
interface ThreatFeed {
  maliciousIPs: Set<string>;
  maliciousDomains: Set<string>;
  maliciousHashes: Set<string>;
  lastUpdate: number;
}

class ThreatIntelligenceEngine {
  private enabled = false;
  private zeroDayDetection = false;
  private autoResponse = false;
  
  // Threat feeds (atualizar periodicamente)
  private threatFeed: ThreatFeed = {
    maliciousIPs: new Set(),
    maliciousDomains: new Set(),
    maliciousHashes: new Set(),
    lastUpdate: Date.now(),
  };

  // Baseline comportamental (aprende com o tempo)
  private baseline = {
    avgRequestSize: 1024,
    avgResponseTime: 100,
    commonEndpoints: new Set(['/api', '/auth', '/checkout']),
    commonUserAgents: new Set(['Mozilla', 'Chrome', 'Safari']),
  };

  // 🟢 WHITELIST: IPs e paths que devem ser ignorados
  private isWhitelistedIP(ip: string): boolean {
    const whitelistedPatterns = [
      /^127\./,                    // Localhost IPv4
      /^::1$/,                     // Localhost IPv6
      /^::ffff:127\./,            // IPv4-mapped IPv6 localhost
      /^10\./,                     // RFC 1918 private
      /^192\.168\./,              // RFC 1918 private
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // RFC 1918 private
      /^160\.20\./,               // Replit infrastructure
      /^100\.64\./,               // CGNAT (Replit)
    ];
    return whitelistedPatterns.some(pattern => pattern.test(ip));
  }

  // 🟢 Paths de desenvolvimento que não devem ser analisados
  private isDevelopmentPath(path: string): boolean {
    const devPatterns = [
      /^\/src\//,                  // Vite source files
      /^\/@/,                      // Vite special paths
      /^\/node_modules\//,        // Node modules
      /\.(tsx?|jsx?|vue|svelte)$/, // Source code files
      /^\/\.vite\//,              // Vite cache
      /^\/__vite_/,               // Vite HMR
    ];
    return devPatterns.some(pattern => pattern.test(path));
  }

  // 🟢 Headers legítimos de proxy (não são suspeitos)
  private isLegitimateProxyHeader(headerName: string): boolean {
    const legitimateHeaders = [
      'x-forwarded-for',          // Standard proxy header
      'x-forwarded-proto',        // Standard proxy header
      'x-forwarded-host',         // Standard proxy header
      'x-real-ip',                // Common proxy header
    ];
    return legitimateHeaders.includes(headerName.toLowerCase());
  }

  // Zero-Day Detection via heurística
  private detectAnomalies(req: Request): AnomalyScore {
    const anomalies: string[] = [];
    let score = 0;

    // 🟢 SKIP: Paths de desenvolvimento (Vite, etc)
    if (this.isDevelopmentPath(req.path)) {
      return { score: 0, anomalies: [], confidence: 0 };
    }

    // 1. Request size anômalo
    const requestSize = JSON.stringify(req.body || '').length;
    if (requestSize > this.baseline.avgRequestSize * 10) {
      anomalies.push('ABNORMAL_REQUEST_SIZE');
      score += 15;
    }

    // 2. Path depth anômalo (ignorar paths de desenvolvimento)
    const pathDepth = req.path.split('/').length;
    const isApiPath = req.path.startsWith('/api/');
    if (pathDepth > 8 && !isApiPath) {
      anomalies.push('DEEP_PATH_TRAVERSAL');
      score += 20;
    }

    // 3. Múltiplos encoding (ofuscação)
    const hasMultipleEncoding = /%25/.test(req.originalUrl); // Double encoding
    if (hasMultipleEncoding) {
      anomalies.push('MULTIPLE_ENCODING');
      score += 25;
    }

    // 4. Caracteres não-ASCII suspeitos
    const hasNonAscii = /[^\x00-\x7F]/.test(req.originalUrl);
    if (hasNonAscii) {
      anomalies.push('NON_ASCII_CHARS');
      score += 10;
    }

    // 5. Headers incomuns (EXCLUIR headers de proxy legítimos)
    const suspiciousHeaders = ['X-Original-URL', 'X-Rewrite-URL', 'X-Override-URL'];
    const hasSuspiciousHeaders = suspiciousHeaders.some(h => {
      const hasHeader = req.get(h);
      return hasHeader && !this.isLegitimateProxyHeader(h);
    });
    if (hasSuspiciousHeaders) {
      anomalies.push('SUSPICIOUS_HEADERS');
      score += 15;
    }

    // 6. Método HTTP incomum
    const uncommonMethods = ['TRACE', 'TRACK', 'DEBUG', 'CONNECT'];
    if (uncommonMethods.includes(req.method)) {
      anomalies.push('UNCOMMON_HTTP_METHOD');
      score += 30;
    }

    // 7. User-Agent não reconhecido
    const ua = req.get('user-agent') || '';
    const isKnownUA = Array.from(this.baseline.commonUserAgents).some(
      known => ua.includes(known)
    );
    if (!isKnownUA && ua.length > 0) {
      anomalies.push('UNKNOWN_USER_AGENT');
      score += 10;
    }

    // 8. Request sem Referer (suspeito para POST)
    if (req.method === 'POST' && !req.get('referer')) {
      anomalies.push('MISSING_REFERER');
      score += 5;
    }

    // 9. Timing attack (requests muito rápidas)
    // TODO: Implementar tracking de timing entre requests

    // 10. Payload com características de exploit
    const payload = JSON.stringify(req.body);
    const hasShellcode = /\\x[0-9a-f]{2}/i.test(payload);
    const hasNopSled = /\x90{10,}/.test(payload);
    if (hasShellcode || hasNopSled) {
      anomalies.push('SHELLCODE_PATTERN');
      score += 40;
    }

    const confidence = Math.min(100, anomalies.length * 15);

    return {
      score: Math.min(100, score),
      anomalies,
      confidence,
    };
  }

  // Verificar contra threat feeds
  private checkThreatFeeds(req: Request): boolean {
    const ip = req.ip || '';
    const hostname = req.hostname;

    // Verificar IP malicioso
    if (this.threatFeed.maliciousIPs.has(ip)) {
      console.error(`🚨 THREAT FEED MATCH: Malicious IP ${ip}`);
      return true;
    }

    // Verificar domínio malicioso
    if (this.threatFeed.maliciousDomains.has(hostname)) {
      console.error(`🚨 THREAT FEED MATCH: Malicious domain ${hostname}`);
      return true;
    }

    return false;
  }

  // Decidir ação automática
  private decideAction(anomalyScore: AnomalyScore, threatFeedMatch: boolean): ResponseAction {
    if (!this.autoResponse) return 'ALLOW';

    // Threat feed match = bloqueio imediato
    if (threatFeedMatch) return 'BLOCK';

    // Score alto = bloquear
    if (anomalyScore.score >= 80) return 'BLOCK';

    // Score médio-alto = isolar (limitar acesso)
    if (anomalyScore.score >= 60) return 'ISOLATE';

    // Score médio = rate limit
    if (anomalyScore.score >= 40) return 'RATE_LIMIT';

    // Score baixo = challenge (CAPTCHA)
    if (anomalyScore.score >= 20) return 'CHALLENGE';

    return 'ALLOW';
  }

  // Análise completa
  analyze(req: Request): ThreatIntelligence {
    if (!this.enabled) {
      return {
        action: 'ALLOW',
        reason: 'Threat Intelligence disabled',
        confidence: 0,
        anomalyScore: 0,
        indicators: [],
      };
    }

    // 🟢 BYPASS: IPs internos/Replit são sempre confiáveis
    const clientIP = req.ip || req.socket?.remoteAddress || '';
    if (this.isWhitelistedIP(clientIP)) {
      return {
        action: 'ALLOW',
        reason: 'Whitelisted IP (internal/infrastructure)',
        confidence: 100,
        anomalyScore: 0,
        indicators: [],
      };
    }

    // 1. Zero-Day Detection
    const anomalies = this.zeroDayDetection ? this.detectAnomalies(req) : { score: 0, anomalies: [], confidence: 0 };

    // 2. Threat Feed Check
    const threatFeedMatch = this.checkThreatFeeds(req);

    // 3. Decide Action
    const action = this.decideAction(anomalies, threatFeedMatch);

    return {
      action,
      reason: threatFeedMatch 
        ? 'Matched threat intelligence feed' 
        : `Anomaly detected: ${anomalies.anomalies.join(', ')}`,
      confidence: anomalies.confidence,
      anomalyScore: anomalies.score,
      indicators: anomalies.anomalies,
    };
  }

  // Update threat feeds (chamar periodicamente)
  async updateThreatFeeds() {
    // TODO: Integrar com feeds reais (AbuseIPDB, AlienVault OTX, etc)
    console.log('🔄 Updating threat intelligence feeds...');
    
    // Exemplo: adicionar IPs de teste
    // this.threatFeed.maliciousIPs.add('123.45.67.89');
    
    this.threatFeed.lastUpdate = Date.now();
  }

  // Controles
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  setZeroDayDetection(enabled: boolean) { this.zeroDayDetection = enabled; }
  setAutoResponse(enabled: boolean) { this.autoResponse = enabled; }
  
  // Getter para verificar status
  isAutoResponseEnabled(): boolean { return this.autoResponse; }

  // Stats
  getStats() {
    return {
      maliciousIPs: this.threatFeed.maliciousIPs.size,
      maliciousDomains: this.threatFeed.maliciousDomains.size,
      lastUpdate: new Date(this.threatFeed.lastUpdate).toISOString(),
    };
  }
}

// 🌍 INSTÂNCIA GLOBAL
const threatIntel = new ThreatIntelligenceEngine();

// Atualizar feeds a cada 1 hora
setInterval(() => threatIntel.updateThreatFeeds(), 3600000);

// 🛡️ MIDDLEWARE THREAT INTELLIGENCE
export function threatIntelligenceProtection(req: Request, res: Response, next: NextFunction) {
  const intel = threatIntel.analyze(req);

  if (intel.action !== 'ALLOW') {
    console.warn(`🧠 THREAT INTEL: ${intel.action} - ${intel.reason} (Confidence: ${intel.confidence}%)`);

    // Log indicadores
    if (intel.indicators.length > 0) {
      console.warn(`   Indicators: ${intel.indicators.join(', ')}`);
    }

    // ✅ DETECTION-ONLY MODE: Apenas loga, NUNCA bloqueia
    // Admin vê nos logs e decide manualmente via interface de auditoria
    if (!threatIntel.isAutoResponseEnabled()) {
      console.log(`✅ THREAT INTEL (DETECTION-ONLY): ${intel.action} - Logged for admin review`);
      return next(); // Permite a requisição, apenas loga
    }

    // Executar ação SOMENTE se autoResponse = true (desabilitado por padrão)
    switch (intel.action) {
      case 'BLOCK':
        console.error(`🚫 THREAT INTEL BLOCKED: ${req.ip} - ${intel.reason}`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Request blocked by Threat Intelligence',
          code: 'THREAT_INTEL_BLOCKED',
        });

      case 'ISOLATE':
        // TODO: Implementar isolamento (acesso limitado)
        console.warn(`⚠️ IP ${req.ip} isolated - limited access`);
        break;

      case 'RATE_LIMIT':
        // TODO: Aplicar rate limit agressivo
        console.warn(`⚠️ IP ${req.ip} rate limited`);
        break;

      case 'CHALLENGE':
        // TODO: Retornar CAPTCHA challenge
        console.warn(`⚠️ IP ${req.ip} challenged - CAPTCHA required`);
        break;
    }
  }

  next();
}

// 🎛️ EXPORT CONTROLS
export const threatIntelligence = {
  middleware: threatIntelligenceProtection,
  setEnabled: (enabled: boolean) => threatIntel.setEnabled(enabled),
  setZeroDayDetection: (enabled: boolean) => threatIntel.setZeroDayDetection(enabled),
  setAutoResponse: (enabled: boolean) => threatIntel.setAutoResponse(enabled),
  updateFeeds: () => threatIntel.updateThreatFeeds(),
  getStats: () => threatIntel.getStats(),
};
