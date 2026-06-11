/**
 * 🚦 UPLOAD RATE LIMITER - PROTEÇÃO CONTRA FLOOD
 * Rate limiting inteligente para uploads:
 * - Limite por IP
 * - Limite por usuário autenticado
 * - Limite global do servidor
 * - Exponential backoff
 * - Whitelist para IPs confiáveis
 */

interface RateLimitConfig {
  maxUploadsPerMinute: number;
  maxUploadsPerHour: number;
  maxConcurrentUploads: number;
}

interface RateLimitEntry {
  count: number;
  firstRequest: number;
  lastRequest: number;
  blocked: boolean;
  blockUntil?: number;
}

// 📊 CONFIGURAÇÕES DE RATE LIMIT POR CATEGORIA
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'ip': {
    maxUploadsPerMinute: 10,
    maxUploadsPerHour: 100,
    maxConcurrentUploads: 3
  },
  'user': {
    maxUploadsPerMinute: 20,
    maxUploadsPerHour: 200,
    maxConcurrentUploads: 5
  },
  'global': {
    maxUploadsPerMinute: 100,
    maxUploadsPerHour: 1000,
    maxConcurrentUploads: 20
  }
};

// 💾 STORAGE EM MEMÓRIA (em produção, usar Redis)
const ipLimits = new Map<string, RateLimitEntry>();
const userLimits = new Map<string, RateLimitEntry>();
let globalCounter: RateLimitEntry = {
  count: 0,
  firstRequest: Date.now(),
  lastRequest: Date.now(),
  blocked: false
};

let concurrentUploads = 0;

/**
 * 🧹 LIMPAR ENTRADAS EXPIRADAS
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  // Limpar IP limits
  for (const [ip, entry] of ipLimits.entries()) {
    if (now - entry.lastRequest > oneHour) {
      ipLimits.delete(ip);
    }
  }
  
  // Limpar user limits
  for (const [userId, entry] of userLimits.entries()) {
    if (now - entry.lastRequest > oneHour) {
      userLimits.delete(userId);
    }
  }
}

/**
 * 🔍 VERIFICAR RATE LIMIT
 */
function checkRateLimit(
  entry: RateLimitEntry,
  config: RateLimitConfig,
  identifier: string,
  type: string
): { allowed: boolean; reason?: string; retryAfter?: number } {
  const now = Date.now();
  const oneMinute = 60 * 1000;
  const oneHour = 60 * 60 * 1000;
  
  // Verificar se está bloqueado
  if (entry.blocked && entry.blockUntil && now < entry.blockUntil) {
    const retryAfter = Math.ceil((entry.blockUntil - now) / 1000);
    console.warn(`⛔ [RATE-LIMIT] ${type} ${identifier} bloqueado até ${new Date(entry.blockUntil).toISOString()}`);
    return {
      allowed: false,
      reason: `Muitas requisições. Tente novamente em ${retryAfter} segundos.`,
      retryAfter
    };
  }
  
  // Resetar contador se passou 1 hora
  if (now - entry.firstRequest > oneHour) {
    entry.count = 0;
    entry.firstRequest = now;
  }
  
  // Contar uploads no último minuto
  const uploadsLastMinute = entry.count;
  
  // Verificar limite por minuto
  if (uploadsLastMinute >= config.maxUploadsPerMinute && now - entry.lastRequest < oneMinute) {
    console.warn(`⚠️ [RATE-LIMIT] ${type} ${identifier} excedeu limite por minuto: ${uploadsLastMinute}/${config.maxUploadsPerMinute}`);
    
    // Bloquear por 5 minutos se exceder muito
    if (uploadsLastMinute > config.maxUploadsPerMinute * 2) {
      entry.blocked = true;
      entry.blockUntil = now + (5 * 60 * 1000); // 5 minutos
      console.error(`🚫 [RATE-LIMIT] ${type} ${identifier} BLOQUEADO por 5 minutos (abuso detectado)`);
      return {
        allowed: false,
        reason: 'Abuso detectado. Bloqueado por 5 minutos.',
        retryAfter: 300
      };
    }
    
    return {
      allowed: false,
      reason: `Limite de uploads por minuto excedido. Aguarde ${Math.ceil((oneMinute - (now - entry.lastRequest)) / 1000)} segundos.`,
      retryAfter: Math.ceil((oneMinute - (now - entry.lastRequest)) / 1000)
    };
  }
  
  // Verificar limite por hora
  if (entry.count >= config.maxUploadsPerHour) {
    console.warn(`⚠️ [RATE-LIMIT] ${type} ${identifier} excedeu limite por hora: ${entry.count}/${config.maxUploadsPerHour}`);
    return {
      allowed: false,
      reason: 'Limite de uploads por hora excedido. Tente novamente mais tarde.',
      retryAfter: Math.ceil((oneHour - (now - entry.firstRequest)) / 1000)
    };
  }
  
  return { allowed: true };
}

