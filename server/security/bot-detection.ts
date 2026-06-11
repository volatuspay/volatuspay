// 🤖 SISTEMA DEVASTADOR DE DETECÇÃO DE BOTS E AUTOMAÇÃO
// Proteção inteligente contra farming, scraping e automação maliciosa

interface DeviceFingerprint {
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  connection: string;
  contentType?: string;
  referer?: string;
  origin?: string;
}

interface BehaviorMetrics {
  requestInterval: number;    // Tempo entre requests em ms
  formFillTime: number;      // Tempo para preencher formulário
  mouseMovements: boolean;   // Se houve movimentos de mouse
  keyboardEvents: boolean;   // Se houve eventos de teclado
  scrollEvents: boolean;     // Se houve scroll
  timestamp: number;
}

interface BotDetectionResult {
  isBot: boolean;
  confidence: number; // 0-100
  reasons: string[];
  riskScore: number; // 0-100  
  action: 'allow' | 'challenge' | 'block';
}

// 🎯 CONFIGURAÇÃO DE DETECÇÃO
const BOT_DETECTION_CONFIG = {
  // Limites de comportamento suspeito
  thresholds: {
    minFormFillTime: 500,         // ✅ Mínimo 0.5s para preencher formulário (era 2s - muito agressivo)
    maxFormFillTime: 300000,      // Máximo 5min (não deve ser robô)
    minRequestInterval: 100,      // Mínimo 100ms entre requests
    maxRequestsPerSecond: 10,     // Máximo 10 requests/segundo
    suspiciousKeywords: [
      'bot', 'crawler', 'spider', 'scraper', 'automation', 
      'selenium', 'playwright', 'puppeteer', 'headless',
      'curl', 'wget', 'python-requests', 'axios'
    ]
  },
  
  // Pontuação de risco - AJUSTADO PARA USUÁRIOS LEGÍTIMOS
  riskWeights: {
    honeypotFilled: 100,          // Honeypot = bot confirmado
    suspiciousUserAgent: 30,      // ✅ User agent suspeito (reduzido de 40)
    noJavaScript: 20,             // ✅ Sem JavaScript (reduzido de 30 - SPAs legítimas)
    tooFastFormFill: 10,          // ✅ Preenchimento rápido (reduzido de 15 - usuários experientes)
    noMouseMovement: 5,           // ✅ Sem movimento mouse (reduzido de 15 - mobile/touch)
    repeatedPattern: 25,          // ✅ Padrão repetitivo (reduzido de 30)
    invalidFingerprint: 15,       // ✅ Fingerprint inválido (reduzido de 20)
    noReferer: 0,                 // ✅ Sem referer (ZERO - browsers modernos bloqueiam)
    suspiciousHeaders: 10         // ✅ Headers suspeitos (reduzido de 15)
  }
};

// 🧠 CACHE DE FINGERPRINTS E COMPORTAMENTOS
class BotDetectionEngine {
  private fingerprintCache = new Map<string, DeviceFingerprint>();
  private behaviorCache = new Map<string, BehaviorMetrics[]>();
  private suspiciousIPs = new Set<string>();
  private blockedFingerprints = new Set<string>();
  
