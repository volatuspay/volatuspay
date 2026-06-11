// 🛡️ SISTEMA DEVASTADOR DE RATE LIMITING DISTRIBUÍDO
// Proteção usando Firestore para escalabilidade e persistência

import { storage } from '../storage';

interface RateLimitRule {
  requests: number;
  window: number;
  blockDuration: number;
}

interface DistributedBucket {
  tokens: number;
  resetTime: number;
  blocked: boolean;
  blockUntil: number;
  lastUpdate: number;
}

// 🧠 ENGINE DISTRIBUÍDO DE RATE LIMITING
class DistributedRateLimiter {
  private readonly collectionName = 'security_rate_limits';
  
  // 🔥 VERIFICAR E ATUALIZAR LIMITE NO FIRESTORE
  async checkLimit(key: string, rule: RateLimitRule): Promise<{ allowed: boolean; retryAfter?: number; remaining?: number }> {
    const now = Date.now();
    
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        console.error('❌ Firebase not connected for rate limiting');
        return { allowed: true }; // Fail-open em caso de erro
      }
      
      // 🔄 USAR TRANSAÇÃO PARA ATOMICIDADE
      const result = await firebaseStorage.db.runTransaction(async (transaction: any) => {
        const bucketRef = firebaseStorage.db.collection(this.collectionName).doc(key);
        const bucketDoc = await transaction.get(bucketRef);
        
        let bucket: DistributedBucket;
        
        // Criar novo bucket se não existir ou expirou
        if (!bucketDoc.exists || bucketDoc.data().resetTime <= now) {
          bucket = {
            tokens: rule.requests - 1, // Consumir 1 token
            resetTime: now + rule.window,
            blocked: false,
            blockUntil: 0,
            lastUpdate: now
          };
          
          transaction.set(bucketRef, bucket);
          return {
            allowed: true,
            remaining: bucket.tokens
          };
        }
        
        bucket = bucketDoc.data() as DistributedBucket;
        
        // ⛔ VERIFICAR SE ESTÁ BLOQUEADO
        if (bucket.blocked && bucket.blockUntil > now) {
          return {
            allowed: false,
            retryAfter: Math.ceil((bucket.blockUntil - now) / 1000)
          };
        }
        
        // 🔄 RESETAR BLOQUEIO SE EXPIROU
        if (bucket.blocked && bucket.blockUntil <= now) {
          bucket.blocked = false;
          bucket.tokens = rule.requests;
          bucket.resetTime = now + rule.window;
        }
        
        // ✅ VERIFICAR SE TEM TOKENS DISPONÍVEIS
        if (bucket.tokens > 0) {
          bucket.tokens--;
          bucket.lastUpdate = now;
          
          transaction.update(bucketRef, {
            tokens: bucket.tokens,
            lastUpdate: bucket.lastUpdate,
            blocked: bucket.blocked
          });
          
          return {
            allowed: true,
            remaining: bucket.tokens
          };
        }
        
        // ❌ SEM TOKENS - BLOQUEAR
        bucket.blocked = true;
        bucket.blockUntil = now + rule.blockDuration;
        bucket.lastUpdate = now;
        
        transaction.update(bucketRef, {
          blocked: bucket.blocked,
          blockUntil: bucket.blockUntil,
          lastUpdate: bucket.lastUpdate
        });
        
        return {
          allowed: false,
          retryAfter: Math.ceil(rule.blockDuration / 1000)
        };
      });
      
