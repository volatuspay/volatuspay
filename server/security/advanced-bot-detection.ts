// 🛡️ SISTEMA DEVASTADOR DE DETECÇÃO DE BOTS E MÁQUINAS FAKE
// Proteção contra automação, crawlers maliciosos e ataques simulados

import { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';

interface BotSignature {
  ip: string;
  userAgent: string;
  fingerprint: string;
  detectionReasons: string[];
  confidence: number; // 0-100
  firstSeen: number;
  lastSeen: number;
  totalRequests: number;
  blockedRequests: number;
  behaviorScore: number;
}

interface BotDetectionResult {
  isBot: boolean;
  confidence: number;
  reasons: string[];
  action: 'allow' | 'challenge' | 'block';
  challengeType?: 'captcha' | 'delay' | 'pow'; // proof of work
}

// 🤖 SINGLETON DEVASTADOR DE DETECÇÃO DE BOTS
class AdvancedBotDetection {
  private readonly collectionName = 'security_bot_signatures';
  private suspiciousPatterns = new Map<string, number>();
  private blockedIPs = new Map<string, number>();
  private allowedBots = new Set([
    'googlebot',
    'bingbot', 
    'slurp', // Yahoo
    'duckduckbot',
    'facebookexternalhit',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegrambot'
  ]);

  // 🔄 RESET AUTOMÁTICO PARA DESBLOQUEAR USUÁRIOS LEGÍTIMOS
  private resetBlockedIP(ip: string): void {
    this.blockedIPs.delete(ip);
    this.suspiciousPatterns.delete(ip);
  }

  // 🔍 ANALISAR REQUEST PARA DETECTAR BOTS (APENAS ATAQUES REAIS)
  async analyzeRequest(req: Request): Promise<BotDetectionResult> {
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || '';
    const fingerprint = this.generateFingerprint(req);
    
    // RESET AUTOMÁTICO PARA DESBLOQUEAR USUÁRIOS LEGÍTIMOS
    this.resetBlockedIP(ip);
    
    let confidence = 0;
    const reasons: string[] = [];

    // 1️⃣ VERIFICAR USER AGENT SUSPEITO
    const uaResult = this.analyzeUserAgent(userAgent);
    confidence += uaResult.confidence;
    reasons.push(...uaResult.reasons);

    // 2️⃣ ANÁLISE DE CABEÇALHOS HTTP (DESABILITADA PARA USUÁRIOS NORMAIS)
    // const headerResult = this.analyzeHeaders(req);
    // confidence += headerResult.confidence;
    // reasons.push(...headerResult.reasons);

    // 3️⃣ ANÁLISE DE COMPORTAMENTO (APENAS ATAQUES REAIS)
    const behaviorResult = await this.analyzeBehavior(ip, fingerprint, req);
    confidence += behaviorResult.confidence;
    reasons.push(...behaviorResult.reasons);

    // 4️⃣ ANÁLISE DE PADRÕES DE TIMING (DESABILITADO PARA USUÁRIOS NORMAIS)
    // const timingResult = this.analyzeTimingPatterns(ip);
    // confidence += timingResult.confidence;
    // reasons.push(...timingResult.reasons);

    // 5️⃣ VERIFICAR SE É BOT PERMITIDO
    if (this.isAllowedBot(userAgent)) {
      confidence = Math.max(0, confidence - 50);
      reasons.push('ALLOWED_BOT');
    }

    // 6️⃣ RESET AUTOMÁTICO DE BLOQUEIOS (MAIS PERMISSIVO)
    const blockedTime = this.blockedIPs.get(ip);
    if (blockedTime && Date.now() - blockedTime >= 300000) { // 5 minutos ao invés de 10
      // Reset bloqueio após 5 minutos
      this.blockedIPs.delete(ip);
      this.suspiciousPatterns.delete(ip);
    }

    // Normalizar confidence (máximo 100)
    confidence = Math.min(100, confidence);

    // Determinar ação baseada na confiança (mais permissivo)
    let action: 'allow' | 'challenge' | 'block' = 'allow';
    let challengeType: 'captcha' | 'delay' | 'pow' | undefined;

    if (confidence >= 95) {
      action = 'block';
      this.blockedIPs.set(ip, Date.now()); // Marcar IP como bloqueado temporariamente
    } else if (confidence >= 85) {
      action = 'challenge';
      challengeType = 'delay'; // Delay primeiro, menos intrusivo
    } else if (confidence >= 75) {
      action = 'challenge';
      challengeType = 'pow'; // Proof of work leve
    }

    // Salvar assinatura se suspeito (threshold mais alto)
    if (confidence >= 75) {
      await this.saveBotSignature(ip, userAgent, fingerprint, reasons, confidence);
    }

    // ✅ OTIMIZAÇÃO: Logar apenas se confiança alta (>= 50%) para evitar spam no console
    if (confidence >= 50 || action !== 'allow') {
      console.log(`🤖 BOT DETECTION: IP=${ip} Confidence=${confidence}% Action=${action} Reasons=[${reasons.join(', ')}]`);
    }

    return {
      isBot: confidence >= 85,
      confidence,
      reasons,
      action,
      challengeType
    };
  }

  // 🔍 ANALISAR USER AGENT
  private analyzeUserAgent(userAgent: string): { confidence: number; reasons: string[] } {
    const ua = userAgent.toLowerCase();
    let confidence = 0;
    const reasons: string[] = [];

    // User agent suspeitos
    const suspiciousUAs = [
      'curl', 'wget', 'python', 'java/', 'go-http-client', 
      'apache-httpclient', 'okhttp', 'axios', 'requests',
      'bot', 'crawler', 'spider', 'scraper', 'automation',
      'headless', 'phantom', 'selenium', 'playwright'
    ];

    for (const pattern of suspiciousUAs) {
      if (ua.includes(pattern)) {
        // Reduzir penalidade para HeadlessChrome (usado em desenvolvimento)
        const penalty = pattern === 'headless' ? 5 : 20;
        confidence += penalty;
        reasons.push(`SUSPICIOUS_UA_${pattern.toUpperCase()}`);
      }
    }

    // User agent vazio ou muito simples
    if (!userAgent || userAgent.length < 10) {
      confidence += 30;
      reasons.push('EMPTY_OR_SHORT_UA');
    }

    // Versões antigas/estranhas de navegadores
    if (ua.includes('mozilla') && !ua.includes('chrome') && !ua.includes('firefox') && !ua.includes('safari')) {
      confidence += 15;
      reasons.push('OUTDATED_BROWSER');
    }

    return { confidence, reasons };
  }

  // 🔍 ANALISAR HEADERS HTTP
  private analyzeHeaders(req: Request): { confidence: number; reasons: string[] } {
    let confidence = 0;
    const reasons: string[] = [];

    // Falta de headers essenciais
    if (!req.headers.accept) {
      confidence += 20;
      reasons.push('MISSING_ACCEPT_HEADER');
    }

    if (!req.headers['accept-language']) {
      confidence += 15;
      reasons.push('MISSING_ACCEPT_LANGUAGE');
    }

    if (!req.headers['accept-encoding']) {
      confidence += 15;
      reasons.push('MISSING_ACCEPT_ENCODING');
    }

    // Headers suspeitos de automação
    const automationHeaders = [
      'x-automation', 'x-requested-with', 'x-selenium',
      'x-playwright', 'x-puppeteer'
    ];

    for (const header of automationHeaders) {
      if (req.headers[header]) {
        confidence += 40;
        reasons.push(`AUTOMATION_HEADER_${header.toUpperCase()}`);
      }
    }

    // Connection: close em vez de keep-alive
    if (req.headers.connection === 'close') {
      confidence += 10;
      reasons.push('CONNECTION_CLOSE');
    }

    // Headers de proxy suspeitos
    const proxyHeaders = ['x-forwarded-for', 'x-real-ip', 'via', 'x-proxy'];
    let proxyCount = 0;
    for (const header of proxyHeaders) {
      if (req.headers[header]) proxyCount++;
    }

    if (proxyCount >= 3) {
      confidence += 25;
      reasons.push('MULTIPLE_PROXY_HEADERS');
    }

    return { confidence, reasons };
  }

  // 🔍 ANALISAR COMPORTAMENTO
  private async analyzeBehavior(ip: string, fingerprint: string, req: Request): Promise<{ confidence: number; reasons: string[] }> {
    let confidence = 0;
    const reasons: string[] = [];

    try {
      // ANÁLISE HISTÓRICA DESABILITADA PARA USUÁRIOS NORMAIS
      // Foco apenas em ataques reais de injeção

      // DETECTAR APENAS ATAQUES REAIS DE INJEÇÃO
      const query = JSON.stringify(req.query || {});
      const body = JSON.stringify(req.body || {});
      const allInputs = `${req.path} ${query} ${body}`;
      
      // 🚨 SQL INJECTION
      const sqlPatterns = [/union\s+select/i, /'.*or.*1.*=.*1/i, /drop\s+table/i];
      if (sqlPatterns.some(p => p.test(allInputs))) {
        confidence += 90;
        reasons.push('SQL_INJECTION_ATTEMPT');
      }
      
      // 🚨 XSS INJECTION  
      const xssPatterns = [/<script.*>/i, /javascript:/i, /alert\s*\(/i];
      if (xssPatterns.some(p => p.test(allInputs))) {
        confidence += 90;
        reasons.push('XSS_INJECTION_ATTEMPT');
      }
      
      // 🚨 ARQUIVOS SENSÍVEIS REAIS
      const sensitiveFiles = [/\.env$/i, /config\.php$/i, /\.git\/config$/i];
      if (sensitiveFiles.some(p => p.test(req.path))) {
        confidence += 80;
        reasons.push('MALICIOUS_FILE_ACCESS');
      }

    } catch (error) {
      // Erro ao acessar dados - continuar sem penalização
    }

    return { confidence, reasons };
  }

  // 🔍 ANALISAR PADRÕES DE TIMING
  private analyzeTimingPatterns(ip: string): { confidence: number; reasons: string[] } {
    let confidence = 0;
    const reasons: string[] = [];

    // Verificar se IP tem padrão temporal suspeito
    const pattern = this.suspiciousPatterns.get(ip);
    if (pattern) {
      if (pattern > 50) {
        confidence += 20;
        reasons.push('SUSPICIOUS_TIMING_PATTERN');
      }
    }

    // Atualizar padrão para este IP
    this.suspiciousPatterns.set(ip, (pattern || 0) + 1);

    // Limpeza automática de padrões antigos
    if (this.suspiciousPatterns.size > 1000) {
      const entries = Array.from(this.suspiciousPatterns.entries());
      const toKeep = entries.slice(-500); // Manter apenas os 500 mais recentes
      this.suspiciousPatterns.clear();
      toKeep.forEach(([k, v]) => this.suspiciousPatterns.set(k, v));
    }

    return { confidence, reasons };
  }

  // 🔍 VERIFICAR BOT PERMITIDO
  private isAllowedBot(userAgent: string): boolean {
    const ua = userAgent.toLowerCase();
    return Array.from(this.allowedBots).some(bot => ua.includes(bot));
  }

  // 🔐 GERAR FINGERPRINT
  private generateFingerprint(req: Request): string {
    const ip = req.ip || 'unknown';
    const ua = req.headers['user-agent'] || '';
    const acceptLang = req.headers['accept-language'] || '';
    const acceptEnc = req.headers['accept-encoding'] || '';
    
    return Buffer.from(`${ip}:${ua}:${acceptLang}:${acceptEnc}`).toString('base64').slice(0, 32);
  }

  // 💾 SALVAR ASSINATURA DO BOT
  private async saveBotSignature(
    ip: string, 
    userAgent: string, 
    fingerprint: string, 
    reasons: string[], 
    confidence: number
  ): Promise<void> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return;

      const now = Date.now();
      const docRef = firebaseStorage.db.collection(this.collectionName).doc(fingerprint);

      await firebaseStorage.db.runTransaction(async (transaction: any) => {
        const doc = await transaction.get(docRef);

        let signature: BotSignature;

        if (doc.exists) {
          signature = doc.data() as BotSignature;
          signature.lastSeen = now;
          signature.totalRequests++;
          signature.detectionReasons = [...new Set([...signature.detectionReasons, ...reasons])];
          signature.behaviorScore = Math.min(100, signature.behaviorScore + (confidence > 60 ? 10 : 5));
          
          if (confidence >= 60) {
            signature.blockedRequests++;
          }
        } else {
          signature = {
            ip,
            userAgent,
            fingerprint,
            detectionReasons: reasons,
            confidence,
            firstSeen: now,
            lastSeen: now,
            totalRequests: 1,
            blockedRequests: confidence >= 60 ? 1 : 0,
            behaviorScore: confidence
          };
        }

        transaction.set(docRef, signature);
      });

    } catch (error: any) {
      console.error('❌ Erro ao salvar assinatura de bot:', error);
    }
  }

  // 🔍 BUSCAR ASSINATURA DO BOT
  private async getBotSignature(ip: string, fingerprint: string): Promise<BotSignature | null> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return null;

      const doc = await firebaseStorage.db.collection(this.collectionName).doc(fingerprint).get();
      return doc.exists ? doc.data() as BotSignature : null;

    } catch (error: any) {
      console.error('❌ Erro ao buscar assinatura de bot:', error);
      return null;
    }
  }

  // 🧹 LIMPEZA DE ASSINATURAS ANTIGAS
  async cleanup(): Promise<number> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return 0;

      const now = Date.now();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 dias

      const snapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .where('lastSeen', '<', now - maxAge)
        .limit(100)
        .get();

      if (snapshot.empty) return 0;

      const batch = firebaseStorage.db.batch();
      snapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      
      console.log(`🧹 BOT DETECTION CLEANUP: Removed ${snapshot.docs.length} old signatures`);
      return snapshot.docs.length;

    } catch (error: any) {
      console.error('❌ Erro na limpeza de bot signatures:', error);
      return 0;
    }
  }
}

