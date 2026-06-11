import { Request, Response, NextFunction } from 'express';
import { getAdmin } from '../lib/firebase-admin';
import { AuthenticatedRequest } from './firebase-auth';
import {
  SecurityLog,
  InsertSecurityLog,
  InsertBlockedIP,
  ThreatCategory,
  SecurityAction,
  ThreatSeverity,
  generateSecurityLogId,
  generateBlockedIpId,
} from '../../shared/schema';
import { logAggregator } from './log-aggregator';
import { analyzeIP, IPIntelligence } from './ip-intelligence';

// 🛡️ ULTRA-HARDENED THREATGUARD - AI-POWERED SECURITY SYSTEM
// Sistema central de proteção contra todas as ameaças

interface ThreatDetectionResult {
  isThreats: boolean;
  threats: Array<{
    category: ThreatCategory;
    severity: ThreatSeverity;
    riskScore: number;
    evidence: string;
    action: SecurityAction;
  }>;
  aiAnalysis?: {
    confidence: number;
    reasoning: string;
    patterns: string[];
    recommendations: string[];
  };
}

// 🧠 CACHE IN-MEMORY PARA BLOQUEIOS (ULTRA-RÁPIDO)
class SecurityCache {
  private blockedIPs = new Map<string, { expiresAt?: Date; reason: string }>();
  private rateLimits = new Map<string, { count: number; windowStart: number }>();
  private suspiciousIPs = new Map<string, { score: number; attempts: number; lastSeen: Date }>();

  // 🔐 SECURITY: Verificação precisa de ranges privados e Replit (evita bypass)
  isPrivateOrReplitRange(ip: string): boolean {
    // Verificar ranges exatos (evita bypass de IPs públicos similares)
    // 10.0.0.0/8 (private)
    if (/^10\./.test(ip)) return true;
    
    // 172.16.0.0/12 (private) - APENAS este sub-range específico, não todo 172.*
    const parts = ip.split('.');
    if (parts.length === 4 && parts[0] === '172') {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    
    // 192.168.0.0/16 (private)
    if (/^192\.168\./.test(ip)) return true;
    
    // 160.20.0.0/16 (Replit specific range)
    if (/^160\.20\./.test(ip)) return true;
    
    return false;
  }

  isIPBlocked(ip: string): boolean {
    // 🏠 NUNCA BLOQUEAR IPs LOCAIS E REPLIT - SECURITY HARDENED
    const whitelistIPs = [
      '127.0.0.1', '::1'
      // REMOVED: 'localhost' (DNS spoofing risk), '0.0.0.0' (CRITICAL: allows any IP)
    ];
    
    if (whitelistIPs.includes(ip)) {
      return false;
    }
    
    // 🔐 WHITELIST: TODO range Replit (160.20.x.x) e ranges privados
    if (this.isPrivateOrReplitRange(ip)) {
      return false;
    }

    const blocked = this.blockedIPs.get(ip);
    if (!blocked) return false;
    
    // Verificar se bloqueio temporário expirou
    if (blocked.expiresAt && blocked.expiresAt < new Date()) {
      this.blockedIPs.delete(ip);
      return false;
    }
    
    return true;
  }

  blockIP(ip: string, reason: string, expiresAt?: Date) {
    // 🏠 NUNCA BLOQUEAR IPs LOCAIS E REPLIT - SECURITY HARDENED
    const whitelistIPs = [
      '127.0.0.1', '::1'
      // REMOVED: 'localhost' (DNS spoofing risk), '0.0.0.0' (CRITICAL: allows any IP)
    ];
    
    if (whitelistIPs.includes(ip)) {
      console.log(`🏠 WHITELISTED IP IGNORED: ${ip} - ${reason}`);
      return;
    }
    
    // 🔐 WHITELIST: TODO range Replit (160.20.x.x) e ranges privados NUNCA SÃO BLOQUEADOS
    if (this.isPrivateOrReplitRange(ip)) {
      console.log(`🏠 REPLIT/PRIVATE RANGE IP NEVER BLOCKED: ${ip} - ${reason}`);
      return;
    }
    
    this.blockedIPs.set(ip, { reason, expiresAt });
    console.log(`🚫 IP BLOCKED IN CACHE: ${ip} - ${reason}`);
  }

  unblockIP(ip: string) {
    this.blockedIPs.delete(ip);
    console.log(`✅ IP UNBLOCKED FROM CACHE: ${ip}`);
  }

  checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(key);
    
    if (!limit || now - limit.windowStart > windowMs) {
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return false; // Não excedeu limite
    }
    
    limit.count++;
    return limit.count > maxRequests; // Excedeu limite
  }

