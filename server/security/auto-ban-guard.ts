// 🛡️ AUTO-BAN GUARD - Middleware de bloqueio automático baseado em incidentes
// Integra com SecurityResponseService para bloquear IPs automaticamente

import { Request, Response, NextFunction } from 'express';
import { securityResponseService, recordPentestTool, recordPythonScanner, recordMaliciousBot } from './security-response-service';

// 🔍 ASSINATURAS DE FERRAMENTAS DE PENTEST E SCANNERS
const PENTEST_SIGNATURES = {
  // Burp Suite
  burp: [
    /burp/i,
    /portswigger/i,
    /collaborator/i,
    /oastify\.com/i,
    /burpcollaborator/i
  ],
  
  // Python Scanners
  python: [
    /^python-requests/i,
    /^python-urllib/i,
    /^python-httpx/i,
    /^aiohttp/i,
    /^httpx\//i,
    /^scrapy/i,
    /^beautifulsoup/i,
    /^mechanize/i,
    /^requests\//i
  ],
  
  // Security Scanners
  scanners: [
    /nikto/i,
    /nmap/i,
    /masscan/i,
    /sqlmap/i,
    /wpscan/i,
    /dirbuster/i,
    /dirb\//i,
    /gobuster/i,
    /feroxbuster/i,
    /wfuzz/i,
    /nuclei/i,
    /httpx/i,
    /aquatone/i,
    /whatweb/i,
    /joomscan/i,
    /droopescan/i,
    /acunetix/i,
    /nessus/i,
    /qualys/i,
    /openvas/i,
    /w3af/i,
    /zaproxy/i,
    /owasp.*zap/i
  ],
  
  // Automation Tools
  automation: [
    /selenium/i,
    /puppeteer/i,
    /playwright/i,
    /phantomjs/i,
    /headless/i,
    /chromedriver/i,
    /webdriver/i
  ],
  
  // CLI Tools
  cli: [
    /^curl\//i,
    /^wget\//i,
    /^httpie/i,
    /^lynx\//i,
    /^libwww-perl/i,
    /^java\//i,
    /^go-http-client/i,
    /^ruby/i,
    /^node-fetch/i,
    /^axios\//i,
    /^got\//i,
    /^undici/i
  ],
  
  // Malicious Bots
  maliciousBots: [
    /semrush/i,
    /ahrefsbot/i,
    /mj12bot/i,
    /dotbot/i,
    /blexbot/i,
    /petalbot/i,
    /bytespider/i,
    /dataforseo/i,
    /serpstatbot/i,
    /barkrowler/i
  ],
  
  // Meta/Facebook Bots (can be legitimate but monitor)
  metaBots: [
    /facebookexternalhit/i,
    /facebookcatalog/i,
    /facebook.*scraper/i,
    /meta-externalagent/i
  ]
};

