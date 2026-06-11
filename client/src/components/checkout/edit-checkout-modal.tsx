import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { resolveImageUrl } from "@/lib/image-url";
import { Card, CardContent } from "@/components/ui/card";
import { Paintbrush, DollarSign, Flag, List, CheckCircle, Upload, X, ShoppingCart, Check, CreditCard, FileText, User, ExternalLink } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useAuthStore } from "@/stores/auth";

interface EditCheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId?: string;
  productName?: string;
  productType?: "digital" | "subscription";
  checkoutId?: string;
  onSuccess?: () => void;
}

export function EditCheckoutModal({ open, onOpenChange, productId, productName, productType, checkoutId, onSuccess }: EditCheckoutModalProps) {
  console.log('🟢 EditCheckoutModal RENDER - open:', open, 'checkoutId:', checkoutId);
  const { toast } = useToast();
  const { user } = useAuthStore();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [checkoutName, setCheckoutName] = useState("");
  const [offerPrice, setOfferPrice] = useState("0.00");
  const [subscriptionPeriod, setSubscriptionPeriod] = useState<"monthly" | "quarterly" | "semiannual" | "annual">("monthly");
  const [logoEnabled, setLogoEnabled] = useState(false);
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [bannerUrl, setBannerUrl] = useState<string>("");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  
  // 🌓 CHECKOUT SEMPRE LIGHT (tema fixo)
  const displayMode = "light";

  // Métodos de pagamento aceitos (CPF e CNPJ sempre aceitos automaticamente)
  // 🎯 PADRÃO: PIX e Cartão ativados, Boleto só manual
  const [paymentMethods, setPaymentMethods] = useState({
    card: true,
    boleto: false,
    pix: true,
    applePay: false,
    googlePay: false,
  });

  // Descontos por método
  const [discounts, setDiscounts] = useState({
    card: { value: "0", type: "%" },
    boleto: { value: "0", type: "%" },
    pix: { value: "0", type: "%" },
    applePay: { value: "0", type: "%" },
    googlePay: { value: "0", type: "%" },
  });

  // Configurações de parcelamento
  const [maxInstallments, setMaxInstallments] = useState("12x");
  const [preselectedInstallments, setPreselectedInstallments] = useState("12x");
  const [interestFree, setInterestFree] = useState("1x");

  // Configurações de boleto
  const [boletoDays, setBoletoDays] = useState("3");

  // Configurações de PIX
  const [pixMinutes, setPixMinutes] = useState("10");

  // Preferências
  const [requireEmailConfirmation, setRequireEmailConfirmation] = useState(false);

  // Tipo de documento aceito no checkout
  const [documentMode, setDocumentMode] = useState<'cpf' | 'cnpj' | 'both'>('both');

  // Gatilhos
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [countdownMinutes, setCountdownMinutes] = useState("10");
  const [reviewsEnabled, setReviewsEnabled] = useState(false);
  const [reviews, setReviews] = useState<Array<{
    id: string;
    photo: string;
    name: string;
    description: string;
  }>>([]);

  // Order Bump
  const [orderBumpEnabled, setOrderBumpEnabled] = useState(false);
  const [orderBumpTitle, setOrderBumpTitle] = useState("Oferta Especial Para Você!");
  const [orderBumpSubtitle, setOrderBumpSubtitle] = useState("Aproveite esta oferta única");
  const [orderBumpProducts, setOrderBumpProducts] = useState<Array<{
    checkoutId: string;
    title: string;
    description?: string;
    customTitle?: string;
    customDescription?: string;
    price: number;
    originalPrice?: number;
    imageUrl?: string;
    discount: number;
  }>>([]);
  const [availableCheckouts, setAvailableCheckouts] = useState<any[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Array<{id: string; name: string}>>([]);
  const [totalPrice, setTotalPrice] = useState(0);
  const [isLoadingCheckouts, setIsLoadingCheckouts] = useState(false);

  // Back Redirect
  const [backRedirectUrl, setBackRedirectUrl] = useState("");

  // Order Bump — seleção de produto e oferta
  const [pendingBumpProductId, setPendingBumpProductId] = useState<string | null>(null);
  const [pendingBumpCheckout, setPendingBumpCheckout] = useState<any | null>(null);
  const [selectedBumpOfferId, setSelectedBumpOfferId] = useState<string | null>(null);
  
  // Market Target do produto (para controlar Apple Pay e Google Pay)
  const [productMarketTarget, setProductMarketTarget] = useState<"brasil" | "global">("brasil");

  // Buscar marketTarget do produto - buscar de todos os checkouts e filtrar pelo productId
  useEffect(() => {
    const fetchProductMarketTarget = async () => {
      if (!productId || !open) return;
      
      // Usar availableCheckouts já carregados para pegar o marketTarget
      const checkout = availableCheckouts.find((c: any) => c.syncedProductId === productId);
      if (checkout?.marketTarget) {
        setProductMarketTarget(checkout.marketTarget);
      } else {
        // Fallback: se não encontrar, assume "brasil" como padrão seguro
        setProductMarketTarget("brasil");
      }
    };
    fetchProductMarketTarget();
  }, [productId, open, availableCheckouts]);

  // Buscar checkouts disponíveis do seller
  useEffect(() => {
    if (!user?.uid || !open) return;

    let cancelled = false;

    const waitForAuth = (): Promise<boolean> => {
      if (auth.currentUser) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timeout = setTimeout(() => { unsubscribe(); resolve(false); }, 5000);
        const unsubscribe = auth.onAuthStateChanged((u) => {
          if (u) { clearTimeout(timeout); unsubscribe(); resolve(true); }
        });
      });
    };

    const doFetch = async (attempt: number): Promise<void> => {
      if (cancelled) return;
      try {
        const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
        const response = await fetch(`/api/checkouts-by-tenant/${user.uid}`, {
          credentials: 'include',
          headers,
        });
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        if (!cancelled) setAvailableCheckouts(Array.isArray(data) ? data : (data.checkouts || []));
      } catch (error) {
        console.warn(`⚠️ Tentativa ${attempt}/3 carregar checkouts:`, error);
        if (attempt < 3 && !cancelled) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          return doFetch(attempt + 1);
        }
        if (!cancelled) {
          console.error('❌ Falha ao carregar checkouts após 3 tentativas:', error);
          setAvailableCheckouts([]);
          toast({
            title: "Erro ao carregar produtos",
            description: "Não foi possível carregar a lista de produtos. Tente fechar e abrir novamente.",
            variant: "destructive"
          });
        }
      }
    };

    const fetchCheckouts = async () => {
      setIsLoadingCheckouts(true);
      const authReady = await waitForAuth();
      if (!authReady || cancelled) {
        if (!cancelled) {
          console.warn('⚠️ Auth não disponível, tentando mesmo assim...');
        }
      }
      await doFetch(1);
      if (!cancelled) setIsLoadingCheckouts(false);
    };

    fetchCheckouts();

    // Fetch products for order bump selector
    const fetchProducts = async () => {
      try {
        const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
        const res = await fetch(`/api/products?tenantId=${user.uid}&limit=100`, { credentials: 'include', headers });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const list = data.products || data || [];
          setAvailableProducts(Array.isArray(list) ? list.map((p: any) => ({ id: p.id, name: p.title || p.name || p.id })) : []);
        }
      } catch { /* silently ignore */ }
    };
    fetchProducts();

    return () => { cancelled = true; };
  }, [user?.uid, open, toast]);

  // Carregar dados da oferta quando checkoutId for fornecido (modo editar)
  useEffect(() => {
    const loadCheckoutData = async () => {
      if (!checkoutId || !open || !user?.uid) return;
      
      try {
        const headers = await getAuthHeaders({
          'Content-Type': 'application/json',
        });
        
        const response = await fetch(`/api/checkouts/${checkoutId}`, {
          credentials: 'include',
          headers,
        });
        
        if (!response.ok) {
          throw new Error('Erro ao carregar oferta');
        }
        
        const checkout = await response.json();
        
        // Preencher formulário com dados da oferta
        setCheckoutName(checkout.title || "");
        setOfferPrice((checkout.pricing?.amount / 100 || 0).toFixed(2));
        if (checkout.pricing?.subscriptionPeriod) {
          setSubscriptionPeriod(checkout.pricing.subscriptionPeriod);
        }
        
        // Logo e Banner
        setLogoEnabled(!!checkout.logoUrl);
        setLogoUrl(checkout.logoUrl || "");
        setBannerEnabled(!!checkout.bannerUrl);
        setBannerUrl(checkout.bannerUrl || "");
        
        // Métodos de pagamento
        if (checkout.paymentMethods) {
          setPaymentMethods({
            card: checkout.paymentMethods.card || false,
            boleto: checkout.paymentMethods.boleto || false,
            pix: checkout.paymentMethods.pix || false,
            applePay: checkout.paymentMethods.applePay || false,
            googlePay: checkout.paymentMethods.googlePay || false,
          });
        }
        
        // Descontos
        if (checkout.discounts) {
          setDiscounts({
            card: checkout.discounts.card || { value: "0", type: "%" },
            boleto: checkout.discounts.boleto || { value: "0", type: "%" },
            pix: checkout.discounts.pix || { value: "0", type: "%" },
            applePay: checkout.discounts.applePay || { value: "0", type: "%" },
            googlePay: checkout.discounts.googlePay || { value: "0", type: "%" },
          });
        }
        
        // Parcelamento - CORRIGIR: valores vêm como NUMBER, precisamos adicionar "x"
        if (checkout.installments) {
          setMaxInstallments(`${checkout.installments.max || 12}x`);
          setPreselectedInstallments(`${checkout.installments.preselected || 12}x`);
          setInterestFree(`${checkout.installments.interestFree || 1}x`);
        }
        
        // Boleto e PIX - GARANTIR conversão string segura
        setBoletoDays((checkout.boleto?.expirationDays || 3).toString());
        setPixMinutes((checkout.pix?.expirationMinutes || 10).toString());
        
        // Gatilhos
        setCountdownEnabled((checkout as any).triggers?.countdownEnabled || false);
        setCountdownMinutes((checkout as any).triggers?.countdownMinutes?.toString() || "10");
        setReviewsEnabled((checkout as any).triggers?.reviewsEnabled || false);
        if ((checkout as any).triggers?.reviews) {
          setReviews((checkout as any).triggers.reviews);
        }
        
        // Order Bump
        setOrderBumpEnabled((checkout as any).orderBump?.enabled || false);
        setOrderBumpTitle((checkout as any).orderBump?.title || "Oferta Especial Para Você!");
        setOrderBumpSubtitle((checkout as any).orderBump?.subtitle || "Aproveite esta oferta única");
        if ((checkout as any).orderBump?.products) {
          console.log('🔍 DEBUG ORDER BUMP - Produtos carregados do Firebase:', (checkout as any).orderBump.products);
          setOrderBumpProducts((checkout as any).orderBump.products);
        }

        // Back Redirect
        setBackRedirectUrl((checkout as any).backRedirectUrl || "");
        
        // Preferências
        setRequireEmailConfirmation(checkout.preferences?.requireEmailConfirmation || false);
        setDocumentMode((checkout as any).documentMode || 'both');
        
      } catch (error) {
        console.error('Erro ao carregar oferta:', error);
        toast({
          title: "Erro ao carregar oferta",
          description: "Não foi possível carregar os dados da oferta.",
          variant: "destructive"
        });
      }
    };
    
    // Limpar formulário quando abrir para criar nova oferta
    if (!checkoutId && open) {
      setCheckoutName("");
      setOfferPrice("0.00");
      setSubscriptionPeriod("monthly");
      setLogoEnabled(false);
      setLogoUrl("");
      setBannerEnabled(false);
      setBannerUrl("");
      setPaymentMethods({
        card: true,
        boleto: false,
        pix: true,
        applePay: false,
        googlePay: false,
      });
      setDiscounts({
        card: { value: "0", type: "%" },
        boleto: { value: "0", type: "%" },
        pix: { value: "0", type: "%" },
        applePay: { value: "0", type: "%" },
        googlePay: { value: "0", type: "%" },
      });
      setMaxInstallments("12x");
      setPreselectedInstallments("12x");
      setInterestFree("1x");
      setBoletoDays("3");
      setPixMinutes("10");
      setCountdownEnabled(false);
      setCountdownMinutes("10");
      setReviewsEnabled(false);
      setReviews([]);
      setOrderBumpEnabled(false);
      setOrderBumpTitle("Oferta Especial Para Você!");
      setOrderBumpSubtitle("Aproveite esta oferta única");
      setOrderBumpProducts([]);
      setPendingBumpProductId(null);
      setPendingBumpCheckout(null);
      setSelectedBumpOfferId(null);
      setRequireEmailConfirmation(false);
      setDocumentMode('both');
    }
    
    if (checkoutId) {
      loadCheckoutData();
    }
  }, [checkoutId, open, user, toast]);

  // Calcular total price (tudo em centavos)
  useEffect(() => {
    const basePriceCents = Math.round(parseFloat(offerPrice || "0") * 100);
    const bumpTotalCents = orderBumpProducts.reduce((sum, p) => sum + p.price, 0);
    setTotalPrice(basePriceCents + bumpTotalCents);
  }, [offerPrice, orderBumpProducts]);

  // Handler: seleciona produto para order bump (passo 1)
  const handleProductSelectedForBump = (selectedProductId: string) => {
    setPendingBumpProductId(selectedProductId);
    setPendingBumpCheckout(null);
    setSelectedBumpOfferId(null);
  };

  // Checkouts (ofertas) do produto selecionado no passo 1
  const pendingProductCheckouts = pendingBumpProductId
    ? availableCheckouts.filter(c =>
        c.syncedProductId === pendingBumpProductId &&
        c.id !== checkoutId &&
        !orderBumpProducts.some(p => p.checkoutId === c.id)
      )
    : [];

  // Confirma adição do order bump com o checkout/oferta selecionado
  const handleConfirmBumpAdd = () => {
    if (!pendingBumpCheckout) return;

    const imageUrl = pendingBumpCheckout.logoUrl
      || (pendingBumpCheckout as any).visual?.logo
      || (pendingBumpCheckout as any).banner?.imageAbove?.imageUrl
      || pendingBumpCheckout.bannerUrl
      || '';

    const price = pendingBumpCheckout.pricing?.amount
      || pendingBumpCheckout.price
      || pendingBumpCheckout.amount
      || 0;

    setOrderBumpProducts(prev => [...prev, {
      checkoutId: pendingBumpCheckout.id,
      title: pendingBumpCheckout.title,
      description: pendingBumpCheckout.subtitle || '',
      price,
      imageUrl,
      discount: 0,
    }]);

    setPendingBumpProductId(null);
    setPendingBumpCheckout(null);
    setSelectedBumpOfferId(null);
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Erro",
        description: "Por favor, selecione apenas arquivos de imagem",
        variant: "destructive"
      });
      return;
    }

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'checkouts/logos');
      
      const headers = await getAuthHeaders({});
      delete (headers as Record<string, string>)['Content-Type'];
      
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers,
        body: formData,
      });
      
      if (response.ok) {
        const data = await response.json();
        setLogoUrl(data.url);
        toast({
          title: "Sucesso!",
          description: "Logo enviado com sucesso",
        });
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error("Erro ao fazer upload do logo:", error);
      toast({
        title: "Erro",
        description: "Erro ao fazer upload do logo",
        variant: "destructive"
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleBannerUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Erro",
        description: "Por favor, selecione apenas arquivos de imagem",
        variant: "destructive"
      });
      return;
    }

    setIsUploadingBanner(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'banners');
      
      const headers = await getAuthHeaders({});
      delete (headers as Record<string, string>)['Content-Type'];
      
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers,
        body: formData,
      });
      
      if (response.ok) {
        const data = await response.json();
        setBannerUrl(data.url);
        toast({
          title: "Sucesso!",
          description: "Banner enviado com sucesso",
        });
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error("Erro ao fazer upload do banner:", error);
      toast({
        title: "Erro",
        description: "Erro ao fazer upload do banner",
        variant: "destructive"
      });
    } finally {
      setIsUploadingBanner(false);
    }
  };

  const removeLogo = () => {
    setLogoUrl("");
    if (logoInputRef.current) {
      logoInputRef.current.value = "";
    }
  };

  const removeBanner = () => {
    setBannerUrl("");
    if (bannerInputRef.current) {
      bannerInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!checkoutName.trim()) {
      toast({
        title: "Erro",
        description: "Por favor, preencha o nome do checkout",
        variant: "destructive"
      });
      return;
    }

    if (!productId || !user?.uid) {
      toast({
        title: "Erro",
        description: "Produto ou usuário não identificado",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      // Converter preço de reais para centavos
      const priceInCents = Math.round(parseFloat(offerPrice || "0") * 100);

      // Montar dados do checkout
      const checkoutData: any = {
        tenantId: user.uid,
        syncedProductId: productId,
        title: checkoutName,
        productType: productType || 'digital',
        pricing: productType === 'subscription' 
          ? { amount: priceInCents, subscriptionPeriod } 
          : { amount: priceInCents },
        currency: 'BRL',
        logoUrl: logoEnabled ? logoUrl : null,
        bannerUrl: bannerEnabled ? bannerUrl : null,
        displayMode: displayMode,
        paymentMethods: paymentMethods,
        installments: {
          max: parseInt(maxInstallments.replace('x', '')),
          preselected: parseInt(preselectedInstallments.replace('x', '')),
          interestFree: parseInt(interestFree.replace('x', '')),
        },
        boleto: {
          expirationDays: parseInt(boletoDays),
        },
        pix: {
          expirationMinutes: parseInt(pixMinutes),
        },
        discounts,
        documentMode,
        preferences: {
          showSellerName: true,
          requireEmailConfirmation,
        },
        triggers: {
          countdownEnabled,
          countdownMinutes: parseInt(countdownMinutes),
          reviewsEnabled,
          reviews,
        },
        // CORRIGIR: Timer também precisa estar no formato que o checkout espera
        timer: countdownEnabled ? {
          enabled: true,
          minutes: parseInt(countdownMinutes),
          title: "Oferta por tempo limitado!",
          backgroundColor: "#dc2626",
          color: "#ffffff"
        } : {
          enabled: false,
          minutes: 0
        },
        orderBump: {
          enabled: orderBumpEnabled,
          title: orderBumpTitle,
          subtitle: orderBumpSubtitle,
          products: orderBumpProducts.map(p => {
            console.log('🔍 DEBUG ORDER BUMP - Salvando produto:', p);
            return p;
          }),
        },
        backRedirectUrl: backRedirectUrl.trim() || null,
        active: true,
      };

      let response;
      let uniqueSlug;
      
      if (checkoutId) {
        // Modo EDITAR - fazer PUT
        response = await apiRequest(`/api/checkouts/${checkoutId}`, 'PUT', checkoutData);
        
        if (!response.ok) {
          throw new Error('Erro ao atualizar checkout');
        }
        
        const result = await response.json();
        uniqueSlug = result.id || result.slug; // Prioriza ID permanente do Firestore
        
      } else {
        // Modo CRIAR - NÃO gera slug baseado em nome (o ID do Firestore é o identificador permanente)
        response = await apiRequest('/api/checkouts', 'POST', checkoutData);

        if (!response.ok) {
          throw new Error('Erro ao criar checkout');
        }

        const createResult = await response.json();
        uniqueSlug = createResult.id; // ID permanente do Firestore, nunca muda
      }

      const checkoutUrl = `${window.location.origin}/c/${uniqueSlug}`;

      toast({
        title: checkoutId ? "✅ Oferta atualizada com sucesso!" : "✅ Oferta criada com sucesso!",
        description: (
          <div className="mt-2 space-y-2">
            <p className="font-medium">Link da oferta:</p>
            <code className="block p-2 bg-gray-100 dark:bg-gray-700 rounded text-xs break-all">
              {checkoutUrl}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(checkoutUrl);
                toast({ description: "Link copiado!" });
              }}
              className="text-blue-600 hover:underline text-sm"
            >
              Copiar link
            </button>
          </div>
        ),
        duration: 10000,
      });

      // Limpar formulário
      setCheckoutName("");
      setOfferPrice("0.00");
      setLogoUrl("");
      setBannerUrl("");
      setLogoEnabled(false);
      setBannerEnabled(false);
      
      // Chamar callback de sucesso para atualizar lista de ofertas
      onSuccess?.();
      
      onOpenChange(false);
    } catch (error) {
      console.error("Erro ao criar checkout:", error);
      toast({
        title: "Erro",
        description: "Erro ao criar oferta. Tente novamente.",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1100px] h-[85vh] p-0 gap-0 bg-white dark:bg-gray-900 flex flex-col overflow-hidden rounded-2xl border-0 shadow-2xl">
        <DialogHeader className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:from-gray-800 dark:to-gray-900 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <img src="/logo-volatuspay.png" alt="VolatusPay" className="h-8 w-auto object-contain" />
            <div className="w-px h-8 bg-gray-200 dark:bg-gray-600" />
            <div>
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-white">
                {checkoutId ? "Editar Oferta" : "Criar Nova Oferta"}
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500 dark:text-gray-400">
                Configure visual, pagamentos, gatilhos e order bumps
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="config" className="flex flex-1 overflow-hidden">
          <TabsList className="flex flex-col w-56 min-w-56 border-r border-gray-200 dark:border-gray-700 rounded-none h-full p-3 bg-gray-50 dark:bg-gray-800/50 gap-1 justify-start">
            <TabsTrigger
              value="config"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg justify-start text-left data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-[#2563eb] dark:data-[state=active]:text-[#2563eb] data-[state=active]:shadow-sm data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:bg-gray-100 dark:data-[state=inactive]:hover:bg-gray-700/50 transition-all"
            >
              <List className="h-5 w-5" />
              <span className="font-medium">Configuração</span>
            </TabsTrigger>
            <TabsTrigger
              value="banner"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg justify-start text-left data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-[#2563eb] dark:data-[state=active]:text-[#2563eb] data-[state=active]:shadow-sm data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:bg-gray-100 dark:data-[state=inactive]:hover:bg-gray-700/50 transition-all"
            >
              <Paintbrush className="h-5 w-5" />
              <span className="font-medium">Banner</span>
            </TabsTrigger>
            <TabsTrigger
              value="payments"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg justify-start text-left data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-[#2563eb] dark:data-[state=active]:text-[#2563eb] data-[state=active]:shadow-sm data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:bg-gray-100 dark:data-[state=inactive]:hover:bg-gray-700/50 transition-all"
            >
              <DollarSign className="h-5 w-5" />
              <span className="font-medium">Pagamentos</span>
            </TabsTrigger>
            <TabsTrigger
              value="triggers"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg justify-start text-left data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-[#2563eb] dark:data-[state=active]:text-[#2563eb] data-[state=active]:shadow-sm data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:bg-gray-100 dark:data-[state=inactive]:hover:bg-gray-700/50 transition-all"
            >
              <Flag className="h-5 w-5" />
              <span className="font-medium">Gatilhos</span>
            </TabsTrigger>
            <TabsTrigger
              value="order-bump"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg justify-start text-left data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-[#2563eb] dark:data-[state=active]:text-[#2563eb] data-[state=active]:shadow-sm data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:bg-gray-100 dark:data-[state=inactive]:hover:bg-gray-700/50 transition-all"
            >
              <ShoppingCart className="h-5 w-5" />
              <span className="font-medium">Order Bump</span>
            </TabsTrigger>
            <TabsTrigger
              value="back-redirect"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg justify-start text-left data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-[#2563eb] dark:data-[state=active]:text-[#2563eb] data-[state=active]:shadow-sm data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:bg-gray-100 dark:data-[state=inactive]:hover:bg-gray-700/50 transition-all"
            >
              <ExternalLink className="h-5 w-5" />
              <span className="font-medium">Back Redirect</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
            <div className="min-h-full">
                {/* Tab Content - Configuração */}
                <TabsContent value="config" className="p-6 space-y-6 m-0">
                  {/* Nome do Checkout */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-900 dark:text-white">
                      Nome
                    </Label>
                    <Input
                      placeholder="Digite o título do checkout (campo obrigatório)"
                      value={checkoutName}
                      onChange={(e) => setCheckoutName(e.target.value)}
                      className="bg-white dark:bg-transparent border-gray-300 dark:border-gray-700"
                    />
                  </div>

                  {/* Preço e Período (lado a lado para assinaturas) */}
                  {productType === "subscription" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">
                          Preço (R$) *
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={offerPrice}
                          onChange={(e) => setOfferPrice(e.target.value)}
                          className="bg-white dark:bg-transparent border-gray-300 dark:border-gray-700"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">
                          Período *
                        </Label>
                        <Select value={subscriptionPeriod} onValueChange={(value: any) => setSubscriptionPeriod(value)}>
                          <SelectTrigger className="bg-white dark:bg-transparent border-gray-300 dark:border-gray-700">
                            <SelectValue placeholder="Selecione o período" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">Mensal (30 dias)</SelectItem>
                            <SelectItem value="quarterly">Trimestral (90 dias)</SelectItem>
                            <SelectItem value="semiannual">Semestral (180 dias)</SelectItem>
                            <SelectItem value="annual">Anual (365 dias)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-900 dark:text-white">
                        Preço (R$)
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={offerPrice}
                        onChange={(e) => setOfferPrice(e.target.value)}
                        className="bg-white dark:bg-transparent border-gray-300 dark:border-gray-700"
                      />
                    </div>
                  )}
                </TabsContent>

                {/* Tab Content - Banner */}
                <TabsContent value="banner" className="p-6 space-y-6 m-0">
                  {/* Logotipo */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-gray-900 dark:text-white">
                        Logotipo
                      </Label>
                      <Switch
                        checked={logoEnabled}
                        onCheckedChange={setLogoEnabled}
                      />
                    </div>
                    {logoEnabled && (
                      <div className="space-y-3">
                        {logoUrl ? (
                          <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                            <img
                              src={resolveImageUrl(logoUrl) || ''}
                              alt="Logo preview"
                              className="w-full h-32 object-contain rounded"
                            />
                            <button
                              type="button"
                              onClick={removeLogo}
                              className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <input
                              ref={logoInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleLogoUpload}
                              className="hidden"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => logoInputRef.current?.click()}
                              disabled={isUploadingLogo}
                              className="w-full bg-white dark:bg-transparent border-gray-300 dark:border-gray-700"
                            >
                              {isUploadingLogo ? (
                                "Enviando..."
                              ) : (
                                <>
                                  <Upload className="h-4 w-4 mr-2" />
                                  Anexar imagem
                                </>
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Banner */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-gray-900 dark:text-white">
                        Banner
                      </Label>
                      <Switch
                        checked={bannerEnabled}
                        onCheckedChange={setBannerEnabled}
                      />
                    </div>
                    {bannerEnabled && (
                      <div className="space-y-3">
                        {bannerUrl ? (
                          <div className="relative border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                            <img
                              src={resolveImageUrl(bannerUrl) || ''}
                              alt="Banner preview"
                              className="w-full h-32 object-cover rounded"
                            />
                            <button
                              type="button"
                              onClick={removeBanner}
                              className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <input
                              ref={bannerInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleBannerUpload}
                              className="hidden"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => bannerInputRef.current?.click()}
                              disabled={isUploadingBanner}
                              className="w-full bg-white dark:bg-transparent border-gray-300 dark:border-gray-700"
                            >
                              {isUploadingBanner ? (
                                "Enviando..."
                              ) : (
                                <>
                                  <Upload className="h-4 w-4 mr-2" />
                                  Anexar imagem
                                </>
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Tab Content - Pagamentos */}
                <TabsContent value="payments" className="p-6 space-y-6 m-0">
                  {/* Exibir campo para confirmar e-mail */}
                  <div className="flex items-center gap-3 bg-blue-50 dark:bg-[#f0f4ff]/20 rounded-xl p-4 border border-blue-100 dark:border-[#f0f4ff]">
                    <Checkbox
                      id="requireEmailConfirmation"
                      checked={requireEmailConfirmation}
                      onCheckedChange={(checked) => setRequireEmailConfirmation(checked as boolean)}
                      className="data-[state=checked]:bg-[#2563eb] data-[state=checked]:border-[#2563eb]"
                    />
                    <Label htmlFor="requireEmailConfirmation" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      Exibir campo para confirmar o e-mail
                    </Label>
                  </div>

                  {/* Tipo de Documento Aceito */}
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[#2563eb]" />
                      Documento aceito no checkout
                    </Label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Selecione quais documentos o comprador pode informar</p>
                    <div className="grid grid-cols-3 gap-2">
                      {([ 
                        { value: 'cpf',  label: 'Somente CPF',       sub: 'Pessoas físicas' },
                        { value: 'cnpj', label: 'Somente CNPJ',      sub: 'Pessoas jurídicas' },
                        { value: 'both', label: 'CPF e CNPJ',        sub: 'Ambos aceitos' },
                      ] as const).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDocumentMode(opt.value)}
                          className={`relative p-3 rounded-xl border-2 text-left transition-all duration-200 ${
                            documentMode === opt.value
                              ? 'border-[#2563eb] bg-[#2563eb]/5 shadow-sm'
                              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-gray-300'
                          }`}
                        >
                          <p className={`text-xs font-semibold ${documentMode === opt.value ? 'text-[#2563eb]' : 'text-gray-700 dark:text-gray-300'}`}>{opt.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
                          {documentMode === opt.value && (
                            <div className="absolute top-2 right-2 w-4 h-4 bg-[#2563eb] rounded-full flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Métodos de Pagamento - Cards clicáveis */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-[#2563eb]" />
                      Métodos de Pagamento
                    </Label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Clique para ativar ou desativar cada método</p>
                    
                    <div className="grid grid-cols-3 gap-3">
                      {/* PIX */}
                      <button
                        type="button"
                        onClick={() => setPaymentMethods({ ...paymentMethods, pix: !paymentMethods.pix })}
                        className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                          paymentMethods.pix 
                            ? 'border-[#32BCAD] bg-[#32BCAD]/5 shadow-sm' 
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 opacity-60 hover:opacity-80'
                        }`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            paymentMethods.pix ? 'bg-[#32BCAD]/10' : 'bg-gray-100 dark:bg-gray-700'
                          }`}>
                            <svg viewBox="0 0 512 512" className="w-6 h-6" xmlns="http://www.w3.org/2000/svg">
                              <path d="M112.57 391.19c20.056 0 38.928-7.808 53.12-22l76.693-76.692c5.385-5.404 14.765-5.384 20.15 0l76.989 76.989c14.191 14.172 33.045 21.98 53.12 21.98h15.098l-97.138 97.139c-30.326 30.344-79.505 30.344-109.85 0l-97.415-97.416h9.232zm280.068-271.294c-20.056 0-38.929 7.809-53.12 22l-76.97 76.99c-5.551 5.53-14.6 5.568-20.15-.02l-76.711-76.693c-14.192-14.191-33.046-21.999-53.12-21.999h-9.234l97.416-97.416c30.344-30.344 79.523-30.344 109.867 0l97.138 97.138h-15.116z" fill={paymentMethods.pix ? "#32BCAD" : "#9CA3AF"}/>
                              <path d="M22.758 200.753l58.024-58.024h31.787c13.376 0 25.932 5.207 35.4 14.674l76.692 76.692c14.08 14.06 36.616 14.08 50.696 0l76.713-76.712c9.485-9.468 22.04-14.674 35.4-14.674h39.105l58.023 58.024c30.326 30.344 30.326 79.523 0 109.867l-58.043 58.043h-39.086c-13.36 0-25.916-5.207-35.4-14.674l-76.97-76.99c-13.915-13.934-36.762-13.934-50.677 0l-76.693 76.693c-9.467 9.486-22.022 14.693-35.399 14.693H80.782l-58.024-58.024c-30.344-30.344-30.344-79.523 0-109.867z" fill={paymentMethods.pix ? "#32BCAD" : "#9CA3AF"}/>
                            </svg>
                          </div>
                          <span className={`text-sm font-medium ${paymentMethods.pix ? 'text-[#32BCAD]' : 'text-gray-500'}`}>PIX</span>
                        </div>
                        {paymentMethods.pix && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-[#32BCAD] rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>

                      {/* Cartão */}
                      <button
                        type="button"
                        onClick={() => setPaymentMethods({ ...paymentMethods, card: !paymentMethods.card })}
                        className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                          paymentMethods.card 
                            ? 'border-[#2563eb] bg-blue-50 dark:bg-[#f0f4ff]/20 shadow-sm' 
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 opacity-60 hover:opacity-80'
                        }`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            paymentMethods.card ? 'bg-blue-100 dark:bg-[#f0f4ff]' : 'bg-gray-100 dark:bg-gray-700'
                          }`}>
                            <CreditCard className={`w-5 h-5 ${paymentMethods.card ? 'text-[#2563eb]' : 'text-gray-400'}`} />
                          </div>
                          <span className={`text-sm font-medium ${paymentMethods.card ? 'text-[#2563eb]' : 'text-gray-500'}`}>Cartão</span>
                        </div>
                        {paymentMethods.card && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-[#2563eb] rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>

                      {/* Boleto */}
                      <button
                        type="button"
                        onClick={() => setPaymentMethods({ ...paymentMethods, boleto: !paymentMethods.boleto })}
                        className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                          paymentMethods.boleto 
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 shadow-sm' 
                            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 opacity-60 hover:opacity-80'
                        }`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            paymentMethods.boleto ? 'bg-orange-100 dark:bg-orange-800' : 'bg-gray-100 dark:bg-gray-700'
                          }`}>
                            <FileText className={`w-5 h-5 ${paymentMethods.boleto ? 'text-orange-600' : 'text-gray-400'}`} />
                          </div>
                          <span className={`text-sm font-medium ${paymentMethods.boleto ? 'text-orange-600' : 'text-gray-500'}`}>Boleto</span>
                        </div>
                        {paymentMethods.boleto && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>
                    </div>

                    {/* Métodos globais */}
                    {productMarketTarget === "global" && (
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <button
                          type="button"
                          onClick={() => setPaymentMethods({ ...paymentMethods, applePay: !paymentMethods.applePay })}
                          className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                            paymentMethods.applePay 
                              ? 'border-gray-900 bg-gray-100 dark:bg-gray-800 shadow-sm' 
                              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 opacity-60 hover:opacity-80'
                          }`}
                        >
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
                              <span className="text-white text-sm font-bold"></span>
                            </div>
                            <span className={`text-sm font-medium ${paymentMethods.applePay ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>Apple Pay</span>
                          </div>
                          {paymentMethods.applePay && (
                            <div className="absolute top-2 right-2 w-5 h-5 bg-gray-900 rounded-full flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethods({ ...paymentMethods, googlePay: !paymentMethods.googlePay })}
                          className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
                            paymentMethods.googlePay 
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm' 
                              : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 opacity-60 hover:opacity-80'
                          }`}
                        >
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-10 h-10 rounded-lg bg-white dark:bg-gray-700 flex items-center justify-center border">
                              <span className="text-sm font-bold text-blue-500">G</span>
                            </div>
                            <span className={`text-sm font-medium ${paymentMethods.googlePay ? 'text-blue-600' : 'text-gray-500'}`}>Google Pay</span>
                          </div>
                          {paymentMethods.googlePay && (
                            <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </button>
                      </div>
                    )}
                  </div>


                  {/* Configurações de Boleto - só mostra se boleto ativo */}
                  {paymentMethods.boleto && (
                    <div className="space-y-4 border border-orange-200 dark:border-orange-800 rounded-xl p-4 bg-orange-50/50 dark:bg-orange-900/10">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-orange-600" />
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white">
                          Configurações do Boleto
                        </Label>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600 dark:text-gray-400">Dias para vencimento</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              value={boletoDays}
                              onChange={(e) => setBoletoDays(e.target.value)}
                              className="h-9 max-w-[80px]"
                            />
                            <span className="text-sm text-gray-500">dias</span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600 dark:text-gray-400">Desconto no boleto (%)</Label>
                          <Input
                            type="number"
                            value={discounts.boleto.value}
                            onChange={(e) => setDiscounts({ ...discounts, boleto: { ...discounts.boleto, value: e.target.value } })}
                            className="h-9 max-w-[120px]"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Configurações de PIX - só mostra se PIX ativo */}
                  {paymentMethods.pix && (
                    <div className="space-y-4 border border-[#32BCAD]/30 rounded-xl p-4 bg-[#32BCAD]/5">
                      <div className="flex items-center gap-2">
                        <svg viewBox="0 0 512 512" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                          <path d="M112.57 391.19c20.056 0 38.928-7.808 53.12-22l76.693-76.692c5.385-5.404 14.765-5.384 20.15 0l76.989 76.989c14.191 14.172 33.045 21.98 53.12 21.98h15.098l-97.138 97.139c-30.326 30.344-79.505 30.344-109.85 0l-97.415-97.416h9.232zm280.068-271.294c-20.056 0-38.929 7.809-53.12 22l-76.97 76.99c-5.551 5.53-14.6 5.568-20.15-.02l-76.711-76.693c-14.192-14.191-33.046-21.999-53.12-21.999h-9.234l97.416-97.416c30.344-30.344 79.523-30.344 109.867 0l97.138 97.138h-15.116z" fill="#32BCAD"/>
                          <path d="M22.758 200.753l58.024-58.024h31.787c13.376 0 25.932 5.207 35.4 14.674l76.692 76.692c14.08 14.06 36.616 14.08 50.696 0l76.713-76.712c9.485-9.468 22.04-14.674 35.4-14.674h39.105l58.023 58.024c30.326 30.344 30.326 79.523 0 109.867l-58.043 58.043h-39.086c-13.36 0-25.916-5.207-35.4-14.674l-76.97-76.99c-13.915-13.934-36.762-13.934-50.677 0l-76.693 76.693c-9.467 9.486-22.022 14.693-35.399 14.693H80.782l-58.024-58.024c-30.344-30.344-30.344-79.523 0-109.867z" fill="#32BCAD"/>
                        </svg>
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white">
                          Configurações do PIX
                        </Label>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600 dark:text-gray-400">Tempo de expiração</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              value={pixMinutes}
                              onChange={(e) => setPixMinutes(e.target.value)}
                              className="h-9 max-w-[80px]"
                            />
                            <span className="text-sm text-gray-500">minutos</span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600 dark:text-gray-400">Desconto no PIX (%)</Label>
                          <Input
                            type="number"
                            value={discounts.pix.value}
                            onChange={(e) => setDiscounts({ ...discounts, pix: { ...discounts.pix, value: e.target.value } })}
                            className="h-9 max-w-[120px]"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Tab Content - Gatilhos */}
                <TabsContent value="triggers" className="p-6 space-y-6 m-0">
                  <div className="space-y-4">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                      <Flag className="h-4 w-4" />
                      Gatilhos
                    </h3>

                    <div className="space-y-4">
                      {/* Contador Regressivo */}
                      <div className="space-y-3 py-3 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium text-gray-900 dark:text-white">
                            Contador Regressivo
                          </Label>
                          <Switch
                            checked={countdownEnabled}
                            onCheckedChange={setCountdownEnabled}
                          />
                        </div>
                        {countdownEnabled && (
                          <div className="space-y-2">
                            <Label className="text-sm text-gray-700 dark:text-gray-300">
                              Tempo em minutos
                            </Label>
                            <div className="flex gap-2 items-center max-w-xs">
                              <Input
                                type="number"
                                value={countdownMinutes}
                                onChange={(e) => setCountdownMinutes(e.target.value)}
                                className="flex-1"
                                min="1"
                                max="60"
                              />
                              <span className="text-sm text-gray-600 dark:text-gray-400">min.</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Depoimentos/Reviews */}
                      <div className="space-y-3 py-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <Label className="text-sm font-medium text-gray-900 dark:text-white">
                              Depoimentos/Reviews
                            </Label>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Com os reviews, você cria argumentos de confiança para seu cliente finalizar a compra.
                            </p>
                          </div>
                          <Switch
                            checked={reviewsEnabled}
                            onCheckedChange={setReviewsEnabled}
                          />
                        </div>

                        {reviewsEnabled && (
                          <div className="space-y-3 mt-4">
                            {/* Lista de depoimentos */}
                            {reviews.map((review, index) => (
                              <div key={review.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                                <div className="flex gap-3">
                                  {/* Foto */}
                                  <div className="flex-shrink-0">
                                    {review.photo ? (
                                      <img
                                        src={review.photo}
                                        alt={review.name}
                                        className="w-14 h-14 rounded-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                                        <User className="w-6 h-6 text-gray-400" />
                                      </div>
                                    )}
                                    <label className="mt-2 cursor-pointer text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 justify-center">
                                      <Upload className="h-3 w-3" />
                                      <span>{review.photo ? 'Trocar' : 'Foto'}</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          const formData = new FormData();
                                          formData.append('file', file);
                                          formData.append('category', 'testimonials');
                                          try {
                                            const token = await auth.currentUser?.getIdToken();
                                            const response = await fetch('/api/upload/image', {
                                              method: 'POST',
                                              headers: {
                                                'Authorization': `Bearer ${token}`,
                                              },
                                              body: formData,
                                            });
                                            if (response.ok) {
                                              const data = await response.json();
                                              const updated = [...reviews];
                                              updated[index].photo = data.url;
                                              setReviews(updated);
                                              toast({ title: "Foto atualizada com sucesso!" });
                                            } else {
                                              const err = await response.json().catch(() => ({}));
                                              toast({
                                                title: "Erro no upload",
                                                description: err.error || "Não foi possível enviar a foto.",
                                                variant: "destructive",
                                              });
                                            }
                                          } catch (error) {
                                            toast({
                                              title: "Erro no upload",
                                              description: "Não foi possível enviar a foto.",
                                              variant: "destructive",
                                            });
                                          }
                                        }}
                                      />
                                    </label>
                                  </div>

                                  {/* Campos editáveis */}
                                  <div className="flex-1 min-w-0 space-y-2">
                                    <Input
                                      placeholder="Nome do cliente"
                                      value={review.name}
                                      onChange={(e) => {
                                        const updated = [...reviews];
                                        updated[index].name = e.target.value;
                                        setReviews(updated);
                                      }}
                                      className="text-sm"
                                    />
                                    <textarea
                                      placeholder="Escreva o depoimento aqui..."
                                      value={review.description}
                                      onChange={(e) => {
                                        const updated = [...reviews];
                                        updated[index].description = e.target.value;
                                        setReviews(updated);
                                      }}
                                      className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
                                      rows={2}
                                    />
                                  </div>

                                  {/* Botão remover */}
                                  <button
                                    type="button"
                                    onClick={() => setReviews(reviews.filter((_, i) => i !== index))}
                                    className="text-red-500 hover:text-red-600 flex-shrink-0 self-start"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            ))}

                            {/* Botão adicionar depoimento */}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                const newReview = {
                                  id: Date.now().toString(),
                                  photo: "",
                                  name: "",
                                  description: ""
                                };
                                setReviews([...reviews, newReview]);
                              }}
                              className="w-full border-dashed"
                            >
                              + Adicionar Depoimento
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Tab Content - Order Bump */}
                <TabsContent value="order-bump" className="p-6 space-y-6 m-0">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                          <ShoppingCart className="h-4 w-4" />
                          Order Bump
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          Adicione ofertas complementares ao checkout
                        </p>
                      </div>
                      <Switch
                        checked={orderBumpEnabled}
                        onCheckedChange={setOrderBumpEnabled}
                      />
                    </div>

                    {orderBumpEnabled && (
                      <>
                        {/* Título e Subtítulo */}
                        <div className="space-y-3 pt-4 border-t">
                          <div>
                            <Label className="text-sm font-medium">Título</Label>
                            <Input
                              value={orderBumpTitle}
                              onChange={(e) => setOrderBumpTitle(e.target.value)}
                              placeholder="Oferta Especial Para Você!"
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Subtítulo</Label>
                            <Input
                              value={orderBumpSubtitle}
                              onChange={(e) => setOrderBumpSubtitle(e.target.value)}
                              placeholder="Aproveite esta oferta única"
                              className="mt-1"
                            />
                          </div>
                        </div>

                        {/* Lista de Produtos Selecionados */}
                        <div className="space-y-3 pt-4 border-t">
                          <Label className="text-sm font-medium">Produtos do Order Bump</Label>
                          
                          {orderBumpProducts.map((product, index) => (
                            <Card key={index} className="p-3 border-2">
                              <div className="flex gap-3">
                                {/* Imagem */}
                                <div className="flex-shrink-0">
                                  {product.imageUrl && (
                                    <img 
                                      src={resolveImageUrl(product.imageUrl) || ''} 
                                      alt={product.title}
                                      className="w-16 h-16 object-cover rounded border"
                                    />
                                  )}
                                  <Label 
                                    htmlFor={`bump-image-${index}`}
                                    className="mt-2 cursor-pointer text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
                                  >
                                    <Upload className="h-3 w-3" />
                                    {product.imageUrl ? 'Trocar' : 'Adicionar'}
                                  </Label>
                                  <input
                                    id={`bump-image-${index}`}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      
                                      const formData = new FormData();
                                      formData.append('file', file);
                                      
                                      try {
                                        const token = await auth.currentUser?.getIdToken();
                                        const response = await fetch('/api/upload/image', {
                                          method: 'POST',
                                          headers: { 'Authorization': `Bearer ${token}` },
                                          body: formData,
                                        });
                                        
                                        if (response.ok) {
                                          const data = await response.json();
                                          const updated = [...orderBumpProducts];
                                          updated[index].imageUrl = data.url;
                                          setOrderBumpProducts(updated);
                                          toast({
                                            title: "Imagem adicionada",
                                            description: "A imagem do Order Bump foi atualizada com sucesso.",
                                          });
                                        } else {
                                          const err = await response.json().catch(() => ({}));
                                          toast({
                                            title: "Erro no upload",
                                            description: err.error || "Não foi possível fazer upload da imagem.",
                                            variant: "destructive",
                                          });
                                        }
                                      } catch (error) {
                                        toast({
                                          title: "Erro no upload",
                                          description: "Não foi possível fazer upload da imagem.",
                                          variant: "destructive",
                                        });
                                      }
                                    }}
                                  />
                                </div>
                                
                                {/* Título e Descrição */}
                                <div className="flex-1 min-w-0 space-y-2">
                                  <Input
                                    placeholder="Título customizado (opcional)"
                                    value={product.customTitle || ''}
                                    onChange={(e) => {
                                      const updated = [...orderBumpProducts];
                                      updated[index].customTitle = e.target.value;
                                      setOrderBumpProducts(updated);
                                    }}
                                    className="text-sm"
                                  />
                                  <Input
                                    placeholder="Descrição customizada (opcional)"
                                    value={product.customDescription || ''}
                                    onChange={(e) => {
                                      const updated = [...orderBumpProducts];
                                      updated[index].customDescription = e.target.value;
                                      setOrderBumpProducts(updated);
                                    }}
                                    className="text-sm"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      type="number"
                                      placeholder="Desconto %"
                                      value={product.discount || 0}
                                      onChange={(e) => {
                                        const updated = [...orderBumpProducts];
                                        updated[index].discount = parseInt(e.target.value) || 0;
                                        setOrderBumpProducts(updated);
                                      }}
                                      className="text-sm"
                                    />
                                    <p className="text-sm font-semibold flex items-center">
                                      R$ {(product.price / 100).toFixed(2)}
                                    </p>
                                  </div>
                                </div>

                                {/* Botão Remover */}
                                <button
                                  onClick={() => {
                                    setOrderBumpProducts(orderBumpProducts.filter((_, i) => i !== index));
                                  }}
                                  className="text-red-500 hover:text-red-600"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              <p className="text-xs text-gray-500 mt-2">
                                Original: {product.title}
                              </p>
                            </Card>
                          ))}

                          {/* Passo 1: Selecionar produto */}
                          <div className="space-y-3">
                            <Label className="text-xs text-gray-600">Selecionar produto:</Label>
                            {isLoadingCheckouts ? (
                              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-center text-sm text-gray-600">
                                Carregando produtos...
                              </div>
                            ) : availableProducts.filter(p => p.id !== productId && !orderBumpProducts.some(op => {
                                const ck = availableCheckouts.find(c => c.id === op.checkoutId);
                                return ck?.syncedProductId === p.id;
                              })).length === 0 ? (
                              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-center text-sm text-gray-600">
                                Nenhum outro produto disponível
                              </div>
                            ) : (
                              <Select
                                value={pendingBumpProductId || ''}
                                onValueChange={handleProductSelectedForBump}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Escolher produto..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableProducts
                                    .filter(p => p.id !== productId && !orderBumpProducts.some(op => {
                                      const ck = availableCheckouts.find(c => c.id === op.checkoutId);
                                      return ck?.syncedProductId === p.id;
                                    }))
                                    .map(p => (
                                      <SelectItem key={p.id} value={p.id}>
                                        {p.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            )}

                            {/* Passo 2: Selecionar oferta do produto escolhido */}
                            {pendingBumpProductId && (
                              <div className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800 space-y-2">
                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  Escolha a oferta:
                                </p>
                                {pendingProductCheckouts.length === 0 ? (
                                  <p className="text-xs text-gray-500 italic">
                                    Nenhuma oferta cadastrada para este produto.
                                  </p>
                                ) : (
                                  <RadioGroup
                                    value={selectedBumpOfferId || ''}
                                    onValueChange={(val) => {
                                      setSelectedBumpOfferId(val);
                                      const ck = pendingProductCheckouts.find(c => c.id === val);
                                      setPendingBumpCheckout(ck || null);
                                    }}
                                    className="space-y-1"
                                  >
                                    {pendingProductCheckouts.map(ck => (
                                      <div key={ck.id} className="flex items-center gap-2 cursor-pointer">
                                        <RadioGroupItem value={ck.id} id={`bump-ck-${ck.id}`} />
                                        <label
                                          htmlFor={`bump-ck-${ck.id}`}
                                          className="text-sm cursor-pointer flex-1 flex justify-between"
                                        >
                                          <span>{ck.title}</span>
                                          {ck.pricing?.amount ? (
                                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                                              R$ {(ck.pricing.amount / 100).toFixed(2)}
                                            </span>
                                          ) : null}
                                        </label>
                                      </div>
                                    ))}
                                  </RadioGroup>
                                )}

                                <div className="flex gap-2 pt-2">
                                  <Button
                                    size="sm"
                                    onClick={handleConfirmBumpAdd}
                                    disabled={!pendingBumpCheckout}
                                    className="bg-blue-600 hover:bg-green-700 text-white text-xs"
                                  >
                                    Adicionar ao Order Bump
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setPendingBumpProductId(null);
                                      setPendingBumpCheckout(null);
                                      setSelectedBumpOfferId(null);
                                    }}
                                    className="text-xs"
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Total do Pedido */}
                        <div className="pt-4 border-t">
                          <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                            <span className="font-semibold text-gray-900 dark:text-white">Total do Pedido:</span>
                            <span className="text-xl font-bold text-gray-900 dark:text-white">
                              R$ {(totalPrice / 100).toFixed(2)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Produto principal + {orderBumpProducts.length} order bump(s)
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </TabsContent>

                {/* Tab Content - Back Redirect */}
                <TabsContent value="back-redirect" className="p-6 space-y-6 m-0">
                  <div className="space-y-4">
                    <div>
                      <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                        <ExternalLink className="h-4 w-4" />
                        Back Redirect
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Quando o visitante apertar o botão voltar (celular ou PC), será redirecionado para a URL abaixo.
                      </p>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-sm text-gray-800">
                        <strong>Como funciona:</strong> Se preenchida, ao tentar sair do checkout pelo botão voltar do navegador ou do celular, o visitante é levado para o link que você definir (ex: uma página de downsell, oferta especial ou isca digital).
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">URL de redirecionamento</Label>
                      <Input
                        value={backRedirectUrl}
                        onChange={(e) => setBackRedirectUrl(e.target.value)}
                        placeholder="https://seusite.com/oferta-especial"
                        type="url"
                        className="mt-1"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Deixe em branco para desativar. Use sempre https://.
                      </p>
                    </div>

                    {backRedirectUrl && (
                      <div className="flex items-center gap-2 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg p-3">
                        <CheckCircle className="h-4 w-4 flex-shrink-0 text-gray-600" />
                        <span>Back Redirect ativo — visitantes serão redirecionados para esta URL ao tentar sair.</span>
                      </div>
                    )}
                  </div>
                </TabsContent>
            </div>
          </div>
        </Tabs>

        {/* Footer com botões */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="px-6"
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            className="px-6 bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
            disabled={isSaving}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {isSaving 
              ? (checkoutId ? "Salvando alterações..." : "Criando oferta...") 
              : (checkoutId ? "Salvar alterações" : "Criar oferta")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
