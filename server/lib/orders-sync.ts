import { getRTDB } from './firebase-admin.js';
import { saveOrderToBunny, updateOrderInBunny } from './bunny-orders-storage.js';

const RTDB_ORDERS_PATH = 'orders-by-tenant';

function serializeDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (val instanceof Date) return val.toISOString();
  if (val?.toDate) return val.toDate().toISOString();
  if (val?._seconds) return new Date(val._seconds * 1000).toISOString();
  return null;
}

function buildOrderIndex(orderData: any): Record<string, any> {
  return {
    status: orderData.status || 'pending',
    amount: orderData.amount || 0,
    method: orderData.method || 'pix',
    gateway: orderData.gateway || 'efibank',
    customerEmail: orderData.customerEmail || orderData.customer?.email || '',
    customerName: orderData.customerName || orderData.customer?.name || '',
    productName: orderData.productName || orderData.checkoutSnapshot?.productName || '',
    checkoutId: orderData.checkoutId || '',
    tenantId: orderData.tenantId || '',
    sellerEmail: orderData.sellerEmail || orderData.checkoutSnapshot?.sellerEmail || null,
    createdAt: serializeDate(orderData.createdAt) || new Date().toISOString(),
    paidAt: serializeDate(orderData.paidAt),
    updatedAt: serializeDate(orderData.updatedAt) || new Date().toISOString(),
    netAmount: orderData.netAmount ?? orderData.sellerNetAmount ?? null,
    affiliateId: orderData.affiliateId || orderData.affiliateUid || null,
    affiliateUid: orderData.affiliateUid || orderData.affiliateId || null,
    affiliateCode: orderData.affiliateCode || null,
    affiliateName: orderData.affiliateName || null,
    affiliateEmail: orderData.affiliateEmail || null,
    affiliateCommission: typeof orderData.affiliateCommission === 'number'
      ? { amount: orderData.affiliateCommission, percentage: 0 }
      : orderData.affiliateCommission || null,
    isAffiliateSale: orderData.isAffiliateSale || false,
    withdrawalDays: orderData.withdrawalDays ?? null,
    currency: orderData.currency || 'BRL'
  };
}

async function saveOrderIndexToRTDB(tenantId: string, orderId: string, indexData: Record<string, any>): Promise<boolean> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) {
      console.warn('⚠️ [ORDERS-SYNC] RTDB não disponível');
      return false;
    }

    const cleanData: Record<string, any> = {};
    for (const [key, value] of Object.entries(indexData)) {
      if (value !== undefined) {
        cleanData[key] = value;
      }
    }

    await rtdb.ref(`${RTDB_ORDERS_PATH}/${tenantId}/${orderId}`).set(cleanData);
    return true;
  } catch (error: any) {
    console.error(`❌ [ORDERS-SYNC] Erro ao salvar index RTDB ${orderId}:`, error.message);
    return false;
  }
}

async function updateOrderIndexInRTDB(tenantId: string, orderId: string, updateFields: Record<string, any>): Promise<boolean> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) return false;

    const cleanFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (value !== undefined) {
        cleanFields[key] = value;
      }
    }
    cleanFields.updatedAt = new Date().toISOString();

    await rtdb.ref(`${RTDB_ORDERS_PATH}/${tenantId}/${orderId}`).update(cleanFields);
    return true;
  } catch (error: any) {
    console.error(`❌ [ORDERS-SYNC] Erro ao atualizar index RTDB ${orderId}:`, error.message);
    return false;
  }
}

export function syncOrderAfterCreate(tenantId: string, orderId: string, orderData: any): void {
  const indexData = buildOrderIndex(orderData);

  Promise.allSettled([
    saveOrderToBunny(tenantId, orderId, orderData).then(r => {
      if (r.success) {
        console.log(`📦 [ORDERS-SYNC] Ordem ${orderId} salva no Bunny CDN`);
      } else {
        console.warn(`⚠️ [ORDERS-SYNC] Falha ao salvar ${orderId} no Bunny: ${r.error}`);
      }
    }),
    saveOrderIndexToRTDB(tenantId, orderId, indexData).then(ok => {
      if (ok) {
        console.log(`📋 [ORDERS-SYNC] Index ${orderId} salvo no RTDB`);
      }
    })
  ]).catch(err => {
    console.error(`❌ [ORDERS-SYNC] Erro na sincronização pós-criação:`, err);
  });
}

