// 🛡️ SISTEMA DE RATE LIMITING POR USUÁRIO - IMPOSSÍVEL DE ABUSAR
// Controla limites específicos para tickets, chats, produtos, checkout

import { Request, Response, NextFunction } from 'express';
import { getAdmin } from '../lib/firebase-admin.js';
import { saveDataToBunny } from '../lib/bunny-data-storage.js';

interface UserRateLimit {
  userId: string;
  endpoint: string;
  count: number;
  resetTime: number;
  lastRequest: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  category: string;
}

class UserRateLimiter {
  private cache = new Map<string, UserRateLimit>();
  
  // ✅ LIMITES PERMISSIVOS PARA USUÁRIOS LEGÍTIMOS - BLOQUEIA APENAS ATAQUES REAIS
  private readonly limits: Record<string, RateLimitConfig> = {
    'tickets': {
      maxRequests: 100,      // ✅ Máximo 100 tentativas de criação de tickets por dia (proteção real está nos 2 abertos simultâneos)
      windowMs: 24 * 60 * 60 * 1000, // 24 horas
      category: 'ticket_creation'
    },
    'messages': {
      maxRequests: 20,       // ✅ Máximo 20 mensagens seguidas (sellers respondendo clientes)
      windowMs: 30 * 1000,   // 30 segundos - resetado após bloqueio
      category: 'message_creation'
    },
    'products': {
      maxRequests: 20,       // ✅ Máximo 20 produtos por minuto (sellers criando produtos em lote)
      windowMs: 60 * 1000,   // 1 minuto - permite criação rápida de produtos
      category: 'product_creation'
    },
    'checkout': {
      maxRequests: 200,      // ✅ Máximo 200 tentativas de checkout por hora (compras múltiplas, erros de pagamento)
      windowMs: 60 * 60 * 1000, // 1 hora
      category: 'checkout_attempt'
    },
    'uploads': {
      maxRequests: 500,      // ✅ Máximo 500 uploads por hora (sellers fazem múltiplos uploads de fotos)
      windowMs: 60 * 60 * 1000, // 1 hora
      category: 'file_upload'
    },
    'document-upload': {
      maxRequests: 50,       // ✅ Máximo 50 uploads de documentos por hora (cadastro de sellers)
      windowMs: 60 * 60 * 1000, // 1 hora
      category: 'document_upload'
    },
    'sellers': {
      maxRequests: 10,       // ✅ Máximo 10 tentativas de cadastro de seller por IP por dia (permite erros)
      windowMs: 24 * 60 * 60 * 1000, // 24 horas
      category: 'seller_registration'
    },
    'emergency': {
      maxRequests: 3,        // 🚨 Máximo 3 correções emergenciais por dia (operação crítica)
      windowMs: 24 * 60 * 60 * 1000, // 24 horas
      category: 'emergency_fix'
    },
    'withdrawal': {
      maxRequests: 5,        // 🔒 Máximo 5 saques por hora por usuário (legítimo: saques são ações manuais)
      windowMs: 60 * 60 * 1000, // 1 hora
      category: 'withdrawal_request'
    },
    'refund': {
      maxRequests: 10,       // 🔒 Máximo 10 pedidos de reembolso por hora por usuário
      windowMs: 60 * 60 * 1000, // 1 hora
      category: 'refund_request'
    }
  };

  // 📋 LOGAR RATE LIMIT PARA ADMIN DECIDIR - SEM AUTO-BLOQUEIO
  private async autoBlockIPIfNeeded(ip: string, score: number, reason: string): Promise<void> {
    try {
      // 🚫 AUTO-BLOQUEIO DESABILITADO - Apenas logando para admin analisar
      console.log(`📋 RATE LIMIT LOG: IP ${ip} - Score ${score} - ${reason} - Admin irá analisar e decidir`);
      
      // Logs ficam salvos para o admin revisar no painel e bloquear manualmente se necessário
    } catch (error) {
      console.error('❌ Erro ao logar rate limit:', error);
    }
  }

