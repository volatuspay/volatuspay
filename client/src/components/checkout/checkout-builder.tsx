import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

//  FORMATAÇÃO BRASILEIRA PARA VALORES - USANDO FUNÇÃO CENTRAL
import { formatBRL, formatCurrency } from "@/lib/utils";
import { CurrencyConverterDisplay } from "@/components/checkout/currency-converter-display";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Palette, Settings, CreditCard, Globe, Eye, Lock, PlaySquare, RefreshCw, Package, Clock, Rocket, DollarSign, AlertTriangle, Lightbulb, Store, Users, Target, Plus, Trash2, Tag, Percent, Star, Image, BarChart3 } from "lucide-react";
import { insertCheckoutSchema, type InsertCheckout, type Checkout } from "@shared/schema";
import { useTenantStore } from "@/stores/tenant";
import { useToast } from "@/hooks/use-toast";
import { checkCheckoutDeletable, getCheckoutsByTenant } from "@/lib/firestore";
import { ProductOffers } from "@/components/products/product-offers";
import { CouponManager } from "@/components/products/coupon-manager";
import { TestimonialManager } from "@/components/products/testimonial-manager";
import { ImageUpload } from "@/components/ui/image-upload";
import { resolveImageUrl } from "@/lib/image-url";

interface CheckoutBuilderProps {
  checkout?: Checkout;
  onSave: (data: InsertCheckout) => void;
  loading?: boolean;
}

