// 🛡️ CONFIGURAÇÃO CENTRAL DE SEGURANÇA
// Orquestração completa de todas as camadas de proteção

import { distributedRateLimitMiddleware } from './distributed-rate-limiter';
import { botDetectionMiddleware, criticalFormBotDetection } from './bot-detection';
import { quotaMiddleware, idempotencyMiddleware, cacheMiddleware } from './firebase-cost-optimizer';
import { documentUniquenessMiddleware } from './cpf-cnpj-uniqueness';
import { requestValidationMiddleware, strictValidationMiddleware } from './request-validator';

// 🎯 POLÍTICAS DE SEGURANÇA POR ENDPOINT
interface SecurityPolicy {
  rateLimiting: 'none' | 'standard' | 'strict' | 'critical';
  botDetection: 'none' | 'standard' | 'strict' | 'critical';
  validation: 'none' | 'standard' | 'strict';
  quota: boolean;
  idempotency: boolean;
  cache: boolean | number; // false, true, or TTL in ms
  documentUniqueness: boolean;
  customMiddlewares?: any[];
}

// 📋 CONFIGURAÇÃO DEVASTADORA DE POLÍTICAS
export const SECURITY_POLICIES: { [endpoint: string]: SecurityPolicy } = {
  // 💰 ENDPOINTS DE PAGAMENTO - SEGURANÇA MÁXIMA
  '/api/payment/create-session': {
    rateLimiting: 'critical',
    botDetection: 'critical',
    validation: 'strict',
    quota: true,
    idempotency: true,
    cache: false, // Nunca cachear pagamentos
    documentUniqueness: false
  },
  
  // 👤 REGISTRO DE SELLERS - MUITO CRÍTICO
  '/api/sellers/register': {
    rateLimiting: 'critical',
    botDetection: 'critical',
    validation: 'strict',
    quota: true,
    idempotency: true,
    cache: false,
    documentUniqueness: true // Verificar CPF/CNPJ único
  },
  
  // 📁 UPLOAD DE ARQUIVOS - RIGOROSO
  '/api/objects/upload': {
    rateLimiting: 'strict',
    botDetection: 'strict',
    validation: 'strict',
    quota: true,
    idempotency: false, // Upload pode ser repetido
    cache: false,
    documentUniqueness: false
  },
  
  // 🏪 CRIAÇÃO DE PRODUTOS - MODERADO
  '/api/products': {
    rateLimiting: 'standard',
    botDetection: 'standard',
    validation: 'strict',
    quota: true,
    idempotency: true,
    cache: false,
    documentUniqueness: false
  },
  
  // 🛒 CHECKOUTS - MODERADO
  '/api/checkouts': {
    rateLimiting: 'standard',
    botDetection: 'standard',
    validation: 'strict',
    quota: true,
    idempotency: true,
    cache: 5 * 60 * 1000, // Cache 5 minutos
    documentUniqueness: false
  },
  
  // 🎫 SUPORTE - MODERADO
  '/api/support/tickets': {
    rateLimiting: 'standard',
    botDetection: 'strict',
    validation: 'strict',
    quota: true,
    idempotency: true,
    cache: false,
    documentUniqueness: false
  },
  
  // 🔄 WEBHOOKS - FLEXÍVEL MAS PROTEGIDO
  '/webhook/efi': {
    rateLimiting: 'standard',
    botDetection: 'none', // Webhooks legítimos podem parecer bots
    validation: 'standard',
    quota: true,
    idempotency: true,
    cache: false,
    documentUniqueness: false
  },
  
  // 🔒 ENDPOINTS ADMIN - SEGURANÇA ALTA
  '/api/admin/*': {
    rateLimiting: 'strict',
    botDetection: 'standard',
    validation: 'strict',
    quota: true,
    idempotency: false, // Admin pode repetir operações
    cache: 2 * 60 * 1000, // Cache 2 minutos
    documentUniqueness: false
  },
  
  // 📊 CONSULTAS GERAIS - CACHE AGRESSIVO
  '/api/sellers': {
    rateLimiting: 'standard',
    botDetection: 'standard',
    validation: 'standard',
    quota: true,
    idempotency: false,
    cache: 10 * 60 * 1000, // Cache 10 minutos
    documentUniqueness: false
  },
  
  '/api/orders': {
    rateLimiting: 'standard',
    botDetection: 'standard',
    validation: 'standard',
    quota: true,
    idempotency: false,
    cache: 2 * 60 * 1000, // Cache 2 minutos
    documentUniqueness: false
  },
  
  '/api/subscriptions': {
    rateLimiting: 'standard',
    botDetection: 'standard',
    validation: 'standard',
    quota: true,
    idempotency: false,
    cache: 5 * 60 * 1000, // Cache 5 minutos
    documentUniqueness: false
  }
};

