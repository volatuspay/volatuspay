import cron from 'node-cron';
import { storage } from '../storage';

let dunningJob: ReturnType<typeof cron.schedule> | null = null;

export function startDunningCron() {
  if (dunningJob) {
    console.log('⚠️ Cron de dunning já está rodando');
    return;
  }

  // Rodar a cada 6 horas: 0 */6 * * *
  dunningJob = cron.schedule('0 */6 * * *', async () => {
    console.log('💳 [DUNNING CRON] Processando retries de cartão recusado...');
    try {
      const count = await (storage as any).processDunningRetries();
      console.log(`✅ [DUNNING CRON] ${count} subscriptions processadas`);
    } catch (error) {
      console.error('❌ [DUNNING CRON] Erro:', error);
    }
  });

  console.log('✅ Dunning cron iniciado (a cada 6 horas)');
}

export function stopDunningCron() {
  if (dunningJob) {
    dunningJob.stop();
    dunningJob = null;
    console.log('⛔ Dunning cron parado');
  }
}
