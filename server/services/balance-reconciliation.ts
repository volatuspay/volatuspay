/**
 * 🔍 SERVIÇO DE RECONCILIAÇÃO DE SALDO
 * 
 * Sistema de validação automática que compara saldo calculado vs armazenado
 * Execução diária para garantir integridade da contabilidade
 * 
 * FUNCIONALIDADES:
 * - Calcula saldo real somando todas as movimentações
 * - Compara com saldo armazenado no Firestore
 * - Detecta divergências e alerta admins
 * - Auto-fix para divergências pequenas (< 1 centavo de tolerância)
 * - Audit trail completo de todas as reconciliações
 */

import { getAdmin, getFirestore, ensureFirebaseReady } from '../lib/firebase-admin.js';
import { 
  SellerBalance, 
  BalanceReconciliation, 
  Currency 
} from '../../shared/balance-schema.js';

/**
 * 🎯 TOLERÂNCIA DE DIVERGÊNCIA
 * 
 * Divergências até 1 centavo são consideradas normais devido a:
 * - Arredondamentos de fees
 * - Conversões cambiais
 * - Race conditions mínimas (resolvidas automaticamente)
 */
const TOLERANCE_CENTS = 1;

/**
 * 🔍 RECONCILIAR SALDO DE UM SELLER
 * 
 * @param sellerId - ID do seller
 * @param currency - Moeda a reconciliar (BRL, USD, EUR)
 * @returns Resultado da reconciliação
 */
