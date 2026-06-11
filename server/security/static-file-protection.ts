// 🛡️ PROTEÇÃO DEVASTADORA DE ARQUIVOS ESTÁTICOS SENSÍVEIS
// Bloqueia acesso a pastas e arquivos sensíveis que nunca devem ser expostos

import { Request, Response, NextFunction } from 'express';
import path from 'path';

// 📁 DIRETÓRIOS E ARQUIVOS PROIBIDOS - NUNCA DEVEM SER ACESSÍVEIS
const FORBIDDEN_PATHS = [
  '/server',
  '/server/',
  '/certs',
  '/certs/',
  '/attached_assets',
  '/attached_assets/',
  '/.env',
  '/.env.local',
  '/.env.production',
  '/firebase-service-account.json',
  '/service-account.json',
  '/config.json',
  '/credentials.json',
  '/secrets.json',
  '/private.key',
  '/certificate.p12',
  '/database.db',
  '/backup.sql',
  '/.git',
  '/.git/',
  '/node_modules',
  '/node_modules/',
  '/package-lock.json',
  '/yarn.lock',
  '/tsconfig.json',
  '/webpack.config.js',
  '/vite.config.ts',
  '/rollup.config.js',
  '/.vscode',
  '/.vscode/',
  '/.idea',
  '/.idea/',
  '/logs',
  '/logs/',
  '/tmp',
  '/tmp/',
  '/temp',
  '/temp/',
  '/cache',
  '/cache/',
  '/backup',
  '/backup/',
  '/backups',
  '/backups/',
  '/uploads/private',
  '/uploads/private/',
  '/admin/config',
  '/admin/config/',
  '/system',
  '/system/',
  '/internal',
  '/internal/',
  '/api/internal',
  '/api/internal/',
  '/debug',
  '/debug/',
  '/test',
  '/test/',
  '/testing',
  '/testing/'
];

// 🔍 EXTENSÕES DE ARQUIVOS SENSÍVEIS
const FORBIDDEN_EXTENSIONS = [
  '.p12',
  '.pem',
  '.key',
  '.crt',
  '.pfx',
  '.jks',
  '.keystore',
  '.db',
  '.sqlite',
  '.sql',
  '.bak',
  '.backup',
  '.log',
  '.tmp',
  '.temp',
  '.env',
  '.config',
  '.conf',
  '.ini',
  '.properties',
  '.secret',
  '.credential',
  '.auth',
  '.token',
  '.session',
  '.cache'
];

// 📝 PADRÕES SUSPEITOS DE NOMES DE ARQUIVOS (APENAS ARQUIVOS REALMENTE PERIGOSOS)
const SUSPICIOUS_PATTERNS = [
  // DESABILITADO: Bloquear apenas arquivos realmente perigosos, não componentes do próprio sistema
  // /admin[-_]?config/i,      // ❌ Bloqueia componentes React legítimos
  // /database[-_]?config/i,   // ❌ Bloqueia componentes React legítimos  
  // /firebase[-_]?config/i,   // ❌ Bloqueia componentes React legítimos
  // /stripe[-_]?config/i,     // ❌ Bloqueia componentes React legítimos
  // Manter apenas padrões de ataques reais:
  /\.env$/i,                   // ✅ Arquivos .env reais
  /service[-_]?account\.json$/i, // ✅ Arquivos JSON de credenciais
  /private[-_]?key\.(pem|key)$/i, // ✅ Chaves privadas reais
  /backup\.(sql|db)$/i,        // ✅ Backups de banco
  /dump\.(sql|db)$/i           // ✅ Dumps de banco
];

