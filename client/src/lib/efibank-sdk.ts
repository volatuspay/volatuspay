// GERENCIADOR GLOBAL DO SDK EFIBANK
// Carregamento robusto e monitoramento de estado do SDK

export interface EfiBankSDK {
  CreditCard: {
    setAccount(payeeCode: string): any;
    setEnvironment(env: 'production' | 'sandbox'): any;
    setCreditCardData(data: {
      brand: string;
      number: string;
      cvv: string;
      expirationMonth: string;
      expirationYear: string;
      holderName: string;
      holderDocument: string;
      reuse: boolean;
    }): any;
    getPaymentToken(): Promise<{ payment_token: string; card_mask: string }>;
    verifyCardBrand(): Promise<string>;
    setCardNumber(number: string): any;
    isScriptBlocked?(): Promise<boolean>;
  };
}

declare global {
  interface Window {
    EfiPay?: EfiBankSDK;
  }
}

// ESTADO GLOBAL DO SDK
let sdkState = {
  loading: false,
  loaded: false,
  failed: false,
  lastError: undefined as string | undefined,
  loadAttempts: 0,
  lastLoadTime: undefined as number | undefined
};

// CDNs OFICIAIS EFIBANK - CONFORME DOCUMENTAÇÃO OFICIAL 2025
const SDK_URLS = [
  // URL OFICIAL PRINCIPAL (conforme documentação) - VERSÃO MAIS ESTVEL
  'https://unpkg.com/payment-token-efi@3.1.2/dist/payment-token-efi-umd.min.js',
  
  // URLs DE BACKUP - ORDENADAS POR CONFIABILIDADE
  'https://cdn.jsdelivr.net/npm/payment-token-efi@3.1.2/dist/payment-token-efi-umd.min.js',
  'https://cdn.jsdelivr.net/gh/efipay/js-payment-token-efi/dist/payment-token-efi-umd.min.js',
  
  // FALLBACK CDNs - MENOS CONFIVEL
  'https://raw.githubusercontent.com/efipay/js-payment-token-efi/main/dist/payment-token-efi-umd.min.js'
];

// VERIFICAR SE SDK ESTTOTALMENTE FUNCIONAL
export function isSDKReady(): boolean {
  return !!(window.EfiPay?.CreditCard?.setAccount && window.EfiPay?.CreditCard?.getPaymentToken);
}

// Funo removida - no utilizada mais no código

// OBTER STATUS ATUAL DO SDK
export function getSDKStatus() {
  return {
    ...sdkState,
    sdkReady: isSDKReady(),
    timestamp: Date.now()
  };
}

