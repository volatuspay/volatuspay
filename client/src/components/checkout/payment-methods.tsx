import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PixPayment } from "./pix-payment";
import { BoletoPayment } from "./boleto-payment";
import { StripePayment } from "./stripe-payment";
import AdyenPayment from "./adyen-payment";
import { EfiBankCardPayment } from "./efibank-card-payment";
import { usePaymentConfig } from "@/hooks/use-seller-acquirers";
import type { Customer, Checkout } from "@shared/schema";
import { CreditCard, Shield, Lock, FileText, Building, MapPin, Loader2 } from "lucide-react";
import { PixIcon } from "@/components/ui/pix-icon";

interface PaymentMethodsProps {
  checkout: Checkout;
  customerData: Customer;
  addressData?: {
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  onPaymentData?: (data: any) => void;
  setCurrentStep?: (step: number) => void;
  showMethodSelector?: boolean; // Controla se mostra os botes de seleo de método
  amount?: number; // Desconto: OPCIONAL: Preo total calculado (com oferta) - se no passar, usa checkout.pricing.amount
  forcedMethod?: 'pix' | 'card' | 'boleto'; // Fora qual método de pagamento usar (vem do CheckoutWhiteV1)
  selectedOrderBumps?: Array<{ checkoutId: string; price: number }>; //  ORDER BUMP: Produtos adicionais selecionados
  affiliateUid?: string | null; // CÓDIGO DE AFILIADO capturado da URL (?aff=CODIGO)
  couponCode?: string; // CUPOM DE DESCONTO aplicado
  offerSlug?: string; // Slug da oferta selecionada (para validação de preço no servidor)
  onPixActionReady?: (createPixFn: () => Promise<void>, isLoading: boolean) => void; // Callback para expor função de criar Pix ao CheckoutWhiteV1
  hidePixInitialButton?: boolean; // Esconder botão inicial do Pix quando for renderizado no resumo
}

export function PaymentMethods({ checkout, customerData, addressData: addressDataProp, onPaymentData, setCurrentStep, showMethodSelector = true, amount, forcedMethod, selectedOrderBumps = [], affiliateUid, couponCode, offerSlug, onPixActionReady, hidePixInitialButton = false }: PaymentMethodsProps) {
  const addressData = addressDataProp || (customerData as any)?.address || undefined;
  // Desconto: PREÇO FINAL: Usar amount se disponível, senão usar preo base do checkout
  const finalAmount = amount ?? checkout.pricing?.amount ?? 0;
  //  USAR CONFIGURAÇES BASEADAS NO SELLER
  const paymentConfig = usePaymentConfig(checkout);
  
  // Desconto: FUNÇÃO DE CALLBACK UNIFICADA - Chama onPaymentData E avana wizard
  const handlePaymentSuccess = (data: any) => {
    console.log('Desconto: PaymentMethods: Pagamento bem-sucedido:', data);
    
    // Avanar wizard se funo fornecida
    if (setCurrentStep) {
      console.log(' PaymentMethods: Avanando para step 3');
      setCurrentStep(3);
    }
    
    // Chamar callback do componente pai se fornecido
    if (onPaymentData) {
      onPaymentData(data);
    }
  };
  
  // Desconto: ESTADOS - SEMPRE DEFINIR ANTES DE QUALQUER RETURN CONDICIONAL
  const [selectedMethod, setSelectedMethod] = useState<'pix' | 'card' | 'boleto'>(forcedMethod || 'card');
  
  // Se forcedMethod foi passado, usar ele
  useEffect(() => {
    if (forcedMethod) {
      setSelectedMethod(forcedMethod);
    }
  }, [forcedMethod]);
  const [cardData, setCardData] = useState({
    number: '',
    expiry: '',
    cvc: '',
    name: '',
    country: 'Brasil'
  });
  
  // Determinar métodos de pagamento disponíveis baseado nas configurações do seller, mercado E OFERTA
  // REGRA: Seller define piso (o que processa), oferta pode apenas RESTRINGIR (não expandir)
  const availableMethods: ('pix' | 'card' | 'boleto')[] = [];
  
  // 💳 OBTER CONFIGURAÇÃO DA OFERTA (se existir)
  const offerPaymentMethods = (checkout as any).paymentMethods;
  
  // ============================================
  // 🟢 PIX
  // ============================================
  // Seller precisa ter PIX habilitado para aparecer
  const pixSellerEnabled = paymentConfig.pixEnabled === true;
  // Oferta pode desabilitar explicitamente (false), mas undefined herda seller
  const pixOfferDisabled = offerPaymentMethods?.pix === false;
  if (pixSellerEnabled && !pixOfferDisabled) {
    availableMethods.push('pix');
  }
  
  // ============================================
  // 💳 CARTÃO
  // ============================================
  if (checkout.marketTarget === 'brasil') {
    const cardSellerEnabled = paymentConfig.brazilianCardEnabled === true;
    // Oferta pode desabilitar via cardBr=false ou card=false
    const cardOfferDisabled = offerPaymentMethods?.cardBr === false || 
      (offerPaymentMethods?.cardBr === undefined && offerPaymentMethods?.card === false);
    if (cardSellerEnabled && !cardOfferDisabled) {
      availableMethods.push('card');
    }
  } else if (checkout.marketTarget === 'global') {
    const cardSellerEnabled = paymentConfig.globalCardEnabled === true;
    const cardOfferDisabled = offerPaymentMethods?.cardGlobal === false || 
      (offerPaymentMethods?.cardGlobal === undefined && offerPaymentMethods?.card === false);
    if (cardSellerEnabled && !cardOfferDisabled) {
      availableMethods.push('card');
    }
  }
  
  // ============================================
  // 📄 BOLETO - Apenas para Brasil
  // ============================================
  // Verificar se seller/checkout tem boleto habilitado
  const boletoFromCheckout = checkout.methods?.boleto;
  const boletoSellerEnabled = boletoFromCheckout === true || 
    (typeof boletoFromCheckout === 'object' && (boletoFromCheckout as any)?.enabled === true);
  // Oferta pode desabilitar explicitamente
  const boletoOfferDisabled = offerPaymentMethods?.boleto === false;
  if (checkout.marketTarget === 'brasil' && boletoSellerEnabled && !boletoOfferDisabled) {
    availableMethods.push('boleto');
  }
  
  // Definir método padrão baseado nos métodos disponíveis e mercado
  const defaultMethod = checkout.marketTarget === 'global' 
    ? 'card'  // Checkout global sempre usa cartão
    : availableMethods.includes('pix') ? 'pix' : availableMethods[0];
    
  //  SINCRONIZAR selectedMethod com availableMethods quando carregam
  useEffect(() => {
    if (!paymentConfig.isLoading && availableMethods.length > 0) {
      const newDefaultMethod = defaultMethod || availableMethods[0];
      if (newDefaultMethod && !availableMethods.includes(selectedMethod)) {
        setSelectedMethod(newDefaultMethod);
      }
    }
  }, [paymentConfig.isLoading, availableMethods.length, defaultMethod]);
    
  // Loading state enquanto busca configurações do seller
  if (paymentConfig.isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-900" />
        <span className="ml-2 text-gray-600">Carregando métodos de pagamento...</span>
      </div>
    );
  }

