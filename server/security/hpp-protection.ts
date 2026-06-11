/**
 * 🛡️ HPP (HTTP PARAMETER POLLUTION) PROTECTION
 * Proteção ultra-avançada contra HTTP Parameter Pollution
 * - Duplicate parameter detection
 * - Array manipulation prevention
 * - Query string attack blocking
 * - Advanced rate limiting with progressive delays
 */

import { Request, Response, NextFunction } from 'express';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

interface RateLimitRecord {
  count: number;
  resetAt: number;
  violations: number;
}

export class HPPProtection {
  private static instance: HPPProtection;
  private rateLimitStore: Map<string, RateLimitRecord> = new Map();

  public static getInstance(): HPPProtection {
    if (!HPPProtection.instance) {
      HPPProtection.instance = new HPPProtection();
    }
    return HPPProtection.instance;
  }

  /**
   * 🛡️ DETECTAR PARAMETER POLLUTION
   */
  public detectHPP() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Verificar query string raw
      const queryString = req.url.split('?')[1] || '';
      const params = new URLSearchParams(queryString);
      
      // Contar ocorrências de cada parâmetro
      const paramCounts: Map<string, number> = new Map();
      
      for (const [key] of params.entries()) {
        paramCounts.set(key, (paramCounts.get(key) || 0) + 1);
      }

      // Detectar parâmetros duplicados
      const duplicates = Array.from(paramCounts.entries())
        .filter(([_, count]) => count > 1);

      if (duplicates.length > 0) {
        console.warn(`⚠️ HPP DETECTED: Duplicate parameters ${duplicates.map(([k]) => k).join(', ')} from ${req.ip}`);
        
        // Usar apenas o último valor de cada parâmetro (comportamento seguro)
        for (const [key] of duplicates) {
          const values = params.getAll(key);
          const lastValue = values[values.length - 1];
          
          // Atualizar req.query com valor único
          req.query[key] = lastValue;
        }
      }

