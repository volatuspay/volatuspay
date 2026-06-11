// 🛡️ SISTEMA ANTI-CHEAT AVANÇADO - PROTEÇÃO MÁXIMA
// Impede injeção de HTML/JS para manipular saldos, vendas e produtos

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { isInternalIP } from './persistent-ip-blacklist.js';

// 🔐 CHAVES DE SEGURANÇA ROTATIVAS
let securityKeys = {
  current: crypto.randomBytes(32).toString('hex'),
  previous: crypto.randomBytes(32).toString('hex'),
  rotateAt: Date.now() + (15 * 60 * 1000) // Rotaciona a cada 15 min
};

// 🔄 ROTAÇÃO AUTOMÁTICA DE CHAVES
setInterval(() => {
  securityKeys.previous = securityKeys.current;
  securityKeys.current = crypto.randomBytes(32).toString('hex');
  securityKeys.rotateAt = Date.now() + (15 * 60 * 1000);
}, 15 * 60 * 1000);

// 🛡️ MIDDLEWARE ANTI-INJEÇÃO
export const antiInjectionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // 1. VERIFICAR TENTATIVAS DE INJEÇÃO HTML/JS
  const dangerousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /\son\w+\s*=/gi, // Espaço antes para evitar "affiliateOnly"
    /document\./gi,
    /window\./gi,
    /eval\(/gi,
    /setTimeout\(/gi,
    /setInterval\(/gi,
    /innerHTML/gi,
    /outerHTML/gi,
    /\.balance\s*=/gi,
    /\.saldo\s*=/gi,
    /\.amount\s*=/gi,
    /\.value\s*\+=|\*=|\-=/gi
  ];

  const checkInjection = (obj: any, path = ''): boolean => {
    if (typeof obj === 'string') {
      return dangerousPatterns.some(pattern => pattern.test(obj));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        if (checkInjection(value, `${path}.${key}`)) {
          return true;
        }
      }
    }
    
    return false;
  };

  // 2. VERIFICAR BODY, QUERY E PARAMS
  if (checkInjection(req.body) || checkInjection(req.query) || checkInjection(req.params)) {
    console.log(`📋 URL: ${req.method} ${req.originalUrl}`);
    console.log(`🕒 Timestamp: ${new Date().toISOString()}`);
    
    return res.status(403).json({
      error: 'Tentativa de injeção detectada',
      code: 'INJECTION_BLOCKED',
      timestamp: Date.now()
    });
  }

  // 3. VALIDAR TENTATIVAS DE MANIPULAÇÃO DE VALORES FINANCEIROS
  const financialFields = ['balance', 'saldo', 'amount', 'price', 'total', 'value'];
  const checkFinancialManipulation = (obj: any): boolean => {
    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        if (financialFields.includes(key.toLowerCase())) {
          if (typeof value === 'string' && (
            value.includes('999999') || 
            value.includes('999.999') ||
            parseFloat(value) > 100000 // Limite máximo suspeito
          )) {
            return true;
          }
        }
        
        if (checkFinancialManipulation(value)) return true;
      }
    }
    return false;
  };

  if (checkFinancialManipulation(req.body)) {
    return res.status(403).json({
      error: 'Manipulação de valores detectada',
      code: 'FINANCIAL_MANIPULATION',
      timestamp: Date.now()
    });
  }

  next();
};

// 🔐 GERADOR DE TOKEN SEGURO
export const generateSecureToken = (data: any): string => {
  const timestamp = Date.now();
  const payload = JSON.stringify({ ...data, timestamp });
  const signature = crypto
    .createHmac('sha256', securityKeys.current)
    .update(payload)
    .digest('hex');
  
  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64');
};

// 🔍 VALIDADOR DE TOKEN SEGURO
export const validateSecureToken = (token: string): any => {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const { payload, signature } = decoded;
    
    // Verificar com chave atual
    let validSignature = crypto
      .createHmac('sha256', securityKeys.current)
      .update(payload)
      .digest('hex');
    
    let isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(validSignature, 'hex')
    );
    
    // Se falhou, tentar com chave anterior (por causa da rotação)
    if (!isValid) {
      validSignature = crypto
        .createHmac('sha256', securityKeys.previous)
        .update(payload)
        .digest('hex');
      
      isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(validSignature, 'hex')
      );
    }
    
    if (!isValid) {
      throw new Error('Token signature invalid');
    }
    
    const data = JSON.parse(payload);
    
    // Verificar expiração (tokens válidos por 1 hora)
    if (Date.now() - data.timestamp > 60 * 60 * 1000) {
      throw new Error('Token expired');
    }
    
    return data;
  } catch (error) {
    console.log('🚨 Token inválido detectado:', error);
    return null;
  }
};