// 🎯 SINGLETON GLOBAL
const advancedBotDetection = new AdvancedBotDetection();

// Limpeza automática a cada 12 horas
setInterval(() => {
  advancedBotDetection.cleanup();
}, 12 * 60 * 60 * 1000);

// 🛡️ MIDDLEWARE PRINCIPAL DE DETECÇÃO DE BOTS
export const advancedBotDetectionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await advancedBotDetection.analyzeRequest(req);

    // Adicionar resultado aos headers para debug (apenas em desenvolvimento)
    if (process.env.NODE_ENV === 'development') {
      res.set('X-Bot-Confidence', result.confidence.toString());
      res.set('X-Bot-Action', result.action);
    }

    // ✅ DETECTION-ONLY MODE: Apenas loga, NUNCA bloqueia automaticamente
    if (result.action === 'block') {
      console.log(`🤖 BOT DETECTION: IP=${req.ip} Confidence=${result.confidence}% Action=${result.action} Reasons=${JSON.stringify(result.reasons)}`);
      // Admin vê nos logs e decide manualmente
    }

    if (result.action === 'challenge') {
      // Por enquanto, apenas log do desafio
      // TODO: Implementar sistemas de captcha/POW
      console.log(`⚠️ BOT CHALLENGE: ${req.ip} - ${result.challengeType} - Confidence: ${result.confidence}%`);
      
      // ✅ OTIMIZAÇÃO: Delay removido para melhor performance de login
    }

    next();

  } catch (error: any) {
    console.error('❌ Erro no middleware de detecção de bots:', error);
    // Fail-open para não quebrar o sistema
    next();
  }
};

// 🔥 MIDDLEWARE ESPECÍFICO PARA ENDPOINTS CRÍTICOS
export const criticalEndpointBotProtection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await advancedBotDetection.analyzeRequest(req);

    // ✅ DETECTION-ONLY MODE: Apenas loga, NUNCA bloqueia automaticamente
    // Endpoints críticos têm threshold mais baixo para detecção
    if (result.confidence >= 40) {
      console.log(`🤖 BOT DETECTION (CRITICAL ENDPOINT): IP=${req.ip} Path=${req.path} Confidence=${result.confidence}%`);
      // Admin vê nos logs e decide manualmente
    }

    next();

  } catch (error: any) {
    console.error('❌ Erro na proteção crítica de bots:', error);
    next();
  }
};

export { advancedBotDetection };