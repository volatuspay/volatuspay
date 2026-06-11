import admin from 'firebase-admin';
import { getFirestore, ensureFirebaseReady } from '../lib/firebase-admin';

const sellerId = 'DMe5uLhhK0YswLlZwvDFm1gPw2l1';

async function fixFuturePaidAt() {
  console.log(`🔧 Corrigindo APENAS vendas com paidAt futuro...`);
  
  await ensureFirebaseReady();
  const db = getFirestore();
  console.log(`\n✅ Seller: ${sellerId}\n`);
  
  const ordersSnapshot = await db.collection('orders')
    .where('tenantId', '==', sellerId)
    .get();
  
  console.log(`📦 ${ordersSnapshot.size} vendas encontradas\n`);
  
  const agora = new Date();
  let batch = db.batch();
  let batchCount = 0;
  let corrigidas = 0;
  
  for (const doc of ordersSnapshot.docs) {
    const order = doc.data();
    
    // APENAS processar vendas PAGAS com paidAt
    if (order.status !== 'paid' || !order.paidAt) {
      continue;
    }
    
    // Converter paidAt para Date
    let paidAtDate: Date;
    if (typeof order.paidAt === 'object' && (order.paidAt as any).seconds) {
      paidAtDate = new Date((order.paidAt as any).seconds * 1000);
    } else {
      paidAtDate = new Date(order.paidAt);
    }
    
    // Se paidAt é FUTURO, corrigir!
    if (paidAtDate.getTime() > agora.getTime()) {
      const novoPaidAt = new Date(agora.getTime() - (5 * 60 * 1000)); // agora - 5 min
      
      console.log(`   🔧 CORRIGINDO paidAt futuro:`);
      console.log(`      Order: ${order.id}`);
      console.log(`      Antes: ${paidAtDate.toISOString()}`);
      console.log(`      Depois: ${novoPaidAt.toISOString()}\n`);
      
      batch.update(doc.ref, {
        paidAt: admin.firestore.Timestamp.fromDate(novoPaidAt)
      });
      
      batchCount++;
      corrigidas++;
      
      if (batchCount >= 500) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
  }
  
  // Commit final
  if (batchCount > 0) {
    await batch.commit();
  }
  
  console.log(`\n🎉 CONCLUÍDO!`);
  console.log(`   ✅ ${corrigidas} vendas corrigidas (paidAt futuro → agora - 5min)`);
  console.log(`   📊 ${ordersSnapshot.size - corrigidas} vendas já estavam corretas\n`);
}

fixFuturePaidAt()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Erro:', error);
    process.exit(1);
  });
