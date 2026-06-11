/**
 * 💰 ATOMIC BALANCE MUTATIONS - SISTEMA LIVRE DE RACE CONDITIONS
 * 
 * Helper unificado para todas as mutações de saldo com:
 * - Transações atômicas Firestore
 * - Deduplicação de webhooks embutida
 * - Proteção contra double-processing
 * - Rollback automático em caso de erro
 */

import { getFirestore } from './firebase-admin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { neonUpsertSellerBalance, neonMoveSellerBalance, neonWriteBalanceMovement } from './neon-financial.js';

export interface BalanceMutationParams {
  sellerId: string;
  amountCents: number;
  currency: 'BRL' | 'USD' | 'EUR';
  operation: 'add' | 'subtract';
  balanceType: 'available' | 'pending' | 'reserved';
  reason: string;
  orderId?: string;
  subscriptionId?: string;
  metadata?: Record<string, any>;
}

export interface WebhookProcessingParams extends BalanceMutationParams {
  webhookId: string;
  provider: 'efibank' | 'stripe' | 'adyen' | 'woovi' | 'onz' | 'pagarme';
  eventType: string;
  rawPayload?: any;
}

/**
 * 🔐 PROCESSAMENTO ATÔMICO DE WEBHOOK + BALANCE UPDATE
 * 
 * Garante que:
 * 1. Webhook só é processado UMA vez (idempotência)
 * 2. Balance é atualizado atomicamente com a deduplicação
 * 3. Em caso de erro, NADA é commitado (rollback automático)
 * 
 * @returns { processed: true } se processou, { processed: false, reason } se duplicado
 */
