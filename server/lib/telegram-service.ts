import { getAdmin, ensureFirebaseReady } from './firebase-admin.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  events: string[];
  updatedAt?: string;
}

export interface TelegramOrderData {
  orderId: string;
  productName?: string;
  amount: number;
  customerName?: string;
  customerEmail?: string;
  paymentMethod?: string;
  status?: string;
}

const COLLECTION = (sellerUid: string) =>
  `sellers/${sellerUid}/integrations/telegram`;

export async function getTelegramConfig(sellerUid: string): Promise<TelegramConfig | null> {
  try {
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    const [col, subCol, doc] = COLLECTION(sellerUid).split('/');
    const snap = await db.collection(col).doc(subCol).collection(subCol).doc(doc).get().catch(() => null);
    const directSnap = await db.collection('sellers').doc(sellerUid).collection('integrations').doc('telegram').get();
    if (!directSnap.exists) return null;
    return directSnap.data() as TelegramConfig;
  } catch {
    return null;
  }
}

export async function saveTelegramConfig(sellerUid: string, config: Partial<TelegramConfig>): Promise<void> {
  await ensureFirebaseReady();
  const adminSdk = getAdmin();
  const db = adminSdk.firestore();
  const ref = db.collection('sellers').doc(sellerUid).collection('integrations').doc('telegram');
  await ref.set({ ...config, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${TELEGRAM_API}${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    const result = await response.json() as any;
    if (!result.ok) {
      return { ok: false, error: result.description || 'Telegram API error' };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function formatCurrency(amountInCents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amountInCents / 100);
}

function formatDate(): string {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function mapMethod(method?: string): string {
  if (!method) return 'Desconhecido';
  const m = method.toLowerCase();
  if (m.includes('pix')) return 'PIX';
  if (m.includes('card') || m.includes('cart')) return 'Cartão de Crédito';
  if (m.includes('boleto')) return 'Boleto';
  return method;
}

function buildMessage(event: string, order: TelegramOrderData): string {
  const valor = formatCurrency(order.amount || 0);
  const produto = order.productName || 'Produto';
  const cliente = order.customerName || 'Cliente';
  const email = order.customerEmail || '';
  const metodo = mapMethod(order.paymentMethod);
  const data = formatDate();
  const id = order.orderId?.substring(0, 8) || '';

  switch (event) {
    case 'payment.pix.paid':
    case 'payment.card.approved':
    case 'payment.approved':
      return `🟢 <b>VENDA APROVADA!</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n${email ? `📧 <b>Email:</b> ${email}\n` : ''}💳 <b>Método:</b> ${metodo}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    case 'payment.pix.created':
    case 'payment.waiting':
      return `🟡 <b>PIX AGUARDANDO PAGAMENTO</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n⏳ <i>Aguardando confirmação do pagamento</i>\n\n🤖 <i>VolatusPay</i>`;

    case 'payment.pix.expired':
    case 'payment.expired':
      return `⏰ <b>PIX EXPIRADO</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    case 'payment.boleto.created':
      return `📄 <b>BOLETO GERADO</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    case 'payment.boleto.paid':
      return `🟢 <b>BOLETO PAGO!</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    case 'payment.refunded':
      return `🔴 <b>REEMBOLSO PROCESSADO</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    case 'payment.chargeback':
      return `⚠️ <b>CHARGEBACK RECEBIDO</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    case 'payment.declined':
      return `❌ <b>PAGAMENTO RECUSADO</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🆔 <b>Pedido:</b> #${id}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    case 'cart.abandoned':
      return `🛒 <b>CARRINHO ABANDONADO</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n${email ? `📧 <b>Email:</b> ${email}\n` : ''}🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;

    default:
      return `📣 <b>EVENTO: ${event}</b>\n\n📦 <b>Produto:</b> ${produto}\n💰 <b>Valor:</b> ${valor}\n👤 <b>Cliente:</b> ${cliente}\n🕐 <b>Data:</b> ${data}\n\n🤖 <i>VolatusPay</i>`;
  }
}

export async function sendTelegramNotification(
  sellerUid: string,
  event: string,
  order: TelegramOrderData
): Promise<void> {
  try {
    const config = await getTelegramConfig(sellerUid);
    if (!config || !config.enabled || !config.botToken || !config.chatId) return;
    if (config.events && config.events.length > 0 && !config.events.includes(event)) return;

    const text = buildMessage(event, order);
    const result = await sendTelegramMessage(config.botToken, config.chatId, text);
    if (!result.ok) {
      console.error(`[Telegram] Falha ao enviar notificação para seller ${sellerUid}:`, result.error);
    }
  } catch (err: any) {
    console.error(`[Telegram] Erro inesperado:`, err.message);
  }
}
