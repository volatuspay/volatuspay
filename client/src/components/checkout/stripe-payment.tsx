import { useState, useEffect } from "react";
import { Elements, PaymentElement, ExpressCheckoutElement, PaymentRequestButtonElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe, PaymentRequest } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, CreditCard, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePaymentSuccess } from "@/hooks/use-payment-success";
import { pixelTracker } from "@/lib/pixel-tracking";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useQuery } from "@tanstack/react-query";
import type { 
  Checkout, 
  Customer, 
  CreatePaymentSessionRequest, 
  CreatePaymentSessionResponse 
} from "@shared/schema";
import { formatBRL, formatCurrency, toMajorUnits, toMinorUnits } from "@/lib/utils";
import { APP_CONFIG } from "@/lib/config";
import { checkoutAnalyticsTracker } from "@/lib/checkout-analytics-tracking"; // DASHBOARD ANALYTICS

//  HELPER: OBTER TEXTO CORRETO BASEADO NO IDIOMA DO CHECKOUT
const getCheckoutText = (checkout: Checkout | undefined, texts: { pt: string; en: string; es?: string; fr?: string; de?: string }) => {
  if (!checkout) return texts.pt;
  
  //  Brasil sempre portugus
  if (checkout.marketTarget === 'brasil') {
    return texts.pt;
  }
  
  //  Global: usar idioma configurado
  const lang = checkout.globalSettings?.language || 'en';
  
  // Retornar texto no idioma especificado (fallback para inglês)
  if (lang === 'pt') return texts.pt;
  if (lang === 'es' && texts.es) return texts.es;
  if (lang === 'fr' && texts.fr) return texts.fr;
  if (lang === 'de' && texts.de) return texts.de;
  
  return texts.en; // Fallback para inglês
};

//  OBTER LOCALE PARA STRIPE BASEADO NA CONFIGURAÇÃO DO CHECKOUT
const getStripeLocaleFromCheckout = (marketTarget: string, globalLanguage?: string): string => {
  //  BRASIL: SEMPRE PORTUGUS
  if (marketTarget === 'brasil') {
    return 'pt-BR';
  }
  
  //  GLOBAL: USAR IDIOMA CONFIGURADO NO CHECKOUT (SEM AUTO-DETECÇÃO)
  const lang = (globalLanguage || 'en').toLowerCase();
  
  // Mapear para locales suportados pelo Stripe (com normalização)
  const localeMap: Record<string, string> = {
    'pt': 'pt-BR',
    'pt-br': 'pt-BR',
    'es': 'es',
    'es-es': 'es',
    'es-mx': 'es',
    'fr': 'fr',
    'fr-fr': 'fr',
    'de': 'de',
    'de-de': 'de',
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
  };
  
  // Tentar match exato primeiro, depois por prefixo de idioma
  const stripeLocale = localeMap[lang] || localeMap[lang.split('-')[0]] || 'en';
  console.log(`🌍 STRIPE LOCALE: ${stripeLocale} (market: ${marketTarget}, configured: ${globalLanguage})`);
  
  return stripeLocale;
};

//  STRIPE - CACHE DE CHAVE PÚBLICA
let stripePublicKeyCache: { key: string | null; loaded: boolean; timestamp: number } = { key: null, loaded: false, timestamp: 0 };

const getStripePublicKey = async (): Promise<string | null> => {
  // Cache vlido por 5 minutos (apenas para SUCESSO)
  if (stripePublicKeyCache.loaded && stripePublicKeyCache.key && (Date.now() - stripePublicKeyCache.timestamp) < 300000) {
    console.log(' Usando chave Stripe do cache');
    return stripePublicKeyCache.key;
  }

  try {
    console.log(' Buscando chave pblica Stripe da API...');
    const response = await fetch('/api/stripe/public-key');
    const data = await response.json();
    
    if (data.success && data.publicKey) {
      console.log(' Chave pblica Stripe carregada da API');
      stripePublicKeyCache = { key: data.publicKey, loaded: true, timestamp: Date.now() };
      return data.publicKey;
    } else {
      console.warn(' API retornou sem chave pblica Stripe');
      // NÃO CACHEAR FALHAS - permitir retry na prxima tentativa
      return null;
    }
  } catch (error) {
    console.error(' Erro ao buscar chave pblica Stripe:', error);
    // NÃO CACHEAR FALHAS - permitir retry na prxima tentativa
    return null;
  }
};

