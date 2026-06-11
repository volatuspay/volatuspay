/**
 * 🔄 SCRIPT: Sincronizar Sellers com Firebase Auth
 * Remove sellers do Firestore que não existem mais no Firebase Auth
 * 
 * USO: npx tsx server/scripts/sync-sellers.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Inicializar Firebase Admin
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccount) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT não configurado');
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({
    credential: cert(JSON.parse(serviceAccount))
  });
}

const db = getFirestore();
const auth = getAuth();

async function syncSellersWithAuth() {
  console.log('🔄 [SYNC] Iniciando sincronização de sellers com Firebase Auth...\n');
  
  const sellersSnapshot = await db.collection('sellers').get();
  console.log(`📊 Total de sellers no Firestore: ${sellersSnapshot.size}\n`);
  
  const stats = {
    total: sellersSnapshot.size,
    valid: 0,
    removed: 0,
    removedEmails: [] as string[],
    errors: [] as string[]
  };
  
  for (const sellerDoc of sellersSnapshot.docs) {
    const sellerId = sellerDoc.id;
    const sellerData = sellerDoc.data();
    const sellerEmail = sellerData.email || 'N/A';
    
    try {
      // Tentar buscar usuário no Firebase Auth
      await auth.getUser(sellerId);
      stats.valid++;
      console.log(`✅ Válido: ${sellerEmail}`);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        console.log(`🗑️ ÓRFÃO - Removendo: ${sellerEmail} (${sellerId})`);
        
        try {
          // Checkouts
          const checkoutsSnapshot = await db.collection('checkouts').where('tenantId', '==', sellerId).get();
          for (const doc of checkoutsSnapshot.docs) { await doc.ref.delete(); }
          if (checkoutsSnapshot.size > 0) console.log(`   └─ ${checkoutsSnapshot.size} checkouts deletados`);
          
          // Products
          const productsSnapshot = await db.collection('products').where('tenantId', '==', sellerId).get();
          for (const doc of productsSnapshot.docs) { await doc.ref.delete(); }
          if (productsSnapshot.size > 0) console.log(`   └─ ${productsSnapshot.size} products deletados`);
          
          // ProductOffers
          const offersSnapshot = await db.collection('productOffers').where('tenantId', '==', sellerId).get();
          for (const doc of offersSnapshot.docs) { await doc.ref.delete(); }
          if (offersSnapshot.size > 0) console.log(`   └─ ${offersSnapshot.size} offers deletadas`);
          
          // Orders
          const ordersSnapshot = await db.collection('orders').where('sellerId', '==', sellerId).get();
          for (const doc of ordersSnapshot.docs) { await doc.ref.delete(); }
          if (ordersSnapshot.size > 0) console.log(`   └─ ${ordersSnapshot.size} orders deletadas`);
          
          // SellerBalances
          await db.collection('sellerBalances').doc(sellerId).delete().catch(() => {});
          
          // Affiliates
          const affiliatesSnapshot = await db.collection('affiliates').where('sellerId', '==', sellerId).get();
          for (const doc of affiliatesSnapshot.docs) { await doc.ref.delete(); }
          
          // Finalmente o seller
          await sellerDoc.ref.delete();
          
          stats.removed++;
          stats.removedEmails.push(sellerEmail);
          console.log(`   ✅ Seller e dados relacionados removidos\n`);
        } catch (deleteError: any) {
          stats.errors.push(`Erro ao deletar ${sellerEmail}: ${deleteError.message}`);
          console.error(`   ❌ Erro: ${deleteError.message}\n`);
        }
      } else {
        stats.errors.push(`Erro ao verificar ${sellerEmail}: ${error.message}`);
        console.error(`❌ Erro ao verificar ${sellerEmail}: ${error.message}`);
      }
    }
  }
  
  console.log('\n═══════════════════════════════════════════');
  console.log('🔄 SINCRONIZAÇÃO CONCLUÍDA!');
  console.log('═══════════════════════════════════════════');
  console.log(`   Total no Firestore: ${stats.total}`);
  console.log(`   ✅ Válidos: ${stats.valid}`);
  console.log(`   ❌ Removidos: ${stats.removed}`);
  
  if (stats.removedEmails.length > 0) {
    console.log('\n📧 Sellers removidos:');
    stats.removedEmails.forEach(email => console.log(`   - ${email}`));
  }
  
  if (stats.errors.length > 0) {
    console.log('\n⚠️ Erros:');
    stats.errors.forEach(err => console.log(`   - ${err}`));
  }
  
  // Audit log
  await db.collection('adminAuditLogs').add({
    action: 'sync_sellers_with_auth_script',
    performedBy: 'system',
    timestamp: new Date().toISOString(),
    statistics: stats,
    severity: 'HIGH'
  });
  
  console.log('\n✅ Log de auditoria salvo');
}

syncSellersWithAuth()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
  });
