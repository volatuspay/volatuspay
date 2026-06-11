/**
 * 🛡️ ANTI-PRIVILEGE ESCALATION PROTECTION
 * Proteção ultra-avançada contra escalação de privilégios
 * - RBAC (Role-Based Access Control) validation
 * - Parameter tampering detection
 * - Horizontal/Vertical escalation prevention
 * - Admin function protection
 */

import { Request, Response, NextFunction } from 'express';
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
    customClaims?: {
      admin?: boolean;
      seller?: boolean;
      role?: string;
      permissions?: string[];
    };
  };
}

export class AntiPrivilegeEscalation {
  private static instance: AntiPrivilegeEscalation;

  public static getInstance(): AntiPrivilegeEscalation {
    if (!AntiPrivilegeEscalation.instance) {
      AntiPrivilegeEscalation.instance = new AntiPrivilegeEscalation();
    }
    return AntiPrivilegeEscalation.instance;
  }

  /**
   * 🚫 CAMPOS PROTEGIDOS CONTRA MASS ASSIGNMENT
   */
  private readonly protectedFields = [
    'role',
    'isAdmin',
    'admin',
    'permissions',
    'customClaims',
    'isSuperAdmin',
    'isRoot',
    'privileges',
    'access_level',
    'user_type',
    'account_type',
    '__proto__',
    'constructor',
    'prototype',
    'password_hash',
    'salt',
    'apiKey',
    'secretKey',
    'token',
    'balance',
    'credit',
    'points'
  ];

  /**
   * 🔍 PADRÕES DE ESCALAÇÃO DE PRIVILÉGIO
   */
  private readonly escalationPatterns = {
    // Tentativas de modificar role/permissions
    roleManipulation: /(role|admin|permission|privilege|access)[\s]*[=:]/gi,
    
    // Tentativas de bypass de autenticação
    authBypass: /(auth|login|session)[\s]*[=:]\s*(true|1|admin)/gi,
    
    // Tentativas de modificar IDs de usuário
    userIdManipulation: /(user_?id|uid|account_?id)[\s]*[=:]/gi,
    
    // SQL-based privilege escalation
    sqlPrivEsc: /(UPDATE|INSERT).*?(role|admin|permission)/gi,
    
    // Cookie/Session tampering
    sessionTampering: /(session|cookie).*?(admin|role|permission)/gi
  };

  /**
   * 🛡️ DETECTAR TENTATIVA DE ESCALAÇÃO
   */
  public detectEscalation(input: any): boolean {
    const inputStr = JSON.stringify(input).toLowerCase();
    
    return Object.values(this.escalationPatterns).some(pattern => 
      pattern.test(inputStr)
    );
  }

