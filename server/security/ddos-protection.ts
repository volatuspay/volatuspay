// 🛡️ PROTEÇÃO DDOS CASEIRA AVANÇADA
// Sistema completo de rate limiting e detecção de ataques

import { Request, Response, NextFunction } from 'express';
import { addSuspiciousIP } from './anti-cheat.js';
import { addSuspiciousIPToPermanentBlacklist, isInternalIP } from './persistent-ip-blacklist.js';
import { logAggregator } from './log-aggregator.js';

// 📊 ESTRUTURAS DE CONTROLE
interface IPInfo {
  requests: number[];
  blocked: boolean;
  blockUntil: number;
  totalRequests: number;
  suspiciousActivity: string[];
  firstSeen: number;
}

interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  punishment: number; // Tempo de bloqueio em ms
}

// 🔧 NORMALIZAR PATH PARA EVITAR BYPASS DE RATE LIMITING
function normalizePath(path: string): string {
  // Remove trailing slashes
  let normalized = path.replace(/\/+$/, '');
  // Converte para lowercase
  normalized = normalized.toLowerCase();
  // Remove query strings
  normalized = normalized.split('?')[0];
  // Remove fragments
  normalized = normalized.split('#')[0];
  // Normaliza múltiplas barras para uma só
  normalized = normalized.replace(/\/+/g, '/');
  // Se ficou vazio, retorna /
  return normalized || '/';
}

// 🔍 ENCONTRAR MELHOR MATCH DE RATE LIMIT (mais específico primeiro)
function findRateLimitRule(path: string): RateLimitRule {
  const normalizedPath = normalizePath(path);
  
  // 1. Match exato
  if (RATE_LIMITS[normalizedPath]) {
    return RATE_LIMITS[normalizedPath];
  }
  
  // 2. Match por prefixo (mais específico primeiro)
  const sortedKeys = Object.keys(RATE_LIMITS)
    .filter(k => k !== 'default')
    .sort((a, b) => b.length - a.length); // Mais longos primeiro
  
  for (const key of sortedKeys) {
    if (normalizedPath.startsWith(key)) {
      return RATE_LIMITS[key];
    }
  }
  
  // 3. Default (mais restritivo que antes para segurança)
  return RATE_LIMITS['default'];
}

// 🎯 REGRAS DE RATE LIMITING POR ROTA - GENEROSO PARA SPAs MODERNAS
const RATE_LIMITS: { [key: string]: RateLimitRule } = {
  '/api/auth/login': { windowMs: 60000, maxRequests: 20, punishment: 60000 }, // ✅ 20 req/min (era 15)
  '/api/auth/register': { windowMs: 60000, maxRequests: 15, punishment: 120000 }, // ✅ 15 req/min (era 10)
  '/api/orders': { windowMs: 60000, maxRequests: 2000, punishment: 60000 }, // ✅ 2000 req/min - Dashboard precisa de muito
  '/api/admin': { windowMs: 60000, maxRequests: 2000, punishment: 30000 }, // ✅ 2000 req/min - Admin dashboard
  '/api/payments': { windowMs: 120000, maxRequests: 20, punishment: 120000 }, // ✅ 20 req/2min (era 15)
  '/api/seller': { windowMs: 60000, maxRequests: 2000, punishment: 30000 }, // ✅ 2000 req/min - Seller dashboard precisa de muito
  '/api/products': { windowMs: 60000, maxRequests: 2000, punishment: 30000 }, // ✅ 2000 req/min - Dashboard precisa de muito
  '/api/checkouts': { windowMs: 60000, maxRequests: 2000, punishment: 30000 }, // ✅ 2000 req/min - Dashboard checkouts
  '/api/upload': { windowMs: 3600000, maxRequests: 1000, punishment: 30000 }, // ✅ 1000 req/hora - Upload de imagens de produtos
  'default': { windowMs: 60000, maxRequests: 10000, punishment: 10000 } // ✅ 10000 req/min - VITE DEV MODE PRECISA DE MUITO MAIS
};

// 💾 ARMAZENAMENTO EM MEMÓRIA (para performance máxima)
const ipDatabase = new Map<string, IPInfo>();
const ddosAlerts = new Map<string, number>();

