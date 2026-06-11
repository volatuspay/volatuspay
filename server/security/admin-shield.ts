// 🛡️ ADMIN SHIELD - PROTEÇÃO ULTRA-AVANÇADA PARA ROTAS ADMINISTRATIVAS
// Sistema de defesa em camadas múltiplas contra acesso não autorizado

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './firebase-auth';
import { getFirestore } from '../lib/firebase-admin';

// 📊 TELEMETRIA DE SEGURANÇA ADMIN
interface AdminSecurityTelemetry {
  totalAttempts: number;
  blockedAttempts: number;
  successfulAccess: number;
  suspiciousPatterns: number;
  lastAccess: Date | null;
  blockedIPs: Set<string>;
  activeSessions: Map<string, SessionData>;
}

interface SessionData {
  uid: string;
  ip: string;
  userAgent: string;
  deviceFingerprint: string;
  lastActivity: Date;
  requestCount: number;
  createdAt: Date;
}

class AdminShield {
  private static instance: AdminShield;
  private telemetry: AdminSecurityTelemetry;
  private rateLimitMap: Map<string, RateLimitData> = new Map();
  private sessionMap: Map<string, SessionData> = new Map();
  private suspiciousIPs: Set<string> = new Set();

  private constructor() {
    this.telemetry = {
      totalAttempts: 0,
      blockedAttempts: 0,
      successfulAccess: 0,
      suspiciousPatterns: 0,
      lastAccess: null,
      blockedIPs: new Set(),
      activeSessions: new Map()
    };

    // 🧹 LIMPEZA AUTOMÁTICA DE DADOS ANTIGOS (A CADA 5 MINUTOS)
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  public static getInstance(): AdminShield {
    if (!AdminShield.instance) {
      AdminShield.instance = new AdminShield();
    }
    return AdminShield.instance;
  }

  /**
   * 🛡️ MIDDLEWARE PRINCIPAL - PROTEÇÃO MULTICAMADA
   */
  public protect() {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        this.telemetry.totalAttempts++;

        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const uid = req.authUser?.uid;

        // 🚫 VERIFICAÇÃO 1: IP SUSPEITO/BLOQUEADO
        if (this.suspiciousIPs.has(ip) || this.telemetry.blockedIPs.has(ip)) {
          this.telemetry.blockedAttempts++;
          console.log(`🚫 ADMIN SHIELD: IP bloqueado tentou acessar admin: ${ip}`);
          await this.logSecurityEvent(uid || 'anonymous', ip, 'blocked_ip_attempt', {
            userAgent,
            path: req.path
          });
          return res.status(403).json({
            error: 'Acesso negado',
            code: 'IP_BLOCKED'
          });
        }

        // 🚫 VERIFICAÇÃO 2: RATE LIMITING AGRESSIVO
        if (!this.checkRateLimit(uid || ip)) {
          this.telemetry.blockedAttempts++;
          this.suspiciousIPs.add(ip);
          console.log(`🚫 ADMIN SHIELD: Rate limit excedido: ${uid || ip} (IP: ${ip})`);
          await this.logSecurityEvent(uid || 'anonymous', ip, 'rate_limit_exceeded', {
            userAgent,
            path: req.path
          });
          return res.status(429).json({
            error: 'Muitas requisições. Tente novamente em alguns minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }

        // 🚫 VERIFICAÇÃO 3: USER-AGENT SUSPEITO (BOT DETECTION)
        if (this.isSuspiciousUserAgent(userAgent)) {
          this.telemetry.blockedAttempts++;
          this.telemetry.suspiciousPatterns++;
          console.log(`🚫 ADMIN SHIELD: User-Agent suspeito detectado: ${userAgent}`);
          await this.logSecurityEvent(uid || 'anonymous', ip, 'suspicious_user_agent', {
            userAgent,
            path: req.path
          });
          return res.status(403).json({
            error: 'Acesso negado',
            code: 'SUSPICIOUS_CLIENT'
          });
        }

        // 🚫 VERIFICAÇÃO 4: PADRÕES DE ATAQUE AUTOMATIZADO
        if (this.detectAutomationPattern(uid || ip, req.path)) {
          this.telemetry.blockedAttempts++;
          this.telemetry.suspiciousPatterns++;
          this.suspiciousIPs.add(ip);
          console.log(`🚫 ADMIN SHIELD: Padrão de automação detectado: ${uid || ip}`);
          await this.logSecurityEvent(uid || 'anonymous', ip, 'automation_detected', {
            userAgent,
            path: req.path
          });
          return res.status(403).json({
            error: 'Acesso negado',
            code: 'AUTOMATION_DETECTED'
          });
        }

        // ✅ REGISTRAR SESSÃO VÁLIDA
        if (uid) {
          this.updateSession(uid, ip, userAgent);
        }

        this.telemetry.successfulAccess++;
        this.telemetry.lastAccess = new Date();

        // 📝 LOG DE AUDITORIA (APENAS PARA OPERAÇÕES CRÍTICAS)
        if (this.isCriticalOperation(req.method, req.path)) {
          await this.logSecurityEvent(uid || 'anonymous', ip, 'critical_operation', {
            method: req.method,
            path: req.path,
            userAgent
          });
        }

        next();
      } catch (error) {
        console.error('❌ ADMIN SHIELD: Erro na verificação:', error);
        // FAIL-CLOSED: Em caso de erro, BLOQUEAR acesso
        this.telemetry.blockedAttempts++;
        return res.status(503).json({
          error: 'Sistema de segurança temporariamente indisponível',
          code: 'SECURITY_ERROR'
        });
      }
    };
  }

  /**
   * 🕐 RATE LIMITING AGRESSIVO
   * - 30 requisições por minuto por usuário/IP
   * - 100 requisições por hora por usuário/IP
   */
  private checkRateLimit(identifier: string): boolean {
    const now = Date.now();
    const data = this.rateLimitMap.get(identifier) || {
      minute: { count: 0, resetAt: now + 60000 },
      hour: { count: 0, resetAt: now + 3600000 }
    };

    // Resetar contadores se expirados
    if (now > data.minute.resetAt) {
      data.minute = { count: 0, resetAt: now + 60000 };
    }
    if (now > data.hour.resetAt) {
      data.hour = { count: 0, resetAt: now + 3600000 };
    }

    // Incrementar contadores
    data.minute.count++;
    data.hour.count++;

    this.rateLimitMap.set(identifier, data);

    // Verificar limites
    return data.minute.count <= 30 && data.hour.count <= 100;
  }

  /**
   * 🤖 DETECTAR USER-AGENT SUSPEITO
   */
  private isSuspiciousUserAgent(userAgent: string): boolean {
    const suspicious = [
      'curl',
      'wget',
      'python-requests',
      'axios/',
      'got/',
      'node-fetch',
      'postman',
      'insomnia',
      'httpie',
      'scrapy',
      'bot',
      'crawler',
      'spider'
    ];

    const ua = userAgent.toLowerCase();
    return suspicious.some(pattern => ua.includes(pattern));
  }

  /**
   * 🎯 DETECTAR PADRÃO DE AUTOMAÇÃO
   */
  private detectAutomationPattern(identifier: string, path: string): boolean {
    const session = this.sessionMap.get(identifier);
    if (!session) return false;

    const timeSinceCreation = Date.now() - session.createdAt.getTime();
    const timeSinceLastActivity = Date.now() - session.lastActivity.getTime();

    // Padrão 1: Muitas requisições em tempo muito curto
    if (session.requestCount > 50 && timeSinceCreation < 60000) {
      return true;
    }

    // Padrão 2: Requisições com tempo muito consistente (< 100ms entre cada)
    if (timeSinceLastActivity < 100 && session.requestCount > 10) {
      return true;
    }

    return false;
  }

  /**
   * 📝 IDENTIFICAR OPERAÇÕES CRÍTICAS
   */
  private isCriticalOperation(method: string, path: string): boolean {
    const criticalPaths = [
      '/api/admin/sellers',
      '/api/admin/security',
      '/api/admin/configurations',
      '/api/admin/acquirers',
      '/api/admin/delete-account',
      '/api/admin/reset',
      '/api/admin/cleanup',
      '/api/admin/impersonate'
    ];

    const criticalMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

    return criticalMethods.includes(method) &&
      criticalPaths.some(cp => path.startsWith(cp));
  }

  /**
   * 🔄 ATUALIZAR SESSÃO ATIVA
   */
  private updateSession(uid: string, ip: string, userAgent: string): void {
    const session = this.sessionMap.get(uid) || {
      uid,
      ip,
      userAgent,
      deviceFingerprint: this.generateFingerprint(ip, userAgent),
      lastActivity: new Date(),
      requestCount: 0,
      createdAt: new Date()
    };

    session.lastActivity = new Date();
    session.requestCount++;

    this.sessionMap.set(uid, session);
    this.telemetry.activeSessions.set(uid, session);
  }

  /**
   * 🔐 GERAR FINGERPRINT DE DISPOSITIVO
   */
  private generateFingerprint(ip: string, userAgent: string): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(`${ip}:${userAgent}`)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * 📊 LOG DE EVENTOS DE SEGURANÇA
   */
  private async logSecurityEvent(
    uid: string,
    ip: string,
    eventType: string,
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      const db = getFirestore();
      await db.collection('securityLogs').add({
        uid,
        ip,
        eventType,
        category: 'admin_access',
        severity: this.getSeverity(eventType),
        metadata,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Erro ao registrar log de segurança:', error);
      // Não lançar erro - continuar execução
    }
  }

  /**
   * ⚠️ DETERMINAR SEVERIDADE DO EVENTO
   */
  private getSeverity(eventType: string): string {
    const highSeverity = [
      'blocked_ip_attempt',
      'automation_detected',
      'suspicious_user_agent'
    ];

    const mediumSeverity = [
      'rate_limit_exceeded'
    ];

    if (highSeverity.includes(eventType)) return 'high';
    if (mediumSeverity.includes(eventType)) return 'medium';
    return 'low';
  }

  /**
   * 🧹 LIMPEZA DE DADOS ANTIGOS
   */
  private cleanup(): void {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Limpar rate limits expirados
    for (const [key, data] of this.rateLimitMap.entries()) {
      if (now > data.hour.resetAt) {
        this.rateLimitMap.delete(key);
      }
    }

    // Limpar sessões inativas (> 1 hora)
    for (const [uid, session] of this.sessionMap.entries()) {
      if (session.lastActivity.getTime() < oneHourAgo) {
        this.sessionMap.delete(uid);
        this.telemetry.activeSessions.delete(uid);
      }
    }

    console.log(`🧹 ADMIN SHIELD: Limpeza concluída - ${this.rateLimitMap.size} rate limits, ${this.sessionMap.size} sessões ativas`);
  }

  /**
   * 📊 OBTER TELEMETRIA
   */
  public getTelemetry() {
    return {
      ...this.telemetry,
      blockedIPs: Array.from(this.telemetry.blockedIPs),
      activeSessions: this.sessionMap.size,
      suspiciousIPs: Array.from(this.suspiciousIPs),
      rateLimitEntries: this.rateLimitMap.size
    };
  }

  /**
   * 🔓 DESBLOQUEAR IP (APENAS PARA ADMIN)
   */
  public unblockIP(ip: string): void {
    this.telemetry.blockedIPs.delete(ip);
    this.suspiciousIPs.delete(ip);
    console.log(`🔓 ADMIN SHIELD: IP desbloqueado: ${ip}`);
  }
}

interface RateLimitData {
  minute: {
    count: number;
    resetAt: number;
  };
  hour: {
    count: number;
    resetAt: number;
  };
}

export const adminShield = AdminShield.getInstance();