  const isPhysicalProduct = false;
  
  // Verificar se o método selecionado ainda está disponível
  const currentMethod = availableMethods.includes(selectedMethod) ? selectedMethod : defaultMethod;

  return (
    <>
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Seleo do método de pagamento baseado nas configurações do checkout */}
      {availableMethods.length > 1 && showMethodSelector ? (
        <div className={`grid gap-3 ${availableMethods.length === 3 ? 'grid-cols-3' : availableMethods.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {availableMethods.includes('card') && (
            <Button
              variant={selectedMethod === 'card' ? 'default' : 'outline'}
              className={`h-16 flex items-center justify-center gap-3 text-base font-medium ${
                selectedMethod === 'card' 
                  ? 'bg-gray-900 hover:bg-gray-900 text-white' 
                  : 'border-gray-300 hover:border-gray-900'
              }`}
              onClick={() => setSelectedMethod('card')}
              data-testid="button-payment-card"
            >
              <CreditCard className="h-5 w-5" />
              Cartão
            </Button>
          )}
          
          {availableMethods.includes('pix') && (
            <Button
              variant={selectedMethod === 'pix' ? 'default' : 'outline'}
              className={`h-16 flex items-center justify-center gap-3 text-base font-medium ${
                selectedMethod === 'pix' 
                  ? 'bg-white hover:bg-gray-50 text-gray-900 border-2 border-[#00A79D]' 
                  : 'border-gray-300 hover:border-[#00A79D]'
              }`}
              onClick={() => setSelectedMethod('pix')}
              data-testid="button-payment-pix"
            >
              <PixIcon className="h-6 w-6" />
              PIX
            </Button>
          )}
          
          {availableMethods.includes('boleto') && (
            <Button
              variant={selectedMethod === 'boleto' ? 'default' : 'outline'}
              className={`h-16 flex items-center justify-center gap-3 text-base font-medium ${
                selectedMethod === 'boleto' 
                  ? 'bg-gray-900 hover:bg-gray-900 text-white' 
                  : 'border-gray-300 hover:border-gray-900'
              }`}
              onClick={() => setSelectedMethod('boleto')}
              data-testid="button-payment-boleto"
            >
              <FileText className="h-5 w-5" />
              Boleto
            </Button>
          )}
        </div>
      ) : availableMethods.length === 1 && showMethodSelector ? (
        /* Apenas um método disponível - mostrar como selecionado */
        <div className="w-full">
          {availableMethods[0] === 'card' ? (
            <Button
              variant="default"
              className="w-full h-16 flex items-center justify-center gap-3 text-base font-medium bg-gray-900 hover:bg-gray-900 text-white"
              disabled
              data-testid="button-payment-card-only"
            >
              <CreditCard className="h-5 w-5" />
              Cartão de Crédito/Débito
            </Button>
          ) : availableMethods[0] === 'pix' ? (
            <Button
              variant="default"
              className="w-full h-16 flex items-center justify-center gap-3 text-base font-medium bg-white hover:bg-gray-50 text-gray-900 border-2 border-[#00A79D]"
              disabled
              data-testid="button-payment-pix-only"
            >
              <PixIcon className="h-6 w-6" />
              PIX
            </Button>
          ) : (
            <Button
              variant="default"
              className="w-full h-16 flex items-center justify-center gap-3 text-base font-medium bg-gray-900 hover:bg-gray-900 text-white"
              disabled
              data-testid="button-payment-boleto-only"
            >
              <FileText className="h-5 w-5" />
              Boleto Bancário
            </Button>
          )}
        </div>
      ) : null}

      {/* Formulrio de cartão - Processamento direto sem duplicação */}
      {selectedMethod === 'card' && (
        <div className="bg-white rounded-lg p-6">


            {/*  PROCESSAMENTO INTELIGENTE POR REGIÃO */}
            {((checkout.marketTarget === 'brasil' && paymentConfig.brazilianCardEnabled) || 
              (checkout.marketTarget === 'global' && paymentConfig.globalCardEnabled)) ? (
              //  BRASIL: EfBank ou Stripe
              checkout.marketTarget === 'brasil' && paymentConfig.brazilianCardEnabled ? (
                paymentConfig.brazilianCardAcquirer === 'efibank' ? (
                  <EfiBankCardPayment
                    checkout={checkout}
                    customer={customerData}
                    amount={finalAmount}
                    addressData={addressData}
                    affiliateUid={affiliateUid}
                    couponCode={couponCode}
                    offerSlug={offerSlug}
                    onPaymentData={handlePaymentSuccess}
                    selectedOrderBumps={selectedOrderBumps.map(b => b.checkoutId)}
                  />
                ) : (
                  <StripePayment
                    checkout={checkout}
                    customer={customerData}
                    amount={finalAmount}
                    addressData={addressData}
                    affiliateUid={affiliateUid}
                    onPaymentData={handlePaymentSuccess}
                    selectedOrderBumps={selectedOrderBumps.map(b => b.checkoutId)}
                  />
                )
              ) : (
                //  GLOBAL: Adyen ou Stripe
                paymentConfig.globalCardAcquirer === 'adyen' && paymentConfig.globalCardEnabled ? (
                  <AdyenPayment
                    checkoutId={checkout.id}
                    amount={finalAmount}
                    currency={checkout.globalSettings?.currency || 'USD'}
                    customerData={customerData}
                    productTitle={checkout.title}
                    affiliateUid={affiliateUid}
                    onSuccess={handlePaymentSuccess}
                  />
                ) : (
                  <StripePayment
                    checkout={checkout}
                    customer={customerData}
                    amount={finalAmount}
                    addressData={addressData}
                    affiliateUid={affiliateUid}
                    onPaymentData={handlePaymentSuccess}
                    selectedOrderBumps={selectedOrderBumps.map(b => b.checkoutId)}
                  />
                )
              )
            ) : null}

            {/* Texto de segurana removido para evitar duplicação no layout */}
        </div>
      )}

      {/* PIX Payment - Apenas para checkout Brasil */}
      {selectedMethod === 'pix' && checkout.marketTarget === 'brasil' && (
        <PixPayment
          checkout={checkout}
          customer={customerData}
          amount={finalAmount}
          addressData={addressData}
          affiliateUid={affiliateUid}
          couponCode={couponCode}
          offerSlug={offerSlug}
          onPaymentData={handlePaymentSuccess}
          selectedOrderBumps={selectedOrderBumps.map(b => b.checkoutId)}
          onPixActionReady={onPixActionReady}
          hideInitialButton={hidePixInitialButton}
        />
      )}

      {/* BOLETO Payment - Apenas para checkout Brasil */}
      {selectedMethod === 'boleto' && checkout.marketTarget === 'brasil' && (
        <BoletoPayment
          checkout={checkout}
          customer={customerData}
          amount={finalAmount}
          addressData={addressData}
          affiliateUid={affiliateUid}
          offerSlug={offerSlug}
          couponCode={couponCode}
          selectedOrderBumps={selectedOrderBumps.map(b => b.checkoutId)}
          onPaymentData={handlePaymentSuccess}
        />
      )}

      </div>
    </>
  );
}