// 🧹 LIMPEZA AUTOMÁTICA DE DADOS ANTIGOS
setInterval(() => {
  const now = Date.now();
  const cleanupTime = 24 * 60 * 60 * 1000; // 24 horas
  
  for (const [ip, info] of ipDatabase.entries()) {
    // Remover requests antigos
    info.requests = info.requests.filter(time => now - time < Math.max(...Object.values(RATE_LIMITS).map(r => r.windowMs)));
    
    // Remover IPs inativos há mais de 24h
    if (now - info.firstSeen > cleanupTime && info.requests.length === 0) {
      ipDatabase.delete(ip);
    }
    
    // Desbloquear IPs com bloqueio expirado
    if (info.blocked && now > info.blockUntil) {
      info.blocked = false;
      info.blockUntil = 0;
      console.log(`🔓 IP ${ip} desbloqueado automaticamente`);
    }
  }
  
  console.log(`🧹 Limpeza: ${ipDatabase.size} IPs ativos em monitoramento`);
}, 600000); // ⚡ OTIMIZAÇÃO: A cada 10 minutos para menos overhead

// 🔍 DETECTOR DE PADRÕES SUSPEITOS
const detectSuspiciousPatterns = (ip: string, info: IPInfo, req: Request): string[] => {
  const patterns: string[] = [];
  const now = Date.now();
  const path = req.path || '';
  const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip?.includes('127.0.0.1');
  
  // 0. ENDPOINTS SENSÍVEIS E ALVOS DE PENTEST - APENAS ATAQUES REAIS
  // ✅ CORREÇÃO: Usar regex com boundaries para evitar falsos positivos
  // ❌ REMOVIDOS: /api/v1, /api/v2, /graphql, /swagger, /api-docs (rotas legítimas)
  const sensitivePatterns = [
    // Arquivos de configuração (boundary exato)
    /^\/(\.git|\.env|\.htaccess|\.config|\.aws|\.ssh)(\/|$)/,
    /^\/\.well-known\/(?!security\.txt$)/,  // Bloqueia .well-known/* exceto security.txt (RFC 9116)
    /^\/web\.config$/,
    /^\/(composer\.json|package\.json)$/,
    // Painéis administrativos (boundary exato, mas EXCLUIR /api/admin)
    /^\/(administrator|phpmyadmin|wp-admin|wp-login|manager|console|control|panel)(\/|$)/,
    // Arquivos sensíveis
    /^\/(backup|database|dump|export)(\/|$)/,
    /^\/(config|settings|configuration)\.php$/,
    // WordPress targets
    /^\/(xmlrpc|wp-json|wp-content|wp-includes)(\/|$|\.php)/,
    // Laravel/PHP
    /^\/\.env\.(local|production)$/,
    /^\/storage\/logs(\/|$)/,
    // Testes comuns de pentest (não desenvolvimento legítimo)
    /^\/(trace|actuator)(\/|$)/,
    // Arquivos de backup (extensões suspeitas)
    /\.(bak|old|backup|swp|save)$/,
    /~$/,
    // Server info
    /^\/(server-status|server-info|phpinfo)(\/|$|\.php)/
  ];
  
  if (!isLocalhost) {
    // ✅ WHITELIST: Excluir rotas legítimas explicitamente
    // ✅ CORREÇÃO: Normalizar case para consistência com sensitivePatterns
    const legitimatePaths = [
      /^\/api\/admin(\/|$)/, // Rota legítima do dashboard
      /^\/api\/v\d+(\/|$)/, // APIs versionadas legítimas
      /^\/api\/(graphql|swagger|docs)(\/|$)/, // APIs documentadas legítimas
      /^\/admin(\/|$)/, // Área administrativa legítima
      /^\/test(\/|$)/, // Ambiente de testes legítimo
      /^\/dev(\/|$)/, // Ambiente de desenvolvimento legítimo
      /^\/debug(\/|$)/ // Debug legítimo em desenvolvimento
    ];
    
    const isLegitimate = legitimatePaths.some(pattern => pattern.test(path.toLowerCase()));
    
    if (!isLegitimate) {
      for (const pattern of sensitivePatterns) {
        if (pattern.test(path.toLowerCase())) {
          patterns.push('SENSITIVE_ENDPOINT_SCAN');
          console.log(`⚠️ ACESSO SUSPEITO A ENDPOINT: ${path} - IP ${ip} (monitoramento, não bloqueio)`);
          // ✅ CORREÇÃO: Apenas MEDIUM para monitoramento, não bloqueio automático
          addSuspiciousIPToPermanentBlacklist(
            ip, 
            `Scan de endpoint sensível: ${path}`, 
            'medium' // ✅ MEDIUM = monitoramento, não bloqueio imediato
          ).catch(err => console.error('Erro ao adicionar à watchlist:', err));
          break;
        }
      }
    }
  }
  
  // 1. Rajada de requests (>1000 req em 10 segundos) - mais permissivo para desenvolvimento
  const last10Seconds = info.requests.filter(time => now - time < 10000);
  if (last10Seconds.length > 1000) {
    patterns.push('BURST_ATTACK');
  }
  
  // 1.1 DETECÇÃO AVANÇADA: Padrão de timing de pentest automatizado
  // ✅ CORREÇÃO: Timing muito rigoroso, pode detectar SPAs normais com HTTP/2
  // Apenas monitorar, não bloquear automaticamente
  if (!isLocalhost && info.requests.length >= 50) { // ✅ Aumentado de 10 para 50
    const last20Requests = info.requests.slice(-20);
    const intervals: number[] = [];
    
    for (let i = 1; i < last20Requests.length; i++) {
      intervals.push(last20Requests[i] - last20Requests[i - 1]);
    }
    
    // Calcular desvio padrão dos intervalos
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    
    // ✅ CORREÇÃO: Threshold MUITO mais rigoroso para evitar falsos positivos
    if (stdDev < 50 && avg < 500) { // ✅ Menos de 50ms de variação, média < 500ms (muito suspeito)
      patterns.push('AUTOMATED_PENTEST_TIMING');
      console.log(`⚠️ TIMING SUSPEITO (monitoramento): IP ${ip} - StdDev: ${stdDev.toFixed(2)}ms, Avg: ${avg.toFixed(2)}ms`);
      // ✅ MEDIUM = apenas monitoramento, não bloqueio
      addSuspiciousIPToPermanentBlacklist(
        ip,
        `Padrão de timing suspeito detectado (monitoramento)`,
        'medium' // ✅ MEDIUM = monitoramento, não bloqueio
      ).catch(err => console.error('Erro ao adicionar à watchlist:', err));
    }
  }
  
  // 2. Requests muito frequentes (>200 req/segundo por 3+ segundos) - mais permissivo
  for (let i = 0; i < 3; i++) {
    const windowStart = now - ((i + 1) * 1000);
    const windowEnd = now - (i * 1000);
    const requestsInWindow = info.requests.filter(time => time >= windowStart && time < windowEnd);
    if (requestsInWindow.length > 200) {
      patterns.push('HIGH_FREQUENCY');
      break;
    }
  }
  
  // 3. Muitas rotas diferentes em pouco tempo (DESABILITADO para desenvolvimento)
  // Vite faz muitos requests para componentes React separados
  const isViteDevFile = path.includes('/src/') || path.includes('.tsx') || path.includes('.ts') || path.includes('.jsx') || path.includes('.js');
  
  if (!isViteDevFile && !isLocalhost) {
    const recentRequests = info.requests.filter(time => now - time < 30000); // Últimos 30s
    if (recentRequests.length > 100) { // Aumentado de 20 para 100
      patterns.push('ROUTE_SCANNING');
    }
    
    // 3.1 DETECÇÃO: Path Traversal (APENAS SE TEM ..)
    // ✅ CRÍTICO: ../ é tentativa clara de path traversal
    if (req.path.includes('..')) { // Path traversal attempt
      patterns.push('PATH_TRAVERSAL_ATTACK');
      console.log(`🚨 PATH TRAVERSAL DETECTADO: ${path} - IP ${ip} - BLOQUEIO CRÍTICO`);
      addSuspiciousIPToPermanentBlacklist(
        ip,
        `Path traversal attack detectado: ${path}`,
        'critical' // ✅ CRITICAL correto - path traversal é ataque real
      ).catch(err => console.error('Erro ao bloquear IP:', err));
    }
  }
  
  // 4. User-Agent suspeito (ATIVADO para ferramentas de ataque)
  const userAgent = req.headers['user-agent'] || '';
  
  // 🚨 FERRAMENTAS DE ATAQUE E PENTEST - BLOQUEIO AUTOMÁTICO PERMANENTE
  const attackTools = [
    // Scanners de diretórios
    'feroxbuster', 'dirbuster', 'dirb', 'gobuster', 'wfuzz', 'ffuf',
    // Scanners de vulnerabilidades
    'sqlmap', 'nikto', 'nmap', 'masscan', 'acunetix', 'nessus', 'openvas',
    // Frameworks de exploit
    'metasploit', 'burp', 'burpsuite', 'zap', 'zaproxy', 'owasp',
    // Brute force
    'hydra', 'medusa', 'thc-hydra', 'john', 'hashcat',
    // Network scanners
    'nmap', 'masscan', 'zenmap', 'angry ip', 'netcat', 'nc.exe',
    // Web proxies profissionais
    'mitmproxy', 'charles', 'fiddler', 'proxychains',
    // Outros
    'kali', 'parrot', 'pentoo', 'blackarch', 'w3af', 'skipfish',
    'arachni', 'vega', 'commix', 'beef', 'xsser', 'havij', 'webscarab'
  ];
  
  if (!isLocalhost) {
    // Verificar ferramentas de ataque e pentest
    for (const tool of attackTools) {
      if (userAgent.toLowerCase().includes(tool)) {
        patterns.push('ATTACK_TOOL_DETECTED');
        console.log(`🚨 FERRAMENTA DE PENTEST DETECTADA: ${tool} - IP ${ip} - BLOQUEIO CRÍTICO`);
        // ✅ CRITICAL correto - ferramentas de ataque são ameaças reais
        addSuspiciousIPToPermanentBlacklist(
          ip, 
          `Ferramenta de pentest detectada: ${tool}`, 
          'critical' // ✅ CRITICAL correto
        ).catch(err => console.error('Erro ao bloquear IP:', err));
        break;
      }
    }
    
    // 🔍 DETECÇÃO AVANÇADA: Padrões de User-Agent de pentest
    const pentestPatterns = [
      /burp.*suite/i,
      /metasploit/i,
      /nmap.*scripting/i,
      /sqlmap/i,
      /nikto/i,
      /owasp.*zap/i,
      /mozilla.*compatible.*msie.*windows.*trident/i, // Burp default UA
      /python.*requests/i,
      /ruby.*rest/i,
      /java.*apache.*http/i,
    ];
    
    for (const pattern of pentestPatterns) {
      if (pattern.test(userAgent)) {
        patterns.push('PENTEST_UA_PATTERN');
        console.log(`🚨 PADRÃO DE PENTEST NO USER-AGENT: ${userAgent.substring(0, 50)} - IP ${ip}`);
        addSuspiciousIPToPermanentBlacklist(
          ip, 
          `Padrão de pentest no User-Agent: ${userAgent.substring(0, 100)}`, 
          'critical'
        ).catch(err => console.error('Erro ao bloquear IP:', err));
        break;
      }
    }
    
    // 🔍 DETECÇÃO: Headers suspeitos típicos de ferramentas de pentest
    // ❌ REMOVIDO x-forwarded-for - É HEADER LEGÍTIMO usado por proxies/load balancers (Replit, CDNs, etc)
    const headers = req.headers;
    const pentestHeaders = [
      // 'x-forwarded-for', // ❌ REMOVIDO - HEADER LEGÍTIMO!
      'x-scanner', // Headers customizados de scanners
      'x-attack-type',
      'x-sqlmap',
      'x-burp',
    ];
    
    for (const header of pentestHeaders) {
      if (headers[header]) {
        patterns.push('PENTEST_HEADERS');
        console.log(`🚨 HEADER DE PENTEST DETECTADO: ${header} - IP ${ip}`);
        addSuspiciousIPToPermanentBlacklist(
          ip, 
          `Header suspeito de pentest: ${header}`, 
          'high'
        ).catch(err => console.error('Erro ao bloquear IP:', err));
        break;
      }
    }
    
    // Verificar outros user agents suspeitos
    const suspiciousAgents = [
      'bot', 'crawler', 'spider', 'scraper', 'python',
      'go-http-client', 'apache-httpclient', 'java/'
    ];
    
    if (suspiciousAgents.some(agent => userAgent.toLowerCase().includes(agent))) {
      patterns.push('SUSPICIOUS_USER_AGENT');
    }
  }
  
  // 5. Requests sem referer em massa (DESABILITADO para desenvolvimento)
  const recentRequests = info.requests.filter(time => now - time < 30000); // Últimos 30s
  if (!req.headers.referer && recentRequests.length > 100) { // Mais permissivo
    patterns.push('NO_REFERER_MASS');
  }
  
  // 6. Múltiplos métodos HTTP em sequência (DESABILITADO para desenvolvimento)
  // const methods = new Set([req.method]);
  // if (methods.size > 3 && recentRequests.length > 15) {
  //   patterns.push('METHOD_SWITCHING');
  // }
  
  return patterns;
};

