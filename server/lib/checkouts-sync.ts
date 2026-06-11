import { getRTDB } from './firebase-admin.js';

const RTDB_CHECKOUTS_PATH = 'checkouts-by-tenant';

function serializeDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (val instanceof Date) return val.toISOString();
  if (val?.toDate) return val.toDate().toISOString();
  if (val?._seconds) return new Date(val._seconds * 1000).toISOString();
  return null;
}

function buildCheckoutIndex(checkoutData: any): Record<string, any> {
  return {
    name: checkoutData.name || checkoutData.productName || '',
    slug: checkoutData.slug || '',
    productType: checkoutData.productType || 'digital',
    price: checkoutData.price || 0,
    currency: checkoutData.currency || 'BRL',
    status: checkoutData.status || 'active',
    active: checkoutData.active !== false,
    deleted: checkoutData.deleted === true,
    syncedProductId: checkoutData.syncedProductId || null,
    productId: checkoutData.productId || null,
    salesCount: checkoutData.salesCount || 0,
    tenantId: checkoutData.tenantId || '',
    createdAt: serializeDate(checkoutData.createdAt) || new Date().toISOString(),
    updatedAt: serializeDate(checkoutData.updatedAt) || new Date().toISOString(),
    paymentMethods: checkoutData.paymentMethods || ['pix'],
    affiliateEnabled: checkoutData.affiliateEnabled || false,
    logoUrl: checkoutData.logoUrl || null,
  };
}

async function saveCheckoutIndexToRTDB(tenantId: string, checkoutId: string, indexData: Record<string, any>): Promise<boolean> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) {
      console.warn('⚠️ [CHECKOUTS-SYNC] RTDB não disponível');
      return false;
    }

    const cleanData: Record<string, any> = {};
    for (const [key, value] of Object.entries(indexData)) {
      if (value !== undefined) {
        cleanData[key] = value;
      }
    }

    await rtdb.ref(`${RTDB_CHECKOUTS_PATH}/${tenantId}/${checkoutId}`).set(cleanData);
    return true;
  } catch (error: any) {
    console.error(`❌ [CHECKOUTS-SYNC] Erro ao salvar index RTDB ${checkoutId}:`, error.message);
    return false;
  }
}

async function updateCheckoutIndexInRTDB(tenantId: string, checkoutId: string, updateFields: Record<string, any>): Promise<boolean> {
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

    await rtdb.ref(`${RTDB_CHECKOUTS_PATH}/${tenantId}/${checkoutId}`).update(cleanFields);
    return true;
  } catch (error: any) {
    console.error(`❌ [CHECKOUTS-SYNC] Erro ao atualizar index RTDB ${checkoutId}:`, error.message);
    return false;
  }
}

export function syncCheckoutAfterCreate(tenantId: string, checkoutId: string, checkoutData: any): void {
  const indexData = buildCheckoutIndex(checkoutData);
  saveCheckoutIndexToRTDB(tenantId, checkoutId, indexData).then(ok => {
    if (ok) console.log(`📋 [CHECKOUTS-SYNC] Index ${checkoutId} salvo no RTDB`);
  }).catch(err => {
    console.error(`❌ [CHECKOUTS-SYNC] Erro na sincronização pós-criação:`, err);
  });
}

