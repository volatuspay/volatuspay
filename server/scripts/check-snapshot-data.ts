import admin from 'firebase-admin';
import '../lib/firebase-init.js';

const db = admin.firestore();

async function checkSnapshots() {
  try {
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
      console.log(`   checkoutSnapshot:`, order.checkoutSnapshot ? JSON.stringify(order.checkoutSnapshot) : '❌ NÃO EXISTE');
    });
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    process.exit(0);
  }
}

checkSnapshots();
