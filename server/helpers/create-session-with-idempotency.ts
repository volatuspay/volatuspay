import { getOrCreateOrderWithIdempotency, generateIdempotencyKeyFallback } from './idempotency.js';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * 🔒 WRAPPER: Cria/retorna order com proteção de idempotência
 * 
 * Encapsula toda a lógica de idempotência para não poluir o create-session
 * 
 * @returns { orderId, isNew, existingSession } - isNew=false significa retry com session existente
 */
export async function createOrderWithIdempotency(params: {
  db: Firestore;
  req: any;
  checkoutId: string;
  amount: number;
  customer: any;
  tenantId: string;
  orderData: any;
  method: 'pix' | 'card';
}) {
  const { db, req, checkoutId, amount, customer, tenantId, orderData, method } = params;
  
  // 🔑 EXTRAIR OU GERAR IDEMPOTENCY KEY
  const idempotencyKey = req.body.idempotencyKey || 
    generateIdempotencyKeyFallback(
      checkoutId, 
      amount, 
      customer.email || customer.document, 
      Date.now()
    );
  
  console.log(`🔑 [IDEMPOTENCY] Using key: ${idempotencyKey.substring(0, 32)}...`);
  
  // 🔒 CRIAR ORDER ATOMICAMENTE (ou retornar existente)
  const { orderId, isNew } = await getOrCreateOrderWithIdempotency(
    idempotencyKey,
    tenantId,
    orderData
  );
  
  // ✅ ORDEM NOVA → continuar normalmente
  if (isNew) {
    console.log(`✅ [IDEMPOTENCY] New order created: ${orderId}`);
    return { orderId, isNew: true, existingSession: null };
  }
  
  // ♻️ RETRY DETECTADO → buscar session existente
  console.log(`♻️ [IDEMPOTENCY] Retry detected! Checking existing session for order: ${orderId}`);
  
  const existingOrderDoc = await db.collection('orders').doc(orderId).get();
  
  if (!existingOrderDoc.exists) {
    console.warn(`⚠️ [IDEMPOTENCY] Order ${orderId} not found, will create new session`);
    return { orderId, isNew: false, existingSession: null };
  }
  
  const existingOrder = existingOrderDoc.data()!;
  
  // 🚨 VERIFICAR SE ORDEM FALHOU - NÃO RETORNAR SESSION DE ORDEM COM FALHA
  if (existingOrder.status === 'failed' || existingOrder.status === 'expired') {
    console.log(`🔄 [IDEMPOTENCY] Order ${orderId} has failed/expired status (${existingOrder.status}), must create new session`);
    return { orderId, isNew: true, existingSession: null }; // isNew=true força nova session
  }
  
  // 🔍 VERIFICAR SE JÁ TEM SESSION DE PAGAMENTO
  if (method === 'pix' && existingOrder.efiTxid && existingOrder.qrCodeResponse) {
    console.log(`✅ [IDEMPOTENCY] Returning existing PIX session`);
    
    const qrCodeResponse = existingOrder.qrCodeResponse;
    const qrImage = qrCodeResponse?.imagemQrcode || 
                   qrCodeResponse?.image || 
                   qrCodeResponse?.qr_code_image ||
                   qrCodeResponse?.imageQrcode;
    
    return {
      orderId,
      isNew: false,
      existingSession: {
        success: true,
        orderId: orderId,
        txid: existingOrder.efiTxid,
        qrcode: {
          text: qrCodeResponse?.qrcode,
          image: qrImage || null
        },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        amount: existingOrder.amount,
        method: 'pix'
      }
    };
  }
  
  if (method === 'card' && existingOrder.stripePaymentIntentId) {
    console.log(`✅ [IDEMPOTENCY] Checking existing Stripe session`);
    
    try {
      const stripe = (await import('stripe')).default;
      const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY!);
      const paymentIntent = await stripeClient.paymentIntents.retrieve(existingOrder.stripePaymentIntentId);
      
      return {
        orderId,
        isNew: false,
        existingSession: {
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          processor: 'stripe'
        }
      };
    } catch (err) {
      console.error(`⚠️ [IDEMPOTENCY] Stripe session not found:`, err);
    }
  }
  
  // 🔄 Session não encontrada ou inválida → criar nova
  console.log(`⚠️ [IDEMPOTENCY] No valid session found, will create new`);
  return { orderId, isNew: false, existingSession: null };
}