export async function processWebhookWithBalanceUpdate(
  params: WebhookProcessingParams
): Promise<{ processed: boolean; reason?: string; balanceAfter?: any }> {
  const db = getFirestore();

  try {
    return await db.runTransaction(async (transaction) => {
      // 🔍 STEP 1: Verificar se webhook já foi processado (dentro da transação)
      const dedupeKey = `${params.provider}:${params.webhookId}`;
      const webhookRef = db.collection('processedWebhooks').doc(dedupeKey);
      const webhookDoc = await transaction.get(webhookRef);

      if (webhookDoc.exists) {
        const existingData = webhookDoc.data();
        console.log(`⚠️ WEBHOOK DUPLICADO DETECTADO: ${dedupeKey}`);
        console.log(`   Processado em: ${existingData?.processedAt?.toDate()}`);
        return {
          processed: false,
          reason: `Webhook ${dedupeKey} já processado em ${existingData?.processedAt?.toDate()}`
        };
      }

      // 🏦 STEP 2: Ler estado atual do balance
      const balanceRef = db.collection('sellerBalances').doc(params.sellerId);
      const balanceDoc = await transaction.get(balanceRef);
      const increment = params.operation === 'add' ? params.amountCents : -params.amountCents;
      const paymentMethod = params.metadata?.method || params.eventType?.split('.')?.[0] || 'pix';
      const acquirer = params.metadata?.acquirer || params.provider;

      // ✅ UMA ÚNICA ESCRITA para balanceRef (evita double-write que aborta transação)
      if (!balanceDoc.exists) {
        // 🆕 BOOTSTRAP: Documento não existe → criar com valores reais (sem FieldValue.increment)
        console.log(`🆕 Criando primeiro registro de balance para seller ${params.sellerId}`);

        const avail = params.balanceType === 'available' ? increment : 0;
        const pend  = params.balanceType === 'pending'   ? increment : 0;
        const res   = params.balanceType === 'reserved'  ? increment : 0;

        const initialDoc: any = {
          sellerId: params.sellerId,
          totalBalance: increment,
          availableBalance: avail,
          pendingBalance: pend,
          reservedBalance: res,
          balanceAvailable_BRL: params.currency === 'BRL' ? avail : 0,
          balancePending_BRL:   params.currency === 'BRL' ? pend  : 0,
          balanceReserved_BRL:  params.currency === 'BRL' ? res   : 0,
          lifetimeRevenue_BRL:  params.currency === 'BRL' && params.operation === 'add' && params.balanceType === 'available' ? params.amountCents : 0,
          balanceAvailable_USD: params.currency === 'USD' ? avail : 0,
          balancePending_USD:   params.currency === 'USD' ? pend  : 0,
          balanceReserved_USD:  params.currency === 'USD' ? res   : 0,
          lifetimeRevenue_USD:  params.currency === 'USD' && params.operation === 'add' && params.balanceType === 'available' ? params.amountCents : 0,
          balanceAvailable_EUR: params.currency === 'EUR' ? avail : 0,
          balancePending_EUR:   params.currency === 'EUR' ? pend  : 0,
          balanceReserved_EUR:  params.currency === 'EUR' ? res   : 0,
          lifetimeRevenue_EUR:  params.currency === 'EUR' && params.operation === 'add' && params.balanceType === 'available' ? params.amountCents : 0,
          totalWithdrawn_BRL: 0,
          totalWithdrawn_USD: 0,
          totalWithdrawn_EUR: 0,
          byMethod: {
            pix:         { total: 0, available: 0, pending: 0, reserved: 0 },
            boleto:      { total: 0, available: 0, pending: 0, reserved: 0 },
            credit_card: { total: 0, available: 0, pending: 0, reserved: 0 },
            debit_card:  { total: 0, available: 0, pending: 0, reserved: 0 },
            [paymentMethod]: { total: increment, available: avail, pending: pend, reserved: res },
          },
          balances_BRL: {
            pix: { byAcquirer: { woovi: { available: 0, pending: 0, reserved: 0, transactionCount: 0 } } },
            boleto: { byAcquirer: { efi: { available: 0, pending: 0, reserved: 0, transactionCount: 0 } } },
            credit_card: { byAcquirer: { stripe: { available: 0, pending: 0, reserved: 0, transactionCount: 0 } } },
            debit_card: { byAcquirer: { stripe: { available: 0, pending: 0, reserved: 0, transactionCount: 0 } } },
            [paymentMethod]: {
              byAcquirer: {
                [acquirer]: { available: avail, pending: pend, reserved: res, transactionCount: 1 }
              }
            },
          },
          balances_USD: { credit_card: { byAcquirer: { stripe: { available: 0, pending: 0, reserved: 0, transactionCount: 0 } } } },
          balances_EUR: { credit_card: { byAcquirer: { stripe: { available: 0, pending: 0, reserved: 0, transactionCount: 0 } } } },
          currency: 'BRL',
          version: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        transaction.set(balanceRef, initialDoc);
        console.log(`✅ Balance inicial criado para seller ${params.sellerId}: +R$ ${(params.amountCents / 100).toFixed(2)}`);

      } else {
        // 📈 UPDATE: Documento já existe → usar update() com dotted paths (FieldValue.increment seguro)
        const updateData: any = {
          totalBalance: FieldValue.increment(increment),
          [`${params.balanceType}Balance`]: FieldValue.increment(increment),
          [`balance${capitalize(params.balanceType)}_${params.currency}`]: FieldValue.increment(increment),
          [`byMethod.${paymentMethod}.total`]: FieldValue.increment(increment),
          [`byMethod.${paymentMethod}.${params.balanceType}`]: FieldValue.increment(increment),
          [`balances_${params.currency}.${paymentMethod}.byAcquirer.${acquirer}.${params.balanceType}`]: FieldValue.increment(increment),
          [`balances_${params.currency}.${paymentMethod}.byAcquirer.${acquirer}.transactionCount`]: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          version: FieldValue.increment(1),
        };

        if (params.operation === 'add' && params.balanceType === 'available') {
          updateData[`lifetimeRevenue_${params.currency}`] = FieldValue.increment(params.amountCents);
        }

        transaction.update(balanceRef, updateData);
      }

      // 📋 STEP 3: Registrar movimento de balance (audit trail)
      const movementRef = db.collection('balanceMovements').doc();
      transaction.set(movementRef, {
        sellerId: params.sellerId,
        amountCents: increment,
        currency: params.currency,
        balanceType: params.balanceType,
        operation: params.operation,
        reason: params.reason,
        orderId: params.orderId || null,
        subscriptionId: params.subscriptionId || null,
        webhookId: params.webhookId,
        provider: params.provider,
        eventType: params.eventType,
        metadata: params.metadata || {},
        createdAt: FieldValue.serverTimestamp(),
      });

      // ✅ STEP 4: Marcar webhook como processado
      transaction.set(webhookRef, {
        provider: params.provider,
        eventType: params.eventType,
        sellerId: params.sellerId,
        amountCents: params.amountCents,
        currency: params.currency,
        orderId: params.orderId || null,
        subscriptionId: params.subscriptionId || null,
        processedAt: FieldValue.serverTimestamp(),
        rawPayload: params.rawPayload ? JSON.stringify(params.rawPayload) : null,
        ttl: Timestamp.fromMillis(Date.now() + (30 * 24 * 60 * 60 * 1000)),
      });

      console.log(`✅ WEBHOOK PROCESSADO ATOMICAMENTE: ${params.webhookId}`);
      console.log(`   Provider: ${params.provider}, Event: ${params.eventType}`);
      console.log(`   Seller: ${params.sellerId}, Balance: ${params.operation} R$ ${(params.amountCents / 100).toFixed(2)} ${params.currency}`);

      return { processed: true, _neonPayload: { isNew: !balanceDoc.exists, initialDoc: balanceDoc.exists ? null : { sellerId: params.sellerId, totalBalance: increment, availableBalance: params.balanceType === 'available' ? increment : 0, pendingBalance: params.balanceType === 'pending' ? increment : 0, reservedBalance: params.balanceType === 'reserved' ? increment : 0 } } };
    });

    // 🐘 DUAL-WRITE → Neon (fire-and-forget, após transação Firestore)
    const delta = params.operation === 'add' ? params.amountCents : -params.amountCents;
    Promise.all([
      neonUpsertSellerBalance({ sellerId: params.sellerId, delta, currency: params.currency, balanceType: params.balanceType, operation: params.operation }),
      neonWriteBalanceMovement({ sellerId: params.sellerId, amountCents: delta, currency: params.currency, balanceType: params.balanceType, operation: params.operation, reason: params.reason, orderId: params.orderId, subscriptionId: params.subscriptionId, webhookId: params.webhookId, provider: params.provider, eventType: params.eventType, metadata: params.metadata }),
    ]).catch(() => {});

    return { processed: true };

  } catch (error: any) {
    console.error(`❌ ERRO ao processar webhook ${params.webhookId}:`, error);
    throw error;
  }
}

/**
 * 💰 HELPER: Adicionar ao saldo (SEM webhook - para operações manuais)
 */
export async function addToBalance(
  sellerId: string,
  amountCents: number,
  currency: 'BRL' | 'USD' | 'EUR',
  reason: string,
  metadata?: Record<string, any>
): Promise<void> {
  const db = getFirestore();

  await db.runTransaction(async (transaction) => {
    const balanceRef = db.collection('sellerBalances').doc(sellerId);
    const balanceDoc = await transaction.get(balanceRef);

    if (!balanceDoc.exists) {
      throw new Error(`Seller ${sellerId} não possui registro de balance`);
    }

    const balanceUpdate: any = {
      [`balanceAvailable_${currency}`]: FieldValue.increment(amountCents),
      [`lifetimeRevenue_${currency}`]: FieldValue.increment(amountCents),
      totalBalance: FieldValue.increment(amountCents),
      availableBalance: FieldValue.increment(amountCents),
      updatedAt: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    };

    transaction.update(balanceRef, balanceUpdate);

    const movementRef = db.collection('balanceMovements').doc();
    transaction.set(movementRef, {
      sellerId,
      amountCents,
      currency,
      balanceType: 'available',
      operation: 'add',
      reason,
      metadata: metadata || {},
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // 🐘 DUAL-WRITE → Neon (fire-and-forget)
  Promise.all([
    neonUpsertSellerBalance({ sellerId, delta: amountCents, currency, balanceType: 'available', operation: 'add' }),
    neonWriteBalanceMovement({ sellerId, amountCents, currency, balanceType: 'available', operation: 'add', reason, metadata }),
  ]).catch(() => {});
}

/**
 * 💸 HELPER: Subtrair do saldo (para saques, estornos, etc.)
 */
export async function subtractFromBalance(
  sellerId: string,
  amountCents: number,
  currency: 'BRL' | 'USD' | 'EUR',
  reason: string,
  metadata?: Record<string, any>
): Promise<void> {
  const db = getFirestore();

  await db.runTransaction(async (transaction) => {
    const balanceRef = db.collection('sellerBalances').doc(sellerId);
    const balanceDoc = await transaction.get(balanceRef);

    if (!balanceDoc.exists) {
      throw new Error(`Seller ${sellerId} não possui registro de balance`);
    }

    const currentBalance = balanceDoc.data();
    const availableField = `balanceAvailable_${currency}`;
    const currentAvailable = currentBalance[availableField] || 0;

    if (currentAvailable < amountCents) {
      throw new Error(`Saldo insuficiente: disponível ${currentAvailable / 100} ${currency}, tentou subtrair ${amountCents / 100} ${currency}`);
    }

    const balanceUpdate: any = {
      [availableField]: FieldValue.increment(-amountCents),
      totalBalance: FieldValue.increment(-amountCents),
      availableBalance: FieldValue.increment(-amountCents),
      updatedAt: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    };

    transaction.update(balanceRef, balanceUpdate);

    const movementRef = db.collection('balanceMovements').doc();
    transaction.set(movementRef, {
      sellerId,
      amountCents: -amountCents,
      currency,
      balanceType: 'available',
      operation: 'subtract',
      reason,
      metadata: metadata || {},
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // 🐘 DUAL-WRITE → Neon (fire-and-forget)
  Promise.all([
    neonUpsertSellerBalance({ sellerId, delta: -amountCents, currency, balanceType: 'available', operation: 'subtract' }),
    neonWriteBalanceMovement({ sellerId, amountCents: -amountCents, currency, balanceType: 'available', operation: 'subtract', reason, metadata }),
  ]).catch(() => {});
}

/**
 * 🔄 HELPER: Mover saldo entre tipos (pending → available, available → reserved, etc.)
 */
export async function moveBalance(
  sellerId: string,
  amountCents: number,
  currency: 'BRL' | 'USD' | 'EUR',
  from: 'available' | 'pending' | 'reserved',
  to: 'available' | 'pending' | 'reserved',
  reason: string,
  metadata?: Record<string, any>
): Promise<void> {
  const db = getFirestore();

  await db.runTransaction(async (transaction) => {
    const balanceRef = db.collection('sellerBalances').doc(sellerId);
    const balanceDoc = await transaction.get(balanceRef);

    if (!balanceDoc.exists) {
      throw new Error(`Seller ${sellerId} não possui registro de balance`);
    }

    const currentBalance = balanceDoc.data();
    const fromField = `balance${capitalize(from)}_${currency}`;
    const toField = `balance${capitalize(to)}_${currency}`;
    const currentFrom = currentBalance[fromField] || 0;

    if (currentFrom < amountCents) {
      throw new Error(`Saldo ${from} insuficiente: ${currentFrom / 100} ${currency}`);
    }

    const balanceUpdate: any = {
      [fromField]: FieldValue.increment(-amountCents),
      [toField]: FieldValue.increment(amountCents),
      [`${from}Balance`]: FieldValue.increment(-amountCents),
      [`${to}Balance`]: FieldValue.increment(amountCents),
      updatedAt: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    };

    transaction.update(balanceRef, balanceUpdate);

    const movementRef = db.collection('balanceMovements').doc();
    transaction.set(movementRef, {
      sellerId,
      amountCents,
      currency,
      balanceType: `${from}->${to}`,
      operation: 'move',
      reason,
      metadata: metadata || {},
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // 🐘 DUAL-WRITE → Neon (fire-and-forget)
  Promise.all([
    neonMoveSellerBalance({ sellerId, amountCents, currency, from, to }),
    neonWriteBalanceMovement({ sellerId, amountCents, currency, balanceType: `${from}->${to}`, operation: 'move', reason, metadata }),
  ]).catch(() => {});
}

// Helper: capitalizar primeira letra
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
