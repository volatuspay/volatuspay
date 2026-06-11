import { ensureFirebaseReady, getFirestore } from '../lib/firebase-admin.js';

async function cleanupWithdrawals() {
  await ensureFirebaseReady();
  const db = getFirestore();
  
  const SELLER_ID = 'VcD8JREgg3Oy0Qy0UECwfntrn0k1';
  
  // Buscar todos os saques do seller
  const snapshot = await db.collection('withdrawals')
    .where('sellerId', '==', SELLER_ID)
    .get();
  
  console.log(`📋 Total de saques encontrados: ${snapshot.size}`);
  
  // Deletar os que NÃO são R$ 2.000 ou R$ 25.000
  let deleted = 0;
  let kept = 0;
  
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const amount = data.amountCents;
    
    // Manter apenas os 2 saques corretos (200000 = R$2k, 2500000 = R$25k)
    if (amount === 200000 || amount === 2500000) {
      console.log(`✅ Mantendo: R$ ${(amount / 100).toFixed(2)} - ${data.sellerName || 'N/A'}`);
      kept++;
    } else {
      await doc.ref.delete();
      console.log(`🗑️ Removido: R$ ${(amount / 100).toFixed(2)}`);
      deleted++;
    }
  }
  
  console.log(`\n✅ Limpeza concluída: ${deleted} removidos, ${kept} mantidos`);
  process.exit(0);
}

cleanupWithdrawals().catch(e => { console.error(e); process.exit(1); });