// 🏭 FACTORY DE MIDDLEWARES
export class SecurityMiddlewareFactory {
  
  // 🛡️ CRIAR RATE LIMITING BASEADO NA POLÍTICA (DISTRIBUÍDO)
  static createRateLimitMiddleware(policy: SecurityPolicy['rateLimiting'], endpoint?: string) {
    switch (policy) {
      case 'critical':
      case 'strict':
      case 'standard':
        return distributedRateLimitMiddleware; // Usar sempre o distribuído
      case 'none':
      default:
        return (req: any, res: any, next: any) => next();
    }
  }
  
  // 🤖 CRIAR BOT DETECTION BASEADO NA POLÍTICA
  static createBotDetectionMiddleware(policy: SecurityPolicy['botDetection']) {
    switch (policy) {
      case 'critical':
        return criticalFormBotDetection;
      case 'strict':
      case 'standard':
        return botDetectionMiddleware;
      case 'none':
      default:
        return (req: any, res: any, next: any) => next();
    }
  }
  
  // ✅ CRIAR VALIDAÇÃO BASEADA NA POLÍTICA
  static createValidationMiddleware(policy: SecurityPolicy['validation'], endpoint?: string) {
    switch (policy) {
      case 'strict':
        return endpoint ? strictValidationMiddleware(endpoint as any) : requestValidationMiddleware();
      case 'standard':
        return requestValidationMiddleware();
      case 'none':
      default:
        return (req: any, res: any, next: any) => next();
    }
  }
  
  // 💾 CRIAR CACHE BASEADO NA POLÍTICA
  static createCacheMiddleware(cacheConfig: SecurityPolicy['cache']) {
    if (cacheConfig === false) {
      return (req: any, res: any, next: any) => next();
    }
    
    if (cacheConfig === true) {
      return cacheMiddleware();
    }
    
    if (typeof cacheConfig === 'number') {
      return cacheMiddleware(cacheConfig);
    }
    
    return (req: any, res: any, next: any) => next();
  }
  
