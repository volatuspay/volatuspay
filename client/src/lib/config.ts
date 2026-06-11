/**
 * CONFIGURAÇÃO OFICIAL ZEN PAGAMENTOS / ZENPAGAMENTOS.COM
 * 
 * Domnio oficial para todas as operaes da plataforma.
 * Este arquivo centraliza todas as URLs para garantir consistncia.
 */

// DETECÇÃO AUTOMTICA DE AMBIENTE
const isDevelopment = () => {
  if (typeof window === 'undefined') return true; // SSR = desenvolvimento
  const hostname = window.location.hostname;
  const port = window.location.port;
  
  const isDev = hostname === 'localhost' || 
         hostname === '127.0.0.1' ||
         hostname.includes('replit') ||
         hostname.includes('.replit.app') ||
         hostname.includes('replit.') ||
         hostname.endsWith('-5000.replit.dev') ||
         port === '5000';
         
  console.log('isDevelopment():', { hostname, port, isDev });
  return isDev;
};

// BASE URL DINMICA (DEV vs PROD)
const getBaseUrl = () => {
  if (typeof window === 'undefined') {
    return ''; // SSR
  }
  
  const hostname = window.location.hostname;
  
  // SEMPRE usar URLs relativas quando estamos no prprio domnio
  // Isso funciona tanto em dev quanto em produção
  console.log('Using relative URLs for:', hostname);
  return '';
};

// Domínio oficial da plataforma — configurável via env var (white-label)
const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN || window.location.hostname;

export const APP_CONFIG = {
  // Domínio oficial da plataforma  
  DOMAIN: PLATFORM_DOMAIN,
  BASE_URL: getBaseUrl(),
  
  // URLs de API (dinmicas baseadas no ambiente)
  API_BASE: getBaseUrl(),
  
  // Verificar ambiente
  isDevelopment,
  getBaseUrl,
  
  // URLs SENSVEIS - Nunca exibir no console/DevTools
  SENSITIVE_DOMAINS: [
    'replit.com',
    'replit.app',
    'replit.dev',
    'repl.co',
    'js.stripe.com',
    'stripe.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ],
  
  // URLs de Checkout — baseadas no domínio configurado
  getCheckoutUrl: (slug: string, id?: string) => {
    return `https://${PLATFORM_DOMAIN}/c/${slug}`;
  },
  
  // URLs de Sucesso/Redirecionamento - dinmicas
  getSuccessUrl: (path?: string) => `${getBaseUrl()}${path || '/success'}`,
  
  // URLs do Dashboard - dinmicas
  getDashboardUrl: (path?: string) => `${getBaseUrl()}/dashboard${path || ''}`,
  
  // API URLs - sempre dinmicas baseadas no ambiente
  getApiUrl: (endpoint: string) => `${getBaseUrl()}${endpoint}`,
  
  // URLs de Compartilhamento (WhatsApp, Telegram, etc.)
  getWhatsAppUrl: (slug: string, id?: string) => {
    const checkoutUrl = `https://${PLATFORM_DOMAIN}/c/${slug}`;
    return `https://wa.me/?text=${encodeURIComponent(`Confira este checkout: ${checkoutUrl}`)}`;
  },
  
  getTelegramUrl: (slug: string, id?: string) => {
    const checkoutUrl = `https://${PLATFORM_DOMAIN}/c/${slug}`;
    return `https://t.me/share/url?url=${encodeURIComponent(checkoutUrl)}`;
  },
  
  // URL completa da aplicao
  getAppUrl: (path?: string) => `https://${PLATFORM_DOMAIN}${path || ''}`,
  
  // Verificar se estamos no domínio oficial
  isOfficialDomain: () => {
    if (typeof window === 'undefined') return true; // SSR
    return window.location.hostname === PLATFORM_DOMAIN;
  }
};

// CONFIGURAÇÃO DE PROTEÇÃO MILITAR
export const PROTECTION_CONFIG = {
  ANTI_INSPECTION_ENABLED: true, // ATIVADO PARA TESTE MILITAR!
  DEVTOOLS_DETECTION_ENABLED: true,
  CONSOLE_BLOCKING_ENABLED: true,
  AI_MONITORING_ENABLED: true,
  AUTO_REDIRECT_ENABLED: true,
  CODE_OBFUSCATION_ENABLED: true,
  SECURITY_REPORTS_ENABLED: true,
  FORCE_PRODUCTION_MODE: false // Forar modo produção mesmo em dev (para testes de segurana)
};