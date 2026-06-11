import { ensureFirebaseReady, getFirestore } from '../lib/firebase-admin.js';
import { Timestamp } from 'firebase-admin/firestore';

async function resetWithdrawals() {
  await ensureFirebaseReady();
  const db = getFirestore();
  
  const SELLER_ID = 'VcD8JREgg3Oy0Qy0UECwfntrn0k1';
  const SELLER_EMAIL = 'zenpagamentosbr@gmail.com';
  
  try {
    // Tentar listar documentos (usa menos quota que .get())
    const refs = await db.collection('withdrawals').listDocuments();
    console.log(`📋 Referências encontradas: ${refs.length}`);
    
    // Deletar todos em batch
    const batch = db.batch();
    for (const ref of refs) {
      batch.delete(ref);
    }
    await batch.commit();
    console.log(`🗑️ Todos os ${refs.length} saques removidos`);
  } catch (e: any) {
    console.log('⚠️ Não conseguiu listar - tentando criar direto');
  }
  
  // Agora criar só os 2 corretos
  const today = new Date();
  
  const date1 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 12, 0);
  const doc1 = db.collection('withdrawals').doc();
  await doc1.set({
    id: doc1.id,
    sellerId: SELLER_ID,
    sellerEmail: SELLER_EMAIL,
    sellerName: 'Samuel da Silva Batista',
    amountCents: 200000,
    currency: 'BRL',
    status: 'pending',
    pixKey: '15996875001',
    pixKeyType: 'phone',
    requestedAt: Timestamp.fromDate(date1),
    createdAt: Timestamp.fromDate(date1),
  });
  console.log('✅ Saque 1: R$ 2.000 às 8:12');
  
  const date2 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 24, 0);
  const doc2 = db.collection('withdrawals').doc();
  await doc2.set({
    id: doc2.id,
    sellerId: SELLER_ID,
    sellerEmail: SELLER_EMAIL,
    sellerName: 'Samuel da Silva Batista',
    amountCents: 2500000,
    currency: 'BRL',
    status: 'pending',
    pixKey: '15996875001',
    pixKeyType: 'phone',
    requestedAt: Timestamp.fromDate(date2),
    createdAt: Timestamp.fromDate(date2),
  });
  console.log('✅ Saque 2: R$ 25.000 às 13:24');
  
  console.log('\n✅ Pronto! 2 saques criados.');
  process.exit(0);
}

resetWithdrawals().catch(e => { console.error(e); process.exit(1); });
