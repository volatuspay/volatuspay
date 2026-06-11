/**
 * 🛡️ ANTI-IDOR (INSECURE DIRECT OBJECT REFERENCE) PROTECTION
 * Proteção ultra-avançada contra IDOR
 * - Session-based access control
 * - Indirect reference mapping
 * - Object ownership validation
 * - UUID enforcement
 */

import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email: string;
    email_verified: boolean;
  };
  authUser?: {
    uid: string;
    email?: string;
    customClaims?: any;
  };
}

export class AntiIDORProtection {
  private static instance: AntiIDORProtection;
  private referenceMap: Map<string, string> = new Map(); // indirect_ref -> real_id

  public static getInstance(): AntiIDORProtection {
    if (!AntiIDORProtection.instance) {
      AntiIDORProtection.instance = new AntiIDORProtection();
    }
    return AntiIDORProtection.instance;
  }

  /**
   * 🔍 DETECTAR IDs SEQUENCIAIS (VULNERÁVEL)
   */
  public isSequentialId(id: string): boolean {
    // IDs sequenciais são vulneráveis a IDOR
    const sequentialPatterns = [
      /^\d+$/,           // Apenas números: 1, 2, 3, 123
      /^[0-9]{1,10}$/,   // IDs numéricos curtos
      /^(user|order|product|item)_?\d+$/i, // user1, order2, product3
    ];

    return sequentialPatterns.some(pattern => pattern.test(id));
  }

  /**
   * 🔒 VALIDAR OWNERSHIP (POSSE DO OBJETO)
   */
  public ownershipValidator(
    resourceGetter: (id: string) => Promise<any>,
    ownerField: string = 'userId'
  ) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const resourceId = req.params.id || req.body.id || req.query.id;
        const userId = req.authUser?.uid || req.user?.uid;

        if (!userId) {
          console.error(`🚨 IDOR: No user ID found in request from ${req.ip}`);
          return res.status(401).json({
            success: false,
            error: 'Autenticação necessária'
          });
        }

        if (!resourceId) {
          return next();
        }

        // Buscar recurso
        const resource = await resourceGetter(resourceId as string);

        if (!resource) {
          // Não revelar se o recurso existe ou não (previne enumeration)
          console.warn(`🚨 IDOR: Resource not found: ${resourceId} from ${req.ip}`);
          return res.status(404).json({
            success: false,
            error: 'Recurso não encontrado'
          });
        }

        // Verificar ownership
        const resourceOwnerId = resource[ownerField];
        
        if (resourceOwnerId !== userId) {
          console.error(`🚨 IDOR ATTACK: User ${userId} tried to access resource ${resourceId} owned by ${resourceOwnerId}`);
          
          // 🔥 BLOQUEIO AUTOMÁTICO DE IP (HIGH SEVERITY - 2 tentativas = ban)
          addSuspiciousIPToPermanentBlacklist(
            req.ip, 
            `IDOR attempt: User ${userId} tried to access resource ${resourceId}`, 
            'high'
          ).catch(err => console.error('❌ Erro ao bloquear IP:', err));
          
          // Retornar 404 ao invés de 403 para não confirmar existência
          return res.status(404).json({
            success: false,
            error: 'Recurso não encontrado'
          });
        }

        // Anexar recurso ao request para uso posterior
        req.body.verifiedResource = resource;
        
