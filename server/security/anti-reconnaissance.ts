/**
 * 🛡️ ANTI-RECONNAISSANCE PROTECTION
 * Proteção ultra-avançada contra reconnaissance
 * - Server fingerprinting prevention
 * - Information disclosure blocking
 * - Version hiding
 * - Technology stack obfuscation
 */

import { Request, Response, NextFunction } from 'express';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

export class AntiReconnaissanceProtection {
  private static instance: AntiReconnaissanceProtection;

  public static getInstance(): AntiReconnaissanceProtection {
    if (!AntiReconnaissanceProtection.instance) {
      AntiReconnaissanceProtection.instance = new AntiReconnaissanceProtection();
    }
    return AntiReconnaissanceProtection.instance;
  }

  /**
   * 🎭 REMOVER HEADERS INFORMATIVOS
   */
  public removeIdentifyingHeaders() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Remover headers que revelam tecnologia
      res.removeHeader('X-Powered-By');
      res.removeHeader('Server');
      res.removeHeader('X-AspNet-Version');
      res.removeHeader('X-AspNetMvc-Version');
      res.removeHeader('X-Runtime');
      res.removeHeader('X-Version');
      
      // Headers genéricos de segurança
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
      
      next();
    };
  }

  /**
   * 🚫 BLOQUEAR FERRAMENTAS DE RECONNAISSANCE
   */
  public blockReconTools() {
    return (req: Request, res: Response, next: NextFunction) => {
      const userAgent = (req.headers['user-agent'] || '').toLowerCase();
      
      // User-Agents de ferramentas de scanning
      const scanningTools = [
        'nmap', 'nikto', 'sqlmap', 'burp', 'zap',
        'acunetix', 'nessus', 'openvas', 'metasploit',
        'masscan', 'nuclei', 'gobuster', 'dirb',
        'wfuzz', 'ffuf', 'dirsearch', 'wpscan',
        'scanner', 'pentest', 'security', 'audit',
        'vulnerability', 'exploit', 'crawler'
      ];

      const isScanner = scanningTools.some(tool => userAgent.includes(tool));

      if (isScanner) {
        console.error(`🚨 SCANNING TOOL DETECTED: ${userAgent} from ${req.ip}`);
        
        // 🔥 BLOQUEIO AUTOMÁTICO DE IP (CRITICAL SEVERITY - bloqueio imediato)
        addSuspiciousIPToPermanentBlacklist(
          req.ip, 
          `Reconnaissance Tool Detected: ${userAgent}`, 
          'critical'
        ).catch(err => console.error('❌ Erro ao bloquear IP:', err));
        
        // Retornar resposta genérica sem revelar informação
        return res.status(403).json({
          success: false,
          error: 'Acesso negado'
        });
      }

      next();
    };
  }

  /**
   * 🔒 OCULTAR PÁGINAS DE ERRO DETALHADAS
   */
  public hideDetailedErrors() {
    return (err: Error, req: Request, res: Response, next: NextFunction) => {
      // Nunca revelar stack trace em produção
      if (process.env.NODE_ENV === 'production') {
        console.error(`❌ Error: ${err.message}`, {
          path: req.path,
          method: req.method,
          ip: req.ip,
          stack: err.stack
        });

        // Resposta genérica
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor'
        });
      }

      // Em desenvolvimento, mostrar erro completo
      next(err);
    };
  }

  /**
   * 🎯 BLOQUEAR TENTATIVAS DE DIRECTORY LISTING
   */
  public blockDirectoryListing() {
    return (req: Request, res: Response, next: NextFunction) => {
      // 🟢 WHITELIST DE IPs CONFIÁVEIS - NUNCA GERAR AVISOS
      const trustedIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '160.20.87.98'];
      const isTrustedIP = trustedIPs.includes(req.ip || '');
      
      // ✅ PERMITIR ARQUIVOS DO VITE E DO REACT EM DESENVOLVIMENTO
      const isVitePath = req.path.startsWith('/@fs/') || 
                         req.path.startsWith('/@vite/') ||
                         req.path.startsWith('/@react-refresh') ||
                         req.path.startsWith('/src/'); // Permitir todos os arquivos /src/
      
      // ✅ PERMITIR TODAS AS ROTAS DE API (nunca são directory listings)
      const isApiRoute = req.path.startsWith('/api/');
      
      if (isVitePath || isApiRoute) {
        return next();
      }

      // ✅ PERMITIR ROTAS DE CHECKOUT DO FRONTEND (com validação rigorosa)
      // Padrões válidos: /checkout/meu-produto-123, /c/produto, /oferta/promo-especial
      const checkoutRoutePatterns = [
        /^\/checkout\/[a-zA-Z0-9_-]+$/,  // /checkout/slug (alfanumérico, hífen, underscore)
        /^\/c\/[a-zA-Z0-9_-]+$/,         // /c/slug
        /^\/oferta\/[a-zA-Z0-9_-]+$/     // /oferta/slug
      ];
      
      const isValidCheckoutRoute = checkoutRoutePatterns.some(pattern => 
        pattern.test(req.path)
      );
      
      if (isValidCheckoutRoute) {
        return next(); // Permitir apenas slugs válidos
      }

      // Padrões de tentativa de listar diretórios (BLOQUEIO RIGOROSO)
      const listingPatterns = [
        /\/\.\./,           // Path traversal
        /\/\.git/,          // Git directory
        /\/\.svn/,          // SVN directory
        /\/\.env/,          // Environment files
        /\/node_modules/,   // Node modules
        /\/backup/,         // Backup directories
        /\/\.backup/,       // Hidden backup
        /\/old/,            // Old files
        /\/tmp/,            // Temp directories
        // ⚠️ REMOVIDO: /\/test/ bloqueava URLs legítimas como /produto-teste ou /teste-gratis
        /\/debug/,          // Debug directories
        /\/config\//,       // Config directories
        /\/\.well-known/,   // Well-known directory
        /\.\./,             // Double dot (path traversal) anywhere
        /\/\./              // Dot slash anywhere
      ];

      const isListingAttempt = listingPatterns.some(pattern => 
        pattern.test(req.path.toLowerCase())
      );

      if (isListingAttempt) {
        console.warn(`⚠️ DIRECTORY LISTING ATTEMPT BLOCKED: ${req.path} from ${req.ip}`);
        
        return res.status(404).json({
          success: false,
          error: 'Recurso não encontrado'
        });
      }

      next();
    };
  }

  /**
   * 🕵️ DETECTAR PORT SCANNING
   */
  private portScanAttempts: Map<string, number[]> = new Map();

  public detectPortScanning() {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip;
      const now = Date.now();

      if (!this.portScanAttempts.has(ip)) {
        this.portScanAttempts.set(ip, [now]);
      } else {
        const attempts = this.portScanAttempts.get(ip)!;
        
        // Limpar tentativas antigas (>1 minuto)
        const recentAttempts = attempts.filter(time => now - time < 60000);
        
        // Adicionar nova tentativa
        recentAttempts.push(now);
        this.portScanAttempts.set(ip, recentAttempts);

        // Se muitas requisições em curto período, é provável port scan
        if (recentAttempts.length > 50) {
          console.error(`🚨 PORT SCANNING DETECTED from ${ip} - ${recentAttempts.length} requests in 1 minute`);
          
          return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded'
          });
        }
      }

      next();
    };
  }

  /**
   * 🎭 RESPONSE OBFUSCATION
   */
  public obfuscateResponses() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Interceptar JSON para remover metadados
      const originalJson = res.json.bind(res);
      
      res.json = function(body: any) {
        // Remover campos que revelam estrutura interna
        if (typeof body === 'object' && body !== null) {
          const cleaned = { ...body };
          
          // Remover campos técnicos
          delete cleaned.__v;
          delete cleaned._id;
          delete cleaned.createdAt;
          delete cleaned.updatedAt;
          delete cleaned.version;
          
          // Substituir IDs internos por referencias opacas
          if (cleaned.id && typeof cleaned.id === 'number') {
            // Converter IDs numéricos em hashes
            cleaned.id = Buffer.from(cleaned.id.toString()).toString('base64');
          }
          
          return originalJson(cleaned);
        }
        
        return originalJson(body);
      };
      
      next();
    };
  }

  /**
   * 🚫 BLOQUEAR ROBOTS/CRAWLERS NÃO AUTORIZADOS
   */
  public blockUnauthorizedCrawlers() {
    return (req: Request, res: Response, next: NextFunction) => {
      const userAgent = (req.headers['user-agent'] || '').toLowerCase();
      
      // Crawlers não autorizados (permitir Google, Bing legítimos)
      const unauthorizedBots = [
        'scrapy', 'scraper', 'bot', 'spider',
        'curl', 'wget', 'python-requests',
        'java/', 'go-http-client', 'okhttp'
      ];

      // Exceções para bots legítimos
      const allowedBots = [
        'googlebot', 'bingbot', 'slackbot', 'twitterbot'
      ];

      const hasUnauthorizedBot = unauthorizedBots.some(bot => userAgent.includes(bot));
      const hasAllowedBot = allowedBots.some(bot => userAgent.includes(bot));

      if (hasUnauthorizedBot && !hasAllowedBot) {
        console.warn(`⚠️ UNAUTHORIZED CRAWLER: ${userAgent} from ${req.ip}`);
        
        // Retornar robots.txt ou 403
        if (req.path === '/robots.txt') {
          return res.type('text/plain').send('User-agent: *\nDisallow: /');
        }
        
        return res.status(403).send('Crawling not allowed');
      }

      next();
    };
  }

  /**
   * 🔐 OCULTAR ESTRUTURA DE API
   */
  public hideAPIStructure() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Não revelar rotas disponíveis em erros 404
      const original404 = res.status.bind(res);
      
      res.status = function(code: number) {
        if (code === 404) {
          // Mensagem genérica sem sugestões
          res.locals.hideRoutes = true;
        }
        return original404(code);
      };
      
      next();
    };
  }

  /**
   * 📊 FAKE RESPONSE HEADERS (DECOY)
   */
  public addDecoyHeaders() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Adicionar headers falsos para confundir scanners
      const decoys = [
        ['X-Powered-By', 'PHP/7.4.3'], // Falso
        ['Server', 'Apache/2.4.41'], // Falso
        ['X-AspNet-Version', '4.0.30319'], // Falso
      ];

      // Escolher aleatoriamente um decoy
      const randomDecoy = decoys[Math.floor(Math.random() * decoys.length)];
      
      // Aplicar apenas se NODE_ENV não for development
      if (process.env.NODE_ENV === 'production') {
        res.setHeader(randomDecoy[0], randomDecoy[1]);
      }
      
      next();
    };
  }

  /**
   * 🎲 RANDOMIZAR RESPONSE TIME
   */
  public randomizeResponseTime() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Adicionar delay aleatório pequeno para dificultar timing attacks
      const delay = Math.floor(Math.random() * 50); // 0-50ms
      
      setTimeout(next, delay);
    };
  }

  /**
   * 🚫 BLOQUEAR MÉTODOS HTTP DESNECESSÁRIOS
   */
  public blockUnnecessaryMethods() {
    return (req: Request, res: Response, next: NextFunction) => {
      const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
      
      if (!allowedMethods.includes(req.method)) {
        console.warn(`⚠️ UNUSUAL HTTP METHOD: ${req.method} from ${req.ip}`);
        
        return res.status(405).json({
          success: false,
          error: 'Método não permitido'
        });
      }
      
      next();
    };
  }

  /**
   * 📝 SANITIZAR LOGS PÚBLICOS
   */
  public sanitizePublicLogs() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Interceptar console.log para remover dados sensíveis
      const originalConsoleLog = console.log;
      
      console.log = (...args: any[]) => {
        const sanitized = args.map(arg => {
          if (typeof arg === 'string') {
            // Remover tokens, passwords, etc
            return arg
              .replace(/Bearer\s+[^\s]+/g, 'Bearer [REDACTED]')
              .replace(/password["\s:]+[^\s,}]+/gi, 'password: [REDACTED]')
              .replace(/token["\s:]+[^\s,}]+/gi, 'token: [REDACTED]');
          }
          return arg;
        });
        
        originalConsoleLog(...sanitized);
      };
      
      next();
    };
  }
}

export const reconProtection = AntiReconnaissanceProtection.getInstance();
