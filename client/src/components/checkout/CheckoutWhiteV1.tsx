import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Mail, FileText, Phone, Shield, CheckCircle, MapPin, Home, Percent, Tag, Star, Lock, ArrowRight, CreditCard, Loader2, MapPinned, ChevronLeft, ChevronRight, Pencil, Building2 } from 'lucide-react';
import { PaymentMethods } from './payment-methods';
import { ExitIntentPopup } from './exit-intent-popup';
import { resolveImageUrl } from '@/lib/image-url';
import { OrderBump } from './order-bump';
import { PixIcon } from '@/components/ui/pix-icon';
import { useToast } from '@/hooks/use-toast';
import { useViaCep } from '@/hooks/use-viacep';
import type { Checkout, Customer } from '@shared/schema';
import DOMPurify from 'isomorphic-dompurify';

// TRACKING DE ANALYTICS
async function trackPaymentClick(checkoutSlug: string) {
  try {
    await fetch(`/api/checkouts/${checkoutSlug}/analytics/paymentClicked`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`Analytics: paymentClicked rastreado para ${checkoutSlug}`);
  } catch (error) {
    console.warn('Erro ao rastrear paymentClicked:', error);
  }
}

// PROTEÇÃO XSS: Sanitizao de inputs
const sanitizeInput = (value: string): string => {
  return DOMPurify.sanitize(value, { 
    ALLOWED_TAGS: [], 
    ALLOWED_ATTR: [] 
  }).trim();
};

