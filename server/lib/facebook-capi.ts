import admin from 'firebase-admin';
import { firestoreCache } from './firestore-cache.js';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface CAPIEventData {
  eventName: string;
  eventSourceUrl?: string;
  userData?: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    clientIpAddress?: string;
    clientUserAgent?: string;
    externalId?: string;
    fbp?: string;
    fbc?: string;
  };
  customData?: {
    value?: number;
    currency?: string;
    contentName?: string;
    contentCategory?: string;
    contentIds?: string[];
    contentType?: string;
    orderId?: string;
    numItems?: number;
  };
}

async function hashData(data: string): Promise<string> {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
}

async function buildUserData(userData: CAPIEventData['userData']) {
  if (!userData) return {};
  
  const result: Record<string, any> = {};
  
  if (userData.email) result.em = [await hashData(userData.email)];
  if (userData.phone) result.ph = [await hashData(userData.phone)];
  if (userData.firstName) result.fn = [await hashData(userData.firstName)];
  if (userData.lastName) result.ln = [await hashData(userData.lastName)];
  if (userData.clientIpAddress) result.client_ip_address = userData.clientIpAddress;
  if (userData.clientUserAgent) result.client_user_agent = userData.clientUserAgent;
  if (userData.externalId) result.external_id = [await hashData(userData.externalId)];
  if (userData.fbp) result.fbp = userData.fbp;
  if (userData.fbc) result.fbc = userData.fbc;
  
  return result;
}

export async function sendFacebookCAPIEvent(
  pixelId: string,
  accessToken: string,
  eventData: CAPIEventData
): Promise<boolean> {
  try {
    const userDataHashed = await buildUserData(eventData.userData);
    
    const payload: Record<string, any> = {
      event_name: eventData.eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: userDataHashed,
    };
    
    if (eventData.customData?.orderId) {
      payload.event_id = eventData.customData.orderId;
    }
    
    if (eventData.eventSourceUrl) {
      payload.event_source_url = eventData.eventSourceUrl;
    }
    
    if (eventData.customData) {
      const cd: Record<string, any> = {};
      if (eventData.customData.value !== undefined) cd.value = eventData.customData.value;
      if (eventData.customData.currency) cd.currency = eventData.customData.currency;
      if (eventData.customData.contentName) cd.content_name = eventData.customData.contentName;
      if (eventData.customData.contentCategory) cd.content_category = eventData.customData.contentCategory;
      if (eventData.customData.contentIds) cd.content_ids = eventData.customData.contentIds;
      if (eventData.customData.contentType) cd.content_type = eventData.customData.contentType;
      if (eventData.customData.orderId) cd.order_id = eventData.customData.orderId;
      if (eventData.customData.numItems !== undefined) cd.num_items = eventData.customData.numItems;
      payload.custom_data = cd;
    }
    
    const body = JSON.stringify({
      data: [payload],
      access_token: accessToken,
    });
    
    const response = await fetch(`${GRAPH_API_BASE}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    
    const result = await response.json() as any;
    
    if (result.events_received > 0) {
      console.log(`📊 [CAPI] Facebook evento "${eventData.eventName}" enviado com sucesso para pixel ${pixelId}`);
      return true;
    } else {
      console.warn(`⚠️ [CAPI] Facebook retornou 0 eventos recebidos:`, result);
      return false;
    }
  } catch (error) {
    console.error(`❌ [CAPI] Erro ao enviar evento Facebook:`, error);
    return false;
  }
}

export async function dispatchPurchaseEventToPixels(
  checkoutId: string,
  orderData: {
    id: string;
    tenantId?: string;
    customerEmail?: string;
    customerName?: string;
    customerPhone?: string;
    amount: number;
    currency?: string;
    productName?: string;
    method?: string;
    checkoutSlug?: string;
  }
): Promise<void> {
  try {
    const db = admin.firestore();
    
    // Try to get pixels from cache first
    let pixels: any[] | undefined = firestoreCache.getPixelsFromCache(`checkout_${checkoutId}`);
    
    if (pixels === undefined) {
      // Cache miss - fetch from Firestore
      const pixelsSnapshot = await db
        .collection('checkouts')
        .doc(checkoutId)
        .collection('pixels')
        .where('enabled', '==', true)
        .get();
      
      pixels = pixelsSnapshot.empty ? [] : pixelsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      firestoreCache.setPixelsCache(`checkout_${checkoutId}`, pixels);
    }
    
    if (pixels.length === 0) {
      const checkoutData = await firestoreCache.getCheckout(checkoutId);
      const productId = checkoutData?.syncedProductId;
      
      if (productId) {
        // Try to get product pixels from cache first
        pixels = firestoreCache.getPixelsFromCache(`product_${productId}`);
        
        if (pixels === undefined) {
          // Cache miss - fetch from Firestore
          const pixelsSnapshot = await db
            .collection('products')
            .doc(productId)
            .collection('pixels')
            .where('enabled', '==', true)
            .get();
          
          pixels = pixelsSnapshot.empty ? [] : pixelsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          firestoreCache.setPixelsCache(`product_${productId}`, pixels);
        }
      }
    }
    
    // If still no pixels, return early
    if (!pixels || pixels.length === 0) {
      return;
    }
    
    for (const pixel of pixels) {
      if (pixel.platform !== 'facebook') continue;
      if (!pixel.pixelId || !pixel.access_token) continue;
      
      const events = pixel.events || {};
      if (events.purchase === false) continue;
      
      const nameParts = (orderData.customerName || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      const amountInReais = orderData.amount / 100;
      
      await sendFacebookCAPIEvent(pixel.pixelId, pixel.access_token, {
        eventName: 'Purchase',
        eventSourceUrl: orderData.checkoutSlug 
          ? `https://volatuspay.com/c/${orderData.checkoutSlug}`
          : undefined,
        userData: {
          email: orderData.customerEmail,
          phone: orderData.customerPhone,
          firstName,
          lastName,
          externalId: orderData.id,
        },
        customData: {
          value: amountInReais,
          currency: orderData.currency || 'BRL',
          contentName: orderData.productName,
          contentType: 'product',
          orderId: orderData.id,
          numItems: 1,
        },
      });
    }
  } catch (error) {
    console.error('❌ [CAPI] Erro ao disparar eventos de compra:', error);
  }
}
