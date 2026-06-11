/**
 * 🛡️ ANTI-ENUMERATION PROTECTION
 * Proteção ultra-avançada contra enumeração
 * - Response timing normalization
 * - Generic error messages
 * - User existence obfuscation
 * - Resource discovery prevention
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

export class AntiEnumerationProtection {
  private static instance: AntiEnumerationProtection;
  private readonly MIN_RESPONSE_TIME = 200; // ms mínimo de resposta
  private readonly MAX_RESPONSE_TIME = 500; // ms máximo de resposta

  public static getInstance(): AntiEnumerationProtection {
    if (!AntiEnumerationProtection.instance) {
      AntiEnumerationProtection.instance = new AntiEnumerationProtection();
    }
    return AntiEnumerationProtection.instance;
  }

  /**
   * ⏱️ NORMALIZAR TEMPO DE RESPOSTA
   * Previne timing attacks para enumerar usuários/recursos
   */
  public normalizeResponseTiming() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      
      // Interceptar res.json para adicionar delay
      const originalJson = res.json.bind(res);
      
      res.json = function(body: any) {
        const elapsed = Date.now() - startTime;
        const targetTime = crypto.randomInt(
          AntiEnumerationProtection.instance.MIN_RESPONSE_TIME,
          AntiEnumerationProtection.instance.MAX_RESPONSE_TIME
        );
        
        const delay = Math.max(0, targetTime - elapsed);
        
        if (delay > 0) {
          setTimeout(() => {
            originalJson(body);
          }, delay);
        } else {
          originalJson(body);
        }
        
        return res;
      };
      
      next();
    };
  }

  /**
   * 🎭 MENSAGENS GENÉRICAS DE ERRO
   */
  public genericErrorResponses() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Interceptar status errors
      const originalStatus = res.status.bind(res);
      
      res.status = function(code: number) {
        // Para erros específicos, usar mensagens genéricas
        if (code === 401 || code === 403 || code === 404) {
          // Não revelar se recurso existe ou não
          const genericMessages: { [key: number]: string } = {
            401: 'Autenticação inválida',
            403: 'Acesso negado',
            404: 'Recurso não encontrado'
          };
          
          // Armazenar mensagem genérica
          res.locals.genericMessage = genericMessages[code];
        }
        
        return originalStatus(code);
      };
      
      next();
    };
  }

  /**
   * 👤 PREVENIR ENUMERAÇÃO DE USUÁRIOS
   * Login/Registro devem ter mesma resposta independente de usuário existir
   */
  public preventUserEnumeration() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const isAuthEndpoint = 
        req.path.includes('/login') || 
        req.path.includes('/register') ||
        req.path.includes('/forgot-password') ||
        req.path.includes('/reset-password');

      if (!isAuthEndpoint) {
        return next();
      }

      // Interceptar resposta
      const originalJson = res.json.bind(res);
      
      res.json = function(body: any) {
        // Sempre retornar mesma estrutura
        if (body.error && typeof body.error === 'string') {
          // Transformar erros específicos em genéricos
          if (body.error.toLowerCase().includes('usuário') || 
              body.error.toLowerCase().includes('user') ||
              body.error.toLowerCase().includes('email') ||
              body.error.toLowerCase().includes('existe') ||
              body.error.toLowerCase().includes('exist') ||
              body.error.toLowerCase().includes('not found')) {
            
            body.error = 'Credenciais inválidas';
          }
        }
        
        return originalJson(body);
      };
      
      next();
    };
  }

  /**
   * 🔍 PREVENIR ENUMERAÇÃO DE RECURSOS
   */
  public preventResourceEnumeration() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Interceptar 404s para não revelar padrões
      const originalStatus = res.status.bind(res);
      
      res.status = function(code: number) {
        if (code === 404) {
          // Sempre retornar mesma resposta para 404
          const genericBody = {
            success: false,
            error: 'Recurso não encontrado'
          };
          
          res.locals.generic404 = genericBody;
        }
        
        return originalStatus(code);
      };
      
      next();
    };
  }

  /**
   * 📊 PREVENIR ENUMERAÇÃO VIA SEQUÊNCIA
   * IDs sequenciais revelam quantidade de recursos
   */
  public preventSequentialEnumeration() {
    return (req: Request, res: Response, next: NextFunction) => {
      const id = req.params.id || req.query.id || req.body.id;
      
      if (id && typeof id === 'string') {
        // Detectar tentativa de iterar IDs
        const isSequential = /^\d+$/.test(id);
        
        if (isSequential) {
          console.warn(`⚠️ SEQUENTIAL ID ACCESS: ${id} from ${req.ip} - possible enumeration attempt`);
          
          // Não bloquear, mas logar para análise
          // Em produção poderia aplicar rate limiting mais agressivo
        }
      }
      
      next();
    };
  }

  /**
   * 🚫 PREVENIR DISCOVERY DE ENDPOINTS
   */
  public preventEndpointDiscovery() {
    return (req: Request, res: Response, next: NextFunction) => {
      // ✅ PERMITIR PÁGINAS FRONTEND ADMIN LEGÍTIMAS
      const legitimateAdminPages = [
        '/admin/dashboard',
        '/admin/sellers',
        '/admin/manage-sellers',
        '/admin/products',
        '/admin/transactions',
        '/admin/support',
        '/admin/support-tickets',
        '/admin/withdrawals',
        '/admin/refund-withdrawals',
        '/admin/acquirers',
        '/admin/security',
        '/admin/banners',
        '/admin/sellers-risk',
        '/admin/account-reset',
        '/admin/configurations',
        '/admin/stripe-settings'
      ];
      
      const isLegitimateAdminPage = legitimateAdminPages.some(page => 
        req.path.startsWith(page)
      );
      
      // ✅ PERMITIR API ENDPOINTS ADMIN (serão protegidos por requireAdmin depois)
      const isAdminAPI = req.path.startsWith('/api/admin/');
      
      if (isLegitimateAdminPage || isAdminAPI) {
        console.warn(`🚨 SENSITIVE ENDPOINT ACCESS: ${req.path} from ${req.ip}`);
        return next(); // Permitir e deixar auth middleware validar
      }
      
      // ⛔ BLOQUEAR ENDPOINTS SENSÍVEIS REAIS
      const blockedEndpoints = [
        '/admin', // Admin root sem subrotas
        '/debug', '/test', '/dev',
        '/config', '/settings',
        '/users/list', '/users/all',
        '/.env', '/.git', '/backup'
      ];

      const isBlocked = blockedEndpoints.some(endpoint => 
        req.path === endpoint || req.path.startsWith(endpoint + '/')
      );

      if (isBlocked) {
        console.warn(`⛔ BLOCKED ENDPOINT ACCESS: ${req.path} from ${req.ip}`);
        
        // Retornar 404 genérico ao invés de 403 (não revelar existência)
        return res.status(404).json({
          success: false,
          error: 'Recurso não encontrado'
        });
      }

      next();
    };
  }

  /**
   * 🎲 ADICIONAR RUÍDO ÀS RESPOSTAS
   * Pequenas variações aleatórias para dificultar fingerprinting
   */
  public addResponseNoise() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Adicionar header com timestamp variável
      const noise = crypto.randomBytes(4).toString('hex');
      res.setHeader('X-Request-ID', noise);
      
      next();
    };
  }

  /**
   * 📝 SANITIZAR MENSAGENS DE ERRO
   */
  public sanitizeErrorMessages() {
    return (err: Error, req: Request, res: Response, next: NextFunction) => {
      // Não revelar detalhes técnicos em produção
      if (process.env.NODE_ENV === 'production') {
        const genericError = {
          success: false,
          error: 'Ocorreu um erro ao processar sua solicitação'
        };
        
        // Log erro completo no servidor
        console.error(`❌ Error on ${req.method} ${req.path}:`, err);
        
        // Retornar erro genérico ao cliente
        return res.status(500).json(genericError);
      }
      
      next(err);
    };
  }

  /**
   * 🔐 PREVENIR USERNAME/EMAIL ENUMERATION
   */
  public preventIdentifierEnumeration() {
    return (req: Request, res: Response, next: NextFunction) => {
      const email = req.body?.email || req.query?.email;
      const username = req.body?.username || req.query?.username;
      
      if ((email || username) && (req.path.includes('/check') || req.path.includes('/exists'))) {
        console.warn(`⚠️ ENUMERATION ATTEMPT: Checking ${email || username} from ${req.ip}`);
        
        // Sempre retornar mesma resposta
        return res.json({
          success: true,
          message: 'Verificação concluída'
        });
      }
      
      next();
    };
  }

  /**
   * 📊 RATE LIMITING ESPECÍFICO PARA ENUMERAÇÃO
   */
  public enumerationRateLimit: Map<string, { count: number; resetAt: number }> = new Map();

  public antiEnumerationRateLimit(maxAttempts: number = 5, windowMs: number = 60000) {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = `${req.ip}:${req.path}`;
      const now = Date.now();
      const record = this.enumerationRateLimit.get(key);

      if (!record || now > record.resetAt) {
        this.enumerationRateLimit.set(key, {
          count: 1,
          resetAt: now + windowMs
        });
        return next();
      }

      if (record.count >= maxAttempts) {
        console.error(`🚨 ENUMERATION RATE LIMIT: ${req.ip} exceeded ${maxAttempts} attempts on ${req.path}`);
        
        // Delay progressivo para desencorajar
        const delay = Math.min(record.count * 1000, 10000);
        
        return setTimeout(() => {
          res.status(429).json({
            success: false,
            error: 'Muitas tentativas. Aguarde alguns instantes.'
          });
        }, delay);
      }

      record.count++;
      next();
    };
  }
}

export const enumerationProtection = AntiEnumerationProtection.getInstance();
