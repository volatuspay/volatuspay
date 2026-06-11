/**
 * ⏰ SCHEDULER DE RECONCILIAÇÃO E LIBERAÇÃO DE SALDO
 * 
 * Executa:
 * - Reconciliação automática diariamente (3h da manhã)
 * - Liberação de comissões de afiliados a cada hora
 * - Liberação de saldo pendente de cartão quando chega o prazo (D+releaseDays)
 * Garante integridade contínua da contabilidade
 */

import cron from 'node-cron';
import { reconcileAllSellers } from './balance-reconciliation.js';
import { ensureFirebaseReady } from '../lib/firebase-admin.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { storage } from '../storage.js';
import { moveBalance } from '../lib/atomic-balance.js';

/**
 * 💳 LIBERAR SALDO PENDENTE DE CARTÃO
 *
 * Verifica todas as balanceMovements de cartão com `pending` e releaseDate <= agora,
 * e move o saldo para `available`.
 * Usa o orderId para marcar a order como financialBalanceReleased=true.
 */
async function releaseCardPendingBalances() {
  const db = getFirestore();
  const now = new Date();

  console.log(`💳 [SCHEDULER] Verificando saldos pendentes de cartão para liberação...`);

  // Busca movimentos de cartão pendentes com data de liberação passada
  const snapshot = await db
    .collection('balanceMovements')
    .where('balanceType', '==', 'add-pending')
    .where('metadata.method', '==', 'card')
    .where('metadata.releaseDate', '<=', now.toISOString())
    .where('cardReleased', '==', false)
    .limit(100)
    .get();

  // Alternativa: busca por orderId nas orders diretamente
  const ordersSnap = await db
    .collection('orders')
    .where('paymentMethod', 'in', ['credit_card', 'card', 'efibank_card', 'creditCard'])
    .where('status', '==', 'paid')
    .where('financial.cardBalanceReleased', '==', false)
    .where('financial.balanceType', '==', 'pending')
    .limit(100)
    .get();

  let released = 0;
  let errors = 0;

  for (const orderDoc of ordersSnap.docs) {
    const order = orderDoc.data();
    const financial = order.financial || order.financialData || {};
    const releaseDate = financial.releaseDate;

    if (!releaseDate) continue;

    // Verificar se a data de liberação chegou
    const releaseDateObj = releaseDate?.toDate ? releaseDate.toDate() : new Date(releaseDate);
    if (releaseDateObj > now) continue;

    const sellerId = order.tenantId || order.sellerId;
    if (!sellerId) continue;

    // Usar sellerCreditAmount (= netAmount já com comissão de afiliado deduzida)
    // pois foi esse o valor creditado no balancePending_BRL do seller
    const netAmount = Math.round(
      financial.sellerCreditAmount ||
      order.netAmount ||
      financial.netAmount ||
      0
    );
    if (netAmount <= 0) continue;

    try {
      await moveBalance(
        sellerId,
        netAmount,
        'BRL',
        'pending',
        'available',
        `Liberação automática cartão D+${financial.releaseDays || 30} - Ordem ${orderDoc.id}`,
        {
          orderId: orderDoc.id,
          method: 'card',
          releaseDate: releaseDateObj.toISOString(),
          releaseDays: financial.releaseDays || 30,
        }
      );

      // Marcar a order como saldo liberado
      await orderDoc.ref.update({
        'financial.cardBalanceReleased': true,
        'financial.cardBalanceReleasedAt': FieldValue.serverTimestamp(),
      });

      released++;
      console.log(`✅ [SCHEDULER] Saldo cartão liberado: Ordem ${orderDoc.id}, Vendedor ${sellerId}, R$ ${(netAmount/100).toFixed(2)}`);
    } catch (err: any) {
      errors++;
      console.error(`❌ [SCHEDULER] Erro ao liberar saldo cartão Ordem ${orderDoc.id}:`, err?.message);
    }
  }

  console.log(`💳 [SCHEDULER] Liberação cartão concluída: ${released} liberados, ${errors} erros`);
  return { released, errors };
}

/**
 * 🚀 INICIAR SCHEDULER
 * 
 * Executa:
 * - Reconciliação diária às 3h (baixo tráfego)
 * - Liberação de comissões a cada hora (garantir que afiliados recebam no prazo)
 * - Liberação de saldo pendente de cartão a cada 4 horas
 */
export async function startBalanceReconciliationScheduler() {
  await ensureFirebaseReady();
  console.log(`⏰ [SCHEDULER] Iniciando schedulers de saldo...`);
  
  // 🔍 RECONCILIAÇÃO: Diariamente às 3h00
  cron.schedule('0 3 * * *', async () => {
    console.log(`🔍 [SCHEDULER] Executando reconciliação diária...`);
    
    try {
      await reconcileAllSellers();
      console.log(`✅ [SCHEDULER] Reconciliação concluída com sucesso`);
    } catch (error) {
      console.error(`❌ [SCHEDULER] Erro na reconciliação:`, error);
    }
  });
  
  // 💰 LIBERAÇÃO DE COMISSÕES: A cada hora (minuto 30)
  cron.schedule('30 * * * *', async () => {
    console.log(`💰 [SCHEDULER] Executando liberação de comissões de afiliados...`);
    
    try {
      const result = await (storage as any).releaseAffiliateCommissions({ batchSize: 100 });
      console.log(`✅ [SCHEDULER] Liberação concluída: ${result.released}/${result.processed} comissões liberadas`);
    } catch (error) {
      console.error(`❌ [SCHEDULER] Erro na liberação de comissões:`, error);
    }
  });

  // 💳 LIBERAÇÃO DE SALDO PENDENTE DE CARTÃO: A cada 4 horas (minutos 0, 4h, 8h, 12h, 16h, 20h)
  cron.schedule('0 */4 * * *', async () => {
    console.log(`💳 [SCHEDULER] Executando liberação de saldo pendente de cartão...`);
    
    try {
      const result = await releaseCardPendingBalances();
      console.log(`✅ [SCHEDULER] Liberação cartão: ${result.released} liberados`);
    } catch (error) {
      console.error(`❌ [SCHEDULER] Erro na liberação de saldo cartão:`, error);
    }
  });
  
  console.log(`✅ [SCHEDULER] Schedulers configurados:`);
  console.log(`   📊 Reconciliação: diariamente às 3h00`);
  console.log(`   💰 Liberação de comissões: a cada hora (minuto 30)`);
  console.log(`   💳 Liberação saldo cartão: a cada 4 horas`);
}

/**
 * 🧪 EXECUTAR RECONCILIAÇÃO MANUALMENTE (TESTE)
 * 
 * Útil para testes ou execução manual via admin
 */
export async function runReconciliationNow() {
  console.log(`🔍 [SCHEDULER] Executando reconciliação manual...`);
  
  try {
    await reconcileAllSellers();
    console.log(`✅ [SCHEDULER] Reconciliação manual concluída`);
    return { success: true };
  } catch (error) {
    console.error(`❌ [SCHEDULER] Erro na reconciliação manual:`, error);
    throw error;
  }
}

/**
 * 🧪 EXECUTAR LIBERAÇÃO DE CARTÃO MANUALMENTE
 */
export async function runCardPendingReleaseNow() {
  await ensureFirebaseReady();
  return releaseCardPendingBalances();
}
