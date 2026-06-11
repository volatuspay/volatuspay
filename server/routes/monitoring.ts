/**
 * 📊 MONITORING DASHBOARD - ADMIN ENDPOINTS
 * Agregação de métricas do sistema para o dashboard admin
 * 
 * SEGURANÇA:
 * - Todos endpoints protegidos com verifyFirebaseToken + requireAdmin
 * - Cache em memória com TTL de 5 minutos
 * - Queries otimizadas para evitar excesso de reads no Firestore
 * 
 * ENDPOINTS:
 * - GET /dashboard - Dashboard completo (todas as métricas)
 * - GET /balances - Agregação de saldos por moeda
 * - GET /withdrawals - Métricas de saques
 * - GET /fraud - Métricas de fraud alerts
 * - GET /reconciliation - Última reconciliação
 */

import { Router } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseReady, getAdmin } from '../lib/firebase-admin';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth';
import type {
  MonitoringDashboard,
  BalanceAggregation,
  WithdrawalMetrics,
  FraudMetrics,
  ReconciliationMetrics,
  SellerBalance,
  Withdrawal,
  FraudAlert,
  Currency
} from '../../shared/balance-schema';
import { circuitBreakerState } from '../services/fraud-detection';

const router = Router();

// ══════════════════════════════════════════════════════════════
// 💾 CACHE EM MEMÓRIA (TTL: 5 minutos)
// ══════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL
  });
}

// ══════════════════════════════════════════════════════════════
// 🔧 HELPERS DE AGREGAÇÃO
// ══════════════════════════════════════════════════════════════

/**
 * Agregar saldos por moeda
 */
async function aggregateBalances(currency: Currency): Promise<BalanceAggregation> {
  await ensureFirebaseReady();
  const db = getFirestore();
  const auth = getAuth();
  const admin = getAdmin();
  
  const cacheKey = `balances:${currency}`;
  const cached = getCached<BalanceAggregation>(cacheKey);
  if (cached) return cached;
  
  // Buscar todos os saldos (sem filtro para pegar todos sellers)
  const balancesSnap = await db.collection('sellerBalances').get();
  
  let totalAvailable = 0;
  let totalReserved = 0;
  let totalWithdrawn = 0;
  
  const sellers: Array<{
    sellerId: string;
    sellerEmail: string;
    available: number;
    reserved: number;
    withdrawn: number;
  }> = [];
  
  for (const doc of balancesSnap.docs) {
    const balance = doc.data() as SellerBalance;
    const sellerId = doc.id;
    
    // ⚡ OTIMIZAÇÃO: Não buscar email (evita 100+ auth.getUser calls)
    // sellerId é suficiente para identificação no dashboard
    const sellerEmail = sellerId.substring(0, 8) + '...';
    
    // Extrair saldos da moeda especificada
    let available = 0;
    let reserved = 0;
    let withdrawn = 0;
    
    if (currency === 'BRL') {
      available = balance.balanceAvailable_BRL || 0;
      reserved = balance.balanceReserved_BRL || 0;
      withdrawn = balance.totalWithdrawn_BRL || 0;
    } else if (currency === 'USD') {
      available = balance.balanceAvailable_USD || 0;
      reserved = balance.balanceReserved_USD || 0;
      withdrawn = balance.totalWithdrawn_USD || 0;
    } else if (currency === 'EUR') {
      available = balance.balanceAvailable_EUR || 0;
      reserved = balance.balanceReserved_EUR || 0;
      withdrawn = balance.totalWithdrawn_EUR || 0;
    }
    
    // Somar totais
    totalAvailable += available;
    totalReserved += reserved;
    totalWithdrawn += withdrawn;
    
    // Adicionar ao array (se tiver saldo nessa moeda)
    if (available > 0 || reserved > 0 || withdrawn > 0) {
      sellers.push({
        sellerId,
        sellerEmail,
        available,
        reserved,
        withdrawn
      });
    }
  }
  
  // Ordenar por available (top 10)
  sellers.sort((a, b) => b.available - a.available);
  const topSellers = sellers.slice(0, 10);
  
  const result: BalanceAggregation = {
    currency,
    totalAvailable,
    totalReserved,
    totalWithdrawn,
    topSellers,
    lastUpdated: admin.firestore.Timestamp.now()
  };
  
  setCache(cacheKey, result);
  return result;
}

