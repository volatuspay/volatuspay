/**
 * 🚨 SISTEMA DE DETECÇÃO DE FRAUDE AI - ORÁCULO PAY
 * 
 * Monitora saques em busca de padrões suspeitos usando:
 * - OpenAI GPT-5 para análise inteligente
 * - Heurísticas hardcoded como fallback
 * - Circuit breaker para resiliência
 * 
 * ARQUITETURA:
 * - Análise assíncrona (não bloqueia withdrawal)
 * - Salva alertas em Firestore /fraudAlerts
 * - Notifica admin em casos críticos
 * 
 * 🔒 SEGURANÇA:
 * - Executa APÓS transação atomic concluída
 * - Falhas na detecção NÃO afetam saques legítimos
 * - Múltiplas camadas de fallback
 */

import OpenAI from 'openai';
import { getAdmin, getFirestore, ensureFirebaseReady } from '../lib/firebase-admin.js';
import type { FraudAlert, Withdrawal, SellerBalance, Currency } from '../../shared/balance-schema.js';
import { nanoid } from 'nanoid';

// ══════════════════════════════════════════════════════════════
// 🤖 CONFIGURAÇÃO OPENAI (Replit AI Integrations)
// ══════════════════════════════════════════════════════════════

// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access
// without requiring your own OpenAI API key. Charges are billed to your credits.
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!openai) {
    openai = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey
    });
  }
  return openai;
}

// ══════════════════════════════════════════════════════════════
// ⚙️ CONFIGURAÇÃO DO SISTEMA
// ══════════════════════════════════════════════════════════════

const CONFIG = {
  // Thresholds de risco
  RISK_THRESHOLDS: {
    LOW: 30,
    MEDIUM: 50,
    HIGH: 70,
    CRITICAL: 85
  },
  
  // Circuit breaker
  CIRCUIT_BREAKER: {
    failureThreshold: 3,      // Número de falhas antes de abrir o circuit
    successThreshold: 2,      // Sucessos necessários para fechar
    timeout: 60000,           // Tempo antes de tentar novamente (60s)
  },
  
  // OpenAI
  OPENAI: {
    model: 'gpt-5', // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    maxTokens: 2048,
    temperature: 1.0, // GPT-5 default (não configurável)
  },
  
  // Períodos de análise (dias)
  ANALYSIS_WINDOW: {
    recentWithdrawals: 30,
    recentSales: 30,
  }
};

// ══════════════════════════════════════════════════════════════
// 🔌 CIRCUIT BREAKER STATE
// ══════════════════════════════════════════════════════════════

let circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
let failureCount = 0;
let successCount = 0;
let lastFailureTime = 0;

// ✅ EXPORTAR ESTADO PÚBLICO (read-only para monitoring)
export const circuitBreakerState = {
  get state() { return circuitState; },
  get failures() { return failureCount; }
};

function resetCircuitBreaker() {
  circuitState = 'CLOSED';
  failureCount = 0;
  successCount = 0;
}

function recordSuccess() {
  if (circuitState === 'HALF_OPEN') {
    successCount++;
    if (successCount >= CONFIG.CIRCUIT_BREAKER.successThreshold) {
      console.log('🔌 [FraudDetection] Circuit breaker CLOSED (AI restored)');
      resetCircuitBreaker();
    }
  } else {
    failureCount = 0;
  }
}

function recordFailure() {
  failureCount++;
  lastFailureTime = Date.now();
  
  if (failureCount >= CONFIG.CIRCUIT_BREAKER.failureThreshold) {
    circuitState = 'OPEN';
    console.warn(`🔌 [FraudDetection] Circuit breaker OPEN (${failureCount} failures) - Using heuristics only`);
  }
}