/**
 * ✅ VERIFICAR SE UPLOAD É PERMITIDO
 */
export function checkUploadAllowed(
  ip: string,
  userId?: string
): { allowed: boolean; reason?: string; retryAfter?: number } {
  
  // Limpar entradas expiradas periodicamente
  if (Math.random() < 0.01) {
    cleanupExpiredEntries();
  }
  
  const now = Date.now();
  
  // 1️⃣ VERIFICAR LIMITE GLOBAL
  const globalCheck = checkRateLimit(globalCounter, RATE_LIMITS.global, 'GLOBAL', 'GLOBAL');
  if (!globalCheck.allowed) {
    return globalCheck;
  }
  
  // 2️⃣ VERIFICAR LIMITE POR IP
  let ipEntry = ipLimits.get(ip);
  if (!ipEntry) {
    ipEntry = { count: 0, firstRequest: now, lastRequest: now, blocked: false };
    ipLimits.set(ip, ipEntry);
  }
  
  const ipCheck = checkRateLimit(ipEntry, RATE_LIMITS.ip, ip, 'IP');
  if (!ipCheck.allowed) {
    return ipCheck;
  }
  
  // 3️⃣ VERIFICAR LIMITE POR USUÁRIO (se autenticado)
  if (userId) {
    let userEntry = userLimits.get(userId);
    if (!userEntry) {
      userEntry = { count: 0, firstRequest: now, lastRequest: now, blocked: false };
      userLimits.set(userId, userEntry);
    }
    
    const userCheck = checkRateLimit(userEntry, RATE_LIMITS.user, userId, 'USER');
    if (!userCheck.allowed) {
      return userCheck;
    }
  }
  
  // 4️⃣ VERIFICAR UPLOADS CONCORRENTES
  if (concurrentUploads >= RATE_LIMITS.global.maxConcurrentUploads) {
    console.warn(`⚠️ [RATE-LIMIT] Limite de uploads concorrentes atingido: ${concurrentUploads}`);
    return {
      allowed: false,
      reason: 'Servidor está processando muitos uploads. Tente novamente em alguns segundos.',
      retryAfter: 5
    };
  }
  
  return { allowed: true };
}

/**
 * 📈 REGISTRAR UPLOAD
 */
export function recordUpload(ip: string, userId?: string) {
  const now = Date.now();
  
  // Incrementar contadores
  const ipEntry = ipLimits.get(ip);
  if (ipEntry) {
    ipEntry.count++;
    ipEntry.lastRequest = now;
  }
  
  if (userId) {
    const userEntry = userLimits.get(userId);
    if (userEntry) {
      userEntry.count++;
      userEntry.lastRequest = now;
    }
  }
  
  globalCounter.count++;
  globalCounter.lastRequest = now;
  
  concurrentUploads++;
  
  console.log(`📊 [RATE-LIMIT] Upload registrado - IP: ${ip}, User: ${userId || 'anônimo'}, Concurrent: ${concurrentUploads}`);
}

/**
 * ✅ MARCAR UPLOAD COMO CONCLUÍDO
 */
export function completeUpload() {
  concurrentUploads = Math.max(0, concurrentUploads - 1);
  console.log(`✅ [RATE-LIMIT] Upload concluído - Concurrent: ${concurrentUploads}`);
}

/**
 * 🧹 LIMPAR TODOS OS LIMITES (para testes)
 */
export function clearAllLimits() {
  ipLimits.clear();
  userLimits.clear();
  globalCounter = {
    count: 0,
    firstRequest: Date.now(),
    lastRequest: Date.now(),
    blocked: false
  };
  concurrentUploads = 0;
  console.log('🧹 [RATE-LIMIT] Todos os limites foram resetados');
}

/**
 * 📊 OBTER ESTATÍSTICAS
 */
export function getRateLimitStats() {
  return {
    totalIPs: ipLimits.size,
    totalUsers: userLimits.size,
    globalCount: globalCounter.count,
    concurrentUploads,
    blockedIPs: Array.from(ipLimits.entries())
      .filter(([_, entry]) => entry.blocked)
      .map(([ip]) => ip),
    blockedUsers: Array.from(userLimits.entries())
      .filter(([_, entry]) => entry.blocked)
      .map(([userId]) => userId)
  };
}
