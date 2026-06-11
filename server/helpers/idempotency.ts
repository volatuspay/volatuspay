import { getFirestore } from '../lib/firebase-admin.js';
import { generateUniqueOrderId } from '../performance-config.js';
import { syncOrderAfterCreate } from '../lib/orders-sync.js';

/**
 * 🔒 IDEMPOTENCY HELPER - Previne criação de orders duplicadas
 * 
 * Usa Firestore Transactions para garantir atomicidade:
 * - Se idempotencyKey já existe → retorna order existente (não cria nova)
 * - Se não existe → cria lock + order atomicamente
 * 
 * @param idempotencyKey - UUID v4 gerado pelo cliente (ou fallback do backend)
 * @param tenantId - ID do seller/tenant
 * @param orderData - Dados da order a ser criada
 * @returns { orderId: string, isNew: boolean }
 */
export async function getOrCreateOrderWithIdempotency(
  idempotencyKey: string,
  tenantId: string,
  orderData: any
): Promise<{ orderId: string; isNew: boolean }> {
  
  // 🔑 Chave composta: <tenantId>:<idempotencyKey>
  const lockId = `${tenantId}:${idempotencyKey}`;
  
  console.log(`🔒 [IDEMPOTENCY] Checking lock: ${lockId}`);
  console.log(`📦 [IDEMPOTENCY] OrderData keys: ${Object.keys(orderData).join(', ')}`);
  console.log(`📦 [IDEMPOTENCY] TenantId: ${tenantId}, Amount: ${orderData.amount}, Status: ${orderData.status}`);
  
  // 🔥 FIRESTORE TRANSACTION - Garante atomicidade
  const db = getFirestore();
  
  if (!db) {
    console.error(`❌ [IDEMPOTENCY] CRITICAL: Firestore not available!`);
    throw new Error('Firestore não disponível para criar order');
  }
  
  console.log(`🔥 [IDEMPOTENCY] Starting Firestore transaction...`);
  
  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
    const lockRef = db.collection('idempotencyLocks').doc(lockId);
    const lockDoc = await transaction.get(lockRef);
    
    // ✅ CASO 1: Lock já existe → validar e retornar/recriar order
    if (lockDoc.exists) {
      const lockData = lockDoc.data();
      const existingOrderId = lockData?.orderId;
      
      console.log(`♻️ [IDEMPOTENCY] Lock found! Validating order: ${existingOrderId}`);
      
      // 🛡️ VALIDAÇÃO CRÍTICA: Verificar se a order ainda existe
      const orderRef = db.collection('orders').doc(existingOrderId);
      const orderDoc = await transaction.get(orderRef);
      
      if (orderDoc.exists) {
        const existingOrderData = orderDoc.data();
        const orderStatus = existingOrderData?.status;
        
        // 🚨 CASO ESPECIAL: Se ordem FALHOU, EXPIROU ou JÁ ESTÁ PAGA → criar NOVA ordem!
        // Ordens já pagas NÃO devem ser reutilizadas - cliente quer fazer NOVA compra!
        if (orderStatus === 'failed' || orderStatus === 'expired' || orderStatus === 'paid') {
          console.log(`🔄 [IDEMPOTENCY] Order ${existingOrderId} has terminal status (${orderStatus}), creating NEW order...`);
          
          // Gerar NOVO orderId
          const newOrderId = generateUniqueOrderId();
          const now = new Date();
          
          // Gerar NOVA idempotency key para esta nova compra
          const newIdempotencyKey = `${idempotencyKey}-${Date.now()}`;
          const newLockId = `${tenantId}:${newIdempotencyKey}`;
          
          // Criar NOVA order
          const newOrderRef = db.collection('orders').doc(newOrderId);
          transaction.set(newOrderRef, {
            ...orderData,
            id: newOrderId,
            idempotencyKey: newIdempotencyKey,
            createdAt: now,
            updatedAt: now
          });
          
          // Criar NOVO lock (não atualizar o antigo para preservar histórico)
          const newLockRef = db.collection('idempotencyLocks').doc(newLockId);
          transaction.set(newLockRef, {
            id: newLockId,
            tenantId,
            idempotencyKey: newIdempotencyKey,
            orderId: newOrderId,
            previousOrderId: existingOrderId,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
          });
          
          console.log(`✅ [IDEMPOTENCY] NEW order created after terminal status: ${newOrderId} (previous: ${existingOrderId})`);
          
          return {
            orderId: newOrderId,
            isNew: true
          };
        }
        
        // ✅ Order existe e está PENDENTE - retornar normalmente (retry do mesmo pagamento)
        console.log(`✅ [IDEMPOTENCY] Order validated (status=${orderStatus}), returning existing PENDING: ${existingOrderId}`);
        return {
          orderId: existingOrderId,
          isNew: false
        };
      }
      
      // ⚠️ CASO EDGE: Order foi deletada mas lock existe - RECRIAR order
      console.warn(`⚠️ [IDEMPOTENCY] Stale lock detected! Order ${existingOrderId} missing, recreating...`);
      
      const now = new Date();
      
      // Recriar order com o MESMO ID (manter consistência com lock)
      transaction.set(orderRef, {
        ...orderData,
        id: existingOrderId,
        idempotencyKey,
        createdAt: now,
        updatedAt: now
      });
      
      console.log(`✅ [IDEMPOTENCY] Order recreated with same ID: ${existingOrderId}`);
      
      return {
        orderId: existingOrderId,
        isNew: true // TRUE = precisa criar session de pagamento!
      };
    }
    
    // 🆕 CASO 2: Lock não existe → criar atomicamente
    const orderId = generateUniqueOrderId(); // Usar gerador canônico (order_*)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h TTL
    
    // Criar order
    const orderRef = db.collection('orders').doc(orderId);
    transaction.set(orderRef, {
      ...orderData,
      id: orderId,
      idempotencyKey, // Salvar key na order também
      createdAt: now,
      updatedAt: now
    });
    
    // Criar lock
    transaction.set(lockRef, {
      id: lockId,
      tenantId,
      idempotencyKey,
      orderId,
      createdAt: now,
      expiresAt
    });
    
    console.log(`✅ [IDEMPOTENCY] New order created atomically: ${orderId}`);
    
    return {
      orderId,
      isNew: true
    };
    });
    
    console.log(`✅ [IDEMPOTENCY] Transaction committed successfully! OrderId: ${result.orderId}, isNew: ${result.isNew}`);
    
    if (result.isNew) {
      syncOrderAfterCreate(tenantId, result.orderId, {
        ...orderData,
        id: result.orderId,
        idempotencyKey,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
  } catch (error: any) {
    console.error(`❌ [IDEMPOTENCY] TRANSACTION FAILED:`, error.message);
    console.error(`❌ [IDEMPOTENCY] Stack:`, error.stack);
    throw error; // Re-throw para que o chamador saiba que falhou
  }
  
  return result;
}

/**
 * 🔑 Gera idempotency key fallback para clientes legacy
 * Baseado em campos da request para garantir determinismo
 */
export function generateIdempotencyKeyFallback(
  checkoutId: string,
  amount: number,
  customerId: string,
  timestamp: number
): string {
  // ✅ DETERMINÍSTICO: Sem timestamp! Usa APENAS dados da request
  // Retries com mesmos dados = mesma key = mesma order
  const rawKey = `${checkoutId}-${amount}-${customerId}`;
  
  // Usar hash simples (não criptográfico, só para dedupe)
  const hash = Buffer.from(rawKey).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  
  console.log(`⚠️ [IDEMPOTENCY] Generated deterministic fallback key: ${hash.substring(0, 16)}`);
  
  return `fallback-${hash.substring(0, 32)}`;
}