//  FUNÇÃO PARA CARREGAR STRIPE APENAS QUANDO NECESSRIO (CHECKOUTS GLOBAIS)
const getStripePromise = async (marketTarget: string, globalLanguage?: string): Promise<any> => {
  // Se é checkout brasileiro, no carregar Stripe (usar 100% EfBank)
  if (marketTarget === "brasil") {
    // Brazilian checkout - using EfBank
    return null;
  }

  //  CORRIGIDO: Usar chave do environment primeiro, fallback para API
  let stripePublicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.VITE_STRIPE_PUBLIC_KEY;
  
  if (!stripePublicKey) {
    // Fallback: buscar via API se não tiver no environment
    stripePublicKey = await getStripePublicKey();
  }
  
  if (stripePublicKey) {
    try {
      //  USAR IDIOMA CONFIGURADO NO CHECKOUT (SEM AUTO-DETECÇÃO)
      const locale = getStripeLocaleFromCheckout(marketTarget, globalLanguage);
      console.log(` ✅ STRIPE: Carregando com locale ${locale}`);
      
      return loadStripe(stripePublicKey, {
        locale: locale as any,
      });
    } catch (error) {
      console.error(' Erro ao carregar Stripe:', error);
      return null;
    }
  } else {
    console.error(' STRIPE: Nenhuma chave pblica encontrada');
    // Stripe configuration not found
    return null;
  }
};

interface StripePaymentProps {
  checkout: Checkout;
  customer: Customer;
  amount: number;
  onPaymentData: (data: CreatePaymentSessionResponse) => void;
  selectedOrderBumps?: string[];
  affiliateUid?: string | null;
  addressData?: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
}

interface CheckoutFormProps extends StripePaymentProps {
  clientSecret: string;
}