export async function reconcileSellerBalance(
  sellerId: string,
  currency: Currency
): Promise<BalanceReconciliation> {
  // Garantir Firebase ready (lança erro se falhar)
  await ensureFirebaseReady();
  const admin = getAdmin(); // Lança erro se não inicializado
  const db = getFirestore();  // Lança erro se não inicializado
  
  const reconciliationId = `${sellerId}_${currency}_${Date.now()}`;
  const startTime = Date.now();
  
  console.log(`🔍 [RECONCILIATION] Iniciando para seller ${sellerId} - ${currency}`);
  
  try {
    // ═══════════════════════════════════════════════════════════
    // PASSO 1: BUSCAR SALDO ARMAZENADO
    // ═══════════════════════════════════════════════════════════
    const balanceDoc = await db
      .collection('sellerBalances')
      .doc(sellerId)
      .get();
    
    if (!balanceDoc.exists) {
      throw new Error(`Saldo não encontrado para seller ${sellerId}`);
    }
    
    const balanceData = balanceDoc.data() as SellerBalance;
    
    const stored = {
      available: balanceData[`balanceAvailable_${currency}`] || 0,
      pending: balanceData[`balancePending_${currency}`] || 0,
      reserved: balanceData[`balanceReserved_${currency}`] || 0
    };
    
    console.log(`📊 [RECONCILIATION] Saldo armazenado:`, stored);
    
    // ═══════════════════════════════════════════════════════════
    // PASSO 2: CALCULAR SALDO REAL A PARTIR DAS MOVIMENTAÇÕES
    // ═══════════════════════════════════════════════════════════
    const calculated = await calculateRealBalance(sellerId, currency);
    
    console.log(`🔢 [RECONCILIATION] Saldo calculado:`, calculated);
    
    // ═══════════════════════════════════════════════════════════
    // PASSO 3: COMPARAR E DETECTAR DIVERGÊNCIAS
    // ═══════════════════════════════════════════════════════════
    const discrepancies = {
      available: stored.available - calculated.available,
      pending: stored.pending - calculated.pending,
      reserved: stored.reserved - calculated.reserved
    };
    
    const hasDiscrepancy = 
      Math.abs(discrepancies.available) > TOLERANCE_CENTS ||
      Math.abs(discrepancies.pending) > TOLERANCE_CENTS ||
      Math.abs(discrepancies.reserved) > TOLERANCE_CENTS;
    
    const match = !hasDiscrepancy;
    
    // ═══════════════════════════════════════════════════════════
    // PASSO 4: AUTO-FIX PARA DIVERGÊNCIAS PEQUENAS
    // ═══════════════════════════════════════════════════════════
    let autoFixed = false;
    let fixDetails = '';
    
    if (hasDiscrepancy) {
      console.warn(`⚠️ [RECONCILIATION] Divergência detectada:`, discrepancies);
      
      const totalDiscrepancy = 
        Math.abs(discrepancies.available) +
        Math.abs(discrepancies.pending) +
        Math.abs(discrepancies.reserved);
      
      // Auto-fix se divergência total < 10 centavos
      if (totalDiscrepancy <= 10) {
        console.log(`🔧 [RECONCILIATION] Aplicando auto-fix...`);
        
        try {
          await fixBalanceDiscrepancy(sellerId, currency, calculated);
          autoFixed = true;
          fixDetails = `Auto-fix aplicado: ajustado ${totalDiscrepancy} centavos`;
        } catch (error) {
          console.error(`❌ [RECONCILIATION] Erro no auto-fix:`, error);
          fixDetails = `Auto-fix falhou: ${error.message}`;
        }
      } else {
        fixDetails = `Divergência muito grande (${totalDiscrepancy} centavos) - requer revisão manual`;
      }
    }
    
    // ═══════════════════════════════════════════════════════════
    // PASSO 5: SALVAR RESULTADO DA RECONCILIAÇÃO
    // ═══════════════════════════════════════════════════════════
    const executionTime = Date.now() - startTime;
    
    const reconciliation: BalanceReconciliation = {
      reconciliationId,
      sellerId,
      currency,
      calculated,
      stored,
      match,
      discrepancies: hasDiscrepancy ? discrepancies : undefined,
      ordersProcessed: calculated.metadata.ordersProcessed,
      movementsProcessed: calculated.metadata.movementsProcessed,
      withdrawalsProcessed: calculated.metadata.withdrawalsProcessed,
      executionTime,
      autoFixed,
      fixDetails: autoFixed || hasDiscrepancy ? fixDetails : undefined,
      alertSent: false,
      createdAt: admin.firestore.Timestamp.now(),
      completedAt: admin.firestore.Timestamp.now()
    };
    
    await db
      .collection('balanceReconciliations')
      .doc(reconciliationId)
      .set(reconciliation);
    
    // ═══════════════════════════════════════════════════════════
    // PASSO 6: ALERTAR SE DIVERGÊNCIA GRAVE
    // ═══════════════════════════════════════════════════════════
    if (hasDiscrepancy && !autoFixed) {
      await sendReconciliationAlert(sellerId, currency, reconciliation);
      
      await db
        .collection('balanceReconciliations')
        .doc(reconciliationId)
        .update({
          alertSent: true,
          alertReason: fixDetails
        });
    }
    
    // ═══════════════════════════════════════════════════════════
    // PASSO 7: ATUALIZAR DATA DA ÚLTIMA RECONCILIAÇÃO
    // ═══════════════════════════════════════════════════════════
    await db
      .collection('sellerBalances')
      .doc(sellerId)
      .update({
        lastReconciliation: admin.firestore.Timestamp.now()
      });
    
    console.log(`✅ [RECONCILIATION] Finalizado em ${executionTime}ms - Match: ${match}`);
    
    return reconciliation;
    
  } catch (error) {
    console.error(`❌ [RECONCILIATION] Erro:`, error);
    
    const reconciliation: BalanceReconciliation = {
      reconciliationId,
      sellerId,
      currency,
      calculated: { available: 0, pending: 0, reserved: 0 },
      stored: { available: 0, pending: 0, reserved: 0 },
      match: false,
      ordersProcessed: 0,
      movementsProcessed: 0,
      withdrawalsProcessed: 0,
      executionTime: Date.now() - startTime,
      autoFixed: false,
      alertSent: false,
      createdAt: admin.firestore.Timestamp.now(),
      failedAt: admin.firestore.Timestamp.now(),
      error: error.message
    };
    
    await db
      .collection('balanceReconciliations')
      .doc(reconciliationId)
      .set(reconciliation);
    
    throw error;
  }
}

/**
 * 🔢 CALCULAR SALDO REAL A PARTIR DE ORDERS + MOVEMENTS
 * 
 * Soma todas as transações do seller e retorna saldo real
 */
