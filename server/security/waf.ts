// 🛡️ WAF - WEB APPLICATION FIREWALL
// Camada 1: Proteção contra OWASP Top 10 e ataques conhecidos
// Defense in Depth: Primeira linha de defesa antes de chegar na aplicação

import { Request, Response, NextFunction } from 'express';

// 🎯 ASSINATURAS DE ATAQUE (OWASP TOP 10 + ADVANCED)
const WAF_SIGNATURES = {
  // SQL Injection (OWASP A03:2021)
  SQL_INJECTION: [
    /(\bUNION\b.*\bSELECT\b)/i,
    /(\bSELECT\b.*\bFROM\b)/i,
    /(\bINSERT\b.*\bINTO\b)/i,
    /(\bUPDATE\b.*\bSET\b)/i,
    /(\bDELETE\b.*\bFROM\b)/i,
    /(\bDROP\b.*\bTABLE\b)/i,
    /(\bDROP\b.*\bDATABASE\b)/i,
    /(;.*\bDROP\b)/i,
    /(\'\s*OR\s*['\"]?1['\"]?\s*=\s*['\"]?1)/i,
    /(\'\s*AND\s*['\"]?1['\"]?\s*=\s*['\"]?1)/i,
    /(\'\s*OR\s*['\"]?1['\"]?\s*--)/i,
    /(\/\*.*\*\/)/,
    /(\bxp_cmdshell\b)/i,
    /(\bSHOW\b\s+TABLES\b)/i,
    /(\bDESCRIBE\b\s+\w+\s*;)/i,
    /(\bINFORMATION_SCHEMA\b)/i,
    /(;\s*\bEXEC\b)/i,
    /(;\s*\bEXECUTE\b)/i,
  ],

  // XSS (Cross-Site Scripting) - OWASP A03:2021
  XSS: [
    /<script[^>]*>.*<\/script>/i,
    /javascript:/i,
    /\son\w+\s*=/i, // onerror=, onclick=, etc (com espaço antes para evitar "affiliateOnly")
    /<iframe[^>]*>/i,
    /<embed[^>]*>/i,
    /<object[^>]*>/i,
    /eval\s*\(/i,
    /alert\s*\(/i,
    /prompt\s*\(/i,
    /confirm\s*\(/i,
    /document\.cookie/i,
    /document\.write/i,
    /<img[^>]*onerror/i,
    /<svg[^>]*onload/i,
    /expression\s*\(/i,
    /vbscript:/i,
    /data:text\/html/i,
  ],

  // RCE (Remote Code Execution)
  RCE: [
    /(\bsystem\b.*\()/i,
    /(\bexec\b.*\()/i,
    /(\bshell_exec\b.*\()/i,
    /(\bpassthru\b.*\()/i,
    /(\bpopen\b.*\()/i,
    /(\bproc_open\b.*\()/i,
    /(\beval\b.*\()/i,
    /(\bassert\b.*\()/i,
    /(\bcreate_function\b)/i,
    /(\binclude\b.*\()/i,
    /(\brequire\b.*\()/i,
    /(base64_decode.*eval)/i,
    /(gzinflate.*eval)/i,
    /(\$\{.*\})/,
    /(\`.*\`)/,
  ],

  // Path Traversal / LFI
  PATH_TRAVERSAL: [
    /\.\.\//,
    /\.\.\\/,
    /%2e%2e%2f/i,
    /%2e%2e\\/i,
    /\.\.%2f/i,
    /\.\.%5c/i,
    /\/etc\/passwd/i,
    /\/etc\/shadow/i,
    /\/proc\/self/i,
    /\/var\/log/i,
    /c:\\windows/i,
    /c:%5cwindows/i,
    /\/\.env/i,
    /\/config\./i,
  ],

  // XXE (XML External Entity)
  XXE: [
    /<!ENTITY/i,
    /<!DOCTYPE.*\[/i,
    /SYSTEM\s+["']/i,
    /PUBLIC\s+["']/i,
    /<!ELEMENT/i,
  ],

  // SSRF (Server-Side Request Forgery)
  SSRF: [
    /localhost/i,
    /127\.0\.0\.1/,
    /0\.0\.0\.0/,
    /::1/,
    /169\.254\./,
    /192\.168\./,
    /10\.\d+\.\d+\.\d+/,
    /172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /file:\/\//i,
    /gopher:\/\//i,
    /dict:\/\//i,
  ],

  // Command Injection
  COMMAND_INJECTION: [
    /;\s*\w+/,
    /\|\s*\w+/,
    /&&\s*\w+/,
    /\$\(.*\)/,
    /`.*`/,
    />\s*\/dev\/null/,
    /2>&1/,
    /\/bin\/(bash|sh|zsh|ksh)/i,
    /cmd\.exe/i,
    /powershell/i,
  ],

  // LDAP Injection
  LDAP_INJECTION: [
    /\(\|/,
    /\(&/,
    /\(!/,
    /\*\)/,
    /\|\|/,
    /&&/,
  ],

  // Log4Shell (CVE-2021-44228)
  LOG4SHELL: [
    /\$\{jndi:/i,
    /\$\{ldap:/i,
    /\$\{rmi:/i,
    /\$\{dns:/i,
    /\$\{lower:/i,
    /\$\{upper:/i,
    /\$\{env:/i,
    /\$\{sys:/i,
  ],

  // NoSQL Injection
  NOSQL_INJECTION: [
    /\$ne\b/,
    /\$gt\b/,
    /\$lt\b/,
    /\$regex\b/,
    /\$where\b/,
    /\$exists\b/,
    /\$type\b/,
  ],

  // Prototype Pollution Advanced
  PROTOTYPE_POLLUTION: [
    /__proto__/,
    /constructor\[/i,
    /prototype\[/i,
    /\.constructor\./i,
    /\.prototype\./i,
  ],
};

// Campos que naturalmente contêm ponto-e-vírgula (User-Agent, CSS, etc.)
const SAFE_FIELDS_SKIP_CMD_INJECTION = new Set([
  'userAgent', 'user_agent', 'useragent', 'browser', 'browserVersion',
  'platform', 'os', 'device', 'language', 'timezone', 'fonts',
  'screen', 'canvas', 'referrer', 'accept', 'acceptEncoding',
]);

// 🔍 SEVERITY LEVELS
type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface ThreatDetection {
  blocked: boolean;
  severity: SeverityLevel;
  attackType: string;
  pattern: string;
  location: 'url' | 'header' | 'body' | 'cookie';
  value: string;
}

// 🛡️ WAF ENGINE
class WAFEngine {
  private enabled = true;
  private blockMode = true; // true = block, false = detect only

  // Verificar string contra assinaturas
  private checkSignatures(input: string, signatures: RegExp[]): RegExp | null {
    for (const pattern of signatures) {
      if (pattern.test(input)) {
        return pattern;
      }
    }
    return null;
  }

  // Escanear URL
  private scanURL(url: string): ThreatDetection | null {
    // ✅ WHITELIST: Paths legítimos do Vite dev server
    const viteDevPaths = [
      '/src/', '/@fs/', '/@vite/', '/@react-refresh',
      '/node_modules/.vite/', '/@id/', '/@modules/'
    ];
    
    // Pular verificação em paths do Vite
    if (viteDevPaths.some(path => url.startsWith(path))) {
      return null;
    }
    
    let decodedURL: string;
    try {
      decodedURL = decodeURIComponent(url);
    } catch {
      decodedURL = url;
    }
    
    for (const [attackType, patterns] of Object.entries(WAF_SIGNATURES)) {
      const match = this.checkSignatures(decodedURL, patterns);
      if (match) {
        return {
          blocked: this.blockMode,
          severity: this.getSeverity(attackType),
          attackType,
          pattern: match.toString(),
          location: 'url',
          value: decodedURL.substring(0, 100),
        };
      }
    }
    return null;
  }

  // Escanear headers
  private scanHeaders(headers: any): ThreatDetection | null {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') continue;
      
      // ✅ WHITELIST: Headers legítimos do browser que NÃO devem ser verificados
      const legitimateHeaders = [
        'host', 'referer', 'origin', 
        'user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
        'accept', 'accept-language', 'accept-encoding',
        'connection', 'upgrade-insecure-requests'
      ];
      const headerKey = key.toLowerCase();
      
      let decodedValue: string;
      try {
        decodedValue = decodeURIComponent(value);
      } catch {
        decodedValue = value;
      }
      
      for (const [attackType, patterns] of Object.entries(WAF_SIGNATURES)) {
        // ⚠️ SKIP: Não verificar certos ataques em headers (muitos falsos positivos)
        const skipInHeaders = ['SSRF', 'COMMAND_INJECTION'];
        if (skipInHeaders.includes(attackType)) {
          continue; // Headers do browser frequentemente contêm padrões suspeitos
        }
        
        // Pular headers legítimos completamente
        if (legitimateHeaders.includes(headerKey)) {
          continue;
        }
        
        const match = this.checkSignatures(decodedValue, patterns);
        if (match) {
          return {
            blocked: this.blockMode,
            severity: this.getSeverity(attackType),
            attackType,
            pattern: match.toString(),
            location: 'header',
            value: `${key}: ${decodedValue.substring(0, 50)}`,
          };
        }
      }
    }
    return null;
  }

  // Escanear body (recursivo para objetos aninhados)
  private scanBody(body: any, depth = 0, fieldKey?: string): ThreatDetection | null {
    if (depth > 10) return null; // Evitar recursão infinita

    if (typeof body === 'string') {
      for (const [attackType, patterns] of Object.entries(WAF_SIGNATURES)) {
        // Pular COMMAND_INJECTION em campos que contêm User-Agent e similares
        if (
          attackType === 'COMMAND_INJECTION' &&
          fieldKey &&
          SAFE_FIELDS_SKIP_CMD_INJECTION.has(fieldKey)
        ) {
          continue;
        }
        const match = this.checkSignatures(body, patterns);
        if (match) {
          return {
            blocked: this.blockMode,
            severity: this.getSeverity(attackType),
            attackType,
            pattern: match.toString(),
            location: 'body',
            value: body.substring(0, 100),
          };
        }
      }
    } else if (typeof body === 'object' && body !== null) {
      for (const [key, value] of Object.entries(body)) {
        const threat = this.scanBody(value, depth + 1, key);
        if (threat) return threat;
      }
    }

    return null;
  }

  // Escanear cookies
  private scanCookies(cookies: any): ThreatDetection | null {
    for (const [key, value] of Object.entries(cookies)) {
      if (typeof value !== 'string') continue;
      
      for (const [attackType, patterns] of Object.entries(WAF_SIGNATURES)) {
        const match = this.checkSignatures(value, patterns);
        if (match) {
          return {
            blocked: this.blockMode,
            severity: this.getSeverity(attackType),
            attackType,
            pattern: match.toString(),
            location: 'cookie',
            value: `${key}=${value.substring(0, 50)}`,
          };
        }
      }
    }
    return null;
  }

  // Determinar severidade
  private getSeverity(attackType: string): SeverityLevel {
    const criticalAttacks = ['SQL_INJECTION', 'RCE', 'XXE', 'LOG4SHELL'];
    const highAttacks = ['XSS', 'COMMAND_INJECTION', 'SSRF', 'PATH_TRAVERSAL'];
    const mediumAttacks = ['NOSQL_INJECTION', 'LDAP_INJECTION'];

    if (criticalAttacks.includes(attackType)) return 'CRITICAL';
    if (highAttacks.includes(attackType)) return 'HIGH';
    if (mediumAttacks.includes(attackType)) return 'MEDIUM';
    return 'LOW';
  }

  // Scan completo
  scan(req: Request): ThreatDetection | null {
    if (!this.enabled) return null;

    // 1. Scan URL
    const urlThreat = this.scanURL(req.originalUrl);
    if (urlThreat) return urlThreat;

    // 2. Scan Headers
    const headerThreat = this.scanHeaders(req.headers);
    if (headerThreat) return headerThreat;

    // 3. Scan Body
    if (req.body) {
      const bodyThreat = this.scanBody(req.body);
      if (bodyThreat) return bodyThreat;
    }

    // 4. Scan Cookies
    if (req.cookies) {
      const cookieThreat = this.scanCookies(req.cookies);
      if (cookieThreat) return cookieThreat;
    }

    return null;
  }

  // Toggle
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setBlockMode(blockMode: boolean) {
    this.blockMode = blockMode;
  }
}

// 🌍 INSTÂNCIA GLOBAL
const wafEngine = new WAFEngine();

// 🛡️ MIDDLEWARE WAF
export function wafProtection(req: Request, res: Response, next: NextFunction) {
  const threat = wafEngine.scan(req);

  if (threat) {
    console.log(`🛡️ WAF THREAT DETECTED: ${threat.attackType} (${threat.severity}) - ${threat.location}: ${threat.value}`);

    if (threat.blocked) {
      // Log para auditoria
      console.error(`🚨 WAF BLOCKED: ${threat.attackType} from ${req.ip} - Pattern: ${threat.pattern}`);

      return res.status(403).json({
        error: 'Forbidden',
        message: 'Request blocked by Web Application Firewall',
        code: 'WAF_BLOCKED',
        severity: threat.severity,
      });
    } else {
      // Modo detecção apenas (log detalhado para debug)
      console.warn(`⚠️ WAF DETECTED (NOT BLOCKED): ${threat.attackType} - ${threat.severity}`);
      console.warn(`   📍 URL: ${req.method} ${req.originalUrl}`);
      console.warn(`   🔍 Location: ${threat.location} | Pattern: ${threat.pattern}`);
      console.warn(`   💡 Value: ${threat.value}`);
    }
  }

  next();
}

// 🎛️ EXPORT CONTROLS
export const waf = {
  middleware: wafProtection,
  setEnabled: (enabled: boolean) => wafEngine.setEnabled(enabled),
  setBlockMode: (blockMode: boolean) => wafEngine.setBlockMode(blockMode),
};
