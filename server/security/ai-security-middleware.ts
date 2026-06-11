/**
 * 🤖 AI SECURITY MIDDLEWARE
 * Integra análise de IA com sistema de segurança existente
 */

import { Request, Response, NextFunction } from 'express';
import { analyzeSecurityThreat, quickThreatCheck } from './ai-threat-analyzer.js';

interface AISecurityOptions {
  enabled: boolean;
  autoBlock: boolean;
  logOnly: boolean;
  confidenceThreshold: number;
}

const defaultOptions: AISecurityOptions = {
  enabled: true,
  autoBlock: true, // 🛡️ MODO ATIVO: Bloqueio automático de ameaças reais
  logOnly: false,
  confidenceThreshold: 85 // Bloquear se confiança >= 85% (alto)
};

/**
 * 🔍 EXTRAIR INFORMAÇÕES DA REQUISIÇÃO
 */
function extractRequestInfo(req: Request): {
  ip: string;
  userAgent: string;
  endpoint: string;
  method: string;
  suspicionScore: number;
  detectedPatterns: string[];
} {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
             (req.headers['x-real-ip'] as string) ||
             req.ip ||
             req.socket.remoteAddress ||
             'unknown';

  const userAgent = req.headers['user-agent'] || 'unknown';
  const endpoint = req.path;
  const method = req.method;

  // 🔍 CÁLCULO DE SUSPEIÇÃO INICIAL
  let suspicionScore = 0;
  const detectedPatterns: string[] = [];

  // ⚠️ Padrões suspeitos básicos
  if (!userAgent || userAgent === 'unknown') {
    suspicionScore += 20;
    detectedPatterns.push('missing_user_agent');
  }

  if (userAgent.toLowerCase().includes('bot') || userAgent.toLowerCase().includes('crawler')) {
    suspicionScore += 15;
    detectedPatterns.push('bot_user_agent');
  }

  // Endpoints críticos
  if (endpoint.includes('/api/orders') || endpoint.includes('/api/payments')) {
    suspicionScore += 10;
    detectedPatterns.push('critical_endpoint');
  }

  // POST/DELETE em endpoints críticos
  if ((method === 'POST' || method === 'DELETE') && endpoint.includes('/api/')) {
    suspicionScore += 5;
    detectedPatterns.push('mutating_request');
  }

  return {
    ip,
    userAgent,
    endpoint,
    method,
    suspicionScore,
    detectedPatterns
  };
}

/**
 * 🤖 MIDDLEWARE DE AI SECURITY
 * Analisa requisições suspeitas com IA e registra ameaças
 */
export function aiSecurityMiddleware(options: Partial<AISecurityOptions> = {}) {
  const config = { ...defaultOptions, ...options };

  return async (req: Request, res: Response, next: NextFunction) => {
    // ✅ Bypass se desabilitado
    if (!config.enabled) {
      return next();
    }

    // ✅ Bypass para requisições internas
    if (req.bypassAllSecurity) {
      return next();
    }

    try {
      const requestInfo = extractRequestInfo(req);

      // 🔍 ANÁLISE APENAS SE SUSPEITO (otimização)
      if (requestInfo.suspicionScore < 20) {
        // Requisição normal, não precisa análise de IA
        return next();
      }

      // 🤖 ANÁLISE COM IA (cache otimizado)
      const analysis = await quickThreatCheck({
        ip: requestInfo.ip,
        userAgent: requestInfo.userAgent,
        endpoint: requestInfo.endpoint,
        method: requestInfo.method,
        suspicionScore: requestInfo.suspicionScore,
        detectedPatterns: requestInfo.detectedPatterns,
        payload: req.body,
        headers: req.headers as Record<string, string>
      });

      // 📊 LOG DA ANÁLISE
      const requestId = req.headers['x-request-id'] || 'unknown';
      console.log(`🤖 [AI-SECURITY] ${requestId} | IP: ${requestInfo.ip} | Threat: ${analysis.isThreat} | Confidence: ${analysis.confidenceScore}% | Action: ${analysis.recommendation}`);

      // 🛡️ DECISÃO DE BLOQUEIO
      if (analysis.isThreat && analysis.confidenceScore >= config.confidenceThreshold) {
        if (config.autoBlock && !config.logOnly) {
          // 🚫 BLOQUEIO AUTOMÁTICO
          console.warn(`🚨 [AI-SECURITY] BLOCKED | ${requestId} | ${analysis.threatType} | ${analysis.reasoning}`);
          return res.status(403).json({
            error: 'Request blocked by AI security system',
            reason: 'Suspicious activity detected',
            requestId
          });
        } else {
          // ⚠️ APENAS LOG (modo conservador)
          console.warn(`⚠️ [AI-SECURITY] DETECTED | ${requestId} | ${analysis.threatType} | ${analysis.reasoning} | Action: ${analysis.suggestedAction}`);
        }
      }

      // ✅ Prosseguir com requisição
      next();
    } catch (error) {
      // 🔥 Erro na análise de IA não deve bloquear requisição
      console.error('❌ [AI-SECURITY] Analysis failed:', error);
      next();
    }
  };
}

/**
 * 📊 ENDPOINT DE STATUS DO AI SECURITY
 * GET /api/security/ai-status
 */
export function createAIStatusEndpoint() {
  return (req: Request, res: Response) => {
    res.json({
      enabled: true,
      mode: 'log_only',
      autoBlock: false,
      confidenceThreshold: 80,
      status: 'operational',
      message: '🤖 AI Security System Active - GPT-4o Powered Threat Detection'
    });
  };
}
