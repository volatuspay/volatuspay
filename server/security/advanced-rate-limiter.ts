// 🛡️ SISTEMA AVANÇADO DE RATE LIMITING ADAPTATIVO
// Proteção devastadora contra flood, farm e abusos com múltiplas camadas

interface RateLimitRule {
  requests: number;      // Número máximo de requests
  window: number;        // Janela de tempo em milissegundos
  blockDuration: number; // Duração do bloqueio em milissegundos
}

interface RateLimitConfig {
  // Limitações por IP (mais leniente para usuários legítimos)
  ip: {
    anonymous: RateLimitRule;
    authenticated: RateLimitRule;
  };
  
  // Limitações por usuário autenticado (mais rigoroso)
  user: {
    standard: RateLimitRule;
    admin: RateLimitRule;
  };
  
  // Limitações por tenant (proteção contra abuse de organizações)
  tenant: RateLimitRule;
  
  // Limitações por endpoint específico
  endpoints: {
    [key: string]: RateLimitRule;
  };
}

// ✅ CONFIGURAÇÃO PERMISSIVA - FOCO EM INVASÕES REAIS, NÃO NAVEGAÇÃO NORMAL
const RATE_LIMIT_CONFIG: RateLimitConfig = {
  ip: {
    // IPs anônimos: ainda controlado mas muito mais permissivo
    anonymous: {
      requests: 300,          // 300 requests (era 50)
      window: 60 * 1000,      // por minuto
      blockDuration: 2 * 60 * 1000 // bloqueio 2 minutos (era 5min)
    },
    // IPs autenticados: MUITO PERMISSIVO para navegação normal
    authenticated: {
      requests: 2500,         // 2500 requests (era 200) - SPAs fazem muitos requests
      window: 60 * 1000,      // por minuto
      blockDuration: 1 * 60 * 1000 // bloqueio 1 minuto (era 2min)
    }
  },
  
  user: {
    // Usuários padrão: MUITO PERMISSIVO
    standard: {
      requests: 8000,         // 8000 requests (era 300) - dashboards carregam muitos dados
      window: 5 * 60 * 1000,  // por 5 minutos
      blockDuration: 5 * 60 * 1000 // bloqueio 5 minutos (era 10min)
    },
    // Admins: SUPER PERMISSIVO (precisam de acesso total)
    admin: {
      requests: 5000,         // 5000 requests (era 200)
      window: 60 * 1000,      // por 1 minuto
      blockDuration: 1 * 60 * 1000 // bloqueio 1 minuto (era 2min)
    }
  },
  
  // Limite por tenant: muito permissivo
  tenant: {
    requests: 10000,          // 10000 requests por tenant (era 1000)
    window: 10 * 60 * 1000,   // por 10 minutos
    blockDuration: 10 * 60 * 1000 // bloqueio 10 minutos (era 30min)
  },
  
  // 🎯 ENDPOINTS CRÍTICOS - PERMISSIVOS PARA RETRIES LEGÍTIMAS
  endpoints: {
    // Pagamentos: permite retries de checkout
    '/api/payment/create-session': {
      requests: 60,           // 60 tentativas (era 10) - usuários retentam checkout
      window: 10 * 60 * 1000, // por 10 minutos
      blockDuration: 10 * 60 * 1000 // bloqueio 10 minutos (era 30min)
    },
    
    // Upload de arquivos: muito mais permissivo
    '/api/objects/upload': {
      requests: 200,          // 200 uploads (era 20) - produtos com múltiplas imagens
      window: 10 * 60 * 1000, // por 10 minutos
      blockDuration: 5 * 60 * 1000 // bloqueio 5 minutos (era 15min)
    },
    
    // Registro de sellers: um pouco mais permissivo
    '/api/sellers/register': {
      requests: 10,           // 10 tentativas (era 3) - permite erros de formulário
      window: 60 * 60 * 1000, // por hora
      blockDuration: 30 * 60 * 1000 // bloqueio 30 minutos (era 1h)
    },
    
    // Webhooks: muito permissivo (rajadas legítimas)
    '/webhook/efi': {
      requests: 500,          // 500 webhooks (era 100) - pode receber múltiplos de uma vez
      window: 5 * 60 * 1000,  // por 5 minutos
      blockDuration: 5 * 60 * 1000 // bloqueio 5 minutos (era 10min)
    }
  }
};

