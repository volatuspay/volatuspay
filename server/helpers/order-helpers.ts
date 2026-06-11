// 🔧 HELPERS COMPARTILHADOS para normalização de orders e subscriptions
import { firestoreCache } from '../lib/firestore-cache.js';

// 🔧 HELPER: Batch fetch de checkouts e produtos (COM CACHE)
export async function fetchCheckoutsAndProducts(snapshot: any, firebaseStorage: any) {
  const checkoutIds = Array.from(new Set(snapshot.docs.map((doc: any) => doc.data().checkoutId).filter(Boolean)));
  
  const checkoutsMap = await firestoreCache.getCheckoutsBatch(checkoutIds as string[]);

  const productIds = Array.from(new Set(
    snapshot.docs.flatMap((doc: any) => {
      const orderData = doc.data();
      const checkout = checkoutsMap.get(orderData.checkoutId);
      return [
        checkout?.syncedProductId,
        checkout?.productId,
        orderData.productId,
        orderData.checkoutSnapshot?.productId,
      ].filter(Boolean);
    })
  ));
  
  const productsMap = await firestoreCache.getProductsBatch(productIds as string[]);
  if (productIds.length > 0) {
    console.log(`📦 [CACHE] Batch fetch de ${productIds.length} checkouts + ${productIds.length} produtos (via cache)`);
  }

  return { checkoutsMap, productsMap };
}

