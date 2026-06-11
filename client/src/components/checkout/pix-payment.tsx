import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Copy, Check, Clock, RefreshCw, QrCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePaymentSuccess } from "@/hooks/use-payment-success";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { getOrder } from "@/lib/firestore";
import type { 
  Checkout, 
  Customer, 
  CreatePaymentSessionRequest, 
  CreatePaymentSessionResponse,
  Order 
} from "@shared/schema";
import { formatBRL } from "@/lib/utils";
import { APP_CONFIG } from "@/lib/config";
import { trackCheckoutAnalytics } from "@/lib/checkout-analytics"; // ANALYTICS TRACKING
import { checkoutAnalyticsTracker } from "@/lib/checkout-analytics-tracking"; // DASHBOARD ANALYTICS
import { pixelTracker } from "@/lib/pixel-tracking";

interface PixPaymentProps {
  checkout: Checkout;
  customer: Customer;
  amount: number;
  addressData?: {
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  onPaymentData: (data: CreatePaymentSessionResponse) => void;
  selectedOrderBumps?: string[]; //  ORDERBUMP: IDs dos produtos selecionados
  affiliateUid?: string | null; // CÓDIGO DE AFILIADO capturado da URL (?aff=CODIGO)
  couponCode?: string; // CUPOM DE DESCONTO aplicado
  offerSlug?: string; // Slug da oferta selecionada (para validação de preço no servidor)
  onPixActionReady?: (createPixFn: () => Promise<void>, isLoading: boolean) => void; // Callback para expor função de criar Pix
  hideInitialButton?: boolean; // Esconder botão inicial quando for renderizado no resumo
}

export function PixPayment({ checkout, customer, amount, addressData, onPaymentData, selectedOrderBumps = [], affiliateUid, couponCode, offerSlug, onPixActionReady, hideInitialButton = false }: PixPaymentProps) {
  const [loading, setLoading] = useState(false);
  const [paymentData, setPaymentData] = useState<CreatePaymentSessionResponse | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes in seconds
  const [error, setError] = useState<string | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [manualCheckEnabled, setManualCheckEnabled] = useState(false);
  const [paymentStartTime, setPaymentStartTime] = useState<number | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const addPaymentInfoFired = useRef(false);
  const { toast} = useToast();
  const { handlePaymentSuccess } = usePaymentSuccess();

  // 🔧 FIX: useRef para evitar loop infinito
  const pixActionReadyRef = useRef(onPixActionReady);
  
  // Atualizar ref quando callback mudar (sem causar re-render)
  useEffect(() => {
    pixActionReadyRef.current = onPixActionReady;
  }, [onPixActionReady]);

  // PIX REAL via Express + EfBank API
  const createPixPayment = useCallback(async () => {
    if (loading) return; // Prevenir cliques duplos
    
    // 📊 RASTREAR CLIQUE NO BOTÃO DE COMPRA (DASHBOARD ANALYTICS)
    checkoutAnalyticsTracker.track('purchase_button_click', {
      method: 'pix',
      acquirer: 'efibank',
      amount
    });
    
    // 📊 RASTREAR CLIQUE NO BOTÃO DE PAGAMENTO (PIXELS EXTERNOS)
    if (checkout?.id) {
      trackCheckoutAnalytics(checkout.id, 'paymentClicked');
    }
    
    setLoading(true);
    setError(null);
    
    try {
      console.log(' PROCESSANDO PIX REAL EFBANK - PRODUTO:', checkout.productType);
      console.log(' Tipo checkout:', checkout.productType);
      console.log(' Valor em CENTAVOS (já convertido):', amount);
      console.log(' Cliente:', customer.name);
      
      const apiUrl = `${APP_CONFIG.getApiUrl('/api/payment/create-session')}`;
      console.log(' URL DA API:', apiUrl);
      
      //  VALIDAÇES PREVENTIVAS
      if (!checkout?.id) {
        throw new Error('ID do checkout não encontrado');
      }
      if (!customer?.name || !customer?.email) {
        throw new Error('Dados do cliente incompletos');
      }
      if (!amount || amount <= 0) {
        throw new Error('Valor invlido para pagamento');
      }
      
      //  USAR API REAL EFBANK DIRETAMENTE - SEM FALLBACK!
      console.log('DEBUG VALOR ANTES DE ENVIAR:', {
        amountCentavos: amount,
        checkoutSlug: checkout.slug
      });
      
      // Fallback: extrair slug da URL caso checkout.slug esteja ausente (checkout legado)
      const urlParts = window.location.pathname.split('/');
      const checkoutIdx = urlParts.findIndex(p => p === 'checkout' || p === 'c');
      const urlSlug = checkoutIdx >= 0 ? urlParts[checkoutIdx + 1] : null;
      const resolvedCheckoutId = checkout.slug || urlSlug || checkout.id;

      const response = await fetch(`${APP_CONFIG.getApiUrl('/api/payment/create-session')}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          checkoutId: resolvedCheckoutId,
          method: 'pix',
          customer,
          customerAddress: addressData,
          amount,
          productType: checkout.productType,
          affiliateUid: affiliateUid || (typeof window !== 'undefined' ? 
            localStorage.getItem('affiliate_uid') : null),
          selectedOrderBumps: selectedOrderBumps,
          couponCode: couponCode || undefined,
          offerSlug: offerSlug || undefined,
          trackingParameters: (() => {
            try {
              const params = new URLSearchParams(window.location.search);
              return {
                src: params.get('src') || null,
                sck: params.get('sck') || null,
                utm_source: params.get('utm_source') || null,
                utm_campaign: params.get('utm_campaign') || null,
                utm_medium: params.get('utm_medium') || null,
                utm_content: params.get('utm_content') || null,
                utm_term: params.get('utm_term') || null,
              };
            } catch { return undefined; }
          })()
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ${response.status}: ${errorText}`);
      }

      //  PROTEGER CONTRA "UNAUTHORIZED" BUG
      const responseText = await response.text();
      if (!responseText || responseText.trim() === 'unauthorized' || responseText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema na conexo PIX');
      }
      
      let paymentData;
      try {
        paymentData = JSON.parse(responseText) as CreatePaymentSessionResponse;
      } catch (parseError) {
        console.error(' PIX JSON parse error:', responseText.substring(0, 100));
        throw new Error('Resposta inválida do servidor PIX');
      }

      if (!paymentData || !paymentData.qrcode) {
        throw new Error('QR Code PIX no foi gerado');
      }

      console.log(' PIX RECEBIDO DO SERVIDOR:', paymentData);
      console.log(' PIX FONTE:', (paymentData as any).source || 'unknown');
      console.log('PIX TxID:', (paymentData as any).txid || paymentData.orderId);
      console.log(' QR Code:', paymentData.qrcode?.text?.substring(0, 50) + '...');

      setPaymentData(paymentData);
      
      if (!addPaymentInfoFired.current) {
        addPaymentInfoFired.current = true;
        pixelTracker.trackAddPaymentInfo(amount, 'BRL', 'pix');
      }

      //  GARANTIR QUE STATUS PENDING APAREÇA NO DASHBOARD!
      console.log('CRIANDO ORDEM PENDENTE NO FRONTEND...');
      const pendingOrder: Order = {
        id: paymentData.orderId,
        tenantId: checkout.tenantId,
        checkoutId: checkout.id,
        status: "pending" as const,
        method: "pix" as const,
        customer,
        amount: amount, // Usar amount correto
        currency: "BRL",
        efiChargeId: (paymentData as any).txid || paymentData.orderId,
        qrcode: paymentData.qrcode,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      setOrder(pendingOrder);
      
      // 📊 RASTREAR COMPRA PENDENTE (DASHBOARD ANALYTICS)
      checkoutAnalyticsTracker.track('purchase_pending', {
        orderId: paymentData.orderId,
        method: 'pix',
        amount: amount
      });
      
      // Registrar horrio de início do pagamento
      const startTime = Date.now();
      setPaymentStartTime(startTime);
      
      console.log(' INICIANDO POLLING REAL FIREBASE...');
      startRealPolling(paymentData.orderId);
      
      // Habilitar verificação manual após 30 segundos
      setTimeout(() => {
        setManualCheckEnabled(true);
      }, 30000);

    } catch (error: any) {
      console.error(' ERRO AO CRIAR PIX:', error);
      console.error(' ERRO TYPE:', typeof error);
      console.error(' ERRO MESSAGE:', error.message);
      console.error(' ERRO STACK:', error.stack);
      
      toast({
        title: "Erro",
        description: error.message || "Falha ao criar pagamento Pix. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [checkout, customer, amount, addressData, selectedOrderBumps, affiliateUid, toast]);

  // 🔧 Expor createPixPayment atualizado quando amount/bumps/coupon mudar
  useEffect(() => {
    if (pixActionReadyRef.current) {
      pixActionReadyRef.current(createPixPayment, loading);
    }
  }, [loading, createPixPayment]); // createPixPayment muda quando amount/bumps/coupon mudam → atualiza fn no pai

  //  POLLING ULTRA OTIMIZADO - REDUZIDO DE 240 PARA 60 TENTATIVAS (10 MIN)
  const startRealPolling = (orderId: string) => {
    let attempts = 0;
    const maxAttempts = 60; //  10 minutos (otimizado de 20min)
    let pollTimeout: NodeJS.Timeout;
    let isPolling = true; // Flag para controlar polling

    const poll = async () => {
      if (!isPolling || attempts >= maxAttempts) {
        if (attempts >= maxAttempts) {
          setOrder(prev => prev ? { ...prev, status: "expired" } : null);
          toast({
            title: "PIX Expirado",
            description: "O pagamento PIX expirou. Gere um novo código.",
            variant: "destructive",
          });
        }
        return;
      }

      attempts++;
      
      try {
        //  BUSCAR STATUS COM RETRY E TIMEOUT OTIMIZADO
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
        
        const response = await fetch(`/api/orders/${orderId}/status?_t=${Date.now()}`, {
          signal: controller.signal,
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        clearTimeout(timeoutId);
        
        let currentOrder = null;
        
        if (response.ok) {
          currentOrder = await response.json();
        } else {
          console.warn(' Erro no polling:', response.status);
        }
        
        //  VALIDAÇÃO ESPECIAL: Se PIX esthmais de 5 minutos pendente, apenas alertar
        if (currentOrder && currentOrder.status === "pending" && attempts >= 60) {
          const orderCreatedAt = new Date(currentOrder.createdAt);
          const now = new Date();
          const minutesSinceCreated = Math.floor((now.getTime() - orderCreatedAt.getTime()) / (1000 * 60));
          
          if (minutesSinceCreated >= 5) {
            console.log(` PIX PENDENTE H${minutesSinceCreated} MINUTOS - aguardando webhook de confirmação`);
            // SEGURANÇA: Remoo do endpoint admin client-side - confirmação apenas via webhook
          }
        }
        
        // Log reduzido mas mais informativo
        if (attempts % 15 === 0 || currentOrder?.status !== "pending") {
          console.log(` Polling ${attempts}/${maxAttempts} - Order: ${orderId} Status: ${currentOrder?.status || 'N/A'}`);
        }
        
        if (currentOrder && currentOrder.status !== "pending") {
          isPolling = false; // Parar polling
          setOrder(currentOrder);
          console.log(' STATUS MUDOU PARA:', currentOrder.status);
          
          //  PAGAMENTO CONFIRMADO - PARAR IMEDIATAMENTE
          if (currentOrder.status === "paid") {
            console.log(' PAGAMENTO CONFIRMADO! Redirecionando...');
            
            //  MARCAR COMO CONFIRMADO ANTES DE TUDO
            setIsConfirmed(true);
            
            // 📊 RASTREAR COMPRA APROVADA (DASHBOARD ANALYTICS)
            checkoutAnalyticsTracker.track('purchase_approved', {
              orderId: currentOrder.id,
              method: 'pix',
              amount: currentOrder.amount
            });
            
            //  AGORA SIM: Chamar onPaymentData quando status for realmente 'paid'
            onPaymentData({
              orderId: currentOrder.id,
              method: 'pix',
              qrcode: paymentData?.qrcode,
              amount: currentOrder.amount,
              status: 'paid'
            } as CreatePaymentSessionResponse);
            
            //  NOTIFICAÇÃO IMEDIATA DE PAGAMENTO APROVADO
            toast({
              title: "Pagamento Aprovado!",
              description: "PIX confirmado! Seu acesso foi liberado. Redirecionando...",
              duration: 4000,
            });
            
            // Atualizar order local para mostrar sucesso
            setOrder(currentOrder);
            
            // USAR HOOK CENTRALIZADO PARA SUCESSO DE PAGAMENTO
            // Dispara pixel de Purchase + Redireciona para URL de sucesso
            handlePaymentSuccess({
              orderId: currentOrder.id,
              amount: currentOrder.amount || amount || checkout.pricing?.amount || 0,
              currency: 'BRL',
              productTitle: checkout.title,
              method: 'pix',
              customerName: customer?.name,
              acquirer: 'efibank',
              checkoutSuccessUrl: checkout.urls.success
            });
            return;
          } else if (currentOrder.status === "failed" || currentOrder.status === "expired") {
            console.log(' Pagamento falhou:', currentOrder.status);
            toast({
              title: "Pagamento No Confirmado", 
              description: "O pagamento no foi processado. Tente novamente.",
              variant: "destructive",
            });
            return;
          }
        } else if (isPolling) {
          //  INTERVALO PROGRESSIVO ULTRA OTIMIZADO
          const nextInterval = attempts < 5 ? 3000 :   // 5 primeiros: 3s (15s total)
                              attempts < 15 ? 5000 :  // Prximos 10: 5s (50s total)
                              attempts < 30 ? 8000 :  // Prximos 15: 8s (2min total)
                              10000; // Resto: 10s (5min restantes) = TOTAL ~10 MIN
          
          pollTimeout = setTimeout(poll, nextInterval);
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('Timeout no polling - Tentativa:', attempts);
        } else {
          console.log(' Erro no polling (tentativa', attempts + '):', error.message);
        }
        
        //  Retry apenas se ainda estiver fazendo polling
        if (isPolling) {
          const retryDelay = Math.min(8000, 2000 * Math.pow(1.3, Math.min(attempts, 8)));
          pollTimeout = setTimeout(poll, retryDelay);
        }
      }
    };

    // Start polling
    poll();

    //  Cleanup function melhorado
    return () => {
      isPolling = false; // Parar polling imediatamente
      clearTimeout(pollTimeout);
    };
  };

  //  FUNÇÃO MELHORADA PARA VERIFICAÇÃO MANUAL DE PAGAMENTO
  const manualCheckPayment = async () => {
    if (!paymentData?.orderId || checkingPayment) return;
    
    setCheckingPayment(true);
    
    try {
      console.log('VERIFICAÇÃO MANUAL DE PAGAMENTO:', paymentData.orderId);
      
      //  Buscar com cache busting e timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(`/api/orders/${paymentData.orderId}/status?manual=true&_t=${Date.now()}`, {
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      clearTimeout(timeoutId);
      
      let currentOrder = null;
      
      if (response.ok) {
        currentOrder = await response.json();
      }
      
      if (currentOrder && currentOrder.status === "paid") {
        console.log(' PAGAMENTO CONFIRMADO NA VERIFICAÇÃO MANUAL!');
        
        //  MARCAR COMO CONFIRMADO ANTES DE TUDO (MANUAL)
        setIsConfirmed(true);
        
        // 📊 RASTREAR COMPRA APROVADA (DASHBOARD ANALYTICS)
        checkoutAnalyticsTracker.track('purchase_approved', {
          orderId: currentOrder.id,
          method: 'pix',
          amount: currentOrder.amount
        });
        
        //  AGORA SIM: Chamar onPaymentData quando status for realmente 'paid' (manual)
        onPaymentData({
          orderId: currentOrder.id,
          method: 'pix',
          qrcode: paymentData?.qrcode,
          amount: currentOrder.amount,
          status: 'paid'
        } as CreatePaymentSessionResponse);
        
        setOrder(currentOrder);
        
        toast({
          title: "Pagamento Confirmado!",
          description: "Seu pagamento PIX foi encontrado! Redirecionando...",
          duration: 4000,
        });
        
        // USAR HOOK CENTRALIZADO PARA SUCESSO DE PAGAMENTO
        // Dispara pixel de Purchase + Redireciona para URL de sucesso
        handlePaymentSuccess({
          orderId: currentOrder.id,
          amount: currentOrder.amount || amount || checkout.pricing?.amount || 0,
          currency: 'BRL',
          productTitle: checkout.title,
          method: 'pix',
          customerName: customer?.name,
          acquirer: 'efibank',
          checkoutSuccessUrl: checkout.urls.success
        });
        
      } else {
        toast({
          title: "Pagamento Ainda Pendente",
          description: "Seu pagamento ainda no foi confirmado pelo banco. Continue aguardando ou tente novamente em alguns minutos.",
          variant: "default",
        });
      }
      
    } catch (error) {
      console.error(' Erro na verificação manual:', error);
      toast({
        title: "Erro na Verificação",
        description: "No foi possvel verificar o status do pagamento. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setCheckingPayment(false);
    }
  };

  // Countdown timer
  useEffect(() => {
    if (!paymentData) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setOrder(prev => prev ? { ...prev, status: "expired" } : null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [paymentData]);

  const copyToClipboard = async () => {
    if (!paymentData?.qrcode?.text) return;

    try {
      await navigator.clipboard.writeText(paymentData.qrcode.text);
      setCopied(true);
      toast({
        title: "Copiado!",
        description: "Código Pix copiado para a área deb transferência",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Erro",
        description: "Falha ao copiar código Pix",
        variant: "destructive",
      });
    }
  };

  //  RENDERIZAR TELA DE SUCESSO APENAS QUANDO REALMENTE CONFIRMADO
  if (order?.status === "paid" && isConfirmed) {
    return (
      <div className="max-w-lg mx-auto bg-white border-2 border-emerald-200/40 rounded-2xl p-8 text-center shadow-sm">
        <div className="w-20 h-20 bg-emerald-600/10 border-2 border-emerald-600/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        
        <h3 className="text-2xl font-bold text-muted-foreground mb-3">
          Pagamento Confirmado!
        </h3>
        
        <p className="text-muted-foreground mb-6 text-lg">
          Seu pagamento PIX foi processado com sucesso! Seu acesso foi liberado automaticamente.
        </p>
        
        <div className="bg-white border-2 border-emerald-200/30 rounded-lg p-4 mb-6">
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center justify-center gap-2">
              <span><strong>Transação aprovada</strong></span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <span><strong>Produto liberado</strong></span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <span><strong>Recibo enviado por e-mail</strong></span>
            </div>
          </div>
        </div>
        
        <p className="text-muted-foreground font-medium">
          Redirecionando automaticamente em instantes...
        </p>
      </div>
    );
  }

  // Renderizar tela de erro quando pagamento falhar
  if (order?.status === "failed" || order?.status === "expired") {
    return (
      <div className="max-w-md mx-auto bg-white border-2 border-red-200/40 rounded-xl p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-muted-foreground mb-2">
           Pagamento No Confirmado
        </h3>
        <p className="text-muted-foreground mb-4">
          O pagamento no foi processado. Tente novamente.
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-emerald-500 text-white px-6 py-2 rounded-lg hover:bg-emerald-500 transition-colors"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };



  // Se hideInitialButton for true, não renderizar nada (botão será renderizado no resumo)
  if (!paymentData) {
    if (hideInitialButton) {
      return null;
    }
    
    return (
      <div className="space-y-6" data-testid="pix-initial">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Pagar com Pix</h3>
          <p className="text-gray-600 mb-4">
            Pagamento instantneo via QR Code ou copiar e colar
          </p>
        </div>
        
        <button
          onClick={createPixPayment}
          disabled={loading}
          className="w-full bg-emerald-500 hover:bg-emerald-500 disabled:bg-emerald-500 text-white font-semibold py-4 px-6 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
          data-testid="button-generate-pix"
        >
          {loading ? (
            <>
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>Gerando Código Pix...</span>
            </>
          ) : (
            <>
              <QrCode className="h-5 w-5" />
              <span>Gerar Código Pix</span>
            </>
          )}
        </button>
      </div>
    );
  }

  //  BUG FIX: Validar QR Code antes de renderizar
  const hasValidQRCode = paymentData?.qrcode?.text && (
    paymentData.qrcode.image || 
    paymentData.qrcode.text.length > 20 // PIX text vlido tem pelo menos 20 caracteres
  );

  //  ERRO: QR Code invlido ou incompleto
  if (paymentData && !hasValidQRCode) {
    return (
      <div className="space-y-4" data-testid="pix-payment-error">
        <Card className="border-2 border-red-200/40 bg-white">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-red-900 mb-2">
              Erro ao Gerar QR Code
            </h3>
            <p className="text-red-700 mb-4">
              No foi possvel gerar o código PIX. Por favor, tente novamente.
            </p>
            <Button 
              onClick={createPixPayment}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700"
            >
              {loading ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Tentando novamente...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Tentar Novamente
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pix-payment">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">Escaneie o QR Code</h3>
        <div className="flex items-center justify-center gap-2 text-muted-foreground mb-4">
          <Clock className="h-4 w-4" />
          <span data-testid="text-time-left">Expira em {formatTime(timeLeft)}</span>
        </div>
      </div>

      {/* Real QR Code from EfBank API */}
      <div className="flex justify-center mb-4">
        <div className="w-48 h-48 border-2 border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-center bg-white" data-testid="qr-code-real">
          {paymentData?.qrcode?.image ? (
            <div className="text-center">
              <img 
                src={paymentData.qrcode.image} 
                alt="QR Code Pix" 
                className="w-40 h-40 mx-auto"
                style={{ background: '#fff', display: 'block' }}
                data-testid="img-qrcode"
                onError={(e) => {
                  console.error(' Erro ao carregar imagem QR Code:', e);
                  toast({
                    title: "Erro ao Carregar QR Code",
                    description: "Tente copiar o código PIX abaixo.",
                    variant: "destructive"
                  });
                }}
              />
              <p className="text-xs text-muted-foreground mt-2">QR Code Pix Real</p>
            </div>
          ) : (
            <div className="text-center">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-700 dark:text-blue-400 mb-2" />
              <p className="text-xs text-muted-foreground">Gerando QR Code...</p>
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div>
        <h4 className="font-medium mb-2">Ou copie o código Pix:</h4>
        <div className="flex gap-2">
          <div className="flex-1 p-3 bg-white border border-emerald-200/30 rounded-md text-sm font-mono break-all max-h-20 overflow-y-auto">
            {paymentData?.qrcode?.text || "Gerando código Pix..."}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={copyToClipboard}
            disabled={!paymentData?.qrcode?.text}
            data-testid="button-copy-pix"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Interface principal melhorada */}
      <Card className="border-gray-200 dark:border-gray-700">
        <CardContent className="pt-4">
          <div className="text-center mb-4">
            <div className="flex items-center justify-center gap-2 mb-2">
              <RefreshCw className="h-5 w-5 text-primary animate-spin" />
              <span className="text-lg font-semibold">Aguardando confirmação do pagamento</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Verificando automaticamente o status do PIX
            </p>
          </div>

          {/* Status visual melhorado */}
          <div className="bg-white dark:bg-transparent rounded-lg p-4 mb-4 border border-orange-200 dark:border-orange-900">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-500 dark:bg-emerald-600 rounded-full flex items-center justify-center">
                  <Check className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">1. Fazer o pagamento PIX</p>
                  <p className="text-xs text-muted-foreground">QR Code gerado com sucesso</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-500 dark:bg-emerald-600 rounded-full flex items-center justify-center animate-pulse">
                  <RefreshCw className="h-4 w-4 text-white animate-spin" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">2. Confirmar pagamento</p>
                  <p className="text-xs text-muted-foreground">Aguardando confirmação do banco</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-300 dark:bg-gray-700 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-bold">3</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">3. Acessar área deb membros</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Aguardando etapa anterior</p>
                </div>
              </div>
            </div>
          </div>

          {/* área deb verificação manual */}
          <div className="bg-white border-2 border-emerald-200/40 rounded-lg p-4">
            <div className="text-center mb-3">
              <p className="text-sm font-bold text-muted-foreground mb-1">
                Pagamento aprovado no seu banco?
              </p>
              <p className="text-xs text-muted-foreground">
                Se viu "Pagamento Aprovado" no app do banco, clique no botão abaixo!
              </p>
            </div>
            
            {manualCheckEnabled ? (
              <Button
                onClick={manualCheckPayment}
                disabled={checkingPayment}
                className="w-full bg-emerald-500 hover:bg-emerald-500 text-white font-semibold py-3"
                data-testid="button-manual-check"
              >
                {checkingPayment ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                    Verificando Pagamento...
                  </>
                ) : (
                  <>
                    <Check className="h-5 w-5 mr-2" />
                     Confirmar Pagamento Aprovado
                  </>
                )}
              </Button>
            ) : (
              <div className="text-center space-y-2">
                <div className="w-full bg-gray-200 text-gray-500 py-3 rounded-lg mb-2">
                  <RefreshCw className="h-4 w-4 mx-auto animate-spin mb-1" />
                  <p className="text-sm">Aguarde {Math.max(0, 30 - Math.floor((Date.now() - (paymentStartTime || Date.now())) / 1000))}s</p>
                </div>
                <p className="text-xs text-gray-600">Verificação manual em instantes...</p>
                
              </div>
            )}
          </div>

          {/* Instrues de acesso */}
          <div className="mt-4 p-3 bg-muted/50 border border-border rounded-lg">
            <p className="text-xs text-muted-foreground text-center">
              <strong>Próximo passo:</strong> Após a confirmação do pagamento, acesse sua área deb membros usando o email <strong>{customer.email}</strong>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