/**
 * Métricas de saques
 */
async function aggregateWithdrawals(): Promise<WithdrawalMetrics> {
  await ensureFirebaseReady();
  const db = getFirestore();
  const admin = getAdmin();
  
  const cacheKey = 'withdrawals:metrics';
  const cached = getCached<WithdrawalMetrics>(cacheKey);
  if (cached) return cached;
  
  // Buscar todos os saques
  const withdrawalsSnap = await db.collection('withdrawals').get();
  
  let totalPending = 0;
  let totalApproved = 0;
  let totalRejected = 0;
  let totalCompleted = 0;
  
  let amountPendingBRL = 0;
  let amountPendingUSD = 0;
  let amountPendingEUR = 0;
  
  let amountApprovedBRL = 0;
  let amountApprovedUSD = 0;
  let amountApprovedEUR = 0;
  
  const approvalTimes: number[] = [];
  const recent24h = Date.now() - (24 * 60 * 60 * 1000);
  
  let recentCount = 0;
  let recentTotalBRL = 0;
  
  for (const doc of withdrawalsSnap.docs) {
    const withdrawal = doc.data() as Withdrawal;
    const status = withdrawal.status;
    const currency = withdrawal.currency;
    const amount = withdrawal.amount;
    
    // Contadores de status
    if (status === 'pending') {
      totalPending++;
      if (currency === 'BRL') amountPendingBRL += amount;
      else if (currency === 'USD') amountPendingUSD += amount;
      else if (currency === 'EUR') amountPendingEUR += amount;
    } else if (status === 'approved') {
      totalApproved++;
      if (currency === 'BRL') amountApprovedBRL += amount;
      else if (currency === 'USD') amountApprovedUSD += amount;
      else if (currency === 'EUR') amountApprovedEUR += amount;
    } else if (status === 'rejected') {
      totalRejected++;
    } else if (status === 'completed') {
      totalCompleted++;
    }
    
    // Tempo de aprovação (se approved ou completed)
    if ((status === 'approved' || status === 'completed') && withdrawal.approvedAt && withdrawal.requestedAt) {
      const approvalTime = (withdrawal.approvedAt.toMillis() - withdrawal.requestedAt.toMillis()) / (1000 * 60); // minutos
      if (approvalTime >= 0) {
        approvalTimes.push(approvalTime);
      }
    }
    
    // Saques recentes (24h)
    if (withdrawal.requestedAt && withdrawal.requestedAt.toMillis() >= recent24h) {
      recentCount++;
      if (currency === 'BRL') recentTotalBRL += amount;
    }
  }
  
  // Calcular média de tempo de aprovação
  const averageApprovalTime = approvalTimes.length > 0
    ? Math.round(approvalTimes.reduce((sum, time) => sum + time, 0) / approvalTimes.length)
    : 0;
  
  // Taxa de rejeição
  const totalReviewed = totalApproved + totalRejected + totalCompleted;
  const rejectionRate = totalReviewed > 0 
    ? Math.round((totalRejected / totalReviewed) * 100) 
    : 0;
  
  const result: WithdrawalMetrics = {
    totalPending,
    totalApproved,
    totalRejected,
    totalCompleted,
    amountPendingBRL,
    amountPendingUSD,
    amountPendingEUR,
    amountApprovedBRL,
    amountApprovedUSD,
    amountApprovedEUR,
    averageApprovalTime,
    rejectionRate,
    recentWithdrawals: {
      count: recentCount,
      totalAmount: recentTotalBRL,
      currency: 'BRL'
    }
  };
  
  setCache(cacheKey, result);
  return result;
}

/**
 * Métricas de fraude
 */