function canCallAI(): boolean {
  if (circuitState === 'CLOSED') return true;
  if (circuitState === 'OPEN') {
    const elapsed = Date.now() - lastFailureTime;
    if (elapsed >= CONFIG.CIRCUIT_BREAKER.timeout) {
      circuitState = 'HALF_OPEN';
      successCount = 0;
      console.log('🔌 [FraudDetection] Circuit breaker HALF_OPEN (retry attempt)');
      return true;
    }
    return false;
  }
  return circuitState === 'HALF_OPEN';
}

// ══════════════════════════════════════════════════════════════
// 🧮 HEURÍSTICAS DE DETECÇÃO (FALLBACK)
// ══════════════════════════════════════════════════════════════

interface RiskFactor {
  factor: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  impact: number;
}

interface HeuristicResult {
  riskScore: number;
  riskFactors: RiskFactor[];
  recommendation: 'approve' | 'review_manual' | 'reject';
}

function calculateHeuristicRisk(
  withdrawal: Withdrawal,
  balance: SellerBalance,
  recentWithdrawals: Withdrawal[],
  recentSalesCount: number,
  recentSalesRevenue: number,
  availableBalance: number // ✅ AGORA RECEBE COMO PARÂMETRO
): HeuristicResult {
  const factors: RiskFactor[] = [];
  let totalScore = 0;
  
  const withdrawalAmount = withdrawal.amount;
  // availableBalance agora vem como parâmetro (PRÉ-dedução)
  const lifetimeRevenue = getLifetimeRevenue(balance, withdrawal.currency);
  
  // ────────────────────────────────────────────────────────────
  // 🚩 REGRA 1: Saque > 90% do saldo disponível
  // ────────────────────────────────────────────────────────────
  if (availableBalance > 0 && withdrawalAmount > (availableBalance * 0.9)) {
    const impact = 25;
    factors.push({
      factor: 'high_withdrawal_ratio',
      severity: 'high',
      description: `Saque de ${formatCurrency(withdrawalAmount, withdrawal.currency)} representa mais de 90% do saldo disponível`,
      impact
    });
    totalScore += impact;
  }
  
  // ────────────────────────────────────────────────────────────
  // 🚩 REGRA 2: Múltiplos saques em 24h
  // ────────────────────────────────────────────────────────────
  const last24h = Date.now() - (24 * 60 * 60 * 1000);
  const withdrawalsLast24h = recentWithdrawals.filter(w => {
    const timestamp = w.requestedAt?.toMillis?.() || 0;
    return timestamp > last24h;
  });
  
  if (withdrawalsLast24h.length >= 3) {
    const impact = 20;
    factors.push({
      factor: 'multiple_withdrawals_24h',
      severity: 'medium',
      description: `${withdrawalsLast24h.length} saques solicitados nas últimas 24 horas`,
      impact
    });
    totalScore += impact;
  }
  
  // ────────────────────────────────────────────────────────────
  // 🚩 REGRA 3: Saque > receita recente (30 dias)
  // ────────────────────────────────────────────────────────────
  if (recentSalesRevenue > 0 && withdrawalAmount > (recentSalesRevenue * 1.2)) {
    const impact = 30;
    factors.push({
      factor: 'withdrawal_exceeds_recent_revenue',
      severity: 'high',
      description: `Saque de ${formatCurrency(withdrawalAmount, withdrawal.currency)} excede receita recente de ${formatCurrency(recentSalesRevenue, withdrawal.currency)} em mais de 20%`,
      impact
    });
    totalScore += impact;
  }
  
  // ────────────────────────────────────────────────────────────
  // 🚩 REGRA 4: Conta nova (< 7 dias) com saque alto
  // ────────────────────────────────────────────────────────────
  const accountAge = balance.firstSaleDate 
    ? Math.floor((Date.now() - (balance.firstSaleDate.toMillis?.() || Date.now())) / (24 * 60 * 60 * 1000))
    : 0;
  
  if (accountAge < 7 && withdrawalAmount > 50000) { // R$ 500+ ou USD 500+
    const impact = 35;
    factors.push({
      factor: 'new_account_large_withdrawal',
      severity: 'high',
      description: `Conta criada há ${accountAge} dias tentando sacar ${formatCurrency(withdrawalAmount, withdrawal.currency)}`,
      impact
    });
    totalScore += impact;
  }
  
  // ────────────────────────────────────────────────────────────
  // 🚩 REGRA 5: Valor suspeito redondo (possível teste)
  // ────────────────────────────────────────────────────────────
  if ([100000, 50000, 10000, 5000, 1000].includes(withdrawalAmount)) {
    const impact = 10;
    factors.push({
      factor: 'round_amount_test',
      severity: 'low',
      description: `Valor exatamente ${formatCurrency(withdrawalAmount, withdrawal.currency)} pode indicar teste`,
      impact
    });
    totalScore += impact;
  }
  
  // ────────────────────────────────────────────────────────────
  // 🚩 REGRA 6: Poucas vendas mas saldo alto (possível fraude)
  // ────────────────────────────────────────────────────────────
  if (recentSalesCount < 3 && withdrawalAmount > 100000) { // < 3 vendas mas > R$ 1000
    const impact = 25;
    factors.push({
      factor: 'low_sales_high_balance',
      severity: 'medium',
      description: `Apenas ${recentSalesCount} vendas mas tentando sacar ${formatCurrency(withdrawalAmount, withdrawal.currency)}`,
      impact
    });
    totalScore += impact;
  }
  
  // ────────────────────────────────────────────────────────────
  // 🎯 RECOMENDAÇÃO BASEADA NO SCORE
  // ────────────────────────────────────────────────────────────
  let recommendation: 'approve' | 'review_manual' | 'reject';
  
  if (totalScore >= CONFIG.RISK_THRESHOLDS.CRITICAL) {
    recommendation = 'reject';
  } else if (totalScore >= CONFIG.RISK_THRESHOLDS.MEDIUM) {
    recommendation = 'review_manual';
  } else {
    recommendation = 'approve';
  }
  
  return {
    riskScore: Math.min(totalScore, 100),
    riskFactors: factors,
    recommendation
  };
}

