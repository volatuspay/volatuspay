/**
 * 💰 TRANSACTION LIMITS — LIMITE DE VALOR POR TRANSAÇÃO E POR DIA
 * Proteção contra fraudes grandes. Admin configura por seller.
 * Padrão: R$50.000 por dia, R$10.000 por transação individual.
 */

import { getFirestore } from '../lib/firebase-admin';
import { firestoreCache } from '../lib/firestore-cache';

const DEFAULT_MAX_SINGLE_TRANSACTION_CENTS = 1000000; // R$10.000
const DEFAULT_MAX_DAILY_CENTS = 5000000;              // R$50.000

interface LimitConfig {
  maxSingleTransactionCents: number;
  maxDailyCents: number;
  enabled: boolean;
}

interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  dailyTotalCents?: number;
  limitCents?: number;
}

async function getSellerLimitConfig(sellerId: string): Promise<LimitConfig> {
  try {
    const db = getFirestore();
    const doc = await db.collection('seller-transaction-limits').doc(sellerId).get();
    if (doc.exists) {
      const d = doc.data() as any;
      return {
        maxSingleTransactionCents: d.maxSingleTransactionCents ?? DEFAULT_MAX_SINGLE_TRANSACTION_CENTS,
        maxDailyCents: d.maxDailyCents ?? DEFAULT_MAX_DAILY_CENTS,
        enabled: d.enabled !== false,
      };
    }
  } catch {}
  return {
    maxSingleTransactionCents: DEFAULT_MAX_SINGLE_TRANSACTION_CENTS,
    maxDailyCents: DEFAULT_MAX_DAILY_CENTS,
    enabled: true,
  };
}

async function getDailyTotal(sellerId: string): Promise<number> {
  try {
    const db = getFirestore();
    const today = new Date().toISOString().slice(0, 10);
    const doc = await db.collection('seller-daily-totals').doc(`${sellerId}_${today}`).get();
    if (!doc.exists) return 0;
    return (doc.data() as any)?.totalCents || 0;
  } catch {
    return 0;
  }
}

async function incrementDailyTotal(sellerId: string, amountCents: number): Promise<void> {
  try {
    const db = getFirestore();
    const admin = await import('../lib/firebase-admin').then(m => m.getAdmin());
    const today = new Date().toISOString().slice(0, 10);
    const docId = `${sellerId}_${today}`;
    await db.collection('seller-daily-totals').doc(docId).set({
      sellerId,
      date: today,
      totalCents: admin.firestore.FieldValue.increment(amountCents),
      lastUpdatedAt: new Date(),
    }, { merge: true });
  } catch (e: any) {
    console.error('⚠️ [TX-LIMITS] Erro ao incrementar total diário:', e?.message);
  }
}

/**
 * 🔍 VERIFICAR SE TRANSAÇÃO ESTÁ DENTRO DO LIMITE
 */
export async function checkTransactionLimit(sellerId: string, amountCents: number): Promise<LimitCheckResult> {
  try {
    const config = await getSellerLimitConfig(sellerId);

    if (!config.enabled) {
      return { allowed: true };
    }

    if (amountCents > config.maxSingleTransactionCents) {
      const limitFmt = (config.maxSingleTransactionCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const valueFmt = (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      console.warn(`🚫 [TX-LIMITS] Transação ${valueFmt} excede limite individual ${limitFmt} — seller: ${sellerId.slice(0, 8)}...`);
      return {
        allowed: false,
        reason: `Valor por transação excede o limite configurado de ${limitFmt}. Entre em contato com o suporte para aumentar o limite.`,
        limitCents: config.maxSingleTransactionCents,
      };
    }

    const dailyTotal = await getDailyTotal(sellerId);
    const projectedTotal = dailyTotal + amountCents;

    if (projectedTotal > config.maxDailyCents) {
      const limitFmt = (config.maxDailyCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const usedFmt = (dailyTotal / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      console.warn(`🚫 [TX-LIMITS] Limite diário atingido: ${usedFmt} usado de ${limitFmt} — seller: ${sellerId.slice(0, 8)}...`);
      return {
        allowed: false,
        reason: `Limite diário de transações atingido (${limitFmt}/dia). Disponível novamente amanhã.`,
        dailyTotalCents: dailyTotal,
        limitCents: config.maxDailyCents,
      };
    }

    return { allowed: true, dailyTotalCents: dailyTotal };
  } catch (e: any) {
    console.error('⚠️ [TX-LIMITS] Erro na verificação:', e?.message);
    return { allowed: true };
  }
}

/**
 * ✅ REGISTRAR TRANSAÇÃO APROVADA (chamar após pagamento confirmado)
 */
export async function recordApprovedTransaction(sellerId: string, amountCents: number): Promise<void> {
  await incrementDailyTotal(sellerId, amountCents);
}

/**
 * 🔧 CONFIGURAR LIMITES DO SELLER (admin only)
 */
export async function setSellerTransactionLimits(
  sellerId: string,
  limits: { maxSingleTransactionCents?: number; maxDailyCents?: number; enabled?: boolean }
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    await db.collection('seller-transaction-limits').doc(sellerId).set({
      ...limits,
      updatedAt: new Date(),
    }, { merge: true });
    console.log(`🔧 [TX-LIMITS] Limites atualizados para seller: ${sellerId.slice(0, 8)}...`);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * 📊 OBTER LIMITES E USO DO DIA DO SELLER
 */
export async function getSellerTransactionStatus(sellerId: string): Promise<{
  config: LimitConfig;
  dailyTotalCents: number;
  remainingDailyCents: number;
}> {
  const config = await getSellerLimitConfig(sellerId);
  const dailyTotalCents = await getDailyTotal(sellerId);
  return {
    config,
    dailyTotalCents,
    remainingDailyCents: Math.max(0, config.maxDailyCents - dailyTotalCents),
  };
}
