// 🚀 CONFIGURAÇÃO DE PERFORMANCE PARA MILHÕES DE TRANSAÇÕES
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import helmet from 'helmet';

// Silences ERR_ERL_PERMISSIVE_TRUST_PROXY on GCE/Replit
const rlValidate = { trustProxy: false };

// 🔒 RATE LIMITING INDUSTRIAL
export const createRateLimit = () => {
  return rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5000,
    message: { error: 'Sistema ocupado. Tente novamente.', retryAfter: 10 },
    standardHeaders: true,
    legacyHeaders: false,
    validate: rlValidate,
    skip: (req) => {
      return req.path.includes('/webhook/') || req.path.includes('/api/webhook/');
    }
  });
};

// 🔒 RATE LIMITING ESPECIAL PARA WEBHOOKS
export const webhookRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10000,
  message: { error: 'Webhook rate limit exceeded' },
  standardHeaders: false,
  legacyHeaders: false,
  validate: rlValidate
});

// 🗜️ COMPRESSÃO AVANÇADA
export const compressionConfig = compression({
  level: 6, // Balanceamento entre velocidade e compressão
  threshold: 1024, // Comprimir apenas > 1KB
  filter: (req, res) => {
    // Não comprimir webhooks (performance)
    if (req.path.includes('/webhook/')) return false;
    return compression.filter(req, res);
  }
});

// 🛡️ SEGURANÇA INDUSTRIAL
export const helmetConfig = helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'"]
    }
  }
});

// 🎯 GERADOR DE IDS ÚNICOS PARA ALTA ESCALA - COMPATÍVEL COM FRONTEND
export const generateUniqueOrderId = () => {
  const timestamp = Date.now();
  const random1 = Math.random().toString(36).substr(2, 12); // Compatível com frontend
  const random2 = Math.random().toString(36).substr(2, 12);
  const performanceStr = Math.floor(performance.now() * 1000).toString().replace('.', '');
  
  return `order_${timestamp}_${random1}_${random2}_${performanceStr}`;
};

// 📊 MÉTRICAS DE PERFORMANCE
export const performanceMetrics = {
  requestCount: 0,
  webhookCount: 0,
  errorCount: 0,
  
  increment: (type: 'request' | 'webhook' | 'error') => {
    performanceMetrics[`${type}Count`]++;
  },
  
  getStats: () => ({
    requests: performanceMetrics.requestCount,
    webhooks: performanceMetrics.webhookCount,
    errors: performanceMetrics.errorCount,
    uptime: process.uptime()
  })
};