// ══════════════════════════════════════════════════════════════
// 🤖 ANÁLISE COM OPENAI GPT-5
// ══════════════════════════════════════════════════════════════

interface AIAnalysisResult {
  summary: string;
  reasoning: string;
  recommendation: 'approve' | 'review_manual' | 'reject';
  confidence: number;
  modelUsed: string;
  tokensUsed: number;
}

async function analyzeWithAI(
  withdrawal: Withdrawal,
  balance: SellerBalance,
  heuristicResult: HeuristicResult,
  context: FraudAlert['context']
): Promise<AIAnalysisResult | null> {
  if (!canCallAI()) {
    console.log('⚡ [FraudDetection] Circuit breaker active - skipping AI analysis');
    return null;
  }
  
  try {
    const prompt = buildAnalysisPrompt(withdrawal, balance, heuristicResult, context);
    
    const client = getOpenAI();
    if (!client) {
      console.log('⚡ [FraudDetection] OpenAI não configurado - pulando análise AI');
      return null;
    }
    
    const response = await client.chat.completions.create({
      model: CONFIG.OPENAI.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert fraud detection analyst for a payment gateway. Analyze withdrawal requests and provide risk assessment in JSON format.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: CONFIG.OPENAI.maxTokens,
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty AI response');
    }
    
    const aiResult = JSON.parse(content);
    
    recordSuccess();
    
    return {
      summary: aiResult.summary || 'AI analysis completed',
      reasoning: aiResult.reasoning || 'No detailed reasoning provided',
      recommendation: aiResult.recommendation || 'review_manual',
      confidence: aiResult.confidence || 50,
      modelUsed: CONFIG.OPENAI.model,
      tokensUsed: response.usage?.total_tokens || 0
    };
    
  } catch (error: any) {
    console.error('❌ [FraudDetection] AI analysis failed:', error.message);
    recordFailure();
    return null;
  }
}

function buildAnalysisPrompt(
  withdrawal: Withdrawal,
  balance: SellerBalance,
  heuristicResult: HeuristicResult,
  context: FraudAlert['context']
): string {
  return `Analyze this withdrawal request for fraud risk:

WITHDRAWAL REQUEST:
- Amount: ${formatCurrency(withdrawal.amount, withdrawal.currency)}
- Currency: ${withdrawal.currency}
- Status: ${withdrawal.status}
- Account Age: ${context.sellerAccountAge || 0} days

SELLER PROFILE:
- Available Balance: ${formatCurrency(context.sellerBalance, withdrawal.currency)}
- Lifetime Revenue: ${formatCurrency(context.sellerLifetimeRevenue, withdrawal.currency)}
- Total Orders: ${balance.totalOrders}

RECENT ACTIVITY (30 days):
- Withdrawals: ${context.recentWithdrawals.count} (Total: ${formatCurrency(context.recentWithdrawals.totalAmount, withdrawal.currency)})
- Sales: ${context.recentSales.count} (Revenue: ${formatCurrency(context.recentSales.totalRevenue, withdrawal.currency)})

HEURISTIC ANALYSIS:
- Risk Score: ${heuristicResult.riskScore}/100
- Risk Factors: ${heuristicResult.riskFactors.map(f => f.description).join('; ')}
- Heuristic Recommendation: ${heuristicResult.recommendation}

Provide your analysis in JSON format:
{
  "summary": "Brief summary of the risk assessment",
  "reasoning": "Detailed explanation of your analysis",
  "recommendation": "approve" | "review_manual" | "reject",
  "confidence": 0-100 (your confidence level in this assessment)
}`;
}

// ══════════════════════════════════════════════════════════════
// 🎯 FUNÇÃO PRINCIPAL: ANALISAR SAQUE
// ══════════════════════════════════════════════════════════════

/**
 * 🔥 PARÂMETRO CRÍTICO: preDeductionBalance
 * - Se fornecido, usa este valor (saldo ANTES da dedução do saque)
 * - Se null, busca saldo atual do Firestore (já reduzido)
 * - IMPORTANTE: Evita falsos positivos na Rule 1 (high_withdrawal_ratio)
 */
export async function analyzeFraud(
  withdrawal: Withdrawal, 
  preDeductionBalance?: number
): Promise<FraudAlert> {
  const startTime = Date.now();
  await ensureFirebaseReady();
  const db = getFirestore();
  const admin = getAdmin();
  
  console.log(`🔍 [FraudDetection] Analyzing withdrawal ${withdrawal.withdrawalId}`);
  
  try {
    // ────────────────────────────────────────────────────────────
    // 📊 BUSCAR DADOS DO SELLER
    // ────────────────────────────────────────────────────────────
    const balanceDoc = await db.collection('sellerBalances').doc(withdrawal.sellerId).get();
    if (!balanceDoc.exists) {
      throw new Error(`Balance not found for seller ${withdrawal.sellerId}`);
    }
    
    const balance = balanceDoc.data() as SellerBalance;
    const currency = withdrawal.currency;
    
    // ────────────────────────────────────────────────────────────
    // 📈 BUSCAR HISTÓRICO RECENTE
    // ────────────────────────────────────────────────────────────
    const windowStart = admin.firestore.Timestamp.fromMillis(
      Date.now() - (CONFIG.ANALYSIS_WINDOW.recentWithdrawals * 24 * 60 * 60 * 1000)
    );
    
    const [recentWithdrawalsSnap, recentOrdersSnap] = await Promise.all([
      db.collection('withdrawals')
        .where('sellerId', '==', withdrawal.sellerId)
        .where('requestedAt', '>=', windowStart)
        .get(),
      
      db.collection('orders')
        .where('sellerId', '==', withdrawal.sellerId)
        .where('createdAt', '>=', windowStart)
        .where('status', '==', 'paid')
        .get()
    ]);
    
    const recentWithdrawals = recentWithdrawalsSnap.docs.map(d => d.data() as Withdrawal);
    const recentOrders = recentOrdersSnap.docs.map(d => d.data());
    
    // Calcular métricas recentes
    const recentSalesRevenue = recentOrders.reduce((sum, order) => {
      if (order.pricing?.currency === currency) {
        return sum + (order.pricing?.amount || 0);
      }
      return sum;
    }, 0);
    
    const recentWithdrawalsTotal = recentWithdrawals.reduce((sum, w) => {
      if (w.currency === currency) {
        return sum + w.amount;
      }
      return sum;
    }, 0);
    
    // ────────────────────────────────────────────────────────────
    // 🧮 CALCULAR HEURÍSTICAS (SEMPRE)
    // ────────────────────────────────────────────────────────────
    // 🔥 USAR SALDO PRÉ-DEDUÇÃO se fornecido (evita falsos positivos)
    const availableForRiskCalc = preDeductionBalance !== undefined 
      ? preDeductionBalance 
      : getBalanceByCurrency(balance, currency).available;
    
    const heuristicResult = calculateHeuristicRisk(
      withdrawal,
      balance,
      recentWithdrawals,
      recentOrders.length,
      recentSalesRevenue,
      availableForRiskCalc // ✅ PASSAR SALDO CORRETO
    );
    
    // ────────────────────────────────────────────────────────────
    // 📝 MONTAR CONTEXTO
    // ────────────────────────────────────────────────────────────
    const accountAge = balance.firstSaleDate 
      ? Math.floor((Date.now() - (balance.firstSaleDate.toMillis?.() || Date.now())) / (24 * 60 * 60 * 1000))
      : 0;
    
    // 🔥 USAR MESMO SALDO nas heurísticas E no contexto (consistência total)
    const context: FraudAlert['context'] = {
      withdrawalAmount: withdrawal.amount,
      withdrawalCurrency: currency,
      sellerBalance: availableForRiskCalc, // ✅ USAR PRÉ-DEDUÇÃO (mesmo valor da heurística)
      sellerLifetimeRevenue: getLifetimeRevenue(balance, currency),
      sellerFirstSaleDate: balance.firstSaleDate,
      sellerAccountAge: accountAge,
      recentWithdrawals: {
        count: recentWithdrawals.length,
        totalAmount: recentWithdrawalsTotal,
        averageAmount: recentWithdrawals.length > 0 ? Math.round(recentWithdrawalsTotal / recentWithdrawals.length) : 0
      },
      recentSales: {
        count: recentOrders.length,
        totalRevenue: recentSalesRevenue,
        averageTicket: recentOrders.length > 0 ? Math.round(recentSalesRevenue / recentOrders.length) : 0
      }
    };
    
    // ────────────────────────────────────────────────────────────
    // 🤖 TENTAR ANÁLISE COM AI (com circuit breaker)
    // ────────────────────────────────────────────────────────────
    const aiAnalysis = await analyzeWithAI(withdrawal, balance, heuristicResult, context);
    
    // ────────────────────────────────────────────────────────────
    // 🎯 COMBINAR RESULTADOS (AI + Heurísticas)
    // ────────────────────────────────────────────────────────────
    const finalScore = aiAnalysis 
      ? Math.round((heuristicResult.riskScore * 0.4) + (calculateScoreFromAI(aiAnalysis) * 0.6))
      : heuristicResult.riskScore;
    
    const finalRecommendation = aiAnalysis?.recommendation || heuristicResult.recommendation;
    
    const riskLevel = getRiskLevel(finalScore);
    
    // ────────────────────────────────────────────────────────────
    // 💾 CRIAR ALERTA
    // ────────────────────────────────────────────────────────────
    const alert: FraudAlert = {
      alertId: nanoid(),
      withdrawalId: withdrawal.withdrawalId,
      sellerId: withdrawal.sellerId,
      riskScore: finalScore,
      riskLevel,
      riskFactors: heuristicResult.riskFactors,
      aiAnalysis: aiAnalysis || {
        summary: 'AI analysis unavailable - using heuristics only',
        reasoning: 'Circuit breaker active or AI service unavailable',
        recommendation: heuristicResult.recommendation,
        confidence: 60,
        modelUsed: 'heuristics-only',
        tokensUsed: 0
      },
      context,
      reviewStatus: 'unreviewed',
      notificationSent: false,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      detectionVersion: '1.0.0'
    };
    
    // ────────────────────────────────────────────────────────────
    // 💾 SALVAR NO FIRESTORE
    // ────────────────────────────────────────────────────────────
    await db.collection('fraudAlerts').doc(alert.alertId).set(alert);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('./neon-subscriptions.js').then(({ neonWriteFraudAlert }) => {
      neonWriteFraudAlert({
        id: alert.alertId,
        withdrawalId: alert.withdrawalId,
        sellerId: alert.sellerId,
        riskScore: alert.riskScore,
        riskLevel: alert.riskLevel,
        riskFactors: (alert as any).riskFactors,
        aiAnalysis: alert.aiAnalysis as any,
        context: alert.context as any,
        reviewStatus: alert.reviewStatus,
        notificationSent: alert.notificationSent,
        detectionVersion: alert.detectionVersion,
      });
    }).catch(() => {});

    const elapsed = Date.now() - startTime;
    console.log(`✅ [FraudDetection] Analysis completed in ${elapsed}ms - Risk: ${riskLevel} (${finalScore}/100)`);
    
    return alert;
    
  } catch (error: any) {
    console.error('❌ [FraudDetection] Fatal error:', error);
    throw error;
  }
}

// ══════════════════════════════════════════════════════════════
// 🛠️ HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════

function getBalanceByCurrency(balance: SellerBalance, currency: Currency) {
  switch (currency) {
    case 'BRL':
      return {
        available: balance.balanceAvailable_BRL || 0,
        pending: balance.balancePending_BRL || 0,
        reserved: balance.balanceReserved_BRL || 0
      };
    case 'USD':
      return {
        available: balance.balanceAvailable_USD || 0,
        pending: balance.balancePending_USD || 0,
        reserved: balance.balanceReserved_USD || 0
      };
    case 'EUR':
      return {
        available: balance.balanceAvailable_EUR || 0,
        pending: balance.balancePending_EUR || 0,
        reserved: balance.balanceReserved_EUR || 0
      };
    default:
      return { available: 0, pending: 0, reserved: 0 };
  }
}

function getLifetimeRevenue(balance: SellerBalance, currency: Currency): number {
  switch (currency) {
    case 'BRL': return balance.lifetimeRevenue_BRL || 0;
    case 'USD': return balance.lifetimeRevenue_USD || 0;
    case 'EUR': return balance.lifetimeRevenue_EUR || 0;
    default: return 0;
  }
}

function formatCurrency(amount: number, currency: Currency): string {
  const value = amount / 100;
  switch (currency) {
    case 'BRL': return `R$ ${value.toFixed(2)}`;
    case 'USD': return `$ ${value.toFixed(2)}`;
    case 'EUR': return `€ ${value.toFixed(2)}`;
    default: return `${value.toFixed(2)} ${currency}`;
  }
}

function calculateScoreFromAI(aiAnalysis: AIAnalysisResult): number {
  // Converter recomendação AI em score
  const baseScore = {
    'approve': 20,
    'review_manual': 55,
    'reject': 85
  }[aiAnalysis.recommendation];
  
  // Ajustar pela confiança da AI
  const confidenceWeight = aiAnalysis.confidence / 100;
  return Math.round(baseScore * confidenceWeight + (50 * (1 - confidenceWeight)));
}

function getRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= CONFIG.RISK_THRESHOLDS.CRITICAL) return 'critical';
  if (score >= CONFIG.RISK_THRESHOLDS.HIGH) return 'high';
  if (score >= CONFIG.RISK_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}