// 🚫 MIDDLEWARE PRINCIPAL DE PROTEÇÃO (APENAS PRODUÇÃO)
export const staticFileProtectionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 🔓 EM DESENVOLVIMENTO, PERMITIR TUDO PARA VITE HOT RELOAD
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  
  // 🔓 BYPASS: Permitir arquivos de build do Vite (/assets/*)
  // Esses são arquivos hasheados gerados pelo build que precisam ser servidos normalmente
  if (req.path.startsWith('/assets/')) {
    return next();
  }
  
  const originalUrl = req.originalUrl.toLowerCase();
  const reqPath = req.path.toLowerCase();
  
  // 1️⃣ VERIFICAR CAMINHOS PROIBIDOS
  for (const forbiddenPath of FORBIDDEN_PATHS) {
    if (originalUrl.startsWith(forbiddenPath) || reqPath.startsWith(forbiddenPath)) {
      console.log(`🚫 ACESSO BLOQUEADO A CAMINHO SENSÍVEL: ${req.ip} tentou acessar ${req.originalUrl}`);
      
      // Log detalhado do ataque
      console.log(`🔍 Detalhes do bloqueio:`, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'This resource is not accessible',
        code: 'FORBIDDEN_PATH'
      });
    }
  }
  
  // 2️⃣ VERIFICAR EXTENSÕES PROIBIDAS
  const fileExtension = path.extname(originalUrl).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.includes(fileExtension)) {
    console.log(`🚫 EXTENSÃO BLOQUEADA: ${req.ip} tentou acessar arquivo ${fileExtension}: ${req.originalUrl}`);
    
    return res.status(403).json({
      error: 'Access denied',
      message: 'File type not allowed',
      code: 'FORBIDDEN_EXTENSION'
    });
  }
  
  // 3️⃣ VERIFICAR PADRÕES SUSPEITOS
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(originalUrl)) {
      console.log(`🚫 PADRÃO SUSPEITO DETECTADO: ${req.ip} tentou acessar ${req.originalUrl} (padrão: ${pattern})`);
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'Suspicious file pattern detected',
        code: 'SUSPICIOUS_PATTERN'
      });
    }
  }
  
  // 4️⃣ VERIFICAR TENTATIVAS DE DIRECTORY TRAVERSAL
  if (originalUrl.includes('..') || originalUrl.includes('%2e%2e') || originalUrl.includes('%252e%252e')) {
    console.log(`🚫 DIRECTORY TRAVERSAL BLOQUEADO: ${req.ip} tentou ${req.originalUrl}`);
    
    return res.status(403).json({
      error: 'Access denied',
      message: 'Directory traversal attempt detected',
      code: 'DIRECTORY_TRAVERSAL'
    });
  }
  
  // 5️⃣ VERIFICAR ENCODING MALICIOSO
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(originalUrl);
  } catch {
    decodedUrl = originalUrl;
  }
  if (decodedUrl !== originalUrl) {
    // Verificar novamente após decodificação
    for (const forbiddenPath of FORBIDDEN_PATHS) {
      if (decodedUrl.startsWith(forbiddenPath)) {
        console.log(`🚫 ENCODING MALICIOSO DETECTADO: ${req.ip} tentou ${req.originalUrl} → ${decodedUrl}`);
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'Malicious encoding detected',
          code: 'MALICIOUS_ENCODING'
        });
      }
    }
  }
  
  // ✅ CAMINHO SEGURO - PROSSEGUIR
  next();
};

// 🛡️ MIDDLEWARE ESPECÍFICO PARA UPLOADS (APENAS PRODUÇÃO)
export const uploadsProtectionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 🔓 EM DESENVOLVIMENTO, PERMITIR TUDO PARA VITE HOT RELOAD
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  
  const filePath = req.path;
  
  // Permitir apenas imagens e PDFs públicos
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.webp', '.mp4', '.webm', '.mov'];
  const fileExtension = path.extname(filePath).toLowerCase();
  
  if (!allowedExtensions.includes(fileExtension)) {
    console.log(`🚫 UPLOAD BLOQUEADO: Extensão ${fileExtension} não permitida para ${req.ip}`);
    
    return res.status(403).json({
      error: 'File type not allowed',
      message: 'Only image, video and PDF files are allowed',
      code: 'INVALID_FILE_TYPE'
    });
  }
  
  // Verificar se não é um arquivo do sistema
  if (filePath.includes('/system/') || filePath.includes('/private/') || filePath.includes('/internal/')) {
    console.log(`🚫 ACESSO A UPLOAD INTERNO BLOQUEADO: ${req.ip} tentou ${filePath}`);
    
    return res.status(403).json({
      error: 'Access denied',
      message: 'System files are not accessible',
      code: 'SYSTEM_FILE_ACCESS'
    });
  }
  
  next();
};