// 🔧 HELPER: Normalizar order para response consistente
// CRITICAL: Todos os endpoints DEVEM usar esta função para garantir payload uniforme
export function normalizeOrderForResponse(orderData: any, checkoutData: any = null, productData: any = null) {
  // 🎯 PRODUTO = products collection (via syncedProductId ou productId)
  // Produto usa .title como campo principal (não .name)
  const productName = productData?.title || 
                      productData?.name || 
                      orderData.productName ||
                      orderData.checkoutSnapshot?.productName ||
                      'Produto';
  
  // productId via syncedProductId (campo correto nos checkouts)
  const productId = productData?.id || 
                    checkoutData?.syncedProductId || 
                    checkoutData?.productId || 
                    orderData.productId ||
                    orderData.checkoutSnapshot?.productId;
  
  // 🎯 OFERTA = checkout.title (NÃO é o nome do produto!)
  const offerName = orderData.offerName ||
                    orderData.checkoutSnapshot?.offerName ||
                    checkoutData?.title || 
                    checkoutData?.name || 
                    'Oferta';
  
  const offerId = orderData.offerId ||
                  orderData.checkoutSnapshot?.offerId ||
                  checkoutData?.id || 
                  orderData.checkoutId;
  
  const checkoutTitle = offerName; // Title = nome da oferta
  const productType = productData?.productType || checkoutData?.productType || orderData.checkoutSnapshot?.productType || orderData.productType || 'digital';
  
  // Normalizar timestamps (converter Firestore Timestamp para ISO string)
  const normalizeTimestamp = (timestamp: any) => {
    if (!timestamp) return null;
    if (timestamp._seconds) return new Date(timestamp._seconds * 1000).toISOString();
    if (timestamp.seconds) return new Date(timestamp.seconds * 1000).toISOString();
    if (timestamp instanceof Date) return timestamp.toISOString();
    if (timestamp.toDate) return timestamp.toDate().toISOString();
    return timestamp; // Já é string ISO
  };
  
  return {
    id: orderData.id,
    tenantId: orderData.tenantId,
    checkoutId: orderData.checkoutId,
    checkoutTitle,
    productType,
    customer: orderData.customer || {
      name: orderData.customerName || 'N/A',
      email: orderData.customerEmail || 'N/A',
      document: orderData.customerDocument || 'N/A',
      phone: orderData.customerPhone || 'N/A'
    },
    customerName: orderData.customerName || orderData.customer?.name || 'N/A',
    customerEmail: orderData.customerEmail || orderData.customer?.email || 'N/A',
    amount: orderData.amount || 0,
    method: orderData.method || 'pix',
    status: orderData.status || 'pending',
    createdAt: normalizeTimestamp(orderData.createdAt) || new Date().toISOString(),
    paidAt: normalizeTimestamp(orderData.paidAt),
    // CRITICAL: checkoutSnapshot necessário para filtros cascateados!
    checkoutSnapshot: orderData.checkoutSnapshot || {
      productType,
      productName,
      productId,
      title: offerName,
      offerId,
      offerName
    },
    // 🎯 CAMPOS TOP-LEVEL para facilitar filtros com dados legados
    offerId,
    offerName,
    productId,
    productName,
    // Dados adicionais preservados
    notes: orderData.notes || null,
    refundStatus: orderData.refundStatus || null,
    refundRequestedAt: normalizeTimestamp(orderData.refundRequestedAt),
    refundCompletedAt: normalizeTimestamp(orderData.refundCompletedAt),
    refundedAt: normalizeTimestamp(orderData.refundedAt),
    refundAmount: orderData.refundAmount || null,
    refundReason: orderData.refundReason || null,
    chargebackAt: normalizeTimestamp(orderData.chargebackAt),
    chargebackReason: orderData.chargebackReason || null,
    commission: orderData.commission || null,
    affiliateId: orderData.affiliateId || orderData.affiliateUid || null,
    affiliateUid: orderData.affiliateUid || orderData.affiliateId || null,
    affiliateCode: orderData.affiliateCode || null,
    affiliateName: orderData.affiliateName || null,
    affiliateEmail: orderData.affiliateEmail || null,
    affiliateCommission: typeof orderData.affiliateCommission === 'number'
      ? { amount: orderData.affiliateCommission, percentage: 0 }
      : orderData.affiliateCommission || null,
    isAffiliateSale: orderData.isAffiliateSale || false,
    sellerName: orderData.sellerName || null,
    metadata: orderData.metadata || null,
    offersData: orderData.offersData || null,
    orderItems: orderData.orderItems || null,
    // Campos financeiros completos para detalhes da venda
    gateway: orderData.gateway || null,
    txId: orderData.txId || orderData.txid || orderData.pixTxId || null,
    saleType: orderData.saleType || orderData.type || null,
    type: orderData.type || null,
    currency: orderData.currency || 'BRL',
    paymentMethod: orderData.paymentMethod || orderData.method || null,
    installments: orderData.installments || orderData.cardData?.installments || null,
    gatewayFee: orderData.gatewayFee ?? orderData.financial?.gatewayFee ?? null,
    platformFee: orderData.platformFee ?? orderData.financial?.platformFee ?? null,
    netAmount: orderData.netAmount ?? orderData.financial?.netAmount ?? null,
    sellerNetAmount: orderData.sellerNetAmount ?? null,
    feeSnapshot: orderData.feeSnapshot || orderData.financial?.feeSnapshot || null,
    financialData: orderData.financialData || null,
    financial: orderData.financial ? {
      sellerCreditAmount: orderData.financial.sellerCreditAmount ?? null,
      affiliateCommissionAmount: orderData.financial.affiliateCommissionAmount ?? null,
      balanceType: orderData.financial.balanceType || null,
      released: orderData.financial.released ?? null,
      releasedAt: normalizeTimestamp(orderData.financial.releasedAt),
      releaseDate: normalizeTimestamp(orderData.financial.releaseDate),
      releaseDays: orderData.financial.releaseDays ?? null,
      netAmount: orderData.financial.netAmount ?? null,
      gatewayFee: orderData.financial.gatewayFee ?? null,
      gatewayFeePercent: orderData.financial.gatewayFeePercent ?? null,
      platformFee: orderData.financial.platformFee ?? null,
      platformFeePercent: orderData.financial.platformFeePercent ?? null,
      currency: orderData.financial.currency || null,
      feeSnapshot: orderData.financial.feeSnapshot || null,
    } : null,
    orderBumps: orderData.orderBumps || null,
  };
}
