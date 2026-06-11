import cron from 'node-cron';
import { storage } from '../storage';

let cronJob: ReturnType<typeof cron.schedule> | null = null;

export function startSubscriptionCron() {
  if (cronJob) {
    console.log('⚠️ Cron job de subscriptions já está rodando');
    return;
  }

  // Rodar a cada hora: 0 */1 * * * (minuto 0 de cada hora)
  cronJob = cron.schedule('0 */1 * * *', async () => {
    console.log('⏰ CRON JOB: Verificando subscriptions expiradas...');
    try {
      const expiredCount = await storage.processExpiredSubscriptions();
      console.log(`✅ CRON JOB: ${expiredCount} subscriptions processadas`);
    } catch (error) {
      console.error('❌ CRON JOB: Erro ao processar subscriptions:', error);
    }
  });

  console.log('✅ Cron job de subscriptions iniciado (a cada hora)');
}

export function stopSubscriptionCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('⛔ Cron job de subscriptions parado');
  }
}
