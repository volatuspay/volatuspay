/**
 * 🤖 SISTEMA DE ANÁLISE DE AMEAÇAS COM IA GPT-4o
 * Monitora atividades suspeitas e analisa padrões de ataque em tempo real
 * Usa Replit AI Integrations (sem necessidade de API key própria)
 */

import OpenAI from 'openai';

// 🔐 Configuração OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

interface ThreatAnalysisRequest {
  ip: string;
  userAgent: string;
  endpoint: string;
  method: string;
  payload?: any;
  headers?: Record<string, string>;
  suspicionScore: number;
  detectedPatterns: string[];
}

interface ThreatAnalysisResult {
  isThreat: boolean;
  confidenceScore: number; // 0-100
  threatType: string | null;
  recommendation: 'allow' | 'block' | 'monitor';
  reasoning: string;
  suggestedAction: string;
}

/**
 * 🧠 ANALISAR AMEAÇA COM IA GPT-4o
 * Usa modelo de última geração para detectar padrões complexos de ataque
 */
export async function analyzeSecurityThreat(
  request: ThreatAnalysisRequest
): Promise<ThreatAnalysisResult> {
  try {
    const prompt = `Você é um especialista em segurança cibernética analisando uma requisição HTTP suspeita em um gateway de pagamentos financeiros.

**DADOS DA REQUISIÇÃO:**
- IP: ${request.ip}
- User-Agent: ${request.userAgent}
- Endpoint: ${request.method} ${request.endpoint}
- Padrões detectados: ${request.detectedPatterns.join(', ')}
- Score de suspeição inicial: ${request.suspicionScore}/100

**CONTEXTO:**
Este é um gateway de pagamentos que processa PIX, cartões e boletos. Segurança é CRÍTICA.

**SUA TAREFA:**
Analise se esta requisição representa uma ameaça real de segurança. Considere:
1. Padrões de ataque conhecidos (SQL injection, XSS, DDoS, credential stuffing)
2. Comportamento anômalo do user-agent
3. Velocidade de requisições do IP
4. Tipo de endpoint acessado (pagamentos são críticos)

**RESPONDA EM JSON:**
{
  "isThreat": true/false,
  "confidenceScore": 0-100,
  "threatType": "tipo de ameaça ou null",
  "recommendation": "allow" | "block" | "monitor",
  "reasoning": "explicação técnica breve",
  "suggestedAction": "ação específica a tomar"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Você é um sistema de segurança de IA especializado em detecção de ameaças para gateways de pagamento. Responda APENAS com JSON válido, sem markdown ou explicações extras.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 500,
      temperature: 0.3
    });

    const aiResponse = response.choices[0]?.message?.content || '{}';
    const analysis: ThreatAnalysisResult = JSON.parse(aiResponse);

    // 🛡️ Log da análise para auditoria
    console.log('🤖 AI THREAT ANALYSIS:', {
      ip: request.ip,
      isThreat: analysis.isThreat,
      confidence: analysis.confidenceScore,
      recommendation: analysis.recommendation
    });

    return analysis;
  } catch (error) {
    console.error('❌ Erro na análise de IA:', error);
    
    // 🛡️ FALLBACK: Em caso de erro, usar regras conservadoras
    return {
      isThreat: request.suspicionScore >= 80, // Score alto = bloquear
      confidenceScore: 50,
      threatType: 'unknown',
      recommendation: request.suspicionScore >= 80 ? 'block' : 'monitor',
      reasoning: 'Análise de IA falhou, usando regras conservadoras',
      suggestedAction: 'Manual review required'
    };
  }
}

/**
 * 🔍 ANALISAR PADRÃO DE COMPORTAMENTO DE IP
 * Detecta ataques coordenados e botnets
 */
export async function analyzeIPBehaviorPattern(
  ip: string,
  recentRequests: Array<{
    timestamp: Date;
    endpoint: string;
    method: string;
    statusCode: number;
  }>
): Promise<{
  isBot: boolean;
  isBotnet: boolean;
  confidence: number;
  pattern: string;
}> {
  try {
    const requestSummary = recentRequests.map(r => 
      `${r.method} ${r.endpoint} → ${r.statusCode}`
    ).join('\n');

    const prompt = `Analise este padrão de requisições do IP ${ip}:

${requestSummary}

Tempo total: ${recentRequests.length} requisições nas últimas 24h

Identifique se é:
1. Bot malicioso (scraping, credential stuffing, brute force)
2. Botnet (ataques coordenados)
3. Usuário legítimo

Responda em JSON:
{
  "isBot": true/false,
  "isBotnet": true/false,
  "confidence": 0-100,
  "pattern": "descrição do padrão identificado"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em análise de padrões de tráfego e detecção de bots. Responda APENAS com JSON válido.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 300,
      temperature: 0.2
    });

    const aiResponse = response.choices[0]?.message?.content || '{}';
    return JSON.parse(aiResponse);
  } catch (error) {
    console.error('❌ Erro na análise de padrão:', error);
    
    // Fallback simples baseado em volume
    const requestsPerHour = recentRequests.length / 24;
    return {
      isBot: requestsPerHour > 100,
      isBotnet: false,
      confidence: 50,
      pattern: 'Análise indisponível'
    };
  }
}

/**
 * 🚨 ANÁLISE RÁPIDA PARA ENDPOINTS CRÍTICOS
 * Usa cache para otimização (evita chamar IA em toda requisição)
 */
const threatCache = new Map<string, { result: ThreatAnalysisResult; expiresAt: number }>();

export async function quickThreatCheck(
  request: ThreatAnalysisRequest
): Promise<ThreatAnalysisResult> {
  // 🔑 Gerar cache key baseado em IP + endpoint
  const cacheKey = `${request.ip}:${request.endpoint}`;
  const now = Date.now();
  
  // ✅ Verificar cache (válido por 5 minutos)
  const cached = threatCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    console.log('📦 Cache hit - análise rápida');
    return cached.result;
  }
  
  // 🤖 Análise completa com IA
  const result = await analyzeSecurityThreat(request);
  
  // 💾 Salvar no cache
  threatCache.set(cacheKey, {
    result,
    expiresAt: now + 5 * 60 * 1000 // 5 minutos
  });
  
  return result;
}

/**
 * 🧹 LIMPEZA PERIÓDICA DO CACHE
 * Evita memory leak
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of threatCache.entries()) {
    if (value.expiresAt < now) {
      threatCache.delete(key);
    }
  }
  console.log(`🧹 Cache limpo - ${threatCache.size} entradas restantes`);
}, 10 * 60 * 1000); // A cada 10 minutos