// 🛡️ MIDDLEWARE DE VALIDAÇÃO DE OPERAÇÕES CRÍTICAS
export const criticalOperationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const criticalRoutes = [
    '/api/orders',
    '/api/balances',
    '/api/products',
    '/api/admin',
    '/api/sellers',
    '/api/payment',
    '/api/support'
  ];
  
  const isCritical = criticalRoutes.some(route => req.path.startsWith(route));
  
  if (isCritical && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // 🔐 SECURITY FIX: Use dedicated X-Security-Token header instead of Authorization
    // Prevents collision with Firebase Bearer tokens
    const securityToken = req.headers['x-security-token'] as string;
    if (!securityToken) {
      return res.status(401).json({
        error: 'X-Security-Token header obrigatório para operações críticas',
        code: 'SECURITY_TOKEN_REQUIRED'
      });
    }
    
    const validatedData = validateSecureToken(securityToken);
    
    if (!validatedData) {
      return res.status(403).json({
        error: 'X-Security-Token inválido',
        code: 'INVALID_SECURITY_TOKEN'
      });
    }
    
    // 🛡️ SECURITY: Validate token is bound to current user and route
    if (req.user?.uid && validatedData.uid && validatedData.uid !== req.user.uid) {
      return res.status(403).json({
        error: 'Token de segurança não pertence ao usuário atual',
        code: 'TOKEN_USER_MISMATCH'
      });
    }
    
    // Adicionar dados validados ao request
    (req as any).securityData = validatedData;
  }
  
  next();
};

// 🚫 BLACKLIST DE IPs SUSPEITOS
const suspiciousIPs = new Set<string>();
const ipAttempts = new Map<string, { count: number, lastAttempt: number }>();

// 🟢 WHITELIST DE IPs CONFIÁVEIS (NUNCA BLOQUEADOS) - SECURITY HARDENED
const trustedIPs = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  '160.20.87.98',  // IP Replit dev - sempre confiável
  '160.20.87.146', // IP Replit dev (atual) - sempre confiável
  '179.222.188.212' // IP do admin owner - sempre confiável
  // REMOVED: 'localhost' (DNS spoofing risk), '0.0.0.0' (CRITICAL: allows any IP)
]);

// 🔵 SUBNET REPLIT: Qualquer IP 160.20.x.x é infraestrutura Replit
const isReplitSubnet = (ip: string) => /^160\.20\./.test(ip) || /^100\.64\./.test(ip);

// 🧹 LIMPEZA INICIAL: Remover IPs confiáveis da blacklist
setTimeout(() => {
  trustedIPs.forEach(ip => {
    if (suspiciousIPs.has(ip)) {
      suspiciousIPs.delete(ip);
      console.log(`🟢 IP confiável ${ip} removido da blacklist (correção)`);
    }
  });
}, 1000);

// 🔓 REMOVER IPs DO DESENVOLVEDOR DA BLACKLIST IMEDIATAMENTE
['160.20.87.98', '160.20.87.146'].forEach(devIP => {
  if (suspiciousIPs.has(devIP)) {
    suspiciousIPs.delete(devIP);
    console.log(`🟢 IP Replit ${devIP} desbloqueado e adicionado à whitelist permanente`);
  }
});

// 🔓 LIMPAR BLACKLIST (FUNÇÃO AUXILIAR)
export const clearBlacklist = () => {
  const count = suspiciousIPs.size;
  suspiciousIPs.clear();
  console.log(`🧹 Blacklist limpa: ${count} IPs removidos`);
  return count;
};

// 🔓 REMOVER IP ESPECÍFICO DA BLACKLIST
export const removeFromBlacklist = (ip: string) => {
  const removed = suspiciousIPs.delete(ip);
  if (removed) {
    console.log(`🔓 IP ${ip} removido da blacklist manualmente`);
  }
  return removed;
};

export const addSuspiciousIP = (ip: string, reason: string) => {
  // NUNCA adicionar IPs confiáveis à blacklist
  if (trustedIPs.has(ip) || isReplitSubnet(ip)) {
    console.log(`🟢 IP confiável ${ip} NÃO foi bloqueado (whitelist)`);
    return;
  }
  
  suspiciousIPs.add(ip);
  console.log(`🚫 IP ${ip} adicionado à blacklist: ${reason}`);
  
  // Remover da blacklist após 24 horas
  setTimeout(() => {
    suspiciousIPs.delete(ip);
    console.log(`✅ IP ${ip} removido da blacklist após 24h`);
  }, 24 * 60 * 60 * 1000);
};

export const checkSuspiciousIP = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // 🔓 BYPASS TOTAL PARA ADMINS: Admins nunca são bloqueados
  const isAdmin = (req as any).user?.isAdmin || (req as any).user?.admin || (req as any).authUser?.isAdmin;
  if (isAdmin) {
    // Remover admin da blacklist se estava bloqueado
    if (suspiciousIPs.has(ip)) {
      suspiciousIPs.delete(ip);
      console.log(`🔓 ADMIN IP ${ip} removido da blacklist (bypass automático)`);
    }
    return next();
  }
  
  // NUNCA bloquear IPs confiáveis (localhost, Replit, etc)
  if (trustedIPs.has(ip) || isReplitSubnet(ip)) {
    return next();
  }
  
  // ✅ WHITELIST INTELIGENTE: Verificar se é IP interno/Replit
  if (isInternalIP(ip)) {
    // Remover da blacklist se estava bloqueado
    if (suspiciousIPs.has(ip)) {
      suspiciousIPs.delete(ip);
      console.log(`🔓 IP interno ${ip} removido da blacklist (auto-correção)`);
    }
    return next();
  }
  
  if (suspiciousIPs.has(ip)) {
    console.log(`🚫 ACESSO BLOQUEADO: IP ${ip} está na blacklist`);
    return res.status(403).json({
      error: 'Acesso bloqueado',
      code: 'IP_BLACKLISTED'
    });
  }
  
  next();
};