  // 🔍 ANALISAR REQUEST PARA DETECÇÃO DE BOT
  analyzeRequest(req: any, formData?: any): BotDetectionResult {
    const ip = this.getClientIP(req);
    const fingerprint = this.generateFingerprint(req);
    const riskFactors: string[] = [];
    let riskScore = 0;
    
    
    // 1️⃣ VERIFICAR HONEYPOT (DETECÇÃO INSTANTÂNEA)
    if (formData && this.checkHoneypot(formData)) {
      riskFactors.push('Honeypot field filled');
      riskScore += BOT_DETECTION_CONFIG.riskWeights.honeypotFilled;
      console.log(`🚨 BOT DETECTED: Honeypot filled by IP=${ip}`);
    }
    
    // 2️⃣ ANALISAR USER AGENT
    const uaAnalysis = this.analyzeUserAgent(req.headers['user-agent'] || '');
    if (uaAnalysis.suspicious) {
      riskFactors.push(`Suspicious User-Agent: ${uaAnalysis.reason}`);
      riskScore += BOT_DETECTION_CONFIG.riskWeights.suspiciousUserAgent;
    }
    
    // 3️⃣ VERIFICAR HEADERS SUSPEITOS
    const headerAnalysis = this.analyzeHeaders(req.headers);
    if (headerAnalysis.suspicious) {
      riskFactors.push(`Suspicious headers: ${headerAnalysis.reasons.join(', ')}`);
      riskScore += BOT_DETECTION_CONFIG.riskWeights.suspiciousHeaders;
    }
    
    // 4️⃣ ANALISAR COMPORTAMENTO TEMPORAL
    const behaviorAnalysis = this.analyzeBehavior(ip, req);
    if (behaviorAnalysis.suspicious) {
      riskFactors.push(`Suspicious behavior: ${behaviorAnalysis.reasons.join(', ')}`);
      riskScore += behaviorAnalysis.riskScore;
    }
    
    // 5️⃣ VERIFICAR JAVASCRIPT E CAPACIDADES
    const jsAnalysis = this.analyzeJavaScriptCapabilities(req, formData);
    if (jsAnalysis.suspicious) {
      riskFactors.push(`No JavaScript capabilities: ${jsAnalysis.reason}`);
      riskScore += BOT_DETECTION_CONFIG.riskWeights.noJavaScript;
    }
    
    // 6️⃣ VERIFICAR FINGERPRINT REPETIDO
    if (this.blockedFingerprints.has(fingerprint)) {
      riskFactors.push('Blocked fingerprint detected');
      riskScore += BOT_DETECTION_CONFIG.riskWeights.invalidFingerprint;
    }
    
    // 🎯 DETERMINAR AÇÃO BASEADA NO RISCO
    const confidence = Math.min(riskScore, 100);
    let action: 'allow' | 'challenge' | 'block' = 'allow';
    
    // ✅ APENAS HONEYPOT BLOQUEIA DIRETO - Score alto = apenas challenge
    if (riskScore >= 100) { // ✅ APENAS honeypot (100 pontos) bloqueia direto
      action = 'block';
      this.suspiciousIPs.add(ip);
      this.blockedFingerprints.add(fingerprint);
    } else if (riskScore >= 70) { // ✅ Score alto = challenge (CAPTCHA futuro)
      action = 'challenge';
    }
    
    const result: BotDetectionResult = {
      isBot: riskScore >= 50,
      confidence,
      reasons: riskFactors,
      riskScore,
      action
    };
    
    
    return result;
  }
  
  // 🍯 VERIFICAR HONEYPOT FIELDS
  private checkHoneypot(formData: any): boolean {
    // Lista de nomes de campos honeypot comuns
    const honeypotFields = [
      'email_confirm', 'confirm_email', 'second_email', 'email2',
      'website', 'url', 'homepage', 'phone2', 'fax',
      'company_name', 'address2', 'zip_code',
      'hidden_field', 'bot_field', 'spam_check', 'security_check',
      'do_not_fill', 'leave_empty', 'anti_spam'
    ];
    
    for (const field of honeypotFields) {
      if (formData[field] && formData[field].toString().trim() !== '') {
        console.log(`🍯 HONEYPOT TRIGGERED: Field '${field}' was filled with value: '${formData[field]}'`);
        return true;
      }
    }
    
    return false;
  }
  
