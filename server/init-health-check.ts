/**
 * 🔍 INICIALIZAÇÃO DO FIREBASE HEALTH CHECK
 * 
 * Este arquivo garante que o health check periódico do Firebase seja iniciado
 * APÓS o Firebase estar completamente inicializado, evitando race conditions.
 */

let healthCheckInitialized = false;

export function startFirebaseHealthMonitor() {
  if (healthCheckInitialized) {
    console.warn('⚠️ Firebase Health Monitor já foi inicializado - ignorando chamada duplicada');
    return;
  }
  
  import('./security/security-logger.js').then(() => {
    healthCheckInitialized = true;
    console.log('✅ Firebase Health Check Monitor iniciado com sucesso');
  }).catch((error) => {
    console.error('❌ Erro ao inicializar Firebase Health Check:', error);
  });
}
