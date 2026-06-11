import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Strategy {
  id: string;
  name: string;
  type: "upsell" | "downsell";
  offerType: "product" | "url";
  productId?: string;
  customOfferUrl?: string;
  onAccept: {
    action: string;
    url?: string;
    nextProductId?: string;
  };
  onRefuse: {
    action: string;
    url?: string;
    nextProductId?: string;
  };
}

interface ProductInfo {
  id: string;
  title: string;
  description?: string;
  coverImage?: string;
  checkouts: { id: string; slug: string; title?: string }[];
}

export default function OfferPage() {
  const [, setLocation] = useLocation();
  const [processing, setProcessing] = useState(false);
  
  // Extrair checkoutId e strategyIndex da URL
  const urlParams = new URLSearchParams(window.location.search);
  const checkoutId = urlParams.get('checkoutId');
  const strategyIndex = parseInt(urlParams.get('strategyIndex') || '0');

  // Buscar estratégias do checkout
  const { data: strategiesData, isLoading } = useQuery({
    queryKey: ['/api/checkouts', checkoutId, 'strategies'],
    queryFn: async () => {
      if (!checkoutId) throw new Error('CheckoutId não fornecido');
      const res = await fetch(`/api/checkouts/${checkoutId}/strategies`);
      if (!res.ok) throw new Error('Falha ao buscar estratégias');
      return await res.json();
    },
    enabled: !!checkoutId,
  });

  const currentStrategy: Strategy | undefined = strategiesData?.strategies?.[strategyIndex];

  // Buscar dados do produto da estratégia (quando offerType é 'product')
  const { data: productData } = useQuery<{ product: ProductInfo }>({
    queryKey: ['/api/products/public', currentStrategy?.productId],
    queryFn: async () => {
      const res = await fetch(`/api/products/public/${currentStrategy!.productId}`);
      if (!res.ok) throw new Error('Produto não encontrado');
      return res.json();
    },
    enabled: !!currentStrategy?.productId && currentStrategy?.offerType === 'product',
  });

  const offerProduct = productData?.product;

  // VERIFICAR CONDIÇÕES E REDIRECIONAR
  useEffect(() => {
    if (!checkoutId) {
      setLocation('/');
      return;
    }
    if (!isLoading && !currentStrategy) {
      console.log('Sem estratégias disponíveis, redirecionando para sucesso...');
      setLocation('/success');
    }
  }, [checkoutId, isLoading, currentStrategy, setLocation]);

  // Função para processar decisão (aceitar ou recusar)
  const handleDecision = async (accept: boolean) => {
    if (!currentStrategy) return;

    setProcessing(true);

    try {
      const decision = accept ? currentStrategy.onAccept : currentStrategy.onRefuse;
      const nextStrategyIndex = strategyIndex + 1;
      const hasMoreStrategies = strategiesData?.strategies?.length > nextStrategyIndex;

      // 1. Se aceitar e oferta é produto, redirecionar para checkout do produto
      if (accept && currentStrategy.offerType === 'product' && currentStrategy.productId) {
        // Usar dados já buscados ou buscar agora
        const data = offerProduct || await fetch(`/api/products/public/${currentStrategy.productId}`)
          .then(r => r.ok ? r.json().then((j: { product: ProductInfo }) => j.product) : null);
        
        const checkoutSlug = data?.checkouts?.[0]?.slug;
        if (checkoutSlug) {
          window.location.href = `/checkout/${checkoutSlug}`;
          return;
        }
        setLocation('/success');
        return;
      }

      // 2. Se aceitar e oferta é URL customizada, redirecionar para URL
      if (accept && currentStrategy.offerType === 'url' && currentStrategy.customOfferUrl) {
        window.location.href = currentStrategy.customOfferUrl;
        return;
      }

      // 3. Tratar ação configurada (accept ou refuse)
      if (decision.action === 'url-customizada' && decision.url) {
        window.location.href = decision.url;
        return;
      }

      if (decision.action === 'nova-oferta' && decision.nextProductId) {
        const res = await fetch(`/api/products/public/${decision.nextProductId}`);
        if (res.ok) {
          const pd: { product: ProductInfo } = await res.json();
          const checkoutSlug = pd.product?.checkouts?.[0]?.slug;
          if (checkoutSlug) {
            window.location.href = `/checkout/${checkoutSlug}`;
            return;
          }
        }
      }

      if (decision.action === 'nova-oferta' && hasMoreStrategies) {
        setLocation(`/offer?checkoutId=${checkoutId}&strategyIndex=${nextStrategyIndex}`);
        return;
      }

      // Fallback: página de sucesso
      setLocation('/success');

    } catch (error) {
      console.error('Erro ao processar decisão:', error);
      setLocation('/success');
    } finally {
      setProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-emerald-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-300">Carregando oferta especial...</p>
        </div>
      </div>
    );
  }

  if (!currentStrategy) return null;

  const isUpsell = currentStrategy.type === 'upsell';
  const displayTitle = offerProduct?.title || currentStrategy.name;
  const displayDescription = offerProduct?.description || (
    isUpsell
      ? 'Aproveite esta oferta exclusiva para turbinar seus resultados!'
      : 'Não perca esta oportunidade única com condições especiais!'
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-emerald-50 to-pink-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-2xl border-2 border-blue-200 dark:border-blue-800">
        <CardContent className="p-8 md:p-12">
          {/* Imagem do produto (se existir) */}
          {offerProduct?.coverImage && (
            <div className="w-full mb-6 rounded-xl overflow-hidden max-h-48">
              <img
                src={offerProduct.coverImage}
                alt={displayTitle}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Ícone e Badge */}
          <div className="text-center mb-6">
            {!offerProduct?.coverImage && (
              <div className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${
                isUpsell
                  ? 'bg-gradient-to-br from-blue-500 to-emerald-600'
                  : 'bg-gradient-to-br from-emerald-500 to-emerald-600'
              }`}>
                <TrendingUp className="h-10 w-10 text-white" />
              </div>
            )}
            
            <div className={`inline-block px-4 py-1 rounded-full text-sm font-semibold mb-4 ${
              isUpsell
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
            }`}>
              {isUpsell ? 'Oferta Especial' : 'Última Chance'}
            </div>
          </div>

          {/* Título da Oferta */}
          <h1 className="text-3xl md:text-4xl font-bold text-center mb-4 text-gray-900 dark:text-white">
            {displayTitle}
          </h1>

          {/* Descrição */}
          <p className="text-center text-lg text-gray-600 dark:text-gray-300 mb-8">
            {displayDescription}
          </p>

          {/* Botões de Ação */}
          <div className="space-y-4">
            <Button
              onClick={() => handleDecision(true)}
              disabled={processing}
              className={`w-full h-14 text-lg font-semibold ${
                isUpsell
                  ? 'bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700'
                  : 'bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700'
              } text-white shadow-lg hover:shadow-xl transition-all`}
            >
              {processing ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <CheckCircle className="h-5 w-5 mr-2" />
              )}
              {processing ? 'Processando...' : 'Sim, eu quero!'}
            </Button>

            <Button
              onClick={() => handleDecision(false)}
              disabled={processing}
              variant="outline"
              className="w-full h-12 text-base border-2 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Não, obrigado
            </Button>
          </div>

          {/* Nota de Segurança */}
          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-center text-gray-500 dark:text-gray-400">
              🔒 Transação 100% segura e protegida
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