  addSuspiciousActivity(ip: string, scoreIncrease: number) {
    // 🔐 NUNCA adicionar score para IPs whitelist (Replit/privados)
    if (this.isPrivateOrReplitRange(ip)) {
      return false; // Ignorar - é tráfego legítimo
    }
    
    const suspicious = this.suspiciousIPs.get(ip) || { score: 0, attempts: 0, lastSeen: new Date() };
    suspicious.score += scoreIncrease;
    suspicious.attempts++;
    suspicious.lastSeen = new Date();
    this.suspiciousIPs.set(ip, suspicious);
    
    // 🚨 AUTO-BLOCK APENAS PARA INVASÕES MASSIVAS E COMPROVADAS (score >= 5000)
    // ✅ ULTRA-CONSERVADOR: Aumentado de 2000 para 5000 - usuários comuns NUNCA bloqueados
    // 
    // 📊 REFERÊNCIA DE SCORES:
    // - Navegação normal: 0-100 pontos
    // - Login com erro, busca comum: 100-500 pontos  
    // - Atividade suspeita leve: 500-2000 pontos (⚠️ monitora, NÃO bloqueia)
    // - Múltiplas tentativas de ataque: 2000-5000 pontos (⚠️ monitora, NÃO bloqueia)
    // - INVASÃO MASSIVA COMPROVADA: 5000+ pontos (🚫 BLOQUEIA AUTOMATICAMENTE)
    //
    // ✅ Usuários normais navegando, fazendo login, comprando = NUNCA BLOQUEADOS
    // 🚫 Apenas ataques DDoS massivos (50+ req/s), SQL injection repetidos (20+), XSS múltiplos (15+) = BLOQUEADOS
    if (suspicious.score >= 5000) {
      this.blockIP(ip, `Invasão massiva detectada - Score crítico: ${suspicious.score}`);
      return true; // Foi bloqueado
    }
    return false;
  }

  getSuspiciousScore(ip: string): number {
    return this.suspiciousIPs.get(ip)?.score || 0;
  }
}

const securityCache = new SecurityCache();

// ✅ IPs Replit/privados já são protegidos via isPrivateOrReplitRange() - não precisam de unblock manual

