// 💰 SISTEMA DEVASTADOR DE OTIMIZAÇÃO DE CUSTOS FIREBASE
// Proteção total contra gastos excessivos com quotas, cache e idempotency

interface QuotaRule {
  daily: number;      // Limite diário
  hourly: number;     // Limite por hora
  perUser: number;    // Limite por usuário
  perTenant: number;  // Limite por tenant
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;        // Time to live em milissegundos
}

interface IdempotencyEntry {
  responseData: any;
  timestamp: number;
  statusCode: number;
}

// 📊 CONFIGURAÇÃO DE QUOTAS POR ENDPOINT
const FIREBASE_QUOTAS: { [endpoint: string]: QuotaRule } = {
  // Operações críticas com limite baixo
  '/api/payment/create-session': {
    daily: 500,      // 500 payments por dia
    hourly: 50,      // 50 payments por hora
    perUser: 10,     // 10 payments por usuário por hora
    perTenant: 100   // 100 payments por tenant por hora
  },
  
  // Uploads com limite moderado
  '/api/objects/upload': {
    daily: 1000,     // 1000 uploads por dia
    hourly: 200,     // 200 uploads por hora
    perUser: 20,     // 20 uploads por usuário por hora
    perTenant: 500   // 500 uploads por tenant por hora
  },
  
  // Registro de sellers (muito restritivo)
  '/api/sellers/register': {
    daily: 100,      // 100 registros por dia
    hourly: 20,      // 20 registros por hora
    perUser: 1,      // 1 registro por usuário por hora
    perTenant: 5     // 5 registros por tenant por hora
  },
  
  // Webhooks (flexível, mas controlado)
  '/webhook/efi': {
    daily: 10000,    // 10k webhooks por dia
    hourly: 2000,    // 2k webhooks por hora
    perUser: 100,    // 100 webhooks por usuário por hora
    perTenant: 1000  // 1k webhooks por tenant por hora
  },
  
  // Operações admin (restritivo)
  '/api/admin/*': {
    daily: 1000,     // 1000 operações admin por dia
    hourly: 200,     // 200 operações admin por hora
    perUser: 50,     // 50 operações admin por usuário por hora
    perTenant: 500   // 500 operações admin por tenant por hora
  }
};

// ⚡ CONFIGURAÇÃO DE CACHE TTL
const CACHE_TTL_CONFIG = {
  // Dados que mudam raramente
  sellers: 15 * 60 * 1000,        // 15 minutos
  products: 10 * 60 * 1000,       // 10 minutos
  checkouts: 5 * 60 * 1000,       // 5 minutos
  
  // Dados que mudam frequentemente
  orders: 2 * 60 * 1000,          // 2 minutos
  subscriptions: 3 * 60 * 1000,   // 3 minutos
  
  // Dados críticos (cache mais baixo)
  payments: 30 * 1000,            // 30 segundos
  balances: 1 * 60 * 1000,        // 1 minuto
  
  // Dados estáticos
  stats: 30 * 60 * 1000,          // 30 minutos
  configs: 60 * 60 * 1000,        // 1 hora
  
  // Default
  default: 5 * 60 * 1000           // 5 minutos
};

// 🧠 ENGINE PRINCIPAL DE OTIMIZAÇÃO
class FirebaseCostOptimizer {
  private quotaCounters = new Map<string, any>();
  private memoryCache = new Map<string, CacheEntry<any>>();
  private idempotencyStore = new Map<string, IdempotencyEntry>();
  private operationMetrics = new Map<string, { count: number; totalCost: number; avgTime: number }>();
  
  // Limpeza automática
  private cleanupInterval: NodeJS.Timeout;
  