// 🔍 DETECTAR TIPO DE FERRAMENTA/BOT
function detectToolType(userAgent: string): { 
  detected: boolean; 
  type: 'pentest' | 'python' | 'scanner' | 'automation' | 'cli' | 'malicious_bot' | 'meta_bot' | null;
  signature: string | null;
} {
  if (!userAgent) {
    return { detected: false, type: null, signature: null };
  }

  // Verificar Burp Suite
  for (const pattern of PENTEST_SIGNATURES.burp) {
    if (pattern.test(userAgent)) {
      return { detected: true, type: 'pentest', signature: `Burp Suite: ${pattern}` };
    }
  }

  // Verificar Python Scanners
  for (const pattern of PENTEST_SIGNATURES.python) {
    if (pattern.test(userAgent)) {
      return { detected: true, type: 'python', signature: `Python Scanner: ${pattern}` };
    }
  }

  // Verificar Security Scanners
  for (const pattern of PENTEST_SIGNATURES.scanners) {
    if (pattern.test(userAgent)) {
      return { detected: true, type: 'scanner', signature: `Security Scanner: ${pattern}` };
    }
  }

  // Verificar Automation Tools
  for (const pattern of PENTEST_SIGNATURES.automation) {
    if (pattern.test(userAgent)) {
      return { detected: true, type: 'automation', signature: `Automation Tool: ${pattern}` };
    }
  }

  // Verificar CLI Tools (menor prioridade - podem ser legítimos)
  for (const pattern of PENTEST_SIGNATURES.cli) {
    if (pattern.test(userAgent)) {
      return { detected: true, type: 'cli', signature: `CLI Tool: ${pattern}` };
    }
  }

  // Verificar Malicious Bots
  for (const pattern of PENTEST_SIGNATURES.maliciousBots) {
    if (pattern.test(userAgent)) {
      return { detected: true, type: 'malicious_bot', signature: `Malicious Bot: ${pattern}` };
    }
  }

  // Verificar Meta Bots (apenas monitorar, não bloquear)
  for (const pattern of PENTEST_SIGNATURES.metaBots) {
    if (pattern.test(userAgent)) {
      return { detected: true, type: 'meta_bot', signature: `Meta Bot: ${pattern}` };
    }
  }

  return { detected: false, type: null, signature: null };
}