// 🔥 MIDDLEWARE ANTI-HOTLINKING DEVASTADOR
export const antiHotlinkingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const referer = req.headers.referer || req.headers.referrer;
  const host = req.headers.host;
  
  // Permitir acesso direto (sem referer) e do próprio domínio
  if (!referer) {
    return next();
  }
  
  try {
    const refererUrl = new URL(referer);
    const currentHost = host?.split(':')[0]; // Remove porta se presente
    
    if (refererUrl.hostname === currentHost || 
        refererUrl.hostname === 'localhost' || 
        refererUrl.hostname === '127.0.0.1' ||
        refererUrl.hostname.endsWith('.replit.dev') ||
        refererUrl.hostname.endsWith('.replit.app') ||
        refererUrl.hostname.endsWith('.repl.co') ||
        refererUrl.hostname === 'volatuspay.com' ||
        refererUrl.hostname.endsWith('.volatuspay.com') ||
        refererUrl.hostname === 'volatuspay.com' ||
        refererUrl.hostname.endsWith('.volatuspay.com')) {
      return next();
    }
    
    // Bloquear hotlinking externo
    console.log(`🚫 HOTLINKING BLOQUEADO: ${req.ip} de ${refererUrl.hostname} tentou acessar ${req.path}`);
    
    return res.status(403).json({
      error: 'Hotlinking not allowed',
      message: 'Direct access from external sites is not permitted',
      code: 'HOTLINKING_BLOCKED'
    });
    
  } catch (error) {
    // Referer inválido - permitir acesso
    return next();
  }
};

// 📊 MIDDLEWARE DE LOGGING DE SEGURANÇA
export const securityLoggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Override do método res.end para capturar status
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const processingTime = Date.now() - startTime;
    
    // ⚡ SECURITY FIX: Só logar ameaças REAIS - não navegação normal
    const suspiciousStatusCodes = [
      403, // Forbidden (tentativa de acesso não autorizado)
      405, // Method Not Allowed (tentativa de método inválido)
      413, // Payload Too Large (tentativa de sobrecarga)
      422, // Unprocessable Entity (dados maliciosos)
      429, // Too Many Requests (rate limiting - possível ataque)
      451  // Unavailable For Legal Reasons (conteúdo bloqueado)
    ];
    
    // ❌ NÃO marcar como suspeito:
    // - 400: Bad Request (pode ser erro de usuário)  
    // - 401: Unauthorized (navegação normal sem token)
    // - 404: Not Found (navegação normal)
    // - 500+: Server errors (não são tentativas de ataque)
    
    if (suspiciousStatusCodes.includes(res.statusCode)) {
      console.log(`🚨 THREAT DETECTED: ${req.ip} ${req.method} ${req.originalUrl} → ${res.statusCode} (${processingTime}ms)`, {
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
        xForwardedFor: req.headers['x-forwarded-for'],
        authorization: req.headers.authorization ? '[PRESENT]' : '[ABSENT]'
      });
    }
    
    // ℹ️ Log normal para debug (sem alertas de ameaça)
    if (res.statusCode === 401 || res.statusCode === 404) {
      console.log(`ℹ️ Normal Access: ${req.ip} ${req.method} ${req.originalUrl} → ${res.statusCode} (${processingTime}ms)`);
    }
    
    return originalEnd.call(this, chunk, encoding);
  };
  
  next();
};