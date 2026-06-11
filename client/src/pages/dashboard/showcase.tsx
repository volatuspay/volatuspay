import { useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resolveImageUrl } from "@/lib/image-url";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Package, Check } from "lucide-react";
import BannerDisplay from "@/components/dashboard/banner-display";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";

interface Product {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  tenantId?: string;
  seller: {
    name: string;
    businessName: string;
    uid?: string;
  };
  affiliate: {
    enabled: boolean;
    autoApprove: boolean;
    commissionPercent: number;
    showInMarketplace: boolean;
    support?: {
      email?: string;
      phone?: string;
      whatsapp?: string;
    };
    rules?: string;
  };
  offers: Array<{
    uuid?: string;
    id?: string;
    slug?: string;
    name?: string;
    title?: string;
    price: number;
    affiliateCommission?: number;
    checkoutId?: string;
  }>;
  checkoutSlug?: string;
  productType: string;
  createdAt: any;
  totalSales?: number;
  totalRevenue?: number;
  hypeScore?: number;
}

// Componente de Barrinha de Hype com efeito fogo 3D neon realista
// 💰 BASEADO EM RECEITA (valor vendido em R$), não quantidade
const HypeBar = ({ revenue }: { revenue: number }) => {
  const revenueReais = revenue / 100;
  const progress = Math.min(100, Math.max(0, (revenueReais / 20000) * 100));
  const isOnFire = revenueReais >= 5000;
  const isWarm = revenueReais >= 1000;
  const hasAnySales = revenueReais > 0;

  return (
    <div className="w-full mt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`relative ${isOnFire ? 'animate-pulse' : ''}`}>
          <svg
            viewBox="0 0 24 24"
            className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${hasAnySales ? '' : 'opacity-30'}`}
            style={{
              filter: isOnFire
                ? 'drop-shadow(0 0 4px #f97316) drop-shadow(0 0 8px #ea580c)'
                : isWarm
                ? 'drop-shadow(0 0 3px #fbbf24)'
                : 'none'
            }}
          >
            <defs>
              <linearGradient id="fireGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#dc2626" />
                <stop offset="40%" stopColor="#ea580c" />
                <stop offset="70%" stopColor="#f97316" />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
            </defs>
            <path
              fill={hasAnySales ? "url(#fireGrad)" : "#6b7280"}
              d="M12 23c-3.866 0-7-3.134-7-7 0-2.5 1.5-4.5 3-6.5.5-.667 1-1.333 1.5-2 .833 1.667 2.333 3.167 4.5 4.5-1.5-3-1.5-5.5 0-7.5 1.5 2 3 3.5 4.5 4.5 1.5 1 2.5 2 2.5 4 0 1-.167 2-.5 3-.5 1.5-1.5 3-3 4-1 .667-2.5 1-5 1z"
            />
          </svg>
        </div>
        <span className={`text-[9px] sm:text-[10px] font-medium ${
          isOnFire ? 'text-orange-400' : isWarm ? 'text-yellow-400' : 'text-gray-500'
        }`}>
          {isOnFire ? 'Em Alta 🔥' : isWarm ? 'Vendendo' : hasAnySales ? 'Iniciando' : 'Novo'}
        </span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 sm:h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(progress, hasAnySales ? 3 : 0)}%`,
            background: isOnFire
              ? 'linear-gradient(90deg, #dc2626, #f97316, #fbbf24)'
              : isWarm
              ? 'linear-gradient(90deg, #f97316, #fbbf24)'
              : hasAnySales
              ? '#3b82f6'
              : '#6b7280'
          }}
        />
      </div>
    </div>
  );
};