  // 🔍 ANALISAR USER AGENT
  private analyzeUserAgent(userAgent: string): { suspicious: boolean; reason?: string } {
    if (!userAgent || userAgent.length < 10) {
      return { suspicious: true, reason: 'Missing or too short' };
    }
    
    // Verificar palavras-chave suspeitas
    const lowerUA = userAgent.toLowerCase();
    for (const keyword of BOT_DETECTION_CONFIG.thresholds.suspiciousKeywords) {
      if (lowerUA.includes(keyword)) {
        return { suspicious: true, reason: `Contains keyword: ${keyword}` };
      }
    }
    
    // Verificar padrões comuns de bots
    const suspiciousPatterns = [
      /^python-/i,
      /^curl\//i,
      /^wget\//i,
      /^node-fetch/i,
      /^axios\//i,
      /headless/i,
      /automated/i,
      /phantom/i
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(userAgent)) {
        return { suspicious: true, reason: `Matches bot pattern: ${pattern}` };
      }
    }
    
    // User agents muito genéricos ou antigos
    if (userAgent === 'Mozilla/5.0' || userAgent.includes('compatible;')) {
      return { suspicious: true, reason: 'Generic or old user agent' };
    }
    
    return { suspicious: false };
  }
  
  // 📋 ANALISAR HEADERS HTTP - APENAS HEADERS OBVIAMENTE MALICIOSOS
  private analyzeHeaders(headers: any): { suspicious: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    // ✅ REMOVIDO: Headers faltando (accept-language, accept-encoding, connection)
    // Browsers modernos e proxies legítimos podem não enviar esses headers
    
    // ✅ APENAS verificar headers que EXPLICITAMENTE indicam automação
    const automationHeaders = [
      'x-automation', 'x-bot', 'x-crawler', 'x-scraper',
      'x-selenium', 'x-playwright', 'x-puppeteer'
    ];
    
    for (const header of automationHeaders) {
      if (headers[header]) {
        reasons.push(`Automation header: ${header}`);
      }
    }
    
    // ✅ REMOVIDO: Accept header genérico - muitos clients legítimos usam */*
    
    return { suspicious: reasons.length > 0, reasons };
  }
  
  // ⏱️ ANALISAR COMPORTAMENTO TEMPORAL
  private analyzeBehavior(ip: string, req: any): { suspicious: boolean; reasons: string[]; riskScore: number } {
    const now = Date.now();
    const reasons: string[] = [];
    let riskScore = 0;
    
    // Buscar histórico de comportamento para este IP
    const behaviors = this.behaviorCache.get(ip) || [];
    
    // Registrar nova interação
    const newBehavior: BehaviorMetrics = {
      requestInterval: behaviors.length > 0 ? now - behaviors[behaviors.length - 1].timestamp : 0,
      formFillTime: 0, // Será calculado no frontend e enviado
      mouseMovements: false, // Será enviado pelo frontend
      keyboardEvents: false, // Será enviado pelo frontend
      scrollEvents: false, // Será enviado pelo frontend
      timestamp: now
    };
    
    behaviors.push(newBehavior);
    
    // Manter apenas últimos 10 comportamentos
    if (behaviors.length > 10) {
      behaviors.shift();
    }
    
    this.behaviorCache.set(ip, behaviors);
    
    // Analisar padrões suspeitos
    if (behaviors.length >= 3) {
      // Verificar intervalos muito regulares (robótico)
      const intervals = behaviors.slice(-3).map(b => b.requestInterval).filter(i => i > 0);
      if (intervals.length >= 2) {
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
        
        // Variância muito baixa = comportamento robótico
        if (variance < 100 && avgInterval < 5000) {
          reasons.push('Robotic timing pattern');
          riskScore += BOT_DETECTION_CONFIG.riskWeights.repeatedPattern;
        }
      }
      
      // Verificar requests muito rápidos
      const fastRequests = intervals.filter(i => i < BOT_DETECTION_CONFIG.thresholds.minRequestInterval);
      if (fastRequests.length > 1) {
        reasons.push('Too fast requests');
        riskScore += BOT_DETECTION_CONFIG.riskWeights.tooFastFormFill;
      }
    }
    
    return { suspicious: reasons.length > 0, reasons, riskScore };
  }
  
  // 🖥️ ANALISAR CAPACIDADES JAVASCRIPT - MENOS AGRESSIVO
  private analyzeJavaScriptCapabilities(req: any, formData?: any): { suspicious: boolean; reason?: string } {
    // ✅ REMOVIDO: Verificação de timestamps - nem todos forms precisam
    // ✅ REMOVIDO: Verificação de Accept HTML - APIs legítimas não enviam
    
    // Apenas retornar não-suspeito - deixar honeypot fazer o trabalho
    return { suspicious: false };
  }
  
  // 🔢 GERAR FINGERPRINT ÚNICO
  private generateFingerprint(req: any): string {
    const components = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
      req.headers['accept'] || '',
      this.getClientIP(req)
    ];
    
    // Hash simples baseado nos componentes
    return Buffer.from(components.join('|')).toString('base64');
  }
  
  // 🌐 EXTRAIR IP REAL
  private getClientIP(req: any): string {
    return req.ip || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           'unknown';
  }
  
  // 🧹 LIMPEZA PERIÓDICA DE CACHE
  cleanup() {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hora
    
    // Limpar comportamentos antigos
    for (const [ip, behaviors] of this.behaviorCache.entries()) {
      const validBehaviors = behaviors.filter(b => now - b.timestamp < maxAge);
      if (validBehaviors.length === 0) {
        this.behaviorCache.delete(ip);
      } else {
        this.behaviorCache.set(ip, validBehaviors);
      }
    }
  }
}

