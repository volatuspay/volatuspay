/**
 * 🚪 BLACKLIST GATE - ENFORCEMENT LAYER
 * Camada centralizada de enforcement da blacklist
 * - Verifica IP contra blacklist ANTES de qualquer processamento
 * - Trust proxy configuration para CDN/proxies
 * - Enforce thresholds: CRITICAL = immediate, HIGH ≥2 = deny
 * - Logs estruturados de decisões
 */

import { Request, Response, NextFunction } from 'express';
import { isIPBlacklisted, getBlacklistEntry } from './persistent-ip-blacklist';

export class BlacklistGate {
  private static instance: BlacklistGate;
  
  public static getInstance(): BlacklistGate {
    if (!BlacklistGate.instance) {
      BlacklistGate.instance = new BlacklistGate();
    }
    return BlacklistGate.instance;
  }

  /**
   * 🔍 EXTRAIR IP REAL (SEGURO - usa apenas req.ip)
   * Express já processa X-Forwarded-For quando trust proxy está configurado
   * NÃO aceitar X-Forwarded-For diretamente para prevenir spoofing
   */
  private extractRealIP(req: Request): string {
    // USAR APENAS req.ip - Express já validou X-Forwarded-For baseado em trust proxy
    let ip = req.ip || '127.0.0.1';
    
    // Remover prefixo ::ffff: de IPs IPv4-mapped-IPv6
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    
    return ip;
  }

  /**
   * 🔐 GERAR FINGERPRINT ÚNICO DO DISPOSITIVO
   * Combina IP + User-Agent + Headers para identificar dispositivo único
   * Previne bloqueio de rede inteira ao banir apenas 1 invasor
   */
  private generateDeviceFingerprint(req: Request): string {
    const ip = this.extractRealIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const acceptLanguage = req.headers['accept-language'] || 'unknown';
    const acceptEncoding = req.headers['accept-encoding'] || 'unknown';
    
    // Criar fingerprint único: IP + headers principais
    const fingerprintData = `${ip}|${userAgent}|${acceptLanguage}|${acceptEncoding}`;
    
    // Usar hash simples (não precisa ser criptográfico, apenas único)
    let hash = 0;
    for (let i = 0; i < fingerprintData.length; i++) {
      const char = fingerprintData.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return `fp_${Math.abs(hash).toString(36)}_${ip.replace(/\./g, '-')}`;
  }

  /**
   * 🚪 GATE ENFORCEMENT MIDDLEWARE
   * Primeiro middleware da cadeia - rejeita dispositivos blacklisted
   * ✨ NOVO: Verifica FINGERPRINT (IP+UA+Headers) ao invés de apenas IP
   * Previne bloqueio de rede inteira ao banir apenas invasor específico
   */
  public enforce() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // 🆘 BLACKLIST GATE DESABILITADO TEMPORARIAMENTE - LIBERAR TODOS
        return next();
        
        /* CÓDIGO ORIGINAL COMENTADO
        const realIP = this.extractRealIP(req);
        const deviceFingerprint = this.generateDeviceFingerprint(req);
        
        // 🔐 ADICIONAR FINGERPRINT AO REQUEST para outros middlewares usarem
        (req as any).deviceFingerprint = deviceFingerprint;
        (req as any).realIP = realIP;
        
        // ✅ WHITELIST: NUNCA BLOQUEAR IPs INTERNOS (127.0.0.1, localhost, etc.)
        const { isInternalIP, isTrustedEdgeIP } = await import('./persistent-ip-blacklist');
        if (isInternalIP(realIP)) {
          return next(); // Bypass completo para IPs internos
        }
        
        // ✅ WHITELIST: NUNCA BLOQUEAR IPs DE CDN/EDGE (Cloudflare, Replit, etc.)
        if (isTrustedEdgeIP(realIP)) {
          return next(); // Bypass completo para IPs de CDN
        }
        
        // 🎯 VERIFICAÇÃO DUPLA: Fingerprint (prioridade) OU IP (fallback)
        // Permite bloquear invasor específico sem afetar outros na mesma rede
        const isDeviceBlacklisted = await isIPBlacklisted(deviceFingerprint);
        const isIPBlacklisted_Legacy = await isIPBlacklisted(realIP);
        
        if (isDeviceBlacklisted || isIPBlacklisted_Legacy) {
          const entry = await getBlacklistEntry(isDeviceBlacklisted ? deviceFingerprint : realIP);
          
          // Log estruturado da decisão
          console.error('🚫 BLACKLIST GATE: DISPOSITIVO BLOQUEADO', {
            fingerprint: deviceFingerprint,
            ip: realIP,
            path: req.path,
            method: req.method,
            reason: entry?.reason || 'Unknown',
            severity: entry?.severity || 'unknown',
            attempts: entry?.attempts || 0,
            userAgent: req.headers['user-agent'],
            blockedBy: isDeviceBlacklisted ? 'FINGERPRINT' : 'IP_LEGACY'
          });
          
          // Resposta genérica para não revelar blacklist
          return res.status(403).json({
            success: false,
            error: 'Acesso negado'
          });
        }
        
        next();
        */
      } catch (error) {
        console.error('❌ BlacklistGate error:', error);
        // Fail-open em caso de erro (não bloquear tráfego legítimo)
        next();
      }
    };
  }

  /**
   * 🔐 ENFORCE THRESHOLD GATE
   * Segunda camada: verifica tentativas e severity antes de permitir
   * Permite requests, mas marca para quarentena/ban se atingir threshold
   * ✨ NOVO: Verifica FINGERPRINT (IP+UA+Headers) ao invés de apenas IP
   */
  public enforceThreshold() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Desabilitado — bloqueios automáticos por IP via Firebase removidos
      return next();
    };
  }
}

export const blacklistGate = BlacklistGate.getInstance();
