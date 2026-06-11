import React, { useState, useEffect, useRef } from 'react';
import { AdyenCheckout } from '@adyen/adyen-web';
import '@adyen/adyen-web/styles/adyen.css';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePaymentSuccess } from '@/hooks/use-payment-success';
import { pixelTracker } from '@/lib/pixel-tracking';

interface AdyenPaymentProps {
  checkoutId: string;
  amount: number; // em centavos
  currency: string;
  customerData: {
    name: string;
    email: string;
    phone?: string;
  };
  productTitle: string;
  affiliateUid?: string | null; // CÓDIGO DE AFILIADO capturado da URL (?aff=CODIGO)
  onSuccess?: (paymentData: any) => void;
  onError?: (error: any) => void;
  onProcessing?: (isProcessing: boolean) => void;
}

export default function AdyenPayment({ 
  checkoutId, 
  amount, 
  currency,
  customerData, 
  productTitle,
  affiliateUid,
  onSuccess,
  onError,
  onProcessing
}: AdyenPaymentProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [adyenConfig, setAdyenConfig] = useState<any>(null);
  const checkoutRef = useRef<any | null>(null);
  const componentRef = useRef<HTMLDivElement>(null);
  const { handlePaymentSuccess } = usePaymentSuccess();

  //  CARREGAR CONFIGURAÇES ADYEN
  useEffect(() => {
    const loadAdyenConfig = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        console.log(' Carregando configurações Adyen...');
        
        const response = await fetch('/api/adyen/client-key');
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Erro ao carregar configurações Adyen');
        }
        
        if (!data.success) {
          throw new Error(data.error || 'Adyen no configurado');
        }
        
        console.log(' Configurações Adyen carregadas:', {
          environment: data.environment,
          merchantAccount: data.merchantAccount,
          hasClientKey: !!data.clientKey
        });
        
        setAdyenConfig({
          environment: data.environment,
          clientKey: data.clientKey,
          merchantAccount: data.merchantAccount
        });
        
      } catch (error: any) {
        console.error(' Erro ao carregar configurações Adyen:', error);
        setError(`Erro na configuração: ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAdyenConfig();
  }, []);

  // INICIALIZAR ADYEN CHECKOUT
  useEffect(() => {
    if (!adyenConfig || !componentRef.current) return;
    
    const initializeAdyen = async () => {
      try {
        console.log('Inicializando Adyen Checkout...');
        
        // Criar sesso de pagamento
        // Obter token de autenticação (componente pode ser usado sem autenticação)
        let token = '';
        try {
          const { auth } = await import('@/lib/firebase');
          const user = auth.currentUser;
          if (user) {
            token = await user.getIdToken();
          }
        } catch (error) {
          console.log('No foi possvel obter token de autenticação');
        }
        
        const sessionResponse = await fetch('/api/adyen/create-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            checkoutId,
            amount,
            currency: currency.toLowerCase(),
            customerData,
            productTitle,
            // SISTEMA DE AFILIADOS: Priorizar prop, fallback para localStorage
            affiliateUid: affiliateUid || (typeof window !== 'undefined' ? 
              localStorage.getItem('affiliate_uid') : null)
          })
        });
        
        if (!sessionResponse.ok) {
          throw new Error('Erro ao criar sesso de pagamento');
        }
        
        const sessionData = await sessionResponse.json();
        
        pixelTracker.trackAddPaymentInfo(amount, currency, 'credit_card');

        // @ts-ignore
        const checkout = await AdyenCheckout({
          environment: adyenConfig.environment,
          clientKey: adyenConfig.clientKey,
          session: {
            id: sessionData.sessionId,
            sessionData: sessionData.sessionData
          },
          onPaymentCompleted: (result: any) => {
            console.log(' Pagamento concluído:', result);
            setIsProcessing(false);
            onProcessing?.(false);
            
            if (result.resultCode === 'Authorised') {
              // USAR HOOK CENTRALIZADO PARA SUCESSO DE PAGAMENTO
              // Dispara pixel de Purchase + Redireciona para URL de sucesso
              handlePaymentSuccess({
                orderId: result.merchantReference,
                amount: amount, // Em CENTS
                currency: currency,
                productTitle: productTitle,
                method: 'card',
                customerName: customerData.name,
                acquirer: 'adyen',
                checkoutSuccessUrl: undefined // Adyen não tem success URL customizada aqui
              });
            } else {
              setError('Pagamento no autorizado. Tente novamente.');
            }
          },
          onError: (error: any) => {
            console.error(' Erro no pagamento Adyen:', error);
            setIsProcessing(false);
            onProcessing?.(false);
            setError(`Erro no pagamento: ${error.message || 'Erro desconhecido'}`);
            onError?.(error);
          },
          locale: 'pt-BR'
        });
        
        checkoutRef.current = checkout;
        
        // Montar componente de cartão
        if (checkout && (checkout as any).create) {
          const cardComponent = (checkout as any).create('card', {
            hasHolderName: true,
            holderNameRequired: true,
            showPayButton: true,
          });
          if (cardComponent && componentRef.current) {
            cardComponent.mount(componentRef.current);
          }
        } else {
          console.log(' Usando fallback para Adyen SDK mais antigo');
        }
        
        console.log('Adyen Checkout inicializado com sucesso');
        
      } catch (error: any) {
        console.error(' Erro ao inicializar Adyen:', error);
        setError(`Erro na inicializao: ${error.message}`);
      }
    };
    
    initializeAdyen();
    
    // Cleanup
    return () => {
      if (checkoutRef.current) {
        // Limpar componente Adyen
        checkoutRef.current = null;
      }
    };
  }, [adyenConfig, checkoutId, amount, currency, customerData, productTitle]);

  if (isLoading) {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center p-8 text-center"
      >
        <div className="space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
          <p className="text-gray-600">Carregando processador de pagamento...</p>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-4"
      >
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
      data-testid="adyen-payment-container"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg">
          <CreditCard className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Cartão de Crédito</h3>
          <p className="text-sm text-gray-600">Processamento seguro via Adyen</p>
        </div>
      </div>

      {/* Resumo do pagamento */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Produto:</span>
          <span className="font-medium text-gray-900 text-right max-w-[200px] truncate">{productTitle}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Cliente:</span>
          <span className="font-medium text-gray-900">{customerData.name}</span>
        </div>
        <div className="flex justify-between text-lg font-bold border-t pt-2">
          <span>Total:</span>
          <span className="text-gray-900">
            {new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: currency
            }).format(amount / 100)}
          </span>
        </div>
      </div>

      {/* Container do Adyen */}
      <div className="space-y-4">
        <div 
          ref={componentRef} 
          className="min-h-[300px]"
          data-testid="adyen-card-component"
        />
        
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-2 p-4 bg-blue-50 rounded-lg"
          >
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-blue-700 font-medium">Processando pagamento...</span>
          </motion.div>
        )}
      </div>

      {/* Segurana */}
      <div className="text-xs text-gray-500 text-center space-y-1">
        <p> Pagamento processado com segurana pela Adyen</p>
        <p>Seus dados estão protegidos com criptografia de ponta a ponta</p>
      </div>
    </motion.div>
  );
}