// 🎯 SINGLETON GLOBAL
const botDetectionEngine = new BotDetectionEngine();

// Limpeza automática a cada 30 minutos
setInterval(() => {
  botDetectionEngine.cleanup();
}, 30 * 60 * 1000);

// 🛡️ MIDDLEWARE EXPRESS PARA DETECÇÃO DE BOTS - APENAS LOGGING
export const botDetectionMiddleware = (req: any, res: any, next: any) => {
  try {
    const result = botDetectionEngine.analyzeRequest(req, req.body);
    
    // Adicionar resultado à request para uso posterior
    req.botDetection = result;
    
    // ✅ NUNCA BLOQUEAR NO MIDDLEWARE - apenas logar para monitoramento
    // Bloqueio apenas via honeypot em formulários críticos
    
    if (result.action === 'block') {
      console.log(`⚠️ HIGH BOT RISK (não bloqueado): IP=${req.ip} Risk=${result.riskScore} Reasons=[${result.reasons.join(', ')}]`);
      // ✅ NÃO BLOQUEAR - apenas registrar
      res.set('X-Bot-Risk-Score', result.riskScore.toString());
    }
    
    if (result.action === 'challenge') {
      console.log(`📊 MODERATE BOT RISK: IP=${req.ip} Risk=${result.riskScore}`);
      res.set('X-Bot-Challenge', 'recommended');
    }
    
    // Log silencioso para scores baixos
    if (result.riskScore > 30) {
    }
    
    next();
  } catch (error: any) {
    console.error('❌ Bot detection error:', error);
    // Em caso de erro, deixar passar (fail-open)
    next();
  }
};

// 🎯 MIDDLEWARE ESPECÍFICO PARA FORMULÁRIOS CRÍTICOS
export const criticalFormBotDetection = (req: any, res: any, next: any) => {
  const result = botDetectionEngine.analyzeRequest(req, req.body);
  
  // Para formulários críticos, ser mais rigoroso
  if (result.riskScore >= 30) { // Limite mais baixo
    console.log(`🚫 CRITICAL FORM BOT BLOCK: IP=${req.ip} Risk=${result.riskScore}`);
    return res.status(403).json({
      error: 'Automated submission detected',
      message: 'Please complete the form manually',
      code: 'AUTOMATION_DETECTED'
    });
  }
  
  req.botDetection = result;
  next();
};

export { botDetectionEngine, BotDetectionResult };