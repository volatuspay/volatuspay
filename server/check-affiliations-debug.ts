import { getFirestore } from './lib/firebase-admin.js';

async function checkAffiliations() {
  try {
    console.log('\n📊 Buscando TODAS as afiliações no Firestore...\n');
    
    const db = getFirestore();
    const snapshot = await db.collection('affiliations').get();
    
    if (snapshot.empty) {
      console.log('❌ NENHUMA AFILIAÇÃO ENCONTRADA no Firestore\n');
      return;
    }
    
    console.log(`✅ ${snapshot.size} afiliação(ões) encontrada(s):\n`);
    
    snapshot.docs.forEach((doc, index) => {
      const data = doc.data();
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📄 Afiliação ${index + 1}:`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Status: ${data.status}`);
      console.log(`   Produto ID: ${data.productId}`);
      console.log(`   Produto Nome: ${data.productName}`);
      console.log(`   Afiliado ID: ${data.affiliateId}`);
      console.log(`   Afiliado Nome: ${data.affiliateName}`);
      console.log(`   Afiliado Email: ${data.affiliateEmail}`);
      console.log(`   Código: ${data.affiliateCode}`);
      console.log(`   Link: ${data.affiliateLink}`);
      console.log(`   Seller ID: ${data.sellerId}`);
      console.log(`   Criado em: ${data.createdAt?.toDate?.() || data.createdAt}`);
      console.log(`   Aprovado em: ${data.approvedAt?.toDate?.() || data.approvedAt || 'N/A'}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar afiliações:', error.message);
  } finally {
    process.exit(0);
  }
}

checkAffiliations();