export function syncCheckoutAfterUpdate(tenantId: string, checkoutId: string, updateFields: Record<string, any>): void {
  const rtdbFields: Record<string, any> = {};

  if (updateFields.name !== undefined) rtdbFields.name = updateFields.name;
  if (updateFields.productName !== undefined) rtdbFields.name = updateFields.productName;
  if (updateFields.slug !== undefined) rtdbFields.slug = updateFields.slug;
  if (updateFields.price !== undefined) rtdbFields.price = updateFields.price;
  if (updateFields.currency !== undefined) rtdbFields.currency = updateFields.currency;
  if (updateFields.status !== undefined) rtdbFields.status = updateFields.status;
  if (updateFields.active !== undefined) rtdbFields.active = updateFields.active;
  if (updateFields.deleted !== undefined) rtdbFields.deleted = updateFields.deleted;
  if (updateFields.deletedAt !== undefined) rtdbFields.deletedAt = serializeDate(updateFields.deletedAt);
  if (updateFields.salesCount !== undefined) rtdbFields.salesCount = updateFields.salesCount;
  if (updateFields.paymentMethods !== undefined) rtdbFields.paymentMethods = updateFields.paymentMethods;
  if (updateFields.affiliateEnabled !== undefined) rtdbFields.affiliateEnabled = updateFields.affiliateEnabled;
  if (updateFields.logoUrl !== undefined) rtdbFields.logoUrl = updateFields.logoUrl;
  if (updateFields.syncedProductId !== undefined) rtdbFields.syncedProductId = updateFields.syncedProductId;
  if (updateFields.productId !== undefined) rtdbFields.productId = updateFields.productId;
  if (updateFields.productType !== undefined) rtdbFields.productType = updateFields.productType;

  if (Object.keys(rtdbFields).length > 0) {
    updateCheckoutIndexInRTDB(tenantId, checkoutId, rtdbFields).then(ok => {
      if (ok) console.log(`📋 [CHECKOUTS-SYNC] Index ${checkoutId} atualizado no RTDB`);
    }).catch(err => {
      console.error(`❌ [CHECKOUTS-SYNC] Erro na sincronização pós-update:`, err);
    });
  }
}

export async function syncCheckoutAfterDelete(tenantId: string, checkoutId: string): Promise<void> {
  updateCheckoutIndexInRTDB(tenantId, checkoutId, { deleted: true, deletedAt: new Date().toISOString(), active: false }).catch(err => {
    console.error(`❌ [CHECKOUTS-SYNC] Erro ao marcar checkout deletado no RTDB:`, err);
  });
}

export async function getCheckoutsIndexFromRTDB(tenantId: string): Promise<Record<string, any> | null> {
  try {
    const rtdb = getRTDB();
    if (!rtdb) return null;

    const snapshot = await rtdb.ref(`${RTDB_CHECKOUTS_PATH}/${tenantId}`).once('value');
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error(`❌ [CHECKOUTS-SYNC] Erro ao carregar index RTDB para tenant ${tenantId}:`, error.message);
    return null;
  }
}

const PARALLEL_CONCURRENCY = 50;

export async function backfillCheckoutsToRTDB(db: any, tenantId?: string, batchSize: number = 200): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  try {
    const rtdb = getRTDB();
    if (!rtdb) return { synced: 0, errors: 1 };

    let query = db.collection('checkouts').orderBy('createdAt', 'desc');
    if (tenantId) {
      query = query.where('tenantId', '==', tenantId);
    }

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
          const tid = data.tenantId || tenantId;
          if (tid) {
            updates[`${RTDB_CHECKOUTS_PATH}/${tid}/${doc.id}`] = buildCheckoutIndex(data);
            synced++;
          }
        } catch (e) {
          errors++;
        }
      }

      if (Object.keys(updates).length > 0) {
        const keys = Object.keys(updates);
        for (let i = 0; i < keys.length; i += PARALLEL_CONCURRENCY) {
          const chunk = keys.slice(i, i + PARALLEL_CONCURRENCY);
          const chunkUpdates: Record<string, any> = {};
          chunk.forEach(k => { chunkUpdates[k] = updates[k]; });
          await rtdb.ref().update(chunkUpdates);
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < batchSize) {
        hasMore = false;
      }
    }

    console.log(`✅ [CHECKOUTS-SYNC] Backfill completo: ${synced} checkouts sincronizados, ${errors} erros`);
  } catch (error: any) {
    console.error('❌ [CHECKOUTS-SYNC] Erro no backfill:', error.message);
    errors++;
  }

  return { synced, errors };
}
