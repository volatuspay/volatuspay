import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/stores/auth";
import { resolveImageUrl } from "@/lib/image-url";
import { auth } from "@/lib/firebase";
import { Search, Package, CheckCircle, Clock, XCircle, Eye, EyeOff, ToggleLeft, ToggleRight, Trash2, AlertTriangle, CheckCheck, Ban, History, Store } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/dashboard-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeletionRequest {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  requestedAt?: Date;
  requestedBy?: string;
  reason?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  rejectionReason?: string;
}

interface Product {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  productType: 'digital' | 'subscription';
  checkoutId?: string;
  active: boolean;
  status?: 'active' | 'risk' | 'blocked';
  deletionRequest?: DeletionRequest;
  deletedAt?: Date;
  deletedBy?: string;
  createdAt: any;
  updatedAt: any;
  tenantId: string;
  sellerEmail?: string;
  sellerName?: string;
  totalSales?: number;
  adminHidden?: boolean;
}

interface Seller {
  id: string;
  email: string;
  businessName?: string;
  fullName?: string;
}

export default function AdminProducts({ initialTab = "active", hideTabs = false }: { initialTab?: string; hideTabs?: boolean }) {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<Product[]>([]);
  const [deletedProducts, setDeletedProducts] = useState<Product[]>([]);
  const [sellers, setSellers] = useState<Record<string, Seller>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState(initialTab);
  const [salesStats, setSalesStats] = useState<Record<string, { total: number; pending: number; paid: number }>>({});
  const [rejectionDialog, setRejectionDialog] = useState<{ open: boolean; productId: string | null; reason: string }>({
    open: false,
    productId: null,
    reason: ''
  });
  const [approveDialog, setApproveDialog] = useState<{ open: boolean; productId: string | null }>({
    open: false,
    productId: null
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; productId: string | null }>({
    open: false,
    productId: null
  });
  const [hideShowcaseDialog, setHideShowcaseDialog] = useState<{ open: boolean; productId: string | null; isHidden: boolean }>({
    open: false,
    productId: null,
    isHidden: false
  });

  useEffect(() => {
    if (!user) {
      console.log('Aguardando autenticação...');
      return;
    }

    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      console.log('Admin carregando todos os produtos...');
      
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('Token de autenticação não disponível');
      }
      
      // Buscar sellers
      const sellersResponse = await fetch('/api/admin/sellers', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!sellersResponse.ok) {
        throw new Error('Erro ao carregar sellers');
      }
      
      const sellersData = await sellersResponse.json();
      const sellersArray = Array.isArray(sellersData) 
        ? sellersData 
        : (sellersData.sellers || sellersData.data || []);
      
      const approvedSellers = sellersArray.filter((seller: any) => 
        seller.status === 'approved' || seller.isApproved === true
      );
      
      const sellersMap: Record<string, Seller> = {};
      approvedSellers.forEach((seller: any) => {
        sellersMap[seller.id] = {
          id: seller.id,
          email: seller.email,
          businessName: seller.businessName,
          fullName: seller.fullName
        };
      });
      
      setSellers(sellersMap);
      console.log(`Sellers APROVADOS carregados: ${Object.keys(sellersMap).length} de ${sellersArray.length} totais`);

      // Buscar produtos normais
      const productsResponse = await fetch('/api/admin/products', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!productsResponse.ok) {
        const errorData = await productsResponse.json().catch(() => ({}));
        const errorMsg = errorData.error || errorData.message || `Status ${productsResponse.status}`;
        throw new Error(`Erro ao carregar produtos: ${errorMsg}`);
      }
      
      const productsData = await productsResponse.json();
      console.log('Produtos brutos carregados:', productsData.length);
      
      const deletedCount = productsData.filter((p: any) => p.deletedAt || p.deletionRequest?.status === 'approved').length;
      const pendingCount = productsData.filter((p: any) => p.deletionRequest?.status === 'pending').length;
      console.log(`Filtrados: ${deletedCount} deletados, ${pendingCount} pendentes`);
      
      const allProducts: Product[] = productsData
        .filter((p: any) => {
          // CORREÇÃO: Ignorar produtos DELETADOS (aparecem apenas na aba "Excluídos")
          const hasDeletedAt = p.deletedAt !== null && p.deletedAt !== undefined;
          const isDeleted = p.deleted === true;
          const hasPendingDeletion = p.deletionRequest?.status === 'pending';
          const isApprovedForDeletion = p.deletionRequest?.status === 'approved';
          
          // Produtos deletados ou com solicitação de exclusão não aparecem aqui
          return !hasDeletedAt && !isDeleted && !hasPendingDeletion && !isApprovedForDeletion;
        })
        .map((productData: any) => {
          const seller = sellersMap[productData.tenantId];
          
          return {
            id: productData.id,
            ...productData,
            status: getProductStatus(productData),
            sellerEmail: seller?.email,
            sellerName: seller?.businessName || seller?.fullName,
          } as Product;
        });

      setProducts(allProducts);
      console.log(`Produtos ativos/risco/bloqueados: ${allProducts.length}`);

      // Buscar solicitações de exclusão pendentes
      const deletionRequestsResponse = await fetch('/api/admin/products/deletion-requests', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (deletionRequestsResponse.ok) {
        const deletionRequestsData = await deletionRequestsResponse.json();
        const requests = (deletionRequestsData.products || []).map((productData: any) => {
          const seller = sellersMap[productData.tenantId];
          return {
            ...productData,
            sellerEmail: seller?.email,
            sellerName: seller?.businessName || seller?.fullName,
          } as Product;
        });
        setDeletionRequests(requests);
        console.log(` Solicitações de exclusão: ${requests.length}`);
      }

      // Buscar produtos deletados
      const deletedResponse = await fetch('/api/admin/products/deleted', {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (deletedResponse.ok) {
        const deletedData = await deletedResponse.json();
        const deleted = (deletedData.products || []).map((productData: any) => {
          const seller = sellersMap[productData.tenantId];
          return {
            ...productData,
            sellerEmail: seller?.email,
            sellerName: seller?.businessName || seller?.fullName,
          } as Product;
        });
        setDeletedProducts(deleted);
        console.log(`Produtos deletados: ${deleted.length}`);
      }

    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
      toast({
        title: "Erro",
        description: "Falha ao carregar produtos",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const getProductStatus = (product: any): 'active' | 'risk' | 'blocked' => {
    if (product.active === false) return 'blocked';
    
    // REAL: Risco CRTICO = sem descrição E sem foto (AMBOS faltando)
    const missingDescription = !product.description || product.description.trim().length < 5;
    const missingImage = !product.imageUrl || product.imageUrl.trim() === '';
    
    // Produto de risco: sem descrição E sem foto (ambos faltando)
    const hasCriticalIssues = missingDescription && missingImage;
    
    if (product.active && hasCriticalIssues) {
      return 'risk';
    }
    
    return 'active';
  };

  const filteredProducts = products.filter(product => {
    // CORREÇÃO: Separar ativos, bloqueados e deletados corretamente
    // Produtos deletados NÃO devem aparecer em ativos nem bloqueados
    if (product.deletedAt) {
      return false; // Deletados só aparecem na tab "deleted"
    }
    
    const matchesStatus = activeTab === "active"
      ? product.status === 'active'
      : activeTab === 'risk'
      ? product.status === 'risk'
      : (activeTab === 'blocked' && product.status === 'blocked');
      
    const matchesSearch = searchTerm === "" || 
      product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sellerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sellerName?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesStatus && matchesSearch;
  });

  const filteredDeletionRequests = deletionRequests.filter(product => {
    const matchesSearch = searchTerm === "" || 
      product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sellerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sellerName?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  const filteredDeletedProducts = deletedProducts.filter(product => {
    const matchesSearch = searchTerm === "" || 
      product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sellerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sellerName?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  const counts = {
    active: products.filter(p => p.status === 'active').length,
    risk: products.filter(p => p.status === 'risk').length,
    blocked: products.filter(p => p.status === 'blocked').length,
    pendingDeletion: deletionRequests.length,
    deleted: deletedProducts.length
  };

  const toggleProductStatus = async (productId: string, currentStatus: string) => {
    try {
      const newActive = currentStatus === 'blocked' ? true : false;
      console.log(`${newActive ? 'Ativando' : 'Bloqueando'} produto ${productId} via API`);
      
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não disponível');

      const response = await fetch(`/api/admin/products/${productId}/toggle-status`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao alterar status');
      }

      console.log(`Produto ${newActive ? 'ativado' : 'bloqueado'} com sucesso!`);

      await loadData();

      toast({
        title: "Sucesso",
        description: data.message || `Produto ${newActive ? 'ativado' : 'bloqueado'} com sucesso!`
      });

    } catch (error: any) {
      console.error('Erro ao alterar status:', error);
      await loadData();
      
      toast({
        title: "Erro",
        description: error.message || "Falha ao alterar status. Dados recarregados do servidor.",
        variant: "destructive"
      });
    }
  };

  const handleApproveDeletion = async () => {
    if (!approveDialog.productId) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não disponível');

      const response = await fetch(`/api/admin/products/${approveDialog.productId}/approve-deletion`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao aprovar exclusão');
      }

      toast({
        title: " Exclusão Aprovada",
        description: `Produto deletado com sucesso! ${data.details?.checkoutsDeleted || 0} checkout(s) removido(s).`
      });

      setApproveDialog({ open: false, productId: null });
      await loadData();

    } catch (error: any) {
      console.error('Erro ao aprovar exclusão:', error);
      toast({
        title: "Erro",
        description: error.message || "Falha ao aprovar exclusão",
        variant: "destructive"
      });
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteDialog.productId) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não disponível');

      const response = await fetch(`/api/admin/products/${deleteDialog.productId}/delete`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao deletar produto');
      }

      toast({
        title: "Produto Deletado",
        description: `Produto e todos os arquivos removidos. ${data.details?.checkoutsDeleted || 0} checkout(s), ${data.details?.modulesArchived || 0} módulo(s) e ${data.details?.bunnyFilesDeleted || 0} arquivo(s) Bunny deletados. Histórico financeiro preservado.`
      });

      setDeleteDialog({ open: false, productId: null });
      await loadData();

    } catch (error: any) {
      console.error('Erro ao deletar produto:', error);
      toast({
        title: "Erro",
        description: error.message || "Falha ao deletar produto",
        variant: "destructive"
      });
    }
  };

  const handleRejectDeletion = async () => {
    if (!rejectionDialog.productId || !rejectionDialog.reason.trim()) {
      toast({
        title: "Ateno",
        description: "Digite o motivo da rejeio",
        variant: "destructive"
      });
      return;
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não disponível');

      const response = await fetch(`/api/admin/products/${rejectionDialog.productId}/reject-deletion`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: rejectionDialog.reason })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao rejeitar exclusão');
      }

      toast({
        title: " Exclusão Rejeitada",
        description: "Produto continua ativo. Seller foi notificado."
      });

      setRejectionDialog({ open: false, productId: null, reason: '' });
      await loadData();

    } catch (error: any) {
      console.error('Erro ao rejeitar exclusão:', error);
      toast({
        title: "Erro",
        description: error.message || "Falha ao rejeitar exclusão",
        variant: "destructive"
      });
    }
  };


  const handleHideFromShowcase = async () => {
    if (!hideShowcaseDialog.productId) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não disponível');

      const response = await fetch(`/api/admin/products/${hideShowcaseDialog.productId}/hide-showcase`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao alterar visibilidade');
      }

      toast({
        title: data.adminHidden ? "Produto Oculto" : "Produto Visível",
        description: data.message
      });

      setHideShowcaseDialog({ open: false, productId: null, isHidden: false });
      await loadData();

    } catch (error: any) {
      console.error('Erro ao alterar visibilidade:', error);
      toast({
        title: "Erro",
        description: error.message || "Falha ao alterar visibilidade",
        variant: "destructive"
      });
    }
  };

  const handleSyncDeletionRequests = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não disponível');

      console.log('Sincronizando solicitações de exclusão...');

      const response = await fetch('/api/admin/sync-deletion-requests', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao sincronizar');
      }

      const result = await response.json();
      
      toast({
        title: "Sincronização Concluída",
        description: `${result.productsSynced} produtos sincronizados de ${result.checkoutsWithPendingDeletion} checkouts`,
      });

      loadData();

    } catch (error: any) {
      console.error('Erro ao sincronizar:', error);
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleFixShowcase = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não disponível');

      console.log('🔧 Corrigindo produtos na vitrine...');

      const response = await fetch('/api/admin/fix-showcase-products', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao corrigir vitrine');
      }

      const result = await response.json();
      
      toast({
        title: "Vitrine Corrigida!",
        description: result.message || `${result.fixed} produtos habilitados na vitrine`,
      });

      loadData();

    } catch (error: any) {
      console.error('❌ Erro ao corrigir vitrine:', error);
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-emerald-500/20 text-[#2563eb] border-emerald-500/30"><CheckCircle className="w-3 h-3 mr-1" />Ativo</Badge>;
      case 'risk':
        return <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30"><Clock className="w-3 h-3 mr-1" />Risco</Badge>;
      case 'blocked':
        return <Badge className="bg-red-500/20 text-red-300 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Bloqueado</Badge>;
      default:
        return <Badge variant="secondary" className="bg-emerald-500/20 text-[#2563eb] border-emerald-500/30">Desconhecido</Badge>;
    }
  };

  const getProductTypeText = (type: string) => {
    switch (type) {
      case 'digital': return 'Digital';
      case 'subscription': return 'Assinatura';
      default: return type;
    }
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">
              {hideTabs
                ? initialTab === "blocked" ? "Produtos Bloqueados"
                : initialTab === "risk" ? "Produtos de Risco"
                : "Gerenciar Produtos"
                : "Gerenciar Produtos"}
            </h1>
            <p className="text-emerald-600 dark:text-blue-400 mt-1">
              {hideTabs
                ? initialTab === "blocked" ? "Produtos desativados na plataforma"
                : initialTab === "risk" ? "Produtos sem descrição ou imagem"
                : "Administre todos os produtos da plataforma"
                : "Administre todos os produtos da plataforma"}
            </p>
          </div>
          {!hideTabs && (
            <div className="flex gap-3">
              <Button
                onClick={handleSyncDeletionRequests}
                variant="outline"
                className="border-emerald-600/50 text-emerald-900 dark:text-blue-300 hover:bg-emerald-600 hover:text-white"
                data-testid="button-sync-deletion-requests"
              >
                Sincronizar Solicitações
              </Button>
              <Button
                onClick={handleFixShowcase}
                variant="outline"
                className="border-[#2563eb]/50 text-[#f0f4ff] dark:text-blue-300 hover:bg-[#2563eb] hover:text-white"
                data-testid="button-fix-showcase"
              >
                Corrigir Vitrine
              </Button>
            </div>
          )}
        </div>

        <Card className="bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20 shadow-card">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-[#2563eb]" />
              <Input
                placeholder="Buscar por produto, seller ou email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-emerald-950/30 border-emerald-600/50 text-emerald-100 placeholder-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20"
                data-testid="input-search-products"
              />
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {!hideTabs && (
            <TabsList className="grid w-full grid-cols-2 bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20 shadow-card">
              <TabsTrigger value="active" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                Ativos ({counts.active})
              </TabsTrigger>
              <TabsTrigger value="deleted" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                Excluídos ({counts.deleted})
              </TabsTrigger>
            </TabsList>
          )}

          {/* Tab Ativos, Risco e Bloqueados */}
          {['active', 'risk', 'blocked'].map(status => (
            <TabsContent key={status} value={status} className="mt-6">
              {loading ? (
                <div className="text-center py-8">
                  <p className="text-brand-muted-foreground">Carregando produtos...</p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <Card className="bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20 shadow-card">
                  <CardContent className="p-8 text-center">
                    <Package className="w-12 h-12 text-[#2563eb] mx-auto mb-4" />
                    <p className="text-[#2563eb]">
                      {searchTerm ? 'Nenhum produto encontrado para a busca' : `Nenhum produto ${status === 'active' ? 'ativo' : 'bloqueado'} encontrado`}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {filteredProducts.map((product) => (
                    <Card key={product.id} className="bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20 shadow-card hover:shadow-lg hover:shadow-emerald-500/10 transition-all">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex gap-4 flex-1">
                            {product.imageUrl && (
                              <img
                                src={resolveImageUrl(product.imageUrl) || ''}
                                alt={product.title}
                                className="w-16 h-16 object-cover rounded-lg"
                              />
                            )}
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="font-semibold text-lg text-emerald-900 dark:text-emerald-100" data-testid={`text-product-title-${product.id}`}>
                                  {product.title}
                                </h3>
                                {getStatusBadge(product.status!)}
                                {product.adminHidden && (
                                  <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30">
                                    <EyeOff className="w-3 h-3 mr-1" />
                                    Oculto da Vitrine
                                  </Badge>
                                )}
                                <Badge variant="outline" className="border-emerald-600/50 text-emerald-900 dark:text-blue-300">
                                  {getProductTypeText(product.productType)}
                                </Badge>
                              </div>
                              
                              {product.description && (
                                <p className="text-[#f0f4ff] dark:text-blue-300 mb-2 line-clamp-2">
                                  {product.description}
                                </p>
                              )}
                              
                              <div className="space-y-2">
                                <div className="flex items-center gap-4 text-sm text-emerald-700 dark:text-blue-400">
                                  <span>
                                    <strong className="text-emerald-900 dark:text-blue-300">Seller:</strong> {product.sellerName || product.sellerEmail || 'N/A'}
                                  </span>
                                  <span>
                                    <strong className="text-emerald-900 dark:text-blue-300">ID:</strong> {product.id}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-emerald-600 dark:text-lime-500">
                                  <span className="flex items-center gap-1">
                                    <Package className="w-3 h-3" />
                                    <strong>Total:</strong> {salesStats[product.id]?.total || 0}
                                  </span>
                                  <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                                    <Clock className="w-3 h-3" />
                                    <strong>Pendentes:</strong> {salesStats[product.id]?.pending || 0}
                                  </span>
                                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle className="w-3 h-3" />
                                    <strong>Pagos:</strong> {salesStats[product.id]?.paid || 0}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 ml-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleProductStatus(product.id, product.status!)}
                              className="border-emerald-600/50 text-emerald-900 dark:text-blue-300 hover:bg-emerald-600 hover:text-white"
                              data-testid={`button-toggle-${product.id}`}
                            >
                              {product.status === 'blocked' ? (
                                <>
                                  <ToggleRight className="w-4 h-4 mr-2" />
                                  Ativar
                                </>
                              ) : (
                                <>
                                  <ToggleLeft className="w-4 h-4 mr-2" />
                                  Bloquear
                                </>
                              )}
                            </Button>
                            
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => setHideShowcaseDialog({ open: true, productId: product.id, isHidden: product.adminHidden || false })}
                              className="border-orange-600/50 text-orange-900 dark:text-orange-300 hover:bg-orange-600 hover:text-white" 
                              data-testid={`button-hide-showcase-${product.id}`}
                              title={product.adminHidden ? "Mostrar na Vitrine" : "Ocultar da Vitrine"}
                            >
                              {product.adminHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            </Button>
                            
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => setDeleteDialog({ open: true, productId: product.id })}
                              className="border-red-600/50 text-red-900 dark:text-red-300 hover:bg-red-600 hover:text-white" 
                              data-testid={`button-delete-${product.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          ))}

          {/* Tab Excluídos */}
          <TabsContent value="deleted" className="mt-6">
            {loading ? (
              <div className="text-center py-8">
                <p className="text-brand-muted-foreground">Carregando produtos excluídos...</p>
              </div>
            ) : filteredDeletedProducts.length === 0 ? (
              <Card className="bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20 shadow-card">
                <CardContent className="p-8 text-center">
                  <Trash2 className="w-12 h-12 text-red-400 mx-auto mb-4" />
                  <p className="text-red-400">
                    {searchTerm ? 'Nenhum produto excluído encontrado para a busca' : 'Nenhum produto excluído'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {filteredDeletedProducts.map((product) => (
                  <Card key={product.id} className="bg-gray-950/30 border-red-600/30 opacity-70">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex gap-4 flex-1">
                          {product.imageUrl && (
                            <img
                              src={resolveImageUrl(product.imageUrl) || ''}
                              alt={product.title}
                              className="w-16 h-16 object-cover rounded-lg"
                            />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-lg text-orange-900 dark:text-orange-100">
                                {product.title}
                              </h3>
                              <Badge className="bg-red-500/20 text-red-300 border-red-500/30">
                                <Trash2 className="w-3 h-3 mr-1" />
                                Excluído
                              </Badge>
                              <Badge variant="outline" className="border-orange-600/50 text-orange-900 dark:text-orange-300">
                                {getProductTypeText(product.productType)}
                              </Badge>
                            </div>
                            
                            {product.description && (
                              <p className="text-orange-800 dark:text-orange-300 mb-2 line-clamp-2">
                                {product.description}
                              </p>
                            )}
                            
                            <div className="space-y-2">
                              <div className="flex items-center gap-4 text-sm text-gray-700 dark:text-gray-400">
                                <span>
                                  <strong className="text-gray-900 dark:text-gray-300">Seller:</strong> {product.sellerName || product.sellerEmail || 'N/A'}
                                </span>
                                <span>
                                  <strong className="text-gray-900 dark:text-gray-300">ID:</strong> {product.id}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Package className="w-3 h-3" />
                                  <strong>Total:</strong> {salesStats[product.id]?.total || 0}
                                </span>
                                <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500">
                                  <Clock className="w-3 h-3" />
                                  <strong>Pendentes:</strong> {salesStats[product.id]?.pending || 0}
                                </span>
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
                                  <CheckCircle className="w-3 h-3" />
                                  <strong>Pagos:</strong> {salesStats[product.id]?.paid || 0}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 ml-4">
                          <Badge variant="outline" className="border-red-600/50 text-red-600 dark:text-red-400">
                            <History className="w-3 h-3 mr-1" />
                            Histórico Mantido
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog de Deletar Produto */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, productId: null })}>
        <AlertDialogContent className="bg-red-950 border-red-600/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-100 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Deletar Produto Permanentemente
            </AlertDialogTitle>
            <AlertDialogDescription className="text-red-200">
              <strong>AÇÃO IRREVERSÍVEL</strong> - Ao deletar este produto:
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li><strong>O produto será deletado</strong> (não apenas bloqueado)</li>
                <li><strong>TODOS os checkouts vinculados</strong> serão deletados</li>
                <li><strong>Todas as aulas e módulos</strong> serão apagados</li>
                <li><strong>Todos os arquivos no Bunny CDN</strong> (vídeos, imagens) serão deletados</li>
                <li className="text-[#2563eb]"><strong>Histórico financeiro PRESERVADO</strong> (vendas, saldos, transações)</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-red-900 text-red-100 hover:bg-red-800">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteProduct}
              className="bg-red-600 text-white hover:bg-red-700"
              data-testid="button-confirm-delete"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Sim, Deletar Tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de Aprovação */}
      <AlertDialog open={approveDialog.open} onOpenChange={(open) => setApproveDialog({ open, productId: null })}>
        <AlertDialogContent className="bg-emerald-950 border-emerald-600/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-100">Confirmar Exclusão do Produto</AlertDialogTitle>
            <AlertDialogDescription className="text-[#2563eb]">
              Esta ação é <strong>IRREVERSÍVEL</strong>. Ao aprovar:
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>O produto serarquivado (active=false)</li>
                <li><strong>TODOS os checkouts</strong> serão deletados</li>
                <li>Módulos e aulas serão arquivados</li>
                <li>Acessos de membros serão revogados</li>
                <li> <strong>Histórico financeiro serPRESERVADO</strong> (orders, transações, saldos)</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-emerald-900 text-emerald-100 hover:bg-[#f0f4ff]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleApproveDeletion}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              data-testid="button-confirm-approve"
            >
              <CheckCheck className="w-4 h-4 mr-2" />
              Sim, Aprovar Exclusão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de Rejeio */}
      <AlertDialog open={rejectionDialog.open} onOpenChange={(open) => setRejectionDialog({ open, productId: null, reason: '' })}>
        <AlertDialogContent className="bg-emerald-950 border-emerald-600/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-100">Rejeitar Solicitação de Exclusão</AlertDialogTitle>
            <AlertDialogDescription className="text-[#2563eb]">
              Digite o motivo da rejeio para notificar o seller:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Ex: Produto possui pedidos ativos e não pode ser deletado no momento..."
            value={rejectionDialog.reason}
            onChange={(e) => setRejectionDialog({ ...rejectionDialog, reason: e.target.value })}
            className="bg-emerald-900/30 border-emerald-600/50 text-emerald-100 placeholder-emerald-400 min-h-[100px]"
            data-testid="textarea-rejection-reason"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-emerald-900 text-emerald-100 hover:bg-[#f0f4ff]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleRejectDeletion}
              className="bg-red-600 text-white hover:bg-red-700"
              data-testid="button-confirm-reject"
            >
              <Ban className="w-4 h-4 mr-2" />
              Rejeitar Exclusão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={hideShowcaseDialog.open} onOpenChange={(open) => setHideShowcaseDialog({ open, productId: null, isHidden: false })}>
        <AlertDialogContent className="bg-emerald-950 border-emerald-600/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-100">
              {hideShowcaseDialog.isHidden ? 'Mostrar na Vitrine' : 'Ocultar da Vitrine'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#2563eb]">
              {hideShowcaseDialog.isHidden 
                ? 'Este produto voltará a aparecer na vitrine pública do marketplace.'
                : 'Este produto será removido da vitrine pública do marketplace. Os checkouts e vendas continuarão funcionando normalmente.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-emerald-900 text-emerald-100 hover:bg-[#f0f4ff]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleHideFromShowcase}
              className={hideShowcaseDialog.isHidden ? "bg-blue-600 text-white hover:bg-green-700" : "bg-orange-600 text-white hover:bg-orange-700"}
              data-testid="button-confirm-hide-showcase"
            >
              {hideShowcaseDialog.isHidden ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
              {hideShowcaseDialog.isHidden ? 'Mostrar na Vitrine' : 'Ocultar da Vitrine'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
