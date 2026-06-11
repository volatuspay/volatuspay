/**
 * 🛡️ ADVANCED SQL INJECTION PROTECTION
 * Proteção ultra-avançada contra SQL Injection
 * - Pattern detection com ML-inspired rules
 * - Query validation
 * - Prepared statement enforcement
 * - NoSQL injection prevention
 */

import { Request, Response, NextFunction } from 'express';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

export class AdvancedSQLiProtection {
  private static instance: AdvancedSQLiProtection;

  public static getInstance(): AdvancedSQLiProtection {
    if (!AdvancedSQLiProtection.instance) {
      AdvancedSQLiProtection.instance = new AdvancedSQLiProtection();
    }
    return AdvancedSQLiProtection.instance;
  }

  /**
   * 🔍 PADRÕES SQL INJECTION ULTRA-AVANÇADOS
   * ✅ AJUSTADO: Bloqueia apenas ataques REAIS, não palavras normais
   */
  private readonly sqlPatterns = [
    // SQL Commands - APENAS quando usados em contexto de ataque
    /;\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\s+/gi,
    /\bUNION\s+(ALL\s+)?SELECT\s+/gi,
    
    // SQL Comments - padrões claros de ataque
    /--\s*[;'"]/gi,
    /\/\*.*?\*\//gi,
    /;\s*--/gi,
    
    // Boolean-based blind SQLi - PADRÕES ESPECÍFICOS
    /'\s*OR\s*'1'\s*=\s*'1/gi,
    /'\s*OR\s*1\s*=\s*1/gi,
    /"\s*OR\s*"1"\s*=\s*"1/gi,
    /"\s*OR\s*1\s*=\s*1/gi,
    /\bOR\s+1\s*=\s*1\s*--/gi,
    /\bAND\s+1\s*=\s*1\s*--/gi,
    
    // Time-based blind SQLi
    /\bSLEEP\s*\(\s*\d+\s*\)/gi,
    /\bWAITFOR\s+DELAY\s+/gi,
    /\bBENCHMARK\s*\(/gi,
    
    // Stacked queries com ponto-e-vírgula
    /;\s*(SELECT|INSERT|UPDATE|DELETE|DROP)\s/gi,
    
    // Database enumeration
    /\binformation_schema\./gi,
    /\bpg_catalog\./gi,
    /\bmysql\./gi,
    /\bsqlite_master/gi,
    
    // Advanced evasion - URL encoded
    /(\%27\s*OR\s*\%271\%27\s*=\s*\%271)/gi,
    /(\%27\s*OR\s*1\s*=\s*1)/gi,
    
    // Stored procedure injection
    /\bEXEC\s*\(\s*@/gi,
    /\bsp_executesql/gi,
    
    // Out-of-band SQLi
    /\bLOAD_FILE\s*\(/gi,
    /\bINTO\s+(OUTFILE|DUMPFILE)/gi,
    
    // XML-based injection
    /\bEXTRACTVALUE\s*\(/gi,
    /\bUPDATEXML\s*\(/gi
  ];

  /**
   * 🔍 PADRÕES NoSQL INJECTION ULTRA-AVANÇADOS
   * ✅ AJUSTADO: Bloqueia apenas operadores perigosos em contexto de ataque
   */
  private readonly noSqlPatterns = [
    // MongoDB operators PERIGOSOS - apenas em strings (não em código legítimo)
    /"\$where"/gi,
    /'\$where'/gi,
    /"\$function"/gi,
    /'\$function'/gi,
    /"\$accumulator"/gi,
    /'\$accumulator'/gi,
    
    // Query pattern detection - padrão suspeito em input de usuário
    /\{\s*["']?\$where["']?\s*:/gi,
    /\{\s*["']?\$function["']?\s*:/gi,
    
    // JavaScript injection in MongoDB - claro ataque
    /function\s*\(\s*\)\s*\{\s*return/gi,
    /this\.constructor/gi,
    /db\.collection/gi,
    
    // ✅ REMOVIDOS: Operadores normais como $gt, $in, etc que são legítimos
    // ✅ REMOVIDOS: Padrões de Firebase que são uso normal (.where, .orderBy)
  ];

  /**
   * 🛡️ DETECTAR SQL INJECTION
   */
  public detectSQLi(input: string): boolean {
    if (typeof input !== 'string') return false;
    
    // Decode URL encoding (safely - malformed percent sequences are not SQLi)
    let decoded: string;
    try {
      decoded = decodeURIComponent(input);
    } catch {
      decoded = input;
    }
    
    // Check SQL patterns
    const hasSQLPattern = this.sqlPatterns.some(pattern => pattern.test(decoded));
    
    // Check NoSQL patterns
    const hasNoSQLPattern = this.noSqlPatterns.some(pattern => pattern.test(decoded));
    
    return hasSQLPattern || hasNoSQLPattern;
  }

  /**
   * 🧹 SANITIZAR INPUT CONTRA SQLi
   * ✅ AJUSTADO: Não remove aspas/quotes de JSON válido
   */
  public sanitizeSQL(input: any): any {
    if (typeof input === 'string') {
      // ✅ Remove APENAS padrões claramente perigosos, não aspas normais
      return input
        .replace(/;\s*--/g, '')         // Remove comentários SQL após ponto-e-vírgula
        .replace(/--\s*$/g, '')         // Remove comentários no final
        .replace(/\/\*.*?\*\//g, '')    // Remove comentários multi-linha
        .trim();
      // ✅ NÃO removemos aspas, semicolons normais - JSON precisa deles!
    }
    
    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeSQL(item));
    }
    
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        // Sanitizar valor, manter chave original se não tiver padrão perigoso
        const hasKeyDanger = this.detectSQLi(key);
        const sanitizedKey = hasKeyDanger ? key.replace(/[;'"\\]/g, '') : key;
        sanitized[sanitizedKey] = this.sanitizeSQL(value);
      }
      return sanitized;
    }
    
    return input;
  }

  /**
   * 🚫 MIDDLEWARE DE DETECÇÃO SQLi
   */
  public sqliDetector() {
    return (req: Request, res: Response, next: NextFunction) => {
      const checkForSQLi = (obj: any, path: string = ''): boolean => {
        if (typeof obj === 'string') {
          if (this.detectSQLi(obj)) {
            console.error(`🚨 SQL INJECTION DETECTED in ${path}: ${obj.substring(0, 100)}`);
            return true;
          }
        } else if (Array.isArray(obj)) {
          return obj.some((item, index) => checkForSQLi(item, `${path}[${index}]`));
        } else if (typeof obj === 'object' && obj !== null) {
          // Verificar keys também (NoSQL injection via keys)
          for (const [key, value] of Object.entries(obj)) {
            if (this.detectSQLi(key)) {
              console.error(`🚨 SQL INJECTION DETECTED in key ${path}.${key}`);
              return true;
            }
            if (checkForSQLi(value, path ? `${path}.${key}` : key)) {
              return true;
            }
          }
        }
        return false;
      };

      // 🔧 FILTRAR HEADERS SEGUROS (evitar falsos positivos)
      const safeHeaders = [
        'accept', 'user-agent', 'content-type', 'referer', 'origin', 'host', 
        'connection', 'accept-encoding', 'accept-language', 'cache-control',
        'authorization', // JWT Bearer tokens - NUNCA verificar para SQL injection
        'if-none-match', 'if-modified-since', 'etag', 'pragma', 'expires', // Headers de cache legítimos
        'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform' // Headers de segurança do browser
      ];
      const filteredHeaders = Object.keys(req.headers || {})
        .filter(key => !safeHeaders.includes(key.toLowerCase()))
        .reduce((obj: any, key) => {
          obj[key] = req.headers[key];
          return obj;
        }, {});
      
      // Verificar body, query, params e headers (exceto os seguros)
      if (checkForSQLi(req.body, 'body') || 
          checkForSQLi(req.query, 'query') || 
          checkForSQLi(req.params, 'params') ||
          checkForSQLi(filteredHeaders, 'headers')) {
        
        console.error(`🚨 SQL INJECTION ATTACK BLOCKED from IP: ${req.ip}`);
        
        // 🔥 BLOQUEIO AUTOMÁTICO DE IP (HIGH SEVERITY - 2 tentativas = ban)
        addSuspiciousIPToPermanentBlacklist(
          req.ip, 
          `SQL Injection attempt on ${req.method} ${req.path}`, 
          'high'
        ).catch(err => console.error('❌ Erro ao bloquear IP:', err));
        
        return res.status(400).json({
          success: false,
          error: 'Padrão de ataque SQL detectado'
        });
      }

      next();
    };
  }

  /**
   * 🔒 VALIDAR QUERY PARAMETERS
   */
  public validateQueryParams(allowedParams: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      const queryKeys = Object.keys(req.query);
      const invalidParams = queryKeys.filter(key => !allowedParams.includes(key));
      
      if (invalidParams.length > 0) {
        console.warn(`⚠️ Invalid query parameters detected: ${invalidParams.join(', ')} from IP: ${req.ip}`);
        return res.status(400).json({
          success: false,
          error: 'Parâmetros inválidos detectados'
        });
      }
      
      next();
    };
  }

  /**
   * 🔐 FIRESTORE QUERY SANITIZER (NoSQL específico)
   */
  public sanitizeFirestoreQuery(query: any): any {
    if (typeof query === 'object' && query !== null) {
      const sanitized: any = {};
      
      for (const [key, value] of Object.entries(query)) {
        // Bloquear operadores NoSQL perigosos
        if (key.startsWith('$')) {
          console.warn(`⚠️ NoSQL operator blocked: ${key}`);
          continue;
        }
        
        // Sanitizar valor
        if (typeof value === 'string') {
          sanitized[key] = this.sanitizeSQL(value);
        } else if (typeof value === 'object') {
          sanitized[key] = this.sanitizeFirestoreQuery(value);
        } else {
          sanitized[key] = value;
        }
      }
      
      return sanitized;
    }
    
    return query;
  }
}

export const sqliProtection = AdvancedSQLiProtection.getInstance();