// 🔍 EXTRAIR E NORMALIZAR IP REAL
function getClientIP(req: Request): string {
  let ip = (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
  
  // Normalizar: remover prefixo IPv6-mapped
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  return ip;
}

// 🔓 VERIFICAR SE É IP INTERNO (WHITELIST EXPANDIDA)
function isInternalIP(ip: string): boolean {
  if (!ip) return false;
  
  // Normalizar primeiro
  let normalizedIP = ip;
  if (normalizedIP.startsWith('::ffff:')) {
    normalizedIP = normalizedIP.substring(7);
  }
  
  return (
    normalizedIP === '127.0.0.1' ||
    normalizedIP === '::1' ||
    normalizedIP === 'localhost' ||
    normalizedIP.startsWith('10.') ||
    normalizedIP.startsWith('172.16.') ||
    normalizedIP.startsWith('172.17.') ||
    normalizedIP.startsWith('172.18.') ||
    normalizedIP.startsWith('172.19.') ||
    normalizedIP.startsWith('172.20.') ||
    normalizedIP.startsWith('172.21.') ||
    normalizedIP.startsWith('172.22.') ||
    normalizedIP.startsWith('172.23.') ||
    normalizedIP.startsWith('172.24.') ||
    normalizedIP.startsWith('172.25.') ||
    normalizedIP.startsWith('172.26.') ||
    normalizedIP.startsWith('172.27.') ||
    normalizedIP.startsWith('172.28.') ||
    normalizedIP.startsWith('172.29.') ||
    normalizedIP.startsWith('172.30.') ||
    normalizedIP.startsWith('172.31.') ||
    normalizedIP.startsWith('192.168.') ||
    normalizedIP.startsWith('160.20.') ||  // Replit infrastructure subnet
    normalizedIP.startsWith('100.64.') ||  // Replit CGNAT
    normalizedIP.includes('replit') ||
    normalizedIP.includes('janeway') ||
    normalizedIP.includes('picard')
  );
}

// 🔧 VERIFICAR SE ESTÁ EM AMBIENTE DE DESENVOLVIMENTO
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

// 🔑 VERIFICAR SE REQUISIÇÃO TEM API KEY VÁLIDA (bypass completo de segurança)
function hasValidApiKey(req: Request): boolean {
  const keyHeader = req.headers['x-api-key'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  const key = keyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);
  return !!(key && (key.startsWith('vp_live_') || key.startsWith('vp_test_')));
}

// 🛡️ MIDDLEWARE PRINCIPAL - AUTO-BAN GUARD
export const autoBanGuard = (req: Request, res: Response, next: NextFunction) => {
  const ip = getClientIP(req);
  const userAgent = req.headers['user-agent'] || '';
  const endpoint = req.path;

  // 0️⃣ WHITELIST - NÃO BLOQUEAR IPS INTERNOS (localhost, Replit, dev)
  if (isInternalIP(ip)) {
    return next();
  }

  // 0️⃣-B WHITELIST - NÃO BLOQUEAR REQUISIÇÕES COM API KEY VÁLIDA
  if (hasValidApiKey(req)) {
    return next();
  }

  // 1️⃣ VERIFICAR SE IP JÁ ESTÁ BANIDO
  const banStatus = securityResponseService.isIPBanned(ip);
  if (banStatus.banned) {
    console.log(`🚫 BLOCKED by AutoBanGuard: IP=${ip} Reason=${banStatus.reason || 'Banned'}`);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP has been temporarily blocked due to suspicious activity',
      code: 'IP_BANNED',
      expiresAt: banStatus.expiresAt
    });
  }

  // 2️⃣ DETECTAR FERRAMENTAS SUSPEITAS (APENAS EM PRODUÇÃO)
  // Em desenvolvimento, não penalizar automação (Vite, HMR, etc)
  if (isDevelopment()) {
    return next();
  }

  const detection = detectToolType(userAgent);
  
  if (detection.detected && detection.type) {
    // Registrar incidente baseado no tipo
    switch (detection.type) {
      case 'pentest':
        recordPentestTool(ip, detection.signature || userAgent, endpoint, userAgent);
        break;
      
      case 'python':
        // Python HTTP libs são usadas em integrações legítimas de API — apenas logar
        console.log(`🐍 PYTHON UA detected: IP=${ip} UA=${userAgent.substring(0, 100)} endpoint=${endpoint}`);
        break;
      
      case 'scanner':
        recordPentestTool(ip, detection.signature || userAgent, endpoint, userAgent);
        break;
      
      case 'automation':
        // Automation tools são menos severos - apenas registrar
        recordPythonScanner(ip, detection.signature || userAgent, endpoint, userAgent);
        break;
      
      case 'cli':
        // CLI tools são comuns - apenas monitorar se muito frequentes
        // Não registrar incidente por padrão
        break;
      
      case 'malicious_bot':
        recordMaliciousBot(ip, detection.signature || userAgent, endpoint, userAgent);
        break;
      
      case 'meta_bot':
        // Meta bots são legítimos - apenas log
        console.log(`📊 META BOT detected: IP=${ip} UA=${userAgent.substring(0, 100)}`);
        break;
    }

    // Verificar novamente se foi banido após registrar incidente
    const newBanStatus = securityResponseService.isIPBanned(ip);
    if (newBanStatus.banned) {
      console.log(`🚫 AUTO-BANNED: IP=${ip} Type=${detection.type} Signature=${detection.signature}`);
      return res.status(403).json({
        error: 'Access denied',
        message: 'Automated access has been blocked',
        code: 'AUTOMATION_BLOCKED'
      });
    }
  }

  // 3️⃣ CONTINUAR PARA PRÓXIMO MIDDLEWARE
  next();
};