async function aggregateFraud(): Promise<FraudMetrics> {
  await ensureFirebaseReady();
  const db = getFirestore();
  const admin = getAdmin();
  
  const cacheKey = 'fraud:metrics';
  const cached = getCached<FraudMetrics>(cacheKey);
  if (cached) return cached;
  
  // Buscar todos os alertas
  const alertsSnap = await db.collection('fraudAlerts').get();
  
  let totalAlerts = alertsSnap.size;
  let totalUnreviewed = 0;
  let totalHighRisk = 0;
  let totalMediumRisk = 0;
  let totalLowRisk = 0;
  
  let totalConfirmedFraud = 0;
  let totalFalsePositive = 0;
  
  const confidences: number[] = [];
  const recent24h = Date.now() - (24 * 60 * 60 * 1000);
  
  let recentCount = 0;
  let recentHighRiskCount = 0;
  
  for (const doc of alertsSnap.docs) {
    const alert = doc.data() as FraudAlert;
    
    // Status de revisão
    if (alert.reviewStatus === 'unreviewed') {
      totalUnreviewed++;
    } else if (alert.reviewStatus === 'confirmed_fraud') {
      totalConfirmedFraud++;
    } else if (alert.reviewStatus === 'false_positive') {
      totalFalsePositive++;
    }
    
    // Níveis de risco
    const score = alert.riskScore;
    if (score >= 70) {
      totalHighRisk++;
    } else if (score >= 40) {
      totalMediumRisk++;
    } else {
      totalLowRisk++;
    }
    
    // Confidence da AI
    if (alert.aiAnalysis?.confidence) {
      confidences.push(alert.aiAnalysis.confidence);
    }
    
    // Alertas recentes (24h)
    if (alert.createdAt && alert.createdAt.toMillis() >= recent24h) {
      recentCount++;
      if (score >= 70) recentHighRiskCount++;
    }
  }
  
  // Calcular taxas
  const totalReviewed = totalConfirmedFraud + totalFalsePositive;
  const fraudConfirmationRate = totalReviewed > 0
    ? Math.round((totalConfirmedFraud / totalReviewed) * 100)
    : 0;
  
  const falsePositiveRate = totalReviewed > 0
    ? Math.round((totalFalsePositive / totalReviewed) * 100)
    : 0;
  
  // Média de confidence da AI
  const aiAverageConfidence = confidences.length > 0
    ? Math.round(confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length)
    : 0;
  
  const result: FraudMetrics = {
    totalAlerts,
    totalUnreviewed,
    totalHighRisk,
    totalMediumRisk,
    totalLowRisk,
    fraudConfirmationRate,
    falsePositiveRate,
    circuitBreakerStatus: circuitBreakerState.state,
    circuitBreakerFailures: circuitBreakerState.failures,
    aiAvailable: circuitBreakerState.state !== 'OPEN',
    aiAverageConfidence,
    recentAlerts: {
      count: recentCount,
      highRiskCount: recentHighRiskCount
    }
  };
  
  setCache(cacheKey, result);
  return result;
}

/**
 * Métricas de reconciliação
 */
async function aggregateReconciliation(): Promise<ReconciliationMetrics> {
  await ensureFirebaseReady();
  const db = getFirestore();
  
  const cacheKey = 'reconciliation:metrics';
  const cached = getCached<ReconciliationMetrics>(cacheKey);
  if (cached) return cached;
  
  // Buscar último resultado de reconciliação
  const reconciliationSnap = await db
    .collection('reconciliationResults')
    .orderBy('timestamp', 'desc')
    .limit(1)
    .get();
  
  if (reconciliationSnap.empty) {
    // Sem reconciliação ainda
    return {
      lastRunStatus: 'failed',
      sellersChecked: 0,
      discrepanciesFound: 0,
      totalDiscrepancyAmount: 0,
      topDiscrepancies: [],
      healthScore: 100
    };
  }
  
  const lastRun = reconciliationSnap.docs[0].data();
  const discrepancies = lastRun.discrepancies || [];
  
  // Ordenar por diferença absoluta (top 5)
  const sortedDiscrepancies = [...discrepancies]
    .sort((a: any, b: any) => Math.abs(b.difference) - Math.abs(a.difference))
    .slice(0, 5);
  
  // Calcular health score (100 - % de discrepância)
  const totalDiscrepancyAmount = discrepancies.reduce((sum: number, d: any) => sum + Math.abs(d.difference), 0);
  const healthScore = discrepancies.length === 0 
    ? 100 
    : Math.max(0, 100 - (discrepancies.length * 5)); // -5 pontos por discrepância
  
  const result: ReconciliationMetrics = {
    lastRunAt: lastRun.timestamp,
    lastRunStatus: discrepancies.length === 0 ? 'success' : 'partial_success',
    sellersChecked: lastRun.sellersChecked || 0,
    discrepanciesFound: discrepancies.length,
    totalDiscrepancyAmount,
    topDiscrepancies: sortedDiscrepancies.map((d: any) => ({
      sellerId: d.sellerId,
      sellerEmail: d.sellerEmail || 'unknown',
      currency: d.currency,
      storedBalance: d.storedBalance,
      calculatedBalance: d.calculatedBalance,
      difference: Math.abs(d.difference)
    })),
    healthScore
  };
  
  setCache(cacheKey, result);
  return result;
}

