import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveImageUrl } from "@/lib/image-url";
import { Button } from "@/components/ui/button";
import { Search, Package, Shield, Lock } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { AddProductModal } from "@/components/products/add-product-modal";
import AccountVerificationModal from "@/components/seller/account-verification-modal";
import { useQuery } from "@tanstack/react-query";
import { getProductsByTenant } from "@/lib/firestore";
import { auth } from "@/lib/firebase";
import type { Product } from "@shared/schema";

type ProductTab = "autorais" | "coproducao";


export default function ProductsListPage() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ProductTab>("autorais");
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [sellerStatus, setSellerStatus] = useState<string | null>(null);
  const [sellerProfileComplete, setSellerProfileComplete] = useState<boolean | null>(null);

  const user = auth.currentUser;
  const tenantId = user?.uid || "";

  useEffect(() => {
    if (!user) return;
    const fetchSellerStatus = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/sellers/${user.uid}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const seller = await response.json();
          setSellerStatus(seller.status);
          setSellerProfileComplete(seller.profileComplete ?? false);
        }
      } catch (err) {
        console.error("Erro ao buscar status do seller:", err);
      }
    };
    fetchSellerStatus();
  }, [user]);

  const isSellerLoading = sellerStatus === null;
  const isBlocked = sellerStatus !== null && sellerStatus !== 'approved';

  const { data: allProducts = [], isLoading } = useQuery<Product[]>({
    queryKey: ["products", tenantId],
    queryFn: () => getProductsByTenant(tenantId),
    enabled: !!tenantId,
  });

  const handleProductClick = (productId: string) => {
    navigate(`/dashboard/product-detail/${productId}`);
  };

  const tabs: { key: ProductTab; label: string }[] = [
    { key: "autorais", label: "Autorais" },
    { key: "coproducao", label: "Coprodução" },
  ];

  // Filtrar produtos baseado na aba ativa - DADOS REAIS do Firebase
  const filteredProducts = allProducts.filter((product) => {
    if (activeTab === "autorais") {
      // Produtos onde o usuário é o DONO (tenantId == userId)
      return product.tenantId === tenantId;
    } else if (activeTab === "coproducao") {
      // Produtos onde o usuário é COPRODUTOR
      // TODO: Implementar quando houver campo de coprodutores no schema
      return false;
    }
    return true;
  });

  // Filtrar por busca
  const products = filteredProducts.filter((product) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      product.title.toLowerCase().includes(query) ||
      (product.description?.toLowerCase().includes(query) ?? false)
    );
  });

  if (isBlocked) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="mb-6 p-5 bg-amber-950/30 rounded-full">
            <Lock className="h-14 w-14 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">
            Produtos Bloqueados
          </h2>
          <p className="text-gray-400 text-center max-w-md mb-6">
            {!sellerProfileComplete
              ? "Complete a verificação da sua conta para desbloquear a criação e gerenciamento de produtos."
              : "Sua conta está em análise. Aguarde a aprovação para gerenciar seus produtos."}
          </p>
          {!sellerProfileComplete ? (
            <Button
              onClick={() => setIsVerificationModalOpen(true)}
              className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
              data-testid="button-verify-products-blocked"
            >
              <Shield className="h-4 w-4 mr-2" />
              Verificar Conta
            </Button>
          ) : (
            <p className="text-sm text-blue-400">
              Aprovação em até 5 horas úteis
            </p>
          )}
        </div>
        <AccountVerificationModal
          open={isVerificationModalOpen}
          onOpenChange={setIsVerificationModalOpen}
          onComplete={() => window.location.reload()}
        />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6 px-3 py-4 md:p-6">
        {/* Header com Abas, Busca e Ações */}
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          {/* Abas */}
          <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0">
            {tabs.map((tab) => (
              <Button
                key={tab.key}
                variant={activeTab === tab.key ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab(tab.key)}
                className={
                  activeTab === tab.key
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 whitespace-nowrap"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap"
                }
              >
                {tab.label}
              </Button>
            ))}
          </div>

          {/* Busca e Botões */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full lg:w-auto">
            <div className="relative flex-1 lg:flex-initial lg:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Buscar"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20"
              />
            </div>
            <Button
              onClick={() => setIsAddProductModalOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0 w-full sm:w-auto"
            >
              Adicionar produto
            </Button>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="bg-white dark:bg-transparent border border-gray-200 dark:border-lime-500/20 shadow-card">
                <CardContent className="p-6">
                  <div className="mb-4 flex items-center justify-center">
                    <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
                  </div>
                  <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-2 animate-pulse" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-3 animate-pulse" />
                  <div className="flex gap-2">
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16 animate-pulse" />
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20 animate-pulse" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Grid de Produtos */}
        {!isLoading && products.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <Card
                key={product.id}
                onClick={() => handleProductClick(product.id)}
                className="bg-white dark:bg-transparent border border-gray-200 dark:border-lime-500/20 shadow-card cursor-pointer hover:shadow-lg transition-shadow"
              >
                <CardContent className="p-6">
                  {/* Imagem/Ícone do Produto */}
                  <div className="mb-4 flex items-center justify-center">
                    {product.imageUrl ? (
                      <>
                        <img
                          src={resolveImageUrl(product.imageUrl) || ''}
                          alt={product.title}
                          className="w-16 h-16 rounded-lg object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.nextElementSibling;
                            if (fallback) (fallback as HTMLElement).style.display = 'flex';
                          }}
                        />
                        <div className="w-16 h-16 bg-gray-900 dark:bg-gray-100 rounded-lg items-center justify-center" style={{ display: 'none' }}>
                          <Package className="h-8 w-8 text-white dark:text-gray-900" />
                        </div>
                      </>
                    ) : (
                      <div className="w-16 h-16 bg-gray-900 dark:bg-gray-100 rounded-lg flex items-center justify-center">
                        <Package className="h-8 w-8 text-white dark:text-gray-900" />
                      </div>
                    )}
                  </div>

                  {/* Nome do Produto */}
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 truncate">
                    {product.title}
                  </h3>

                  {/* Descrição do Produto */}
                  {product.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
                      {product.description}
                    </p>
                  )}

                  {/* Status e Tipo */}
                  <div className="flex gap-2 items-center flex-wrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      product.active 
                        ? "bg-blue-100 text-[#f0f4ff] dark:bg-gray-700/70 dark:text-blue-400" 
                        : "bg-gray-100 text-gray-800 dark:bg-transparent/30 dark:text-gray-400"
                    }`}>
                      ● {product.active ? "ATIVO" : "INATIVO"}
                    </span>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase ${
                      product.productType === "subscription"
                        ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                    }`}>
                      {product.productType === "subscription" ? "Assinatura"
                        : product.productType === "digital" ? "Digital"
                        : product.productType}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Estado Vazio (quando não houver produtos) */}
        {!isLoading && products.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
              <Package className="h-12 w-12 text-gray-400" />
            </div>
            <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              Nenhum produto encontrado
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Clique em "Adicionar produto" para começar
            </p>
          </div>
        )}
      </div>

      {/* Modal de Adicionar Produto */}
      <AddProductModal
        open={isAddProductModalOpen}
        onOpenChange={setIsAddProductModalOpen}
      />
    </DashboardLayout>
  );
}