      next();
    };
  }

  /**
   * 🧹 LIMPAR ARRAYS POLUÍDOS
   */
  public cleanPollutedArrays() {
    return (req: Request, res: Response, next: NextFunction) => {
      const cleanArrays = (obj: any): any => {
        if (Array.isArray(obj)) {
          // Verificar se array foi poluído com propriedades
          const cleanArray = obj.filter(item => item !== undefined && item !== null);
          
          // Remover propriedades não-numéricas (pollution attempt)
          return cleanArray;
        }
        
        if (typeof obj === 'object' && obj !== null) {
          const cleaned: any = {};
          for (const [key, value] of Object.entries(obj)) {
            cleaned[key] = cleanArrays(value);
          }
          return cleaned;
        }
        
        return obj;
      };

      if (req.body) {
        req.body = cleanArrays(req.body);
      }
      
      if (req.query) {
        req.query = cleanArrays(req.query);
      }

      next();
    };
  }

  /**
   * 🚫 BLOQUEAR PROTOTYPE POLLUTION
   */
  public blockPrototypePollution() {
    return (req: Request, res: Response, next: NextFunction) => {
      const dangerousKeys = [
        '__proto__',
        'constructor',
        'prototype'
      ];

      const checkPollution = (obj: any, path: string = ''): boolean => {
        if (typeof obj === 'object' && obj !== null) {
          for (const key of Object.keys(obj)) {
            if (dangerousKeys.includes(key)) {
              console.error(`🚨 PROTOTYPE POLLUTION ATTEMPT: ${path}.${key} from ${req.ip}`);
              return true;
            }
            
            if (typeof obj[key] === 'object' && obj[key] !== null) {
              if (checkPollution(obj[key], path ? `${path}.${key}` : key)) {
                return true;
              }
            }
          }
        }
        return false;
      };

      if (checkPollution(req.body, 'body') || 
          checkPollution(req.query, 'query')) {
        
        // 🔐 WHITELIST: Ignorar IPs Replit/privados (navegação legítima)
        const isReplitIP = /^160\.20\./.test(req.ip);
        const isPrivateIP = /^(127\.|10\.|192\.168\.)/.test(req.ip) || req.ip === '::1';
        
        if (!isReplitIP && !isPrivateIP) {
          // 🔥 BLOQUEIO AUTOMÁTICO apenas para IPs EXTERNOS (ataques reais)
          addSuspiciousIPToPermanentBlacklist(
            req.ip, 
            `Prototype Pollution attempt on ${req.method} ${req.path}`, 
            'critical'
          ).catch(err => console.error('❌ Erro ao bloquear IP:', err));
          
          return res.status(400).json({
            success: false,
            error: 'Tentativa de manipulação de objeto detectada'
          });
        } else {
          console.log(`🏠 WHITELIST: Prototype check ignored for Replit/Private IP ${req.ip}`);
        }
      }

      next();
    };
  }

  /**
   * ⏱️ ADVANCED RATE LIMITING COM DELAYS PROGRESSIVOS
   */
  public advancedRateLimit(options: {
    windowMs?: number;
    maxRequests?: number;
    delayAfter?: number;
    delayMs?: number;
  } = {}) {
    const {
      windowMs = 15 * 60 * 1000, // 15 minutos
      maxRequests = 100,
      delayAfter = 50,
      delayMs = 500
    } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
      const key = `${req.ip}:${req.path}`;
      const now = Date.now();

      let record = this.rateLimitStore.get(key);

      // Reset se janela expirou
      if (!record || now > record.resetAt) {
        record = {
          count: 1,
          resetAt: now + windowMs,
          violations: 0
        };
        this.rateLimitStore.set(key, record);
        return next();
      }

      record.count++;

      // Aplicar delay progressivo após delayAfter requisições
      if (record.count > delayAfter) {
        const delayCount = record.count - delayAfter;
        const totalDelay = Math.min(delayCount * delayMs, 10000); // Máximo 10s
        
        console.log(`⏱️ Rate limit delay: ${totalDelay}ms for ${req.ip} on ${req.path}`);
        
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      }

      // Bloquear se exceder limite
      if (record.count > maxRequests) {
        record.violations++;
        
        console.error(`🚨 RATE LIMIT EXCEEDED: ${req.ip} on ${req.path} - ${record.count} requests (${record.violations} violations)`);
        
        // Aumentar janela de bloqueio para violadores recorrentes
        if (record.violations > 3) {
          record.resetAt = now + (windowMs * 2); // Dobrar janela
        }
        
        return res.status(429).json({
          success: false,
          error: 'Muitas requisições. Aguarde alguns instantes.',
          retryAfter: Math.ceil((record.resetAt - now) / 1000)
        });
      }

      next();
    };
  }

  /**
   * 📊 LIMITAR TAMANHO DE ARRAYS
   */
  public limitArraySize(maxSize: number = 100) {
    return (req: Request, res: Response, next: NextFunction) => {
      const checkArraySize = (obj: any, path: string = ''): boolean => {
        if (Array.isArray(obj)) {
          if (obj.length > maxSize) {
            console.error(`🚨 ARRAY SIZE LIMIT: ${path} has ${obj.length} items (max: ${maxSize}) from ${req.ip}`);
            return true;
          }
          
          return obj.some((item, index) => 
            checkArraySize(item, `${path}[${index}]`)
          );
        }
        
        if (typeof obj === 'object' && obj !== null) {
          return Object.entries(obj).some(([key, value]) =>
            checkArraySize(value, path ? `${path}.${key}` : key)
          );
        }
        
        return false;
      };

      if (checkArraySize(req.body, 'body') || 
          checkArraySize(req.query, 'query')) {
        
        return res.status(400).json({
          success: false,
          error: 'Tamanho de array excede o limite permitido'
        });
      }

      next();
    };
  }

  /**
   * 🔐 VALIDAR QUERY STRING COMPLEXITY
   */
  public validateQueryComplexity() {
    return (req: Request, res: Response, next: NextFunction) => {
      const queryString = req.url.split('?')[1] || '';
      
      // Limites de complexidade
      const maxLength = 2048; // 2KB
      const maxParams = 50;
      const maxNesting = 5;

      // Verificar tamanho
      if (queryString.length > maxLength) {
        console.error(`🚨 QUERY TOO LONG: ${queryString.length} chars from ${req.ip}`);
        return res.status(414).json({
          success: false,
          error: 'Query string muito longa'
        });
      }

      // Verificar número de parâmetros
      const paramCount = queryString.split('&').length;
      if (paramCount > maxParams) {
        console.error(`🚨 TOO MANY PARAMS: ${paramCount} params from ${req.ip}`);
        return res.status(400).json({
          success: false,
          error: 'Muitos parâmetros na requisição'
        });
      }

      // Verificar nesting depth
      const nestingDepth = (queryString.match(/\[/g) || []).length;
      if (nestingDepth > maxNesting) {
        console.error(`🚨 DEEP NESTING: ${nestingDepth} levels from ${req.ip}`);
        return res.status(400).json({
          success: false,
          error: 'Estrutura de parâmetros muito complexa'
        });
      }

      next();
    };
  }

  /**
   * 🧹 NORMALIZAR PARÂMETROS
   */
  public normalizeParameters() {
    return (req: Request, res: Response, next: NextFunction) => {
      const normalize = (obj: any): any => {
        if (typeof obj === 'string') {
          return obj.trim();
        }
        
        if (Array.isArray(obj)) {
          // Remover duplicatas
          return [...new Set(obj.map(normalize))];
        }
        
        if (typeof obj === 'object' && obj !== null) {
          const normalized: any = {};
          for (const [key, value] of Object.entries(obj)) {
            normalized[key.trim()] = normalize(value);
          }
          return normalized;
        }
        
        return obj;
      };

      if (req.query) {
        req.query = normalize(req.query);
      }
      
      if (req.body) {
        req.body = normalize(req.body);
      }

      next();
    };
  }

  /**
   * 🚫 BLOQUEAR QUERY INJECTION
   */
  public blockQueryInjection() {
    return (req: Request, res: Response, next: NextFunction) => {
      const dangerousPatterns = [
        /\$where/gi,
        /\$regex/gi,
        /javascript:/gi,
        /<script/gi,
        /eval\(/gi,
        /function\s*\(/gi
      ];

      const queryString = JSON.stringify(req.query);

      if (dangerousPatterns.some(pattern => pattern.test(queryString))) {
        console.error(`🚨 QUERY INJECTION ATTEMPT from ${req.ip}: ${queryString.substring(0, 100)}`);
        
        // 🔥 BLOQUEIO AUTOMÁTICO DE IP (HIGH SEVERITY - 2 tentativas = ban)
        addSuspiciousIPToPermanentBlacklist(
          req.ip, 
          `Query Injection attempt in query string: ${queryString.substring(0, 100)}`, 
          'high'
        ).catch(err => console.error('❌ Erro ao bloquear IP:', err));
        
        return res.status(400).json({
          success: false,
          error: 'Padrão malicioso detectado na requisição'
        });
      }

      next();
    };
  }

  /**
   * 🧹 CLEANUP (Limpar registros antigos periodicamente)
   */
  public startCleanup(intervalMs: number = 60000) {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [key, record] of this.rateLimitStore.entries()) {
        if (now > record.resetAt) {
          this.rateLimitStore.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} expired rate limit records`);
      }
    }, intervalMs);
  }
}

export const hppProtection = HPPProtection.getInstance();

// Iniciar cleanup automático
hppProtection.startCleanup();