export default function ShowcasePage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { user } = useAuthStore();

  const isProductOwner = (product: Product) => {
    if (!user) return false;
    return product.tenantId === user.uid || product.seller?.uid === user.uid;
  };

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['/api/showcase/checkouts'],
    queryFn: async () => {
      const response = await fetch('/api/showcase/checkouts?affiliateOnly=false&limit=100');
      if (!response.ok) return [];
      return await response.json();
    },
  });

  const { data: myAffiliationsData } = useQuery<any>({
    queryKey: ['/api/affiliations'],
    enabled: !!user,
  });
  const myAffiliations = (myAffiliationsData as any)?.affiliations || [];

  const isAlreadyAffiliated = (productId: string) => {
    return myAffiliations.some((aff: any) => aff.productId === productId);
  };

  const getAffiliationStatus = (productId: string) => {
    const affiliation = myAffiliations.find((aff: any) => aff.productId === productId);
    return affiliation?.status || null;
  };

  const getMaxCommission = (product: Product) => {
    if (!product.offers || product.offers.length === 0) {
      const productPrice = (product as any).price || (product as any).pricing?.amount || 0;
      const percent = product.affiliate?.commissionPercent || 10;
      const commission = (productPrice * percent) / 100;
      return `R$ ${(commission / 100).toFixed(2)}`;
    }

    let maxCommission = 0;
    for (const offer of product.offers) {
      const price = offer.price || 0;
      const percent = offer.affiliateCommission || product.affiliate?.commissionPercent || 10;
      const commission = (price * percent) / 100;
      if (commission > maxCommission) maxCommission = commission;
    }

    return `R$ ${(maxCommission / 100).toFixed(2)}`;
  };

  const getProductPrice = (product: Product) => {
    if (!product.offers || product.offers.length === 0) {
      const productPrice = (product as any).price || (product as any).pricing?.amount || 0;
      return `R$ ${(productPrice / 100).toFixed(2)}`;
    }

    let maxPrice = 0;
    for (const offer of product.offers) {
      const price = offer.price || 0;
      if (price > maxPrice) maxPrice = price;
    }

    return `R$ ${(maxPrice / 100).toFixed(2)}`;
  };

  const filteredProducts = products
    .filter(product => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          product.title?.toLowerCase().includes(query) ||
          product.description?.toLowerCase().includes(query) ||
          product.seller?.businessName?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      if (activeTab !== "all" && activeTab !== "profitable") {
        if (product.productType !== activeTab) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (activeTab === "profitable") {
        const aMax = Math.max(...(a.offers || []).map((o: any) => (o.affiliateCommission || 0) * (o.price || 0) / 100), 0);
        const bMax = Math.max(...(b.offers || []).map((o: any) => (o.affiliateCommission || 0) * (o.price || 0) / 100), 0);
        return bMax - aMax;
      }
      return (b.totalRevenue || 0) - (a.totalRevenue || 0);
    })
    .slice(0, 30);

  const handleProductClick = (product: Product) => {
    setLocation(`/convite/${product.id}`);
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-transparent relative">
        <BannerDisplay position="showcase" />
        <div className="bg-white dark:bg-[hsl(142,15%,6%)] border-b border-gray-200 dark:border-lime-500/20 sticky top-0 z-50 shadow-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4 sm:gap-6 border-b border-gray-200 dark:border-lime-500/20 overflow-x-auto scrollbar-hide">
              {[
                { id: "all", label: "Em Alta" },
                { id: "profitable", label: "Mais Lucrativos" },
                { id: "digital", label: "Digitais" },
                { id: "subscription", label: "Assinaturas" },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-3 sm:py-4 px-1 sm:px-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                    activeTab === tab.id
                      ? "border-lime-500 text-lime-500 dark:border-lime-500 dark:text-blue-400"
                      : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="py-3 sm:py-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="O que você está buscando?"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-lime-500/20"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-8 w-8 border-4 border-lime-500 border-t-transparent rounded-full" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Package className="h-12 w-12 text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Nenhum produto disponível
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {searchQuery ? "Tente buscar por outro termo" : "Ainda não há produtos nesta categoria"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3 sm:gap-4">
              {filteredProducts.map(product => (
                <Card
                  key={product.id}
                  onClick={() => handleProductClick(product)}
                  className="cursor-pointer bg-white dark:bg-[hsl(142,15%,8%)] border border-gray-200 dark:border-lime-500/20 hover:shadow-lg hover:border-lime-500/40 transition-all duration-200 overflow-hidden group"
                >
                  <div className="aspect-square w-full overflow-hidden bg-gray-100 dark:bg-gray-800 relative">
                    {product.imageUrl ? (
                      <img
                        src={resolveImageUrl(product.imageUrl) || ''}
                        alt={product.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-8 w-8 text-gray-400" />
                      </div>
                    )}
                    {product.productType === "subscription" && (
                      <span className="absolute top-1.5 left-1.5 bg-purple-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">
                        Assinatura
                      </span>
                    )}
                    {isProductOwner(product) && (
                      <span className="absolute top-1.5 right-1.5 bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">
                        Meu produto
                      </span>
                    )}
                  </div>
                  <CardContent className="p-2.5 sm:p-3">
                    <h3 className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-white line-clamp-2 h-8 sm:h-10 leading-4 sm:leading-5">
                      {product.title}
                    </h3>
                    <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate mt-1 h-4">
                      <span className="text-[#2563eb]">Empresa:</span> {product.seller?.businessName || product.seller?.name || "Vendedor"}
                    </p>
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-lime-500/10">
                      <div className="flex flex-col">
                        <span className="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wide">Comissão</span>
                        <span className="text-xs sm:text-sm font-bold text-green-500 dark:text-blue-400 truncate">
                          {getMaxCommission(product)}
                        </span>
                      </div>
                      <div className="flex flex-col text-right">
                        <span className="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wide">Valor</span>
                        <span className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white truncate">
                          {getProductPrice(product)}
                        </span>
                      </div>
                    </div>
                    <HypeBar revenue={product.totalRevenue || 0} />
                    {getAffiliationStatus(product.id) === 'approved' && (
                      <Button
                        onClick={(e) => { e.stopPropagation(); setLocation('/dashboard/minhas-afiliacoes'); }}
                        size="sm"
                        variant="ghost"
                        className="w-full mt-2 h-6 text-[10px] bg-[#2563eb]/20 hover:bg-[#2563eb]/40 text-[#2563eb] border border-lime-500/30 rounded px-1"
                      >
                        <Check className="h-3 w-3 mr-1 shrink-0" />
                        Ver meu link
                      </Button>
                    )}
                    {isAlreadyAffiliated(product.id) && getAffiliationStatus(product.id) === 'pending' && (
                      <div className="mt-2 text-center">
                        <span className="text-[9px] text-yellow-500">Aguardando aprovação</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
