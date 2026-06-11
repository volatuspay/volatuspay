import { useQuery } from "@tanstack/react-query";

// CONFIGURAÇES DE ADQUIRENTES POR SELLER
interface SellerAcquirers {
  pix?: {
    enabled: boolean;
    acquirer: 'efibank';
  };
  brazilianCard?: {
    enabled: boolean;
    acquirer: 'efibank';
  };
  globalCard?: {
    enabled: boolean;
    acquirer: 'stripe' | 'adyen';
  };
}

// Hook para buscar configurações de adquirentes do seller
export function useSellerAcquirers(sellerId: string | undefined) {
  return useQuery({
    queryKey: ['seller-acquirers', sellerId],
    queryFn: async (): Promise<SellerAcquirers | null> => {
      if (!sellerId) return null;
      
      const response = await fetch(`/api/checkout-acquirers-by-seller/${sellerId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          // Seller não tem configurações específicas - usar padrão
          return null;
        }
        throw new Error('Erro ao buscar configurações do adquirente');
      }
      
      const data = await response.json();
      return data.acquirers || null;
    },
    enabled: !!sellerId,
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
    retry: 1
  });
}

// Hook para determinar configurações de pagamento baseado no seller
export function usePaymentConfig(checkout: any) {
  const { data: sellerAcquirers, isLoading } = useSellerAcquirers(checkout?.tenantId);
  
  // FALLBACK INTELIGENTE PARA CHECKOUTS ANTIGOS (marketTarget=null, methods=null)
  // Se o checkout tem globalSettings OU currency diferente de BRL, é GLOBAL
  const isGlobal = checkout?.globalSettings || (checkout?.currency && checkout.currency !== 'BRL');
  const marketTarget = checkout?.marketTarget || (isGlobal ? 'global' : 'brasil'); // Smart fallback
  const methods = checkout?.methods || { pix: !isGlobal, card: true }; // Default: PIX apenas Brasil, Cartão sempre

  // Helper para verificar se método esthabilitado (suporta boolean E {enabled: boolean})
  const isMethodEnabled = (method: any) => {
    if (typeof method === 'boolean') return method;
    if (typeof method === 'object' && method !== null) return method.enabled === true;
    return false;
  };

  const paymentConfig = {
    isLoading,
    // PIX - Disponível apenas para checkout Brasil E se seller permite
    pixEnabled: marketTarget === 'brasil' && 
                isMethodEnabled(methods.pix) && 
                (!sellerAcquirers || sellerAcquirers.pix?.enabled !== false),
    
    // Cartão brasileiro - Disponível se checkout Brasil permite cartão E seller permite
    brazilianCardEnabled: marketTarget === 'brasil' && 
                          isMethodEnabled(methods.card) && 
                          (!sellerAcquirers || sellerAcquirers.brazilianCard?.enabled !== false),
    
    // Cartão global - Disponível se checkout global E checkout permite cartão E seller permite
    globalCardEnabled: marketTarget === 'global' && 
                       isMethodEnabled(methods.card) && 
                       (!sellerAcquirers || sellerAcquirers.globalCard?.enabled !== false),
    
    // Adquirente especfico para cartão brasileiro (EfBank)
    brazilianCardAcquirer: sellerAcquirers?.brazilianCard?.acquirer || 'efibank',
    
    // Adquirente especfico para cartão global (Stripe ou Adyen)
    globalCardAcquirer: sellerAcquirers?.globalCard?.acquirer || 'stripe',
    
    // Configurações originais do checkout
    originalMethods: checkout?.methods || {}
  };
  
  console.log('PAYMENT CONFIG:', {
    sellerId: checkout?.tenantId,
    originalMarketTarget: checkout?.marketTarget,
    fallbackMarketTarget: marketTarget,
    originalMethods: checkout?.methods,
    fallbackMethods: methods,
    sellerAcquirers,
    paymentConfig
  });
  
  return paymentConfig;
}