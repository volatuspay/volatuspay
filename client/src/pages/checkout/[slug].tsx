import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PaymentMethods } from "@/components/checkout/payment-methods";
import { ExitIntentPopup } from "@/components/checkout/exit-intent-popup";
import CheckoutWhiteV1 from "@/components/checkout/CheckoutWhiteV1";
import { getCheckoutBySlug } from "@/lib/firestore";
import { formatBRL, formatCurrency } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import "@/lib/i18n"; // Importar configuração i18n
import type { Customer, Checkout } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { ShoppingCart, CreditCard, QrCode, MapPin, User, Mail, Phone, Hash, Building, Check, Clock, Shield, Star, Gift, Truck, Lock, ArrowLeft, ArrowRight, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useGlobalConfigStore } from "@/stores/global-config"; // CONFIGURAÇES DINMICAS DA EMPRESA
import { useCustomDialog } from "@/hooks/use-custom-dialog";
import { pixelTracker } from "@/lib/pixel-tracking"; // PIXEL TRACKING REAL
import { trackCheckoutAnalytics } from "@/lib/checkout-analytics"; // ANALYTICS TRACKING
import { checkoutAnalyticsTracker } from "@/lib/checkout-analytics-tracking"; // INTERNAL ANALYTICS

export default function CheckoutPage() {
  // CONFIGURAÇES DINMICAS DA EMPRESA (ADMIN POWER!)
  const { config } = useGlobalConfigStore();
  const { showAlert } = useCustomDialog();
  
  // INTERNACIONALIZAÇÃO
  const { t, i18n } = useTranslation('checkout');
  
  // 🔄 DETECTAR NAVEGAÇÃO SPA (wouter)
  const [location] = useLocation();
  
  // ROTAS MLTIPLAS - Suporte para checkout moderno e legacy COM OFERTAS
  const [matchCheckoutOffer, paramsCheckoutOffer] = useRoute("/checkout/:slug/:offerSlug");
  const [matchCheckout, paramsCheckout] = useRoute("/checkout/:slug");
  const [matchLegacy, paramsLegacy] = useRoute("/c/:slug");
  
  // Determinar qual rota foi usada (prioridade: com oferta > sem oferta > legacy)
  const match = matchCheckoutOffer || matchCheckout || matchLegacy;
  const params = paramsCheckoutOffer || paramsCheckout || paramsLegacy;
  

  // CRONMETRO REAL - Estado para countdown (HOOKS ANTES DE EARLY RETURNS!)
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerStarted, setTimerStarted] = useState(false);
  
  // Estados da página
  const [showExitIntent, setShowExitIntent] = useState(false);
  const [customerData, setCustomerData] = useState<Customer>({
    name: '',
    email: '',
    document: '',
    phone: '',
    customerType: 'individual' // Padrão pessoa fsica - businessData seradicionado dinamicamente
  });
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'pix' | 'card'>('card');
  const [currentStep, setCurrentStep] = useState(1);
  
  // SISTEMA DE AFILIADOS: Capturar UID do Firebase Auth do parmetro "ref"
  const [affiliateUid, setAffiliateUid] = useState<string | null>(null);
  
  // ORDER BUMP: Produtos selecionados
  const [selectedOrderBumps, setSelectedOrderBumps] = useState<string[]>([]);
  
  // Estados de endereço (coleta de dados do comprador)
  const [addressData, setAddressData] = useState({
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    zipCode: ''
  });

  // DADOS DO FORMULRIO PURPLE STEP-BY-STEP
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    document: '',
    phone: ''
  });
  
  // REF PARA GARANTIR QUE PAGEVIEW SEJA RASTREADO APENAS UMA VEZ
  const pageViewTracked = useRef(false);
  const pixelsInitialized = useRef(false);
  
  // REF PARA RASTREAR checkoutId ANTERIOR E EVITAR DUPLICAÇÃO EM REFETCH
  const previousCheckoutId = useRef<string | null>(null);

  // VALIDAÇÃO DE SLUG ROBUSTA
  const slugIsValid = Boolean(params?.slug);
  
  // BUSCAR DADOS REAIS VIA API 
  const { data: checkout, isLoading: loadingCheckout, error: checkoutError } = useQuery({
    queryKey: ['/api/checkout', params?.slug],
    queryFn: async () => {
      if (!params?.slug) {
        console.error('SLUG NÃO FORNECIDO:', params);
        throw new Error('Slug no fornecido');
      }
      
      
      console.log('BUSCANDO CHECKOUT POR SLUG:', params.slug);
      
      const apiUrl = `/api/checkout/${params.slug}`;
      console.log('URL DA API:', apiUrl);
      console.log('BASE URL:', window.location.origin);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos de timeout
      
      try {
        console.log('INICIANDO FETCH:', apiUrl);
        const response = await fetch(apiUrl, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        
        console.log('RESPOSTA RECEBIDA:', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        });
        
        clearTimeout(timeoutId);
        
        // CORREÇÃO: Retornar null para 404 (no fazer retry)
        if (response.status === 404) {
          console.log('CHECKOUT 404 - Retornando null para parar loading');
          return null;
        }
        
        if (!response.ok) {
          const error = new Error(`Erro ao buscar checkout: ${response.status}`);
          (error as any).status = response.status;
          throw error;
        }
        
        const data = await response.json();
        console.log('CHECKOUT CARREGADO:', {
          id: data.id,
          title: data.title,
          marketTarget: data.marketTarget,
          methods: data.methods
        });
        
        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        console.error('ERRO AO BUSCAR CHECKOUT:', err);
        console.error('ERRO DETALHADO:', {
          name: (err as Error).name,
          message: (err as Error).message,
          stack: (err as Error).stack
        });
        if ((err as Error).name === 'AbortError') {
          console.error('TIMEOUT ao buscar checkout');
          const timeoutError = new Error('Timeout ao carregar checkout');
          (timeoutError as any).status = 408;
          throw timeoutError;
        }
        throw err;
      }
    },
    enabled: slugIsValid,
    retry: (count, error) => {
      // No fazer retry em 404, timeout ou erros do servidor
      const status = (error as any)?.status;
      if (status === 404 || status === 408 || status >= 400) return false;
      return count < 1; // Mximo 1 retry para outros erros
    },
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    staleTime: 30000
  });

  // SALVAR checkoutId NO LOCALSTORAGE PARA UPSELL/DOWNSELL
  useEffect(() => {
    if (checkout?.id) {
      console.log('💾 Salvando checkoutId no localStorage:', checkout.id);
      localStorage.setItem('lastCheckoutId', checkout.id);
    }
  }, [checkout?.id]);
  
  // Desconto: BUSCAR OFERTA SE offerSlug EXISTIR (endpoint pblico sem auth)
  const { data: productOffer, isLoading: loadingOffer } = useQuery({
    queryKey: ['/api/public/offers', params?.slug, (params as any)?.offerSlug],
    queryFn: async () => {
      const offerSlug = (params as any)?.offerSlug;
      if (!offerSlug || !checkout) return null;
      
      console.log('Desconto: BUSCANDO OFERTA PBLICA:', { offerSlug, productId: checkout.id });
      
      const response = await fetch(`/api/public/offers/${checkout.id}/${offerSlug}`);
      
      if (response.status === 404) {
        console.log('OFERTA NÃO ENCONTRADA:', offerSlug);
        return null;
      }
      
      if (!response.ok) {
        console.error('Erro ao buscar oferta:', response.status);
        return null;
      }
      
      const offer = await response.json();
      console.log('OFERTA ENCONTRADA:', { title: offer.title, price: offer.price });
      
      return offer;
    },
    enabled: Boolean(checkout && (params as any)?.offerSlug),
  });

  // DEBUG - Verificar se slug existe
  useEffect(() => {
    console.log('VERIFICAÇÃO SLUG:', { 
      slugExists: !!params?.slug, 
      slug: params?.slug, 
      offerSlug: (params as any)?.offerSlug,
      slugIsValid, 
      loadingCheckout, 
      checkoutError 
    });
  }, [params?.slug, slugIsValid, loadingCheckout, checkoutError]);
  
  // REMOVIDO - O invalidateQueries estava causando loop infinito
  // A query jtem refetchOnMount: true que garante dados frescos

  // SINCRONIZAR formData com customerData quando checkout carrega
  useEffect(() => {
    if (checkout && !loadingCheckout) {
      // Atualizar formData com dados do customerData
      setFormData(prevFormData => ({
        name: customerData.name || prevFormData.name,
        email: customerData.email || prevFormData.email,
        document: customerData.document || prevFormData.document,
        phone: customerData.phone || prevFormData.phone
      }));
      console.log('SINCRONIZANDO formData com customerData:', customerData);
    }
  }, [checkout, loadingCheckout, customerData]);
  
  // EFFECT PARA COUNTDOWN COM INICIALIZAÇÃO INTELIGENTE - ULTRA OTIMIZADO
  useEffect(() => {
    if (!checkout?.timer?.enabled || !checkout?.timer?.minutes) {
      setTimeRemaining(0);
      setTimerStarted(false);
      return;
    }
    
    // INICIALIZAR TIMER E CRIAR INTERVAL UMA NICA VEZ
    const initialTime = checkout.timer.minutes * 60;
    setTimeRemaining(initialTime);
    setTimerStarted(true); // Marcar que o timer comeou
    
    // Criar interval IMEDIATAMENTE após inicializar (sem depender de timeRemaining)
    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval); // Auto-cleanup quando acabar
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [checkout?.timer?.enabled, checkout?.timer?.minutes, params?.slug]); // SEM timeRemaining - evita loop!

  // EXPIRY REDIRECT: Redirecionar quando o timer expirar (apenas se o timer jiniciou)
  useEffect(() => {
    if (timerStarted && timeRemaining === 0 && checkout?.timer?.enabled && checkout?.cancelUrl) {
      console.log('TIMER EXPIRADO - Redirecionando para:', checkout.cancelUrl);
      setTimeout(() => {
        window.location.href = checkout.cancelUrl!;
      }, 1000); // Aguardar 1 segundo para o usuário ver que expirou
    }
  }, [timeRemaining, timerStarted, checkout?.timer?.enabled, checkout?.cancelUrl]);
  
  // FORMATAR TEMPO REAL (MM:SS)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // BUSCAR CONFIGURAÇES PBLICAS DE TAXAS (ENDPOINT PBLICO SEM AUTENTICAÇÃO)
  const { data: acquirerConfig } = useQuery({
    queryKey: ['public-acquirers-fees'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/public/acquirers-fees', {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        if (response.ok) {
          const data = await response.json();
          console.log('Taxas pblicas carregadas:', data);
          return data;
        }
      } catch (error) {
        console.log('Erro ao carregar taxas pblicas, usando padrão');
      }
      // Fallback para configurações padrão
      return {
        efibank: { pixFeePercent: 2, cardFeePercent: 5.2 },
        stripe: { cardFeePercent: 5.2 }
      };
    },
    staleTime: 300000, // Cache por 5 minutos (taxas mudam raramente)
    refetchOnWindowFocus: false
  });

  // CAPTURAR PARMETRO DE AFILIADO DA URL (UID DO FIREBASE AUTH)
  // DETECTAR AUTOMATICAMENTE SE PESSOA FSICA OU JURDICA
  const detectCustomerType = (document: string) => {
    // Remove caracteres especiais, mantém só dígitos
    const cleanDoc = document.replace(/[^\d]/g, '');
    
    // CNPJ tem 14 dígitos, CPF tem 11 - valida que é só dígitos (já garantido pelo replace)
    if (cleanDoc.length === 14 && /^\d{14}$/.test(cleanDoc)) {
      return 'business';
    } else if (cleanDoc.length === 11 && /^\d{11}$/.test(cleanDoc)) {
      return 'individual';
    }
    return 'individual'; // Padrão
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const affParam = urlParams.get('aff');
    const refParam = urlParams.get('ref');
    const affiliateParam = affParam || refParam;

    if (affiliateParam) {
      console.log('AFILIADO DETECTADO:', affiliateParam);
      setAffiliateUid(affiliateParam);
      localStorage.setItem('affiliate_uid', affiliateParam);
      return;
    }

    const slugForCookie = params?.slug || '';
    const cookieName = `cc_aff_${slugForCookie.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const cookies = document.cookie.split(';').reduce((acc: Record<string, string>, c) => {
      const [key, ...val] = c.trim().split('=');
      if (key) acc[key] = decodeURIComponent(val.join('='));
      return acc;
    }, {});

    const cookieData = cookies[cookieName];
    if (cookieData) {
      try {
        const parsed = JSON.parse(cookieData);
        if (parsed.affiliateCode) {
          console.log('AFILIADO RECUPERADO DO COOKIE:', parsed.affiliateCode);
          setAffiliateUid(parsed.affiliateCode);
          localStorage.setItem('affiliate_uid', parsed.affiliateCode);
          return;
        }
      } catch {}
    }

    const savedAffiliateUid = localStorage.getItem('affiliate_uid');
    if (savedAffiliateUid) {
      console.log('AFILIADO RECUPERADO DO STORAGE:', savedAffiliateUid);
      setAffiliateUid(savedAffiliateUid);
    }
  }, []);

  // DETECTAR AUTOMATICAMENTE TIPO DE CLIENTE BASEADO NO DOCUMENTO
  useEffect(() => {
    if (customerData.document) {
      const newType = detectCustomerType(customerData.document);
      if (newType !== customerData.customerType) {
        if (newType === 'business') {
          // Inicializar businessData quando detectado como empresa
          setCustomerData(prev => ({ 
            ...prev, 
            customerType: newType,
            businessData: {
              businessName: '',
              tradingName: '',
              stateRegistration: '',
              municipalRegistration: '',
              businessType: '',
              businessAddress: {
                street: '',
                number: '',
                complement: '',
                neighborhood: '',
                city: '',
                state: '',
                zipCode: ''
              }
            }
          }));
        } else {
          // Remover businessData quando pessoa fsica
          const { businessData, ...cleanData } = customerData;
          setCustomerData({ ...cleanData, customerType: newType });
        }
      }
    }
  }, [customerData.document]);

  // USAR SDK EFIBANK GLOBAL PARA PAGAMENTOS COM CARTÃO
  useEffect(() => {
    // VERIFICAR SDK APENAS PARA CHECKOUTS BRASILEIROS
    if (checkout?.marketTarget === 'brasil') {
      console.log('Verificando SDK EfBank global para checkout brasileiro...');
      
      // IMPORTAR E USAR GERENCIADOR GLOBAL
      import('@/lib/efibank-sdk').then(({ loadEfiBankSDK, getSDKStatus, retrySDKLoad }) => {
        
        // VERIFICAR STATUS ATUAL
        const status = getSDKStatus();
        console.log('Status atual do SDK EfBank:', status);
        
        if (status.sdkReady) {
          console.log('SDK EfBank jestpronto!');
          return;
        }
        
        if (status.loading) {
          console.log('SDK EfBank jestsendo carregado...');
          return;
        }
        
        if (status.failed) {
          console.log('SDK falhou anteriormente, tentando retry inteligente...');
          retrySDKLoad(2).then(success => {
            if (success) {
              console.log('SDK EfBank restaurado com sucesso via retry!');
            } else {
              console.log('Mantendo sistema de fallback ativo');
            }
          });
        } else {
          console.log('Forando carregamento do SDK EfBank...');
          loadEfiBankSDK(true);
        }
      });
    }
  }, [checkout?.marketTarget]);

  // SISTEMA DE TRADUÇÃO DESABILITADO - SEMPRE PT-BR
  useEffect(() => {
    // FORÇAR SEMPRE PORTUGUÊS BRASILEIRO (independente do checkout)
    i18n.changeLanguage('pt-BR').catch(() => {
      console.log('Idioma já está em pt-BR');
    });
  }, [i18n]);

  // 🔙 BACK REDIRECT — interceptar botão voltar e redirecionar para URL configurada
  useEffect(() => {
    const backUrl = (checkout as any)?.backRedirectUrl;
    if (!backUrl || typeof backUrl !== 'string' || !backUrl.startsWith('http')) return;

    let redirected = false;

    // Empurra estado guarda com URL explícita para maior compatibilidade (PC, iOS, Android)
    window.history.pushState({ _brg: true }, '', window.location.href);

    const handlePopState = () => {
      if (redirected) return;
      redirected = true;
      // Re-empurra estado para travar navegação enquanto o redirect carrega
      window.history.pushState({ _brg: true }, '', window.location.href);
      // Usa replace() para não deixar o checkout no histórico da página de destino
      window.location.replace(backUrl);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [(checkout as any)?.backRedirectUrl]);

  // 🚪 DETECTAR SAÍDA DO CHECKOUT via navegação SPA
  useEffect(() => {
    // Guardar location anterior
    const checkoutPaths = ['/checkout/', '/c/'];
    const isCheckoutPage = checkoutPaths.some(path => location.startsWith(path));
    
    // Se NÃO está mais no checkout, terminar sessão
    if (!isCheckoutPage && checkout?.id) {
      console.log('[CheckoutAnalytics] Saindo do checkout via navegação SPA:', location);
      checkoutAnalyticsTracker.terminate('spa_navigation');
    }
    
    return () => {
      // Cleanup ao desmontar componente
      if (checkout?.id) {
        checkoutAnalyticsTracker.destroy();
        pageViewTracked.current = false;
        pixelsInitialized.current = false;
        previousCheckoutId.current = null;
      }
    };
  }, [location, checkout?.id]);

  // ANALYTICS TRACKER: Inicializar APENAS quando checkout.id MUDAR (não em refetch)
  useEffect(() => {
    if (!checkout?.id || loadingCheckout) return;
    
    // VERIFICAR SE É UM NOVO CHECKOUT (ID diferente do anterior)
    const isNewCheckout = previousCheckoutId.current !== checkout.id;
    
    if (isNewCheckout) {
      console.log('[CheckoutAnalytics] Inicializando para novo checkout:', checkout.id);
      
      // RESETAR ESTADO ANTERIOR
      pageViewTracked.current = false;
      pixelsInitialized.current = false;
      previousCheckoutId.current = checkout.id;
      
      // VALIDAR PRODUCTID (apenas informativo, não bloqueia analytics)
      if (!checkout.productId) {
        console.log('[CheckoutAnalytics] ℹ️ Checkout sem productId - analytics gerais funcionarão normalmente:', {
          checkoutId: checkout.id,
          title: checkout.title,
        });
      }
      
      // INICIALIZAR TRACKER
      checkoutAnalyticsTracker.initialize({
        checkoutId: checkout.id,
        offerId: checkout.offerId,
        productId: checkout.productId,
        tenantId: checkout.tenantId || checkout.userId || '',
      });
      
      // RASTREAR PAGEVIEW NO DASHBOARD DE ANALYTICS
      checkoutAnalyticsTracker.track('checkout_pageview');
      
      // RASTREAR VISUALIZAÇÃO DE PÁGINA (PIXELS EXTERNOS)
      trackCheckoutAnalytics(checkout.id, 'pageView');
      
      // MARCAR COMO JÁ RASTREADO
      pageViewTracked.current = true;
    }
  }, [checkout?.id, loadingCheckout]);

  // PIXEL TRACKING: Inicializar e disparar eventos (apenas no primeiro carregamento)
  useEffect(() => {
    if (!checkout || loadingCheckout || pixelsInitialized.current) return;

    let initialized = false;

    // PRIORIDADE 1: Managed Pixels (novo sistema - subcoleção)
    if (checkout.managedPixels && checkout.managedPixels.length > 0) {
      const enabledPixels = checkout.managedPixels.filter((p: any) => p.enabled);
      console.log('[PIXEL] Checkout managedPixels total:', checkout.managedPixels.length, 'enabled:', enabledPixels.length);
      enabledPixels.forEach((p: any) => console.log(`[PIXEL] -> ${p.platform}: pixelId=${p.pixelId || p.measurementId || p.conversionId}, events=`, p.events));
      if (enabledPixels.length > 0) {
        pixelTracker.initializeFromManagedPixels(enabledPixels);
        initialized = true;
      }
    } else {
      console.log('[PIXEL] Nenhum managedPixel encontrado no checkout');
    }

    // PRIORIDADE 2: Campos legacy diretos no checkout (backward compatibility)
    if (!initialized) {
      const pixelConfig = {
        tiktokPixel: checkout.tiktokPixel,
        facebookPixel: checkout.facebookPixel,
        googleAdsId: checkout.googleAdsId,
        googleAdsLabel: checkout.googleAdsLabel,
        googleAnalytics4Id: checkout.googleAnalytics4Id,
        pinterestPixel: checkout.pinterestPixel,
        kawaiPixel: checkout.kawaiPixel,
      };

      const hasPixels = Object.values(pixelConfig).some(val => val && val.trim());
      if (hasPixels) {
        console.log('Inicializando Pixel Tracking (legacy):', pixelConfig);
        pixelTracker.initialize(pixelConfig);
        initialized = true;
      }
    }

    if (initialized) {
      pixelTracker.trackPageView();
      
      const currency = checkout.globalSettings?.currency || checkout.currency || 'BRL';
      const amount = checkout.pricing?.amount || 0;
      const productId = checkout.syncedProductId || checkout.id;
      pixelTracker.trackViewContent(amount, currency, checkout.title, productId);
      pixelTracker.trackAddToCart(amount, currency, checkout.title);
      pixelTracker.trackInitiateCheckout(amount, currency, checkout.title);
    }

    pixelsInitialized.current = true;
  }, [checkout, loadingCheckout]);

  // FUNÇÃO PARA FORMATAR MOEDA COM CONVERSÃO CAMBIAL REAL + % TAXA
  const formatPrice = (amountInCents: number) => {
    // DETECTAR SE CHECKOUT GLOBAL
    const isGlobalCheckout = checkout?.marketTarget === 'global';
    const currency = checkout?.globalSettings?.currency || checkout?.currency || 'USD';
    
    if (isGlobalCheckout) {
      console.log(`GLOBAL PRICE: ${amountInCents} centavos ${currency}`);
      return formatCurrency(amountInCents, currency);
    }
    
    // CHECKOUT BRASIL - Usar BRL
    return formatBRL(amountInCents);
  };


  // SANITIZAR DADOS ANTES DE ENVIAR (PREVINE PROBLEMAS DE VALIDAÇÃO)
  const sanitizeCustomerData = (data: Customer): Customer => {
    const sanitized = { ...data };
    
    // Normalizar documento (remover caracteres especiais)
    if (sanitized.document) {
      sanitized.document = sanitized.document.replace(/[^\d]/g, '');
    }
    
    // Remover businessData se no for empresa ou se estiver vazio
    if (sanitized.customerType !== 'business' || !sanitized.businessData?.businessName?.trim()) {
      delete sanitized.businessData;
    } else if (sanitized.businessData) {
      // Limpar campos vazios do businessData
      const bd = sanitized.businessData;
      if (!bd.tradingName?.trim()) delete bd.tradingName;
      if (!bd.stateRegistration?.trim()) delete bd.stateRegistration;
      if (!bd.municipalRegistration?.trim()) delete bd.municipalRegistration;
      if (!bd.businessType?.trim()) delete bd.businessType;
      
      // Remover businessAddress se campos obrigatórios estiverem vazios
      if (!bd.businessAddress?.street?.trim() || !bd.businessAddress?.number?.trim() ||
          !bd.businessAddress?.neighborhood?.trim() || !bd.businessAddress?.city?.trim() || 
          !bd.businessAddress?.state?.trim() || !bd.businessAddress?.zipCode?.trim()) {
        delete bd.businessAddress;
      } else if (bd.businessAddress) {
        // Normalizar CEP empresarial (remover hfen se presente)
        bd.businessAddress.zipCode = bd.businessAddress.zipCode.replace(/[^\d]/g, '');
      }
    }
    
    // Remover address pessoal se campos obrigatórios estiverem vazios
    if (!sanitized.address?.street?.trim() || !sanitized.address?.number?.trim() || 
        !sanitized.address?.neighborhood?.trim() || !sanitized.address?.city?.trim() || 
        !sanitized.address?.state?.trim() || !sanitized.address?.zipCode?.trim()) {
      delete sanitized.address;
    } else if (sanitized.address) {
      // Normalizar CEP (remover hfen se presente)
      sanitized.address.zipCode = sanitized.address.zipCode.replace(/[^\d]/g, '');
    }
    
    return sanitized;
  };

  const isPhysicalProduct = false;

  // Validao de dados do cliente
  const validateCustomerData = () => {
    const { name, email, document, phone, customerType, businessData } = customerData;
    
    // CHECKOUT GLOBAL: Sexige nome e email (Stripe requirement)
    if (checkout?.marketTarget === 'global') {
      return name.trim() && email.trim();
    }
    
    // CHECKOUT BRASILEIRO: Exige todos os campos bsicos
    const basicFieldsValid = name.trim() && email.trim() && document.trim() && phone.trim();
    
    // PESSOA JURDICA: Validar campos obrigatórios da empresa
    if (customerType === 'business' && businessData) {
      const businessNameValid = businessData.businessName?.trim();
      // Endereço da empresa é opcional, mas se preenchido deve estar completo
      return basicFieldsValid && businessNameValid;
    }
    
    return basicFieldsValid;
  };

  const validateAddress = () => {
    return true;
  };

  const handleNextStep = async () => {
    console.log('handleNextStep - currentStep:', currentStep, 'marketTarget:', checkout?.marketTarget);
    
    if (currentStep === 1) {
      if (!validateCustomerData()) {
        await showAlert(t('validation.fillPersonalData'), 'Ateno', 'warning');
        return;
      }
      
      // RASTREAR CHECKOUT INICIADO (ANALYTICS DASHBOARD)
      if (checkout?.id) {
        checkoutAnalyticsTracker.track('checkout_initiated', {
          formData: { name: customerData.name, email: customerData.email }
        });
        trackCheckoutAnalytics(checkout.id, 'formFilled');
      }
      
      // CHECKOUT GLOBAL: Sempre vai para step 2 (cartão) após dados pessoais
      if (checkout?.marketTarget === 'global') {
        console.log('GLOBAL - Indo para step 2 (pagamento)');
        setCurrentStep(2);
        return;
      }
      // CHECKOUT BRASILEIRO: vai direto pro pagamento (step 3)
      console.log('BRASIL - Indo para step 3');
      setCurrentStep(3);
    } else if (currentStep === 2) {
      console.log('Step 2 -> 3');
      setCurrentStep(3);
    }
  };
  
  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (loadingCheckout) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-gray-600">Carregando checkout...</p>
        </div>
      </div>
    );
  }

  // CORREÇÃO: Checkout null significa 404 (sem retry)
  if (checkout === null && !loadingCheckout) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Página no encontrada</h1>
            <p className="text-gray-600">A página que vocestprocurando no existe.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // CORREÇÃO: Smostrar erro se realmente houve erro E não estcarregando
  if (checkoutError && !loadingCheckout) {
    console.error('MOSTRANDO TELA DE ERRO:', checkoutError);
    
    // 🚫 DETECTAR ERRO 403 (PRODUTO BLOQUEADO)
    const is403 = checkoutError instanceof Error && checkoutError.message.includes('403');
    const isBlocked = checkoutError instanceof Error && (
      checkoutError.message.includes('bloqueado') || 
      checkoutError.message.includes('indisponível') ||
      checkoutError.message.includes('não disponível')
    );
    
    if (is403 || isBlocked) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg border-red-200">
            <CardContent className="p-8 text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-red-600" />
              </div>
              <h1 className="text-2xl font-bold text-red-900 mb-2">Produto Temporariamente Indisponível</h1>
              <p className="text-red-700 mb-4">
                Este produto está temporariamente bloqueado devido a análise de segurança ou limite de reembolsos excedido.
              </p>
              <p className="text-sm text-red-600">
                Entre em contato com o suporte para mais informações.
              </p>
              {import.meta.env.DEV && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-left">
                  <p className="text-xs text-red-800 font-mono break-all">
                    {checkoutError instanceof Error ? checkoutError.message : 'Erro desconhecido'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Erro ao carregar checkout</h1>
            <p className="text-gray-600">Ocorreu um erro ao carregar esta página. Tente novamente mais tarde.</p>
            {import.meta.env.DEV && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-left">
                <p className="text-xs text-red-800 font-mono break-all">
                  {checkoutError instanceof Error ? checkoutError.message : 'Erro desconhecido'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // CORREÇÃO: Se não tem checkout mas não estcarregando E no herro, sento mostrar 404
  if (!checkout && !loadingCheckout && !checkoutError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Checkout não encontrado</h1>
            <p className="text-gray-600">O link que vocesttentando acessar no existe ou foi removido.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // LOADING EXTRA: Se não tem checkout mas ainda estcarregando, mostrar loading
  if (!checkout && loadingCheckout) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-500 mx-auto"></div>
          <p className="text-gray-600">Carregando checkout...</p>
        </div>
      </div>
    );
  }

  // Desconto: CALCULAR PREÇO: Usar preo da oferta se disponível, senão usar preo padrão
  const subtotal = productOffer?.price ? Number(productOffer.price) : checkout.pricing.amount;
  const discount = checkout.pricing.discount || 0;
  
  // DEBUG: Mostrar qual preo estsendo usado
  if (productOffer) {
    console.log('Desconto: USANDO PREÇO DA OFERTA:', {
      offerTitle: productOffer.title,
      offerPrice: productOffer.price,
      originalPrice: checkout.pricing.amount
    });
  }
  
  // Calcular valor total dos order bumps selecionados
  const orderBumpTotal = checkout.orderBump?.products
    ? checkout.orderBump.products
        .filter((product: any) => selectedOrderBumps.includes(product.checkoutId))
        .reduce((sum: number, product: any) => sum + product.price, 0)
    : 0;
  
  const total = subtotal - discount + orderBumpTotal;
  
  console.log('DEBUG CLCULO TOTAL:', {
    subtotal,
    discount,
    orderBumpTotal,
    total,
    pricingAmount: checkout.pricing.amount,
    hasOffer: !!productOffer
  });

  // DEBUG CRONMETRO
  console.log('DEBUG TIMER:', {
    timerExists: !!checkout.timer,
    timerEnabled: checkout.timer?.enabled,
    timerMinutes: checkout.timer?.minutes,
    timeRemaining,
    timerData: checkout.timer
  });

  // USAR SEMPRE O TEMPLATE WHITE V1
  return (
    <>
      {/* CRONÔMETRO FIXO NO TOPO - ACIMA DE TUDO */}
      {checkout.timer?.enabled && timeRemaining > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 w-full shadow-lg">
          <div 
            className="w-full px-3 sm:px-4 py-2 sm:py-2.5"
            style={{
              backgroundColor: checkout.timer.backgroundColor || '#dc2626',
              color: checkout.timer.color || '#ffffff'
            }}
          >
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
              {/* Lado Esquerdo: Íícone + Texto */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="text-xs sm:text-sm font-semibold truncate">
                  {checkout.timer.title || 'Oferta por tempo limitado!'}
                </span>
              </div>

              {/* Lado Direito: Contador */}
              <div className="flex items-center gap-1 sm:gap-1.5 text-base sm:text-lg font-bold font-mono flex-shrink-0">
                <div className="bg-white/20 backdrop-blur-sm rounded px-1.5 sm:px-2 py-0.5 min-w-[28px] sm:min-w-[32px] text-center">
                  {String(Math.floor(timeRemaining / 60)).padStart(2, '0')}
                </div>
                <span className="text-sm sm:text-base">:</span>
                <div className="bg-white/20 backdrop-blur-sm rounded px-1.5 sm:px-2 py-0.5 min-w-[28px] sm:min-w-[32px] text-center">
                  {String(timeRemaining % 60).padStart(2, '0')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* PADDING PARA COMPENSAR O CRONÔMETRO FIXO */}
      <div className={checkout.timer?.enabled && timeRemaining > 0 ? "pt-14 sm:pt-16" : ""}>
        <CheckoutWhiteV1 
          checkout={checkout}
          totalAmount={total} // Desconto: PASSAR TOTAL CALCULADO (inclui preo da oferta + order bumps - desconto)
          affiliateUid={affiliateUid}
          offerSlug={(params as any)?.offerSlug || undefined}
          onCustomerDataChange={(data) => {
            setCustomerData(prev => ({ ...prev, ...data }));
          }}
        />
      </div>
    </>
  );
}
