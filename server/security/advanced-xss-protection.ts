/**
 * 🛡️ ADVANCED XSS PROTECTION
 * Proteção ultra-avançada contra Cross-Site Scripting
 * - Content Security Policy (CSP)
 * - Output encoding automático
 * - DOM-based XSS prevention
 * - Reflected/Stored XSS blocking
 */

import { Request, Response, NextFunction } from 'express';
import DOMPurify from 'isomorphic-dompurify';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

interface CSPDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'media-src': string[];
  'font-src': string[];
  'connect-src': string[];
  'frame-src': string[];
  'child-src': string[];
  'frame-ancestors': string[];
  'base-uri': string[];
  'form-action': string[];
  'object-src': string[];
}

export class AdvancedXSSProtection {
  private static instance: AdvancedXSSProtection;
  private cspNonce: string = '';

  public static getInstance(): AdvancedXSSProtection {
    if (!AdvancedXSSProtection.instance) {
      AdvancedXSSProtection.instance = new AdvancedXSSProtection();
    }
    return AdvancedXSSProtection.instance;
  }

  /**
   * 🔐 CONTENT SECURITY POLICY ULTRA-RESTRITIVO
   */
  public cspMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Em desenvolvimento, CSP mais permissivo para Vite HMR
      const isDev = process.env.NODE_ENV !== 'production';
      
      const cspDirectives: CSPDirectives = {
        'default-src': ["'self'"],
        'script-src': isDev ? [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'", // Necessário para Vite HMR
          "https://cdn.jsdelivr.net",
          "https://unpkg.com",
          "https://raw.githubusercontent.com",
          "https://js.stripe.com",
          "https://checkout.stripe.com",
          "https://pay.google.com",
          "https://apis.google.com",
          "https://*.googleapis.com",
          "https://www.gstatic.com",
          "https://*.gstatic.com",
          "https://*.firebaseio.com",
          "https://cdn.discordapp.com",
          "https://tokenizer.sejaefi.com.br",
          "https://*.sejaefi.com.br",
          "https://device.clearsale.com.br",
          "https://web.fpcs-monitor.com.br",
          "https://*.clearsale.com.br",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://s.ytimg.com",
          "https://player.vimeo.com",
          "https://*.pandavideo.com.br",
          "https://connect.facebook.net",
          "https://replit.com",
          "https://*.replit.com",
          "https://*.replit.dev"
        ] : [
          "'self'",
          // Hash do script inline de tema no index.html (detecção dark/light antes do React)
          "'sha256-zipUUN0SUlbXuU7kJRUWs6x6jfHbunVWVzZfI21Wm/s='",
          // Hash de scripts inline adicionais (Firebase/analytics)
          "'sha256-gCy0mvR446lp/h9kmZMeZlg94pGTas2enXdE8GKMjAY='",
          "https://cdn.jsdelivr.net",
          "https://unpkg.com",
          "https://js.stripe.com",
          "https://checkout.stripe.com",
          "https://pay.google.com",
          "https://apis.google.com",
          "https://*.googleapis.com",
          "https://www.gstatic.com",
          "https://*.gstatic.com",
          "https://*.firebaseio.com",
          "https://cdn.discordapp.com",
          "https://tokenizer.sejaefi.com.br",
          "https://*.sejaefi.com.br",
          "https://device.clearsale.com.br",
          "https://web.fpcs-monitor.com.br",
          "https://*.clearsale.com.br",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://s.ytimg.com",
          "https://player.vimeo.com",
          "https://*.pandavideo.com.br",
          "https://connect.facebook.net",
          "https://analytics.tiktok.com",
          "https://www.googletagmanager.com",
          "https://s.pinimg.com",
          "https://static.kwai.net",
          "https://replit.com",
          "https://*.replit.com"
        ],
        'style-src': isDev ? [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net"
        ] : [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net"
        ],
        'img-src': isDev ? [
          "'self'",
          "data:",
          "blob:",
          "https:",
          "http:",
          "https://cdn.discordapp.com",
          "https://firebasestorage.googleapis.com",
          "https://storage.googleapis.com"
        ] : [
          "'self'",
          "data:",
          "blob:",
          "https:",
        ],
        'media-src': [
          "'self'",
          "blob:",
          "https:"
        ],
        'font-src': [
          "'self'",
          "data:",
          "https://fonts.gstatic.com"
        ],
        'connect-src': isDev ? [
          "'self'",
          "https://api.stripe.com",
          "https://checkout.stripe.com",
          "https://m.stripe.com",
          "https://pay.google.com",
          "https://www.google.com",
          "https://api.efi.com.br",
          "https://pix.api.efipay.com.br",
          "https://cobrancas.api.efipay.com.br",
          "https://*.efi.com.br",
          "https://*.efipay.com.br",
          "https://tokenizer.sejaefi.com.br",
          "https://*.sejaefi.com.br",
          "https://api.openpix.com.br",
          "https://api.woovi.com",
          "https://api.woovi-sandbox.com",
          "https://*.woovi.com",
          "https://*.openpix.com.br",
          "https://device.clearsale.com.br",
          "https://web.fpcs-monitor.com.br",
          "https://*.clearsale.com.br",
          "https://firebasestorage.googleapis.com",
          "https://storage.googleapis.com",
          "https://firestore.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://identitytoolkit.googleapis.com",
          "https://*.firebaseio.com",
          "https://accounts.google.com",
          "https://www.gstatic.com",
          "https://cdn.discordapp.com",
          "https://video.bunnycdn.com",
          "https://*.bunnycdn.com",
          "https://*.b-cdn.net",
          "https://replit.com",
          "https://*.replit.com",
          "https://*.replit.dev",
          "wss:", // Vite HMR
          "https:" // Dev amplo
        ] : [
          "'self'",
          "https://volatuspay.com",
          "https://volatuspay.com",
          "https://volatuspay.com",
          "https://volatuspay.com",
          "https://api.stripe.com",
          "https://checkout.stripe.com",
          "https://m.stripe.com",
          "https://pay.google.com",
          "https://www.google.com",
          "https://api.efi.com.br",
          "https://pix.api.efipay.com.br",
          "https://cobrancas.api.efipay.com.br",
          "https://api-pix.gerencianet.com.br",
          "https://*.efipay.com.br",
          "https://tokenizer.sejaefi.com.br",
          "https://*.sejaefi.com.br",
          "https://api.openpix.com.br",
          "https://api.woovi.com",
          "https://api.woovi-sandbox.com",
          "https://*.woovi.com",
          "https://*.openpix.com.br",
          "https://device.clearsale.com.br",
          "https://web.fpcs-monitor.com.br",
          "https://*.clearsale.com.br",
          "https://firebasestorage.googleapis.com",
          "https://storage.googleapis.com",
          "https://firestore.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://identitytoolkit.googleapis.com",
          "https://www.googleapis.com",
          "https://fcmregistrations.googleapis.com",
          "https://firebaseinstallations.googleapis.com",
          "https://fcm.googleapis.com",
          "wss://*.firebaseio.com",
          "https://*.firebaseio.com",
          "https://accounts.google.com",
          "https://www.gstatic.com",
          "https://cdn.discordapp.com",
          "https://video.bunnycdn.com",
          "https://*.bunnycdn.com",
          "https://*.b-cdn.net",
          "https://viacep.com.br",
          "https://connect.facebook.net",
          "https://www.facebook.com",
          "https://graph.facebook.com",
          "https://analytics.tiktok.com",
          "https://business-api.tiktok.com",
          "https://www.googletagmanager.com",
          "https://www.google-analytics.com",
          "https://ct.pinterest.com",
          "https://s.pinimg.com",
          "https://static.kwai.net",
          "https://log.kwai.net",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net"
        ],
        'frame-src': [
          "'self'",
          "https://js.stripe.com",
          "https://checkout.stripe.com",
          "https://pay.google.com",
          "https://*.pandavideo.com.br",
          "https://*.firebaseapp.com",
          "https://*.firebaseio.com",
          "https://accounts.google.com",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://player.vimeo.com",
          "https://iframe.mediadelivery.net",
          "https://*.mediadelivery.net"
        ],
        'child-src': [
          "'self'",
          "https://js.stripe.com",
          "https://checkout.stripe.com",
          "https://pay.google.com",
          "https://*.pandavideo.com.br",
          "https://*.firebaseapp.com",
          "https://*.firebaseio.com",
          "https://accounts.google.com"
        ],
        'frame-ancestors': isDev ? ["'self'", "https://*.replit.com", "https://*.replit.dev"] : ["'none'"], // Previne clickjacking
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"]
      };