  /**
   * 🧹 REMOVER CAMPOS PROTEGIDOS (Mass Assignment Protection)
   */
  public stripProtectedFields(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.stripProtectedFields(item));
    }

    const cleaned: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      const keyLower = key.toLowerCase();
      
      // Verificar se é campo protegido
      if (this.protectedFields.some(field => keyLower.includes(field.toLowerCase()))) {
        console.warn(`⚠️ Protected field stripped: ${key}`);
        continue;
      }
      
      // Recursivamente limpar objetos aninhados
      if (typeof value === 'object' && value !== null) {
        cleaned[key] = this.stripProtectedFields(value);
      } else {
        cleaned[key] = value;
      }
    }
    
    return cleaned;
  }

  /**
   * 🚫 MIDDLEWARE DE PROTEÇÃO MASS ASSIGNMENT
   */
  public massAssignmentProtection() {
    // Rotas legítimas que precisam enviar campos como role/permissions
    const adminTeamRoutes = [
      '/api/admin/team',
      // Integrations: API keys usam campo 'permissions' para escopos da chave (não privilégios de usuário)
      '/api/integrations/api-keys',
    ];

    return (req: Request, res: Response, next: NextFunction) => {
      // Whitelist: rotas no allowlist podem enviar role e permissions
      const isAdminTeamRoute = adminTeamRoutes.some(r => req.path.startsWith(r));

      if (req.body && typeof req.body === 'object') {
        const original = { ...req.body };

        if (isAdminTeamRoute) {
          // Para rotas admin de equipe: remover apenas campos realmente perigosos
          // mas permitir role e permissions (necessários para criar/atualizar cargos)
          const dangerousOnly = ['__proto__', 'constructor', 'prototype', 'password_hash', 'salt'];
          const cleaned: any = {};
          for (const [key, value] of Object.entries(req.body)) {
            if (!dangerousOnly.includes(key.toLowerCase())) {
              cleaned[key] = value;
            }
          }
          req.body = cleaned;
        } else {
          req.body = this.stripProtectedFields(req.body);
          // Log se algo foi removido
          const removed = Object.keys(original).filter(key => !(key in req.body));
          if (removed.length > 0) {
            console.warn(`⚠️ MASS ASSIGNMENT ATTEMPT from ${req.ip}: Removed fields ${removed.join(', ')} - Bloqueado mas não banido permanentemente`);
          }
        }
      }
      
      next();
    };
  }

  /**
   * 🔐 VALIDAR RBAC (Role-Based Access Control)
   */
  public requireRole(allowedRoles: string[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const userRole = req.authUser?.customClaims?.role || 'user';
      
      if (!allowedRoles.includes(userRole)) {
        console.warn(`⚠️ RBAC VIOLATION: User ${req.authUser?.uid} (role: ${userRole}) attempted to access ${req.path} requiring roles: ${allowedRoles.join(', ')} - Bloqueado mas não banido`);
        
        // ❌ NÃO BLOQUEAR IP PERMANENTEMENTE - pode ser navegação legítima ou erro no frontend
        // Apenas negar acesso sem punição severa
        
        return res.status(403).json({
          success: false,
          error: 'Permissões insuficientes'
        });
      }
      
      next();
    };
  }

  /**
   * 🔒 VALIDAR PERMISSÕES ESPECÍFICAS
   */
  public requirePermission(permission: string) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const permissions = req.authUser?.customClaims?.permissions || [];
      
      if (!permissions.includes(permission)) {
        console.error(`🚨 PERMISSION VIOLATION: User ${req.authUser?.uid} attempted ${permission} on ${req.path}`);
        
        return res.status(403).json({
          success: false,
          error: 'Permissão necessária não encontrada'
        });
      }
      
      next();
    };
  }

  /**
   * 🛡️ PREVENIR ESCALAÇÃO HORIZONTAL
   * (Usuário acessando recursos de outro usuário do mesmo nível)
   */
  public preventHorizontalEscalation() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const currentUserId = req.authUser?.uid || req.user?.uid;
      const targetUserId = req.params.userId || req.body.userId || req.query.userId;
      
      if (targetUserId && currentUserId !== targetUserId) {
        // Permitir apenas se for admin
        const isAdmin = req.authUser?.customClaims?.admin === true;
        
        if (!isAdmin) {
          console.warn(`⚠️ HORIZONTAL ACCESS ATTEMPT: User ${currentUserId} tried to access user ${targetUserId} data - Bloqueado mas não banido permanentemente`);
          
          // ❌ NÃO BLOQUEAR IP PERMANENTEMENTE - pode ser navegação legítima
          // Apenas negar acesso sem punição
          
          return res.status(403).json({
            success: false,
            error: 'Acesso negado - você só pode acessar seus próprios dados'
          });
        }
      }
      
      next();
    };
  }

  /**
   * 🔐 PREVENIR ESCALAÇÃO VERTICAL
   * (Usuário tentando acessar funções administrativas)
   */
  public preventVerticalEscalation() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const isAdmin = req.authUser?.customClaims?.admin === true;
      
      // Paths administrativos protegidos
      const adminPaths = [
        '/admin/',
        '/api/admin/',
        '/api/users/promote',
        '/api/roles',
        '/api/permissions',
        '/api/system'
      ];
      
      const isAdminPath = adminPaths.some(path => req.path.startsWith(path));
      
      if (isAdminPath && !isAdmin) {
        console.warn(`⚠️ VERTICAL ACCESS ATTEMPT: Non-admin user ${req.authUser?.uid} tried to access admin path: ${req.path} - Bloqueado mas não banido`);
        
        // ❌ NÃO BLOQUEAR IP PERMANENTEMENTE - pode ser navegação acidental
        // Apenas negar acesso sem punição severa
        
        return res.status(403).json({
          success: false,
          error: 'Acesso administrativo necessário'
        });
      }
      
      next();
    };
  }

  /**
   * 🚨 DETECTAR PARAMETER TAMPERING
   */
  public parameterTamperingDetector() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      // Verificar tentativas suspeitas de manipulação
      const suspiciousParams = [
        'isAdmin', 'admin', 'role', 'permissions',
        'userId', 'user_id', 'uid', 'account_id',
        'price', 'amount', 'balance', 'credit',
        'status', 'approved', 'verified'
      ];

      const checkParams = (params: any, source: string) => {
        if (typeof params !== 'object' || params === null) return;
        
        for (const key of Object.keys(params)) {
          if (suspiciousParams.some(sp => key.toLowerCase().includes(sp.toLowerCase()))) {
            console.warn(`⚠️ PARAMETER TAMPERING DETECTED: ${source}.${key} = ${params[key]} from user ${req.authUser?.uid}`);
          }
        }
      };

      checkParams(req.query, 'query');
      checkParams(req.body, 'body');
      checkParams(req.params, 'params');

      next();
    };
  }

  /**
   * 🔍 VALIDAR MODIFICAÇÃO DE PREÇO/VALOR
   */
  public priceManipulationProtector() {
    return (req: Request, res: Response, next: NextFunction) => {
      const priceFields = ['price', 'amount', 'total', 'value', 'cost', 'balance'];
      
      const checkPriceManipulation = (obj: any, path: string = '') => {
        if (typeof obj === 'object' && obj !== null) {
          for (const [key, value] of Object.entries(obj)) {
            if (priceFields.includes(key.toLowerCase())) {
              // Valores negativos ou zeros são suspeitos
              if (typeof value === 'number' && value <= 0) {
                console.error(`🚨 PRICE MANIPULATION: ${path}.${key} = ${value} from ${req.ip}`);
                return true;
              }
              
              // Valores extremamente altos são suspeitos
              if (typeof value === 'number' && value > 1000000) {
                console.error(`🚨 PRICE MANIPULATION: ${path}.${key} = ${value} (too high) from ${req.ip}`);
                return true;
              }
            }
          }
        }
        return false;
      };

      if (checkPriceManipulation(req.body, 'body') || checkPriceManipulation(req.query, 'query')) {
        return res.status(400).json({
          success: false,
          error: 'Valor inválido detectado'
        });
      }

      next();
    };
  }

  /**
   * 🔐 AUDIT LOG PARA OPERAÇÕES SENSÍVEIS
   */
  public auditSensitiveOperations() {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const sensitiveOps = [
        'DELETE', 'PUT', 'PATCH'
      ];

      const sensitivePaths = [
        '/users/', '/admin/', '/roles/', '/permissions/',
        '/balance/', '/withdrawal/', '/payment/'
      ];

      if (sensitiveOps.includes(req.method) || 
          sensitivePaths.some(path => req.path.includes(path))) {
        
        console.log(`🔍 AUDIT: ${req.method} ${req.path} by user ${req.authUser?.uid} from ${req.ip}`);
      }

      next();
    };
  }
}

export const privilegeProtection = AntiPrivilegeEscalation.getInstance();