// 🚨 SISTEMA DE ALERTAS DDOS
const triggerDDoSAlert = async (ip: string, patterns: string[], info: IPInfo, endpoint?: string, userAgent?: string) => {
  const alertKey = `${ip}_${Date.now()}`;
  ddosAlerts.set(alertKey, Date.now());
  
  console.log(`🚨 ALERTA DDOS: IP ${ip} detectado com padrões: ${patterns.join(', ')}`);
  console.log(`📊 Estatísticas: ${info.totalRequests} requests totais, ${info.requests.length} recentes`);
  
  // Auto-bloqueio PERMANENTE apenas em casos REALMENTE CRÍTICOS
  const criticalPatterns = [
    'BURST_ATTACK', // DDoS massivo
    'HIGH_FREQUENCY', // Requests extremamente frequentes
    'ATTACK_TOOL_DETECTED', // Ferramentas de pentest detectadas
    'PENTEST_UA_PATTERN', // User-Agent de pentest
    'PENTEST_HEADERS', // Headers de pentest
    'PATH_TRAVERSAL_ATTACK' // Ataques de traversal
  ];
  
  const isCritical = patterns.some(p => criticalPatterns.includes(p));
  const severity = isCritical ? 'critical' : (patterns.length > 2 ? 'high' : 'medium');
  
  // 📊 SALVAR LOG NO FIREBASE VIA AGGREGATOR (formato correto para dashboard)
  try {
    await logAggregator.addLog({
      id: `ddos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ipAddress: ip,
      threatCategory: 'ddos_attack',
      severity: severity,
      endpoint: endpoint || '/unknown',
      userAgent: userAgent || 'unknown',
      detectedAt: new Date(),
      riskScore: isCritical ? 95 : 85, // >= 80 para persistir imediatamente
      actionTaken: isCritical ? 'block_permanent' : 'block_immediate',
      evidence: JSON.stringify({
        patterns,
        totalRequests: info.totalRequests,
        recentRequests: info.requests.length,
        firstSeen: new Date(info.firstSeen).toISOString(),
        suspiciousActivities: info.suspiciousActivity
      })
    });
    console.log(`💾 Log DDoS salvo no Firebase: ${ip} - ${patterns.join(', ')}`);
  } catch (err) {
    console.error('❌ Erro ao salvar log DDoS no Firebase:', err);
  }
  
  if (isCritical) {
    addSuspiciousIP(ip, `Ataque crítico detectado: ${patterns.join(', ')}`);
    
    // Adicionar à blacklist permanente para bloqueios críticos
    addSuspiciousIPToPermanentBlacklist(
      ip,
      `Ataque crítico detectado: ${patterns.join(', ')}`,
      'critical'
    ).catch(err => console.error('Erro ao bloquear IP permanentemente:', err));
  } else if (patterns.length > 0) {
    // Padrões não-críticos: apenas monitoramento
    console.log(`⚠️ Padrões suspeitos em monitoramento: ${ip} - ${patterns.join(', ')}`);
  }
};

// 🛡️ MIDDLEWARE PRINCIPAL DE PROTEÇÃO
// 🧹 FUNÇÃO PARA LIMPAR TODOS OS BLOQUEIOS
export const clearAllBlocks = () => {
  for (const [ip, info] of ipDatabase.entries()) {
    if (info.blocked) {
      info.blocked = false;
      info.blockUntil = 0;
      console.log(`🔓 IP ${ip} desbloqueado manualmente`);
    }
  }
};

export const ddosProtectionMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // 🔑 BYPASS: Requisições com API Key válida não sofrem rate limiting
  const keyHeader = req.headers['x-api-key'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  const apiKey = keyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);
  if (apiKey && (apiKey.startsWith('vp_live_') || apiKey.startsWith('vp_test_'))) {
    return next();
  }

  // 🟢 WHITELIST DE IPs CONFIÁVEIS - BYPASS COMPLETO
  const trustedIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '160.20.87.98'];
  if (trustedIPs.includes(ip)) {
    // IPs confiáveis: bypass total, sem rate limiting
    return next();
  }
  
  // ✅ WHITELIST INTELIGENTE: Verificar se é IP interno/Replit
  if (isInternalIP(ip)) {
    // Desbloquear se estava bloqueado temporariamente
    if (ipDatabase.has(ip)) {
      const ipInfo = ipDatabase.get(ip)!;
      if (ipInfo.blocked) {
        ipInfo.blocked = false;
        ipInfo.blockUntil = 0;
        console.log(`🔓 IP interno ${ip} desbloqueado (auto-correção DDoS)`);
      }
    }
    return next();
  }
  
  const now = Date.now();
  const route = req.route?.path || req.path;
  
  // Inicializar dados do IP se não existir
  if (!ipDatabase.has(ip)) {
    ipDatabase.set(ip, {
      requests: [],
      blocked: false,
      blockUntil: 0,
      totalRequests: 0,
      suspiciousActivity: [],
      firstSeen: now
    });
  }
  
  const ipInfo = ipDatabase.get(ip)!;
  
  // Verificar se IP está bloqueado
  if (ipInfo.blocked && now < ipInfo.blockUntil) {
    const remainingTime = Math.ceil((ipInfo.blockUntil - now) / 1000);
    console.log(`🚫 IP bloqueado ${ip} tentou acessar ${route} - ${remainingTime}s restantes`);
    
    return res.status(429).json({
      error: 'Muitas tentativas. Tente novamente mais tarde.',
      retryAfter: remainingTime,
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
  
  // Determinar regra de rate limit (com normalização para evitar bypass)
  const rateRule = findRateLimitRule(route);
  const windowStart = now - rateRule.windowMs;
  
  // Limpar requests antigas da janela
  ipInfo.requests = ipInfo.requests.filter(time => time > windowStart);
  
  // Adicionar request atual
  ipInfo.requests.push(now);
  ipInfo.totalRequests++;
  
  // Verificar se excedeu o limite
  if (ipInfo.requests.length > rateRule.maxRequests) {
    console.log(`⚠️ Rate limit excedido: ${ip} - ${ipInfo.requests.length}/${rateRule.maxRequests} em ${rateRule.windowMs}ms`);
    
    // Bloquear IP
    ipInfo.blocked = true;
    ipInfo.blockUntil = now + rateRule.punishment;
    ipInfo.suspiciousActivity.push(`RATE_LIMIT_${route}_${now}`);
    
    // 📊 SALVAR LOG DE RATE LIMIT NO FIREBASE VIA AGGREGATOR
    logAggregator.addLog({
      id: `ratelimit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ipAddress: ip,
      threatCategory: 'rate_limit_exceeded',
      severity: 'medium',
      endpoint: route,
      userAgent: req.headers['user-agent'] as string || 'unknown',
      detectedAt: new Date(),
      riskScore: 80, // >= 80 para persistir imediatamente
      actionTaken: 'block_immediate',
      evidence: JSON.stringify({
        pattern: 'RATE_LIMIT_EXCEEDED',
        requests: ipInfo.requests.length,
        maxRequests: rateRule.maxRequests,
        windowMs: rateRule.windowMs,
        punishment: rateRule.punishment,
        route: route
      })
    }).catch(err => console.error('❌ Erro ao salvar log rate limit:', err));
    
    // Detectar padrões suspeitos
    const suspiciousPatterns = detectSuspiciousPatterns(ip, ipInfo, req);
    if (suspiciousPatterns.length > 0) {
      triggerDDoSAlert(ip, suspiciousPatterns, ipInfo, route, req.headers['user-agent'] as string);
    }
    
    // ℹ️ Banimento permanente por rate limit DESABILITADO — usuários legítimos
    // (ex: sellers carregando dashboard) poderiam ser banidos permanentemente
    // por fazerem múltiplas chamadas API simultâneas. Bloqueio temporário é suficiente.
    
    return res.status(429).json({
      error: 'Muitas tentativas. Tente novamente mais tarde.',
      retryAfter: Math.ceil(rateRule.punishment / 1000),
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
  
  // Verificar padrões suspeitos mesmo sem exceder limite
  if (ipInfo.requests.length > rateRule.maxRequests * 0.8) { // 80% do limite
    const suspiciousPatterns = detectSuspiciousPatterns(ip, ipInfo, req);
    if (suspiciousPatterns.length >= 2) { // Múltiplos padrões
      console.log(`⚠️ Comportamento suspeito detectado: ${ip} - ${suspiciousPatterns.join(', ')}`);
      ipInfo.suspiciousActivity.push(...suspiciousPatterns.map(p => `${p}_${now}`));
    }
  }
  
  // Adicionar headers informativos
  res.set({
    'X-RateLimit-Limit': rateRule.maxRequests.toString(),
    'X-RateLimit-Remaining': Math.max(0, rateRule.maxRequests - ipInfo.requests.length).toString(),
    'X-RateLimit-Reset': new Date(now + rateRule.windowMs).toISOString()
  });
  
  const processingTime = Date.now() - startTime;
  console.log(`🛡️ DDoS Protection: ${ip} → ${route} (${ipInfo.requests.length}/${rateRule.maxRequests}) - ${processingTime}ms`);
  
  next();
};

// 📊 API DE ESTATÍSTICAS DE SEGURANÇA
export const getSecurityStats = () => {
  const now = Date.now();
  const activeIPs = Array.from(ipDatabase.entries()).map(([ip, info]) => ({
    ip: ip.replace(/\d+$/, 'xxx'), // Anonymizar último octeto
    totalRequests: info.totalRequests,
    recentRequests: info.requests.filter(time => now - time < 300000).length, // Últimos 5min
    blocked: info.blocked,
    suspiciousActivity: info.suspiciousActivity.length,
    firstSeen: new Date(info.firstSeen).toISOString()
  }));
  
  const recentAlerts = Array.from(ddosAlerts.entries())
    .filter(([_, time]) => now - time < 3600000) // Última hora
    .length;
  
  return {
    totalMonitoredIPs: ipDatabase.size,
    blockedIPs: activeIPs.filter(ip => ip.blocked).length,
    recentAlerts,
    topActiveIPs: activeIPs
      .sort((a, b) => b.recentRequests - a.recentRequests)
      .slice(0, 10),
    systemUptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
};

// 🔧 CONFIGURAÇÃO DINÂMICA DE REGRAS
export const updateRateLimit = (route: string, rule: RateLimitRule) => {
  RATE_LIMITS[route] = rule;
  console.log(`⚙️ Rate limit atualizado para ${route}:`, rule);
};

// 🚫 BLOQUEIO MANUAL DE IP
export const blockIP = (ip: string, durationMs: number, reason: string) => {
  if (!ipDatabase.has(ip)) {
    ipDatabase.set(ip, {
      requests: [],
      blocked: false,
      blockUntil: 0,
      totalRequests: 0,
      suspiciousActivity: [],
      firstSeen: Date.now()
    });
  }
  
  const ipInfo = ipDatabase.get(ip)!;
  ipInfo.blocked = true;
  ipInfo.blockUntil = Date.now() + durationMs;
  ipInfo.suspiciousActivity.push(`MANUAL_BLOCK_${reason}_${Date.now()}`);
  
  console.log(`🚫 IP ${ip} bloqueado manualmente por ${durationMs}ms - ${reason}`);
  addSuspiciousIP(ip, reason);
};

// 🔓 DESBLOQUEIO MANUAL DE IP
export const unblockIP = (ip: string) => {
  const ipInfo = ipDatabase.get(ip);
  if (ipInfo) {
    ipInfo.blocked = false;
    ipInfo.blockUntil = 0;
    console.log(`🔓 IP ${ip} desbloqueado manualmente`);
  }
};