function CheckoutForm({ checkout, customer, amount, onPaymentData, clientSecret, addressData }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"initial" | "processing" | "succeeded" | "failed">("initial");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { handlePaymentSuccess } = usePaymentSuccess();
  
  // EXPRESS CHECKOUT: Mostra Apple Pay e Google Pay de forma destacada
  const [showExpressCheckout, setShowExpressCheckout] = useState(true);
  
  // PAYMENT REQUEST BUTTON (APPLE PAY / GOOGLE PAY) - LEGACY FALLBACK
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  
  //  ESTADO DE PARCELAMENTO STRIPE
  const [selectedInstallments, setSelectedInstallments] = useState(1);
  const [installmentOptions, setInstallmentOptions] = useState<Array<{value: number, label: string, fee: number}>>([]);

  //  CARREGAR CONFIGURAÇES DE TAXAS DE PARCELAMENTO (PBLICO)
  const { data: acquirerConfig } = useQuery({
    queryKey: ["public-acquirer-configs"],
    queryFn: async () => {
      try {
        const response = await fetch('/api/public/acquirers-config');
        if (response.ok) {
          const data = await response.json();
          return data;
        }
        return null;
      } catch (error) {
        console.log(' Erro ao carregar configurações pblicas, usando padrão');
        return null;
      }
    },
  });

  //  FUNÇÃO PARA CALCULAR OPÇES DE PARCELAMENTO STRIPE COM MOEDA CORRETA
  const calculateInstallmentOptions = () => {
    //  DETECTAR SE CHECKOUT GLOBAL OU BRASIL
    const isGlobal = checkout.marketTarget === 'global';
    const currency = checkout.globalSettings?.currency || 'USD';
    
    //  FUNÇÃO PARA FORMATAR VALOR NA MOEDA CORRETA (MINOR UNITS)
    const formatAmount = (minorUnits: number) => {
      if (isGlobal) {
        return formatCurrency(minorUnits, currency);
      } else {
        return formatBRL(minorUnits);
      }
    };
    
    //  REGRAS DE NEGCIO: Assinaturas no permitem parcelamento
    if (checkout.productType === 'subscription') {
      setInstallmentOptions([{
        value: 1,
        label: `1x ${formatAmount(amount)} (${isGlobal ? 'upfront' : 'vista'})`,
        fee: 0
      }]);
      setSelectedInstallments(1);
      return;
    }

    //  TAXAS DE PARCELAMENTO STRIPE (vem das configurações do admin)
    const stripeConfig = acquirerConfig?.stripe || {};
    const feeConfig = {
      installment1x: 0, // vista SEM TAXA - valor fixo
      installment2to6x: stripeConfig.installment2to6x || 6.2, // 2x a 6x
      installment7to9x: stripeConfig.installment7to9x || 7.2, // 7x a 9x  
      installment10to12x: stripeConfig.installment10to12x || 8.2 // 10x a 12x
    };

    const options = [];

    // 1x vista (SEM TAXA - valor exato do produto)
    options.push({
      value: 1,
      label: `1x ${formatAmount(amount)} (${isGlobal ? 'upfront' : 'vista'})`,
      fee: 0
    });

    // 2x a 6x
    for (let i = 2; i <= 6; i++) {
      const totalWithFee = Math.round(amount * (1 + feeConfig.installment2to6x / 100));
      const installmentAmount = Math.round(totalWithFee / i);
      options.push({
        value: i,
        label: `${i}x ${formatAmount(installmentAmount)}`,
        fee: feeConfig.installment2to6x
      });
    }

    // 7x a 9x
    for (let i = 7; i <= 9; i++) {
      const totalWithFee = Math.round(amount * (1 + feeConfig.installment7to9x / 100));
      const installmentAmount = Math.round(totalWithFee / i);
      options.push({
        value: i,
        label: `${i}x ${formatAmount(installmentAmount)}`,
        fee: feeConfig.installment7to9x
      });
    }

    // 10x a 12x
    for (let i = 10; i <= 12; i++) {
      const totalWithFee = Math.round(amount * (1 + feeConfig.installment10to12x / 100));
      const installmentAmount = Math.round(totalWithFee / i);
      options.push({
        value: i,
        label: `${i}x ${formatAmount(installmentAmount)}`,
        fee: feeConfig.installment10to12x
      });
    }

    setInstallmentOptions(options);
    setSelectedInstallments(1); // Padrão: vista
  };

  //  CARREGAR OPÇES DE PARCELAMENTO AO MONTAR COMPONENTE E QUANDO CONFIG CHEGA
  useEffect(() => {
    calculateInstallmentOptions();
  }, [amount, checkout.productType, acquirerConfig]);

  // CONFIGURAR PAYMENT REQUEST BUTTON (APPLE PAY / GOOGLE PAY)
  useEffect(() => {
    if (!stripe) {
      return;
    }

    const isGlobal = checkout.marketTarget === 'global';
    const currency = (checkout.globalSettings?.currency || 'USD').toLowerCase();
    const country = isGlobal ? 'US' : 'BR';

    const pr = stripe.paymentRequest({
      country: country,
      currency: currency,
      total: {
        label: checkout.title || 'Payment',
        amount: amount,
      },
      requestPayerName: true,
      requestPayerEmail: true,
      // HABILITAR EXPLICITAMENTE APPLE PAY E GOOGLE PAY
      disableWallets: [], // No desabilitar nenhuma wallet
    });

    // Verificar se Apple Pay ou Google Pay está disponível
    pr.canMakePayment().then((result) => {
      if (result) {
        console.log(' Wallet disponível:', result);
        setPaymentRequest(pr);
      } else {
        console.log(' Apple Pay/Google Pay não disponível neste dispositivo');
      }
    });

    pr.on('paymentmethod', async (e) => {
      console.log(' Payment method recebido via wallet:', e.paymentMethod);
      
      try {
        // Confirmar pagamento com o payment method do wallet
        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
          clientSecret,
          { payment_method: e.paymentMethod.id },
          { handleActions: false }
        );

        if (confirmError) {
          e.complete('fail');
          setError(confirmError.message || 'Payment failed');
        } else {
          e.complete('success');
          
          if (paymentIntent?.status === 'requires_action') {
            const { error } = await stripe.confirmCardPayment(clientSecret);
            if (error) {
              setError(error.message || 'Payment failed');
            } else {
              setPaymentStatus('succeeded');
              toast({
                title: getCheckoutText(checkout, { pt: "Pagamento Realizado!", en: "Payment Successful!", es: "Pago Exitoso!" }),
                description: getCheckoutText(checkout, { pt: "Seu pagamento foi processado.", en: "Your payment has been processed.", es: "Su pago ha sido procesado." }),
              });
            }
          } else {
            setPaymentStatus('succeeded');
            toast({
              title: getCheckoutText(checkout, { pt: "Pagamento Realizado!", en: "Payment Successful!", es: "Pago Exitoso!" }),
              description: getCheckoutText(checkout, { pt: "Seu pagamento foi processado.", en: "Your payment has been processed.", es: "Su pago ha sido procesado." }),
            });
          }
        }
      } catch (err) {
        e.complete('fail');
        setError('Payment processing failed');
      }
    });
  }, [stripe, amount, checkout.marketTarget, checkout.title, clientSecret]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    // 📊 RASTREAR CLIQUE NO BOTÃO DE COMPRA (DASHBOARD ANALYTICS)
    checkoutAnalyticsTracker.track('purchase_button_click', {
      method: 'card',
      acquirer: 'stripe',
      amount
    });

    pixelTracker.trackAddPaymentInfo(amount, checkout.globalSettings?.currency || checkout.currency || 'BRL', 'credit_card');

    setLoading(true);
    setError(null);
    setPaymentStatus("processing");

    try {
      console.log(' PROCESSANDO STRIPE - PRODUTO:', checkout.productType);
      console.log(' Tipo checkout:', checkout.productType);
      console.log('Valor:', amount);
      console.log(' Cliente:', customer.name);
      
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
      
      // Confirmar pagamento real com Stripe
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + (checkout.urls.success || '/success'),
          payment_method_data: {
            billing_details: {
              name: customer.name || 'Customer',
              email: customer.email || 'customer@example.com',
              phone: customer.phone || '+5511999999999', //  OBRIGATRIO quando fields.phone = 'never'
              //  REMOVIDO address hardcoded - Stripe detecta automaticamente via PaymentElement
              // PaymentElement jtem fields.billingDetails.address = 'never'
            }
          }
        },
        redirect: "if_required"
      });

      if (error) {
        throw new Error(error.message || "Erro no pagamento");
      }

      if (paymentIntent?.status === "succeeded") {
        setPaymentStatus("succeeded");
        toast({
          title: getCheckoutText(checkout, { pt: "Pagamento Realizado!", en: "Payment Successful!", es: "Pago Exitoso!" }),
          description: getCheckoutText(checkout, { pt: "Seu pagamento foi processado com sucesso.", en: "Your payment has been processed successfully.", es: "Su pago ha sido procesado con éxito." }),
        });

        // USAR HOOK CENTRALIZADO PARA SUCESSO DE PAGAMENTO
        // Dispara pixel de Purchase + Redireciona para URL de sucesso
        handlePaymentSuccess({
          orderId: paymentIntent.id,
          amount: amount, // Jé o valor real que inclui Order Bumps (em CENTS)
          currency: checkout.marketTarget === 'global' ? (checkout.globalSettings?.currency || 'USD') : 'BRL',
          productTitle: checkout.title,
          method: 'card',
          customerName: customer?.name,
          acquirer: 'stripe',
          checkoutSuccessUrl: checkout.urls.success
        });
      }

    } catch (err: any) {
      setPaymentStatus("failed");
      const errorMessage = err.message || getCheckoutText(checkout, { pt: "Ocorreu um erro inesperado.", en: "An unexpected error occurred.", es: "Ocurriun error inesperado." });
      setError(errorMessage);
      toast({
        title: getCheckoutText(checkout, { pt: "Pagamento Falhou", en: "Payment Failed", es: "Pago Fallido" }),
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (paymentStatus === "succeeded") {
    return (
      <Card className="border-blue-200 bg-blue-50" data-testid="stripe-success">
        <CardContent className="pt-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
            <Check className="h-8 w-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{getCheckoutText(checkout, { pt: 'Pagamento Bem-sucedido!', en: 'Payment Successful!', es: 'Pago Exitoso!' })}</h3>
          <p className="text-gray-600 mb-4">
            {getCheckoutText(checkout, { pt: 'Seu pagamento com cartão foi processado com sucesso.', en: 'Your card payment was processed successfully.', es: 'Su pago con tarjeta fue procesado con éxito.' })}
          </p>
          <Badge variant="secondary" className="bg-blue-100 text-green-800">
            {checkout.marketTarget === 'global' ? formatCurrency(amount, checkout.globalSettings?.currency || 'USD') : formatBRL(amount)}
          </Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="stripe-form">
      {/* EXPRESS CHECKOUT: APPLE PAY & GOOGLE PAY (SEMPRE VISVEL) */}
      {showExpressCheckout && (
        <div className="mb-4" data-testid="express-checkout-container">
          <ExpressCheckoutElement
            options={{
              paymentMethods: {
                applePay: 'always', // SEMPRE mostrar Apple Pay (se configurado no Stripe)
                googlePay: 'always', //  SEMPRE mostrar Google Pay (se configurado no Stripe)
              },
              buttonHeight: 48,
              buttonTheme: {
                applePay: 'black',
                googlePay: 'black',
              },
            }}
            onReady={(event) => {
              // Se no houver wallets disponíveis, esconder Express Checkout
              if (!event.availablePaymentMethods || Object.keys(event.availablePaymentMethods).length === 0) {
                console.log(' Nenhuma wallet disponível, ocultando Express Checkout');
                setShowExpressCheckout(false);
              } else {
                console.log(' Wallets disponíveis:', event.availablePaymentMethods);
              }
            }}
            onConfirm={async (event) => {
              // Express Checkout confirmado - processar pagamento
              console.log(' Pagamento Express Checkout confirmado:', event.expressPaymentType);
              setPaymentStatus('processing');
              
              //  Verificar se stripe e elements estão disponíveis
              if (!stripe || !elements) {
                setError('Payment system not initialized');
                setPaymentStatus('failed');
                return;
              }
              
              try {
                //  PASSO 1: Submit dos elementos (obrigatório para Express Checkout)
                const { error: submitError } = await elements.submit();
                if (submitError) {
                  setError(submitError.message || 'Form validation failed');
                  setPaymentStatus('failed');
                  return;
                }

                //  PASSO 2: Confirmar pagamento com Stripe
                const { error } = await stripe.confirmPayment({
                  elements,
                  confirmParams: {
                    return_url: window.location.origin + (checkout.urls.success || '/success'),
                  },
                  redirect: 'if_required',
                });

                if (error) {
                  //  Erro no pagamento
                  setError(error.message || 'Payment failed');
                  setPaymentStatus('failed');
                  toast({
                    title: "Payment Failed",
                    description: error.message,
                    variant: "destructive",
                  });
                } else {
                  //  Pagamento bem-sucedido
                  setPaymentStatus('succeeded');
                  toast({
                    title: getCheckoutText(checkout, { pt: "Pagamento Realizado!", en: "Payment Successful!", es: "Pago Exitoso!" }),
                    description: getCheckoutText(checkout, { pt: "Seu pagamento foi processado.", en: "Your payment has been processed.", es: "Su pago ha sido procesado." }),
                  });
                }
              } catch (err) {
                setError('Payment processing failed');
                setPaymentStatus('failed');
              }
            }}
          />
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                {getCheckoutText(checkout, { pt: 'Ou pague com cartão', en: 'Or pay with card', es: 'O paga con tarjeta' })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Payment Element: Cartões e outros métodos (sem wallets - estão no Express Checkout) */}
      <PaymentElement
        options={{
          fields: {
            billingDetails: {
              name: 'never',
              email: 'never', 
              phone: 'never',
              address: 'never' // FORÇA REMOÇÃO TOTAL DE ENDEREÇO E PAS
            }
          },
          wallets: {
            applePay: 'never', // Wallets aparecem no Express Checkout acima
            googlePay: 'never' //  Wallets aparecem no Express Checkout acima
          },
          layout: {
            type: 'accordion',
            defaultCollapsed: false,
            radios: false,
            spacedAccordionItems: true
          }
        }}
      />

      {/*  SELEÇÃO DE PARCELAS STRIPE */}
      {checkout.productType !== 'subscription' && (
        <div>
          <Label htmlFor="stripe-installments">{getCheckoutText(checkout, { pt: 'Parcelas', en: 'Installments', es: 'Cuotas' })}</Label>
          <Select value={selectedInstallments.toString()} onValueChange={(value) => setSelectedInstallments(parseInt(value))}>
            <SelectTrigger id="stripe-installments" data-testid="select-stripe-installments">
              <SelectValue placeholder={getCheckoutText(checkout, { pt: 'Escolha as parcelas', en: 'Choose installments', es: 'Elige las cuotas' })} />
            </SelectTrigger>
            <SelectContent>
              {installmentOptions.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/*  AVISO ASSINATURAS STRIPE */}
      {checkout.productType === 'subscription' && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm font-medium">{getCheckoutText(checkout, { pt: 'Assinatura - Pagamento nico', en: 'Subscription - Single Payment', es: 'Suscripcin - Pago nico' })}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {getCheckoutText(checkout, { pt: 'Assinaturas so cobradas mensalmente sem parcelamento.', en: 'Subscriptions are charged monthly without installments.', es: 'Las suscripciones se cobran mensualmente sin cuotas.' })}
          </p>
        </div>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50" data-testid="stripe-error">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Button
        type="submit"
        disabled={!stripe || loading || paymentStatus === "processing"}
        className="w-full"
        data-testid="button-pay"
      >
        {loading || paymentStatus === "processing" ? (
          checkout.marketTarget === 'global' ? "Processing..." : "Processando..."
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            {checkout.marketTarget === 'global' ? `Pay ${formatCurrency(amount, checkout.globalSettings?.currency || 'USD')}` : `Pagar ${formatBRL(amount)}`}
          </>
        )}
      </Button>
    </form>
  );
}

export function StripePayment({ checkout, customer, amount, onPaymentData, selectedOrderBumps = [], affiliateUid, addressData }: StripePaymentProps) {
  //  TODOS OS HOOKS NO TOPO - SEMPRE NA MESMA ORDEM, ANTES DE QUALQUER RETURN
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); //  COMEÇAR COM LOADING TRUE para evitar flicker
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const [stripePublicKey, setStripePublicKey] = useState<string | null>(null); //  FIX: Declarar varivel faltante
  const [error, setError] = useState<string | null>(null); //  ADICIONAR ESTADO DE ERRO
  const { toast } = useToast();

  //  USEEFFECT PARA INICIALIZAR STRIPE - OTIMIZADO PARA VELOCIDADE
  useEffect(() => {
    const initStripe = async () => {
      try {
        console.log(' INICIALIZANDO STRIPE para marketTarget:', checkout.marketTarget);
        
        //  FIX: Carregar chave pblica primeiro para debug correto
        if (checkout.marketTarget !== 'brasil') {
          //  CORRIGIDO: Usar mesma lgica da getStripePromise (environment + fallback)
          let publicKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.VITE_STRIPE_PUBLIC_KEY;
          console.log('Chave do environment:', publicKey ? 'ENCONTRADA' : 'NÃO ENCONTRADA');
          
          if (!publicKey) {
            console.log(' Buscando chave via API (fallback)...');
            publicKey = await getStripePublicKey(); // fallback para API
          }
          console.log(' CHAVE PBLICA STRIPE FINAL:', publicKey ? 'OK' : 'NULL');
          setStripePublicKey(publicKey);
        }
        
        console.log(' Chamando getStripePromise...');
        const promise = await getStripePromise(checkout.marketTarget, checkout.globalSettings?.language);
        console.log(' STRIPE PROMISE RESULTADO:', promise ? 'SUCESSO' : 'NULL');
        
        //  OTIMIZAÇÃO: No aguardar Stripe carregar - deixar assíncrono para velocidade
        setStripePromise(promise);
        setStripeReady(true); //  MARCAR PRONTO IMEDIATAMENTE para UI aparecerá
        
        //  Stripe vai terminar de carregar em background (verificar se resolve para null)
        if (promise) {
          promise.then((stripe: any) => {
            if (!stripe) {
              console.error(' Stripe resolveu para NULL - falha no carregamento');
              setError('Failed to load payment system. Please refresh and try again.');
              setStripePromise(null);
            } else {
              console.log(' Stripe carregado completamente em background!');
            }
          }).catch((error: any) => {
            console.error(' Erro no carregamento do Stripe:', error);
            setError('Payment system failed to initialize. Please refresh the page.');
            setStripePromise(null);
          });
        }
      } catch (error) {
        console.error(' Erro ao inicializar Stripe:', error);
        setStripeReady(true); // Para no ficar travado
      }
    };
    
    initStripe();
  }, [checkout.marketTarget]);

  //  INICIAR PAYMENT INTENT IMEDIATAMENTE NO MOUNT - SEM AGUARDAR STRIPE
  useEffect(() => {
    if (checkout.marketTarget === 'global' && !clientSecret) {
      console.log(' INICIANDO Payment Intent IMEDIATO no mount - SEM AGUARDAR STRIPE!');
      createPaymentIntent();
    }
  }, [checkout.marketTarget]); //  APENAS marketTarget como dependncia

  //  FUNÇÃO PARA CRIAR PAYMENT INTENT - OTIMIZADA
  const createPaymentIntent = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log(' STRIPE GLOBAL - Criando pagamento USD via Express...');

      // Fallback: extrair slug da URL caso checkout.slug esteja ausente (checkout legado)
      const urlPartsStripe = window.location.pathname.split('/');
      const checkoutIdxStripe = urlPartsStripe.findIndex(p => p === 'checkout' || p === 'c');
      const urlSlugStripe = checkoutIdxStripe >= 0 ? urlPartsStripe[checkoutIdxStripe + 1] : null;
      const resolvedCheckoutIdStripe = checkout.slug || urlSlugStripe || checkout.id;

      console.log('DADOS ENVIADOS:', {
        checkoutId: resolvedCheckoutIdStripe,
        method: 'card',
        customer: { email: customer.email, name: customer.name },
        amount: amount, // Desconto: USAR AMOUNT DAS PROPS (inclui oferta)
        marketTarget: checkout.marketTarget || 'global',
        productType: checkout.productType
      });
      
      // Usar Express server diretamente (sem tentar Functions)
      const response = await fetch(`${APP_CONFIG.getApiUrl('/api/payment/create-session')}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          checkoutId: resolvedCheckoutIdStripe,
          method: 'card',
          customer: {
            email: customer.email,
            name: customer.name
          },
          customerAddress: addressData || null,
          amount,
          currency: checkout.globalSettings?.currency || 'USD',
          marketTarget: checkout.marketTarget || 'global',
          productType: checkout.productType,
          processor: 'stripe',
          affiliateUid: affiliateUid || (typeof window !== 'undefined' ? 
            localStorage.getItem('affiliate_uid') : null),
          selectedOrderBumps: selectedOrderBumps
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(' STRIPE - HTTP Error:', response.status, errorText);
        
        //  TRATAMENTO ESPECFICO PARA STRIPE NÃO CONFIGURADO OU INVLIDO
        if (response.status === 503 || response.status === 500) {
          try {
            const errorData = JSON.parse(errorText);
            
            // Detectar chave Stripe inválida/corrompida
            if (errorData.message?.includes('Invalid API Key') || errorData.message?.includes('StripeAuthenticationError')) {
              const errorMsg = checkout.marketTarget === 'global'
                ? 'Stripe API keys are invalid or corrupted. Please reconfigure your Stripe keys in Admin Stripe Settings to accept international payments.'
                : 'Chaves da API Stripe estão inválidas ou corrompidas. Por favor, reconfigure suas chaves Stripe em Admin Configurações Stripe.';
              throw new Error(errorMsg);
            }
            
            if (errorData.configMissing) {
              // Mensagem clara para seller configurar Stripe
              const errorMsg = checkout.marketTarget === 'global' 
                ? 'Stripe is not configured. Configure your Stripe keys in Admin Stripe Settings to accept international payments with cards, Apple Pay and Google Pay.'
                : 'Sistema de pagamentos Stripe no configurado. Configure suas chaves Stripe em Admin Configurações Stripe para aceitar pagamentos internacionais.';
              throw new Error(errorMsg);
            }
          } catch (parseError) {
            // Se não conseguir parsear, usar erro genérico
          }
        }
        
        throw new Error(`Payment initialization failed (${response.status})`);
      }

      const responseText = await response.text();
      console.log(' STRIPE - Resposta recebida - status:', response.status, 'bytes:', responseText.length);

      let paymentData: CreatePaymentSessionResponse;
      try {
        paymentData = JSON.parse(responseText) as CreatePaymentSessionResponse;
      } catch (parseError) {
        console.error(' STRIPE - JSON parse error - status:', response.status, 'content-type:', response.headers.get('content-type'));
        throw new Error('Invalid server response - please refresh and try again');
      }
      
      if (!paymentData || !paymentData.clientSecret) {
        console.error(' STRIPE - Missing client secret:', paymentData);
        throw new Error('Payment initialization failed - please refresh and try again');
      }
      
      console.log(' STRIPE GLOBAL - Payment Intent criado com sucesso!');
      setClientSecret(paymentData.clientSecret);
      onPaymentData(paymentData);

    } catch (error: any) {
      console.error(' STRIPE GLOBAL - Erro completo:', error);
      
      // Mostrar erro mais amigvel para o usuário
      const userMessage = error.message?.includes('fetch') 
        ? 'Network error - please check your connection and try again'
        : error.message || 'Failed to initialize payment - please refresh and try again';
      
      setError(userMessage);
      toast({
        title: "Payment Error",
        description: userMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  //  USEEFFECT REMOVIDO - DUPLICAVA COM O AUTO-CRIAR PAYMENT INTENT ABAIXO

  //  CHECKOUTS BRASILEIROS NÃO DEVEM USAR STRIPE - BANNER REMOVIDO PARA EVITAR DUPLICAÇÃO

  //  ORDEM CRTICA: loading erro unavailable skeleton form

  // 1LOADING STATE - PRIORIDADE MXIMA
  if (loading) {
    return (
      <div className="text-center py-8" data-testid="stripe-loading">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted-foreground">Initializing payment...</p>
      </div>
    );
  }

  // 2ERRO EXPLCITO - SEGUNDA PRIORIDADE
  if (error && !loading) {
    //  TRATAMENTO ESPECIAL PARA STRIPE NÃO CONFIGURADO
    const isConfigError = error.includes('not configured') || error.includes('no configurado');
    
    if (isConfigError) {
      return (
        <Card className="border-yellow-200 bg-yellow-50" data-testid="stripe-config-error">
          <CardContent className="pt-6">
            <div className="text-center mb-4">
              <div className="w-16 h-16 mx-auto mb-4 bg-yellow-100 rounded-full flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-yellow-600" />
              </div>
              <h3 className="text-lg font-semibold text-yellow-800 mb-2">
                {getCheckoutText(checkout, { pt: 'Stripe No Configurado', en: 'Stripe Not Configured', es: 'Stripe No Configurado' })}
              </h3>
              <p className="text-yellow-700 text-sm mb-4">
                {error}
              </p>
              <div className="flex gap-2 justify-center">
                <Button 
                  onClick={() => window.location.href = '/admin/stripe-settings'}
                  className="bg-yellow-600 hover:bg-yellow-700"
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  {getCheckoutText(checkout, { pt: 'Configurar Stripe', en: 'Configure Stripe', es: 'Configurar Stripe' })}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }
    
    // Erro genérico
    return (
      <div className="p-4 border border-red-200 bg-red-50 rounded-lg" data-testid="stripe-error">
        <div className="flex items-center mb-3">
          <div className="text-red-500 mr-2"></div>
          <h3 className="font-semibold text-red-700">Payment Error</h3>
        </div>
        <p className="text-red-600 mb-4 text-sm">{error}</p>
        <div className="flex gap-2">
          <button 
            onClick={() => { setError(null); createPaymentIntent(); }}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
          >
            Try Again
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // 3STRIPE UNAVAILABLE - TERCEIRA PRIORIDADE (apenas quando definitivamente sem chave)
  if (!stripePromise && !loading && !error) {
    console.error(' STRIPE PROMISE NULL - SISTEMA INDISPONVEL:', {
      marketTarget: checkout.marketTarget,
      stripeReady,
      stripePublicKey: stripePublicKey ? 'EXISTE' : 'VAZIA'
    });
    
    return (
      <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
        <h3 className="text-yellow-800 font-semibold mb-2">Payment Unavailable</h3>
        <p className="text-yellow-700 text-sm mb-3">
          International payment system is temporarily unavailable. 
        </p>
        <Button 
          onClick={() => window.location.reload()} 
          className="bg-yellow-600 hover:bg-yellow-700"
          size="sm"
        >
          Refresh Page
        </Button>
      </div>
    );
  }


  //  CONFIGURAÇÃO STRIPE ELEMENTS - USAR IDIOMA DO CHECKOUT (SEM AUTO-DETECÇÃO)
  const stripeLocale = getStripeLocaleFromCheckout(checkout.marketTarget, checkout.globalSettings?.language);

  const options = clientSecret ? {
    clientSecret,
    locale: stripeLocale as any,
    appearance: {
      theme: 'stripe' as const,
      variables: {
        colorPrimary: checkout.theme.primary,
      },
    },
  } : undefined;


  //  SKELETON APENAS QUANDO PENDENTE (sem erro)
  if (!clientSecret || !stripeReady) {
    return (
      <div className="space-y-4 p-4" data-testid="stripe-skeleton">
        {/* Skeleton que imita o layout do formulrio real */}
        <div className="text-center mb-4">
          <div className="h-6 bg-gray-200 rounded animate-pulse mb-2 mx-auto w-32"></div>
          <div className="h-4 bg-gray-100 rounded animate-pulse mx-auto w-64"></div>
        </div>
        
        {/* Skeleton dos campos de cartão */}
        <div className="border rounded-lg p-4 bg-gray-50">
          <div className="h-12 bg-gray-200 rounded animate-pulse mb-4"></div>
          <div className="h-10 bg-gray-200 rounded animate-pulse mb-4"></div>
        </div>
        
        {/* Skeleton do botão */}
        <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
        
        <p className="text-center text-sm text-muted-foreground">
          {!clientSecret ? 'Preparing payment...' : 'Almost ready...'}
        </p>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutForm
        checkout={checkout}
        customer={customer}
        amount={amount}
        onPaymentData={onPaymentData}
        clientSecret={clientSecret!}
        addressData={addressData}
      />
    </Elements>
  );
}