// CARREGAR SCRIPT DE URL ESPECFICA COM DETECÇÃO APRIMORADA PARA RESOLVER FINGERPRINT
async function loadScriptFromURL(url: string, timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    // LIMPEZA MAIS AGRESSIVA DE SCRIPTS ANTERIORES
    const existingScripts = document.querySelectorAll('script[src*="payment-token-efi"], script[src*="efipay"], script[src*="gerencianet"], script[data-sdk="efibank"]');
    existingScripts.forEach(s => {
      const scriptEl = s as HTMLScriptElement;
      console.log('Removendo script anterior:', scriptEl.src);
      scriptEl.remove();
    });
    
    // LIMPAR VARIVEIS GLOBAIS CONFLITANTES
    if (window.EfiPay) {
      console.log('Limpando EfiPay global anterior...');
      delete window.EfiPay;
    }
    
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.defer = false; // FORCE IMMEDIATE EXECUTION
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-sdk', 'efibank');
    script.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    script.setAttribute('data-url', url); // Para debug
    
    // TIMEOUT MAIS GENEROSO PARA RESOLVER FINGERPRINT
    const timeoutId = setTimeout(() => {
      console.error(`TIMEOUT: ${url} no carregou em ${timeout}ms`);
      script.remove();
      reject(new Error(`Timeout ao carregar ${url} após ${timeout}ms`));
    }, timeout);
    
    script.onload = () => {
      clearTimeout(timeoutId);
      console.log(`Script carregado: ${url}`);
      
      // VERIFICAÇÃO MAIS ROBUSTA PARA RESOLVER FINGERPRINT
      let checkAttempts = 0;
      const maxChecks = 20; // Aumentado para resolver fingerprint
      
      const checkSDK = () => {
        checkAttempts++;
        
        console.log(`Verificação ${checkAttempts}/${maxChecks} - SDK status:`, {
          hasEfiPay: !!window.EfiPay,
          hasCreditCard: !!window.EfiPay?.CreditCard,
          hasSetAccount: !!window.EfiPay?.CreditCard?.setAccount,
          hasGetPaymentToken: !!window.EfiPay?.CreditCard?.getPaymentToken,
          isReady: isSDKReady()
        });
        
        if (isSDKReady()) {
          console.log(`SDK EfBank carregado e funcional via: ${url}`);
          // AGUARDAR UM POUCO MAIS PARA GARANTIR ESTABILIDADE
          setTimeout(() => resolve(), 200);
        } else if (checkAttempts < maxChecks) {
          // AGUARDAR MAIS TEMPO ENTRE VERIFICAÇES
          setTimeout(checkSDK, 500);
        } else {
          console.error(`SDK carregado mas no funcional após ${maxChecks} verificaes via ${url}`);
          script.remove();
          reject(new Error(`SDK carregado mas no funcional após ${maxChecks} verificaes via ${url}`));
        }
      };
      
      // AGUARDAR MAIS ANTES DE INICIAR VERIFICAÇÃO
      setTimeout(checkSDK, 300);
    };
    
    script.onerror = (error) => {
      console.error(`Erro ao carregar script: ${url}`, error);
      clearTimeout(timeoutId);
      script.remove();
      reject(new Error(`Falha ao carregar ${url}: ${error}`));
    };
    
    console.log(`Iniciando carregamento: ${url}`);
    document.head.appendChild(script);
  });
}