// 🔍 MIDDLEWARE PARA DETECTAR PADRÕES DE ATAQUE NO BODY/QUERY
export const attackPatternDetector = (req: Request, res: Response, next: NextFunction) => {
  const ip = getClientIP(req);
  const endpoint = req.path;
  const userAgent = req.headers['user-agent'] || '';
  
  // Converter body e query para string para análise
  const bodyStr = JSON.stringify(req.body || {});
  const queryStr = JSON.stringify(req.query || {});
  const fullPayload = `${bodyStr}${queryStr}`;

  // 🔍 SQL INJECTION PATTERNS
  const sqlPatterns = [
    /'\s*(or|and)\s*'?\d*\s*=\s*'?\d*/i,
    /'\s*(or|and)\s*'[^']*'\s*=\s*'[^']*'/i,
    /union\s+(all\s+)?select/i,
    /select\s+.*\s+from\s+/i,
    /insert\s+into\s+/i,
    /update\s+.*\s+set\s+/i,
    /delete\s+from\s+/i,
    /drop\s+(table|database)/i,
    /exec(\s+|\()/i,
    /xp_cmdshell/i,
    /;\s*--/,
    /\/\*.*\*\//,
    /benchmark\s*\(/i,
    /sleep\s*\(/i,
    /waitfor\s+delay/i
  ];

  // 🔍 XSS PATTERNS
  const xssPatterns = [
    /<script[^>]*>/i,
    /<\/script>/i,
    /javascript:/i,
    /on(load|error|click|mouse|focus|blur)\s*=/i,
    /<img[^>]*onerror/i,
    /<svg[^>]*onload/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /document\.(cookie|location|write)/i,
    /window\.(location|open)/i,
    /eval\s*\(/i,
    /alert\s*\(/i,
    /prompt\s*\(/i,
    /confirm\s*\(/i
  ];

  // 🔍 COMMAND INJECTION PATTERNS
  const cmdPatterns = [
    /;\s*(ls|cat|rm|wget|curl|nc|bash|sh|python|perl|ruby)/i,
    /\|\s*(ls|cat|rm|wget|curl|nc|bash|sh)/i,
    /`[^`]*`/,
    /\$\([^)]*\)/,
    /\$\{[^}]*\}/,
    /&&\s*(ls|cat|rm|wget|curl)/i,
    /\|\|\s*(ls|cat|rm|wget|curl)/i
  ];

  // 🔍 PATH TRAVERSAL PATTERNS
  const pathPatterns = [
    /\.\.\//,
    /\.\.\\/, 
    /%2e%2e%2f/i,
    /%2e%2e\//i,
    /\.\.%2f/i,
    /etc\/passwd/i,
    /etc\/shadow/i,
    /windows\/system32/i,
    /boot\.ini/i
  ];

  // Verificar cada tipo de ataque
  for (const pattern of sqlPatterns) {
    if (pattern.test(fullPayload)) {
      const { recordSQLInjection } = require('./security-response-service');
      recordSQLInjection(ip, fullPayload.substring(0, 200), endpoint, userAgent);
      console.log(`🚨 SQL INJECTION detected: IP=${ip} Pattern=${pattern}`);
      return res.status(403).json({
        error: 'Invalid request',
        code: 'MALICIOUS_PAYLOAD'
      });
    }
  }

  for (const pattern of xssPatterns) {
    if (pattern.test(fullPayload)) {
      const { recordXSSAttempt } = require('./security-response-service');
      recordXSSAttempt(ip, fullPayload.substring(0, 200), endpoint, userAgent);
      console.log(`🚨 XSS ATTEMPT detected: IP=${ip} Pattern=${pattern}`);
      return res.status(403).json({
        error: 'Invalid request',
        code: 'MALICIOUS_PAYLOAD'
      });
    }
  }

  for (const pattern of cmdPatterns) {
    if (pattern.test(fullPayload)) {
      const { recordCommandInjection } = require('./security-response-service');
      recordCommandInjection(ip, fullPayload.substring(0, 200), endpoint, userAgent);
      console.log(`🚨 COMMAND INJECTION detected: IP=${ip} Pattern=${pattern}`);
      return res.status(403).json({
        error: 'Invalid request',
        code: 'MALICIOUS_PAYLOAD'
      });
    }
  }

  for (const pattern of pathPatterns) {
    if (pattern.test(fullPayload) || pattern.test(endpoint)) {
      securityResponseService.recordIncident(ip, 'path_traversal', fullPayload.substring(0, 200), endpoint, userAgent);
      console.log(`🚨 PATH TRAVERSAL detected: IP=${ip} Pattern=${pattern}`);
      return res.status(403).json({
        error: 'Invalid request',
        code: 'MALICIOUS_PAYLOAD'
      });
    }
  }

  next();
};

// 📊 ENDPOINT PARA MÉTRICAS DE SEGURANÇA
export function getSecurityMetrics() {
  return securityResponseService.getMetrics();
}

export default autoBanGuard;