  // 🔍 VERIFICAR SE USUÁRIO EXCEDEU LIMITE
  async checkLimit(userId: string, endpoint: string, req?: any): Promise<boolean> {
    const config = this.limits[endpoint];
    if (!config) return true; // Se não tem configuração, permite

    const key = `${userId}:${endpoint}`;
    const now = Date.now();
    
    let userLimit = this.cache.get(key);

    // 🔄 RESET AUTOMÁTICO QUANDO JANELA EXPIRA
    if (!userLimit || (now - userLimit.resetTime) > config.windowMs) {
      userLimit = {
        userId,
        endpoint,
        count: 0,
        resetTime: now,
        lastRequest: now
      };
      this.cache.set(key, userLimit);
    }

    // ✅ VERIFICAR SE DENTRO DO LIMITE
    if (userLimit.count >= config.maxRequests) {
      console.log(`🚨 RATE LIMIT EXCEDIDO: Usuario ${userId} excedeu limite de ${config.maxRequests} para ${endpoint}`);
      
      // 🚫 AUTO-BLOCK: Calcular score e bloquear se necessário
      if (req?.ip) {
        const score = this.calculateRateLimitScore(userLimit.count, config.maxRequests, endpoint);
        await this.autoBlockIPIfNeeded(req.ip, score, `Rate limit exceeded: ${endpoint}`);
      }
      
      // 💾 REGISTRAR ABUSO NO FIREBASE
      await this.logRateLimitViolation(userId, endpoint, userLimit.count, config);
      return false;
    }

    // ✅ INCREMENTAR CONTADOR
    userLimit.count++;
    userLimit.lastRequest = now;
    this.cache.set(key, userLimit);

    console.log(`✅ RATE LIMIT OK: Usuario ${userId} - ${endpoint}: ${userLimit.count}/${config.maxRequests} (Reseta em ${Math.ceil((config.windowMs - (now - userLimit.resetTime)) / 1000)}s)`);
    return true;
  }

  // 📊 REGISTRAR VIOLAÇÃO DE RATE LIMIT NO FIREBASE
  private async logRateLimitViolation(userId: string, endpoint: string, attempts: number, config: RateLimitConfig) {
    try {
      const admin = getAdmin();
      const db = admin.firestore();

      const violationId = `rl_${userId}_${endpoint}_${Date.now()}`;
      const fullViolationData = {
        userId,
        endpoint,
        category: config.category,
        attempts,
        maxAllowed: config.maxRequests,
        windowMs: config.windowMs,
        timestamp: new Date(),
        severity: 'HIGH',
        blocked: true
      };

      saveDataToBunny('logs/rate-limit', violationId, fullViolationData)
        .then(r => r.success && console.log(`☁️ Rate limit violation ${violationId} salvo no Bunny`))
        .catch(err => console.error('⚠️ Bunny rate limit log error:', err));

      await db.collection('rateLimitViolations').doc(violationId).set({
        id: violationId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: userId,
        endpoint,
        count: attempts
      });

      console.log(`📊 Violação de rate limit registrada: ${userId} - ${endpoint}`);
    } catch (error) {
      console.error('❌ Erro ao registrar violação de rate limit:', error);
    }
  }

  // 🔍 OBTER STATUS ATUAL DO USUÁRIO
  getUserStatus(userId: string, endpoint: string): { count: number; limit: number; resetIn: number } {
    const config = this.limits[endpoint];
    if (!config) return { count: 0, limit: 999, resetIn: 0 };

    const key = `${userId}:${endpoint}`;
    const userLimit = this.cache.get(key);
    
    if (!userLimit) {
      return { count: 0, limit: config.maxRequests, resetIn: config.windowMs };
    }

    const resetIn = Math.max(0, config.windowMs - (Date.now() - userLimit.resetTime));
    return {
      count: userLimit.count,
      limit: config.maxRequests,
      resetIn
    };
  }

  // 📊 CALCULAR SCORE DE RATE LIMIT - NÃO BLOQUEIA LOGINS NORMAIS
  private calculateRateLimitScore(currentCount: number, maxAllowed: number, endpoint: string): number {
    const exceedRatio = currentCount / maxAllowed;
    let baseScore = Math.min(250, exceedRatio * 50); // Score base mais alto
    
    // 🎯 AJUSTAR SCORE POR ENDPOINT CRÍTICO
    if (endpoint === 'checkout' || endpoint === 'products') {
      baseScore *= 1.5; // +50% para endpoints críticos
    }
    
    // 🚨 EXCESSO SEVERO = SCORE MUITO ALTO (apenas invasões reais)
    if (exceedRatio >= 10) baseScore = 250; // CRITICAL - 10x o limite
    else if (exceedRatio >= 5) baseScore = 180; // HIGH - 5x o limite
    else if (exceedRatio >= 3) baseScore = 120; // MEDIUM-HIGH - 3x o limite
    
    // ✅ SEM MÍNIMO - Logins normais não são bloqueados
    return Math.min(250, baseScore);
  }