// CARREGAMENTO PRINCIPAL DO SDK COM RETRY INTELIGENTE
export async function loadEfiBankSDK(forceReload = false): Promise<boolean> {
  // SE JESTCARREGADO E FUNCIONAL, RETORNAR
  if (!forceReload && isSDKReady()) {
    console.log('SDK EfBank jestcarregado e funcional');
    return true;
  }
  
  // SE JESTCARREGANDO, AGUARDAR
  if (sdkState.loading) {
    console.log('SDK EfBank jestsendo carregado, aguardando...');
    
    // OTIMIZADO: Aguardar até 5s (era 15s) - reduz bloqueio 66%
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!sdkState.loading || isSDKReady()) break;
    }
    
    return isSDKReady();
  }
  
  // INICIAR CARREGAMENTO
  sdkState.loading = true;
  sdkState.failed = false;
  sdkState.lastError = undefined;
  sdkState.loadAttempts++;
  sdkState.lastLoadTime = Date.now();
  
  console.log(`Iniciando carregamento EfBank SDK (tentativa ${sdkState.loadAttempts})...`);
  
  // TENTAR CARREGAR DE CADA CDN
  for (let i = 0; i < SDK_URLS.length; i++) {
    const url = SDK_URLS[i];
    console.log(`Tentativa ${i + 1}/${SDK_URLS.length}: ${url}`);
    
    try {
      await loadScriptFromURL(url, 8000);
      
      // SUCESSO!
      sdkState.loading = false;
      sdkState.loaded = true;
      sdkState.failed = false;
      
      console.log('SDK EfBank carregado com sucesso!');
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Falha na tentativa ${i + 1}: ${errorMessage}`);
      sdkState.lastError = errorMessage;
    }
  }
  
  // TODAS AS TENTATIVAS FALHARAM
  console.error('TODAS AS TENTATIVAS DE CARREGAMENTO FALHARAM');
  
  sdkState.loading = false;
  sdkState.loaded = false;
  sdkState.failed = true;
  
  // IMPLEMENTAR MOCK MNIMO PARA EVITAR QUEBRA
  if (!window.EfiPay) {
    console.log('Criando mock mnimo do SDK para evitar quebra total');
    window.EfiPay = {
      CreditCard: {
        setAccount: () => ({}),
        setEnvironment: () => ({}),
        setCreditCardData: () => ({}),
        setCardNumber: () => ({}),
        verifyCardBrand: () => Promise.resolve('unknown'),
        getPaymentToken: () => Promise.reject(new Error('SDK EfBank indisponível - usando fallback automático'))
      }
    };
  }
  
  console.log('Sistema de fallback automático ativado');
  return false;
}

// RETRY INTELIGENTE COM BACKOFF
export async function retrySDKLoad(maxRetries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`Retry ${attempt}/${maxRetries} do carregamento SDK...`);
    
    const success = await loadEfiBankSDK(true);
    if (success) return true;
    
    // Backoff exponencial: 2s, 4s, 8s
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Aguardando ${delay}ms antes do próximo retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return false;
}

// INICIALIZAÇÃO NICA E CONTROLADA
// Evita duplicação de carregamento
let initializationStarted = false;

export function initializeSDKOnce(): void {
  if (typeof window === 'undefined' || initializationStarted) {
    return;
  }
  
  initializationStarted = true;
  console.log('Iniciando carregamento nico do SDK EfBank...');
  
  // Aguardar DOM estar pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => loadEfiBankSDK(), 1000);
    });
  } else {
    // DOM jestpronto
    setTimeout(() => loadEfiBankSDK(), 1000);
  }
}

// FUNÇÃO EMERGENCIAL PARA RESOLVER ERRO DE FINGERPRINT - VERSÃO MELHORADA
export async function fixFingerprintError(): Promise<boolean> {
  console.log('CORRIGINDO ERRO DE FINGERPRINT - RESETANDO SISTEMA COMPLETAMENTE...');
  
  try {
    // LIMPEZA TOTAL E AGRESSIVA DO ESTADO
    initializationStarted = false;
    sdkState = {
      loading: false,
      loaded: false,
      failed: false,
      lastError: undefined,
      loadAttempts: 0,
      lastLoadTime: undefined
    };
    
    // REMOVER TODOS OS SCRIPTS DE EFIBANK EXISTENTES
    const scripts = document.querySelectorAll('script[data-sdk="efibank"], script[src*="payment-token-efi"], script[src*="efipay"], script[src*="gerencianet"]');
    console.log(`Removendo ${scripts.length} scripts existentes...`);
    scripts.forEach(script => {
      const scriptEl = script as HTMLScriptElement;
      console.log('Removendo script:', scriptEl.src);
      scriptEl.remove();
    });
    
    // LIMPAR WINDOW OBJECT COMPLETAMENTE
    if (window.EfiPay) {
      console.log('Limpando window.EfiPay...');
      delete window.EfiPay;
    }
    // Estado interno limpo via module reset
    
    // AGUARDAR LIMPEZA COMPLETA
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Iniciando carregamento emergencial do SDK...');
    
    // TENTAR CARREGAMENTO FORÇADO COM RETRY ULTRA-AGRESSIVO
    let attempts = 0;
    const maxAttempts = 8;
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Tentativa ${attempts}/${maxAttempts} de carregamento emergencial...`);
      
      try {
        // TENTAR CADA URL INDIVIDUALMENTE
        for (const url of SDK_URLS) {
          try {
            console.log(`Tentando URL: ${url}`);
            await loadScriptFromURL(url, 20000); // 20s timeout
            
            if (isSDKReady()) {
              console.log('PROBLEMA DE FINGERPRINT RESOLVIDO COM SUCESSO!');
              return true;
            }
          } catch (urlError) {
            console.warn(`URL ${url} falhou:`, urlError);
            continue;
          }
        }
        
        // AGUARDAR ANTES DA PRXIMA TENTATIVA
        if (attempts < maxAttempts) {
          const delay = Math.pow(2, attempts) * 1500; // Delay crescente
          console.log(`Aguardando ${delay}ms antes da prxima tentativa...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (attemptError) {
        console.warn(`Tentativa ${attempts} falhou:`, attemptError);
      }
    }
    
    console.error('No foi possvel resolver o problema de fingerprint após todas as tentativas');
    return false;
    
  } catch (error) {
    console.error('Erro crtico durante correo de fingerprint:', error);
    return false;
  }
}

// Debug global removido para produção otimizada
if (false && typeof window !== 'undefined') {
  (window as any).__EFI_DEBUG__ = {
    getStatus: getSDKStatus,
    isReady: isSDKReady,
    reload: loadEfiBankSDK,
    fixFingerprint: fixFingerprintError,
    retry: retrySDKLoad
  };
}