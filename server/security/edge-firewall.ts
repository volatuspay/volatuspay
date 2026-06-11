// 🌐 EDGE FIREWALL - CAMADA 2
// Proteção de borda: IP Reputation, Geofencing, ASN Blocking, TOR/VPN Detection
// Defense in Depth: Segunda linha antes da aplicação

import { Request, Response, NextFunction } from 'express';

// 🌍 GEOFENCING - Países bloqueados (exemplo: ajustar conforme necessidade)
const BLOCKED_COUNTRIES = new Set([
  // Adicionar códigos ISO de países para bloquear
  // 'KP', 'IR', 'SY', // Exemplo: Coreia do Norte, Irã, Síria
]);

// 🏢 ASN BLOQUEADOS (Autonomous System Numbers) - Provedores maliciosos conhecidos
const BLOCKED_ASNS = new Set([
  // ASNs de hosters conhecidos por hospedar ataques
  // 'AS12345', 'AS67890', // Exemplo
]);

// 🕵️ TOR EXIT NODES (atualizar periodicamente)
const TOR_EXIT_NODES = new Set([
  // IPs de exit nodes do TOR (atualizar com lista real)
  // Lista completa: https://check.torproject.org/exit-addresses
]);

// 🛡️ VPN/PROXY KNOWN RANGES (exemplos)
const VPN_PROXY_RANGES = [
  /^10\./,           // RFC 1918
  /^192\.168\./,     // RFC 1918
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // RFC 1918
  /^127\./,          // Loopback
  /^169\.254\./,     // Link-local
  // Adicionar ranges conhecidos de VPNs comerciais
];

// 📊 IP REPUTATION SCORES
interface IPReputation {
  score: number; // 0-100 (0 = malicioso, 100 = confiável)
  category: 'clean' | 'suspicious' | 'malicious' | 'unknown';
  reason?: string;
  asn?: string;
  country?: string;
}

// 🔍 GEO IP DATABASE (Simplificado - em produção usar MaxMind GeoIP2)
interface GeoIPData {
  ip: string;
  country?: string;
  city?: string;
  asn?: string;
  isp?: string;
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
}

class EdgeFirewallEngine {
  private enabled = true;
  private blockMode = false; // ✅ DETECTION-ONLY: false = só loga, true = bloqueia
  private geoBlockingEnabled = false;
  private asnBlockingEnabled = true;
  private torBlockingEnabled = true;
  private vpnBlockingEnabled = false;
  private ipReputationEnabled = true;

  // Cache de reputação (evitar lookups repetidos)
  private reputationCache = new Map<string, IPReputation>();
  private geoCache = new Map<string, GeoIPData>();

  // Lookup GeoIP (simplificado - integrar com MaxMind ou similar)
  private async getGeoIP(ip: string): Promise<GeoIPData> {
    // Verificar cache
    if (this.geoCache.has(ip)) {
      return this.geoCache.get(ip)!;
    }

    // Em produção: integrar com MaxMind GeoIP2 ou similar
    const geoData: GeoIPData = {
      ip,
      vpn: this.isVPN(ip),
      proxy: this.isProxy(ip),
      tor: TOR_EXIT_NODES.has(ip),
    };

    // Cache por 1 hora
    this.geoCache.set(ip, geoData);
    setTimeout(() => this.geoCache.delete(ip), 3600000);

    return geoData;
  }

  // Verificar se é VPN
  private isVPN(ip: string): boolean {
    // Verificar ranges conhecidos
    for (const range of VPN_PROXY_RANGES) {
      if (range.test(ip)) return true;
    }

    // TODO: Integrar com serviço de detecção de VPN (IPHub, IPQualityScore, etc)
    return false;
  }

  // Verificar se é Proxy
  private isProxy(ip: string): boolean {
    // TODO: Integrar com blacklist de proxies conhecidos
    return false;
  }

  // Calcular IP Reputation Score
  private async calculateReputation(ip: string): Promise<IPReputation> {
    // Verificar cache
    if (this.reputationCache.has(ip)) {
      return this.reputationCache.get(ip)!;
    }

    const geoData = await this.getGeoIP(ip);
    let score = 100; // Começar com score máximo
    let category: IPReputation['category'] = 'clean';
    const reasons: string[] = [];

    // Penalidades
    if (geoData.tor) {
      score -= 80;
      reasons.push('TOR_EXIT_NODE');
      category = 'malicious';
    }

    if (geoData.vpn && this.vpnBlockingEnabled) {
      score -= 30;
      reasons.push('VPN_DETECTED');
      category = category === 'clean' ? 'suspicious' : category;
    }

    if (geoData.proxy) {
      score -= 40;
      reasons.push('PROXY_DETECTED');
      category = category === 'clean' ? 'suspicious' : category;
    }

    if (geoData.country && BLOCKED_COUNTRIES.has(geoData.country)) {
      score -= 50;
      reasons.push('BLOCKED_COUNTRY');
      category = 'malicious';
    }

    if (geoData.asn && BLOCKED_ASNS.has(geoData.asn)) {
      score -= 60;
      reasons.push('BLOCKED_ASN');
      category = 'malicious';
    }

    // TODO: Integrar com threat intelligence feeds (AbuseIPDB, etc)

    const reputation: IPReputation = {
      score: Math.max(0, score),
      category,
      reason: reasons.length > 0 ? reasons.join(', ') : undefined,
      asn: geoData.asn,
      country: geoData.country,
    };

    // Cache por 30 minutos
    this.reputationCache.set(ip, reputation);
    setTimeout(() => this.reputationCache.delete(ip), 1800000);

    return reputation;
  }

