import cron from 'node-cron';
import { sendAbandonedCartEmail } from '../lib/email-service.js';

let cronJob: ReturnType<typeof cron.schedule> | null = null;

async function getFirestore() {
  const { getAdmin } = await import('../lib/firebase-admin.js');
  return getAdmin().firestore();
}

// Janela de tempo para cada dia de recuperação (margem de ±3h para cron bihourly)
function getTimeWindow(daysAgo: number): { start: Date; end: Date } {
  const now = Date.now();
  const center = now - daysAgo * 24 * 60 * 60 * 1000;
  return {
    start: new Date(center - 3 * 60 * 60 * 1000),
    end:   new Date(center + 3 * 60 * 60 * 1000),
  };
}

async function runAbandonedCartRecovery() {
  console.log('🛒 ABANDONED CART: Iniciando verificação de recuperação...');
  try {
    const db = await getFirestore();
    const recoveryDays: Array<1 | 3 | 7> = [1, 3, 7];
    let totalRecovered = 0;

    for (const day of recoveryDays) {
      const { start, end } = getTimeWindow(day);

      // Buscar eventos checkout_initiated no período
      const eventsSnap = await db.collection('checkoutEvents')
        .where('eventType', '==', 'checkout_initiated')
        .where('serverReceivedAt', '>=', start)
        .where('serverReceivedAt', '<=', end)
        .limit(200)
        .get();

      if (eventsSnap.empty) continue;
      console.log(`🛒 D+${day}: ${eventsSnap.size} eventos encontrados`);

      for (const doc of eventsSnap.docs) {
        const event = doc.data();
        const { sessionId, checkoutId, tenantId, formData } = event;
        const buyerEmail: string = formData?.email || '';
        const buyerName: string  = formData?.name  || '';

        if (!buyerEmail || !checkoutId) continue;

        // 1️⃣ Verificar se já comprou (order paga com mesmo sessionId ou mesmo email+checkoutId)
        const paidCheck = await db.collection('orders')
          .where('checkoutId', '==', checkoutId)
          .where('status', '==', 'paid')
          .limit(1)
          .get();

        // Verificar também por email do comprador
        let paidByEmail = false;
        if (paidCheck.empty && buyerEmail) {
          const emailCheck = await db.collection('orders')
            .where('checkoutId', '==', checkoutId)
            .where('customer.email', '==', buyerEmail)
            .where('status', '==', 'paid')
            .limit(1)
            .get();
          paidByEmail = !emailCheck.empty;
        }

        if (!paidCheck.empty || paidByEmail) continue;

        // 2️⃣ Verificar se já enviamos para este session/email/day
        const alreadySentKey = `${sessionId || buyerEmail}_${checkoutId}_email_d${day}`;
        const alreadySent = await db.collection('abandonedCartRecovery')
          .doc(alreadySentKey)
          .get();

        if (alreadySent.exists) continue;

        // 3️⃣ Buscar informações do checkout para nome do produto e slug
        let productName = 'seu produto';
        let checkoutSlug = checkoutId;
        try {
          const checkoutDoc = await db.collection('checkouts').doc(checkoutId).get();
          if (checkoutDoc.exists) {
            const cd = checkoutDoc.data()!;
            productName  = cd.productName || cd.title || productName;
            checkoutSlug = cd.slug || checkoutId;
          }
        } catch {}

        // 4️⃣ Enviar email de recuperação
        try {
          const result = await sendAbandonedCartEmail({
            buyerEmail,
            buyerName,
            productName,
            checkoutSlug,
            day,
          });

          if (result.success) {
            // Marcar como enviado
            await db.collection('abandonedCartRecovery').doc(alreadySentKey).set({
              sessionId, checkoutId, buyerEmail, tenantId,
              day, channel: 'email', sentAt: new Date(),
            });
            totalRecovered++;
            console.log(`✅ ABANDONED CART EMAIL D+${day}: ${buyerEmail} (${productName})`);
          }
        } catch (err: any) {
          console.warn(`⚠️ ABANDONED CART EMAIL D+${day} erro: ${err?.message}`);
        }
      }
    }

    console.log(`✅ ABANDONED CART: ${totalRecovered} emails enviados`);
  } catch (error: any) {
    console.error('❌ ABANDONED CART CRON erro:', error?.message);
  }
}

export function startAbandonedCartCron() {
  if (cronJob) {
    console.log('⚠️ Cron job de carrinho abandonado já está rodando');
    return;
  }

  // Rodar a cada 2 horas
  cronJob = cron.schedule('0 */2 * * *', async () => {
    await runAbandonedCartRecovery();
  });

  console.log('✅ Cron job de recuperação de carrinho abandonado iniciado (a cada 2h)');
}

export function stopAbandonedCartCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('⛔ Cron job de carrinho abandonado parado');
  }
}