  // 🧹 LIMPEZA AUTOMÁTICA DE CACHE EXPIRADO
  cleanup() {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, userLimit] of this.cache.entries()) {
      const config = this.limits[userLimit.endpoint];
      if (config && (now - userLimit.resetTime) > config.windowMs) {
        toDelete.push(key);
      }
    }

    toDelete.forEach(key => this.cache.delete(key));
    console.log(`🧹 Limpeza de cache: ${toDelete.length} entradas removidas`);
  }

  // 🔄 RESETAR LIMITE DE UM USUÁRIO ESPECÍFICO
  resetUserLimit(userId: string, endpoint?: string) {
    if (endpoint) {
      const key = `${userId}:${endpoint}`;
      this.cache.delete(key);
      console.log(`🔄 Rate limit resetado: ${userId} - ${endpoint}`);
    } else {
      // Resetar todos os endpoints do usuário
      const toDelete: string[] = [];
      for (const [key, userLimit] of this.cache.entries()) {
        if (userLimit.userId === userId) {
          toDelete.push(key);
        }
      }
      toDelete.forEach(key => this.cache.delete(key));
      console.log(`🔄 Rate limit resetado: ${userId} - TODOS os endpoints (${toDelete.length})`);
    }
  }
}

// 🌟 INSTÂNCIA SINGLETON
export const userRateLimiter = new UserRateLimiter();

// 🛡️ MIDDLEWARE DE RATE LIMITING POR USUÁRIO (ou IP se não autenticado)
export function userRateLimit(endpoint: string) {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      // ✅ USAR UID DO USUÁRIO OU IP COMO FALLBACK (permite uploads durante cadastro)
      const userId = req.user?.uid || req.ip || 'anonymous';
      
      // ⚠️ LOGS PARA IDENTIFICAR USO DE IP (durante cadastro)
      if (!req.user?.uid) {
        console.log(`⚠️ RATE LIMIT usando IP: ${req.ip} para endpoint: ${endpoint} (sem autenticação)`);
      }

      // ✅ VERIFICAR LIMITE
      const allowed = await userRateLimiter.checkLimit(userId, endpoint, req);
      
      if (!allowed) {
        const status = userRateLimiter.getUserStatus(userId, endpoint);
        const resetSeconds = Math.ceil(status.resetIn / 1000);
        const resetMinutes = Math.ceil(resetSeconds / 60);
        
        // 🎯 MENSAGENS ESPECÍFICAS POR ENDPOINT
        let message = `Você excedeu o limite de ${status.limit} ${endpoint} permitidos. Tente novamente em ${resetMinutes} minutos.`;
        
        if (endpoint === 'products') {
          message = `⏰ Limite de criação atingido! Você criou ${status.limit} produtos seguidos. Aguarde ${resetSeconds} segundos para criar mais produtos.`;
        } else if (endpoint === 'messages') {
          message = `🛡️ Anti-flood ativado! Você enviou ${status.limit} mensagens seguidas. Aguarde ${resetSeconds} segundos para enviar mais mensagens.`;
        }
        
        return res.status(429).json({
          error: 'Rate limit excedido',
          message,
          code: 'RATE_LIMIT_EXCEEDED',
          details: {
            current: status.count,
            limit: status.limit,
            resetIn: status.resetIn,
            resetSeconds,
            endpoint
          }
        });
      }

      next();
    } catch (error) {
      console.error('❌ Erro no rate limiter:', error);
      next(); // Em caso de erro, permite a requisição
    }
  };
}

// 🧹 CLEANUP AUTOMÁTICO A CADA 5 MINUTOS
setInterval(() => {
  userRateLimiter.cleanup();
}, 5 * 60 * 1000);

export default userRateLimiter;