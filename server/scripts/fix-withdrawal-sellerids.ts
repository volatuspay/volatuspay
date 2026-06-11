/**
 * 🔧 MIGRATION - Corrigir sellerId em withdrawals antigos
 * Executado via: tsx server/scripts/fix-withdrawal-sellerids.ts
 */
import '../lib/firebase-admin.js';
import { getFirestore, ensureFirebaseReady } from '../lib/firebase-admin.js';

async function main() {
  console.log('🔧 [MIGRATION] Iniciando correção de sellerIds...');
  
  await ensureFirebaseReady();
  const db = getFirestore();
  
  const withdrawalsSnapshot = await db.collection('withdrawals').get();
  console.log(`📊 [MIGRATION] Total de withdrawals: ${withdrawalsSnapshot.size}`);
  
  let fixed = 0;
  let alreadyOk = 0;
  let errors = 0;
  
  const batch = db.batch();
  
  for (const doc of withdrawalsSnapshot.docs) {
    const data = doc.data();
    
    if (!data.sellerId && data.tenantId) {
      console.log(`🔧 [MIGRATION] Corrigindo ${doc.id}: sellerId=${data.tenantId}`);
      batch.update(doc.ref, { sellerId: data.tenantId });
      fixed++;
    } else if (data.sellerId) {
      alreadyOk++;
    } else {
      console.warn(`⚠️ [MIGRATION] Withdrawal ${doc.id} sem sellerId nem tenantId!`);
      errors++;
    }
  }
  
  if (fixed > 0) {
    await batch.commit();
    console.log(`✅ [MIGRATION] ${fixed} withdrawals corrigidos!`);
  } else {
    console.log(`✅ [MIGRATION] Nada a corrigir!`);
  }
  
  console.log(`📊 [MIGRATION] Final: ${alreadyOk} OK, ${fixed} corrigidos, ${errors} erros`);
  process.exit(0);
}

main().catch(error => {
  console.error('❌ [MIGRATION] Erro:', error);
  process.exit(1);
});