  // 🟢 WHITELIST DE IPs INTERNOS/CONFIÁVEIS
  private isWhitelisted(ip: string): boolean {
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

  // Verificar se deve bloquear
  async shouldBlock(ip: string): Promise<{ block: boolean; reason?: string; reputation: IPReputation }> {
    if (!this.enabled) {
      return { block: false, reputation: { score: 100, category: 'clean' } };
    }

    // 🟢 BYPASS PARA IPS INTERNOS/CONFIÁVEIS
    if (this.isWhitelisted(ip)) {
      return { block: false, reputation: { score: 100, category: 'clean' } };
    }

    const reputation = await this.calculateReputation(ip);

    // Bloquear se score < 30 ou categoria maliciosa
    if (reputation.score < 30 || reputation.category === 'malicious') {
      return {
        block: true,
        reason: reputation.reason || 'Low reputation score',
        reputation,
      };
    }

    return { block: false, reputation };
  }

  // Controles
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  setBlockMode(blockMode: boolean) { this.blockMode = blockMode; } // ✅ CONTROLAR BLOQUEIO
  setGeoBlocking(enabled: boolean) { this.geoBlockingEnabled = enabled; }
  setASNBlocking(enabled: boolean) { this.asnBlockingEnabled = enabled; }
  setTorBlocking(enabled: boolean) { this.torBlockingEnabled = enabled; }
  setVPNBlocking(enabled: boolean) { this.vpnBlockingEnabled = enabled; }
  setIPReputation(enabled: boolean) { this.ipReputationEnabled = enabled; }

  // Limpar caches
  clearCaches() {
    this.reputationCache.clear();
    this.geoCache.clear();
  }
}

// 🌍 INSTÂNCIA GLOBAL
const edgeFirewall = new EdgeFirewallEngine();

// 🛡️ MIDDLEWARE EDGE FIREWALL
export async function edgeFirewallProtection(req: Request, res: Response, next: NextFunction) {
  const clientIP = req.ip || req.socket.remoteAddress || 'unknown';

  try {
    const { block, reason, reputation } = await edgeFirewall.shouldBlock(clientIP);

    if (block) {
      // 🚫 VERIFICAR BLOCK MODE
      if (edgeFirewall['blockMode']) {
        // BLOCKING MODE: Bloqueia de verdade
        console.error(`🌐 EDGE FIREWALL BLOCKED: ${clientIP} - Reason: ${reason} - Score: ${reputation.score}`);

        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied by Edge Firewall',
          code: 'EDGE_FIREWALL_BLOCKED',
        });
      } else {
        // DETECTION-ONLY MODE: Só loga, não bloqueia
        console.warn(`📋 EDGE FIREWALL THREAT DETECTED (detection-only): ${clientIP} - Reason: ${reason} - Score: ${reputation.score} - Permitido para admin revisar`);
      }
    }

    // Log se suspeito (mas não bloqueia)
    if (reputation.category === 'suspicious') {
      console.warn(`⚠️ EDGE FIREWALL SUSPICIOUS: ${clientIP} - Reason: ${reason} - Score: ${reputation.score}`);
    }

    next();
  } catch (error: any) {
    console.error(`❌ Edge Firewall Error:`, error.message);
    // Fail open (não bloquear em caso de erro)
    next();
  }
}

// 🎛️ EXPORT CONTROLS
export const edgeFW = {
  middleware: edgeFirewallProtection,
  setEnabled: (enabled: boolean) => edgeFirewall.setEnabled(enabled),
  setBlockMode: (blockMode: boolean) => edgeFirewall.setBlockMode(blockMode), // ✅ CONTROLAR BLOQUEIO
  setGeoBlocking: (enabled: boolean) => edgeFirewall.setGeoBlocking(enabled),
  setASNBlocking: (enabled: boolean) => edgeFirewall.setASNBlocking(enabled),
  setTorBlocking: (enabled: boolean) => edgeFirewall.setTorBlocking(enabled),
  setVPNBlocking: (enabled: boolean) => edgeFirewall.setVPNBlocking(enabled),
  setIPReputation: (enabled: boolean) => edgeFirewall.setIPReputation(enabled),
  clearCaches: () => edgeFirewall.clearCaches(),
};
