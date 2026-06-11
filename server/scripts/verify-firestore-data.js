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
  console.log(`📊 Projeto Firebase: ${serviceAccount.project_id}`);
}

const db = admin.firestore();

async function verifyData() {
  try {
    // Buscar 3 vendas
    const ordersSnapshot = await db.collection('orders')
      .where('tenantId', '==', 'DMe5uLhhK0YswLlZwvDFm1gPw2l1')
      .limit(3)
      .get();
    
    console.log(`\n📦 ${ordersSnapshot.size} vendas encontradas\n`);
    
    let comSnapshot = 0;
    let semSnapshot = 0;
    
    ordersSnapshot.forEach((doc) => {
      const order = doc.data();
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`ID: ${doc.id}`);
      console.log(`Cliente: ${order.customer?.name}`);
      console.log(`CheckoutId: ${order.checkoutId}`);
      console.log(`TenantId: ${order.tenantId}`);
      
      if (order.checkoutSnapshot && order.checkoutSnapshot.title) {
        console.log(`✅ checkoutSnapshot.title: "${order.checkoutSnapshot.title}"`);
        console.log(`   ProductType: ${order.checkoutSnapshot.productType}`);
        comSnapshot++;
      } else {
        console.log(`❌ checkoutSnapshot NÃO EXISTE ou VAZIO`);
        semSnapshot++;
      }
    });
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`📊 RESUMO:`);
    console.log(`   ✅ COM checkoutSnapshot: ${comSnapshot}`);
    console.log(`   ❌ SEM checkoutSnapshot: ${semSnapshot}\n`);
    
    if (semSnapshot > 0) {
      console.log(`⚠️  PROBLEMA: Vendas ainda SEM checkoutSnapshot no Firestore!`);
      console.log(`   O script fix-demo-timestamps.ts pode não estar commitando corretamente.\n`);
    } else {
      console.log(`✅ SUCESSO: Todas as vendas têm checkoutSnapshot!`);
      console.log(`   O problema pode ser no frontend (cache React Query).\n`);
    }
    
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    process.exit(0);
  }
}

verifyData();