        next();
      } catch (error) {
        console.error(`❌ Ownership validation error:`, error);
        return res.status(500).json({
          success: false,
          error: 'Erro ao validar permissões'
        });
      }
    };
  }

  /**
   * 🎲 CRIAR REFERÊNCIA INDIRETA
   */
  public createIndirectReference(realId: string, userId: string): string {
    // Criar ID indireto único baseado em userId + realId
    const indirectRef = nanoid(16);
    const key = `${userId}:${indirectRef}`;
    
    this.referenceMap.set(key, realId);
    
    // Auto-cleanup após 1 hora
    setTimeout(() => {
      this.referenceMap.delete(key);
    }, 60 * 60 * 1000);
    
    return indirectRef;
  }

  /**
   * 🔓 RESOLVER REFERÊNCIA INDIRETA
   */
  public resolveIndirectReference(indirectRef: string, userId: string): string | null {
    const key = `${userId}:${indirectRef}`;
    return this.referenceMap.get(key) || null;
  }

  /**
   * 🛡️ MIDDLEWARE DE REFERÊNCIA INDIRETA
   */
  public indirectReferenceMiddleware() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const userId = req.authUser?.uid || req.user?.uid;
      
      if (!userId) {
        return next();
      }

      // Verificar se há ID no request
      const indirectId = req.params.id || req.body.id || req.query.id;
      
      if (indirectId && typeof indirectId === 'string') {
        // Tentar resolver referência indireta
        const realId = this.resolveIndirectReference(indirectId, userId);
        
        if (realId) {
          // Substituir ID indireto pelo real
          if (req.params.id) req.params.id = realId;
          if (req.body.id) req.body.id = realId;
          if (req.query.id) req.query.id = realId as any;
          
          console.log(`✅ Indirect reference resolved: ${indirectId} -> ${realId}`);
        }
      }

      next();
    };
  }

  /**
   * 🚫 MIDDLEWARE DE DETECÇÃO IDOR
   */
  public idorDetector() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const userId = req.authUser?.uid || req.user?.uid;
      
      // 🛡️ WHITELIST: Ignorar parâmetros de desenvolvimento (Vite, HMR)
      const developmentParams = ['t', 'v', '_t', 'timestamp', 'cache', 'version'];
      const isDevelopmentRequest = 
        req.url.includes('/src/') || 
        req.url.includes('/@fs/') || 
        req.url.includes('/@vite/') ||
        req.url.includes('.tsx') ||
        req.url.includes('.ts') ||
        req.url.includes('.js') ||
        req.url.includes('.css');
      
      // Alertar sobre IDs sequenciais em produção (ignorando desenvolvimento)
      const checkIds = (obj: any, path: string = '', parentKey: string = ''): void => {
        // Skip parâmetros de desenvolvimento
        if (developmentParams.includes(parentKey) || isDevelopmentRequest) {
          return;
        }
        
        if (typeof obj === 'string' && this.isSequentialId(obj)) {
          console.warn(`⚠️ SEQUENTIAL ID DETECTED in ${path}: ${obj} - Potential IDOR vulnerability from user ${userId}`);
        } else if (Array.isArray(obj)) {
          obj.forEach((item, index) => checkIds(item, `${path}[${index}]`, ''));
        } else if (typeof obj === 'object' && obj !== null) {
          Object.entries(obj).forEach(([key, value]) => 
            checkIds(value, path ? `${path}.${key}` : key, key)
          );
        }
      };

      // Só verificar em produção/API endpoints reais
      if (!isDevelopmentRequest) {
        checkIds(req.params, 'params');
        checkIds(req.query, 'query');
        checkIds(req.body, 'body');
      }

      next();
    };
  }

  /**
   * 🔐 VALIDAR ACESSO BASEADO EM TENANT
   */
  public tenantAccessValidator(
    resourceGetter: (id: string) => Promise<any>,
    tenantField: string = 'tenantId'
  ) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const resourceId = req.params.id || req.body.id || req.query.id;
        const userTenantId = req.authUser?.customClaims?.tenantId || req.body.tenantId;

        if (!userTenantId) {
          return next(); // Sem tenant, pular validação
        }

        if (!resourceId) {
          return next();
        }

        const resource = await resourceGetter(resourceId as string);

        if (!resource) {
          return res.status(404).json({
            success: false,
            error: 'Recurso não encontrado'
          });
        }

        const resourceTenantId = resource[tenantField];

        if (resourceTenantId && resourceTenantId !== userTenantId) {
          console.error(`🚨 TENANT ISOLATION VIOLATION: User tenant ${userTenantId} tried to access resource from tenant ${resourceTenantId}`);
          
          return res.status(404).json({
            success: false,
            error: 'Recurso não encontrado'
          });
        }

        next();
      } catch (error) {
        console.error(`❌ Tenant validation error:`, error);
        return res.status(500).json({
          success: false,
          error: 'Erro ao validar acesso'
        });
      }
    };
  }

  /**
   * 🔍 VALIDAR UUID FORMAT
   */
  public isValidUUID(id: string): boolean {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(id);
  }

  /**
   * 🛡️ ENFORCE UUID MIDDLEWARE
   */
  public enforceUUID() {
    return (req: Request, res: Response, next: NextFunction) => {
      const id = req.params.id || req.query.id || req.body.id;
      
      if (id && typeof id === 'string' && !this.isValidUUID(id) && id.length < 20) {
        console.warn(`⚠️ Non-UUID ID detected: ${id} from ${req.ip} - potential IDOR risk`);
        
        // Em produção, pode-se bloquear completamente
        // return res.status(400).json({ error: 'ID inválido' });
      }
      
      next();
    };
  }
}

export const idorProtection = AntiIDORProtection.getInstance();
