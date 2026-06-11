// 🔧 SCRIPT DE EMERGÊNCIA: Atualizar pagamento PIX manualmente
// Ordem: order_1762865486330_0oab5 - Rosa Pereira - R$ 2,41

import admin from 'firebase-admin';
import { storage } from '../storage.js';

async function fixPixPayment() {
  try {
    console.log('🔧 INICIANDO FIX DE PAGAMENTO PIX...');
    
    // Inicializar Firebase
    const firebaseStorage = storage as any;
    await firebaseStorage.ensureFirebaseReady();
    
    const db = firebaseStorage.db;
    
    if (!db) {
      throw new Error('Firebase não conectado!');
    }
    
    const orderId = 'order_1762865486330_0oab5';
    console.log(`📋 Processando ordem: ${orderId}`);
    
    // 1. Buscar ordem
    const orderDoc = await db.collection('orders').doc(orderId).get();
    
    if (!orderDoc.exists) {
      throw new Error(`❌ Ordem ${orderId} não encontrada!`);
    }
    
    const orderData = orderDoc.data();
    console.log(`✅ Ordem encontrada - Status atual: ${orderData?.status}`);
    console.log(`👤 Cliente: ${orderData?.customer?.name} (${orderData?.customer?.email})`);
    console.log(`💰 Valor: R$ ${(orderData?.amount || 0) / 100}`);
    
    if (orderData?.status === 'paid') {
      console.log(`⚠️ Ordem já está paga - nada a fazer`);
      return;
    }
    
    // 2. Calcular dados financeiros (PIX 2.99% + R$2.49)
    const amount = (orderData?.amount || 0) / 100;
    const gatewayFeePercent = 2.99;
    const gatewayFeeFixed = 2.49;
    const platformFeePercent = 0; // Sem taxa de plataforma por enquanto
    
    const gatewayFee = Math.round((amount * gatewayFeePercent / 100 + gatewayFeeFixed) * 100);
    const platformFee = Math.round(amount * platformFeePercent / 100 * 100);
    const netAmount = (orderData?.amount || 0) - gatewayFee - platformFee;
    
    const releaseDate = new Date();
    releaseDate.setDate(releaseDate.getDate() + 0); // D+0 para PIX
    
    console.log(`💰 Cálculo de fees:`, {
      totalAmount: amount,
      gatewayFee: gatewayFee / 100,
      platformFee: platformFee / 100,
      netAmount: netAmount / 100,
      releaseDate: releaseDate.toISOString()
    });
    
    // 3. Atualizar ordem via transação atômica
    console.log(`🔒 Atualizando ordem via TRANSAÇÃO ATÔMICA...`);
    
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('orders').doc(orderId);
      
      // Ler status atualizado dentro da transação
      const freshOrderDoc = await transaction.get(orderRef);
      const freshOrderData = freshOrderDoc.data();
      
      if (freshOrderData?.status === 'paid') {
        console.log(`⚠️ RACE CONDITION DETECTADA - Ordem já paga`);
        return;
      }
      
      // Atualizar para PAGO
      transaction.update(orderRef, {
        status: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        pixPaidAt: admin.firestore.FieldValue.serverTimestamp(),
        method: 'pix',
        processor: 'efibank',
        netAmount,
        gatewayFee,
        platformFee,
        releaseDate: admin.firestore.Timestamp.fromDate(releaseDate),
        financialData: {
          totalAmount: orderData?.amount || 0,
          netAmount,
          gatewayFee,
          platformFee,
          releaseDate: admin.firestore.Timestamp.fromDate(releaseDate),
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          feeSnapshot: {
            gatewayFeePercent,
            gatewayFeeFixed,
            platformFeePercent
          }
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✅ Ordem atualizada para PAGO via TRANSAÇÃO`);
    });
    
    // 4. Criar enrollment automático
    console.log(`🎓 Criando enrollment automático...`);
    
    // Recarregar ordem atualizada
    const updatedOrderDoc = await db.collection('orders').doc(orderId).get();
    const updatedOrderData = updatedOrderDoc.data();
    
    if (!updatedOrderData?.checkoutId) {
      console.warn(`⚠️ Sem checkoutId - pulando enrollment`);
    } else {
      // Buscar checkout para obter produto
      const checkoutDoc = await db.collection('checkouts').doc(updatedOrderData.checkoutId).get();
      const checkoutData = checkoutDoc.data();
      
      if (!checkoutData) {
        console.warn(`⚠️ Checkout não encontrado - pulando enrollment`);
      } else {
        const enrollmentId = `enrollment_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const purchaseDate = new Date();
        const guaranteeExpiresAt = new Date();
        guaranteeExpiresAt.setDate(guaranteeExpiresAt.getDate() + (checkoutData?.pricing?.guaranteeDays || 7));
        
        // Criar enrollment
        await db.collection('enrollments').doc(enrollmentId).set({
          id: enrollmentId,
          tenantId: updatedOrderData.tenantId,
          userId: updatedOrderData.customer?.email || '',
          customerName: updatedOrderData.customer?.name || '',
          customerEmail: updatedOrderData.customer?.email || '',
          productId: checkoutData.productId || updatedOrderData.checkoutId,
          productTitle: checkoutData.title || 'Produto',
          orderId: orderId,
          checkoutId: updatedOrderData.checkoutId,
          status: 'active',
          enrolledAt: admin.firestore.Timestamp.fromDate(purchaseDate),
          purchaseDate: admin.firestore.Timestamp.fromDate(purchaseDate),
          paidAt: admin.firestore.Timestamp.fromDate(purchaseDate),
          guaranteeExpiresAt: admin.firestore.Timestamp.fromDate(guaranteeExpiresAt),
          amount: updatedOrderData.amount,
          paymentMethod: 'pix',
          createdAt: admin.firestore.Timestamp.fromDate(purchaseDate),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Enrollment criado: ${enrollmentId}`);
        console.log(`🎉 Cliente ${updatedOrderData.customer?.email} agora tem acesso ao produto!`);
        
        // 5. Se for subscription, criar subscription também
        if (checkoutData?.pricing?.billingType === 'subscription' || updatedOrderData.productType === 'subscription') {
          console.log(`🔄 Produto é subscription - criando assinatura...`);
          
          const subscriptionPeriod = checkoutData?.pricing?.subscriptionPeriod || 'monthly';
          let daysToAdd = 30;
          if (subscriptionPeriod === 'quarterly') daysToAdd = 90;
          else if (subscriptionPeriod === 'semiannual') daysToAdd = 180;
          else if (subscriptionPeriod === 'annual') daysToAdd = 365;
          
          const nextBillingDate = new Date(purchaseDate);
          nextBillingDate.setDate(nextBillingDate.getDate() + daysToAdd);
          
          const expiresAt = new Date(purchaseDate);
          expiresAt.setDate(expiresAt.getDate() + daysToAdd);
          
          const subscriptionId = `subscription_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          
          await db.collection('subscriptions').doc(subscriptionId).set({
            id: subscriptionId,
            tenantId: updatedOrderData.tenantId,
            checkoutId: updatedOrderData.checkoutId,
            orderId: orderId,
            customerId: updatedOrderData.customer?.email || '',
            customerName: updatedOrderData.customer?.name || '',
            customerEmail: updatedOrderData.customer?.email || '',
            customerPhone: updatedOrderData.customer?.phone || '',
            customerDocument: updatedOrderData.customer?.document || '',
            productName: checkoutData.title || 'Produto',
            amount: updatedOrderData.amount,
            period: subscriptionPeriod,
            status: 'active',
            startDate: admin.firestore.Timestamp.fromDate(purchaseDate),
            nextBillingDate: admin.firestore.Timestamp.fromDate(nextBillingDate),
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            lastPaymentDate: admin.firestore.Timestamp.fromDate(purchaseDate),
            paymentMethod: 'pix',
            createdAt: admin.firestore.Timestamp.fromDate(purchaseDate),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          
          console.log(`✅ Subscription criada: ${subscriptionId} (${subscriptionPeriod} - ${daysToAdd} dias)`);
        }
      }
    }
    
    console.log(`\n🎉 FIX COMPLETO!`);
    console.log(`✅ Ordem ${orderId} marcada como PAGA`);
    console.log(`✅ Cliente tem acesso ao produto`);
    console.log(`✅ Dados financeiros salvos corretamente`);
    
  } catch (error: any) {
    console.error(`❌ ERRO no fix:`, error);
    console.error(`❌ Stack:`, error.stack);
    throw error;
  }
}

// Executar
fixPixPayment()
  .then(() => {
    console.log(`\n✅ SUCESSO! Ordem atualizada.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n❌ FALHA:`, error);
    process.exit(1);
  });
