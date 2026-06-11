/**
 * 🛡️ CSRF PROTECTION - Cross-Site Request Forgery
 * Sistema completo de proteção CSRF com tokens baseados em sessão
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface CSRFToken {
  token: string;
  uid: string;
  origin: string;
  expiresAt: number;
}

// 🔐 ARMAZENAMENTO EM MEMÓRIA DOS TOKENS CSRF
const csrfTokens = new Map<string, CSRFToken>();

// 🧹 CLEANUP DE TOKENS EXPIRADOS (a cada 5 minutos)
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  
  for (const [token, data] of csrfTokens.entries()) {
    if (data.expiresAt < now) {
      csrfTokens.delete(token);
      removed++;
    }
  }
  
  if (removed > 0) {
    console.log(`🧹 CSRF cleanup: ${removed} tokens expirados removidos`);
  }
}, 5 * 60 * 1000);

/**
 * 🎯 GERAR TOKEN CSRF
 */
export function generateCSRFToken(
  uid: string,
  origin: string,
  options?: {
    expiryMinutes?: number;
  }
): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (options?.expiryMinutes || 60) * 60 * 1000; // 60 min padrão

  csrfTokens.set(token, {
    token,
    uid,
    origin,
    expiresAt
  });

  console.log(`🔐 CSRF token gerado para user ${uid} (expira em ${options?.expiryMinutes || 60}min)`);
  
  return token;
}

/**
 * 🔍 VALIDAR TOKEN CSRF
 */
export function validateCSRFToken(
  token: string,
  uid: string,
  origin: string
): boolean {
  const csrfData = csrfTokens.get(token);

  if (!csrfData) {
    console.warn(`❌ CSRF token não encontrado: ${token.substring(0, 8)}...`);
    return false;
  }

  // Verificar expiração
  if (csrfData.expiresAt < Date.now()) {
    console.warn(`❌ CSRF token expirado`);
    csrfTokens.delete(token);
    return false;
  }

  // Verificar UID
  if (csrfData.uid !== uid) {
    console.warn(`❌ CSRF token UID mismatch: esperado ${csrfData.uid}, recebido ${uid}`);
    return false;
  }

  // Verificar origin (flexível para dev/prod)
  const normalizedOrigin = origin?.toLowerCase().replace(/\/$/, '');
  const normalizedStored = csrfData.origin?.toLowerCase().replace(/\/$/, '');

  if (normalizedOrigin !== normalizedStored) {
    console.warn(`❌ CSRF origin mismatch: esperado ${csrfData.origin}, recebido ${origin}`);
    return false;
  }

  console.log(`✅ CSRF token válido para user ${uid}`);
  return true;
}

/**
 * 🔐 MIDDLEWARE: PROTEÇÃO CSRF
 * Aplica em rotas POST/PUT/PATCH/DELETE que mudam estado
 */
export function requireCSRF(
  req: any,
  res: Response,
  next: NextFunction
) {
  try {
    const uid = req.authUser?.uid || req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Autenticação necessária',
        code: 'NO_AUTH'
      });
    }

    // 🎯 Extrair token CSRF do header ou body
    const csrfToken = req.headers['x-csrf-token'] || req.body._csrf;

    if (!csrfToken) {
      console.warn(`❌ CSRF token ausente de ${req.ip}`);
      return res.status(403).json({
        success: false,
        error: 'Token CSRF ausente',
        code: 'NO_CSRF_TOKEN'
      });
    }

    // 🌐 Validar Origin/Referer para proteção adicional
    const origin = req.headers.origin || req.headers.referer;
    
    if (!origin) {
      console.warn(`❌ Origin/Referer ausente de ${req.ip}`);
      return res.status(403).json({
        success: false,
        error: 'Origin inválido',
        code: 'NO_ORIGIN'
      });
    }

    // ✅ Validar token CSRF
    const isValid = validateCSRFToken(csrfToken as string, uid, origin as string);

    if (!isValid) {
      console.error(`🚨 CSRF ATTACK BLOCKED: Invalid token from ${req.ip} for user ${uid}`);
      return res.status(403).json({
        success: false,
        error: 'Token CSRF inválido ou expirado',
        code: 'INVALID_CSRF_TOKEN'
      });
    }

    // ✅ Token válido, prosseguir
    next();
  } catch (error) {
    console.error(`❌ CSRF validation error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro na validação CSRF'
    });
  }
}

/**
 * 🌐 VALIDAR ORIGIN/REFERER - Proteção adicional
 */
export function validateOrigin(
  allowedOrigins: string[]
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin || req.headers.referer;

    if (!origin) {
      // Permitir requisições sem origin em alguns casos (Postman, etc.)
      const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      
      if (isStateChanging) {
        console.warn(`⚠️ State-changing request without origin from ${req.ip}`);
        return res.status(403).json({
          success: false,
          error: 'Origin requerido para esta operação'
        });
      }
      
      return next();
    }

    // Normalizar origin
    const normalizedOrigin = origin.toLowerCase().replace(/\/$/, '');
    
    // Verificar se está na lista de permitidos
    const isAllowed = allowedOrigins.some(allowed => {
      const normalizedAllowed = allowed.toLowerCase().replace(/\/$/, '');
      return normalizedOrigin.includes(normalizedAllowed) || 
             normalizedOrigin.startsWith(normalizedAllowed);
    });

    if (!isAllowed) {
      console.warn(`❌ Invalid origin: ${origin} from ${req.ip}`);
      return res.status(403).json({
        success: false,
        error: 'Origin não autorizado'
      });
    }

    next();
  };
}

/**
 * 📊 ENDPOINT: OBTER TOKEN CSRF
 * GET /api/csrf
 */
export const getCSRFToken = (req: any, res: Response) => {
  try {
    const uid = req.authUser?.uid || req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Autenticação necessária'
      });
    }

    const origin = req.headers.origin || req.headers.referer || 'unknown';
    const token = generateCSRFToken(uid, origin as string, {
      expiryMinutes: 60 // 1 hora
    });

    return res.json({
      success: true,
      csrfToken: token,
      expiresIn: 3600 // segundos
    });
  } catch (error) {
    console.error(`❌ Error generating CSRF token:`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar token CSRF'
    });
  }
};

/**
 * 🧹 CLEANUP MANUAL DE TOKENS (para testes)
 */
export function clearCSRFTokens(uid?: string): number {
  if (!uid) {
    const size = csrfTokens.size;
    csrfTokens.clear();
    console.log(`🧹 Todos os ${size} tokens CSRF limpos`);
    return size;
  }

  let removed = 0;
  for (const [token, data] of csrfTokens.entries()) {
    if (data.uid === uid) {
      csrfTokens.delete(token);
      removed++;
    }
  }
  
  console.log(`🧹 ${removed} tokens CSRF removidos para user ${uid}`);
  return removed;
}

/**
 * 📊 ESTATÍSTICAS DOS TOKENS CSRF
 */
export function getCSRFStats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;

  for (const data of csrfTokens.values()) {
    if (data.expiresAt > now) {
      active++;
    } else {
      expired++;
    }
  }

  return {
    total: csrfTokens.size,
    active,
    expired
  };
}
