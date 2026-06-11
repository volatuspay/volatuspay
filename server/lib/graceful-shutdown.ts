import type { Server } from 'http';
import { webhookQueue } from './webhook-queue.js';

let isShuttingDown = false;
let activeRequests = 0;
const SHUTDOWN_TIMEOUT_MS = 15000;

export function trackRequest(req: any, res: any, next: any) {
  if (isShuttingDown) {
    return res.status(503).json({ error: 'Servidor reiniciando, tente novamente em alguns segundos' });
  }
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  next();
}

export function setupGracefulShutdown(server: Server) {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 ${signal} recebido - iniciando shutdown graceful...`);
    console.log(`⏳ Aguardando ${activeRequests} requisições em andamento...`);

    server.close(() => {
      console.log('✅ Servidor parou de aceitar novas conexões');
    });

    const startTime = Date.now();
    while (activeRequests > 0 && (Date.now() - startTime) < SHUTDOWN_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (activeRequests > 0) {
        console.log(`⏳ Ainda ${activeRequests} requisições pendentes...`);
      }
    }

    if (activeRequests > 0) {
      console.warn(`⚠️ Timeout! ${activeRequests} requisições não finalizaram em ${SHUTDOWN_TIMEOUT_MS/1000}s`);
    } else {
      console.log('✅ Todas as requisições finalizaram com sucesso');
    }

    console.log('🔒 Flush de logs e caches...');
    
    try {
      const pending = webhookQueue.getPendingCount();
      if (pending > 0) {
        console.log(`⏳ Aguardando ${pending} webhooks na fila...`);
        await webhookQueue.drain(5000);
      }
    } catch (e) {}

    console.log('👋 Shutdown completo. Até breve!');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error.message);
    console.error(error.stack);
    if (!isShuttingDown) {
      shutdown('UNCAUGHT_EXCEPTION');
    }
  });

  process.on('unhandledRejection', (reason: any) => {
    console.error('💥 Unhandled Rejection:', reason?.message || reason);
  });

  console.log('✅ Graceful shutdown configurado (SIGTERM, SIGINT, uncaughtException)');
}

export function isServerShuttingDown() {
  return isShuttingDown;
}

export function getActiveRequestCount() {
  return activeRequests;
}
