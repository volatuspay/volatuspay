import cron from 'node-cron';

let cronJobs: ReturnType<typeof cron.schedule>[] = [];

export function startSalesSummaryCron() {
  if (cronJobs.length > 0) {
    console.log('⚠️ Cron de resumo de vendas já está rodando');
    return;
  }
  console.log('✅ Cron de resumo de vendas iniciado (desabilitado — WhatsApp removido)');
}

export function stopSalesSummaryCron() {
  cronJobs.forEach(job => job.stop());
  cronJobs = [];
  console.log('⛔ Cron de resumo de vendas parado');
}
