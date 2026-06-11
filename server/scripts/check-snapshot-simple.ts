const admin = require('firebase-admin');

// Inicializar Firebase
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON não configurado!');
  process.exit(1);
}

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(serviceAccountJson);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase inicializado');
}

const db = admin.firestore();

async function checkSnapshots() {
  try {
    // Buscar 3 vendas
    const ordersSnapshot = await db.collection('orders')
      .where('tenantId', '==', 'DMe5uLhhK0YswLlZwvDFm1gPw2l1')
      .limit(3)
      .get();
    
    console.log(`\n📦 ${ordersSnapshot.size} vendas encontradas\n`);
    
    ordersSnapshot.forEach((doc) => {
      const order = doc.data();
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`ID: ${doc.id}`);
      console.log(`Cliente: ${order.customer?.name}`);
      console.log(`CheckoutId: ${order.checkoutId}`);
      console.log(`ProductName: ${order.productName || 'N/A'}`);
      
      if (order.checkoutSnapshot) {
        console.log(`✅ checkoutSnapshot EXISTE!`);
        console.log(`   Title: ${order.checkoutSnapshot.title}`);
        console.log(`   ProductType: ${order.checkoutSnapshot.productType}`);
      } else {
        console.log(`❌ checkoutSnapshot NÃO EXISTE`);
      }
    });
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    process.exit(0);
  }
}

checkSnapshots();