// PROTEÇÃO: Hash de integridade de preos
const generatePriceHash = (data: {
  checkoutId: string;
  baseAmount: number;
  couponCode?: string;
  orderBump?: boolean;
}): string => {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

// Schema GLOBAL (sem CPF/telefone obrigatório)
const globalCustomerFormSchema = z.object({
  name: z.string().min(1).transform(sanitizeInput),
  email: z.string().email().transform(sanitizeInput),
  document: z.string().optional().transform((v) => v ? sanitizeInput(v) : ''),
  phone: z.string().optional().transform((v) => v ? sanitizeInput(v) : ''),
});

// Schema BRASIL (CPF/telefone obrigatórios)
const brazilCustomerFormSchema = z.object({
  name: z.string().min(1).transform(sanitizeInput),
  email: z.string().email().transform(sanitizeInput),
  document: z.string().min(1).refine(v => {
    const d = v.replace(/\D/g, '');
    return d.length === 11 || d.length === 14;
  }, { message: 'CPF (11 dígitos) ou CNPJ (14 dígitos) inválido' }).transform(sanitizeInput),
  phone: z.string().min(1).refine(v => {
    const d = v.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 11;
  }, { message: 'Telefone inválido (10-11 dígitos com DDD)' }).transform(sanitizeInput),
});

// Schema com endereço do comprador - GLOBAL
const globalFormWithAddressSchema = globalCustomerFormSchema.extend({
  street: z.string().min(1).transform(sanitizeInput),
  number: z.string().min(1).transform(sanitizeInput),
  complement: z.string().optional().transform((v) => v ? sanitizeInput(v) : ''),
  neighborhood: z.string().min(1).transform(sanitizeInput),
  city: z.string().min(1).transform(sanitizeInput),
  state: z.string().min(2).max(2).transform((v) => sanitizeInput(v).toUpperCase()),
  zipCode: z.string().min(8).transform(sanitizeInput),
});

// Schema com endereço do comprador - BRASIL
const brazilFormWithAddressSchema = brazilCustomerFormSchema.extend({
  street: z.string().min(1).transform(sanitizeInput),
  number: z.string().min(1).transform(sanitizeInput),
  complement: z.string().optional().transform((v) => v ? sanitizeInput(v) : ''),
  neighborhood: z.string().min(1).transform(sanitizeInput),
  city: z.string().min(1).transform(sanitizeInput),
  state: z.string().min(2).max(2).transform((v) => sanitizeInput(v).toUpperCase()),
  zipCode: z.string().min(8).transform(sanitizeInput),
});

type CustomerFormData = z.infer<typeof brazilCustomerFormSchema>;
type CustomerFormWithAddress = z.infer<typeof brazilFormWithAddressSchema>;

interface CheckoutWhiteV1Props {
  checkout: Checkout;
  onCustomerDataChange: (data: Partial<Customer>) => void;
  totalAmount?: number;
  affiliateUid?: string | null;
  offerSlug?: string;
}

export default function CheckoutWhiteV1({ 
  checkout, 
  onCustomerDataChange,
  totalAmount,
  affiliateUid,
  offerSlug
}: CheckoutWhiteV1Props) {
  const baseAmount = totalAmount ?? checkout.pricing?.amount ?? 0;
  const { t } = useTranslation();
  const { toast } = useToast();
  
  // 🌓 CHECKOUT SEMPRE WHITE (fixo)
  const isDarkMode = false;
  
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
  const [testimonials, setTestimonials] = useState<any[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'pix' | 'card' | 'boleto'>('card');
  const [selectedOrderBumps, setSelectedOrderBumps] = useState<Array<{ checkoutId: string; price: number }>>([]);
  const { fetchAddress, loading: loadingCep, resetLastCep } = useViaCep();
  const cepInputRef = useRef<HTMLInputElement>(null);
  const [priceIntegrityHash, setPriceIntegrityHash] = useState<string>('');
  const [createPixFn, setCreatePixFn] = useState<(() => Promise<void>) | null>(null);
  const [isPixLoading, setIsPixLoading] = useState(false);
  const [documentDisplay, setDocumentDisplay] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');

  // ETAPAS ACCORDION
  const [checkoutStep, setCheckoutStep] = useState<number>(1);
  const [customerType, setCustomerType] = useState<'individual' | 'company'>('individual');
  const [testimonialsIdx, setTestimonialsIdx] = useState(0);
  const [pixInitiated, setPixInitiated] = useState(false);

  // SELETOR DE PAÍS - Define idioma e campos do formulário
  type CountryCode = 'BR' | 'US' | 'ES' | 'PT' | 'MX' | 'AR';
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    checkout.marketTarget === 'global' ? 'US' : 'BR'
  );
  
  // Mapeamento país → idioma
  const countryLanguageMap: Record<CountryCode, string> = {
    BR: 'pt-BR',
    US: 'en',
    ES: 'es',
    PT: 'pt-BR',
    MX: 'es',
    AR: 'es'
  };
  
  // Países disponíveis (sem emojis - usando código do país)
  const availableCountries = [
    { code: 'BR' as CountryCode, name: 'Brasil', abbr: 'BR' },
    { code: 'US' as CountryCode, name: 'United States', abbr: 'US' },
    { code: 'ES' as CountryCode, name: 'España', abbr: 'ES' },
    { code: 'PT' as CountryCode, name: 'Portugal', abbr: 'PT' },
    { code: 'MX' as CountryCode, name: 'México', abbr: 'MX' },
    { code: 'AR' as CountryCode, name: 'Argentina', abbr: 'AR' },
  ];
  
  // País selecionado requer CPF? (apenas Brasil)
  const requiresDocument = selectedCountry === 'BR';

  // Modo de documento configurado pelo seller: 'cpf' | 'cnpj' | 'both' (padrão: 'both')
  const documentMode: 'cpf' | 'cnpj' | 'both' = (checkout as any).documentMode || 'both';
  const documentLabel = documentMode === 'cpf' ? 'CPF' : documentMode === 'cnpj' ? 'CNPJ' : 'CPF ou CNPJ';
  const documentPlaceholder = documentMode === 'cpf' ? 'CPF (11 dígitos)' : documentMode === 'cnpj' ? 'CNPJ (14 dígitos)' : 'CPF ou CNPJ';
  const documentMaxLength = documentMode === 'cnpj' ? 18 : 18;
  
  // SISTEMA DE VISITANTES ONLINE - HEARTBEAT REAL (ESTILO SHOPIFY)
  useEffect(() => {
    let sessionId = sessionStorage.getItem('checkout-session-id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      sessionStorage.setItem('checkout-session-id', sessionId);
    }

    const sendHeartbeat = () => {
      fetch(`/api/checkouts/${checkout.slug}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        keepalive: true
      }).catch(() => {});
    };

    let interval: NodeJS.Timeout;
    
    // Delay de 1 segundo antes do primeiro heartbeat (estilo Shopify)
    const initialTimeout = setTimeout(() => {
      sendHeartbeat();
      interval = setInterval(sendHeartbeat, 30000);
    }, 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (interval) clearInterval(interval);
    };
  }, [checkout.slug]);
  
  // 🌐 SISTEMA DE IDIOMA DINÂMICO - Muda idioma baseado no PAÍS SELECIONADO
  useEffect(() => {
    const lang = countryLanguageMap[selectedCountry];
    console.log(`🌐 País selecionado: ${selectedCountry} - Trocando idioma para: ${lang}`);
    changeLanguage(lang);
  }, [selectedCountry]);

  const totalSteps = 2;
  
  // PROTEÇÃO: Valores imutveis protegidos
  const protectedCheckout = useMemo(() => Object.freeze({
    id: checkout.id,
    basePrice: checkout.pricing?.amount ?? 0,
    productType: checkout.productType,
  }), [checkout.id, checkout.pricing?.amount, checkout.productType]);
  
  const discount = appliedCoupon ? (
    appliedCoupon.type === 'percentage' 
      ? (baseAmount * appliedCoupon.value) / 100
      : appliedCoupon.value
  ) : 0;
  
  const orderBumpTotal = selectedOrderBumps.reduce((sum, bump) => sum + bump.price, 0);
  const finalAmount = Math.max(0, baseAmount - discount + orderBumpTotal);

  // Desconto PIX: aplicado quando método selecionado é PIX
  const pixDiscountValue = checkout.discounts?.pix?.value ? parseFloat(checkout.discounts.pix.value) : 0;
  const pixDiscountAmount = pixDiscountValue > 0
    ? checkout.discounts?.pix?.type === 'R$'
      ? pixDiscountValue
      : Math.round((finalAmount * pixDiscountValue) / 100)
    : 0;
  const pixFinalAmount = Math.max(0, finalAmount - pixDiscountAmount);
  
  // PROTEÇÃO: Validao de cupom com sanitizao
  const handleApplyCoupon = async () => {
    const sanitizedCode = sanitizeInput(couponCode.trim().toUpperCase());
    
    if (!sanitizedCode || sanitizedCode.length < 3 || sanitizedCode.length > 50) {
      toast({
        title: 'Cupom invlido',
        description: 'Digite um código de cupom vlido',
        variant: 'destructive',
      });
      return;
    }
    
    // Proteção contra caracteres especiais maliciosos
    if (!/^[A-Z0-9\-_]+$/.test(sanitizedCode)) {
      toast({
        title: 'Cupom invlido',
        description: 'O cupom contém caracteres invlidos',
        variant: 'destructive',
      });
      return;
    }
    
    setIsValidatingCoupon(true);
    
    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Integrity-Hash': priceIntegrityHash, // Hash de integridade
        },
        body: JSON.stringify({
          code: sanitizedCode,
          tenantId: checkout.tenantId,
          productId: (checkout as any).syncedProductId || (checkout as any).productId || checkout.id,
          baseAmount: protectedCheckout.basePrice, // Preo protegido
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Cupom invlido');
      }
      
      // Validar resposta do servidor
      if (!result.coupon || typeof result.coupon.value !== 'number') {
        throw new Error('Resposta inválida do servidor');
      }
      
      setAppliedCoupon(result.coupon);
      
      const discountText = result.coupon.type === 'percentage' 
        ? `${result.coupon.value}%` 
        : `R$ ${(result.coupon.value / 100).toFixed(2)}`;
        
      toast({
        title: '' + t('checkout.payment.success'),
        description: `${t('checkout.labels.discount')} ${discountText}`,
      });
    } catch (error: any) {
      toast({
        title: '' + t('checkout.payment.error'),
        description: error.message || t('checkout.payment.error'),
        variant: 'destructive',
      });
    } finally {
      setIsValidatingCoupon(false);
    }
  };
  
  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode('');
    toast({
      title: '' + t('checkout.coupon.removed'),
      description: t('checkout.coupon.removed'),
    });
  };
  
  // Schema condicional baseado no país
  const validationSchema = useMemo(() => {
    if (requiresDocument) {
      return brazilCustomerFormSchema;
    } else {
      return globalCustomerFormSchema;
    }
  }, [requiresDocument]);
  
  // PROTEÇÃO: Validao rigorosa (anti-bypass)
  const handleContinueToNextStep = () => {
    const name = form.watch('name');
    const email = form.watch('email');
    const document = form.watch('document');
    const phone = form.watch('phone');
    
    // Validao extra de formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!name || name.length < 3) {
      toast({
        title: 'Nome invlido',
        description: 'Digite seu nome completo (mnimo 3 caracteres)',
        variant: 'destructive',
      });
      return;
    }
    
    if (!email || !emailRegex.test(email)) {
      toast({
        title: 'Email invlido',
        description: 'Digite um email vlido',
        variant: 'destructive',
      });
      return;
    }
    
    // CPF/Telefone obrigatórios apenas para Brasil
    if (requiresDocument) {
      const docDigits = (document || '').replace(/\D/g, '');
      const cpfOk = docDigits.length === 11;
      const cnpjOk = docDigits.length === 14;
      const valid =
        documentMode === 'cpf'  ? cpfOk :
        documentMode === 'cnpj' ? cnpjOk :
        cpfOk || cnpjOk;
      if (!valid) {
        const msg =
          documentMode === 'cpf'  ? 'Digite um CPF válido (11 dígitos)' :
          documentMode === 'cnpj' ? 'Digite um CNPJ válido (14 dígitos)' :
          'Digite um CPF válido (11 dígitos) ou CNPJ válido (14 dígitos)';
        toast({ title: `${documentLabel} inválido`, description: msg, variant: 'destructive' });
        return;
      }
    }

    if (requiresDocument) {
      const phoneDigits = (phone || '').replace(/\D/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        toast({
          title: 'Telefone inválido',
          description: 'Digite um celular válido com DDD (ex: (11) 99999-9999)',
          variant: 'destructive',
        });
        return;
      }
    }
    
    onCustomerDataChange(form.getValues());
  };

  const handleGoToDelivery = () => {
    const name = form.getValues('name');
    const email = form.getValues('email');
    const document = form.getValues('document');
    const phone = form.getValues('phone');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!name || name.length < 3) {
      toast({ title: 'Nome inválido', description: 'Digite seu nome completo (mínimo 3 caracteres)', variant: 'destructive' });
      return;
    }
    if (!email || !emailRegex.test(email)) {
      toast({ title: 'Email inválido', description: 'Digite um email válido', variant: 'destructive' });
      return;
    }
    if (requiresDocument) {
      const isCnpj = (customerType === 'company' && documentMode === 'both') || documentMode === 'cnpj';
      const docDigits = (document || '').replace(/\D/g, '');
      const valid = isCnpj ? docDigits.length === 14 : docDigits.length === 11;
      if (!valid) {
        toast({ title: `${isCnpj ? 'CNPJ' : 'CPF'} inválido`, description: `Digite um ${isCnpj ? 'CNPJ (14 dígitos)' : 'CPF (11 dígitos)'} válido`, variant: 'destructive' });
        return;
      }
      const phoneDigits = (phone || '').replace(/\D/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        toast({ title: 'Telefone inválido', description: 'Digite um celular válido com DDD (ex: (11) 99999-9999)', variant: 'destructive' });
        return;
      }
    }
    onCustomerDataChange(form.getValues());
    setCheckoutStep(2);
  };

  const handleGoToPayment = () => {
    onCustomerDataChange(form.getValues());
    setCheckoutStep(2);
  };

  const form = useForm<CustomerFormWithAddress>({
    resolver: zodResolver(validationSchema),
    defaultValues: {
      name: '',
      email: '',
      document: '',
      phone: '',
    },
  });

  // Limpar erros de validação ao mudar de país
  useEffect(() => {
    // Limpar erros de document/phone quando mudar para país global
    if (!requiresDocument) {
      form.clearErrors(['document', 'phone']);
    }
  }, [selectedCountry, requiresDocument, form]);

  const formatPrice = (amount: number) => {
    const currency = checkout.marketTarget === 'global' 
      ? (checkout.globalSettings?.currency || 'USD')
      : 'BRL';
    
    const amountInMainUnit = amount / 100;
    const locale = currency === 'BRL' ? 'pt-BR' : 'en-US';
    
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(amountInMainUnit);
  };

  useEffect(() => {
    const subscription = form.watch((data) => {
      const customerData: Partial<Customer> = {
        name: data.name || '',
        email: data.email || '',
        document: data.document || '',
        phone: data.phone || '',
        customerType: 'individual',
      };
      
      onCustomerDataChange(customerData);
    });
    
    return () => subscription.unsubscribe();
  }, [form, onCustomerDataChange]);

  // PROTEÇÃO: Gerar hash de integridade ao mudar preos
  useEffect(() => {
    const hash = generatePriceHash({
      checkoutId: protectedCheckout.id,
      baseAmount: protectedCheckout.basePrice,
      couponCode: appliedCoupon?.code,
      orderBump: selectedOrderBumps.length > 0,
    });
    setPriceIntegrityHash(hash);
  }, [protectedCheckout, appliedCoupon, selectedOrderBumps]);

  useEffect(() => {
    const triggers = (checkout as any).triggers;
    const triggerReviews: any[] = (triggers?.reviewsEnabled && triggers?.reviews?.length > 0)
      ? triggers.reviews.map((r: any) => ({
          name: sanitizeInput(r.name || ''),
          description: sanitizeInput(r.description || ''),
          photo: r.photo || null,
        }))
      : [];

    if (checkout.id) {
      fetch(`/api/checkouts/${checkout.id}/testimonials`)
        .then(res => res.ok ? res.json() : { testimonials: [] })
        .then(data => {
          const apiList = (data.testimonials || [])
            .filter((t: any) => t.active !== false)
            .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
            .map((t: any) => ({
              name: sanitizeInput(t.authorName || ''),
              description: sanitizeInput(t.content || ''),
              photo: t.authorPhoto || null,
            }));
          setTestimonials([...triggerReviews, ...apiList]);
        })
        .catch(() => setTestimonials(triggerReviews));
    } else {
      setTestimonials(triggerReviews);
    }
  }, [checkout]);

  return (
    <div className="min-h-screen bg-gray-50 force-light-theme">
      <div className="max-w-6xl mx-auto px-4 py-5 lg:py-8">

        {/* Banner Topo */}
        {((checkout.banner?.enabled && checkout.banner?.imageAbove?.enabled && checkout.banner?.imageAbove?.imageUrl) || checkout.bannerUrl) && (
          <div className="w-full mb-4 rounded-lg overflow-hidden shadow-sm">
            <img
              src={resolveImageUrl(checkout.banner?.imageAbove?.imageUrl || checkout.bannerUrl) || ''}
              alt="Banner"
              className="w-full h-auto object-cover"
              data-testid="checkout-banner"
            />
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-4">

          {/* ═══════════════════════════════════════════
              COL ESQUERDA — Identificação + Entrega
          ═══════════════════════════════════════════ */}
          <div className="w-full lg:w-[36%] order-2 lg:order-1 space-y-3">

            {/* ─── STEP 1: IDENTIFICAÇÃO ─── */}
            {checkoutStep > 1 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <h2 className="text-base font-bold text-gray-900">Identificação</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckoutStep(1)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="Editar identificação"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-2 space-y-0.5 text-sm text-gray-600">
                  <p className="font-semibold text-gray-800">{form.watch('name')}</p>
                  <p>{form.watch('email')}</p>
                  {requiresDocument && documentDisplay && (
                    <p>{customerType === 'company' ? 'CNPJ' : 'CPF'} {documentDisplay}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-bold text-gray-900">Identificação</h2>
                  <span className="text-sm text-gray-400">1 de {totalSteps}</span>
                </div>

                {requiresDocument && documentMode === 'both' && (
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-4">
                    <button
                      type="button"
                      onClick={() => { setCustomerType('individual'); setDocumentDisplay(''); form.setValue('document', '', { shouldValidate: false }); }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${customerType === 'individual' ? 'bg-gray-100 text-gray-900' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                      <User className="w-4 h-4" />
                      Pessoa física
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCustomerType('company'); setDocumentDisplay(''); form.setValue('document', '', { shouldValidate: false }); }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors border-l border-gray-200 ${customerType === 'company' ? 'bg-gray-100 text-gray-900' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                      <Building2 className="w-4 h-4" />
                      Pessoa jurídica
                    </button>
                  </div>
                )}

                {/* Nome completo */}
                <div className="mb-3">
                  <Label htmlFor="name" className="text-xs font-medium text-gray-500 mb-1 block uppercase tracking-wide">{t('checkout.fields.name')}</Label>
                  <input
                    id="name"
                    type="text"
                    placeholder={t('checkout.placeholders.name')}
                    className="w-full h-11 px-4 border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:border-gray-500 transition-colors text-sm"
                    style={{ backgroundColor: 'white', color: 'black' }}
                    data-testid="input-name"
                    {...form.register('name')}
                  />
                  {form.formState.errors.name && <p className="text-xs text-red-600 mt-1">Campo obrigatório.</p>}
                </div>

                {/* Email */}
                <div className="mb-3">
                  <Label htmlFor="email" className="text-xs font-medium text-gray-500 mb-1 block uppercase tracking-wide">{t('checkout.fields.email')}</Label>
                  <input
                    id="email"
                    type="email"
                    placeholder={t('checkout.placeholders.email')}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    className="w-full h-11 px-4 border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:border-gray-500 transition-colors text-sm"
                    style={{ backgroundColor: 'white', color: 'black' }}
                    data-testid="input-email"
                    {...form.register('email')}
                  />
                  {form.formState.errors.email && <p className="text-xs text-red-600 mt-1">Email inválido.</p>}
                </div>

                {/* CPF/CNPJ + Celular */}
                {requiresDocument && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <Label htmlFor="document" className="text-xs font-medium text-gray-500 mb-1 block uppercase tracking-wide">
                        {(customerType === 'company' && documentMode === 'both') || documentMode === 'cnpj' ? 'CNPJ' : 'CPF'}
                      </Label>
                      <input
                        id="document"
                        type="text"
                        inputMode="numeric"
                        placeholder={(customerType === 'company' && documentMode === 'both') || documentMode === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'}
                        autoComplete="off"
                        maxLength={18}
                        className="w-full h-11 px-4 border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:border-gray-500 transition-colors text-sm"
                        style={{ backgroundColor: 'white', color: 'black' }}
                        data-testid="input-document"
                        value={documentDisplay}
                        onChange={(e) => {
                          const isCnpj = (customerType === 'company' && documentMode === 'both') || documentMode === 'cnpj';
                          const maxDigits = isCnpj ? 14 : 11;
                          const digits = e.target.value.replace(/\D/g, '').slice(0, maxDigits);
                          let masked = digits;
                          if (isCnpj) {
                            masked = digits
                              .replace(/(\d{2})(\d)/, '$1.$2')
                              .replace(/(\d{3})(\d)/, '$1.$2')
                              .replace(/(\d{3})(\d)/, '$1/$2')
                              .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
                          } else {
                            masked = digits
                              .replace(/(\d{3})(\d)/, '$1.$2')
                              .replace(/(\d{3})(\d)/, '$1.$2')
                              .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
                          }
                          setDocumentDisplay(masked);
                          form.setValue('document', masked, { shouldValidate: false });
                        }}
                      />
                      {form.formState.errors.document && <p className="text-xs text-red-600 mt-1">Campo obrigatório.</p>}
                    </div>

                    <div>
                      <Label htmlFor="phone" className="text-xs font-medium text-gray-500 mb-1 block uppercase tracking-wide">WhatsApp / Celular</Label>
                      <input
                        id="phone"
                        type="tel"
                        inputMode="numeric"
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                        className="w-full h-11 px-4 border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:border-gray-500 transition-colors text-sm"
                        style={{ backgroundColor: 'white', color: 'black' }}
                        data-testid="input-phone"
                        value={phoneDisplay}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
                          let masked = digits;
                          if (digits.length <= 10) {
                            masked = digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
                          } else {
                            masked = digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
                          }
                          setPhoneDisplay(masked);
                          form.setValue('phone', digits, { shouldValidate: false });
                        }}
                      />
                      {form.formState.errors.phone && <p className="text-xs text-red-600 mt-1">Campo obrigatório.</p>}
                    </div>
                  </div>
                )}

                {/* Seletor de país — apenas mercado global */}
                {checkout.marketTarget === 'global' && (
                  <div className="mb-3">
                    <Label className="text-xs font-medium text-gray-500 mb-1 block uppercase tracking-wide">País</Label>
                    <div className="relative">
                      <select
                        value={selectedCountry}
                        onChange={(e) => setSelectedCountry(e.target.value as CountryCode)}
                        className="w-full h-11 px-4 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:border-gray-500 appearance-none"
                        data-testid="select-country"
                      >
                        {availableCountries.map((country) => (
                          <option key={country.code} value={country.code}>[{country.abbr}] {country.name}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleGoToDelivery}
                  className="w-full mt-2 font-semibold py-3.5 rounded-lg transition-colors text-sm"
                  data-payment-btn
                  data-testid="button-go-to-delivery"
                >
                  Ir para Pagamento
                </button>

                <p className="text-center text-xs text-gray-400 mt-3">
                  Ao prosseguir com a compra, você concorda com as{' '}
                  <a href="#" className="underline hover:text-gray-600">Políticas de Privacidade</a>
                </p>
              </div>
            )}


            {/* Banner Inferior — fica na col esquerda */}
            {form.watch('name') && form.watch('email') && checkout.banner?.enabled && checkout.banner?.imageBelow?.enabled && checkout.banner?.imageBelow?.imageUrl && (
              <div className="mt-1">
                <img
                  src={resolveImageUrl(checkout.banner.imageBelow.imageUrl) || ''}
                  alt="Banner Inferior"
                  className="w-full h-auto rounded-lg shadow-sm"
                  data-testid="checkout-banner-below"
                />
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════
              COL CENTRAL — Pagamento
          ═══════════════════════════════════════════ */}
          <div className="w-full lg:w-[36%] order-3 lg:order-2">
            {checkoutStep === totalSteps ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-bold text-gray-900">Pagamento</h2>
                  <span className="text-sm text-gray-400">{totalSteps} de {totalSteps}</span>
                </div>

                {/* Seleção de método via radio */}
                <div className="space-y-2 mb-4">
                  {/* Cartão */}
                  <button
                    type="button"
                    onClick={() => { trackPaymentClick(checkout.slug); setSelectedPaymentMethod('card'); setPixInitiated(false); }}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${selectedPaymentMethod === 'card' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                    data-testid="button-payment-card"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selectedPaymentMethod === 'card' ? 'border-gray-900' : 'border-gray-400'}`}>
                        {selectedPaymentMethod === 'card' && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                      </div>
                      <span className="text-sm font-semibold text-gray-800">Cartão de crédito</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div className="w-9 h-5 bg-[#1a1f71] rounded flex items-center justify-center">
                        <span className="text-white text-[9px] font-bold italic">VISA</span>
                      </div>
                      <div className="w-9 h-5 rounded overflow-hidden flex items-center justify-center bg-gray-100">
                        <div className="flex -space-x-1.5">
                          <div className="w-3.5 h-3.5 rounded-full bg-red-500" />
                          <div className="w-3.5 h-3.5 rounded-full bg-yellow-400" />
                        </div>
                      </div>
                      <div className="w-9 h-5 bg-[#FFD700] rounded flex items-center justify-center">
                        <span className="text-black text-[8px] font-black">elo</span>
                      </div>
                      <div className="w-9 h-5 bg-[#007BC1] rounded flex items-center justify-center">
                        <span className="text-white text-[8px] font-bold">AMEX</span>
                      </div>
                    </div>
                  </button>

                  {/* PIX — apenas Brasil */}
                  {checkout.marketTarget === 'brasil' && (
                    <button
                      type="button"
                      onClick={() => { trackPaymentClick(checkout.slug); setSelectedPaymentMethod('pix'); setPixInitiated(false); }}
                      className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${selectedPaymentMethod === 'pix' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                      data-testid="button-payment-pix"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selectedPaymentMethod === 'pix' ? 'border-gray-900' : 'border-gray-400'}`}>
                          {selectedPaymentMethod === 'pix' && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                        </div>
                        <span className="text-sm font-semibold text-gray-800">Pix</span>
                      </div>
                      <PixIcon className="h-6 w-6 text-teal-500 flex-shrink-0" />
                    </button>
                  )}

                  {/* Boleto — apenas Brasil */}
                  {checkout.marketTarget === 'brasil' && checkout.methods?.boleto && (
                    <button
                      type="button"
                      onClick={() => { trackPaymentClick(checkout.slug); setSelectedPaymentMethod('boleto'); setPixInitiated(false); }}
                      className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${selectedPaymentMethod === 'boleto' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                      data-testid="button-payment-boleto"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selectedPaymentMethod === 'boleto' ? 'border-gray-900' : 'border-gray-400'}`}>
                          {selectedPaymentMethod === 'boleto' && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                        </div>
                        <span className="text-sm font-semibold text-gray-800">Boleto bancário</span>
                      </div>
                      <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    </button>
                  )}
                </div>

                {/* ── PIX selecionado ── */}
                {selectedPaymentMethod === 'pix' && !pixInitiated && (
                  <div className="mt-1">
                    <p className="text-sm text-gray-600 mb-3 leading-relaxed">
                      A confirmação de pagamento é realizada em poucos minutos. Utilize o aplicativo do seu banco para pagar.
                    </p>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-sm text-gray-600">Valor no Pix:</span>
                      <span className="text-xl font-bold text-gray-900">{formatPrice(pixFinalAmount)}</span>
                      {pixDiscountAmount > 0 && (
                        <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                          -{formatPrice(pixDiscountAmount)}
                        </span>
                      )}
                    </div>
                    <OrderBump
                      checkout={checkout}
                      onBumpSelected={(selectedProducts) => setSelectedOrderBumps(selectedProducts)}
                    />
                    {createPixFn && (
                      <button
                        type="button"
                        onClick={() => { setPixInitiated(true); createPixFn(); }}
                        disabled={isPixLoading}
                        className="w-full mt-2 font-semibold py-4 rounded-xl transition-colors text-base flex items-center justify-center gap-3 shadow-md disabled:opacity-50"
                        data-payment-btn
                        data-testid="button-finalize-pix"
                      >
                        {isPixLoading ? (
                          <><Loader2 className="h-5 w-5 animate-spin" /><span>Gerando Código PIX...</span></>
                        ) : (
                          <><PixIcon className="h-5 w-5" /><span>Finalizar compra</span></>
                        )}
                      </button>
                    )}
                    <div className="flex items-center justify-center gap-2 mt-3 text-xs text-gray-400">
                      <Shield className="w-3 h-3" />
                      <span>Pagamento 100% seguro e criptografado</span>
                    </div>
                  </div>
                )}

                {/* ── Cartão / Boleto ── */}
                {(selectedPaymentMethod === 'card' || selectedPaymentMethod === 'boleto') && (
                  <div className="mt-1">
                    <OrderBump
                      checkout={checkout}
                      onBumpSelected={(selectedProducts) => setSelectedOrderBumps(selectedProducts)}
                    />
                    <PaymentMethods
                      checkout={checkout}
                      amount={finalAmount}
                      customerData={Object.freeze({
                        name: sanitizeInput(form.watch('name') || ''),
                        email: sanitizeInput(form.watch('email') || ''),
                        document: sanitizeInput(form.watch('document') || ''),
                        phone: sanitizeInput(form.watch('phone') || ''),
                        customerType: 'individual' as const,
                      })}
                      addressData={undefined}
                      showMethodSelector={false}
                      forcedMethod={selectedPaymentMethod}
                      selectedOrderBumps={selectedOrderBumps}
                      affiliateUid={affiliateUid}
                      couponCode={appliedCoupon?.code || undefined}
                      offerSlug={offerSlug}
                      onPaymentData={(_data) => {}}
                      onPixActionReady={(createFn, loading) => { setCreatePixFn(() => createFn); setIsPixLoading(loading); }}
                      hidePixInitialButton={true}
                    />
                  </div>
                )}

                {/* PaymentMethods para PIX — invisível, só para expor QR code após criar */}
                {selectedPaymentMethod === 'pix' && (
                  <PaymentMethods
                    checkout={checkout}
                    amount={pixFinalAmount}
                    customerData={Object.freeze({
                      name: sanitizeInput(form.watch('name') || ''),
                      email: sanitizeInput(form.watch('email') || ''),
                      document: sanitizeInput(form.watch('document') || ''),
                      phone: sanitizeInput(form.watch('phone') || ''),
                      customerType: 'individual' as const,
                    })}
                    addressData={undefined}
                    showMethodSelector={false}
                    forcedMethod="pix"
                    selectedOrderBumps={selectedOrderBumps}
                    affiliateUid={affiliateUid}
                    couponCode={appliedCoupon?.code || undefined}
                    offerSlug={offerSlug}
                    onPaymentData={(_data) => {}}
                    onPixActionReady={(createFn, loading) => { setCreatePixFn(() => createFn); setIsPixLoading(loading); }}
                    hidePixInitialButton={true}
                  />
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-700">Pagamento</h2>
                  <span className="text-sm text-gray-400">{totalSteps} de {totalSteps}</span>
                </div>
                <p className="text-sm text-gray-400">
                  Preencha suas informações para continuar
                </p>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════
              COL DIREITA — Resumo da compra
          ═══════════════════════════════════════════ */}
          <div className="w-full lg:w-[28%] order-1 lg:order-3">
            <div className="lg:sticky lg:top-6">
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">

                {/* Header */}
                <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                  <h3 className="text-base font-bold text-gray-900">Resumo da compra</h3>
                </div>

                {/* Cupom — sempre visível */}
                <div className="px-5 py-4 border-b border-gray-100">
                  {!appliedCoupon ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Cupom (opcional)"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        className="flex-1 h-9 border border-gray-200 rounded-lg px-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400"
                        disabled={isValidatingCoupon}
                      />
                      <button
                        type="button"
                        onClick={handleApplyCoupon}
                        disabled={isValidatingCoupon || !couponCode.trim()}
                        className="h-9 px-3 text-sm font-semibold text-gray-700 hover:text-gray-900 disabled:opacity-40 transition-colors whitespace-nowrap"
                      >
                        {isValidatingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Adicionar'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-emerald-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Tag className="w-4 h-4 text-emerald-600" />
                        <span className="text-gray-800 text-sm font-medium">{appliedCoupon.code}</span>
                        <span className="text-emerald-600 text-xs">
                          (-{appliedCoupon.type === 'percentage' ? `${appliedCoupon.value}%` : formatPrice(appliedCoupon.value)})
                        </span>
                      </div>
                      <button onClick={handleRemoveCoupon} className="text-gray-400 hover:text-red-500 text-xs ml-2">✕</button>
                    </div>
                  )}
                </div>

                {/* Valores */}
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-500">
                      Produtos ({1 + selectedOrderBumps.length})
                    </span>
                    <span className="text-sm text-gray-700">{formatPrice(baseAmount + orderBumpTotal)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-emerald-700 flex items-center gap-1"><Tag className="w-3 h-3" /> Desconto</span>
                      <span className="text-sm text-emerald-700">-{formatPrice(discount)}</span>
                    </div>
                  )}
                  {selectedPaymentMethod === 'pix' && pixDiscountAmount > 0 && (
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-emerald-700 flex items-center gap-1"><PixIcon className="w-3 h-3" /> Desconto PIX</span>
                      <span className="text-sm text-emerald-700">-{formatPrice(pixDiscountAmount)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-100 mt-3 pt-3 flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-900">Total</span>
                    <span className="text-lg font-bold text-gray-900">
                      {formatPrice(selectedPaymentMethod === 'pix' ? pixFinalAmount : finalAmount)}
                    </span>
                  </div>
                </div>

                {/* Produto principal */}
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    {((checkout as any).imageUrl || checkout.logoUrl) ? (
                      <img
                        src={resolveImageUrl((checkout as any).imageUrl || checkout.logoUrl || '') || ''}
                        alt={checkout.title}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-gray-100"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 border border-gray-100">
                        <Star className="w-5 h-5 text-gray-300" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">{checkout.title}</p>
                      <p className="text-sm font-bold text-gray-800 mt-0.5">{formatPrice(baseAmount)}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">Qtd: 1</span>
                  </div>

                  {/* Order bumps adicionados */}
                  {selectedOrderBumps.length > 0 && selectedOrderBumps.map((bump) => {
                    const bumpProduct = checkout.orderBump?.products?.find(p => p.checkoutId === bump.checkoutId);
                    if (!bumpProduct) return null;
                    return (
                      <div key={bump.checkoutId} className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                        <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Star className="w-5 h-5 text-yellow-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">{bumpProduct.customTitle || bumpProduct.title}</p>
                          <p className="text-xs text-gray-700 font-medium mt-0.5">{formatPrice(bump.price)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Reviews carousel */}
                {testimonials.length > 0 && (
                  <div className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      {testimonials[testimonialsIdx]?.photo ? (
                        <img
                          src={testimonials[testimonialsIdx].photo}
                          alt={testimonials[testimonialsIdx].name}
                          className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm font-semibold text-gray-800">{testimonials[testimonialsIdx]?.name}</span>
                          <div className="flex gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{testimonials[testimonialsIdx]?.description}</p>
                      </div>
                    </div>
                    {testimonials.length > 1 && (
                      <div className="flex items-center justify-between mt-3">
                        <button
                          type="button"
                          onClick={() => setTestimonialsIdx((i) => (i - 1 + testimonials.length) % testimonials.length)}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="flex gap-1">
                          {testimonials.map((_, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setTestimonialsIdx(i)}
                              className={`w-1.5 h-1.5 rounded-full transition-colors ${i === testimonialsIdx ? 'bg-gray-600' : 'bg-gray-200'}`}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setTestimonialsIdx((i) => (i + 1) % testimonials.length)}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          </div>

        </div>
      </div>

      {checkout.exitIntent?.enabled && (
        <ExitIntentPopup
          checkout={checkout}
          originalAmount={baseAmount}
          onClose={() => {}}
          backRedirectUrl={(checkout as any).backRedirectUrl || null}
        />
      )}
    </div>
  );
}
