import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Package, Copy, Check, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export default function ProductDetailPage() {
  const [match, params] = useRoute("/showcase/product/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  // Buscar produto
  const { data: product, isLoading } = useQuery({
    queryKey: [`/api/showcase/checkouts/${params?.id}`],
    queryFn: async () => {
      const response = await fetch(`/api/showcase/checkouts?limit=100`);
      const checkouts = await response.json();
      return checkouts.find((c: any) => c.id === params?.id);
    },
    enabled: !!params?.id,
  });

  // Buscar ofertas do produto
  const { data: offers = [] } = useQuery({
    queryKey: [`/api/products/${params?.id}/offers`],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/products/${params?.id}/offers`);
        if (!response.ok) return [];
        return await response.json();
      } catch {
        return [];
      }
    },
    enabled: !!params?.id && !!product,
  });

  // Criar afiliação
  const createAffiliateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('/api/affiliations', 'POST', {
        productId: params?.id,
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "✅ Afiliação Criada!",
        description: "Seu link único foi gerado",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/affiliations'] });
    },
    onError: (error: any) => {
      toast({
        title: "❌ Erro",
        description: error.message || "Erro ao criar afiliação",
      });
    },
  });

  const affiliateUrl = product?.id ? `${window.location.origin}/affiliate/${product.id}` : "";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(affiliateUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "✅ Copiado!",
      description: "Link de afiliação copiado para área de transferência",
    });
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <p>Carregando...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!product) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <Package className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500">Produto não encontrado</p>
          <button 
            onClick={() => setLocation("/dashboard/showcase")}
            className="text-blue-500 hover:underline mt-4 inline-block"
          >
            ← Voltar para vitrine
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setLocation("/dashboard/showcase")}
            className="flex items-center gap-2 text-blue-500 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
        </div>

        {/* Produto */}
        <Card className="bg-white dark:bg-transparent border border-gray-200 dark:border-gray-700">
          <CardContent className="pt-6 space-y-4">
            {/* Imagem */}
            <div className="aspect-square w-full bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center overflow-hidden">
              {product.image ? (
                <img src={product.image} alt={product.title} className="w-full h-full object-cover" />
              ) : (
                <Package className="h-12 w-12 text-gray-400" />
              )}
            </div>

            {/* Info */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {product.title}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {product.seller?.businessName || product.seller?.name}
              </p>

              {/* Preço e Comissão */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Preço</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    R$ {(product.price / 100).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Sua Comissão</p>
                  <p className="text-xl font-bold text-emerald-600">
                    R$ {(product.price * (product.affiliate?.commissionPercent || 10) / 10000).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ofertas */}
        {offers.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">📦 Ofertas Disponíveis</h2>
            <div className="space-y-3">
              {offers.map((offer: any) => (
                <Card key={offer.id} className="bg-gray-50 dark:bg-transparent border border-gray-200 dark:border-gray-700">
                  <CardContent className="pt-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{offer.name}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{offer.description || "Sem descrição"}</p>
                      </div>
                      <p className="font-semibold text-gray-900 dark:text-white whitespace-nowrap ml-2">
                        R$ {(offer.price / 100).toFixed(2)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Afiliação */}
        {product.isAffiliate && (
          <Card className="bg-emerald-50 dark:bg-transparent border-2 border-emerald-200 dark:border-emerald-700">
            <CardContent className="pt-6 space-y-4">
              <div>
                <h3 className="font-semibold text-emerald-900 dark:text-emerald-200 mb-2">
                  🎯 Programa de Afiliados Ativo
                </h3>
                <p className="text-sm text-[#f0f4ff] dark:text-emerald-300 mb-4">
                  Ganhe comissão por cada venda! Compartilhe seu link de afiliação único abaixo.
                </p>
              </div>

              {/* Link de Afiliação */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Seu Link de Afiliação
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={affiliateUrl}
                    readOnly
                    className="flex-1 px-3 py-2 bg-white dark:bg-transparent border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-900 dark:text-white"
                  />
                  <Button
                    onClick={copyToClipboard}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copiado!" : "Copiar"}
                  </Button>
                </div>
              </div>

              {/* Botão Ativar Afiliação */}
              <Button
                onClick={() => createAffiliateMutation.mutate()}
                disabled={createAffiliateMutation.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {createAffiliateMutation.isPending ? "Ativando..." : "✅ Se Afiliar Agora"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Sem Afiliado */}
        {!product.isAffiliate && (
          <Card className="bg-gray-50 dark:bg-transparent border border-gray-200 dark:border-gray-700">
            <CardContent className="pt-6">
              <p className="text-center text-gray-600 dark:text-gray-400">
                ⏳ Este produto ainda não tem programa de afiliados ativo
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