// 🧠 TOKEN BUCKET + SLIDING WINDOW HÍBRIDO
class AdvancedRateLimiter {
  private ipBuckets = new Map<string, any>();
  private userBuckets = new Map<string, any>();
  private tenantBuckets = new Map<string, any>();
  private endpointBuckets = new Map<string, any>();
  
  // 🔥 CLEANUP AUTOMÁTICO PARA EVITAR MEMORY LEAK
  private cleanupInterval: NodeJS.Timeout;
  
  constructor() {
    // Limpar buckets expirados a cada 5 minutos
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredBuckets();
    }, 5 * 60 * 1000);
  }
  
  private cleanupExpiredBuckets() {
    const now = Date.now();
    const maps = [this.ipBuckets, this.userBuckets, this.tenantBuckets, this.endpointBuckets];
    
    maps.forEach(map => {
      for (const [key, bucket] of map.entries()) {
        if (bucket.resetTime < now) {
          map.delete(key);
        }
      }
    });
  }
  
  // 🛡️ VERIFICAR LIMITE COM SLIDING WINDOW + TOKEN BUCKET
  private checkLimit(bucketMap: Map<string, any>, key: string, rule: RateLimitRule): { allowed: boolean; retryAfter?: number; remaining?: number } {
    const now = Date.now();
    let bucket = bucketMap.get(key);
    
    // Criar novo bucket se não existir ou expirou
    if (!bucket || bucket.resetTime <= now) {
      bucket = {
        tokens: rule.requests,
        resetTime: now + rule.window,
        blocked: false,
        blockUntil: 0
      };
      bucketMap.set(key, bucket);
    }
    
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
      return {
        allowed: true,
        remaining: bucket.tokens
      };
    }
    
    // ❌ SEM TOKENS - BLOQUEAR
    bucket.blocked = true;
    bucket.blockUntil = now + rule.blockDuration;
    
    return {
      allowed: false,
      retryAfter: Math.ceil(rule.blockDuration / 1000)
    };
  }
  
  // 🎯 VERIFICAÇÃO PRINCIPAL - MÚLTIPLAS CAMADAS
  checkRequest(req: any): { allowed: boolean; reason?: string; retryAfter?: number; remaining?: number } {
    const ip = this.getClientIP(req);
    
    // 🟢 WHITELIST DE IPs CONFIÁVEIS - NUNCA APLICAR RATE LIMIT
    const trustedIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '160.20.87.98', '160.20.87.146'];
    const isReplitSubnet = /^160\.20\./.test(ip) || /^100\.64\./.test(ip);
    if (trustedIPs.includes(ip) || isReplitSubnet) {
      console.log(`🟢 IP CONFIÁVEL ${ip} - Rate limit DESABILITADO`);
      return { allowed: true, remaining: 999999 };
    }
    
    const userId = req.user?.uid;
    const tenantId = req.user?.tenantId || req.body?.tenantId || req.query?.tenantId;
    const endpoint = req.route?.path || req.path;
    const isAdmin = this.isAdmin(req);
    
    // 📊 LOG DE MONITORAMENTO
    console.log(`🛡️ RATE LIMIT CHECK: IP=${ip} User=${userId} Tenant=${tenantId} Endpoint=${endpoint} Admin=${isAdmin}`);
    
    // 1️⃣ VERIFICAR LIMITE POR IP
    const ipRule = userId ? RATE_LIMIT_CONFIG.ip.authenticated : RATE_LIMIT_CONFIG.ip.anonymous;
    const ipCheck = this.checkLimit(this.ipBuckets, ip, ipRule);
    if (!ipCheck.allowed) {
      console.log(`❌ RATE LIMIT BLOCKED BY IP: ${ip} - Retry after ${ipCheck.retryAfter}s`);
      return { allowed: false, reason: 'IP rate limit exceeded', retryAfter: ipCheck.retryAfter };
    }
    
    // 2️⃣ VERIFICAR LIMITE POR USUÁRIO (se autenticado)
    if (userId) {
      const userRule = isAdmin ? RATE_LIMIT_CONFIG.user.admin : RATE_LIMIT_CONFIG.user.standard;
      const userCheck = this.checkLimit(this.userBuckets, userId, userRule);
      if (!userCheck.allowed) {
        console.log(`❌ RATE LIMIT BLOCKED BY USER: ${userId} - Retry after ${userCheck.retryAfter}s`);
        return { allowed: false, reason: 'User rate limit exceeded', retryAfter: userCheck.retryAfter };
      }
    }
    
    // 3️⃣ VERIFICAR LIMITE POR TENANT (se disponível)
    if (tenantId) {
      const tenantCheck = this.checkLimit(this.tenantBuckets, tenantId, RATE_LIMIT_CONFIG.tenant);
      if (!tenantCheck.allowed) {
        console.log(`❌ RATE LIMIT BLOCKED BY TENANT: ${tenantId} - Retry after ${tenantCheck.retryAfter}s`);
        return { allowed: false, reason: 'Tenant rate limit exceeded', retryAfter: tenantCheck.retryAfter };
      }
    }
    
    // 4️⃣ VERIFICAR LIMITE POR ENDPOINT ESPECÍFICO
    if (RATE_LIMIT_CONFIG.endpoints[endpoint]) {
      const endpointKey = `${endpoint}:${ip}:${userId || 'anon'}`;
      const endpointCheck = this.checkLimit(this.endpointBuckets, endpointKey, RATE_LIMIT_CONFIG.endpoints[endpoint]);
      if (!endpointCheck.allowed) {
        console.log(`❌ RATE LIMIT BLOCKED BY ENDPOINT: ${endpoint} - Key=${endpointKey} - Retry after ${endpointCheck.retryAfter}s`);
        return { allowed: false, reason: `Endpoint ${endpoint} rate limit exceeded`, retryAfter: endpointCheck.retryAfter };
      }
    }
    
    // ✅ TUDO LIBERADO
    console.log(`✅ RATE LIMIT ALLOWED: IP=${ip} User=${userId} Tenant=${tenantId} Endpoint=${endpoint}`);
    return { allowed: true, remaining: ipCheck.remaining };
  }
  
  // 🔍 EXTRAIR IP REAL DO CLIENTE
  private getClientIP(req: any): string {
    return req.ip || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           'unknown';
  }
  
  // 👑 VERIFICAR SE É ADMIN (VIA CUSTOM CLAIMS - SEGURO)
  private isAdmin(req: any): boolean {
    return req.user?.isAdmin || req.authUser?.isAdmin || false;
  }
  
  // 🧹 CLEANUP MANUAL
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// 🎯 SINGLETON GLOBAL
const advancedRateLimiter = new AdvancedRateLimiter();

// 🛡️ MIDDLEWARE EXPRESS 
export const advancedRateLimitMiddleware = (req: any, res: any, next: any) => {
  const result = advancedRateLimiter.checkRequest(req);
  
  if (!result.allowed) {
    // 📊 HEADERS DE RATE LIMITING PADRÃO
    res.set({
      'X-RateLimit-Limit': 'Variable',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': new Date(Date.now() + (result.retryAfter! * 1000)).toISOString(),
      'Retry-After': result.retryAfter!.toString()
    });
    
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: result.reason,
      retryAfter: result.retryAfter,
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
  
  // ✅ ADICIONAR HEADERS INFORMATIVOS
  if (result.remaining !== undefined) {
    res.set('X-RateLimit-Remaining', result.remaining.toString());
  }
  
  next();
};

// 🔥 MIDDLEWARE ESPECÍFICO PARA ENDPOINTS CRÍTICOS
export const criticalEndpointRateLimit = (endpointPath: string) => {
  return (req: any, res: any, next: any) => {
    // Override do path para forçar verificação específica
    req.route = { path: endpointPath };
    return advancedRateLimitMiddleware(req, res, next);
  };
};

export default advancedRateLimiter;