import { getFirestore } from './firebase-admin.js';
import { saveDataToBunny } from './bunny-data-storage.js';
import { firestoreCache, withFirestoreTimeout } from './firestore-cache.js';

const UTMIFY_API_URL = 'https://api.utmify.com.br/api-credentials/orders';
const PLATFORM_NAME = 'VolatusPay';

interface UTMifyCustomer {
  name: string;
  email: string;
  phone: string | null;
  document: string | null;
  country?: string;
  ip?: string;
}

interface UTMifyProduct {
  id: string;
  name: string;
  planId: string | null;
  planName: string | null;
  quantity: number;
  priceInCents: number;
}

interface UTMifyTrackingParams {
  src: string | null;
  sck: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

interface UTMifyCommission {
  totalPriceInCents: number;
  gatewayFeeInCents: number;
  userCommissionInCents: number;
  currency?: 'BRL' | 'USD' | 'EUR' | 'GBP' | 'ARS' | 'CAD';
}

interface UTMifyOrderPayload {
  orderId: string;
  platform: string;
  paymentMethod: 'credit_card' | 'boleto' | 'pix' | 'paypal' | 'free_price';
  status: 'waiting_payment' | 'paid' | 'refused' | 'refunded' | 'chargedback';
  createdAt: string;
  approvedDate: string | null;
  refundedAt: string | null;
  customer: UTMifyCustomer;
  products: UTMifyProduct[];
  trackingParameters: UTMifyTrackingParams;
  commission: UTMifyCommission;
  isTest?: boolean;
}

function formatDateUTC(date: Date | string | null): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

function mapPaymentMethod(method: string): UTMifyOrderPayload['paymentMethod'] {
  switch (method?.toLowerCase()) {
    case 'pix': return 'pix';
    case 'card':
    case 'credit_card':
    case 'credit-card':
    case 'credit':
    case 'cartao':
    case 'cartão':
    case 'efibank_card':
    case 'card_efibank':
      return 'credit_card';
    case 'boleto':
    case 'billet':
      return 'boleto';
    case 'free':
    case 'free_price':
      return 'free_price';
    default: return 'pix';
  }
}

function mapStatus(status: string): UTMifyOrderPayload['status'] {
  switch (status?.toLowerCase()) {
    case 'pending':
    case 'waiting_payment':
      return 'waiting_payment';
    case 'paid':
    case 'completed':
      return 'paid';
    case 'refused':
    case 'failed':
      return 'refused';
    case 'refunded':
      return 'refunded';
    case 'chargedback':
    case 'chargeback':
      return 'chargedback';
    default:
      return 'waiting_payment';
  }
}

export async function getUTMifyConfig(tenantId: string): Promise<{ enabled: boolean; apiToken: string; configured: boolean } | null> {
  try {
    const db = getFirestore();
    if (!db) return null;

    // Try cache first
    const cacheKey = `utmify_${tenantId}`;
    const cached = firestoreCache.getApiKeyFromCache(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const doc = await withFirestoreTimeout(db.collection('integrations').doc(`utmify_${tenantId}`).get());
    if (!doc.exists) {
      // Cache negative result
      firestoreCache.setApiKeyCache(cacheKey, null);
      return null;
    }

    const data = doc.data();
    if (!data?.apiToken) {
      firestoreCache.setApiKeyCache(cacheKey, null);
      return null;
    }

    const result = { enabled: !!data.enabled, apiToken: data.apiToken, configured: true };
    firestoreCache.setApiKeyCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`[UTMify] Erro ao buscar config para tenant ${tenantId}:`, error);
    return null;
  }
}

export async function saveUTMifyConfig(tenantId: string, apiToken: string, enabled: boolean): Promise<void> {
  const db = getFirestore();
  if (!db) throw new Error('Firestore não disponível');

  await db.collection('integrations').doc(`utmify_${tenantId}`).set({
    tenantId,
    apiToken,
    enabled,
    updatedAt: new Date()
  }, { merge: true });

  firestoreCache.invalidateApiKey(`utmify_${tenantId}`);

  console.log(`[UTMify] Config salva para tenant ${tenantId} (enabled: ${enabled})`);
}

export async function sendOrderToUTMify(orderData: {
  orderId: string;
  tenantId: string;
  method: string;
  status: string;
  amount: number;
  currency?: string;
  customer: { name: string; email: string; phone?: string; document?: string };
  checkoutTitle?: string;
  productId?: string;
  offerTitle?: string;
  createdAt: Date | string;
  paidAt?: Date | string | null;
  refundedAt?: Date | string | null;
  trackingParameters?: Partial<UTMifyTrackingParams>;
  gatewayFee?: number;
  platformFee?: number;
  netAmount?: number;
}): Promise<boolean> {
  try {
    const config = await getUTMifyConfig(orderData.tenantId);
    if (!config || !config.enabled) {
      return false;
    }

    const totalFees = (orderData.gatewayFee || 0) + (orderData.platformFee || 0);

    const payload: UTMifyOrderPayload = {
      orderId: orderData.orderId,
      platform: PLATFORM_NAME,
      paymentMethod: mapPaymentMethod(orderData.method),
      status: mapStatus(orderData.status),
      createdAt: formatDateUTC(orderData.createdAt) || formatDateUTC(new Date())!,
      approvedDate: formatDateUTC(orderData.paidAt || null),
      refundedAt: formatDateUTC(orderData.refundedAt || null),
      customer: {
        name: orderData.customer.name || 'N/A',
        email: orderData.customer.email || 'N/A',
        phone: orderData.customer.phone || null,
        document: orderData.customer.document || null,
      },
      products: [{
        id: orderData.productId || orderData.orderId,
        name: orderData.checkoutTitle || orderData.offerTitle || 'Produto',
        planId: null,
        planName: orderData.offerTitle || null,
        quantity: 1,
        priceInCents: orderData.amount
      }],
      trackingParameters: {
        src: orderData.trackingParameters?.src || null,
        sck: orderData.trackingParameters?.sck || null,
        utm_source: orderData.trackingParameters?.utm_source || null,
        utm_campaign: orderData.trackingParameters?.utm_campaign || null,
        utm_medium: orderData.trackingParameters?.utm_medium || null,
        utm_content: orderData.trackingParameters?.utm_content || null,
        utm_term: orderData.trackingParameters?.utm_term || null,
      },
      commission: {
        totalPriceInCents: orderData.amount,
        gatewayFeeInCents: totalFees,
        userCommissionInCents: orderData.netAmount || (orderData.amount - totalFees),
        currency: (orderData.currency as any) || 'BRL'
      }
    };

    console.log(`[UTMify] Enviando order ${orderData.orderId} (status: ${payload.status}) para UTMify...`);

    const response = await fetch(UTMIFY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': config.apiToken
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log(`[UTMify] Order ${orderData.orderId} enviada com sucesso!`);

      const utmifyLogId = `utm_${orderData.orderId}_${Date.now()}`;
      const fullUtmifyLog = {
        tenantId: orderData.tenantId,
        orderId: orderData.orderId,
        status: payload.status,
        success: true,
        sentAt: new Date(),
        payload
      };

      saveDataToBunny('logs/utmify', utmifyLogId, fullUtmifyLog)
        .then(r => r.success && console.log(`☁️ UTMify log ${utmifyLogId} salvo no Bunny`))
        .catch(err => console.error('⚠️ Bunny UTMify log error:', err));

      const db = getFirestore();
      if (db) {
        await db.collection('utmifyLogs').doc(utmifyLogId).set({
          tenantId: orderData.tenantId,
          orderId: orderData.orderId,
          status: payload.status,
          success: true,
          sentAt: new Date()
        });
      }
      return true;
    } else {
      const errorBody = await response.text().catch(() => 'N/A');
      console.error(`[UTMify] Erro ao enviar order ${orderData.orderId}: ${response.status} - ${errorBody}`);

      const errorLogId = `utm_err_${orderData.orderId}_${Date.now()}`;
      const fullErrorLog = {
        tenantId: orderData.tenantId,
        orderId: orderData.orderId,
        status: payload.status,
        success: false,
        error: `${response.status}: ${errorBody}`,
        sentAt: new Date(),
        payload
      };

      saveDataToBunny('logs/utmify', errorLogId, fullErrorLog)
        .then(r => r.success && console.log(`☁️ UTMify error log ${errorLogId} salvo no Bunny`))
        .catch(err => console.error('⚠️ Bunny UTMify error log error:', err));

      const db = getFirestore();
      if (db) {
        await db.collection('utmifyLogs').doc(errorLogId).set({
          tenantId: orderData.tenantId,
          orderId: orderData.orderId,
          status: payload.status,
          success: false,
          sentAt: new Date()
        });
      }
      return false;
    }
  } catch (error: any) {
    console.error(`[UTMify] Erro fatal ao enviar order:`, error.message);
    return false;
  }
}

export async function sendOrderStatusUpdate(tenantId: string, orderId: string, newStatus: string, extraData?: {
  paidAt?: Date | string;
  refundedAt?: Date | string;
}): Promise<boolean> {
  try {
    const config = await getUTMifyConfig(tenantId);
    if (!config) return false;

    const db = getFirestore();
    if (!db) return false;

    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      console.warn(`[UTMify] Order ${orderId} não encontrada para update`);
      return false;
    }

    const order = orderDoc.data()!;

    return await sendOrderToUTMify({
      orderId: order.id || orderId,
      tenantId,
      method: order.method || order.paymentMethod,
      status: newStatus,
      amount: order.amount,
      currency: order.currency,
      customer: order.customer,
      checkoutTitle: order.checkoutSnapshot?.title || order.checkoutTitle,
      productId: order.productId,
      offerTitle: order.offerTitle,
      createdAt: order.createdAt?.toDate ? order.createdAt.toDate() : order.createdAt,
      paidAt: extraData?.paidAt || (order.paidAt?.toDate ? order.paidAt.toDate() : order.paidAt),
      refundedAt: extraData?.refundedAt || (order.refundedAt?.toDate ? order.refundedAt.toDate() : order.refundedAt),
      trackingParameters: order.trackingParameters,
      gatewayFee: order.gatewayFee,
      platformFee: order.platformFee,
      netAmount: order.netAmount
    });
  } catch (error: any) {
    console.error(`[UTMify] Erro ao enviar status update:`, error.message);
    return false;
  }
}