  constructor() {
    // Limpeza a cada 10 minutos
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000);
  }
  
  // 📈 VERIFICAR QUOTA
  checkQuota(endpoint: string, userId?: string, tenantId?: string): { allowed: boolean; reason?: string; retryAfter?: number } {
    const now = Date.now();
    const hour = Math.floor(now / (60 * 60 * 1000));
    const day = Math.floor(now / (24 * 60 * 60 * 1000));
    
    console.log(`💰 QUOTA CHECK: ${endpoint} - User=${userId} Tenant=${tenantId}`);
    
    // Buscar quota para endpoint (wildcard matching)
    let quotaRule: QuotaRule | undefined;
    for (const [pattern, rule] of Object.entries(FIREBASE_QUOTAS)) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (endpoint.startsWith(prefix)) {
          quotaRule = rule;
          break;
        }
      } else if (pattern === endpoint) {
        quotaRule = rule;
        break;
      }
    }
    
    // Se não tem quota definida, liberar (mas logar)
    if (!quotaRule) {
      console.log(`⚠️ NO QUOTA DEFINED: ${endpoint}`);
      return { allowed: true };
    }
    
    // 1️⃣ VERIFICAR QUOTA GLOBAL DIÁRIA
    const dailyKey = `daily:${endpoint}:${day}`;
    const dailyCount = this.getCounter(dailyKey);
    if (dailyCount >= quotaRule.daily) {
      console.log(`❌ DAILY QUOTA EXCEEDED: ${endpoint} - ${dailyCount}/${quotaRule.daily}`);
      return { 
        allowed: false, 
        reason: 'Daily quota exceeded',
        retryAfter: this.getSecondsUntilNextDay()
      };
    }
    
    // 2️⃣ VERIFICAR QUOTA GLOBAL POR HORA
    const hourlyKey = `hourly:${endpoint}:${hour}`;
    const hourlyCount = this.getCounter(hourlyKey);
    if (hourlyCount >= quotaRule.hourly) {
      console.log(`❌ HOURLY QUOTA EXCEEDED: ${endpoint} - ${hourlyCount}/${quotaRule.hourly}`);
      return { 
        allowed: false, 
        reason: 'Hourly quota exceeded',
        retryAfter: this.getSecondsUntilNextHour()
      };
    }
    
    // 3️⃣ VERIFICAR QUOTA POR USUÁRIO
    if (userId) {
      const userKey = `user:${endpoint}:${userId}:${hour}`;
      const userCount = this.getCounter(userKey);
      if (userCount >= quotaRule.perUser) {
        console.log(`❌ USER QUOTA EXCEEDED: ${endpoint} - User=${userId} - ${userCount}/${quotaRule.perUser}`);
        return { 
          allowed: false, 
          reason: 'User quota exceeded',
          retryAfter: this.getSecondsUntilNextHour()
        };
      }
    }
    
    // 4️⃣ VERIFICAR QUOTA POR TENANT
    if (tenantId) {
      const tenantKey = `tenant:${endpoint}:${tenantId}:${hour}`;
      const tenantCount = this.getCounter(tenantKey);
      if (tenantCount >= quotaRule.perTenant) {
        console.log(`❌ TENANT QUOTA EXCEEDED: ${endpoint} - Tenant=${tenantId} - ${tenantCount}/${quotaRule.perTenant}`);
        return { 
          allowed: false, 
          reason: 'Tenant quota exceeded',
          retryAfter: this.getSecondsUntilNextHour()
        };
      }
    }
    
    // ✅ TUDO OK - INCREMENTAR CONTADORES
    this.incrementCounter(dailyKey);
    this.incrementCounter(hourlyKey);
    if (userId) this.incrementCounter(`user:${endpoint}:${userId}:${hour}`);
    if (tenantId) this.incrementCounter(`tenant:${endpoint}:${tenantId}:${hour}`);
    
    console.log(`✅ QUOTA ALLOWED: ${endpoint} - Daily=${dailyCount + 1}/${quotaRule.daily} Hourly=${hourlyCount + 1}/${quotaRule.hourly}`);
    
    return { allowed: true };
  }
  
  // 🗝️ VERIFICAR IDEMPOTENCY KEY
  checkIdempotency(idempotencyKey: string): { exists: boolean; response?: any; statusCode?: number } {
    if (!idempotencyKey) {
      return { exists: false };
    }
    
    const entry = this.idempotencyStore.get(idempotencyKey);
    
    if (!entry) {
      return { exists: false };
    }
    
    // Verificar se não expirou (idempotency válida por 24 horas)
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas
    if (Date.now() - entry.timestamp > maxAge) {
      this.idempotencyStore.delete(idempotencyKey);
      return { exists: false };
    }
    
    console.log(`🔄 IDEMPOTENCY HIT: ${idempotencyKey}`);
    return { 
      exists: true, 
      response: entry.responseData,
      statusCode: entry.statusCode
    };
  }
  
  // 💾 SALVAR RESPOSTA IDEMPOTENTE
  saveIdempotentResponse(idempotencyKey: string, responseData: any, statusCode: number = 200) {
    if (!idempotencyKey) return;
    
    this.idempotencyStore.set(idempotencyKey, {
      responseData,
      statusCode,
      timestamp: Date.now()
    });
    
    console.log(`💾 IDEMPOTENCY SAVED: ${idempotencyKey}`);
  }
  
  // 🚀 CACHE GET
  getCached<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Verificar se expirou
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.memoryCache.delete(key);
      return null;
    }
    
    console.log(`🚀 CACHE HIT: ${key}`);
    return entry.data as T;
  }
  
  // 💾 CACHE SET
  setCached<T>(key: string, data: T, ttl?: number): void {
    // Determinar TTL baseado no tipo de dados
    let finalTTL = ttl || CACHE_TTL_CONFIG.default;
    
    for (const [type, typeTTL] of Object.entries(CACHE_TTL_CONFIG)) {
      if (key.includes(type)) {
        finalTTL = typeTTL;
        break;
      }
    }
    
    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: finalTTL
    });
    
    console.log(`💾 CACHE SET: ${key} (TTL: ${finalTTL}ms)`);
  }
  
  // 🗑️ CACHE INVALIDATE
  invalidateCache(pattern: string): number {
    let invalidated = 0;
    
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key);
        invalidated++;
      }
    }
    
    if (invalidated > 0) {
      console.log(`🗑️ CACHE INVALIDATED: ${pattern} - ${invalidated} entries`);
    }
    
    return invalidated;
  }
  
  // 📊 REGISTRAR MÉTRICA DE OPERAÇÃO
  recordOperation(operation: string, executionTime: number, estimatedCost: number = 0) {
    const existing = this.operationMetrics.get(operation) || { count: 0, totalCost: 0, avgTime: 0 };
    
    existing.count++;
    existing.totalCost += estimatedCost;
    existing.avgTime = ((existing.avgTime * (existing.count - 1)) + executionTime) / existing.count;
    
    this.operationMetrics.set(operation, existing);
    
    if (estimatedCost > 0) {
      console.log(`📊 OPERATION RECORDED: ${operation} - Time=${executionTime}ms Cost=$${estimatedCost.toFixed(4)}`);
    }
  }
  
  // 📈 OBTER MÉTRICAS
  getMetrics(): any {
    const metrics = {
      cache: {
        size: this.memoryCache.size,
        hitRatio: 0 // TODO: Implementar tracking de hit ratio
      },
      quotas: {
        active: this.quotaCounters.size
      },
      idempotency: {
        active: this.idempotencyStore.size
      },
      operations: Object.fromEntries(this.operationMetrics)
    };
    
    return metrics;
  }
  
  // 🛠️ MÉTODOS AUXILIARES
  private getCounter(key: string): number {
    return this.quotaCounters.get(key) || 0;
  }
  
  private incrementCounter(key: string): void {
    const current = this.getCounter(key);
    this.quotaCounters.set(key, current + 1);
  }
  
  private getSecondsUntilNextHour(): number {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    return Math.ceil((nextHour.getTime() - now.getTime()) / 1000);
  }
  
  private getSecondsUntilNextDay(): number {
    const now = new Date();
    const nextDay = new Date(now);
    nextDay.setDate(now.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    return Math.ceil((nextDay.getTime() - now.getTime()) / 1000);
  }
  
  // 🧹 LIMPEZA PERIÓDICA
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    // Limpar cache expirado
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(key);
        cleaned++;
      }
    }
    
    // Limpar idempotency expirada (24 horas)
    const maxIdempotencyAge = 24 * 60 * 60 * 1000;
    for (const [key, entry] of this.idempotencyStore.entries()) {
      if (now - entry.timestamp > maxIdempotencyAge) {
        this.idempotencyStore.delete(key);
        cleaned++;
      }
    }
    
    // Limpar quotas antigas (manter apenas da hora atual e hora anterior)
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    const currentDay = Math.floor(now / (24 * 60 * 60 * 1000));
    
    for (const key of this.quotaCounters.keys()) {
      const parts = key.split(':');
      if (parts[0] === 'hourly') {
        const hour = parseInt(parts[parts.length - 1]);
        if (hour < currentHour - 1) {
          this.quotaCounters.delete(key);
          cleaned++;
        }
      } else if (parts[0] === 'daily') {
        const day = parseInt(parts[parts.length - 1]);
        if (day < currentDay - 1) {
          this.quotaCounters.delete(key);
          cleaned++;
        }
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 CLEANUP: Removed ${cleaned} expired entries`);
    }
  }
  
  // 🛑 DESTRUCTOR
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// 🎯 SINGLETON GLOBAL
const firebaseCostOptimizer = new FirebaseCostOptimizer();

// 🛡️ MIDDLEWARE EXPRESS PARA QUOTA
export const quotaMiddleware = (req: any, res: any, next: any) => {
  const endpoint = req.route?.path || req.path;
  const userId = req.user?.uid;
  const tenantId = req.user?.tenantId || req.body?.tenantId || req.query?.tenantId;
  
  const quotaCheck = firebaseCostOptimizer.checkQuota(endpoint, userId, tenantId);
  
  if (!quotaCheck.allowed) {
    console.log(`🚫 QUOTA BLOCKED: ${endpoint} - ${quotaCheck.reason}`);
    
    res.set({
      'X-Quota-Limit': 'Variable',
      'X-Quota-Remaining': '0',
      'Retry-After': quotaCheck.retryAfter?.toString() || '3600'
    });
    
    return res.status(429).json({
      error: 'Quota exceeded',
      message: quotaCheck.reason,
      retryAfter: quotaCheck.retryAfter,
      code: 'QUOTA_EXCEEDED'
    });
  }
  
  next();
};

// 🔄 MIDDLEWARE EXPRESS PARA IDEMPOTENCY
export const idempotencyMiddleware = (req: any, res: any, next: any) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  
  if (!idempotencyKey) {
    // Idempotency opcional
    return next();
  }
  
  const existing = firebaseCostOptimizer.checkIdempotency(idempotencyKey);
  
  if (existing.exists) {
    console.log(`🔄 IDEMPOTENCY RETURN: ${idempotencyKey}`);
    return res.status(existing.statusCode || 200).json(existing.response);
  }
  
  // Salvar key para uso posterior
  req.idempotencyKey = idempotencyKey;
  
  // Interceptar response para salvar
  const originalJson = res.json;
  res.json = function(data: any) {
    // Salvar resposta idempotente apenas para métodos que modificam dados
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && res.statusCode >= 200 && res.statusCode < 300) {
      firebaseCostOptimizer.saveIdempotentResponse(idempotencyKey, data, res.statusCode);
    }
    return originalJson.call(this, data);
  };
  
  next();
};

// 💾 MIDDLEWARE EXPRESS PARA CACHE
export const cacheMiddleware = (ttl?: number) => {
  return (req: any, res: any, next: any) => {
    // Cache apenas para GET
    if (req.method !== 'GET') {
      return next();
    }
    
    const cacheKey = `${req.path}:${JSON.stringify(req.query)}:${req.user?.uid || 'anon'}`;
    const cached = firebaseCostOptimizer.getCached(cacheKey);
    
    if (cached) {
      console.log(`🚀 CACHE RETURN: ${cacheKey}`);
      return res.json(cached);
    }
    
    // Interceptar response para cache
    const originalJson = res.json;
    res.json = function(data: any) {
      // Cache apenas respostas de sucesso
      if (res.statusCode >= 200 && res.statusCode < 300) {
        firebaseCostOptimizer.setCached(cacheKey, data, ttl);
      }
      return originalJson.call(this, data);
    };
    
    next();
  };
};

export { firebaseCostOptimizer, FirebaseCostOptimizer, FIREBASE_QUOTAS, CACHE_TTL_CONFIG };