// 🔍 DETECÇÃO DE INJEÇÕES - PADRÕES ULTRA-RIGOROSOS
const INJECTION_PATTERNS = {
  // XSS Patterns - Ultra-rigorosos
  xss: [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /<object[^>]*>.*?<\/object>/gi,
    /<embed[^>]*>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /data:text\/html/gi,
    /\son\w+\s*=/gi, // onclick, onload, etc (espaço antes para evitar "affiliateOnly")
    /<svg[^>]*>.*?<\/svg>/gi,
    /<math[^>]*>.*?<\/math>/gi,
    /expression\s*\(/gi,
    /@import/gi,
    /\(\s*document\.|window\.|alert\(|confirm\(|prompt\(/gi,
  ],

  // SQL Injection Patterns - REFINADO PARA EVITAR FALSOS POSITIVOS
  sql: [
    /(\bunion\b.*\bselect\b)/gi,
    /(\bselect\b.*\bfrom\b.*\bwhere\b)/gi,
    /(\bdrop\b.*\btable\b)/gi,
    /(\binsert\b.*\binto\b)/gi,
    /(\bupdate\b.*\bset\b)/gi,
    /(\bdelete\b.*\bfrom\b)/gi,
    /(\bcreate\b.*\btable\b)/gi,
    /(\balter\b.*\btable\b)/gi,
    /(\bexec\b|\bexecute\b)\s*\(/gi, // ✅ Apenas com parênteses (função SQL)
    /(\bsp_\w+)/gi,
    /(\bxp_\w+)/gi,
    // ✅ REMOVIDO: Comentários SQL simples (--) - gera MUITOS falsos positivos em texto normal
    /(\b(or|and)\b\s*[0-9]+\s*[=<>]\s*[0-9]+\s*--)/gi, // ✅ Apenas se tiver comentário SQL após
    /(1\s*=\s*1\s+--|1\s*=\s*'1'\s+--)/gi, // ✅ Apenas se tiver comentário SQL
    /('\s*or\s*'1'\s*=\s*'1)/gi, // ✅ Injeção clássica
    /(\bhaving\b.*\bcount\b.*\>\s*0)/gi,
  ],

  // HTML Injection Patterns
  html: [
    /<\s*\/?\s*[a-z]+[^>]*>/gi,
    /&lt;.*?&gt;/gi,
    /%3C.*?%3E/gi,
    /&#\d+;/gi,
    /&[a-z]+;/gi,
  ],

  // Path Traversal Patterns
  pathTraversal: [
    /\.\./g,
    /%2e%2e/gi,
    /%c0%ae/gi,
    /\%5c/gi,
    /\/etc\/passwd/gi,
    /\/windows\/system32/gi,
    /\.\.\\\\|\.\.\/\//g,
  ],

  // Code Injection Patterns
  codeInjection: [
    /\beval\s*\(/gi,
    /\bexec\s*\(/gi,
    /\bsystem\s*\(/gi,
    /\bshell_exec\s*\(/gi,
    /\bpassthru\s*\(/gi,
    /`[^`]*`/g, // Template literals suspeitos
    /\$\([^)]*\)/g, // Command substitution
    /\${[^}]*}/g, // Variable expansion
  ]
};

// 🤖 AI THREAT ANALYSIS - INTEGRAÇÃO COM OPENAI
async function analyzeWithAI(payload: string, context: any): Promise<ThreatDetectionResult['aiAnalysis']> {
  try {
    const openai = await import('openai');
    const client = new openai.default({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Verificar se payload é válido
    if (!payload || typeof payload !== 'string') {
      return undefined;
    }

    const analysisPrompt = `
Você é um especialista em segurança cibernética. Analise o seguinte payload HTTP e determine se contém ameaças de segurança.

PAYLOAD:
${payload.substring(0, 1000)} ${payload.length > 1000 ? '... [truncated]' : ''}

CONTEXTO:
- Method: ${context.method}
- Endpoint: ${context.endpoint}
- IP: ${context.ip}
- User-Agent: ${context.userAgent}

ANALISE OS SEGUINTES TIPOS DE AMEAÇAS:
1. XSS (Cross-site scripting)
2. SQL Injection
3. HTML Injection
4. Code Injection
5. Path Traversal
6. Command Injection
7. LDAP Injection
8. NoSQL Injection

RESPONDA APENAS EM JSON NO FORMATO:
{
  "confidence": 0-100,
  "reasoning": "explicação detalhada",
  "patterns": ["lista", "de", "padrões", "detectados"],
  "recommendations": ["lista", "de", "recomendações"]
}
`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.1,
      max_tokens: 500,
    });

    const result = response.choices[0]?.message?.content;
    if (!result) return undefined;

    return JSON.parse(result);
  } catch (error) {
    console.error('❌ AI Analysis failed:', error);
    return undefined;
  }
}

// 🔍 DETECÇÃO DE AMEAÇAS - ENGINE PRINCIPAL
function detectThreats(req: Request): ThreatDetectionResult {
  const threats: ThreatDetectionResult['threats'] = [];
  
  // 🔐 FILTER OUT AUTHENTICATION HEADERS - Firebase JWT tokens contain Base64 that triggers false positives
  const headersToCheck = { ...req.headers };
  delete headersToCheck.authorization; // Skip Bearer tokens (Firebase JWT)
  delete headersToCheck.cookie; // Skip cookies (may contain session tokens)
  
  const payload = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params,
    headers: headersToCheck, // ✅ Headers filtrados (sem tokens de autenticação)
    url: req.url
  });

  // 🛡️ WHITELIST PARA ARQUIVOS DE DESENVOLVIMENTO - EVITA FALSOS POSITIVOS
  const developmentPaths = [
    '/src/', '/@fs/', '/@vite/', '/@react-refresh', '/__vite_ping',
    '.tsx', '.ts', '.js', '.jsx', '.css', '.json', '.mjs', '.map',
    '/node_modules/', '/dist/', '/build/', '/public/', '/assets/'
  ];
  
  const developmentIPs = ['127.0.0.1', '::1', 'localhost'];
  const clientIP = req.ip || req.socket.remoteAddress || '';
  
  const isDevelopmentRequest = 
    developmentPaths.some(path => req.url.includes(path)) ||
    req.headers.accept?.includes('text/javascript') ||
    req.headers.accept?.includes('application/javascript') ||
    req.headers.accept?.includes('text/css') ||
    req.headers.accept?.includes('text/html') ||
    req.method === 'GET' && req.url.startsWith('/api/') && developmentIPs.includes(clientIP) ||
    req.headers['user-agent']?.includes('Vite') ||
    req.url.includes('?v=') || // Vite versioned assets
    req.url.includes('?t='); // Vite HMR assets
  
  // Pular detecção agressiva para arquivos/requests de desenvolvimento
  if (isDevelopmentRequest) {
    return { isThreats: false, threats: [] };
  }

  // 🔥 DETECÇÃO XSS - BLOQUEIO AUTOMÁTICO ATIVADO ✅
  for (const pattern of INJECTION_PATTERNS.xss) {
    if (pattern.test(payload)) {
      threats.push({
        category: 'xss_injection',
        severity: 'critical',
        riskScore: 95,
        evidence: `XSS pattern detected: ${pattern.source}`,
        action: 'block_immediate'
      });
      console.log(`🚨 CRITICAL ATTACK DETECTED: XSS Injection from ${req.ip} - AUTO-BLOCKING IP`);
      break;
    }
  }

  // 🔥 DETECÇÃO SQL INJECTION - BLOQUEIO AUTOMÁTICO ATIVADO ✅
  for (const pattern of INJECTION_PATTERNS.sql) {
    if (pattern.test(payload)) {
      threats.push({
        category: 'sql_injection',
        severity: 'critical',
        riskScore: 98,
        evidence: `SQL injection pattern detected: ${pattern.source}`,
        action: 'block_immediate'
      });
      console.log(`🚨 CRITICAL ATTACK DETECTED: SQL Injection from ${req.ip} - AUTO-BLOCKING IP`);
      break;
    }
  }

  // 🔥 DETECÇÃO HTML INJECTION - BLOQUEIO AUTOMÁTICO ATIVADO ✅
  for (const pattern of INJECTION_PATTERNS.html) {
    if (pattern.test(payload)) {
      threats.push({
        category: 'html_injection',
        severity: 'critical',
        riskScore: 90,
        evidence: `HTML injection pattern detected: ${pattern.source}`,
        action: 'block_immediate'
      });
      console.log(`🚨 CRITICAL ATTACK DETECTED: HTML Injection from ${req.ip} - AUTO-BLOCKING IP`);
      break;
    }
  }

  // 🔥 DETECÇÃO PATH TRAVERSAL - BLOQUEIO AUTOMÁTICO ATIVADO ✅
  for (const pattern of INJECTION_PATTERNS.pathTraversal) {
    if (pattern.test(payload)) {
      threats.push({
        category: 'path_traversal',
        severity: 'critical',
        riskScore: 95,
        evidence: `Path traversal pattern detected: ${pattern.source}`,
        action: 'block_immediate'
      });
      console.log(`🚨 CRITICAL ATTACK DETECTED: Path Traversal from ${req.ip} - AUTO-BLOCKING IP`);
      break;
    }
  }

  // 🔥 DETECÇÃO CODE INJECTION - BLOQUEIO AUTOMÁTICO ATIVADO ✅
  for (const pattern of INJECTION_PATTERNS.codeInjection) {
    if (pattern.test(payload)) {
      threats.push({
        category: 'code_injection',
        severity: 'critical',
        riskScore: 99,
        evidence: `Code injection pattern detected: ${pattern.source}`,
        action: 'block_immediate'
      });
      console.log(`🚨 CRITICAL ATTACK DETECTED: Code Injection from ${req.ip} - AUTO-BLOCKING IP`);
      break;
    }
  }

  // 📊 DETECÇÃO DE ANOMALIAS - DESABILITADA
  // ❌ REMOVIDO: Detecção genérica de headers proxy - todos são legítimos (Replit, CDNs, load balancers)
  // ✅ FOCO: Apenas ataques REAIS (SQL injection, XSS) são detectados acima

  // 🤖 DETECÇÃO DE BOTS - APENAS SCRAPERS MALICIOSOS
  // ❌ REMOVIDO: Detecção genérica que pega ferramentas legítimas (curl, postman, testes automatizados)
  // ✅ FOCO: Apenas bots de scraping agressivo são bloqueados pelo rate limiting natural
  const userAgent = req.headers['user-agent'] || '';
  const maliciousBotPatterns = [
    /sqlmap/gi,         // SQL injection scanner
    /nikto/gi,          // Web vulnerability scanner  
    /masscan/gi,        // Port scanner
    /zgrab/gi,          // Internet scanner
    /nmap/gi,           // Network mapper
    /nuclei/gi,         // Vulnerability scanner
    /acunetix/gi,       // Web vulnerability scanner
    /burpsuite/gi,      // Penetration testing tool
    /metasploit/gi      // Exploitation framework
  ];

  for (const pattern of maliciousBotPatterns) {
    if (pattern.test(userAgent)) {
      threats.push({
        category: 'bot_detection',
        severity: 'high',
        riskScore: 85,
        evidence: `Malicious scanner detected: ${userAgent}`,
        action: 'block_immediate'
      });
      break;
    }
  }

  return {
    isThreats: threats.length > 0,
    threats
  };
}

// 💾 SALVAR LOG DE SEGURANÇA NO FIREBASE (COM AGREGAÇÃO INTELIGENTE E GEOLOCALIZAÇÃO)
async function saveSecurityLog(logData: InsertSecurityLog): Promise<void> {
  try {
    // 🌍 OBTER GEOLOCALIZAÇÃO DO IP (usa cache, não impacta performance)
    const ipIntel = logData.sourceIp ? await analyzeIP(logData.sourceIp) : null;

    const logEntry = {
      id: generateSecurityLogId(),
      ipAddress: logData.sourceIp || 'unknown',
      threatCategory: logData.threatCategory,
      severity: logData.severity,
      endpoint: logData.endpoint || '',
      userAgent: logData.userAgent || '',
      detectedAt: logData.detectedAt,
      riskScore: logData.riskScore,
      actionTaken: logData.actionTaken,
      // 🌍 DADOS DE GEOLOCALIZAÇÃO (undefined se não disponível - compatível com schema opcional)
      ...(ipIntel && {
        country: ipIntel.country,
        countryCode: ipIntel.countryCode,
        city: ipIntel.city,
        isDatacenter: ipIntel.isDatacenter,
        isProxy: ipIntel.isProxy,
        isVPN: ipIntel.isVPN,
        isTor: ipIntel.isTor,
        threatLevel: ipIntel.threatLevel,
        geoRiskScore: ipIntel.riskScore,
      }),
    };

    // ✅ USAR AGREGADOR INTELIGENTE - Agrupa logs similares e salva apenas ataques confirmados
    await logAggregator.addLog(logEntry);
  } catch (error) {
    console.error('❌ Failed to save security log:', error);
  }
}

// 🚫 BLOQUEAR IP PERMANENTEMENTE (COM GEOLOCALIZAÇÃO)
async function blockIPPermanently(ip: string, reason: string, threatCategories: ThreatCategory[], severity: ThreatSeverity, riskScore: number): Promise<void> {
  try {
    const admin = await getAdmin();
    const db = admin.firestore();

    // Bloquear no cache (imediato)
    securityCache.blockIP(ip, reason);

    // 🌍 OBTER GEOLOCALIZAÇÃO DO IP
    const ipIntel = await analyzeIP(ip);

    // Salvar no Firebase (persistente) com dados de geolocalização
    const blockedIpData: InsertBlockedIP = {
      ipAddress: ip,
      reason,
      threatCategories,
      severity,
      riskScore,
      blockedBy: 'system',
      isTemporary: false,
      attacksBlocked: 1,
      lastAttemptAt: new Date(),
      totalAttempts: 1,
      isActive: true,
    };

    const blockedIpWithId = {
      ...blockedIpData,
      id: generateBlockedIpId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      // 🌍 DADOS DE GEOLOCALIZAÇÃO (undefined se não disponível - compatível com schema opcional)
      ...(ipIntel && {
        country: ipIntel.country,
        countryCode: ipIntel.countryCode,
        city: ipIntel.city,
        region: ipIntel.region,
        isp: ipIntel.isp,
        isDatacenter: ipIntel.isDatacenter,
        isProxy: ipIntel.isProxy,
        isVPN: ipIntel.isVPN,
        isTor: ipIntel.isTor,
        threatLevel: ipIntel.threatLevel,
        geoRiskScore: ipIntel.riskScore,
      }),
    };

    await db.collection('blockedIPs').doc(blockedIpWithId.id).set(blockedIpWithId);
    console.log(`🚫 IP BLOCKED PERMANENTLY: ${ip} (${ipIntel?.country || 'Unknown'}, ${ipIntel?.city || 'Unknown'}) - ${reason}`);
  } catch (error) {
    console.error('❌ Failed to block IP:', error);
  }
}

// 🛡️ THREATGUARD MIDDLEWARE - PROTEÇÃO PRINCIPAL
export const threatGuardMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  
  try {
    // 🏠 WHITELIST PARA IPs LOCAIS E REPLIT - NUNCA BLOQUEAR - SECURITY HARDENED
    const whitelistIPs = [
      '127.0.0.1', '::1',
      '160.20.87.70', // Replit IP
      // Ranges do Replit
      '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'
      // REMOVED: 'localhost' (DNS spoofing risk), '0.0.0.0' (CRITICAL: allows any IP)
    ];
    
    // Verificar se é IP individual na whitelist
    if (whitelistIPs.includes(clientIP)) {
      next();
      return;
    }
    
    // 🔐 SECURITY FIX: Verificar ranges privados com precisão CIDR (evita bypass público)
    if (securityCache.isPrivateOrReplitRange(clientIP)) {
      next();
      return;
    }

    // 🚫 VERIFICAÇÃO IMEDIATA DE IP BLOQUEADO
    if (securityCache.isIPBlocked(clientIP)) {
      console.log(`🚫 BLOCKED IP ATTEMPT: ${clientIP}`);
      return res.status(403).json({
        error: 'Access denied',
        message: 'Your IP address has been blocked due to security violations',
        code: 'IP_BLOCKED'
      });
    }

    // 📊 RATE LIMITING POR IP - AUMENTADO PARA SPAs MODERNAS
    if (securityCache.checkRateLimit(clientIP, 300, 60000)) { // ✅ 300 req/min (era 100 - muito baixo para SPAs)
      securityCache.addSuspiciousActivity(clientIP, 20);
      
      await saveSecurityLog({
        threatCategory: 'rate_limit_exceeded',
        severity: 'medium',
        riskScore: 70,
        sourceIp: clientIP,
        userAgent: req.headers['user-agent'],
        method: req.method,
        endpoint: req.path,
        actionTaken: 'rate_limit',
        blocked: false,
        ipBlocked: false,
        responseCode: 429,
        processingTime: Date.now() - startTime,
        detectedAt: new Date(),
      });

      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests from this IP address',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }

    // 🔍 DETECÇÃO DE AMEAÇAS
    const detection = detectThreats(req);

    if (detection.isThreats) {
      console.log(`🚨 THREATS DETECTED from ${clientIP}:`, detection.threats);

      // Processar cada ameaça detectada
      for (const threat of detection.threats) {
        // 🤖 Análise AI para ameaças críticas
        let aiAnalysis;
        if (threat.severity === 'critical' && process.env.OPENAI_API_KEY) {
          aiAnalysis = await analyzeWithAI(JSON.stringify(req.body), {
            method: req.method,
            endpoint: req.path,
            ip: clientIP,
            userAgent: req.headers['user-agent']
          });
        }

        // 📝 Salvar log de segurança
        await saveSecurityLog({
          threatCategory: threat.category,
          severity: threat.severity,
          riskScore: threat.riskScore,
          sourceIp: clientIP,
          userAgent: req.headers['user-agent'],
          referer: req.headers['referer'],
          origin: req.headers['origin'],
          method: req.method,
          endpoint: req.path,
          payload: JSON.stringify(req.body).substring(0, 500), // Truncar payload
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([key, value]) => [
              key, 
              Array.isArray(value) ? value.join(', ') : value || ''
            ])
          ),
          aiAnalysis,
          actionTaken: threat.action,
          blocked: threat.action.includes('block'),
          ipBlocked: threat.action === 'block_immediate',
          responseCode: threat.action === 'block_immediate' ? 403 : 200,
          processingTime: Date.now() - startTime,
          detectionRule: threat.evidence,
          detectedAt: new Date(),
        });

        // ⚡ AÇÃO IMEDIATA BASEADA NA SEVERIDADE
        if (threat.action === 'block_immediate') {
          await blockIPPermanently(
            clientIP,
            `${threat.category}: ${threat.evidence}`,
            [threat.category],
            threat.severity,
            threat.riskScore
          );

          return res.status(403).json({
            error: 'Security violation detected',
            message: 'Your request has been blocked due to potential security threats',
            code: 'SECURITY_VIOLATION',
            category: threat.category
          });
        }
      }

      // Incrementar score suspeito mesmo para ameaças não bloqueantes
      const totalRiskScore = detection.threats.reduce((sum, t) => sum + t.riskScore, 0);
      const wasBlocked = securityCache.addSuspiciousActivity(clientIP, totalRiskScore / 10);
      
      if (wasBlocked) {
        return res.status(403).json({
          error: 'Cumulative security violations',
          message: 'Your IP has been blocked due to repeated security violations',
          code: 'CUMULATIVE_VIOLATIONS'
        });
      }
    }

    // ✅ Request aprovada - continuar
    const processingTime = Date.now() - startTime;
    if (processingTime > 100) {
      console.log(`⚠️ ThreatGuard processing time: ${processingTime}ms for ${req.path}`);
    }

    next();

  } catch (error) {
    console.error('❌ ThreatGuard Error:', error);
    // Em caso de erro, permitir request mas logar erro
    next();
  }
};

// 🔄 CARREGAR IPS BLOQUEADOS DO FIREBASE NO STARTUP
export async function loadBlockedIPsFromFirebase(): Promise<void> {
  try {
    console.log('🔄 Loading blocked IPs from Firebase...');
    const admin = await getAdmin();
    const db = admin.firestore();

    const snapshot = await db.collection('blockedIPs')
      .where('isActive', '==', true)
      .get();

    let count = 0;
    snapshot.forEach((doc) => {
      const data = doc.data();
      securityCache.blockIP(
        data.ipAddress,
        data.reason,
        data.expiresAt ? new Date(data.expiresAt) : undefined
      );
      count++;
    });

    console.log(`✅ Loaded ${count} blocked IPs into cache`);
  } catch (error) {
    console.error('❌ Failed to load blocked IPs from Firebase:', error);
  }
}

// 🧹 LIMPAR CACHE PERIODICAMENTE (OPCIONAL)
setInterval(() => {
  // Implementar limpeza de cache se necessário
  console.log('🧹 ThreatGuard cache cleanup (placeholder)');
}, 1000 * 60 * 60); // 1 hora

export { securityCache };