// ══════════════════════════════════════════════════════════════
// 🌐 ENDPOINTS
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/admin/monitoring/dashboard
 * Dashboard completo com todas as métricas
 */
router.get('/dashboard', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const admin = getAdmin();
    
    // Buscar todas as métricas em paralelo
    const [balancesBRL, balancesUSD, balancesEUR, withdrawals, fraud, reconciliation] = await Promise.all([
      aggregateBalances('BRL'),
      aggregateBalances('USD'),
      aggregateBalances('EUR'),
      aggregateWithdrawals(),
      aggregateFraud(),
      aggregateReconciliation()
    ]);
    
    // Calcular system health (média ponderada)
    const systemHealth = Math.round(
      (reconciliation.healthScore * 0.4) + // 40% reconciliação
      ((100 - fraud.falsePositiveRate) * 0.3) + // 30% qualidade fraud detection
      ((100 - withdrawals.rejectionRate) * 0.3) // 30% qualidade withdrawals
    );
    
    const dashboard: MonitoringDashboard = {
      generatedAt: admin.firestore.Timestamp.now(),
      balances: {
        BRL: balancesBRL,
        USD: balancesUSD,
        EUR: balancesEUR
      },
      reconciliation,
      withdrawals,
      fraud,
      systemHealth
    };
    
    res.json({
      success: true,
      data: dashboard
    });
  } catch (error: any) {
    console.error('❌ [MONITORING] Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard metrics'
    });
  }
});

/**
 * GET /api/admin/monitoring/balances/:currency
 * Agregação de saldos por moeda
 */
router.get('/balances/:currency', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const { currency } = req.params;
    
    if (!['BRL', 'USD', 'EUR'].includes(currency)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid currency. Must be BRL, USD, or EUR'
      });
    }
    
    const balances = await aggregateBalances(currency as Currency);
    
    res.json({
      success: true,
      data: balances
    });
  } catch (error: any) {
    console.error('❌ [MONITORING] Balances error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch balance metrics'
    });
  }
});

/**
 * GET /api/admin/monitoring/withdrawals
 * Métricas de saques
 */
router.get('/withdrawals', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const metrics = await aggregateWithdrawals();
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error: any) {
    console.error('❌ [MONITORING] Withdrawals error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch withdrawal metrics'
    });
  }
});

/**
 * GET /api/admin/monitoring/fraud
 * Métricas de fraud alerts
 */
router.get('/fraud', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const metrics = await aggregateFraud();
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error: any) {
    console.error('❌ [MONITORING] Fraud error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch fraud metrics'
    });
  }
});

/**
 * GET /api/admin/monitoring/reconciliation
 * Última reconciliação
 */
router.get('/reconciliation', verifyFirebaseToken, requireAdmin, async (req, res) => {
  try {
    const metrics = await aggregateReconciliation();
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error: any) {
    console.error('❌ [MONITORING] Reconciliation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reconciliation metrics'
    });
  }
});

export default router;
