import { ensureFirebaseReady, getAdmin, getFirestore } from './firebase-admin.js';

const BASE_URL = process.env.VITE_PLATFORM_DOMAIN ? `https://${process.env.VITE_PLATFORM_DOMAIN}` : '';
const LOGO_URL = `${BASE_URL}/logos/volatus-pay-logo.png`;

interface OrderData {
  id?: string;
  customer?: { name?: string; email?: string };
  customerName?: string;
  customerEmail?: string;
  productName?: string;
  checkoutTitle?: string;
  productTitle?: string;
  amount?: number;
  currency?: string;
  method?: string;
  affiliateId?: string;
  affiliateCommission?: number;
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendToTokens(
  admin: any,
  db: any,
  sellerId: string,
  title: string,
  body: string,
  orderId: string,
  extraData: Record<string, string> = {}
): Promise<void> {
  const sellerDoc = await db.collection('sellers').doc(sellerId).get();
  if (!sellerDoc.exists) {
    console.log(`[PUSH] Seller ${sellerId} not found - skipping`);
    return;
  }

  const sellerData = sellerDoc.data();
  const pushTokens: string[] = sellerData?.pushTokens || [];

  if (pushTokens.length === 0) {
    console.log(`[PUSH] Seller ${sellerId} has no push tokens`);
    return;
  }

  const message: any = {
    tokens: pushTokens,
    notification: { title, body },
    webpush: {
      notification: {
        icon: LOGO_URL,
        badge: `${BASE_URL}/favicon.png`,
        tag: orderId || `sale-${Date.now()}`,
        requireInteraction: true,
        vibrate: [200, 100, 200],
        actions: [{ action: 'open', title: 'Ver Detalhes' }],
      },
      fcmOptions: {
        link: `${BASE_URL}/dashboard/sales`,
      },
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'sales',
        priority: 'max',
        sound: 'default',
        defaultVibrateTimings: true,
        defaultSound: true,
        notificationCount: 1,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          contentAvailable: true,
        },
      },
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
    },
    data: {
      orderId,
      click_action: `${BASE_URL}/dashboard/sales`,
      ...extraData,
    },
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  console.log(`[PUSH] Sent to ${sellerId}: ${response.successCount} ok, ${response.failureCount} fail`);

  if (response.failureCount > 0) {
    const invalidTokens: string[] = [];
    response.responses.forEach((resp: any, idx: number) => {
      if (!resp.success) {
        const code = resp.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(pushTokens[idx]);
        }
      }
    });
    if (invalidTokens.length > 0) {
      const valid = pushTokens.filter((t: string) => !invalidTokens.includes(t));
      await db.collection('sellers').doc(sellerId).update({ pushTokens: valid });
      console.log(`[PUSH] Cleaned ${invalidTokens.length} invalid tokens for ${sellerId}`);
    }
  }
}

export async function sendSaleNotification(sellerId: string, orderData: OrderData): Promise<void> {
  try {
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = getFirestore();

    const productName = orderData.productName || orderData.checkoutTitle || orderData.productTitle || 'Produto';
    const amountFmt = orderData.amount ? `R$ ${formatBRL(orderData.amount)}` : 'R$ 0,00';
    const orderId = orderData.id || '';

    // Notifica o seller principal
    await sendToTokens(
      admin, db, sellerId,
      '💰 Venda Aprovada!',
      `${productName} — ${amountFmt}`,
      orderId,
      {
        amount: String(orderData.amount ?? 0),
        productName,
      }
    );

    // Notifica o afiliado (se houver)
    if (orderData.affiliateId && orderData.affiliateId !== sellerId) {
      const commFmt = orderData.affiliateCommission
        ? `R$ ${formatBRL(orderData.affiliateCommission)}`
        : amountFmt;

      await sendToTokens(
        admin, db, orderData.affiliateId,
        '💰 Comissão de Afiliado!',
        `${productName} — ${commFmt}`,
        orderId,
        {
          amount: String(orderData.affiliateCommission ?? orderData.amount ?? 0),
          productName,
          type: 'affiliate',
        }
      );
    }
  } catch (error: any) {
    console.error(`[PUSH] Error sending notification for seller ${sellerId}:`, error?.message || error);
  }
}