  // 🔗 CRIAR CONJUNTO COMPLETO DE MIDDLEWARES
  static createSecurityStack(endpoint: string): any[] {
    // Buscar política (com wildcard matching)
    let policy: SecurityPolicy | undefined;
    
    for (const [pattern, policyConfig] of Object.entries(SECURITY_POLICIES)) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (endpoint.startsWith(prefix)) {
          policy = policyConfig;
          break;
        }
      } else if (pattern === endpoint) {
        policy = policyConfig;
        break;
      }
    }
    
    // Política padrão se não encontrar
    if (!policy) {
      policy = {
        rateLimiting: 'standard',
        botDetection: 'standard',
        validation: 'standard',
        quota: true,
        idempotency: false,
        cache: false,
        documentUniqueness: false
      };
    }
    
    console.log(`🛡️ CREATING SECURITY STACK: ${endpoint} - Policy: ${JSON.stringify(policy)}`);
    
    const middlewares: any[] = [];
    
    // 1️⃣ Rate Limiting (primeiro para bloquear rapidamente)
    if (policy.rateLimiting !== 'none') {
      middlewares.push(this.createRateLimitMiddleware(policy.rateLimiting, endpoint));
    }
    
    // 2️⃣ Bot Detection (antes de processar dados)
    if (policy.botDetection !== 'none') {
      middlewares.push(this.createBotDetectionMiddleware(policy.botDetection));
    }
    
    // 3️⃣ Quota Firebase (antes de operações custosas)
    if (policy.quota) {
      middlewares.push(quotaMiddleware);
    }
    
    // 4️⃣ Validação (sanitizar e validar dados)
    if (policy.validation !== 'none') {
      middlewares.push(this.createValidationMiddleware(policy.validation, endpoint));
    }
    
    // 5️⃣ Document Uniqueness (para endpoints de registro)
    if (policy.documentUniqueness) {
      middlewares.push(documentUniquenessMiddleware);
    }
    
    // 6️⃣ Idempotency (para operações críticas)
    if (policy.idempotency) {
      middlewares.push(idempotencyMiddleware);
    }
    
    // 7️⃣ Cache (último, para interceptar responses)
    if (policy.cache !== false) {
      middlewares.push(this.createCacheMiddleware(policy.cache));
    }
    
    // 8️⃣ Middlewares customizados
    if (policy.customMiddlewares) {
      middlewares.push(...policy.customMiddlewares);
    }
    
    console.log(`✅ SECURITY STACK CREATED: ${endpoint} - ${middlewares.length} middlewares`);
    
    return middlewares;
  }
}

// 🎯 FUNÇÃO HELPER PARA APLICAR SEGURANÇA EM ROTA
export function secureEndpoint(endpoint: string) {
  return SecurityMiddlewareFactory.createSecurityStack(endpoint);
}

// 📊 FUNÇÃO PARA OBTER MÉTRICAS DE SEGURANÇA
export function getSecurityMetrics(): any {
  return {
    policies: Object.keys(SECURITY_POLICIES).length,
    endpoints: Object.keys(SECURITY_POLICIES),
    timestamp: new Date().toISOString()
  };
}

// 🔧 CONFIGURAÇÃO DE MIDDLEWARES GLOBAIS (ORDEM CORRETA)
export const GLOBAL_SECURITY_MIDDLEWARES = [
  // 1. Headers de segurança básicos
  (req: any, res: any, next: any) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com https://apis.google.com https://*.google.com https://*.googleapis.com https://*.gstatic.com https://*.firebaseio.com https://connect.facebook.net https://cdn.jsdelivr.net https://unpkg.com https://raw.githubusercontent.com https://replit.com https://*.replit.com https://www.youtube.com https://www.youtube-nocookie.com https://s.ytimg.com https://player.vimeo.com https://*.pandavideo.com.br; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; media-src 'self' blob: https:; connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://m.stripe.com https://apis.google.com https://*.google.com https://*.googleapis.com wss: https:; frame-src 'self' https://*.pandavideo.com.br https://*.firebaseio.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://js.stripe.com https://checkout.stripe.com https://accounts.google.com https://*.google.com https://iframe.mediadelivery.net https://*.mediadelivery.net;",
      'Permissions-Policy': 'payment=*, geolocation=(self), microphone=(), camera=(self)'
    });
    next();
  },
  
  // 2. Rate limiting global básico (já existe no index.ts)
  // 3. Bot detection global básico (já existe no index.ts)
  // 4. Autenticação Firebase (já existe no index.ts)
];

// 🚀 INICIALIZAÇÃO AUTOMÁTICA
export function initializeSecurity() {
  console.log('🛡️ INITIALIZING ADVANCED SECURITY SYSTEM...');
  console.log(`📋 LOADED ${Object.keys(SECURITY_POLICIES).length} SECURITY POLICIES`);
  console.log('✅ SECURITY SYSTEM READY');
}

export default {
  SECURITY_POLICIES,
  SecurityMiddlewareFactory,
  secureEndpoint,
  getSecurityMetrics,
  initializeSecurity
};