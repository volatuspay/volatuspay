import { getAdmin, ensureFirebaseReady } from './firebase-admin.js';

export interface DiscordConfig {
  webhookUrl: string;
  enabled: boolean;
  events: string[];
  updatedAt?: string;
}

export interface DiscordOrderData {
  orderId: string;
  productName?: string;
  amount: number;
  customerName?: string;
  customerEmail?: string;
  paymentMethod?: string;
}

export async function getDiscordConfig(sellerUid: string): Promise<DiscordConfig | null> {
  try {
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    const snap = await db.collection('sellers').doc(sellerUid).collection('integrations').doc('discord').get();
    if (!snap.exists) return null;
    return snap.data() as DiscordConfig;
  } catch {
    return null;
  }
}

function buildDiscordEmbed(event: string, order: DiscordOrderData) {
  const valor = `R$ ${(order.amount / 100).toFixed(2).replace('.', ',')}`;
  const produto = order.productName || 'Produto';
  const cliente = order.customerName || order.customerEmail || 'Cliente';
  const metodo = order.paymentMethod === 'pix' ? 'PIX' : order.paymentMethod === 'boleto' ? 'Boleto' : order.paymentMethod || '—';
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const eventLabels: Record<string, { title: string; color: number; emoji: string }> = {
    'payment.pix.paid':      { title: 'PIX Aprovado!',       color: 0x22c55e, emoji: '✅' },
    'payment.card.approved': { title: 'Cartão Aprovado!',    color: 0x3b82f6, emoji: '💳' },
    'payment.boleto.paid':   { title: 'Boleto Pago!',        color: 0x22c55e, emoji: '📄' },
    'payment.pix.created':   { title: 'PIX Gerado',          color: 0xfbbf24, emoji: '🟡' },
    'payment.pix.expired':   { title: 'PIX Expirado',        color: 0xef4444, emoji: '⏰' },
    'payment.refunded':      { title: 'Reembolso Processado',color: 0xf97316, emoji: '🔴' },
    'payment.declined':      { title: 'Pagamento Recusado',  color: 0xef4444, emoji: '❌' },
    'payment.chargeback':    { title: 'Chargeback',          color: 0xdc2626, emoji: '⚠️' },
  };

  const info = eventLabels[event] || { title: event, color: 0x15803d, emoji: '🔔' };

  return {
    username: 'VolatusPay',
    avatar_url: 'https://volatuspay.com/logos/volatuspay-logo.png',
    embeds: [
      {
        title: `${info.emoji} ${info.title}`,
        color: info.color,
        fields: [
          { name: '💰 Valor',    value: valor,                 inline: true  },
          { name: '💳 Método',   value: metodo,                inline: true  },
          { name: '📦 Produto',  value: produto,               inline: false },
          { name: '👤 Cliente',  value: cliente,               inline: true  },
          { name: '🆔 Pedido',   value: `\`${order.orderId}\``,inline: true  },
          { name: '🕐 Data',     value: agora,                 inline: false },
        ],
        footer: { text: 'VolatusPay' },
      },
    ],
  };
}

export async function sendDiscordNotification(
  sellerUid: string,
  event: string,
  order: DiscordOrderData
): Promise<void> {
  try {
    const config = await getDiscordConfig(sellerUid);
    if (!config || !config.enabled || !config.webhookUrl) return;
    if (config.events && config.events.length > 0 && !config.events.includes(event)) return;

    const payload = buildDiscordEmbed(event, order);

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok && response.status !== 204) {
      const text = await response.text();
      console.error(`[Discord] Falha ao enviar (${response.status}):`, text);
    } else {
      console.log(`[Discord] ✅ Notificação enviada: ${event} → seller ${sellerUid}`);
    }
  } catch (err: any) {
    console.error(`[Discord] Erro inesperado:`, err.message);
  }
}
