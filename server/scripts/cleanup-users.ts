/**
 * 🧹 SCRIPT DE LIMPEZA - Manter apenas 2 usuários
 * Executar: npx tsx server/scripts/cleanup-users.ts
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// UIDs a MANTER
const KEEP_UIDS = [
  'bNqPZO5H3Gb2pXeINe047SuFsUA2', // luanr10lisboa@gmail.com
  // UID antigo removido
];

async function initFirebase() {
  if (admin.apps && admin.apps.length > 0) return;
  
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT não configurado');
  }
  
  let credentials;
  try {
    credentials = JSON.parse(serviceAccount);
  } catch {
    credentials = JSON.parse(Buffer.from(serviceAccount, 'base64').toString('utf8'));
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(credentials)
  });
  
  console.log('✅ Firebase inicializado');
}

async function cleanupAllData() {
  await initFirebase();
  
  const db = admin.firestore();
  const stats: Record<string, { deleted: number; kept: number }> = {};
  
  const addStat = (name: string) => {
    if (!stats[name]) stats[name] = { deleted: 0, kept: 0 };
    return stats[name];
  };
  
  console.log('🧹 Iniciando limpeza...');
  console.log('📌 UIDs a manter:', KEEP_UIDS);
  
  // 1. Collections onde UID = doc ID
  const uidDocCollections = ['sellers', 'tenants', 'seller-2fa-sessions', 'seller-2fa-preferences', 'sellerBalances'];
  
  for (const collName of uidDocCollections) {
    const stat = addStat(collName);
    try {
      const snapshot = await db.collection(collName).get();
      for (const doc of snapshot.docs) {
        if (KEEP_UIDS.includes(doc.id)) {
          stat.kept++;
        } else {
          await doc.ref.delete();
          stat.deleted++;
          console.log(`  ❌ ${collName}/${doc.id}`);
        }
      }
    } catch (e: any) {
      console.error(`  ⚠️ Erro em ${collName}:`, e.message);
    }
  }
  
  // 2. Collections com tenantId/sellerId
  const tenantCollections = [
    { name: 'checkouts', field: 'tenantId' },
    { name: 'products', field: 'tenantId' },
    { name: 'productOffers', field: 'tenantId' },
    { name: 'orders', field: 'tenantId' },
    { name: 'subscriptions', field: 'tenantId' },
    { name: 'customers', field: 'tenantId' },
    { name: 'withdrawals', field: 'sellerId' },
    { name: 'refunds', field: 'tenantId' },
    { name: 'support_tickets', field: 'sellerId' },
    { name: 'enrollments', field: 'tenantId' },
    { name: 'members', field: 'tenantId' },
    { name: 'modules', field: 'tenantId' },
    { name: 'lessons', field: 'tenantId' },
    { name: 'balanceTransactions', field: 'sellerId' },
    { name: 'apiKeys', field: 'sellerId' }
  ];
  
  for (const { name, field } of tenantCollections) {
    const stat = addStat(name);
    try {
      const snapshot = await db.collection(name).get();
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const ownerId = data[field] || data.tenantId || data.sellerId || data.userId;
        
        if (ownerId && KEEP_UIDS.includes(ownerId)) {
          stat.kept++;
        } else {
          await doc.ref.delete();
          stat.deleted++;
        }
      }
      if (stat.deleted > 0) console.log(`  📦 ${name}: ${stat.deleted} deletados`);
    } catch (e: any) {
      // Collection pode não existir
    }
  }
  
  // 3. Affiliations
  const affStat = addStat('affiliations');
  try {
    const snapshot = await db.collection('affiliations').get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const affiliateId = data.affiliateId || data.userId;
      const sellerId = data.sellerId;
      
      if ((affiliateId && KEEP_UIDS.includes(affiliateId)) || 
          (sellerId && KEEP_UIDS.includes(sellerId))) {
        affStat.kept++;
      } else {
        await doc.ref.delete();
        affStat.deleted++;
      }
    }
  } catch (e: any) {}
  
  // 4. Affiliate collections
  const affCollections = [
    { name: 'affiliateBalances', field: 'userId' },
    { name: 'affiliateCommissions', field: 'affiliateId' },
    { name: 'affiliateClicks', field: 'affiliateId' },
    { name: 'affiliates', field: 'sellerId' }
  ];
  
  for (const { name, field } of affCollections) {
    const stat = addStat(name);
    try {
      const snapshot = await db.collection(name).get();
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const ownerId = data[field] || data.sellerId || data.userId;
        
        if (ownerId && KEEP_UIDS.includes(ownerId)) {
          stat.kept++;
        } else {
          await doc.ref.delete();
          stat.deleted++;
        }
      }
    } catch (e: any) {}
  }
  
  // 5. idempotencyLocks
  const lockStat = addStat('idempotencyLocks');
  try {
    const snapshot = await db.collection('idempotencyLocks').get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const tenantId = data.tenantId;
      
      if (tenantId && KEEP_UIDS.includes(tenantId)) {
        lockStat.kept++;
      } else {
        await doc.ref.delete();
        lockStat.deleted++;
      }
    }
  } catch (e: any) {}
  
  // Resumo
  console.log('\n📊 RESUMO:');
  let totalDeleted = 0;
  let totalKept = 0;
  
  for (const [name, s] of Object.entries(stats)) {
    if (s.deleted > 0 || s.kept > 0) {
      console.log(`  ${name}: ${s.deleted} deletados, ${s.kept} mantidos`);
      totalDeleted += s.deleted;
      totalKept += s.kept;
    }
  }
  
  console.log('\n✅ LIMPEZA CONCLUÍDA!');
  console.log(`   Total deletado: ${totalDeleted}`);
  console.log(`   Total mantido: ${totalKept}`);
  
  process.exit(0);
}

cleanupAllData().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