      return result;
      
    } catch (error: any) {
      console.error(`❌ Rate limit check error for key ${key}:`, error);
      // Fail-open em caso de erro para não quebrar o sistema
      return { allowed: true };
    }
  }
  
  // 🧹 LIMPEZA AUTOMÁTICA DE BUCKETS EXPIRADOS
  async cleanup(): Promise<number> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return 0;
      
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 horas
      
      // Buscar buckets antigos
      const snapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .where('lastUpdate', '<', now - maxAge)
        .limit(100)
        .get();
      
      if (snapshot.empty) return 0;
      
      // Deletar em batch
      const batch = firebaseStorage.db.batch();
      snapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      console.log(`🧹 RATE LIMITER CLEANUP: Removed ${snapshot.docs.length} expired buckets`);
      return snapshot.docs.length;
      
    } catch (error: any) {
      console.error('❌ Rate limiter cleanup error:', error);
      return 0;
    }
  }
  
  // 📊 OBTER ESTATÍSTICAS
  async getStats(): Promise<{ totalBuckets: number; blockedBuckets: number }> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) return { totalBuckets: 0, blockedBuckets: 0 };
      
      const now = Date.now();
      
      // Total de buckets ativos
      const totalSnapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .where('lastUpdate', '>', now - 24 * 60 * 60 * 1000)
        .get();
      
      // Buckets bloqueados
      const blockedSnapshot = await firebaseStorage.db
        .collection(this.collectionName)
        .where('blocked', '==', true)
        .where('blockUntil', '>', now)
        .get();
      
      return {
        totalBuckets: totalSnapshot.size,
        blockedBuckets: blockedSnapshot.size
      };
      
    } catch (error: any) {
      console.error('❌ Rate limiter stats error:', error);
      return { totalBuckets: 0, blockedBuckets: 0 };
    }
  }
}

// 🎯 SINGLETON GLOBAL
const distributedRateLimiter = new DistributedRateLimiter();

// Limpeza automática a cada hora
setInterval(() => {
  distributedRateLimiter.cleanup();
}, 60 * 60 * 1000);

// 🛡️ MIDDLEWARE EXPRESS DISTRIBUÍDO
export const distributedRateLimitMiddleware = async (req: any, res: any, next: any) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.uid;
    const tenantId = req.user?.tenantId || req.body?.tenantId || req.query?.tenantId;
    const endpoint = req.route?.path || req.path;
    
    // Pular rate limiting para assets estáticos (imagens, CSS, JS, fontes, etc)
    const isStaticAsset = endpoint && (
      endpoint.includes('/assets/') ||
      endpoint.includes('/node_modules/') ||
      endpoint.includes('/@fs/') ||
      endpoint.includes('.js') ||
      endpoint.includes('.css') ||
      endpoint.includes('.png') ||
      endpoint.includes('.jpg') ||
      endpoint.includes('.svg') ||
      endpoint.includes('.woff') ||
      endpoint.includes('.ttf') ||
      endpoint.includes('/src/')
    );
    
    if (isStaticAsset) {
      return next(); // Não rate limitar assets
    }
    
    // Configuração básica de limites (SUAVIZADA para mobile)
    const basicRule: RateLimitRule = {
      requests: userId ? 500 : 250,     // Mobile faz MUITAS requisições simultâneas
      window: 60 * 1000,              // 1 minuto
      blockDuration: userId ? 1 * 60 * 1000 : 2 * 60 * 1000 // Bloqueio mais curto
    };
    
    // 🔍 VERIFICAR MÚLTIPLAS CAMADAS
    const checks = [
      { key: `ip:${ip}`, rule: basicRule },
      ...(userId ? [{ key: `user:${userId}`, rule: { ...basicRule, requests: 800 } }] : []),
      ...(tenantId ? [{ key: `tenant:${tenantId}`, rule: { ...basicRule, requests: 2000 } }] : [])
    ];
    
    for (const check of checks) {
      const result = await distributedRateLimiter.checkLimit(check.key, check.rule);
      
      if (!result.allowed) {
        console.log(`❌ DISTRIBUTED RATE LIMIT: ${check.key} blocked`);
        
        res.set({
          'X-RateLimit-Limit': check.rule.requests.toString(),
          'X-RateLimit-Remaining': '0',
          'Retry-After': result.retryAfter?.toString() || '300'
        });
        
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests, please try again later',
          retryAfter: result.retryAfter,
          code: 'DISTRIBUTED_RATE_LIMIT_EXCEEDED'
        });
      }
      
      // Adicionar headers informativos
      if (result.remaining !== undefined) {
        res.set('X-RateLimit-Remaining', result.remaining.toString());
      }
    }
    
    next();
    
  } catch (error: any) {
    console.error('❌ Distributed rate limit middleware error:', error);
    // Fail-open em caso de erro
    next();
  }
};

export { distributedRateLimiter, DistributedRateLimiter };