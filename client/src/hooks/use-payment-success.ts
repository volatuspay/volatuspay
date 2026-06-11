import { useCallback, useRef } from 'react';
import { pixelTracker } from '@/lib/pixel-tracking';

interface PaymentSuccessData {
  orderId: string;
  amount: number; // SEMPRE EM CENTS (padrão do backend)
  currency: string;
  productTitle: string;
  method: string;
  customerName?: string;
  acquirer?: string;
  checkoutSuccessUrl?: string;
}

/**
 * HOOK CENTRALIZADO PARA SUCESSO DE PAGAMENTO
 * 
 * Responsabilidades:
 * 1. Disparar pixel de Purchase (COM DEDUPLICAÇÃO)
 * 2. Redirecionar para página de sucesso
 * 
 * USO: Todos os componentes de pagamento (PIX, Stripe, EfiBank, Adyen)
 * devem chamar este hook ao invés de fazer redirect direto.
 */
export function usePaymentSuccess() {
  // DEDUPLICAÇÃO: Rastrear transações jprocessadas
  const processedTransactions = useRef<Set<string>>(new Set());

  const handlePaymentSuccess = useCallback((data: PaymentSuccessData) => {
    const {
      orderId,
      amount,
      currency,
      productTitle,
      method,
      customerName,
      acquirer,
      checkoutSuccessUrl
    } = data;

    console.log('PROCESSANDO SUCESSO DE PAGAMENTO:', {
      orderId,
      amount,
      currency,
      method,
      acquirer
    });

    if (processedTransactions.current.has(orderId)) {
      console.log('TRANSAÇÃO JA PROCESSADA - Pulando pixel tracking:', orderId);
      redirectToSuccess(data);
      return;
    }

    processedTransactions.current.add(orderId);

    try {
      console.log('[PURCHASE PIXEL] Disparando Purchase pixel:', {
        value: amount,
        currency,
        transactionId: orderId,
        productName: productTitle
      });

      pixelTracker.trackPurchase({
        value: amount,
        currency,
        transactionId: orderId,
        productName: productTitle,
        productId: orderId
      });

      console.log('[PURCHASE PIXEL] Purchase pixel disparado com sucesso!');
    } catch (error) {
      console.error('[PURCHASE PIXEL] Erro ao disparar pixel:', error);
    }

    console.log('[PURCHASE PIXEL] Aguardando 1.5s para pixel SDKs enviarem beacon antes do redirect...');
    setTimeout(() => {
      redirectToSuccess(data);
    }, 1500);
  }, []);

  const redirectToSuccess = async (data: PaymentSuccessData) => {
    const {
      orderId,
      amount,
      currency,
      productTitle,
      method,
      customerName,
      acquirer,
      checkoutSuccessUrl
    } = data;

    // VERIFICAR SE EXISTEM ESTRATÉGIAS DE UPSELL/DOWNSELL ATIVAS
    try {
      // Extrair checkoutId do orderId ou usar outro identificador disponível
      // Assumindo que temos acesso ao checkoutId através do contexto ou URL
      const urlParams = new URLSearchParams(window.location.search);
      const checkoutId = urlParams.get('checkoutId') || localStorage.getItem('lastCheckoutId');

      if (checkoutId) {
        console.log('🔍 Verificando estratégias de upsell/downsell para checkout:', checkoutId);
        
        const strategiesRes = await fetch(`/api/checkouts/${checkoutId}/strategies`);
        if (strategiesRes.ok) {
          const strategiesData = await strategiesRes.json();
          
          // Se tem estratégias ativas E sistema está habilitado, redirecionar para oferta
          if (strategiesData.enabled && strategiesData.strategies?.length > 0) {
            console.log('✅ Estratégias encontradas! Redirecionando para oferta...');
            
            setTimeout(() => {
              window.location.href = `/offer?checkoutId=${checkoutId}&strategyIndex=0`;
            }, 300);
            return;
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ Erro ao verificar estratégias (continuando fluxo normal):', error);
      // Continuar com fluxo normal em caso de erro
    }

    // FLUXO NORMAL: SEM ESTRATÉGIAS OU ERRO

    // CONVERTER AMOUNT DE CENTS PARA MAJOR UNITS (LEGVEL)
    // Ex: 5000 cents => "50.00" BRL
    const amountMajor = (amount / 100).toFixed(2);
    
    // CONSTRUIR URL DE SUCESSO COM PARMETROS
    const successParams = new URLSearchParams({
      orderId,
      amount: amountMajor, // MAJOR UNITS para URL legvel
      currency,
      productTitle,
      paymentMethod: method,
      ...(acquirer && { acquirer }),
      ...(customerName && { customerName })
    });

    let finalUrl: string;

    // PRIORIDADE: URL customizada do checkout > URL padrão
    if (checkoutSuccessUrl) {
      console.log('Usando URL customizada de sucesso:', checkoutSuccessUrl);
      
      try {
        // Se URL customizada já tem protocolo, usar como está
        if (checkoutSuccessUrl.startsWith('http')) {
          const url = new URL(checkoutSuccessUrl);
          // Adicionar parâmetros à URL customizada
          successParams.forEach((value, key) => {
            url.searchParams.set(key, value);
          });
          finalUrl = url.toString();
        } 
        // URL relativa - mesclar com base atual
        else {
          const baseUrl = new URL(checkoutSuccessUrl, window.location.href);
          successParams.forEach((value, key) => {
            baseUrl.searchParams.set(key, value);
          });
          finalUrl = baseUrl.toString();
        }
      } catch (error) {
        console.error('Erro ao processar URL customizada, usando fallback:', error);
        finalUrl = `/success?${successParams.toString()}`;
      }
    } else {
      // FALLBACK: Página padrão de sucesso
      finalUrl = `/success?${successParams.toString()}`;
    }

    console.log('Redirecionando para:', finalUrl);

    // PEQUENO DELAY PARA GARANTIR QUE PIXEL FOI DISPARADO
    setTimeout(() => {
      window.location.href = finalUrl;
    }, 300);
  };

  return { handlePaymentSuccess };
}
