import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, CreditCard, Loader2, Lock, ShieldCheck, User, Calendar, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatBRL } from "@/lib/utils";
import { loadEfiBankSDK } from "@/lib/efibank-sdk";
import type { Checkout, Customer, CreatePaymentSessionResponse } from "@shared/schema";
import { trackCheckoutAnalytics } from "@/lib/checkout-analytics"; // ANALYTICS TRACKING
import { checkoutAnalyticsTracker } from "@/lib/checkout-analytics-tracking"; // DASHBOARD ANALYTICS
import { pixelTracker } from "@/lib/pixel-tracking";
import { usePaymentSuccess } from '@/hooks/use-payment-success';

interface EfiBankCardPaymentProps {
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
  selectedOrderBumps?: string[];
  affiliateUid?: string | null; // CÓDIGO DE AFILIADO capturado da URL (?aff=CODIGO)
  couponCode?: string; // CUPOM DE DESCONTO aplicado
  offerSlug?: string; // Slug da oferta selecionada (para validação de preço no servidor)
}

export function EfiBankCardPayment({ 
  checkout, 
  customer, 
  amount, 
  addressData,
  onPaymentData, 
  selectedOrderBumps = [],
  affiliateUid,
  couponCode,
  offerSlug
}: EfiBankCardPaymentProps) {
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"initial" | "processing" | "succeeded" | "failed">("initial");
  const [selectedInstallments, setSelectedInstallments] = useState(1);
  const [cardData, setCardData] = useState({
    number: '',
    holderName: '',
    expirationMonth: '',
    expirationYear: '',
    cvv: ''
  });
  const { toast } = useToast();
  const { handlePaymentSuccess } = usePaymentSuccess();

  //  CARREGAR EFIBANK SDK
  useEffect(() => {
    const initializeSDK = async () => {
      try {
        console.log(' Carregando EfBank SDK para cartão...');
        const success = await loadEfiBankSDK();
        setSdkReady(success);
        
        if (success) {
          console.log(' EfBank SDK carregado com sucesso para cartão');
        } else {
          console.error(' Falha ao carregar EfBank SDK');
          toast({
            title: "Erro no SDK",
            description: "Falha ao carregar processador de pagamento",
            variant: "destructive"
          });
        }
      } catch (error) {
        console.error(' Erro ao inicializar SDK:', error);
        setSdkReady(false);
      }
    };

    initializeSDK();
  }, [toast]);

  //  OPÇES DE PARCELAMENTO — limitado pelo config do checkout E pelo valor mínimo por parcela
  // Mínimo R$5,00 (500 centavos) por parcela — evita parcelamento absurdo em valores baixos
  const MIN_INSTALLMENT_CENTS = 500;
  const configuredMax = checkout.installments?.max || 12;
  const maxByValue = Math.max(1, Math.floor(amount / MIN_INSTALLMENT_CENTS));
  const maxInstall = Math.min(configuredMax, maxByValue);
  const allInstallmentOptions = [
    { value: 1, label: `1x de ${formatBRL(amount)} (à vista)` },
    { value: 2, label: `2x de ${formatBRL(Math.round(amount / 2))}` },
    { value: 3, label: `3x de ${formatBRL(Math.round(amount / 3))}` },
    { value: 4, label: `4x de ${formatBRL(Math.round(amount / 4))}` },
    { value: 5, label: `5x de ${formatBRL(Math.round(amount / 5))}` },
    { value: 6, label: `6x de ${formatBRL(Math.round(amount / 6))}` },
    { value: 7, label: `7x de ${formatBRL(Math.round(amount / 7))}` },
    { value: 8, label: `8x de ${formatBRL(Math.round(amount / 8))}` },
    { value: 9, label: `9x de ${formatBRL(Math.round(amount / 9))}` },
    { value: 10, label: `10x de ${formatBRL(Math.round(amount / 10))}` },
    { value: 11, label: `11x de ${formatBRL(Math.round(amount / 11))}` },
    { value: 12, label: `12x de ${formatBRL(Math.round(amount / 12))}` }
  ];
  const installmentOptions = allInstallmentOptions.slice(0, maxInstall);

  //  HELPER: TIMEOUT WRAPPER PARA PREVENIR TRAVAMENTO DO SDK
  const awaitWithTimeout = async <T,>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string
  ): Promise<T> => {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${operation} demorou mais de ${timeoutMs/1000}s`)), timeoutMs)
    );
    return Promise.race([promise, timeoutPromise]);
  };

  //  DETECTAR BANDEIRA DO CARTÃO
  const detectCardBrand = (cardNumber: string): string => {
    const number = cardNumber.replace(/\s/g, '');
    
    // Visa
    if (/^4/.test(number)) return 'visa';
    
    // Mastercard
    if (/^(5[1-5]|2[2-7])/.test(number)) return 'mastercard';
    
    // Elo
    if (/^(4011|4312|4389|4514|4576|5041|5066|5067|5090|6277|6362|6363|6516|6550)/.test(number)) return 'elo';
    
    // Hipercard
    if (/^(38|60)/.test(number)) return 'hipercard';
    
    // Amex
    if (/^3[47]/.test(number)) return 'amex';
    
    // Diners
    if (/^(30|36|38)/.test(number)) return 'diners';
    
    // Default
    return 'visa';
  };

  //  PROCESSAR PAGAMENTO COM CARTÃO EFIBANK
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !sdkReady) return;

    // 📊 RASTREAR CLIQUE NO BOTÃO DE COMPRA (DASHBOARD ANALYTICS)
    checkoutAnalyticsTracker.track('purchase_button_click', {
      method: 'card',
      acquirer: 'efibank',
      amount
    });

    pixelTracker.trackAddPaymentInfo(amount, checkout?.globalSettings?.currency || checkout?.currency || 'BRL', 'credit_card');

    // 📊 RASTREAR CLIQUE NO BOTÃO DE PAGAMENTO (PIXELS EXTERNOS)
    if (checkout?.id) {
      trackCheckoutAnalytics(checkout.id, 'paymentClicked');
    }

    setLoading(true);
    setPaymentStatus("processing");

    try {
      console.log(' Processando pagamento EfBank cartão...');

      // VALIDAÇES
      if (!cardData.number || !cardData.holderName || !cardData.cvv || !cardData.expirationMonth || !cardData.expirationYear) {
        throw new Error('Todos os campos do cartão so obrigatórios');
      }

      //  BUSCAR CONFIGURAÇÃO DO BACKEND PRIMEIRO (antes de verificar SDK)
      console.log('Buscando configuração EfBank do backend...');
      const configResponse = await fetch('/api/efibank/config');
      
      if (!configResponse.ok) {
        const errorText = await configResponse.text();
        console.error(' Erro ao buscar configuração:', configResponse.status, errorText);
        throw new Error(`Falha ao carregar configuração de pagamento (${configResponse.status})`);
      }
      
      const efiConfig = await configResponse.json();
      console.log(' Configurao EfBank obtida:', efiConfig.environment);

      //  VERIFICAR SE EfBank SDK ESTDISPONVEL
      if (!window.EfiPay?.CreditCard) {
        console.error(' SDK EfBank não está disponível. window.EfiPay:', window.EfiPay);
        throw new Error('Processador de pagamento no carregou. Recarregue a página e tente novamente.');
      }
      
      // Configurar SDK com credenciais de produção
      window.EfiPay.CreditCard.setEnvironment(efiConfig.environment);
      window.EfiPay.CreditCard.setAccount(efiConfig.payeeCode);

      //  DETECTAR BANDEIRA DO CARTÃO
      const cardBrand = detectCardBrand(cardData.number);
      console.log(' Bandeira detectada:', cardBrand);
      console.log('Número cartão (primeiros 6 dígitos):', cardData.number.replace(/\s/g, '').substring(0, 6));

      //  CONFIGURAR DADOS DO CARTÃO
      const creditCardData = {
        brand: cardBrand,
        number: cardData.number.replace(/\s/g, ''),
        cvv: cardData.cvv,
        expirationMonth: cardData.expirationMonth,
        expirationYear: cardData.expirationYear,
        holderName: cardData.holderName,
        holderDocument: customer.document,
        reuse: false
      };
      
      console.log(' ENVIANDO PARA SDK EfBank:', {
        brand: creditCardData.brand,
        numberLength: creditCardData.number.length,
        cvvLength: creditCardData.cvv.length,
        expirationMonth: creditCardData.expirationMonth,
        expirationYear: creditCardData.expirationYear,
        hasHolderName: !!creditCardData.holderName,
        hasHolderDocument: !!creditCardData.holderDocument
      });
      
      //  TOKENIZAÇÃO COM TIMEOUT + FALLBACK BACKEND (PREVENIR TRAVAMENTO INFINITO)
      let tokenResponse: { payment_token: string; card_mask: string };
      const startTime = Date.now();
      
      try {
        //  TENTAR VIA SDK COM TIMEOUT DE 25s
        console.log(' Configurando dados do cartão no SDK (timeout: 25s)...');
        await awaitWithTimeout(
          window.EfiPay.CreditCard.setCreditCardData(creditCardData),
          25000,
          'setCreditCardData'
        );
        
        console.log(' Obtendo token de pagamento do SDK (timeout: 25s)...');
        tokenResponse = await awaitWithTimeout(
          window.EfiPay.CreditCard.getPaymentToken(),
          25000,
          'getPaymentToken'
        );
        
        const elapsedMs = Date.now() - startTime;
        console.log(` Token EfBank obtido via SDK em ${elapsedMs}ms:`, tokenResponse.card_mask);
        
        //  TELEMETRIA: Sucesso via SDK
        if (checkout?.id) {
          trackCheckoutAnalytics(checkout.id, 'efibankSdkTokenSuccess');
        }
        
      } catch (sdkError: any) {
        const elapsedMs = Date.now() - startTime;
        console.warn(` SDK EfBank falhou após ${elapsedMs}ms:`, sdkError.message);
        
        //  TELEMETRIA: Falha do SDK (timeout ou erro)
        if (checkout?.id) {
          trackCheckoutAnalytics(checkout.id, 'efibankSdkTokenTimeout');
        }
        
        //  FALLBACK: TOKENIZAR VIA BACKEND (CAMINHO SEGURO)
        console.log(' Usando fallback: tokenização via backend...');
        
        try {
          const backendTokenResponse = await fetch('/api/efibank/tokenize-card-backend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...creditCardData,
              number: creditCardData.number.replace(/\s/g, '') // Remover espaços
            })
          });
          
          if (!backendTokenResponse.ok) {
            const errorData = await backendTokenResponse.json().catch(() => ({}));
            throw new Error(errorData.message || `Backend tokenization failed: ${backendTokenResponse.status}`);
          }
          
          const backendData = await backendTokenResponse.json();
          
          if (!backendData.payment_token) {
            throw new Error('Token não retornado pelo backend');
          }
          
          tokenResponse = {
            payment_token: backendData.payment_token,
            card_mask: backendData.card_mask || `****${creditCardData.number.slice(-4)}`
          };
          
          const totalElapsedMs = Date.now() - startTime;
          console.log(` Token obtido via BACKEND FALLBACK em ${totalElapsedMs}ms:`, tokenResponse.card_mask);
          
          //  TELEMETRIA: Sucesso via backend fallback
          if (checkout?.id) {
            trackCheckoutAnalytics(checkout.id, 'efibankBackendFallbackSuccess');
          }
          
        } catch (backendError: any) {
          console.error(' Falha no backend fallback:', backendError);
          
          //  TELEMETRIA: Falha total (SDK + backend)
          if (checkout?.id) {
            trackCheckoutAnalytics(checkout.id, 'efibankTokenizationTotalFailure');
          }
          
          throw new Error(
            'Não foi possível processar o cartão. Verifique os dados e tente novamente. ' +
            'Se o problema persistir, entre em contato com o suporte.'
          );
        }
      }

      //  ENVIAR PARA BACKEND PARA PROCESSAR
      const response = await fetch('/api/payments/efibank-card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          checkoutId: checkout.id,
          amount,
          installments: selectedInstallments,
          customer,
          customerAddress: addressData,
          paymentToken: tokenResponse.payment_token,
          cardMask: tokenResponse.card_mask,
          selectedOrderBumps,
          affiliateUid: affiliateUid || (typeof window !== 'undefined' ? 
            localStorage.getItem('affiliate_uid') : null),
          couponCode: couponCode || undefined,
          offerSlug: offerSlug || undefined,
          trackingParameters: (() => {
            try {
              const p = new URLSearchParams(window.location.search);
              return {
                src: p.get('src') || null, sck: p.get('sck') || null,
                utm_source: p.get('utm_source') || null, utm_campaign: p.get('utm_campaign') || null,
                utm_medium: p.get('utm_medium') || null, utm_content: p.get('utm_content') || null,
                utm_term: p.get('utm_term') || null,
              };
            } catch { return undefined; }
          })()
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Erro ao processar pagamento. Tente novamente.');
      }

      const result = await response.json();
      
      if (result.success) {
        setPaymentStatus("succeeded");
        
        toast({
          title: "Pagamento Aprovado!",
          description: `Cartão processado com sucesso via EfBank`,
          variant: "default"
        });

        handlePaymentSuccess({
          orderId: result.orderId || result.transactionId || `efi_${Date.now()}`,
          amount: amount,
          currency: checkout.globalSettings?.currency || checkout.currency || 'BRL',
          productTitle: checkout.title || 'Produto',
          method: 'credit_card',
          customerName: customer.name,
          acquirer: 'efibank',
          checkoutSuccessUrl: checkout.urls?.success
        });

        onPaymentData(result);
      } else {
        throw new Error(result.message || result.error || 'Erro no processamento');
      }

    } catch (error) {
      console.error(' Erro EfBank cartão:', error);
      setPaymentStatus("failed");
      
      toast({
        title: "Erro no Pagamento",
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  //  SUCESSO
  if (paymentStatus === "succeeded") {
    return (
      <Card className="border-blue-200 bg-blue-50" data-testid="efibank-card-success">
        <CardContent className="pt-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
            <Check className="h-8 w-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Pagamento Aprovado!</h3>
          <p className="text-gray-600 mb-4">
            Seu pagamento com cartão foi processado com sucesso via EfBank.
          </p>
          <Badge variant="secondary" className="bg-blue-100 text-green-800">
            {formatBRL(amount)}
          </Badge>
        </CardContent>
      </Card>
    );
  }

  //  SDK NÃO CARREGADO
  if (!sdkReady) {
    return (
      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="pt-6 text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-yellow-600" />
          <p className="text-yellow-800">Carregando processador EfBank...</p>
        </CardContent>
      </Card>
    );
  }

  const brand = detectCardBrand(cardData.number);

  const brandLabel: Record<string, string> = {
    visa: 'VISA', mastercard: 'MASTER', elo: 'ELO',
    hipercard: 'HIPER', amex: 'AMEX', diners: 'DINERS'
  };

  const brandColors: Record<string, string> = {
    visa: '#c8d4f0', mastercard: '#ff8a80', elo: '#80d8ff',
    hipercard: '#ff8a80', amex: '#80d8ff', diners: '#b0bec5'
  };

  const displayNumber = cardData.number
    ? cardData.number.replace(/\d(?=.{1,4}\d{4})/g, '•').padEnd(19, ' •')
    : '•••• •••• •••• ••••';
  const displayName = cardData.holderName || 'NOME NO CARTÃO';
  const displayMonth = cardData.expirationMonth || 'MM';
  const displayYear = cardData.expirationYear ? cardData.expirationYear.slice(-2) : 'AA';

  const inputBase = "w-full h-12 border rounded-xl text-sm text-gray-900 bg-white placeholder-gray-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelStyle = "text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block";

  return (
    <form onSubmit={handleSubmit} className="space-y-5" style={{ backgroundColor: 'white', color: 'black' }} data-testid="efibank-card-form">

      {/* NÚMERO DO CARTÃO */}
      <div>
        <label htmlFor="card-number" className={labelStyle}>
          <span className="flex items-center gap-1.5"><CreditCard className="w-3 h-3" />Número do Cartão</span>
        </label>
        <input
          id="card-number"
          type="text"
          inputMode="numeric"
          placeholder="0000 0000 0000 0000"
          value={cardData.number}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');
            setCardData(prev => ({ ...prev, number: value }));
          }}
          maxLength={19}
          required
          className={`${inputBase} pl-4 pr-4 font-mono tracking-widest`}
          data-testid="input-card-number"
        />
      </div>

      {/* NOME NO CARTÃO */}
      <div>
        <label htmlFor="card-holder" className={labelStyle}>
          <span className="flex items-center gap-1.5"><User className="w-3 h-3" />Nome no Cartão</span>
        </label>
        <input
          id="card-holder"
          type="text"
          placeholder="NOME COMO NO CARTÃO"
          value={cardData.holderName}
          onChange={(e) => setCardData(prev => ({ ...prev, holderName: e.target.value.toUpperCase() }))}
          required
          className={`${inputBase} pl-4 pr-4 uppercase tracking-wide`}
          data-testid="input-card-holder"
        />
      </div>

      {/* VALIDADE + CVV */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="card-month" className={labelStyle}>
            <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />Mês</span>
          </label>
          <select
            id="card-month"
            value={cardData.expirationMonth}
            onChange={(e) => setCardData(prev => ({ ...prev, expirationMonth: e.target.value }))}
            className={`${inputBase} pl-3 pr-2 cursor-pointer`}
            data-testid="select-card-month"
          >
            <option value="" disabled>MM</option>
            {Array.from({ length: 12 }, (_, i) => {
              const month = (i + 1).toString().padStart(2, '0');
              return <option key={month} value={month}>{month}</option>;
            })}
          </select>
        </div>

        <div>
          <label htmlFor="card-year" className={labelStyle}>Ano</label>
          <input
            id="card-year"
            type="text"
            inputMode="numeric"
            placeholder="AAAA"
            value={cardData.expirationYear}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 4);
              setCardData(prev => ({ ...prev, expirationYear: val }));
            }}
            maxLength={4}
            required
            className={`${inputBase} pl-3 pr-2 font-mono tracking-widest text-center`}
            data-testid="input-card-year"
          />
        </div>

        <div>
          <label htmlFor="card-cvv" className={labelStyle}>
            <span className="flex items-center gap-1.5"><KeyRound className="w-3 h-3" />CVV</span>
          </label>
          <input
            id="card-cvv"
            type="text"
            inputMode="numeric"
            placeholder="•••"
            value={cardData.cvv}
            onChange={(e) => setCardData(prev => ({ ...prev, cvv: e.target.value.replace(/\D/g, '') }))}
            maxLength={4}
            required
            className={`${inputBase} pl-4 pr-2 font-mono tracking-widest text-center`}
            data-testid="input-card-cvv"
          />
        </div>
      </div>

      {/* PARCELAS */}
      {checkout.productType !== 'subscription' && (
        <div>
          <label htmlFor="efibank-installments" className={labelStyle}>Parcelas</label>
          <select
            id="efibank-installments"
            value={selectedInstallments.toString()}
            onChange={(e) => setSelectedInstallments(parseInt(e.target.value))}
            className={`${inputBase} pl-4 pr-4 cursor-pointer`}
            data-testid="select-efibank-installments"
          >
            {installmentOptions.map((option) => (
              <option key={option.value} value={option.value.toString()}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* BOTÃO PAGAR */}
      <Button
        type="submit"
        className="w-full h-14 text-base font-bold rounded-xl shadow-lg transition-all duration-150"
        style={{
          background: loading ? '#16a34a' : 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
          boxShadow: loading ? 'none' : '0 8px 24px rgba(22,163,74,0.4)',
          color: '#ffffff'
        }}
        disabled={loading || !sdkReady}
        data-payment-btn
        data-testid="button-efibank-card-pay"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Processando pagamento...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            Finalizar compra
          </span>
        )}
      </Button>

      {/* RODAPÉ DE SEGURANÇA */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
        <span>Pagamento 100% seguro e criptografado</span>
      </div>

      {checkout.productType === 'subscription' && (
        <p className="text-xs text-gray-400 text-center">
          Assinaturas são cobradas mensalmente
        </p>
      )}
    </form>
  );
}