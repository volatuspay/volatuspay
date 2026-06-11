import { getAdmin, ensureFirebaseReady } from './firebase-admin.js';

interface XtrackyConfig {
  productId: string;
  enabled: boolean;
}

interface XtrackyConversionData {
  orderId: string;
  amount: number;
  status: 'waiting_payment' | 'paid' | 'initiate_checkout' | 'failed' | 'refunded';
  utmSource?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadDocument?: string;
}

const XTRACKY_API_URL = 'https://api.xtracky.com/api/integrations/api';

export async function getXtrackyConfig(sellerUid: string): Promise<XtrackyConfig | null> {
  try {
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    const doc = await db.collection('sellers').doc(sellerUid).collection('integrations').doc('xtracky').get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    if (!data.productId || !data.enabled) return null;
    return { productId: data.productId, enabled: data.enabled };
  } catch {
    return null;
  }
}

export async function sendXtrackyConversion(
  sellerUid: string,
  data: XtrackyConversionData
): Promise<void> {
  try {
    const config = await getXtrackyConfig(sellerUid);
    if (!config) return;

    const payload: Record<string, any> = {
      orderId: data.orderId,
      amount: data.amount,
      status: data.status,
      platform: 'ZEN_PAGAMENTOS',
    };

    if (data.utmSource) payload.utm_source = data.utmSource;
    if (data.leadName) payload.leadName = data.leadName;
    if (data.leadEmail) payload.leadEmail = data.leadEmail;
    if (data.leadPhone) payload.leadPhone = data.leadPhone;
    if (data.leadDocument) payload.leadDocument = data.leadDocument;

    const response = await fetch(XTRACKY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Xtracky] Falha ao enviar conversão (${response.status}):`, text);
    } else {
      console.log(`[Xtracky] ✅ Conversão enviada: ${data.orderId} | status=${data.status}`);
    }
  } catch (err: any) {
    console.error(`[Xtracky] Erro inesperado:`, err.message);
  }
}
