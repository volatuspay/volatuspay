import admin from 'firebase-admin';
import { initializeFirebaseAdmin } from '../lib/firebase-singleton.js';

async function checkSnapshots() {
  try {
    // Inicializar Firebase
    await initializeFirebaseAdmin();
    const db = admin.firestore();
    
    // Buscar 5 vendas para verificar checkoutSnapshot
    const ordersSnapshot = await db.collection('orders')
      .where('tenantId', '==', 'DMe5uLhhK0YswLlZwvDFm1gPw2l1')
      .limit(5)
      .get();
    
    console.log(`\n✅ ${ordersSnapshot.size} vendas encontradas\n`);
    
    ordersSnapshot.forEach((doc) => {
      const order = doc.data();
      console.log(`\n📦 Venda: ${doc.id}`);
      console.log(`   Cliente: ${order.customer?.name}`);
      console.log(`   CheckoutId: ${order.checkoutId}`);
      console.log(`   ProductName: ${order.productName || 'N/A'}`);
      
      if (order.checkoutSnapshot) {
        console.log(`   ✅ checkoutSnapshot.title: ${order.checkoutSnapshot.title}`);
        console.log(`   checkoutSnapshot.productType: ${order.checkoutSnapshot.productType}`);
      } else {
        console.log(`   ❌ checkoutSnapshot: NÃO EXISTE`);
      }
    });
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    process.exit(0);
  }
}

checkSnapshots();