export function CheckoutBuilder({ checkout, onSave, loading }: CheckoutBuilderProps) {
  const { tenant } = useTenantStore();
  const { toast } = useToast();
  const [hasActiveSubscriptions, setHasActiveSubscriptions] = useState(false);
  const [checkingSubscriptions, setCheckingSubscriptions] = useState(true);
  const [priceInput, setPriceInput] = useState("");
  const [productImageUrl, setProductImageUrl] = useState(resolveImageUrl(checkout?.logoUrl) || "");

  // Buscar checkouts existentes para exit intent redirect e order bump
  const { data: checkouts = [] } = useQuery<Checkout[]>({
    queryKey: ["checkouts", tenant?.id],
    queryFn: async () => {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/checkouts?tenantId=${tenant?.id}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Falha ao buscar checkouts');
      const result = await response.json();
      return result.checkouts || [];
    },
    enabled: !!tenant?.id,
    refetchInterval: 60000, // ⚡ OTIMIZADO: 60 segundos (economia de quota)
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // BUSCAR ANALYTICS REAIS DESTE CHECKOUT - OTIMIZADO
  const { data: checkoutAnalyticsResponse } = useQuery<{ success: boolean; analytics: { pageViews: number; formFilled: number; paymentClicked: number; activeNow: number } }>({
    queryKey: [`/api/checkout/${checkout?.id}/analytics`],
    enabled: !!checkout?.id,
    refetchInterval: 60000, // ⚡ OTIMIZADO: 60 segundos (economia de quota)
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
  
  const checkoutAnalytics = checkoutAnalyticsResponse?.analytics || { pageViews: 0, formFilled: 0, paymentClicked: 0, activeNow: 0 };

  // BUSCAR VENDAS REAIS DESTE CHECKOUT (PAGAS E PENDENTES) - 100% REAL DATA
  const { data: checkoutSales } = useQuery({
    queryKey: ["checkout-sales", checkout?.id],
    queryFn: async () => {
      if (!checkout?.id) return { paid: 0, pending: 0 };
      
      try {
        // Importar auth dinamicamente para evitar problemas de ciclo
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth.currentUser;
        
        if (!currentUser) {
          console.warn('⚠️ Usuário não autenticado - não é possível buscar vendas');
          return { paid: 0, pending: 0 };
        }
        
        const token = await currentUser.getIdToken();
        
        const res = await fetch(`/api/checkout/${checkout.id}/sales`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!res.ok) {
          console.error(`❌ Erro ao buscar vendas do checkout: ${res.status}`);
          return { paid: 0, pending: 0 };
        }
        
        const data = await res.json();
        console.log(`✅ Vendas carregadas para checkout ${checkout.id}:`, data.sales);
        return data.sales || { paid: 0, pending: 0 };
      } catch (error) {
        console.error('❌ Erro ao buscar vendas do checkout:', error);
        return { paid: 0, pending: 0 };
      }
    },
    enabled: !!checkout?.id,
    refetchInterval: 60000, // ⚡ OTIMIZADO: 60 segundos
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // Checkouts disponíveis para order bump
  const availableCheckouts = checkouts.filter(c => c.active !== false);

  // Funo para formatar preo - CURRENCY-AWARE
  const formatPrice = (amount: number) => {
    return formatBRL(amount); // Usa a funo determinstica baseada em moeda
  };
  
  // Funo para formatar valor baseado na moeda selecionada - CURRENCY-AWARE
  const formatCurrencyLocal = (value: number, currency: string) => {
    return formatCurrency(value, currency); // Usa a funo determinstica por moeda
  };
  
  // Limites por moeda (em centavos) - REALISTAS PARA CADA MOEDA
  const getCurrencyLimits = (currency: string) => {
    const limits = {
      'USD': { min: 50, max: 99999900 }, // $0.50 - $999,999.00
      'EUR': { min: 50, max: 99999900 }, // 0.50 - 999,999.00
      'GBP': { min: 50, max: 99999900 }, // 0.50 - 999,999.00
      'CAD': { min: 50, max: 99999900 }, // C$0.50 - C$999,999.00
      'AUD': { min: 50, max: 99999900 }, // A$0.50 - A$999,999.00
      'JPY': { min: 50, max: 9999990000 }, // 50 - 99,999,900 (sem decimais)
      'KRW': { min: 500, max: 999999000 }, // 500 - 9,999,990 (sem decimais)
      'CNY': { min: 50, max: 99999900 }, // 0.50 - 999,999.00
      'INR': { min: 50, max: 99999900 }, // 0.50 - 999,999.00
      'BRL': { min: 1, max: 999999900 } // R$0.01 - R$9.999.999,00 (permite qualquer valor)
    };
    
    return limits[currency as keyof typeof limits] || limits.USD;
  };
  
  // Determinar moeda atual baseada na seleo
  const getCurrentCurrency = () => {
    return form.watch("marketTarget") === "brasil" ? "BRL" : (form.watch("globalSettings.currency") || "USD");
  };
  
  //  INICIALIZAR INPUT DE PREÇO (FORMATO BRASILEIRO) - SEMPRE CENTAVOS
  useEffect(() => {
    if (checkout?.pricing?.amount) {
      // SEMPRE ASSUME CENTAVOS: pricing.amount SEMPRE em minor units
      const valueInReais = checkout.pricing.amount / 100;  // Centavos Reais
      
      const brasilianValue = valueInReais.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      setPriceInput(brasilianValue);
    }
  }, [checkout]);

  //  VERIFICAR SE TEM ASSINATURAS ATIVAS PARA BLOQUEAR ALTERAÇÃO
  useEffect(() => {
    const checkActiveSubscriptions = async () => {
      if (!checkout?.id || !tenant?.id) {
        setCheckingSubscriptions(false);
        return;
      }
      
      try {
        console.log('Verificando assinaturas ativas para checkout:', checkout.id);
        const result = await checkCheckoutDeletable(checkout.id, tenant.id);
        
        const hasActive = result.activeCount > 0;
        setHasActiveSubscriptions(hasActive);
        
        if (hasActive) {
          console.log(' CHECKOUT COM ASSINATURAS ATIVAS - BLOQUEANDO ALTERAÇÃO DE TIPO');
          console.log('Assinaturas ativas:', result.activeCount);
        }
      } catch (error) {
        console.error(' Erro ao verificar assinaturas:', error);
      } finally {
        setCheckingSubscriptions(false);
      }
    };
    
    checkActiveSubscriptions();
  }, [checkout?.id, tenant?.id]);

  const form = useForm<InsertCheckout>({
    resolver: zodResolver(insertCheckoutSchema),
    defaultValues: checkout ? {
      tenantId: checkout.tenantId,
      slug: checkout.slug,
      title: checkout.title,
      subtitle: checkout.subtitle,
      logoUrl: checkout.logoUrl,
      theme: checkout.theme,
      fields: {
        ...checkout.fields,
      },
      pricing: checkout.pricing,
      currency: checkout.currency,
      marketTarget: checkout.marketTarget,
      layout: checkout.layout || "classic",
      bannerUrl: checkout.bannerUrl || "",
      globalSettings: checkout.marketTarget === 'global' 
        ? (checkout.globalSettings || {
            language: "en" as const,
            country: "US" as const,
            currency: (checkout.currency || "USD") as "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "JPY" | "KRW" | "CNY" | "INR" | "BRL"
          })
        : (checkout.globalSettings || {
            language: "en" as const,
            country: "US" as const,
            currency: "USD" as const
          }),
      methods: checkout.methods,
      urls: checkout.urls,
      timer: checkout.timer || { enabled: false, title: "Oferta por tempo limitado!", description: "Aproveite antes que acabe!", minutes: 15, color: "#FF4444" },
      exitIntent: checkout.exitIntent || {
        enabled: false,
        type: "text",
        title: " Espera! No vembora!",
        description: "Voctem uma chance nica de adquirir este produto com desconto especial!",
        buttonText: "Aproveitar Oferta",
        buttonUrl: "",
        redirectCheckoutId: "",
        whatsappNumber: "",
        whatsappMessage: "Ol! Vi sua oferta especial e tenho interesse!",
        videoUrl: "",
        backgroundColor: "#dc2626",
        textColor: "#ffffff",
        discountPercent: 0
      },
      banner: checkout.banner || { enabled: false, imageAbove: { enabled: false, imageUrl: "" }, imageBelow: { enabled: false, imageUrl: "" } },
      orderBump: checkout.orderBump || { enabled: false, title: "Oferta Especial Para Voc!", subtitle: "Aproveite esta oferta nica e aumente seu investimento", products: [] },
      showcase: checkout.showcase || {
        enabled: false,
        category: "others",
        shortDescription: "",
        featured: false,
      },
      affiliate: checkout.affiliate || {
        enabled: false,
        autoApprove: true,
        commissionPercent: 10,
      },
      tiktokPixel: (checkout.tiktokPixel && checkout.tiktokPixel !== "undefined") ? checkout.tiktokPixel : "",
      facebookPixel: (checkout.facebookPixel && checkout.facebookPixel !== "undefined") ? checkout.facebookPixel : "",
      googleAdsId: (checkout.googleAdsId && checkout.googleAdsId !== "undefined") ? checkout.googleAdsId : "",
      googleAdsLabel: (checkout.googleAdsLabel && checkout.googleAdsLabel !== "undefined") ? checkout.googleAdsLabel : "",
      pinterestPixel: (checkout.pinterestPixel && checkout.pinterestPixel !== "undefined") ? checkout.pinterestPixel : "",
      kawaiPixel: (checkout.kawaiPixel && checkout.kawaiPixel !== "undefined") ? checkout.kawaiPixel : "",
      active: checkout.active,
      testMode: checkout.testMode,
    } : {
      tenantId: tenant?.id || "",
      slug: `checkout-${Date.now()}-${Math.random().toString(36).substr(2, 12)}-${performance.now().toString().replace('.', '')}`,
      title: "Meu Produto Digital",
      subtitle: "",
      logoUrl: "",
      theme: {
        primary: "#3b82f6",
        secondary: "#1f2937",
      },
      productType: "digital" as const,
      fields: {
        name: { enabled: true, required: true },
        email: { enabled: true, required: true },
        document: { enabled: true, required: true },
        phone: { enabled: true, required: true },
        address: {
          enabled: false,
          required: false,
          street: { enabled: true, required: true },
          number: { enabled: true, required: true },
          complement: { enabled: true, required: false },
          neighborhood: { enabled: true, required: true },
          city: { enabled: true, required: true },
          state: { enabled: true, required: true },
          zipCode: { enabled: true, required: true },
        },
      },
      pricing: {
        type: "fixed" as const,
        amount: 1000, // 10 BRL in cents
        billingType: "one_time",
        guaranteeDays: 7,
      },
      currency: "BRL",
      marketTarget: "brasil" as const,
      layout: "classic" as const,
      bannerUrl: "",
      globalSettings: {
        language: "en",
        country: "US",
        currency: "USD"
      },
      methods: {
        pix: true,
        card: true,
        boleto: false,
      },
      urls: {
        success: "",
        cancel: "",
      },
      timer: { enabled: false, title: "Oferta por tempo limitado!", description: "Aproveite antes que acabe!", minutes: 15, color: "#ffffff", backgroundColor: "#dc2626" },
      exitIntent: {
        enabled: false,
        type: "text" as const,
        title: " Espera! No vembora!",
        description: "Voctem uma chance nica de adquirir este produto com desconto especial!",
        buttonText: "Aproveitar Oferta",
        buttonUrl: "",
        redirectCheckoutId: "",
        whatsappNumber: "",
        whatsappMessage: "Ol! Vi sua oferta especial e tenho interesse!",
        videoUrl: "",
        backgroundColor: "#dc2626",
        textColor: "#ffffff",
        discountPercent: 0
      },
      banner: { enabled: false, imageAbove: { enabled: false, imageUrl: "" }, imageBelow: { enabled: false, imageUrl: "" } },
      orderBump: { enabled: false, title: "Oferta Especial Para Voc!", subtitle: "Aproveite esta oferta nica e aumente seu investimento", products: [] },
      showcase: {
        enabled: false,
        category: "others",
        shortDescription: "",
        featured: false,
      },
      affiliate: {
        enabled: false,
        autoApprove: true,
        commissionPercent: 10,
      },
      tiktokPixel: "",
      facebookPixel: "",
      googleAdsId: "",
      googleAdsLabel: "",
      pinterestPixel: "",
      kawaiPixel: "",
      active: true,
      testMode: false,
    },
  });

  // WATCH FORM VALUES - Corrigido para evitar re-renders infinitos
  const marketTarget = useWatch({ control: form.control, name: "marketTarget" });
  const globalCurrency = useWatch({ control: form.control, name: "globalSettings.currency" });
  
  // BLOCO DE USEWATCH CENTRALIZADO - Evita re-renders infinitos ao usar nas props
  const logoUrl = useWatch({ control: form.control, name: "logoUrl" });
  const bannerUrl = useWatch({ control: form.control, name: "bannerUrl" });
  const methodsPix = useWatch({ control: form.control, name: "methods.pix" });
  const methodsCard = useWatch({ control: form.control, name: "methods.card" });
  const methodsBoleto = useWatch({ control: form.control, name: "methods.boleto" });
  const subscriptionPeriod = useWatch({ control: form.control, name: "pricing.subscriptionPeriod" });
  
  // Timer fields
  const timerEnabled = useWatch({ control: form.control, name: "timer.enabled" });
  const timerTitle = useWatch({ control: form.control, name: "timer.title" });
  const timerDescription = useWatch({ control: form.control, name: "timer.description" });
  const timerMinutes = useWatch({ control: form.control, name: "timer.minutes" });
  const timerColor = useWatch({ control: form.control, name: "timer.color" });
  const timerBackgroundColor = useWatch({ control: form.control, name: "timer.backgroundColor" });
  
  // Banner fields
  const bannerEnabled = useWatch({ control: form.control, name: "banner.enabled" });
  const bannerImageAboveEnabled = useWatch({ control: form.control, name: "banner.imageAbove.enabled" });
  const bannerImageAboveUrl = useWatch({ control: form.control, name: "banner.imageAbove.imageUrl" });
  const bannerImageBelowEnabled = useWatch({ control: form.control, name: "banner.imageBelow.enabled" });
  const bannerImageBelowUrl = useWatch({ control: form.control, name: "banner.imageBelow.imageUrl" });
  
  // Exit Intent fields
  const exitIntentEnabled = useWatch({ control: form.control, name: "exitIntent.enabled" });
  const exitIntentType = useWatch({ control: form.control, name: "exitIntent.type" });
  const exitIntentRedirectCheckoutId = useWatch({ control: form.control, name: "exitIntent.redirectCheckoutId" });
  
  // Order Bump fields
  const orderBumpEnabled = useWatch({ control: form.control, name: "orderBump.enabled" });
  const orderBumpProducts = useWatch({ control: form.control, name: "orderBump.products" });
  
  // Showcase fields
  const showcaseEnabled = useWatch({ control: form.control, name: "showcase.enabled" });
  
  // Affiliate fields
  const affiliateEnabled = useWatch({ control: form.control, name: "affiliate.enabled" });
  const affiliateAutoApprove = useWatch({ control: form.control, name: "affiliate.autoApprove" });
  
  // Fields (para usar nos loops dinmicos de campos)
  const fieldsNameEnabled = useWatch({ control: form.control, name: "fields.name.enabled" });
  const fieldsNameRequired = useWatch({ control: form.control, name: "fields.name.required" });
  const fieldsEmailEnabled = useWatch({ control: form.control, name: "fields.email.enabled" });
  const fieldsEmailRequired = useWatch({ control: form.control, name: "fields.email.required" });
  const fieldsDocumentEnabled = useWatch({ control: form.control, name: "fields.document.enabled" });
  const fieldsDocumentRequired = useWatch({ control: form.control, name: "fields.document.required" });
  const fieldsPhoneEnabled = useWatch({ control: form.control, name: "fields.phone.enabled" });
  const fieldsPhoneRequired = useWatch({ control: form.control, name: "fields.phone.required" });
  
  // Helper object para mapear fields nos loops dinmicos
  const getFieldValue = (field: string, type: 'enabled' | 'required') => {
    const key = `${field}${type.charAt(0).toUpperCase() + type.slice(1)}` as const;
    const fieldValues: Record<string, boolean | undefined> = {
      'nameEnabled': fieldsNameEnabled,
      'nameRequired': fieldsNameRequired,
      'emailEnabled': fieldsEmailEnabled,
      'emailRequired': fieldsEmailRequired,
      'documentEnabled': fieldsDocumentEnabled,
      'documentRequired': fieldsDocumentRequired,
      'phoneEnabled': fieldsPhoneEnabled,
      'phoneRequired': fieldsPhoneRequired,
    };
    return fieldValues[key];
  };
  
  //  AUTO-DEFINIR MTODOS BASEADO NO MARKET TARGET
  useEffect(() => {
    if (marketTarget === "global") {
      //  CHECKOUT GLOBAL: APENAS CARTÃO (STRIPE)
      form.setValue("methods.card", true);
      form.setValue("methods.pix", false);
      console.log(" CHECKOUT GLOBAL - Métodos auto-definidos: Card=TRUE, PIX=FALSE");
    } else if (marketTarget === "brasil") {
      //  CHECKOUT BRASIL: PIX + CARTÃO (EFBANK) - manter seleo do usuário
      console.log(" CHECKOUT BRASIL - Usuário pode escolher PIX/Cartão");
    }
  }, [marketTarget, form]);

  // AUTO-ATUALIZAR CURRENCY QUANDO MOEDA GLOBAL MUDAR
  useEffect(() => {
    if (marketTarget === "global" && globalCurrency) {
      // Atualizar o campo currency principal para refletir a moeda global selecionada
      form.setValue("currency", globalCurrency);
      console.log(`Moeda atualizada automaticamente: ${globalCurrency}`);
    } else if (marketTarget === "brasil") {
      // Brasil sempre usa BRL
      form.setValue("currency", "BRL");
      console.log("Moeda atualizada automaticamente: BRL");
    }
  }, [marketTarget, globalCurrency, form]);

  const handleSubmit = (data: InsertCheckout) => {
    console.log(" CHECKOUT BUILDER - HANDLE SUBMIT CHAMADO!");
    console.log(" Dados capturados do form:", data);
    
    // VALIDAÇÃO: VALOR MNIMO BASEADO NA MOEDA SELECIONADA
    const currentCurrency = data.marketTarget === "brasil" ? "BRL" : (data.globalSettings?.currency || "USD");
    const limits = getCurrencyLimits(currentCurrency);
    
    //  GARANTIR VALORES PADRÃO PARA CHECKOUT GLOBAL
    if (data.marketTarget === "global") {
      //  CHECKOUT GLOBAL: FORÇAR APENAS CARTÃO (STRIPE)
      data.methods = {
        card: true,
        pix: false,
        boleto: false
      };
      
      if (!data.globalSettings) {
        data.globalSettings = {
          language: "en",
          country: "US", 
          currency: currentCurrency
        };
      } else {
        // Garantir que todos os campos existam
        if (!data.globalSettings.language) data.globalSettings.language = "en";
        if (!data.globalSettings.country) data.globalSettings.country = "US";
        if (!data.globalSettings.currency) data.globalSettings.currency = currentCurrency;
      }
      
      //  ATUALIZAR O CAMPO CURRENCY PRINCIPAL PARA REFLETIR A MOEDA GLOBAL
      data.currency = data.globalSettings.currency;
      
      console.log(` CHECKOUT GLOBAL SALVO - Moeda: ${data.currency}, Pas: ${data.globalSettings.country}, Idioma: ${data.globalSettings.language}`);
    } else if (data.marketTarget === "brasil") {
      //  CHECKOUT BRASIL: SEMPRE BRL
      data.currency = "BRL";
      console.log(" CHECKOUT BRASIL SALVO - Moeda: BRL");
    }
    
    if ((data.pricing?.amount ?? 0) < limits.min) {
      const minFormatted = formatCurrency(limits.min, currentCurrency);
      console.log(` Validao falhou - valor menor que ${minFormatted}`);
      toast({
        title: "Valor Invlido",
        description: `O valor do produto precisa ser acima de ${minFormatted}. Ajuste o valor e tente novamente.`,
        variant: "destructive",
      });
      return; // No prosseguir com o salvamento
    }
    
    console.log(` Validao ok (${formatCurrency(data.pricing?.amount ?? 0, currentCurrency)}) - prosseguindo com salvamento`);
    
    console.log(" ENVIANDO DADOS PARA onSave:", data);
    console.log('🔍 DEBUG SHOWCASE FRONTEND: data.showcase =', JSON.stringify(data.showcase, null, 2));
    onSave(data);
  };

  const _platformDomain = import.meta.env.VITE_PLATFORM_DOMAIN || window.location.hostname;
  const previewUrl = form.watch("slug") ? `https://${_platformDomain}/c/${form.watch("slug")}` : "#";

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-6" data-testid="checkout-builder">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-builder-title">
            {checkout ? "Editar Checkout" : "Criar Checkout"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Construa sua página de pagamento personalizada com opes avanadas
          </p>
        </div>
        <div className="flex items-center gap-3 self-stretch sm:self-auto">
          <div className="flex flex-col items-end gap-1">
            <Button 
              type="button"
              disabled={loading}
              data-testid="button-save"
              className="bg-[#2563eb] hover:bg-[#2563eb] text-black font-bold transition-all disabled:opacity-50"
              onClick={async (e) => {
                console.log(" BOTÃO SALVAR CLICADO!");
                e.preventDefault();
                
                console.log(" Capturando dados do form...");
                const formData = form.getValues();
                console.log("Dados capturados:", formData);
                
                console.log("Verificando erros de validao...");
                const errors = form.formState.errors;
                console.log(" Erros encontrados:", errors);
                
                if (Object.keys(errors).length > 0) {
                  console.log(" Há erros de validao - não pode salvar");
                  return;
                }
                
                console.log(" Sem erros - executando handleSubmit diretamente");
                handleSubmit(formData);
              }}
            >
              {loading ? "Salvando..." : checkout ? "SALVAR ALTERAÇES" : "CRIAR CHECKOUT"}
            </Button>
            {checkout && (
              <p className="text-xs text-muted-foreground">
                Clique para salvar mudanas de todas as abas
              </p>
            )}
          </div>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={(e) => {
          console.log(" FORM SUBMIT CHAMADO - PREVENINDO DEFAULT");
          e.preventDefault();
          form.handleSubmit(handleSubmit)();
        }} className="space-y-6">
        <Tabs defaultValue="basic" className="w-full" data-testid="checkout-tabs">
          <div className="overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 flex-nowrap sm:flex-wrap">
            <TabsTrigger value="basic" data-testid="tab-basic" className="text-xs sm:text-sm whitespace-nowrap">
              <Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Básico</span>
              <span className="sm:hidden">Bás</span>
            </TabsTrigger>
            <TabsTrigger value="banner" data-testid="tab-banner" className="text-xs sm:text-sm whitespace-nowrap">
              <Image className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Banner
            </TabsTrigger>
            <TabsTrigger value="analytics" data-testid="tab-analytics" className="text-xs sm:text-sm whitespace-nowrap">
              <BarChart3 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Dados Checkout</span>
              <span className="sm:hidden">Dados</span>
            </TabsTrigger>
            <TabsTrigger value="fields" data-testid="tab-fields" className="text-xs sm:text-sm whitespace-nowrap">
              <Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Campos
            </TabsTrigger>
            <TabsTrigger value="showcase" data-testid="tab-showcase" className="text-xs sm:text-sm whitespace-nowrap">
              <Users className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Afiliados</span>
              <span className="sm:hidden">Afil</span>
            </TabsTrigger>
            <TabsTrigger value="timer" data-testid="tab-timer" className="text-xs sm:text-sm whitespace-nowrap">
              <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Cronômetro</span>
              <span className="sm:hidden">Timer</span>
            </TabsTrigger>
            <TabsTrigger value="orderbump" data-testid="tab-orderbump" className="text-xs sm:text-sm whitespace-nowrap">
              <DollarSign className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden lg:inline">Order Bump</span>
              <span className="lg:hidden">Bump</span>
            </TabsTrigger>
            <TabsTrigger value="urls" data-testid="tab-urls" className="text-xs sm:text-sm whitespace-nowrap">
              <Globe className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              URLs
            </TabsTrigger>
            <TabsTrigger value="pixels" data-testid="tab-pixels" className="text-xs sm:text-sm whitespace-nowrap">
              <Target className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Pixels
            </TabsTrigger>
            <TabsTrigger value="offers" data-testid="tab-offers" className="text-xs sm:text-sm whitespace-nowrap">
              <Tag className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Ofertas</span>
              <span className="sm:hidden">Ofert</span>
            </TabsTrigger>
            <TabsTrigger value="coupons" data-testid="tab-coupons" className="text-xs sm:text-sm whitespace-nowrap">
              <Percent className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Cupons</span>
              <span className="sm:hidden">Cup</span>
            </TabsTrigger>
            <TabsTrigger value="testimonials" data-testid="tab-testimonials" className="text-xs sm:text-sm whitespace-nowrap">
              <Star className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Depoimentos</span>
              <span className="sm:hidden">Depo</span>
            </TabsTrigger>
          </TabsList>
          </div>

          <TabsContent value="basic" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardContent className="p-6 space-y-6">
                {/* URL COMPACTA */}
                <div className="p-4 bg-slate-50 dark:bg-[#f0f4ff]/20 border-2 border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center gap-2 text-sm font-mono text-slate-900 dark:text-white">
                    <Lock className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    <span>{_platformDomain}/c/<span className="font-bold text-[#2563eb]">{form.watch("slug") || "id-gerado-automaticamente"}</span></span>
                  </div>
                </div>
                
                {/* TÍTULO E SUBTÍTULO EM LINHA */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="title" className="text-sm font-semibold text-black dark:text-white mb-2 block">Nome do Produto</Label>
                    <Input
                      id="title"
                      placeholder="Ex: Curso de Marketing Digital"
                      defaultValue="Meu Produto Digital"
                      data-testid="input-title"
                      {...form.register("title")}
                      maxLength={200}
                      className="h-11 bg-white dark:bg-[#f0f4ff]/20 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb]"
                    />
                    {form.formState.errors.title && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1.5" data-testid="error-title">
                        {form.formState.errors.title.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="subtitle" className="text-sm font-semibold text-black dark:text-white mb-2 block">Descrição (opcional)</Label>
                    <Input
                      id="subtitle"
                      placeholder="Ex: Aprenda estratégias avançadas"
                      data-testid="input-subtitle"
                      {...form.register("subtitle")}
                      maxLength={200}
                      className="h-11 bg-white dark:bg-[#f0f4ff]/20 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb]"
                    />
                  </div>
                </div>

                {/* MÉTODOS DE PAGAMENTO COMPACTO */}
                <div className="space-y-3">
                    <Label className="text-sm font-semibold text-black dark:text-white flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      Métodos de Pagamento
                    </Label>
                    <div className="flex flex-wrap gap-3">
                      <label className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border-2 cursor-pointer transition-all ${
                        methodsPix 
                          ? "border-[#2563eb] bg-[#2563eb]/10 text-black dark:text-white" 
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400"
                      }`}>
                        <Checkbox
                          checked={methodsPix}
                          onCheckedChange={(checked) => form.setValue("methods.pix", !!checked)}
                          data-testid="checkbox-pix-method"
                          className="w-4 h-4"
                        />
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="inline">
                          <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#32BCAD" />
                          <path d="M2 17L12 22L22 17" stroke="#32BCAD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M2 12L12 17L22 12" stroke="#32BCAD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        PIX
                      </label>
                      
                      <label className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border-2 cursor-pointer transition-all ${
                        methodsCard 
                          ? "border-[#2563eb] bg-[#2563eb]/10 text-black dark:text-white" 
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400"
                      }`}>
                        <Checkbox
                          checked={methodsCard}
                          onCheckedChange={(checked) => form.setValue("methods.card", !!checked)}
                          data-testid="checkbox-card-method"
                          className="w-4 h-4"
                        />
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="inline">
                          <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
                          <path d="M2 10H22" stroke="currentColor" strokeWidth="2"/>
                          <rect x="5" y="14" width="6" height="2" fill="currentColor"/>
                        </svg>
                        Cartão
                      </label>
                      
                      <label className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border-2 cursor-pointer transition-all ${
                        methodsBoleto 
                          ? "border-[#2563eb] bg-[#2563eb]/10 text-black dark:text-white" 
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400"
                      }`}>
                        <Checkbox
                          checked={methodsBoleto}
                          onCheckedChange={(checked) => form.setValue("methods.boleto", !!checked)}
                          data-testid="checkbox-boleto-method"
                          className="w-4 h-4"
                        />
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="inline">
                          <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
                          <path d="M3 8H21" stroke="currentColor" strokeWidth="2"/>
                          <rect x="6" y="11" width="2" height="6" fill="currentColor"/>
                          <rect x="10" y="11" width="1" height="6" fill="currentColor"/>
                          <rect x="13" y="11" width="2" height="6" fill="currentColor"/>
                          <rect x="17" y="11" width="1" height="6" fill="currentColor"/>
                        </svg>
                        Boleto
                      </label>
                    </div>
                </div>

                {/* AVISO MTODOS DE PAGAMENTO */}
                {!methodsPix && !methodsCard && !methodsBoleto && (
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      <AlertTriangle className="w-4 h-4 text-yellow-700 dark:text-yellow-400 mr-1" /> Selecione pelo menos um método de pagamento
                    </p>
                  </div>
                )}


                {/* TIPO DE PRODUTO */}
                <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base font-bold text-black dark:text-white flex items-center gap-2">
                      <Package className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                      Tipo de Produto
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {checkout ? (
                      //  MODO EDIÇÃO: TIPO IMUTVEL
                      <div className="flex items-center gap-3 p-4 bg-card border rounded-lg">
                        <span className="text-lg">
                          {form.watch("productType") === "digital" && <PlaySquare className="w-4 h-4 text-muted-foreground" />}
                          {form.watch("productType") === "ebook" && <PlaySquare className="w-4 h-4 text-muted-foreground" />}
                          {form.watch("productType") === "subscription" && <RefreshCw className="w-4 h-4 text-muted-foreground" />}
                          {form.watch("productType") === "service" && <Package className="w-4 h-4 text-muted-foreground" />}
                          {form.watch("productType") === "other" && <Package className="w-4 h-4 text-muted-foreground" />}
                        </span>
                        <div className="flex-1">
                          <p className="font-medium">
                            {form.watch("productType") === "digital" && "Produtos Digitais"}
                            {form.watch("productType") === "ebook" && "E-books"}
                            {form.watch("productType") === "subscription" && "Assinatura"}
                            {form.watch("productType") === "service" && "Serviços"}
                            {form.watch("productType") === "other" && "Outros"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Tipo definido permanentemente
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Bloqueado
                        </Badge>
                      </div>
                    ) : (
                      //  MODO CRIAÇÃO: TIPO SELECIONVEL
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[
                          { value: "digital", label: <><PlaySquare className="w-4 h-4 inline mr-2 text-muted-foreground" />Produtos Digitais</>, description: "Cursos, mentorias, infoprodutos" },
                          { value: "ebook", label: <><PlaySquare className="w-4 h-4 inline mr-2 text-muted-foreground" />E-books</>, description: "Livros digitais, PDFs, guides" },
                          { value: "subscription", label: <><RefreshCw className="w-4 h-4 inline mr-2 text-muted-foreground" />Assinatura</>, description: "Serviço recorrente mensal/anual" },
                          { value: "service", label: <><Package className="w-4 h-4 inline mr-2 text-muted-foreground" />Serviços</>, description: "Consultorias, serviços, eventos" },
                          { value: "other", label: <><Package className="w-4 h-4 inline mr-2 text-muted-foreground" />Outros</>, description: "Outros tipos de produtos" }
                        ].map((type) => (
                          <div key={type.value} className="relative">
                            <input
                              type="radio"
                              id={`productType-${type.value}`}
                              value={type.value}
                              {...form.register("productType")}
                              className="sr-only"
                              onChange={(e) => {
                                if (e.target.checked) {
                                  form.setValue("productType", type.value as any);
                                  
                                  // Auto-configurar campos baseado no tipo
                                  if (type.value === "subscription") {
                                    form.setValue("pricing.billingType", "subscription");
                                    form.setValue("pricing.subscriptionPeriod", "monthly");
                                  }
                                }
                              }}
                            />
                            <label
                              htmlFor={`productType-${type.value}`}
                              className={`block p-4 border-2 rounded-lg transition-all cursor-pointer ${
                                form.watch("productType") === type.value
                                  ? "border-[#2563eb] bg-[#2563eb]/10"
                                  : "border-slate-300 dark:border-slate-600 hover:border-slate-400 bg-white dark:bg-[#f0f4ff]/20"
                              }`}
                            >
                              <div className="font-semibold text-sm text-black dark:text-white">{type.label}</div>
                              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{type.description}</div>
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* CONFIGURAÇÃO DE PREÇO - PROFISSIONAL */}
                <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-base font-bold text-black dark:text-white">
                      <DollarSign className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                      <span>Preço do Produto</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="relative">
                        <Input
                          id="amount"
                          type="text"
                          placeholder="0,00"
                          data-testid="input-amount"
                          value={priceInput}
                          className="bg-white dark:bg-[#f0f4ff]/20 border-2 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb] text-xl font-bold text-center h-14 text-black dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-14"
                          onChange={(e) => {
                            let inputValue = e.target.value;
                            const currency = getCurrentCurrency();
                            
                            // Remove tudo exceto nmeros, vrgula e ponto
                            inputValue = inputValue.replace(/[^0-9.,]/g, '');
                            
                            // Atualiza input (aceita formato brasileiro e internacional)
                            setPriceInput(inputValue);
                            
                            // Se vazio, zera
                            if (inputValue === '') {
                              form.setValue("pricing.amount", 0);
                              return;
                            }
                            
                            // Converter para nmero (aceita vrgula como decimal)
                            const cleanValue = inputValue.replace(/\./g, '').replace(',', '.');
                            const numValue = parseFloat(cleanValue);
                            
                            if (!isNaN(numValue)) {
                              // Para JPY e KRW no usar decimais (multiplica por 1)
                              const multiplier = (currency === 'JPY' || currency === 'KRW') ? 1 : 100;
                              form.setValue("pricing.amount", Math.round(numValue * multiplier));
                            }
                          }}
                        />
                        <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-xl font-bold text-slate-600 dark:text-slate-400 pointer-events-none">
                          {getCurrentCurrency() === 'BRL' ? 'R$' : getCurrentCurrency()}
                        </div>
                      </div>
                      
                      <div className="text-center text-xs text-muted-foreground">
                        {(() => {
                          const currency = getCurrentCurrency();
                          const limits = getCurrencyLimits(currency);
                          return `${formatCurrency(limits.min, currency)} - ${formatCurrency(limits.max, currency)}`;
                        })()}
                      </div>
                      
                      {/* CONVERSÃO DE MOEDA EM TEMPO REAL */}
                      {form.watch("marketTarget") === "global" && form.watch("pricing.amount") > 0 && (
                        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                          <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2 flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            Conversão em Tempo Real
                          </div>
                          <CurrencyConverterDisplay
                            amount={form.watch("pricing.amount")}
                            fromCurrency={form.watch("globalSettings.currency") || "USD"}
                            className="space-y-1"
                            showRate={true}
                          />
                          <div className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                            O pagamento serprocessado em BRL automaticamente
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Período de assinatura */}
                    {form.watch("pricing.billingType") === "subscription" && (
                      <div className="space-y-3">
                        <Label>Período da Assinatura</Label>
                        <Select 
                          value={subscriptionPeriod} 
                          onValueChange={(value) => form.setValue("pricing.subscriptionPeriod", value as any)}
                        >
                          <SelectTrigger data-testid="select-subscription-period" className="bg-card">
                            <SelectValue placeholder="Selecione o período" />
                          </SelectTrigger>
                          <SelectContent>
                            {(() => {
                              const currency = getCurrentCurrency();
                              const amount = form.watch("pricing.amount") || 0;
                              const formattedAmount = formatCurrency(amount, currency).replace(/[^\d.,]/g, '').replace(/^[.,]/, '');
                              return (
                                <>
                                  <SelectItem value="monthly">Mensal - {formatCurrency(amount, currency)}/ms</SelectItem>
                                  <SelectItem value="quarterly">Trimestral - {formatCurrency(amount, currency)}/trimestre</SelectItem>
                                  <SelectItem value="semiannual">Semestral - {formatCurrency(amount, currency)}/semestre</SelectItem>
                                  <SelectItem value="annual">Anual - {formatCurrency(amount, currency)}/ano</SelectItem>
                                </>
                              );
                            })()}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </CardContent>
                </Card>


              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="banner" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-black dark:text-white">Imagens do Produto e Checkout</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Configure as imagens que aparecem na vitrine, área de membros e checkout
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* FOTO DO PRODUTO */}
                <div className="space-y-3">
                  <ImageUpload
                    value={productImageUrl}
                    onChange={(url) => {
                      setProductImageUrl(url);
                      form.setValue("logoUrl", url, { shouldDirty: true });
                    }}
                    category="banners"
                    label="Foto do Produto"
                    description="Imagem exibida na vitrine, checkout e em 'Meus Produtos' na area de membros. Recomendado: 800x800px (quadrada)"
                    aspectRatio="1:1"
                    fitMode="contain"
                  />
                </div>

                <Separator />

                {/* BANNER ACIMA DO CHECKOUT */}
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="banner.imageAbove.imageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <ImageUpload
                          value={field.value || ""}
                          onChange={field.onChange}
                          category="banners"
                          label="Banner Acima do Checkout"
                          description="Imagem exibida acima do formulrio de checkout. Recomendado: 1200x675px (16:9 horizontal)"
                          aspectRatio="16:9"
                          fitMode="cover"
                        />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                {/* BANNER ABAIXO DO CHECKOUT */}
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="banner.imageBelow.imageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <ImageUpload
                          value={field.value || ""}
                          onChange={field.onChange}
                          category="banners"
                          label="Banner Abaixo do Checkout"
                          description="Imagem exibida abaixo do formulrio de checkout. Recomendado: 1200x675px (16:9 horizontal)"
                          aspectRatio="16:9"
                          fitMode="cover"
                        />
                      </FormItem>
                    )}
                  />
                </div>

                {/* DICA */}
                <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-950 dark:to-teal-950 border border-emerald-200 dark:border-[#f0f4ff] rounded-lg">
                  <Lightbulb className="h-5 w-5 text-emerald-700 dark:text-blue-300" />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">Dica de Conversão</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      A foto do produto aparece na vitrine e área deb membros. Os banners aumentam conversão no checkout!
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-black dark:text-white">Dados e Métricas do Checkout</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Acompanhe o desempenho e comportamento dos visitantes neste checkout
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* VISITANTES ONLINE AO VIVO - COMPACTO */}
                <Card className="bg-transparent dark:bg-emerald-950/10 border border-blue-300 dark:border-[#f0f4ff]">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                          <p className="text-xs font-medium text-muted-foreground">Visitantes Online Agora</p>
                        </div>
                        <p className="text-2xl sm:text-3xl font-bold text-foreground">
                          {checkoutAnalytics?.activeNow || 0}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Atualiza a cada 5s {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>
                      <Eye className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground opacity-30 flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>

                {/* MTRICAS PRINCIPAIS - GRID RESPONSIVO */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <Card className="bg-transparent dark:bg-emerald-950/10 border border-blue-300 dark:border-[#f0f4ff]">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Visitantes</p>
                          <p className="text-2xl font-bold text-foreground truncate">
                            {checkoutAnalytics?.pageViews || 0}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Total de acessos</p>
                        </div>
                        <Eye className="h-6 w-6 text-muted-foreground opacity-30 flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-transparent dark:bg-emerald-950/10 border border-blue-300 dark:border-[#f0f4ff]">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Formulários</p>
                          <p className="text-2xl font-bold text-foreground truncate">
                            {checkoutAnalytics?.formFilled || 0}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Preenchidos</p>
                        </div>
                        <Settings className="h-6 w-6 text-muted-foreground opacity-30 flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-transparent dark:bg-emerald-950/10 border border-blue-300 dark:border-[#f0f4ff]">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Cliques</p>
                          <p className="text-2xl font-bold text-foreground truncate">
                            {checkoutAnalytics?.paymentClicked || 0}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Botão pagamento</p>
                        </div>
                        <CreditCard className="h-6 w-6 text-muted-foreground opacity-30 flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* VENDAS REAIS - GRID RESPONSIVO */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Card className="bg-transparent dark:bg-emerald-950/10 border border-emerald-300 dark:border-[#f0f4ff]">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">Vendas Pagas</p>
                          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 truncate">
                            {checkoutSales?.paid || 0}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Confirmadas</p>
                        </div>
                        <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-400 opacity-30 flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-transparent dark:bg-orange-950/10 border border-orange-300 dark:border-orange-800">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-orange-600 dark:text-orange-400 mb-1">Vendas Pendentes</p>
                          <p className="text-2xl font-bold text-orange-700 dark:text-orange-300 truncate">
                            {checkoutSales?.pending || 0}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Aguardando confirmação</p>
                        </div>
                        <Clock className="h-6 w-6 text-orange-600 dark:text-orange-400 opacity-30 flex-shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* INFORMAÇÃO */}
                <div className="flex items-center gap-3 p-4 bg-transparent dark:bg-emerald-950/10 border border-blue-300 dark:border-[#f0f4ff] rounded-lg">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">Métricas em Tempo Real</p>
                    <p className="text-sm text-muted-foreground">
                      Visitantes, interações e vendas reais (pagas e pendentes) são atualizados automaticamente a cada 5 segundos.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fields" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-black dark:text-white">Campos do Formulário</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Configure quais campos mostrar e exigir dos clientes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* TODOS OS CAMPOS CONFIGURÁVEIS */}
                {Object.entries({
                  document: "CPF/CNPJ",
                  name: "Nome Completo",
                  email: "Endereço de E-mail",
                  phone: "Número de Telefone"
                }).map(([field, label]) => (
                  <div key={field} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-sm text-muted-foreground">
                        {field === 'document' ? 'Documento do cliente (CPF ou CNPJ)' :
                         field === 'email' ? 'Obrigatório para confirmação do pedido' : 
                         field === 'name' ? 'Identificao do cliente' : 
                         `${label.toLowerCase()} opcional`}
                      </p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id={`${field}-enabled`}
                          checked={getFieldValue(field, 'enabled')}
                          onCheckedChange={(checked) => 
                            form.setValue(`fields.${field}.enabled` as any, checked)
                          }
                          data-testid={`switch-${field}-enabled`}
                        />
                        <Label htmlFor={`${field}-enabled`}>Mostrar</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id={`${field}-required`}
                          checked={getFieldValue(field, 'required')}
                          onCheckedChange={(checked) => 
                            form.setValue(`fields.${field}.required` as any, checked)
                          }
                          disabled={!getFieldValue(field, 'enabled')}
                          data-testid={`switch-${field}-required`}
                        />
                        <Label htmlFor={`${field}-required`}>Obrigatório</Label>
                      </div>
                    </div>
                  </div>
                ))}

              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="timer" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-black dark:text-white">Cronômetro de Urgência</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Configure um cronômetro para criar urgência na sua oferta
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Ativar Cronmetro</p>
                    <p className="text-sm text-muted-foreground">
                      Mostra contagem regressiva no checkout
                    </p>
                  </div>
                  <Switch
                    id="timer-enabled"
                    checked={timerEnabled}
                    onCheckedChange={(checked) => form.setValue("timer.enabled", checked)}
                    data-testid="switch-timer-enabled"
                  />
                </div>

                {timerEnabled && (
                  <>
                    <Separator />
                    
                    <div>
                      <Label htmlFor="timer-title" className="text-sm font-semibold text-black dark:text-white mb-2 block">Título do Cronômetro</Label>
                      <Input
                        id="timer-title"
                        placeholder="Oferta por tempo limitado!"
                        value={timerTitle}
                        onChange={(e) => form.setValue("timer.title", e.target.value)}
                        data-testid="input-timer-title"
                        maxLength={200}
                        className="h-11 bg-white dark:bg-[#f0f4ff]/20 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb]"
                      />
                    </div>

                    <div>
                      <Label htmlFor="timer-description" className="text-sm font-semibold text-black dark:text-white mb-2 block">Descrição</Label>
                      <Textarea
                        id="timer-description"
                        placeholder="Aproveite antes que acabe!"
                        value={timerDescription}
                        onChange={(e) => form.setValue("timer.description", e.target.value)}
                        data-testid="input-timer-description"
                        maxLength={200}
                        className="bg-white dark:bg-[#f0f4ff]/20 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb]"
                      />
                    </div>

                    <div>
                      <Label htmlFor="timer-minutes" className="text-sm font-semibold text-black dark:text-white mb-2 block">Tempo (minutos)</Label>
                      <Input
                        id="timer-minutes"
                        type="number"
                        min="1"
                        placeholder="15"
                        value={timerMinutes}
                        onChange={(e) => form.setValue("timer.minutes", parseInt(e.target.value) || 15)}
                        data-testid="input-timer-minutes"
                        className="h-11 bg-white dark:bg-[#f0f4ff]/20 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb]"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="timer-color">Cor do Texto</Label>
                        <Input
                          id="timer-color"
                          type="color"
                          value={timerColor}
                          onChange={(e) => form.setValue("timer.color", e.target.value)}
                          data-testid="input-timer-color"
                        />
                      </div>
                      <div>
                        <Label htmlFor="timer-bg-color">Cor de Fundo</Label>
                        <Input
                          id="timer-bg-color"
                          type="color"
                          value={timerBackgroundColor}
                          onChange={(e) => form.setValue("timer.backgroundColor", e.target.value)}
                          data-testid="input-timer-bg-color"
                        />
                      </div>
                    </div>

                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="urls" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-black dark:text-white">URLs de Redirecionamento</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Configure para onde clientes são redirecionados após o pagamento
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label htmlFor="successUrl" className="text-sm font-semibold text-black dark:text-white mb-2 block">URL de Sucesso (Opcional)</Label>
                  <Input
                    id="successUrl"
                    type="url"
                    placeholder="https://exemplo.com/sucesso"
                    data-testid="input-success-url"
                    {...form.register("urls.success")}
                    className="h-11 bg-white dark:bg-[#f0f4ff]/20 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb]"
                  />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5">
                    Para onde redirecionar clientes após pagamento bem-sucedido
                  </p>
                </div>

                <div>
                  <Label htmlFor="cancelUrl" className="text-sm font-semibold text-black dark:text-white mb-2 block">URL de Cancelamento (Opcional)</Label>
                  <Input
                    id="cancelUrl"
                    type="url"
                    placeholder="https://exemplo.com/cancelar"
                    data-testid="input-cancel-url"
                    {...form.register("urls.cancel")}
                    className="h-11 bg-white dark:bg-[#f0f4ff]/20 border-slate-300 dark:border-slate-700 focus:border-[#2563eb] focus:ring-[#2563eb]"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Para onde redirecionar clientes se o pagamento for cancelado
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* EXIT INTENT POPUP */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span></span>
                  Exit Intent Popup
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Toggle Principal */}
                  <div className="flex items-center space-x-2">
                    <Switch 
                      checked={exitIntentEnabled}
                      onCheckedChange={(checked) => form.setValue("exitIntent.enabled", checked)}
                      data-testid="switch-exit-intent"
                    />
                    <Label>Ativar Exit Intent Popup</Label>
                  </div>

                  {exitIntentEnabled && (
                    <div className="space-y-6">
                      {/* Tipo de Popup */}
                      <div className="space-y-3">
                        <Label>Tipo de Popup</Label>
                        <Select 
                          value={exitIntentType} 
                          onValueChange={(value) => form.setValue("exitIntent.type", value as "text" | "video" | "whatsapp")}
                        >
                          <SelectTrigger data-testid="select-exit-intent-type" className="bg-card">
                            <SelectValue placeholder="Escolha o tipo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text"> Texto + Botão</SelectItem>
                            <SelectItem value="video">Vdeo + Botão</SelectItem>
                            <SelectItem value="whatsapp"> Botão WhatsApp</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Configurações Básicas */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <Label htmlFor="exit-title">Ttulo</Label>
                          <Input
                            id="exit-title"
                            placeholder=" Espera! No vembora!"
                            {...form.register("exitIntent.title")}
                            data-testid="input-exit-title"
                            className="bg-card"
                            maxLength={200}
                          />
                        </div>
                        <div className="space-y-3">
                          <Label htmlFor="exit-discount">Desconto % (0-90)</Label>
                          <Input
                            id="exit-discount"
                            type="number"
                            min="0"
                            max="90"
                            placeholder="0"
                            {...form.register("exitIntent.discountPercent", { valueAsNumber: true })}
                            data-testid="input-exit-discount"
                            className="bg-card"
                          />
                        </div>
                      </div>

                      {/* Descrição */}
                      <div className="space-y-3">
                        <Label htmlFor="exit-description">Descrição</Label>
                        <Textarea
                          id="exit-description"
                          placeholder="Voctem uma chance nica de adquirir este produto com desconto especial!"
                          rows={2}
                          {...form.register("exitIntent.description")}
                          data-testid="textarea-exit-description"
                          className="bg-card"
                          maxLength={200}
                        />
                      </div>

                      {/* Configurações por Tipo */}
                      {exitIntentType === "text" && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-3">
                              <Label htmlFor="exit-button-text">Texto do Botão</Label>
                              <Input
                                id="exit-button-text"
                                placeholder="Aproveitar Oferta"
                                {...form.register("exitIntent.buttonText")}
                                data-testid="input-exit-button-text"
                                className="bg-card"
                                maxLength={200}
                              />
                            </div>
                            <div className="space-y-3">
                              <Label htmlFor="exit-button-url">URL do Botão</Label>
                              <Input
                                id="exit-button-url"
                                type="url"
                                placeholder="https://exemplo.com/oferta"
                                {...form.register("exitIntent.buttonUrl")}
                                data-testid="input-exit-button-url"
                                className="bg-card"
                                maxLength={200}
                              />
                            </div>
                          </div>
                          
                          <div className="space-y-3">
                            <Label htmlFor="exit-redirect-checkout">Redirecionar para outro produto (Order Bump)</Label>
                            <Select
                              value={exitIntentRedirectCheckoutId || "none"}
                              onValueChange={(value) => {
                                form.setValue("exitIntent.redirectCheckoutId", value === "none" ? "" : value);
                                if (value && value !== "none") {
                                  const selectedCheckout = checkouts.find(c => c.id === value);
                                  if (selectedCheckout) {
                                    form.setValue("exitIntent.buttonUrl", `${window.location.origin}/checkout/${selectedCheckout.slug}`);
                                  }
                                }
                              }}
                            >
                              <SelectTrigger data-testid="select-exit-redirect-checkout" className="bg-card">
                                <SelectValue placeholder="Nenhum redirecionamento" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Nenhum redirecionamento</SelectItem>
                                {checkouts
                                  .filter(c => c.id !== checkout?.id)
                                  .map(checkout => (
                                  <SelectItem key={checkout.id} value={checkout.id}>
                                    {checkout.title} - {formatPrice(checkout.pricing?.amount ?? 0)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            
                            {/* MOSTRAR NOME DO CHECKOUT SELECIONADO */}
                            {exitIntentRedirectCheckoutId && exitIntentRedirectCheckoutId !== "none" && (() => {
                              const selectedCheckout = checkouts.find(c => c.id === exitIntentRedirectCheckoutId);
                              return selectedCheckout ? (
                                <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                                  <Badge variant="outline" className="bg-emerald-100 text-[#f0f4ff] border-emerald-300">
                                    Redirecionando para
                                  </Badge>
                                  <span className="font-semibold text-emerald-900">
                                    {selectedCheckout.title}
                                  </span>
                                  <span className="text-sm text-emerald-700">
                                    ({formatPrice(selectedCheckout.pricing?.amount ?? 0)})
                                  </span>
                                </div>
                              ) : null;
                            })()}
                            
                            <p className="text-xs text-muted-foreground">
                              Quando selecionado, o botão principal redirecionarpara outro checkout seus como order bump
                            </p>
                          </div>

                          <div className="space-y-3">
                            <Label htmlFor="exit-text-color">Cor do Texto</Label>
                            <div className="flex items-center gap-3">
                              <Input
                                id="exit-text-color"
                                type="color"
                                {...form.register("exitIntent.textColor")}
                                data-testid="input-exit-text-color"
                                className="w-16 h-10 bg-card"
                              />
                              <p className="text-xs text-muted-foreground flex-1">
                                Fundo sempre branco para mxima legibilidade e conversão
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {exitIntentType === "video" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <Label htmlFor="exit-video-url">URL do Vdeo</Label>
                            <Input
                              id="exit-video-url"
                              type="url"
                              placeholder="https://youtube.com/watch?v=..."
                              {...form.register("exitIntent.videoUrl")}
                              data-testid="input-exit-video-url"
                              className="bg-card"
                            />
                          </div>
                          <div className="space-y-3">
                            <Label htmlFor="exit-video-button-url">URL do Botão</Label>
                            <Input
                              id="exit-video-button-url"
                              type="url"
                              placeholder="https://exemplo.com/oferta"
                              {...form.register("exitIntent.buttonUrl")}
                              data-testid="input-exit-video-button-url"
                              className="bg-card"
                            />
                          </div>
                        </div>
                      )}

                      {exitIntentType === "whatsapp" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <Label htmlFor="exit-whatsapp-number">Número WhatsApp</Label>
                            <Input
                              id="exit-whatsapp-number"
                              placeholder="5511999999999"
                              {...form.register("exitIntent.whatsappNumber")}
                              data-testid="input-exit-whatsapp-number"
                              className="bg-card"
                            />
                          </div>
                          <div className="space-y-3">
                            <Label htmlFor="exit-whatsapp-message">Mensagem Inicial</Label>
                            <Input
                              id="exit-whatsapp-message"
                              placeholder="Ol! Vi sua oferta especial..."
                              {...form.register("exitIntent.whatsappMessage")}
                              data-testid="input-exit-whatsapp-message"
                              className="bg-card"
                            />
                          </div>
                        </div>
                      )}

                      {/* Dica Final */}
                      <div className="flex items-center gap-3 p-4 bg-card border rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium">Dica de Conversão</p>
                          <p className="text-xs text-muted-foreground">
                            Este popup aparece quando o cliente tenta sair e pode aumentar sua conversão em até 30%!
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="orderbump" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg font-bold text-black dark:text-white">
                  <Package className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  Order Bump - Produtos Reais
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Adicione produtos reais do seu catálogo como order bump para aumentar o ticket médio
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Switch 
                    checked={orderBumpEnabled}
                    onCheckedChange={(checked) => form.setValue("orderBump.enabled", checked)}
                    data-testid="switch-orderbump-enabled"
                  />
                  <Label>Ativar order bump</Label>
                </div>
                
                {orderBumpEnabled && (
                  <div className="space-y-6">
                    
                    {/*  CONFIGURAÇES GERAIS DO ORDER BUMP */}
                    <div className="space-y-4">
                      <h4 className="font-semibold text-foreground">Configurações Gerais</h4>
                      
                      <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="orderbump-title">Ttulo Principal</Label>
                          <Input
                            id="orderbump-title"
                            placeholder="Oferta Especial Para Voc!"
                            {...form.register("orderBump.title")}
                            data-testid="input-orderbump-title"
                            className="bg-card"
                            maxLength={200}
                          />
                          <p className="text-xs text-muted-foreground">
                            Ttulo que aparece no topo da seção de order bump
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="orderbump-subtitle">Subttulo Explicativo</Label>
                          <Input
                            id="orderbump-subtitle"
                            placeholder="Aproveite esta oferta nica e aumente seu investimento"
                            {...form.register("orderBump.subtitle")}
                            data-testid="input-orderbump-subtitle"
                            className="bg-card"
                            maxLength={200}
                          />
                          <p className="text-xs text-muted-foreground">
                            Texto explicativo que aparece abaixo do ttulo
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    {/*  LISTA DE PRODUTOS PARA ORDER BUMP */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-foreground">Produtos Selecionados para Order Bump</h4>
                        <Badge variant="outline" className="text-xs">
                          {orderBumpProducts?.length || 0} produtos
                        </Badge>
                      </div>
                      
                      {/* Desconto: SELETOR DE PRODUTOS DO SELLER */}
                      <div className="p-4 border border-dashed border rounded-lg bg-muted/30">
                        <div className="space-y-3">
                          <h5 className="font-medium text-gray-800 flex items-center gap-2">
                            <Plus className="h-4 w-4" />
                            Adicionar Produto Real do Seu Catlogo
                          </h5>
                          <p className="text-sm text-muted-foreground">
                            Selecione produtos criados por vocpara oferecer como order bump
                          </p>
                          
                          {/* LISTA DE CHECKOUTS DISPONVEIS */}
                          {availableCheckouts && availableCheckouts.length > 0 ? (
                            <div className="grid grid-cols-1 gap-3 max-h-60 overflow-y-auto">
                              {availableCheckouts
                                .filter((checkoutItem: Checkout) => checkoutItem.id !== checkout?.id) // Excluir checkout atual
                                .filter((checkoutItem: Checkout) => !orderBumpProducts?.some(p => p.checkoutId === checkoutItem.id)) // Excluir jselecionados
                                .map((checkoutItem: Checkout) => (
                                <div key={checkoutItem.id} className="p-3 bg-card border rounded-lg hover:shadow-sm transition-shadow">
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <h6 className="font-medium text-foreground text-sm">{checkoutItem.title}</h6>
                                      <p className="text-xs text-muted-foreground mt-1">{checkoutItem.subtitle || 'Sem descrição'}</p>
                                      <div className="flex items-center gap-2 mt-2">
                                        <span className="text-lg font-bold text-muted-foreground">
                                          R$ {((checkoutItem.pricing?.amount || 0) / 100).toFixed(2)}
                                        </span>
                                        {checkoutItem.methods?.pix && (
                                          <Badge variant="outline" className="text-xs">PIX</Badge>
                                        )}
                                        {checkoutItem.methods?.card && (
                                          <Badge variant="outline" className="text-xs">Cartão</Badge>
                                        )}
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        const currentProducts = orderBumpProducts || [];
                                        const newProduct = {
                                          checkoutId: checkoutItem.id,
                                          title: checkoutItem.title,
                                          description: checkoutItem.subtitle || "",
                                          price: checkoutItem.pricing?.amount || 0,
                                          originalPrice: checkoutItem.pricing?.amount || 0,
                                          imageUrl: "",
                                          discount: 0
                                        };
                                        form.setValue("orderBump.products", [...currentProducts, newProduct]);
                                      }}
                                      className="shrink-0"
                                    >
                                      <Plus className="h-3 w-3 mr-1" />
                                      Adicionar
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-6 text-muted-foreground">
                              <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
                              <p className="text-sm">Nenhum produto disponível para order bump</p>
                              <p className="text-xs">Crie mais checkouts para adicionar como order bump</p>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/*  PRODUTOS SELECIONADOS */}
                      {orderBumpProducts && orderBumpProducts.length > 0 && (
                        <div className="space-y-3">
                          <h5 className="font-medium text-gray-800">Produtos Configurados</h5>
                          {orderBumpProducts.map((product, index) => (
                            <div key={index} className="p-4 bg-card border rounded-lg">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex-1">
                                  <h6 className="font-medium text-foreground">{product.title}</h6>
                                  <p className="text-sm text-muted-foreground">{product.description}</p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    const currentProducts = orderBumpProducts || [];
                                    const filteredProducts = currentProducts.filter((_, i) => i !== index);
                                    form.setValue("orderBump.products", filteredProducts);
                                  }}
                                  className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>

                              {/* CAMPOS DE CUSTOMIZAÇÃO DO PRODUTO */}
                              <div className="space-y-3 mb-4 p-2 sm:p-3 bg-muted/20 rounded-lg border">
                                <Label className="text-xs sm:text-sm font-medium text-foreground">Personalizar no Order Bump</Label>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Ttulo Customizado</Label>
                                    <Input
                                      value={product.customTitle || product.title}
                                      onChange={(e) => {
                                        const currentProducts = orderBumpProducts || [];
                                        const updatedProducts = [...currentProducts];
                                        updatedProducts[index] = {
                                          ...updatedProducts[index],
                                          customTitle: e.target.value
                                        };
                                        form.setValue("orderBump.products", updatedProducts);
                                      }}
                                      className="h-8 text-xs"
                                      placeholder="Ex: Bnus Exclusivo"
                                    />
                                  </div>
                                  
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Imagem (opcional)</Label>
                                    {product.imageUrl ? (
                                      <div className="relative w-16 h-16 sm:w-20 sm:h-20">
                                        <img
                                          src={resolveImageUrl(product.imageUrl) || ''}
                                          alt="Preview"
                                          className="w-full h-full object-cover rounded border"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const currentProducts = orderBumpProducts || [];
                                            const updatedProducts = [...currentProducts];
                                            updatedProducts[index] = {
                                              ...updatedProducts[index],
                                              imageUrl: ""
                                            };
                                            form.setValue("orderBump.products", updatedProducts);
                                          }}
                                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-sm hover:bg-red-600 shadow-md"
                                        >
                                                                                  </button>
                                      </div>
                                    ) : (
                                      <ImageUpload
                                        value={product.imageUrl || ""}
                                        onChange={(url) => {
                                          const currentProducts = orderBumpProducts || [];
                                          const updatedProducts = [...currentProducts];
                                          updatedProducts[index] = {
                                            ...updatedProducts[index],
                                            imageUrl: url
                                          };
                                          form.setValue("orderBump.products", updatedProducts, { shouldDirty: true });
                                        }}
                                        category="products"
                                        label=""
                                        description=""
                                        className="h-8 text-xs"
                                      />
                                    )}
                                  </div>
                                </div>
                                
                                <div className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">Descrição Customizada</Label>
                                  <textarea
                                    value={product.customDescription || product.description}
                                    onChange={(e) => {
                                      const currentProducts = orderBumpProducts || [];
                                      const updatedProducts = [...currentProducts];
                                      updatedProducts[index] = {
                                        ...updatedProducts[index],
                                        customDescription: e.target.value
                                      };
                                      form.setValue("orderBump.products", updatedProducts);
                                    }}
                                    className="min-h-[60px] w-full px-3 py-2 text-xs border border-input bg-background rounded resize-none"
                                    placeholder="Descrição que aparecerá no order bump..."
                                    rows={2}
                                  />
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">Desconto (%)</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    max="90"
                                    value={product.discount}
                                    onChange={(e) => {
                                      const currentProducts = orderBumpProducts || [];
                                      const updatedProducts = [...currentProducts];
                                      const discount = parseInt(e.target.value) || 0;
                                      updatedProducts[index] = {
                                        ...updatedProducts[index],
                                        discount,
                                        price: Math.round((product.originalPrice || 0) * (100 - discount) / 100)
                                      };
                                      form.setValue("orderBump.products", updatedProducts);
                                    }}
                                    className="h-8 text-xs"
                                    placeholder="0"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Preo Original</Label>
                                  <div className="h-8 px-2 sm:px-3 py-1 bg-muted/30 border rounded text-xs flex items-center justify-center">
                                    R$ {((product.originalPrice || 0) / 100).toFixed(2)}
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Preo Final</Label>
                                  <div className="h-8 px-2 sm:px-3 py-1 bg-emerald-50 border border-emerald-200 rounded text-xs flex items-center justify-center font-bold text-muted-foreground">
                                    R$ {(product.price / 100).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA VITRINE */}
          <TabsContent value="showcase" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-bold text-black dark:text-white">Configurações da Vitrine</CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Configure se o produto aparece na vitrine pública e suas categorias
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Switch 
                    checked={showcaseEnabled || false}
                    onCheckedChange={(checked) => form.setValue("showcase.enabled", checked)}
                    data-testid="switch-showcase-enabled"
                  />
                  <Label>Exibir na vitrine pblica</Label>
                </div>
                
                {form.watch("showcase.enabled") && (
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="showcase.category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Categoria</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "others"}>
                            <FormControl>
                              <SelectTrigger data-testid="select-showcase-category">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="digital">Produtos Digitais</SelectItem>
                              <SelectItem value="courses">Cursos Online</SelectItem>
                              <SelectItem value="ebooks">E-books</SelectItem>
                              <SelectItem value="software">Softwares</SelectItem>
                              <SelectItem value="subscriptions">Assinaturas</SelectItem>
                              <SelectItem value="services">Serviços</SelectItem>
                              <SelectItem value="others">Outros</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    
                    <div className="space-y-2">
                      <Label htmlFor="showcase-description">Descrição curta para vitrine</Label>
                      <Textarea
                        id="showcase-description"
                        placeholder="Descrição atrativa que aparecerá na vitrine pblica..."
                        {...form.register("showcase.shortDescription")}
                        data-testid="input-showcase-description"
                      />
                    </div>
                    

                    {/* CONFIGURAÇÃO DE COMISSÃO NA VITRINE */}
                    <div className="space-y-4 p-4 bg-emerald-50 border border-border rounded-lg">
                      <h4 className="font-semibold text-foreground">Sistema de Afiliados</h4>
                      
                      {/* Nome do Vendedor para Vitrine */}
                      <div className="space-y-2">
                        <Label htmlFor="seller-display-name">Nome do Vendedor (Vitrine Pblica)</Label>
                        <Input
                          id="seller-display-name"
                          placeholder="Nome que aparece no card do produto na vitrine (opcional)"
                          {...form.register("sellerDisplayName")}
                          data-testid="input-seller-display-name"
                          maxLength={100}
                        />
                        <p className="text-xs text-muted-foreground">
                          Se não preencher, será usado o nome da sua empresa. Este nome aparecerá para afiliados e clientes na vitrine pblica.
                        </p>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Switch 
                          checked={affiliateEnabled || false}
                          onCheckedChange={(checked) => {
                            form.setValue("affiliate.enabled", checked);
                            // Se desabilitar, resetar campos
                            if (!checked) {
                              form.setValue("affiliate.commissionPercent", 0);
                            } else {
                              // Se habilitar e não tiver valor, definir padrão
                              if (!form.watch("affiliate.commissionPercent")) {
                                form.setValue("affiliate.commissionPercent", 10);
                              }
                            }
                          }}
                          data-testid="switch-affiliate-vitrine"
                        />
                        <Label>Permitir afiliados para este produto</Label>
                      </div>

                      {affiliateEnabled && (
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="affiliate-commission-vitrine">Comisso dos afiliados (%)</Label>
                            <div className="flex items-center space-x-2">
                              <Input
                                id="affiliate-commission-vitrine"
                                type="number"
                                min="1"
                                max="50"
                                placeholder="10"
                                {...form.register("affiliate.commissionPercent", { valueAsNumber: true })}
                                data-testid="input-affiliate-commission-vitrine"
                                className="flex-1"
                              />
                              <span className="text-sm text-muted-foreground font-medium">%</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Percentual que o afiliado receberpor cada venda (1% a 50%)
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label>Aprovação de afiliados</Label>
                            <div className="space-y-3">
                              <div className="flex items-center space-x-2">
                                <input
                                  type="radio"
                                  id="auto-approve"
                                  name="affiliate-approval"
                                  checked={affiliateAutoApprove !== false}
                                  onChange={() => form.setValue("affiliate.autoApprove", true)}
                                  className="w-4 h-4 text-emerald-700"
                                />
                                <Label htmlFor="auto-approve" className="text-sm">
                                  Aprovar automaticamente todos os afiliados
                                </Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <input
                                  type="radio"
                                  id="manual-approve"
                                  name="affiliate-approval"
                                  checked={affiliateAutoApprove === false}
                                  onChange={() => form.setValue("affiliate.autoApprove", false)}
                                  className="w-4 h-4 text-emerald-700"
                                />
                                <Label htmlFor="manual-approve" className="text-sm">
                                  Aprovar manualmente cada solicitao
                                </Label>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {affiliateAutoApprove !== false 
                                ? "Novos afiliados podero divulgar seu produto imediatamente"
                                : "Vocrecebernotificações para aprovar cada novo afiliado"
                              }
                            </p>
                          </div>

                          {form.watch("affiliate.commissionPercent") && form.watch("pricing.amount") && (
                            <div className="p-3 bg-background border border-border rounded">
                              <p className="text-sm text-muted-foreground mb-1">Simulao de ganhos:</p>
                              <div className="text-xs text-muted-foreground space-y-1">
                                <div>Preo: <span className="font-bold">{formatCurrency(form.watch("pricing.amount"), form.watch("currency") || "BRL")}</span></div>
                                <div>Comisso por venda: <span className="font-bold text-primary">
                                  {formatCurrency(
                                    Math.floor((form.watch("pricing.amount") || 0) * (form.watch("affiliate.commissionPercent") || 0) / 100),
                                    form.watch("currency") || "BRL"
                                  )}
                                </span></div>
                              </div>
                            </div>
                          )}

                          {/* LINKS DE AFILIAÇÃO */}
                          <div className="p-3 bg-emerald-50 border border-blue-200 rounded-lg">
                              <h6 className="font-medium text-muted-foreground mb-2">Links de Afiliao</h6>
                              <div className="space-y-2 text-sm">
                                <div>
                                  <strong className="text-muted-foreground">Link do produto:</strong>
                                  <code className="ml-2 px-2 py-1 bg-card rounded text-muted-foreground text-xs">
                                    {`https://${_platformDomain}/c/${form.watch("slug") || "seu-produto"}`}
                                  </code>
                                </div>
                                <div>
                                  <strong className="text-muted-foreground">Link para se tornar afiliado:</strong>
                                  <code className="ml-2 px-2 py-1 bg-card rounded text-muted-foreground text-xs">
                                    {`https://${_platformDomain}/affiliate/${form.watch("slug") || "seu-produto"}`}
                                  </code>
                                </div>
                              </div>
                            </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pixels" className="space-y-6 mt-11">
            <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg font-bold text-black dark:text-white">
                  <Target className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  Pixels de Rastreamento
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  Configure pixels de rastreamento para acompanhar conversões e otimizar seus anúncios
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                {/* TikTok Pixel */}
                <div className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-black rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">T</span>
                    </div>
                    <h3 className="font-semibold">TikTok Pixel</h3>
                  </div>
                  <FormField
                    control={form.control}
                    name="tiktokPixel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pixel ID do TikTok</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Ex: C9J8K7L6M5N4"
                            data-testid="input-tiktok-pixel"
                          />
                        </FormControl>
                        <FormDescription>
                          ID do pixel encontrado no TikTok Ads Manager
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Facebook Pixel */}
                <div className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">f</span>
                    </div>
                    <h3 className="font-semibold">Facebook Pixel</h3>
                  </div>
                  <FormField
                    control={form.control}
                    name="facebookPixel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pixel ID do Facebook</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Ex: 123456789012345"
                            data-testid="input-facebook-pixel"
                          />
                        </FormControl>
                        <FormDescription>
                          ID do pixel encontrado no Facebook Business Manager
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Google Ads */}
                <div className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">G</span>
                    </div>
                    <h3 className="font-semibold">Google Ads</h3>
                  </div>
                  <div className="space-y-3">
                    <FormField
                      control={form.control}
                      name="googleAdsId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ID de Conversão</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Ex: AW-123456789"
                              data-testid="input-google-ads-id"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="googleAdsLabel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Rtulo de Conversão</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Ex: abc123def456"
                              data-testid="input-google-ads-label"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p className="text-sm text-muted-foreground">
                      Encontrados no Google Ads em Ferramentas Converses
                    </p>
                  </div>
                </div>

                {/* Kwai Ads */}
                <div className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">K</span>
                    </div>
                    <h3 className="font-semibold">Kwai Ads</h3>
                  </div>
                  <FormField
                    control={form.control}
                    name="kawaiPixel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pixel ID do Kwai</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Ex: kw_abc123def456"
                            data-testid="input-kwai-pixel"
                          />
                        </FormControl>
                        <FormDescription>
                          ID do pixel fornecido pelo Kwai Ads Manager (Assets → Web Events)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Pinterest Ads */}
                <div className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                      <span className="text-white text-xs font-bold">P</span>
                    </div>
                    <h3 className="font-semibold">Pinterest Ads</h3>
                  </div>
                  <FormField
                    control={form.control}
                    name="pinterestPixel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tag ID do Pinterest</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Ex: 2612345678901"
                            data-testid="input-pinterest-pixel"
                          />
                        </FormControl>
                        <FormDescription>
                          ID da tag encontrado no Pinterest Business Hub
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Informações Importantes */}
                <div className="p-4 bg-emerald-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-5 w-5 text-emerald-700 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-muted-foreground mb-2">Informações Importantes</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>Os pixels sero disparados automaticamente quando o pagamento for confirmado</li>
                        <li>Certifique-se de que os IDs estejam corretos para evitar perda de dados</li>
                        <li>Teste sempre em modo sandbox antes de usar em produção</li>
                        <li>Os eventos rastreados incluem: PageView, Purchase e CompletePayment</li>
                      </ul>
                    </div>
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="offers" className="space-y-4 mt-11">
            {checkout?.id ? (
              <ProductOffers 
                productId={checkout.syncedProductId || checkout.productId || checkout.id} 
                productSlug={form.watch("slug") || checkout.slug || ''}
                productPrice={form.watch("pricing.amount") || 0}
                productCurrency={form.watch("currency") || 'BRL'}
                productType={(() => {
                  const type = form.watch("productType") || checkout.productType;
                  return (type === "digital" || type === "subscription") ? type : "digital";
                })()}
              />
            ) : (
              <Card className="bg-white dark:bg-gray-700 border-brand-muted dark:border-brand-muted p-8">
                <div className="text-center">
                  <p className="text-brand-muted-foreground dark:text-brand-muted-foreground">
                    Salve o checkout primeiro para gerenciar ofertas
                  </p>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="coupons" className="space-y-4 mt-11">
            {checkout?.id ? (
              <CouponManager 
                productId={checkout.syncedProductId || checkout.productId || checkout.id} 
                type="checkout"
              />
            ) : (
              <Card className="bg-white dark:bg-gray-700 border-brand-muted dark:border-brand-muted p-8">
                <div className="text-center">
                  <p className="text-brand-muted-foreground dark:text-brand-muted-foreground">
                    Salve o checkout primeiro para gerenciar cupons
                  </p>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="testimonials" className="space-y-4 mt-11">
            {checkout?.id ? (
              <TestimonialManager 
                checkoutId={checkout.id} 
              />
            ) : (
              <Card className="bg-white dark:bg-gray-700 border-brand-muted dark:border-brand-muted p-8">
                <div className="text-center">
                  <p className="text-brand-muted-foreground dark:text-brand-muted-foreground">
                    Salve o checkout primeiro para gerenciar depoimentos
                  </p>
                </div>
              </Card>
            )}
          </TabsContent>

        </Tabs>
        </form>
      </Form>
    </div>
  );
}
