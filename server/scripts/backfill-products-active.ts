// 🔧 BACKFILL SCRIPT - Adicionar active: true em produtos sem esse campo
// Uso: tsx server/scripts/backfill-products-active.ts

import dotenv from 'dotenv';
dotenv.config();

import { getAdmin, ensureFirebaseReady } from '../lib/firebase-admin.js';

async function backfillActiveField() {
  console.log('🔧 BACKFILL: Iniciando...');
  console.log('🔥 Conectando ao Firebase...');
  
  try {
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    console.log('✅ Firebase conectado!');
    console.log('🔍 Buscando produtos sem campo active...\n');
    
    const productsSnapshot = await db.collection('products').get();
    console.log(`📦 Total de produtos encontrados: ${productsSnapshot.docs.length}`);
    
    // Filtrar produtos sem active
    const productsToUpdate: any[] = [];
    let alreadyHasActive = 0;
    
    for (const doc of productsSnapshot.docs) {
      const data = doc.data();
      
      if (data.active === undefined || data.active === null) {
        productsToUpdate.push({
          id: doc.id,
          title: data.title || 'Sem título',
          tenantId: data.tenantId || 'N/A'
        });
      } else {
        alreadyHasActive++;
      }
    }
    
    console.log(`\n📊 RESUMO DA ANÁLISE:`);
    console.log(`   ✅ Produtos com active: ${alreadyHasActive}`);
    console.log(`   ⚠️  Produtos SEM active: ${productsToUpdate.length}`);
    console.log(`   📦 Total: ${productsSnapshot.docs.length}\n`);
    
    if (productsToUpdate.length === 0) {
      console.log('✅ NADA A FAZER - Todos os produtos já têm o campo active!');
      process.exit(0);
    }
    
    console.log('🔄 Atualizando produtos em lote...\n');
    
    // Atualizar em batches de 500 (limite do Firestore)
    const batchSize = 500;
    let updated = 0;
    
    for (let i = 0; i < productsToUpdate.length; i += batchSize) {
      const batch = db.batch();
      const chunk = productsToUpdate.slice(i, i + batchSize);
      
      console.log(`📝 Processando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(productsToUpdate.length / batchSize)} (${chunk.length} produtos)`);
      
      for (const product of chunk) {
        const ref = db.collection('products').doc(product.id);
        batch.update(ref, {
          active: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
          backfillReason: 'Added missing active field - 2025-11-13'
        });
        
        console.log(`   ✏️  ${product.id.substring(0, 20)}... - "${product.title}"`);
      }
      
      await batch.commit();
      updated += chunk.length;
      console.log(`   ✅ Lote ${Math.floor(i / batchSize) + 1} commit realizado!\n`);
    }
    
    console.log('\n🎉 =====================================================');
    console.log('🎉 BACKFILL CONCLUÍDO COM SUCESSO!');
    console.log('🎉 =====================================================');
    console.log(`✅ Produtos atualizados: ${updated}`);
    console.log(`✅ Produtos que já tinham active: ${alreadyHasActive}`);
    console.log(`📦 Total de produtos: ${productsSnapshot.docs.length}`);
    console.log('\n🚀 TODOS OS PRODUTOS AGORA DEVEM APARECER NO DASHBOARD!\n');
    
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ ERRO DURANTE BACKFILL:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

backfillActiveField();