async function calculateRealBalance(
  sellerId: string,
  currency: Currency
): Promise<{
  available: number;
  pending: number;
  reserved: number;
  metadata: {
    ordersProcessed: number;
    movementsProcessed: number;
    withdrawalsProcessed: number;
  };
}> {
  const db = getFirestore();
  if (!db) {
    throw new Error('Firestore não disponível');
  }
  
  let available = 0;
  let pending = 0;
  let reserved = 0;
  
  let ordersProcessed = 0;
  let movementsProcessed = 0;
  let withdrawalsProcessed = 0;
  
  // ═══════════════════════════════════════════════════════════
  // MÉTODO 1: SOMAR TODAS AS MOVIMENTAÇÕES (MAIS PRECISO)
  // ═══════════════════════════════════════════════════════════
  const movementsSnapshot = await db
    .collection('balanceMovements')
    .where('sellerId', '==', sellerId)
    .where('currency', '==', currency)
    .orderBy('createdAt', 'asc')
    .get();
  
  movementsProcessed = movementsSnapshot.size;
  
  for (const doc of movementsSnapshot.docs) {
    const movement = doc.data();
    
    // Usar snapshot pós-operação se disponível; caso contrário acumular delta
    if (movement.balanceAfter && typeof movement.balanceAfter.available === 'number') {
      available = movement.balanceAfter.available;
      pending = movement.balanceAfter.pending ?? pending;
      reserved = movement.balanceAfter.reserved ?? reserved;
    } else {
      // Fallback: calcular delta pela operação e tipo de saldo
      const delta = movement.operation === 'subtract'
        ? -(movement.amountCents || 0)
        : (movement.amountCents || 0);
      if (movement.balanceType === 'available') available += delta;
      else if (movement.balanceType === 'pending') pending += delta;
      else if (movement.balanceType === 'reserved') reserved += delta;
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // FALLBACK: SE NÃO HÁ MOVIMENTAÇÕES, CALCULAR POR ORDERS
  // ═══════════════════════════════════════════════════════════
  if (movementsProcessed === 0) {
    console.log(`⚠️ [RECONCILIATION] Sem movimentações, calculando por orders...`);
    
    // Buscar todas as orders do seller
    const ordersSnapshot = await db
      .collection('orders')
      .where('tenantId', '==', sellerId)
      .get();
    
    ordersProcessed = ordersSnapshot.size;
    
    for (const orderDoc of ordersSnapshot.docs) {
      const order = orderDoc.data();
      
      // Só processar orders na moeda correta
      if (!order.feeSnapshot || order.feeSnapshot.currency !== currency) {
        continue;
      }
      
      const netAmount = order.feeSnapshot.netAmountCents || 0;
      
      switch (order.status) {
        case 'paid':
        case 'approved':
          // Saldo disponível
          available += netAmount;
          break;
        
        case 'pending':
        case 'processing':
          // Saldo pendente
          pending += netAmount;
          break;
        
        default:
          // Outros status não afetam saldo
          break;
      }
    }
    
    // Subtrair saques processados
    const withdrawalsSnapshot = await db
      .collection('withdrawals')
      .where('sellerId', '==', sellerId)
      .where('currency', '==', currency)
      .where('status', 'in', ['completed', 'processing'])
      .get();
    
    withdrawalsProcessed = withdrawalsSnapshot.size;
    
    for (const withdrawalDoc of withdrawalsSnapshot.docs) {
      const withdrawal = withdrawalDoc.data();
      
      if (withdrawal.status === 'completed') {
        // Saque concluído - já foi removido
        // Não precisa fazer nada
      } else if (withdrawal.status === 'processing') {
        // Saque em processamento - reservado
        reserved += withdrawal.amount;
        available -= withdrawal.amount;
      }
    }
  }
  
  return {
    available,
    pending,
    reserved,
    metadata: {
      ordersProcessed,
      movementsProcessed,
      withdrawalsProcessed
    }
  };
}

/**
 * 🔧 CORRIGIR DIVERGÊNCIA DE SALDO
 * 
 * Aplica o saldo calculado ao Firestore usando transaction atômica
 */
async function fixBalanceDiscrepancy(
  sellerId: string,
  currency: Currency,
  calculatedBalance: { available: number; pending: number; reserved: number }
): Promise<void> {
  const admin = getAdmin();
  const db = getFirestore();
  
  if (!admin || !db) {
    throw new Error('Firebase não disponível');
  }
  
  await db.runTransaction(async (transaction) => {
    const balanceRef = db.collection('sellerBalances').doc(sellerId);
    const balanceDoc = await transaction.get(balanceRef);
    
    if (!balanceDoc.exists) {
      throw new Error(`Saldo não encontrado para seller ${sellerId}`);
    }
    
    const currentData = balanceDoc.data() as SellerBalance;
    
    // Aplicar correção
    transaction.update(balanceRef, {
      [`balanceAvailable_${currency}`]: calculatedBalance.available,
      [`balancePending_${currency}`]: calculatedBalance.pending,
      [`balanceReserved_${currency}`]: calculatedBalance.reserved,
      version: (currentData.version || 0) + 1,
      updatedAt: admin.firestore.Timestamp.now()
    });
    
    console.log(`✅ [RECONCILIATION] Saldo corrigido para ${currency}:`, calculatedBalance);
  });
}

/**
 * 🚨 ENVIAR ALERTA DE DIVERGÊNCIA GRAVE
 * 
 * Notifica admins sobre divergências que requerem atenção manual
 */
async function sendReconciliationAlert(
  sellerId: string,
  currency: Currency,
  reconciliation: BalanceReconciliation
): Promise<void> {
  const admin = getAdmin();
  const db = getFirestore();
  
  if (!admin || !db) {
    throw new Error('Firebase não disponível');
  }
  
  console.error(`🚨 [RECONCILIATION ALERT] Divergência grave detectada!`);
  console.error(`Seller: ${sellerId}`);
  console.error(`Currency: ${currency}`);
  console.error(`Discrepancies:`, reconciliation.discrepancies);
  
  // Salvar alerta na coleção de alertas
  await db.collection('adminAlerts').add({
    type: 'balance_discrepancy',
    severity: 'high',
    sellerId,
    currency,
    reconciliationId: reconciliation.reconciliationId,
    discrepancies: reconciliation.discrepancies,
    calculated: reconciliation.calculated,
    stored: reconciliation.stored,
    createdAt: admin.firestore.Timestamp.now(),
    read: false
  });
  
  // TODO: Enviar email/notificação push para admins
  // TODO: Integrar com sistema de logging/monitoring (Sentry, Datadog, etc)
}

/**
 * 🔄 RECONCILIAR TODOS OS SELLERS
 * 
 * Execução diária (cron) para validar saldos de todos os sellers
 */
export async function reconcileAllSellers(): Promise<void> {
  // Garantir Firebase ready (lança erro se falhar)
  await ensureFirebaseReady();
  const admin = getAdmin();
  const db = getFirestore();
  
  console.log(`🔍 [RECONCILIATION] Iniciando reconciliação de todos os sellers...`);
  
  const startTime = Date.now();
  
  try {
    // Buscar todos os sellers com saldo
    const sellersSnapshot = await db
      .collection('sellerBalances')
      .get();
    
    console.log(`📊 [RECONCILIATION] ${sellersSnapshot.size} sellers encontrados`);
    
    let successCount = 0;
    let errorCount = 0;
    let discrepancyCount = 0;
    
    // Processar sellers em paralelo (batches de 10)
    const BATCH_SIZE = 10;
    const sellerIds = sellersSnapshot.docs.map(doc => doc.id);
    
    for (let i = 0; i < sellerIds.length; i += BATCH_SIZE) {
      const batch = sellerIds.slice(i, i + BATCH_SIZE);
      
      // Filtrar apenas sellers com balance doc
      const validSellers = [];
      for (const sellerId of batch) {
        const balanceDoc = await db.collection('sellerBalances').doc(sellerId).get();
        if (balanceDoc.exists) {
          validSellers.push(sellerId);
        } else {
          console.warn(`⚠️ [RECONCILIATION] Seller ${sellerId} sem balance doc - ignorando`);
        }
      }
      
      const results = await Promise.allSettled(
        validSellers.flatMap(sellerId => [
          reconcileSellerBalance(sellerId, 'BRL'),
          reconcileSellerBalance(sellerId, 'USD'),
          reconcileSellerBalance(sellerId, 'EUR')
        ])
      );
      
      for (const result of results) {
        if (result.status === 'fulfilled') {
          successCount++;
          if (!result.value.match) {
            discrepancyCount++;
          }
        } else {
          errorCount++;
          console.error(`❌ [RECONCILIATION] Erro:`, result.reason);
        }
      }
    }
    
    const executionTime = Date.now() - startTime;
    
    console.log(`✅ [RECONCILIATION] Concluído em ${executionTime}ms`);
    console.log(`📊 Resultados: ${successCount} sucesso, ${errorCount} erros, ${discrepancyCount} divergências`);
    
    // Salvar estatísticas
    await db.collection('reconciliationStats').add({
      type: 'daily_run',
      sellersProcessed: sellersSnapshot.size,
      successCount,
      errorCount,
      discrepancyCount,
      executionTime,
      createdAt: admin.firestore.Timestamp.now()
    });
    
  } catch (error) {
    console.error(`❌ [RECONCILIATION] Erro fatal:`, error);
    throw error;
  }
}