export function syncOrderAfterUpdate(tenantId: string, orderId: string, updateFields: Record<string, any>, fullOrderData?: any): void {
  const rtdbFields: Record<string, any> = {};

  if (updateFields.status !== undefined) rtdbFields.status = updateFields.status;
  if (updateFields.paidAt !== undefined) rtdbFields.paidAt = serializeDate(updateFields.paidAt);
  if (updateFields.amount !== undefined) rtdbFields.amount = updateFields.amount;
  if (updateFields.netAmount !== undefined) rtdbFields.netAmount = updateFields.netAmount;
  if (updateFields.sellerNetAmount !== undefined) rtdbFields.netAmount = updateFields.sellerNetAmount;
  if (updateFields.method !== undefined) rtdbFields.method = updateFields.method;
  if (updateFields.gateway !== undefined) rtdbFields.gateway = updateFields.gateway;
  if (updateFields.withdrawalDays !== undefined) rtdbFields.withdrawalDays = updateFields.withdrawalDays;
  if (updateFields.affiliateId !== undefined) rtdbFields.affiliateId = updateFields.affiliateId;
  if (updateFields.affiliateUid !== undefined) rtdbFields.affiliateUid = updateFields.affiliateUid;
  if (updateFields.affiliateCode !== undefined) rtdbFields.affiliateCode = updateFields.affiliateCode;
  if (updateFields.affiliateName !== undefined) rtdbFields.affiliateName = updateFields.affiliateName;
  if (updateFields.affiliateEmail !== undefined) rtdbFields.affiliateEmail = updateFields.affiliateEmail;
  if (updateFields.affiliateCommission !== undefined) rtdbFields.affiliateCommission = updateFields.affiliateCommission;
  if (updateFields.isAffiliateSale !== undefined) rtdbFields.isAffiliateSale = updateFields.isAffiliateSale;
  if (updateFields.customer !== undefined) {
    if (updateFields.customer?.email) rtdbFields.customerEmail = updateFields.customer.email;
    if (updateFields.customer?.name) rtdbFields.customerName = updateFields.customer.name;
  }

  Promise.allSettled([
    fullOrderData
      ? saveOrderToBunny(tenantId, orderId, { ...fullOrderData, ...updateFields }).then(r => {
          if (r.success) console.log(`📦 [ORDERS-SYNC] Ordem ${orderId} atualizada no Bunny`);
          else console.warn(`⚠️ [ORDERS-SYNC] Falha ao atualizar ${orderId} no Bunny: ${r.error}`);
        })
      : updateOrderInBunny(tenantId, orderId, updateFields).then(r => {
          if (r.success) console.log(`📦 [ORDERS-SYNC] Ordem ${orderId} patch no Bunny`);
          else console.warn(`⚠️ [ORDERS-SYNC] Falha no patch ${orderId} no Bunny: ${r.error}`);
        }),
    Object.keys(rtdbFields).length > 0
      ? updateOrderIndexInRTDB(tenantId, orderId, rtdbFields).then(ok => {
          if (ok) console.log(`📋 [ORDERS-SYNC] Index ${orderId} atualizado no RTDB`);
        })
      : Promise.resolve()
  ]).catch(err => {
    console.error(`❌ [ORDERS-SYNC] Erro na sincronização pós-update:`, err);
  });
}

export async function getOrdersIndexFromRTDB(tenantId: string): Promise<Record<string, any> | null> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) return null;

    const snapshot = await rtdb.ref(`${RTDB_ORDERS_PATH}/${tenantId}`).once('value');
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error(`❌ [ORDERS-SYNC] Erro ao carregar index RTDB para tenant ${tenantId}:`, error.message);
    return null;
  }
}

export async function getOrderIndexFromRTDB(tenantId: string, orderId: string): Promise<any | null> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) return null;

    const snapshot = await rtdb.ref(`${RTDB_ORDERS_PATH}/${tenantId}/${orderId}`).once('value');
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    return null;
  }
}

export async function backfillOrdersToRTDB(db: any, tenantId: string, batchSize: number = 100): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;
  
  try {
    const rtdb = getRTDB();
    if (!rtdb) return { synced: 0, errors: 1 };
    
    let query = db.collection('orders').where('tenantId', '==', tenantId).orderBy('createdAt', 'desc');
    let lastDoc: any = null;
    let hasMore = true;
    
    while (hasMore) {
      let batch = query.limit(batchSize);
      if (lastDoc) batch = batch.startAfter(lastDoc);
      
      const snapshot = await batch.get();
      if (snapshot.empty) {
        hasMore = false;
        break;
      }
      
      const updates: Record<string, any> = {};
      
      for (const doc of snapshot.docs) {
        try {
          const data = doc.data();
          updates[`${RTDB_ORDERS_PATH}/${tenantId}/${doc.id}`] = buildOrderIndex(data);
          synced++;
        } catch (e) {
          errors++;
        }
      }
      
      if (Object.keys(updates).length > 0) {
        await rtdb.ref().update(updates);
      }
      
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      hasMore = snapshot.docs.length === batchSize;
    }
    
    console.log(`✅ [BACKFILL] Tenant ${tenantId}: ${synced} orders sincronizadas, ${errors} erros`);
  } catch (error: any) {
    console.error(`❌ [BACKFILL] Erro ao backfill tenant ${tenantId}:`, error.message);
    errors++;
  }
  
  return { synced, errors };
}

export async function getAllOrdersIndexFromRTDB(): Promise<Record<string, Record<string, any>> | null> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) return null;

    const snapshot = await rtdb.ref(RTDB_ORDERS_PATH).once('value');
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error(`❌ [ORDERS-SYNC] Erro ao carregar ALL index RTDB:`, error.message);
    return null;
  }
}