      const cspHeader = Object.entries(cspDirectives)
        .map(([key, values]) => `${key} ${values.join(' ')}`)
        .join('; ');

      res.setHeader('Content-Security-Policy', cspHeader);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      
      // Armazenar nonce no res.locals para uso em templates
      res.locals.cspNonce = this.cspNonce;
      
      next();
    };
  }

  /**
   * 🧹 SANITIZAR INPUT CONTRA XSS
   */
  public sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      // Remover scripts maliciosos
      return DOMPurify.sanitize(input, {
        ALLOWED_TAGS: [], // Remove TODAS as tags HTML
        ALLOWED_ATTR: [],
        KEEP_CONTENT: true // Mantém o texto
      });
    }
    
    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeInput(item));
    }
    
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitizeInput(value);
      }
      return sanitized;
    }
    
    return input;
  }

  /**
   * 🔒 MIDDLEWARE DE SANITIZAÇÃO AUTOMÁTICA
   */
  public autoSanitize() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Sanitizar body
      if (req.body && typeof req.body === 'object') {
        req.body = this.sanitizeInput(req.body);
      }
      
      // Sanitizar query params
      if (req.query && typeof req.query === 'object') {
        req.query = this.sanitizeInput(req.query);
      }
      
      // Sanitizar params
      if (req.params && typeof req.params === 'object') {
        req.params = this.sanitizeInput(req.params);
      }
      
      next();
    };
  }

  /**
   * 🔐 ENCODING DE OUTPUT SEGURO
   */
  public encodeOutput(data: string): string {
    return data
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * 🎲 GERAR NONCE CRIPTOGRÁFICO
   */
  private generateNonce(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('base64');
  }

  /**
   * 🛡️ VALIDAR PADRÕES XSS CONHECIDOS
   */
  public detectXSS(input: string): boolean {
    // Decode múltiplas vezes para pegar bypass encoding
    let decoded = input;
    for (let i = 0; i < 3; i++) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch (e) {
        break;
      }
    }
    
    const xssPatterns = [
      // Tags HTML maliciosas
      /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
      /<iframe[\s\S]*?>/gi,
      /<embed[\s\S]*?>/gi,
      /<object[\s\S]*?>/gi,
      /<applet[\s\S]*?>/gi,
      /<link[\s\S]*?>/gi,
      /<meta[\s\S]*?>/gi,
      /<base[\s\S]*?>/gi,
      /<form[\s\S]*?>/gi,
      
      // Event handlers
      /\son\w+\s*=/gi, // onclick, onerror, onload, etc (espaço antes para evitar "affiliateOnly")
      /on\w+\s*\(/gi, // onclick(, onerror(
      
      // JavaScript protocols
      /javascript:/gi,
      /vbscript:/gi,
      /livescript:/gi,
      /data:text\/html/gi,
      /data:text\/javascript/gi,
      /data:application\/javascript/gi,
      
      // Técnicas avançadas de bypass
      /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t:/gi, // javascript com espaços
      /&#\d+;/g, // HTML entities
      /\\x[0-9a-f]{2}/gi, // Hex encoding
      /\\u[0-9a-f]{4}/gi, // Unicode encoding
      /%[0-9a-f]{2}/gi, // URL encoding
      /&lt;script/gi, // Encoded script tags
      /&gt;/gi, // Encoded brackets
      
      // SVG/XML attacks
      /<svg[\s\S]*?onload/gi,
      /<svg[\s\S]*?onerror/gi,
      /<math[\s\S]*?>/gi,
      /<foreignObject[\s\S]*?>/gi,
      
      // Image attacks
      /<img[\s\S]*?onerror/gi,
      /<img[\s\S]*?src\s*=\s*["']?javascript:/gi,
      
      // Expression/eval attacks
      /eval\(/gi,
      /expression\(/gi,
      /Function\(/gi,
      /setTimeout/gi,
      /setInterval/gi,
      
      // DOM manipulation
      /document\./gi,
      /window\./gi,
      /\.innerHTML/gi,
      /\.outerHTML/gi,
      /\.write\(/gi,
      /\.writeln\(/gi,
      
      // Style-based XSS
      /style\s*=.*expression/gi,
      /style\s*=.*javascript:/gi,
      /style\s*=.*behavior:/gi,
      /-moz-binding:/gi,
      
      // Import attacks
      /@import/gi,
      /<import[\s\S]*?>/gi,
      
      // Template attacks
      /\{\{[\s\S]*?\}\}/g, // Angular/Vue templates
      /\$\{[\s\S]*?\}/g, // Template literals
      /%\{[\s\S]*?\}/g // Ruby templates
    ];

    return xssPatterns.some(pattern => pattern.test(decoded));
  }

  /**
   * 🚫 MIDDLEWARE DE DETECÇÃO XSS
   */
  public xssDetector() {
    return (req: Request, res: Response, next: NextFunction) => {
      const checkForXSS = (obj: any, path: string = ''): boolean => {
        if (typeof obj === 'string') {
          if (this.detectXSS(obj)) {
            console.error(`🚨 XSS DETECTED in ${path}: ${obj.substring(0, 100)}`);
            return true;
          }
        } else if (Array.isArray(obj)) {
          return obj.some((item, index) => checkForXSS(item, `${path}[${index}]`));
        } else if (typeof obj === 'object' && obj !== null) {
          return Object.entries(obj).some(([key, value]) => 
            checkForXSS(value, path ? `${path}.${key}` : key)
          );
        }
        return false;
      };

      // Verificar body, query e params
      if (checkForXSS(req.body, 'body') || 
          checkForXSS(req.query, 'query') || 
          checkForXSS(req.params, 'params')) {
        
        console.error(`🚨 XSS ATTACK BLOCKED from IP: ${req.ip}`);
        
        // 🔥 BLOQUEIO AUTOMÁTICO DE IP (HIGH SEVERITY - 2 tentativas = ban)
        addSuspiciousIPToPermanentBlacklist(
          req.ip, 
          `XSS attack attempt on ${req.method} ${req.path}`, 
          'high'
        ).catch(err => console.error('❌ Erro ao bloquear IP:', err));
        
        return res.status(400).json({
          success: false,
          error: 'Conteúdo potencialmente malicioso detectado'
        });
      }

      next();
    };
  }
}

export const xssProtection = AdvancedXSSProtection.getInstance();
