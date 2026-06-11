import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, SlidersHorizontal, Eye, Download, FileText, Loader2, TrendingUp, TrendingDown, ShoppingCart, RotateCcw, AlertCircle, MoreVertical, X, Package, Users, Copy, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useQuery } from "@tanstack/react-query";
import { useTenantStore } from "@/stores/tenant";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";

interface Order {
  id: string;
  customer?: {
    name: string;
    email: string;
    cpf?: string;
    document?: string;
    phone?: string;
    ip?: string;
    address?: {
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
  checkoutSnapshot?: {
    title: string;
    productId?: string;
    productName?: string;
    offerId?: string;
    offerName?: string;
  };
  checkoutId?: string;
  productId?: string;
  productName?: string;
  offerId?: string;
  offerName?: string;
  checkoutTitle?: string;
  checkoutDeleted?: boolean;
  amount: number;
  netAmount?: number;
  gatewayFee?: number;
  platformFee?: number;
  sellerNetAmount?: number;
  financialData?: {
    netAmount?: number;
    gatewayFee?: number;
    platformFee?: number;
    grossAmount?: number;
    fees?: number;
    currency?: string;
    feeBreakdown?: {
      fixedFee?: number;
      percentFee?: number;
      percentAmount?: number;
      platformFeePercent?: number;
      platformFeeAmount?: number;
      releaseDays?: number;
    };
    feeSnapshot?: {
      gatewayFeePercent?: number;
      platformFeePercent?: number;
      releaseDays?: number;
    };
    releaseDate?: any;
    released?: boolean;
  };
  feeSnapshot?: {
    gatewayFeePercent?: number;
    platformFeePercent?: number;
    releaseDays?: number;
    gatewayFee?: number;
    platformFee?: number;
    netAmount?: number;
  };
  status: string;
  method?: string;
  paymentMethod?: string;
  gateway?: string;
  processor?: string;
  txId?: string;
  saleType?: string;
  type?: string;
  createdAt: any;
  paidAt?: any;
  tenantId: string;
  productType?: 'digital' | 'subscription';
  chargebackAt?: any;
  chargebackReason?: string;
  refundedAt?: any;
  refundReason?: string;
  refundAmount?: number;
  affiliateCommission?: {
    amount: number;
    percentage: number;
    code?: string;
    affiliateId?: string;
  } | number;
  isAffiliateSale?: boolean;
  affiliateUid?: string;
  affiliateCode?: string;
  affiliateName?: string;
  affiliateEmail?: string;
  orderBumps?: Array<{
    checkoutId: string;
    title: string;
    price: number;
  }>;
  currency?: string;
  isMyAffiliateSale?: boolean;
  isUpsell?: boolean;
  isDownsell?: boolean;
  sellerName?: string;
  installments?: number;
  financial?: {
    sellerCreditAmount?: number;
    affiliateCommissionAmount?: number;
    balanceType?: string;
    released?: boolean;
    releasedAt?: any;
    releaseDate?: any;
    releaseDays?: number;
    netAmount?: number;
    gatewayFee?: number;
    gatewayFeePercent?: number;
    platformFee?: number;
    platformFeePercent?: number;
    currency?: string;
    feeSnapshot?: {
      gatewayFeePercent?: number;
      platformFeePercent?: number;
      releaseDays?: number;
    };
  };
}

type TransactionFilter = 'todas' | 'entrada' | 'saida' | 'vendas' | 'reembolsos' | 'chargeback';
type ProductTypeFilter = 'todos' | 'digitais' | 'assinaturas';
type SaleKindFilter = 'todos' | 'normal' | 'upsell' | 'downsell' | 'orderbump' | 'afiliado' | 'qrcode';
type ViewMode = 'seller' | 'affiliate';

export default function SalesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('todas');
  const [productTypeFilter, setProductTypeFilter] = useState<ProductTypeFilter>('todos');
  const [productFilter, setProductFilter] = useState<string>('todos');
  const [offerFilter, setOfferFilter] = useState<string>('todos');
  const [saleKindFilter, setSaleKindFilter] = useState<SaleKindFilter>('todos');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [showValues, setShowValues] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<'hoje' | 'ontem' | '7dias' | '15dias' | '30dias' | '60dias' | '90dias' | 'total'>('total');
  const [viewMode, setViewMode] = useState<ViewMode>('seller');
  const { tenant } = useTenantStore();
  const { user } = useAuthStore();
  
  // Verificar se é admin usando customClaims do Firebase
  useEffect(() => {
    const checkAdmin = async () => {
      if (!auth.currentUser) {
        setIsAdmin(false);
        setAdminCheckComplete(true);
        return;
      }
      
      try {
        const tokenResult = await auth.currentUser.getIdTokenResult();
        const adminStatus = tokenResult.claims.admin === true;
        setIsAdmin(adminStatus);
        setAdminCheckComplete(true);
      } catch (error) {
        console.error('Erro ao verificar admin status:', error);
        setIsAdmin(false);
        setAdminCheckComplete(true);
      }
    };
    
    checkAdmin();
  }, [user]);
  
  const { data: response, isLoading } = useQuery<{ data: Order[], pagination: any }>({
    queryKey: isAdmin 
      ? ["/api/orders?limit=9999"] 
      : [`/api/orders?tenantId=${tenant?.id}&limit=9999`],
    enabled: adminCheckComplete && (isAdmin || !!tenant?.id) && viewMode === 'seller',
  });

  const { data: affiliateResponse, isLoading: isLoadingAffiliate } = useQuery<{ data: Order[] }>({
    queryKey: ["/api/affiliate/my-orders"],
    enabled: adminCheckComplete && !!user?.uid && viewMode === 'affiliate',
  });

  // 📦 BUSCAR PRODUTOS DIGITAIS REAIS DO FIRESTORE
  const { data: digitalProductsResponse } = useQuery<{ products: Array<{ id: string; name: string }> }>({
    queryKey: isAdmin 
      ? ["/api/products?productType=digital&limit=9999"] 
      : [`/api/products?productType=digital&tenantId=${tenant?.id}&limit=9999`],
    enabled: adminCheckComplete && (isAdmin || !!tenant?.id),
  });

  // 📦 BUSCAR PRODUTOS DE ASSINATURA REAIS DO FIRESTORE
  const { data: subscriptionProductsResponse } = useQuery<{ products: Array<{ id: string; name: string }> }>({
    queryKey: isAdmin 
      ? ["/api/products?productType=subscription&limit=9999"] 
      : [`/api/products?productType=subscription&tenantId=${tenant?.id}&limit=9999`],
    enabled: adminCheckComplete && (isAdmin || !!tenant?.id),
  });

  const rawOrders = viewMode === 'affiliate' ? (affiliateResponse?.data || []) : (response?.data || []);
  const orders = Array.isArray(rawOrders) ? rawOrders : [];
  const currentLoading = viewMode === 'affiliate' ? isLoadingAffiliate : isLoading;
  const realDigitalProducts = digitalProductsResponse?.products || [];
  const realSubscriptionProducts = subscriptionProductsResponse?.products || [];
  
  // ✅ MOSTRAR TODAS AS VENDAS: paid, approved, completed, pending
  // ❌ EXCLUIR APENAS: failed, cancelled, expired
  const activeOrders = orders.filter(order => 
    !['failed', 'cancelled', 'expired'].includes(order.status)
  );

  // 📅 FILTRO DE DATA
  const dateFilteredOrders = useMemo(() => {
    if (dateFilter === 'total') return activeOrders;
    
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    return activeOrders.filter(order => {
      let orderDate: Date;
      const dateField = order.paidAt || order.createdAt;
      
      if (dateField?._seconds) {
        orderDate = new Date(dateField._seconds * 1000);
      } else if (dateField?.seconds) {
        orderDate = new Date(dateField.seconds * 1000);
      } else if (typeof dateField === "string") {
        orderDate = new Date(dateField);
      } else if (dateField instanceof Date) {
        orderDate = dateField;
      } else {
        return false;
      }
      
      const diffDays = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
      
      switch (dateFilter) {
        case 'hoje':
          return orderDate >= startOfToday;
        case 'ontem':
          const startOfYesterday = new Date(startOfToday);
          startOfYesterday.setDate(startOfYesterday.getDate() - 1);
          return orderDate >= startOfYesterday && orderDate < startOfToday;
        case '7dias':
          return diffDays <= 7;
        case '15dias':
          return diffDays <= 15;
        case '30dias':
          return diffDays <= 30;
        case '60dias':
          return diffDays <= 60;
        case '90dias':
          return diffDays <= 90;
        default:
          return true;
      }
    });
  }, [activeOrders, dateFilter]);

  // 🎯 FILTRO DE TRANSAÇÃO COMBINADO COM useMemo
  const transactionFilteredOrders = useMemo(() => {
    if (transactionFilter === 'todas') return dateFilteredOrders;
    
    return dateFilteredOrders.filter(order => {
      switch (transactionFilter) {
        case 'entrada':
          // Vendas e receitas (paid, approved, completed, pending)
          return ['paid', 'approved', 'completed', 'pending'].includes(order.status);
        case 'saida':
          // Reembolsos e chargebacks (dinheiro que saiu)
          return ['refunded', 'chargeback'].includes(order.status);
        case 'vendas':
          // Apenas vendas concluídas
          return ['paid', 'approved', 'completed'].includes(order.status);
        case 'reembolsos':
          return order.status === 'refunded';
        case 'chargeback':
          return order.status === 'chargeback';
        default:
          return true;
      }
    });
  }, [dateFilteredOrders, transactionFilter]);

  // 🎯 FILTRO DE TIPO DE PRODUTO
  const productFilteredOrders = useMemo(() => {
    if (productTypeFilter === 'todos') return transactionFilteredOrders;
    
    return transactionFilteredOrders.filter(order => {
      const productType = order.productType;
      
      // Se productType não existe (dados legados), INCLUIR em TODOS os filtros para não perder dados
      if (!productType) return true;
      
      switch (productTypeFilter) {
        case 'digitais':
          return productType === 'digital';
        case 'assinaturas':
          return productType === 'subscription';
        default:
          return true;
      }
    });
  }, [transactionFilteredOrders, productTypeFilter]);

  // 📦 BUSCAR PRODUTOS ÚNICOS REAIS DO FIRESTORE com FALLBACK para dados legados
  const uniqueProducts = useMemo(() => {
    const productsMap = new Map<string, { id: string; name: string }>();
    
    // PRIORIDADE 1: Adicionar produtos REAIS do Firestore baseado no filtro de tipo
    if (productTypeFilter === 'digitais' || productTypeFilter === 'todos') {
      realDigitalProducts.forEach(p => {
        if (!productsMap.has(p.id)) {
          productsMap.set(p.id, { id: p.id, name: p.name });
        }
      });
    }
    
    if (productTypeFilter === 'assinaturas' || productTypeFilter === 'todos') {
      realSubscriptionProducts.forEach(p => {
        if (!productsMap.has(p.id)) {
          productsMap.set(p.id, { id: p.id, name: p.name });
        }
      });
    }
    
    // PRIORIDADE 2: FALLBACK - Adicionar produtos extraídos de TODOS os pedidos (dados legados)
    // Usar activeOrders (não filtrado por tipo) para capturar produtos deletados do Firestore
    // Aplicar filtro APENAS se productType estiver definido (para não excluir legados sem tipo)
    activeOrders.forEach(order => {
      const productType = order.productType;
      
      // Se filtro específico está ativo E productType existe, verificar match
      // Se productType não existe (dados legados), SEMPRE incluir para não perder dados
      if (productTypeFilter !== 'todos' && productType) {
        const matchesFilter = (productTypeFilter === 'digitais' && productType === 'digital') ||
                             (productTypeFilter === 'assinaturas' && productType === 'subscription');
        if (!matchesFilter) return;
      }
      
      const productId = order.checkoutSnapshot?.productId || order.productId || order.checkoutId;
      const productName = order.productName || order.checkoutSnapshot?.productName || 'Produto sem nome';
      
      // Só adicionar se ainda não existe (Firestore tem prioridade)
      if (productId && !productsMap.has(productId)) {
        productsMap.set(productId, { id: productId, name: productName });
      }
    });
    
    return Array.from(productsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [productTypeFilter, realDigitalProducts, realSubscriptionProducts, activeOrders]);

  // 🎁 EXTRAIR OFERTAS ÚNICAS DO PRODUTO SELECIONADO
  const uniqueOffers = useMemo(() => {
    if (productFilter === 'todos') return [];
    
    const offersMap = new Map<string, { id: string; name: string }>();
    
    productFilteredOrders
      .filter(order => {
        const productId = order.checkoutSnapshot?.productId || order.productId || order.checkoutId;
        return productId === productFilter;
      })
      .forEach(order => {
        // Priorizar offerId do snapshot, depois checkoutId
        const offerId = order.checkoutSnapshot?.offerId || order.offerId || order.checkoutId;
        // PRIORIZAR offerName top-level (normalizado pelo backend)
        const offerName = order.offerName || order.checkoutSnapshot?.offerName || 'Oferta padrão';
        
        if (offerId && !offersMap.has(offerId)) {
          offersMap.set(offerId, { id: offerId, name: offerName });
        }
      });
    
    return Array.from(offersMap.values());
  }, [productFilteredOrders, productFilter]);

  // 🔄 RESETAR FILTRO DE OFERTA QUANDO PRODUTO MUDAR
  useEffect(() => {
    setOfferFilter('todos');
  }, [productFilter]);

  // 🎯 FILTRO ESPECÍFICO DE PRODUTO
  const specificProductFilteredOrders = useMemo(() => {
    if (productFilter === 'todos') return productFilteredOrders;
    
    return productFilteredOrders.filter(order => {
      const productId = order.checkoutSnapshot?.productId || order.productId || order.checkoutId;
      return productId === productFilter;
    });
  }, [productFilteredOrders, productFilter]);

  // 🎁 FILTRO DE OFERTA
  const offerFilteredOrders = useMemo(() => {
    if (offerFilter === 'todos') return specificProductFilteredOrders;
    
    return specificProductFilteredOrders.filter(order => {
      const offerId = order.checkoutSnapshot?.offerId || order.offerId || order.checkoutId;
      return offerId === offerFilter;
    });
  }, [specificProductFilteredOrders, offerFilter]);

  // 🏷️ FILTRO POR TIPO DE VENDA
  const saleKindFilteredOrders = useMemo(() => {
    if (saleKindFilter === 'todos') return offerFilteredOrders;
    return offerFilteredOrders.filter(order => {
      switch (saleKindFilter) {
        case 'upsell':    return !!order.isUpsell;
        case 'downsell':  return !!order.isDownsell;
        case 'orderbump': return !!(order.orderBumps && order.orderBumps.length > 0);
        case 'afiliado':  return !!order.isAffiliateSale;
        case 'qrcode':    return order.saleType === 'pix_qrcode' || order.type === 'personal_sale';
        case 'normal':
          return !order.isUpsell && !order.isDownsell && !order.isAffiliateSale &&
                 !(order.orderBumps && order.orderBumps.length > 0) &&
                 order.saleType !== 'pix_qrcode' && order.type !== 'personal_sale';
        default: return true;
      }
    });
  }, [offerFilteredOrders, saleKindFilter]);

  // 🔍 FILTRO DE BUSCA (aplicado por último)
  const filteredOrders = useMemo(() => {
    if (!searchQuery) return saleKindFilteredOrders;
    
    const query = searchQuery.toLowerCase();
    return saleKindFilteredOrders.filter(order => 
      order.id.toLowerCase().includes(query) ||
      order.customer?.name?.toLowerCase().includes(query) ||
      order.customer?.email?.toLowerCase().includes(query) ||
      order.customer?.cpf?.toLowerCase().includes(query) ||
      order.checkoutSnapshot?.title?.toLowerCase().includes(query)
    );
  }, [saleKindFilteredOrders, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const paginatedOrders = useMemo(() =>
    filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredOrders, currentPage, PAGE_SIZE]
  );

  useEffect(() => { setCurrentPage(1); }, [searchQuery, dateFilter, transactionFilter, productTypeFilter]);

  const getAffiliateCommissionAmount = (order: Order) => {
    if (typeof order.affiliateCommission === 'number') return order.affiliateCommission;
    return order.affiliateCommission?.amount || 0;
  };

  const getAffiliateNetCommissionAmount = (order: Order) => {
    if ((order as any).affiliateCommissionNet) return (order as any).affiliateCommissionNet;
    return getAffiliateCommissionAmount(order);
  };

  const totalRevenue = filteredOrders
    .filter(order => ['paid', 'approved', 'completed', 'pending'].includes(order.status))
    .reduce((sum, order) => {
      if (viewMode === 'affiliate') return sum + getAffiliateCommissionAmount(order);
      return sum + (order.amount || 0);
    }, 0);
  
  const pendingRevenue = filteredOrders
    .filter(order => order.status === 'pending')
    .reduce((sum, order) => {
      if (viewMode === 'affiliate') return sum + getAffiliateCommissionAmount(order);
      return sum + (order.amount || 0);
    }, 0);
  
  const netRevenue = filteredOrders
    .filter(order => ['paid', 'approved', 'completed'].includes(order.status))
    .reduce((sum, order) => {
      if (viewMode === 'affiliate') return sum + getAffiliateNetCommissionAmount(order);
      const orderNetAmount = order.sellerNetAmount
        || order.netAmount 
        || order.financialData?.netAmount 
        || 0;
      return sum + orderNetAmount;
    }, 0);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(cents / 100);
  };

  const formatDate = (date: any) => {
    if (!date) return "-";
    let timestamp: Date;
    
    if (date._seconds) {
      timestamp = new Date(date._seconds * 1000);
    } else if (date.seconds) {
      timestamp = new Date(date.seconds * 1000);
    } else if (typeof date === "string") {
      timestamp = new Date(date);
    } else if (date instanceof Date) {
      timestamp = date;
    } else {
      return "-";
    }

    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  };

  const getPaymentMethodLabel = (method?: string, gateway?: string, processor?: string) => {
    if (!method) return "-";
    const m = method.toLowerCase();
    if (m === 'pix') return "PIX";
    if (m === 'boleto') return "Boleto";
    if (['credit_card', 'card', 'efibank_card', 'creditcard'].includes(m)) {
      const gw = (gateway || '').toLowerCase();
      const proc = (processor || '').toLowerCase();
      if (gw === 'stripe' || gw === 'adyen' || proc === 'stripe' || proc === 'adyen') return "Cartão Global";
      return "Cartão BR";
    }
    return method;
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      paid: "bg-blue-100 text-blue-800",
      approved: "bg-blue-100 text-blue-800",
      completed: "bg-blue-100 text-blue-800",
      pending: "bg-yellow-100 text-yellow-800",
      failed: "bg-red-100 text-red-800",
      cancelled: "bg-red-100 text-red-800",
      expired: "bg-gray-100 text-gray-800",
    };

    const labels: Record<string, string> = {
      paid: "Pago",
      approved: "Aprovado",
      completed: "Concluído",
      pending: "Pendente",
      failed: "Falhou",
      cancelled: "Cancelado",
      expired: "Expirado",
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || ""}`}>
        {labels[status] || status}
      </span>
    );
  };

  const getSaleTypeInfo = (order: Order): { label: string; className: string } => {
    if (order.isUpsell)   return { label: 'Upsell',    className: 'border-teal-500 text-teal-700 bg-teal-50' };
    if (order.isDownsell) return { label: 'Downsell',  className: 'border-yellow-500 text-yellow-700 bg-yellow-50' };
    if (order.orderBumps && order.orderBumps.length > 0)
                          return { label: `+${order.orderBumps.length} Bump${order.orderBumps.length > 1 ? 's' : ''}`, className: 'border-orange-500 text-orange-700 bg-orange-50' };
    if (order.isAffiliateSale)
                          return { label: 'Afiliado',  className: 'border-lime-500 text-[#2563eb] bg-[#f0f4ff]/20' };
    if (order.saleType === 'pix_qrcode' || order.type === 'personal_sale')
                          return { label: 'QR Code',   className: 'border-blue-500 text-blue-700 bg-blue-50' };
    return                       { label: 'Normal',    className: 'border-gray-300 text-gray-600 bg-gray-100' };
  };

  // 📤 FUNÇÃO DE EXPORTAÇÃO
  const exportToCSV = () => {
    const headers = ['ID', 'Produto', 'Comprador', 'Email', 'Data', 'Método', 'Valor', 'Status'];
    const rows = filteredOrders.map(order => [
      order.id,
      order.checkoutSnapshot?.title || order.checkoutTitle || '-',
      order.customer?.name || '-',
      order.customer?.email || '-',
      formatDate(order.paidAt || order.createdAt),
      getPaymentMethodLabel(order.method || order.paymentMethod, order.gateway, order.processor),
      formatCurrency(order.amount),
      order.status
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vendas_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // 📊 CARDS DE FILTRO DE TRANSAÇÃO (sincronizados com filtro de produto E busca)
  const transactionFilters: Array<{
    id: TransactionFilter;
    label: string;
    icon: any;
    color: string;
    count: number;
  }> = useMemo(() => {
    // Base de dados: dateFilteredOrders filtrado pelo tipo de produto E busca
    let baseOrders = dateFilteredOrders;
    
    // 1. Aplicar filtro de tipo de produto
    if (productTypeFilter !== 'todos') {
      baseOrders = baseOrders.filter(order => {
        const productType = order.productType || 'digital';
        switch (productTypeFilter) {
          case 'digitais': return productType === 'digital';
          case 'assinaturas': return productType === 'subscription';
          default: return true;
        }
      });
    }
    
    // 2. Aplicar filtro de busca
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      baseOrders = baseOrders.filter(order =>
        order.id.toLowerCase().includes(query) ||
        order.customer?.name?.toLowerCase().includes(query) ||
        order.customer?.email?.toLowerCase().includes(query) ||
        order.customer?.cpf?.toLowerCase().includes(query) ||
        order.checkoutSnapshot?.title?.toLowerCase().includes(query)
      );
    }
    
    const countByFilter = (filter: TransactionFilter) => {
      if (filter === 'todas') return baseOrders.length;
      
      return baseOrders.filter(order => {
        switch (filter) {
          case 'entrada':
            return ['paid', 'approved', 'completed', 'pending'].includes(order.status);
          case 'saida':
            return ['refunded', 'chargeback'].includes(order.status);
          case 'vendas':
            return ['paid', 'approved', 'completed'].includes(order.status);
          case 'reembolsos':
            return order.status === 'refunded';
          case 'chargeback':
            return order.status === 'chargeback';
          default:
            return true;
        }
      }).length;
    };

    return [
      { id: 'todas', label: 'Todas', icon: FileText, color: 'blue', count: countByFilter('todas') },
      { id: 'entrada', label: 'Entrada', icon: TrendingUp, color: 'lime', count: countByFilter('entrada') },
      { id: 'saida', label: 'Saída', icon: TrendingDown, color: 'red', count: countByFilter('saida') },
      { id: 'vendas', label: 'Vendas', icon: ShoppingCart, color: 'lime', count: countByFilter('vendas') },
    ];
  }, [dateFilteredOrders, productTypeFilter, searchQuery]);

  const statsCards = [
    {
      title: viewMode === 'affiliate' ? "Comissoes" : "Faturamento",
      value: formatCurrency(totalRevenue),
    },
    {
      title: "Pendente",
      value: formatCurrency(pendingRevenue),
    },
    {
      title: viewMode === 'affiliate' ? "Comissao liquida" : "Receita líquida",
      value: formatCurrency(netRevenue),
    },
    {
      title: "Total",
      value: filteredOrders.length.toString(),
    },
  ];

  
  // 🔍 QUERY PARA BUSCAR DETALHES DA ORDER
  const { data: orderDetails, isLoading: isLoadingDetails } = useQuery<Order>({
    queryKey: [`/api/orders/${selectedOrderId}`],
    enabled: !!selectedOrderId && isDetailsDialogOpen,
  });

  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6 p-3 md:p-6">
        {/* Toggle Vendedor / Afiliado */}
        {!isAdmin && (
          <div className="flex gap-2" data-testid="view-mode-toggle">
            <Button
              variant={viewMode === 'seller' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('seller')}
              className={viewMode === 'seller' ? 'bg-[#2563eb] text-black border-[#2563eb]' : ''}
              data-testid="button-view-seller"
            >
              <ShoppingCart className="h-4 w-4 mr-1" />
              Minhas Vendas
            </Button>
            <Button
              variant={viewMode === 'affiliate' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('affiliate')}
              className={viewMode === 'affiliate' ? 'bg-[#2563eb] text-black border-[#2563eb]' : ''}
              data-testid="button-view-affiliate"
            >
              <Users className="h-4 w-4 mr-1" />
              Vendas como Afiliado
            </Button>
          </div>
        )}

        {/* Cards de Estatísticas */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3 lg:gap-4">
          {statsCards.map((stat, index) => (
            <Card key={index} className="bg-white shadow-card">
              <CardContent className="p-3 md:p-6">
                <h3 className="text-xs md:text-sm font-medium text-gray-600 mb-1 md:mb-2 truncate">
                  {stat.title}
                </h3>
                <p className="text-xl md:text-3xl font-bold text-gray-900 truncate">
                  {showValues ? stat.value : '••••••'}
                </p>
                <div className="mt-2 md:mt-4 h-1 bg-gradient-to-r from-[#2563eb] to-[#1d4ed8] rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Barra de Busca, Filtro de Produtos e Ações */}
        <div className="flex flex-col gap-2 md:gap-3">
          {/* Linha 1: Busca + Ações */}
          <div className="flex gap-2 items-center flex-wrap w-full">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Buscar por CPF, ID ou nome"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white border-gray-200"
                data-testid="input-search-sales"
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <DropdownMenu open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="bg-white border-gray-200"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-white border-gray-200">
                  <DropdownMenuItem onClick={() => setDateFilter('hoje')} className={dateFilter === 'hoje' ? 'bg-gray-100' : ''}>
                    Hoje
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDateFilter('ontem')} className={dateFilter === 'ontem' ? 'bg-gray-100' : ''}>
                    Ontem
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDateFilter('7dias')} className={dateFilter === '7dias' ? 'bg-gray-100' : ''}>
                    7 dias
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDateFilter('15dias')} className={dateFilter === '15dias' ? 'bg-gray-100' : ''}>
                    15 dias
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDateFilter('30dias')} className={dateFilter === '30dias' ? 'bg-gray-100' : ''}>
                    30 dias
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDateFilter('60dias')} className={dateFilter === '60dias' ? 'bg-gray-100' : ''}>
                    60 dias
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDateFilter('90dias')} className={dateFilter === '90dias' ? 'bg-gray-100' : ''}>
                    90 dias
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDateFilter('total')} className={dateFilter === 'total' ? 'bg-gray-100' : ''}>
                    Total
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowValues(!showValues)}
                className="bg-white border-gray-200"
                title={showValues ? "Ocultar valores" : "Mostrar valores"}
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={exportToCSV}
                className="bg-white border-gray-200"
                title="Exportar para CSV"
                data-testid="button-export-csv"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Linha 2: Filtro de Tipo + Produto */}
          <div className="flex flex-col gap-2 items-start">
            <Tabs value={productTypeFilter} onValueChange={(value) => setProductTypeFilter(value as ProductTypeFilter)}>
              <TabsList className="bg-white border border-gray-200 w-full flex-wrap h-auto">
                <TabsTrigger value="todos" className="text-xs sm:text-sm">Todos</TabsTrigger>
                <TabsTrigger value="digitais" className="text-xs sm:text-sm">Digitais</TabsTrigger>
                <TabsTrigger value="assinaturas" className="text-xs sm:text-sm">Assinaturas</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex gap-2 flex-wrap w-full sm:w-auto">
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className="w-full sm:w-48 bg-white border-gray-200">
                  <SelectValue placeholder="Produto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os produtos</SelectItem>
                  {uniqueProducts.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {productFilter !== 'todos' && uniqueOffers.length > 0 && (
                <Select value={offerFilter} onValueChange={setOfferFilter}>
                  <SelectTrigger className="w-full sm:w-48 bg-white border-gray-200">
                    <SelectValue placeholder="Oferta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas as ofertas</SelectItem>
                    {uniqueOffers.map((offer) => (
                      <SelectItem key={offer.id} value={offer.id}>
                        {offer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={saleKindFilter} onValueChange={(v) => setSaleKindFilter(v as SaleKindFilter)}>
                <SelectTrigger className="w-full sm:w-44 bg-white border-gray-200">
                  <SelectValue placeholder="Tipo de venda" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os tipos</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="orderbump">Com Order Bump</SelectItem>
                  <SelectItem value="upsell">Upsell</SelectItem>
                  <SelectItem value="downsell">Downsell</SelectItem>
                  <SelectItem value="afiliado">Via Afiliado</SelectItem>
                  <SelectItem value="qrcode">QR Code / Pessoal</SelectItem>
                </SelectContent>
              </Select>

              {(productFilter !== 'todos' || offerFilter !== 'todos' || saleKindFilter !== 'todos') && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setProductFilter('todos');
                    setOfferFilter('todos');
                    setSaleKindFilter('todos');
                  }}
                  className="bg-white border border-gray-200"
                  title="Limpar filtros"
                  data-testid="button-clear-filters"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Lista de Vendas - Mobile (Cards) */}
        <div className="md:hidden space-y-3">
          {currentLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20">
              <div className="mb-4 p-4 bg-gray-100 rounded-full">
                <FileText className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-base font-medium text-gray-900">
                Nenhuma venda registrada
              </p>
            </div>
          ) : (
            paginatedOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                className="w-full text-left"
                onClick={() => {
                  setSelectedOrderId(order.id);
                  setIsDetailsDialogOpen(true);
                }}
                data-testid={`button-order-mobile-${order.id}`}
              >
                <Card className="bg-white shadow-card">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate" data-testid={`text-product-mobile-${order.id}`}>
                          {order.productName || order.checkoutSnapshot?.productName || order.checkoutSnapshot?.title || order.checkoutTitle || "-"}
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          {order.customer?.name || "-"} &middot; {order.customer?.email || "-"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-sm text-gray-900" data-testid={`text-value-mobile-${order.id}`}>
                          {showValues ? formatCurrency(order.amount) : '••••••'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        {getStatusBadge(order.status)}
                        {(() => {
                          const kt = getSaleTypeInfo(order);
                          return (
                            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${kt.className}`}>
                              {kt.label}
                            </Badge>
                          );
                        })()}
                        {order.productType && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-gray-300 text-gray-600">
                            {order.productType === 'subscription' ? 'Assinatura' : 'Digital'}
                          </Badge>
                        )}
                        {viewMode === 'affiliate' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-cyan-500 text-cyan-700 bg-cyan-50">
                            {order.sellerName || 'Produtor'}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
                        <span>{getPaymentMethodLabel(order.method || order.paymentMethod, order.gateway, order.processor)}</span>
                        <span>&middot;</span>
                        <span>{formatDate(order.paidAt || order.createdAt)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))
          )}
        </div>

        {/* Paginação - Mobile */}
        {filteredOrders.length > 0 && (
          <div className="flex items-center justify-between px-1 py-2 md:hidden">
            <span className="text-xs text-gray-500">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredOrders.length)} de {filteredOrders.length}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium px-1">{currentPage}/{totalPages}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Tabela de Vendas - Desktop */}
        <Card className="bg-white shadow-card hidden md:block">
          <CardContent className="p-0">
            <div className="w-full">
              <table className="w-full table-fixed">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="w-[10%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">ID</th>
                    <th className="w-[22%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Produto(s)</th>
                    <th className="w-[8%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden xl:table-cell">Tipo</th>
                    <th className="w-[18%] xl:w-[14%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Comprador</th>
                    <th className="w-[10%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden xl:table-cell">{viewMode === 'affiliate' ? "Produtor" : "Vendedor"}</th>
                    <th className="w-[13%] xl:w-[11%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Data</th>
                    <th className="w-[10%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Método</th>
                    <th className="w-[10%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Valor</th>
                    <th className="w-[10%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="w-[7%] px-2 lg:px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {currentLoading ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-20">
                        <div className="flex items-center justify-center">
                          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                        </div>
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-20">
                        <div className="flex flex-col items-center justify-center text-center">
                          <div className="mb-4 p-4 bg-gray-100 rounded-full">
                            <FileText className="h-8 w-8 text-gray-400" />
                          </div>
                          <p className="text-base font-medium text-gray-900">
                            Nenhuma venda registrada
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-2 lg:px-3 py-3 text-xs text-gray-900 font-mono truncate">
                          {order.id.substring(0, 10)}...
                        </td>
                        <td className="px-2 lg:px-3 py-3 text-xs text-gray-900">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium truncate block">{order.productName || order.checkoutSnapshot?.productName || order.checkoutSnapshot?.title || order.checkoutTitle || "-"}</span>
                            {order.productType && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-gray-300 text-gray-600 w-fit">
                                {order.productType === 'subscription' ? 'Assin.' : 'Digital'}
                              </Badge>
                            )}
                            {order.checkoutSnapshot?.offerName && order.checkoutSnapshot.offerName !== 'Oferta padrão' && (
                              <span className="text-[9px] text-gray-400 truncate block">{order.checkoutSnapshot.offerName}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 lg:px-3 py-3 text-xs text-gray-900 hidden xl:table-cell">
                          {(() => {
                            const kt = getSaleTypeInfo(order);
                            return (
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${kt.className}`}>
                                {kt.label}
                              </Badge>
                            );
                          })()}
                        </td>
                        <td className="px-2 lg:px-3 py-3 text-xs text-gray-900">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{order.customer?.name || "-"}</div>
                            <div className="text-[10px] text-gray-400 truncate">{order.customer?.email || "-"}</div>
                          </div>
                        </td>
                        <td className="px-2 lg:px-3 py-3 text-xs text-gray-900 hidden xl:table-cell">
                          {viewMode === 'affiliate' ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-cyan-400 font-medium truncate">{order.sellerName || 'Vendedor'}</span>
                              <span className="text-[9px] text-gray-400">Produtor</span>
                            </div>
                          ) : order.isAffiliateSale ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[#2563eb] font-medium truncate">{order.affiliateName || order.affiliateEmail?.split('@')[0] || 'Afiliado'}</span>
                              {order.affiliateEmail && (
                                <span className="text-[9px] text-gray-400 truncate">{order.affiliateEmail}</span>
                              )}
                              <span className="text-[9px] text-[#2563eb]/60">Afiliado</span>
                            </div>
                          ) : (
                            <span>Você</span>
                          )}
                        </td>
                        <td className="px-2 lg:px-3 py-3 text-xs text-gray-900">
                          <div className="leading-tight">
                            {formatDate(order.paidAt || order.createdAt).split(',').map((part, i) => (
                              <div key={i}>{part.trim()}</div>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 lg:px-3 py-3 text-xs text-gray-900">
                          <div className="flex flex-col gap-0.5">
                            <span className="truncate">{getPaymentMethodLabel(order.method || order.paymentMethod, order.gateway, order.processor)}</span>
                            {(order.saleType === 'pix_qrcode' || order.type === 'personal_sale') && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-blue-500 text-blue-700 bg-blue-50 w-fit">QR</Badge>
                            )}
                            {order.saleType === 'pix_checkout' && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-blue-500 text-blue-700 bg-blue-50 w-fit">Checkout</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-2 lg:px-3 py-3 text-xs font-medium text-gray-900">
                          {showValues ? (
                            viewMode === 'affiliate' ? (
                              <div className="flex flex-col">
                                <span className="text-[#2563eb]">{formatCurrency(getAffiliateCommissionAmount(order))}</span>
                                <span className="text-[9px] text-gray-400">de {formatCurrency(order.amount)}</span>
                              </div>
                            ) : formatCurrency(order.amount)
                          ) : '••••••'}
                        </td>
                        <td className="px-2 lg:px-3 py-3">
                          {getStatusBadge(order.status)}
                        </td>
                        <td className="px-2 lg:px-3 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-white border-gray-200">
                              <DropdownMenuItem 
                                onClick={() => {
                                  setSelectedOrderId(order.id);
                                  setIsDetailsDialogOpen(true);
                                }}
                                className="cursor-pointer"
                              >
                                <Eye className="h-4 w-4 mr-2" />
                                Ver detalhes
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Paginação - Desktop */}
        {filteredOrders.length > 0 && (
          <div className="hidden md:flex items-center justify-between px-2 py-3">
            <span className="text-sm text-gray-500">
              Mostrando {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredOrders.length)} de {filteredOrders.length} vendas
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-gray-400 text-sm">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === currentPage ? 'default' : 'outline'}
                      size="icon"
                      className="h-8 w-8 text-sm"
                      onClick={() => setCurrentPage(p as number)}
                    >
                      {p}
                    </Button>
                  )
                )}
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* DIALOG DE DETALHES DA VENDA */}
        <Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
          <DialogContent className="sm:max-w-2xl bg-white border-gray-200 max-h-[90vh] flex flex-col">
            <DialogHeader className="pb-2 shrink-0">
              <DialogTitle className="text-lg font-bold text-gray-900">
                Detalhes da Venda
              </DialogTitle>
              <DialogDescription className="text-xs">
                Informações completas da transação
              </DialogDescription>
            </DialogHeader>
            
            {isLoadingDetails ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : orderDetails ? (() => {
              const fin = orderDetails.financial;
              const fb = orderDetails.financialData?.feeBreakdown;
              const grossAmount = orderDetails.amount || 0;

              // Percentages (typically stored correctly)
              const gwPercent = fin?.gatewayFeePercent ?? fin?.feeSnapshot?.gatewayFeePercent ?? orderDetails.feeSnapshot?.gatewayFeePercent ?? orderDetails.financialData?.feeSnapshot?.gatewayFeePercent ?? 0;
              const ptPercent = fin?.platformFeePercent ?? fin?.feeSnapshot?.platformFeePercent ?? orderDetails.feeSnapshot?.platformFeePercent ?? orderDetails.financialData?.feeSnapshot?.platformFeePercent ?? orderDetails.financialData?.feeBreakdown?.platformFeePercent ?? 0;

              // Raw stored fee values
              const rawGwFee = fin?.gatewayFee ?? orderDetails.gatewayFee ?? orderDetails.financialData?.gatewayFee ?? 0;
              const rawPtFee = fin?.platformFee ?? orderDetails.platformFee ?? orderDetails.financialData?.platformFee ?? 0;

              // Breakdown values (fixedFee + percentAmount) - most precise when available
              const breakdownFixed = fb?.fixedFee ?? 0;
              const breakdownPct   = fb?.percentAmount ?? 0;
              const breakdownGwFee = (breakdownFixed > 0 || breakdownPct > 0)
                ? parseFloat((breakdownFixed + breakdownPct).toFixed(2))
                : 0;

              // Validated gwFee: use breakdown > valid raw > compute from percent
              // A fee >= grossAmount is clearly wrong (e.g. stored as gross+fee instead of fee)
              const gwFee = (breakdownGwFee > 0 && breakdownGwFee < grossAmount)
                ? breakdownGwFee
                : (rawGwFee > 0 && rawGwFee < grossAmount)
                ? rawGwFee
                : (gwPercent > 0 ? parseFloat((grossAmount * gwPercent / 100).toFixed(2)) : 0);

              // Validated ptFee
              const ptFee = (rawPtFee > 0 && rawPtFee < grossAmount)
                ? rawPtFee
                : (ptPercent > 0 ? parseFloat((grossAmount * ptPercent / 100).toFixed(2)) : 0);

              const totalFees = parseFloat((gwFee + ptFee).toFixed(2));

              // Validated realNet: negative or > grossAmount means stored value is wrong
              const rawRealNet = orderDetails.sellerNetAmount ?? fin?.netAmount ?? orderDetails.netAmount ?? orderDetails.financialData?.netAmount ?? null;
              const realNet = (rawRealNet !== null && rawRealNet >= 0 && rawRealNet <= grossAmount)
                ? rawRealNet
                : parseFloat((grossAmount - totalFees).toFixed(2));
              const releaseDays = fin?.releaseDays ?? orderDetails.feeSnapshot?.releaseDays ?? orderDetails.financialData?.feeBreakdown?.releaseDays ?? orderDetails.financialData?.feeSnapshot?.releaseDays ?? 0;
              const releaseDate = fin?.releaseDate ? new Date(fin.releaseDate) : null;
              const isReleased = fin?.released ?? false;
              const balanceType = fin?.balanceType || null;
              const sellerCredit = fin?.sellerCreditAmount ?? null;
              const affCommAmt = fin?.affiliateCommissionAmount ?? null;
              const method = orderDetails.method || orderDetails.paymentMethod || '';
              const productName = orderDetails.productName || orderDetails.checkoutSnapshot?.productName || orderDetails.checkoutSnapshot?.title || orderDetails.checkoutTitle || 'Produto';
              const checkoutName = orderDetails.checkoutSnapshot?.title || orderDetails.checkoutTitle || '';
              const productTypePT = orderDetails.productType === 'subscription' ? 'Assinatura' : 'Digital';
              const isCard = method === 'card' || method === 'credit_card';
              const saleTypeLabel = orderDetails.saleType === 'pix_qrcode' ? 'PIX QR Code' : orderDetails.saleType === 'pix_checkout' ? 'PIX Checkout' : orderDetails.saleType === 'card_checkout' ? 'Cartão Checkout' : orderDetails.type === 'personal_sale' ? 'Venda Pessoal' : null;

              return (
                <div className="overflow-y-auto flex-1 -mx-1 px-1">
                <div className="space-y-3 pb-2">
                  {/* TAGS DE CATEGORIA */}
                  <div className="flex items-center gap-1.5 flex-wrap" data-testid="order-tags">
                    <Badge variant="outline" className="text-xs border-gray-400">
                      <Package className="w-3 h-3 mr-1" />
                      {productTypePT}
                    </Badge>
                    <Badge variant="outline" className={`text-xs ${
                      ['paid', 'approved', 'completed'].includes(orderDetails.status) 
                        ? 'border-blue-500 text-blue-700 bg-blue-50' 
                        : orderDetails.status === 'pending' 
                        ? 'border-yellow-500 text-yellow-700 bg-yellow-50'
                        : orderDetails.status === 'refunded' || orderDetails.status === 'chargeback'
                        ? 'border-red-500 text-red-700 bg-red-50'
                        : 'border-gray-400'
                    }`}>
                      {orderDetails.status === 'paid' ? 'Pago' : orderDetails.status === 'approved' ? 'Aprovado' : orderDetails.status === 'completed' ? 'Concluido' : orderDetails.status === 'pending' ? 'Pendente' : orderDetails.status === 'refunded' ? 'Reembolsado' : orderDetails.status === 'chargeback' ? 'Chargeback' : orderDetails.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs border-gray-400">
                      {method === 'pix' ? 'PIX' : method === 'boleto' ? 'Boleto' : ['credit_card', 'card', 'efibank_card', 'creditcard'].includes(method.toLowerCase()) ? ((['stripe', 'adyen'].includes((orderDetails.gateway || '').toLowerCase()) || ['stripe', 'adyen'].includes((orderDetails.processor || '').toLowerCase())) ? 'Cartão Global' : 'Cartão BR') : method || '-'}
                    </Badge>
                    {saleTypeLabel && (
                      <Badge variant="outline" className="text-xs border-blue-400 text-blue-600 bg-blue-50">
                        {saleTypeLabel}
                      </Badge>
                    )}
                    {isCard && orderDetails.installments && orderDetails.installments > 1 && (
                      <Badge variant="outline" className="text-xs border-lime-400 text-[#2563eb] bg-blue-50">
                        {orderDetails.installments}x
                      </Badge>
                    )}
                    {orderDetails.isUpsell && (
                      <Badge variant="outline" className="text-xs border-teal-500 text-teal-600 bg-teal-50">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        Upsell
                      </Badge>
                    )}
                    {orderDetails.isDownsell && (
                      <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600 bg-yellow-50">
                        <TrendingDown className="w-3 h-3 mr-1" />
                        Downsell
                      </Badge>
                    )}
                    {orderDetails.isAffiliateSale && (
                      <Badge variant="outline" className="text-xs border-[#2563eb] text-[#2563eb] bg-blue-50">
                        <Users className="w-3 h-3 mr-1" />
                        Via Afiliado
                      </Badge>
                    )}
                    {orderDetails.orderBumps && orderDetails.orderBumps.length > 0 && (
                      <Badge variant="outline" className="text-xs border-orange-500 text-orange-600 bg-orange-50">
                        <ShoppingCart className="w-3 h-3 mr-1" />
                        +{orderDetails.orderBumps.length} Bump{orderDetails.orderBumps.length > 1 ? 's' : ''}
                      </Badge>
                    )}
                    {balanceType && (
                      <Badge variant="outline" className={`text-xs ${balanceType === 'pending' ? 'border-yellow-400 text-yellow-600 bg-yellow-50' : 'border-lime-400 text-[#2563eb] bg-blue-50'}`}>
                        {isReleased ? 'Liberado' : balanceType === 'pending' ? 'Pendente' : 'Disponível'}
                      </Badge>
                    )}
                  </div>

                  {/* PRODUTO + CHECKOUT */}
                  <div className="bg-gray-50 rounded-lg p-3" data-testid="order-product">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs">Produto</span>
                        <p className="font-medium text-gray-900">{productName}</p>
                      </div>
                      {checkoutName && checkoutName !== productName && (
                        <div>
                          <span className="text-gray-500 text-xs">Checkout / Oferta</span>
                          <p className="font-medium text-gray-900">{checkoutName}</p>
                        </div>
                      )}
                      {orderDetails.checkoutSnapshot?.offerName && orderDetails.checkoutSnapshot.offerName !== checkoutName && (
                        <div>
                          <span className="text-gray-500 text-xs">Nome da Oferta</span>
                          <p className="font-medium text-gray-900">{orderDetails.checkoutSnapshot.offerName}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* COMPRADOR - COMPACTO */}
                  <div className="bg-gray-50 rounded-lg p-3" data-testid="order-buyer">
                    <span className="text-gray-500 text-xs font-medium">Comprador</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs">Nome</span>
                        <p className="font-medium text-gray-900">{orderDetails.customer?.name || '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Email</span>
                        <p className="font-medium text-gray-900 text-xs break-all">{orderDetails.customer?.email || '-'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">CPF</span>
                        <p className="font-medium text-gray-900">{orderDetails.customer?.cpf || orderDetails.customer?.document || '-'}</p>
                      </div>
                      {orderDetails.customer?.phone && (
                        <div>
                          <span className="text-gray-500 text-xs">Telefone</span>
                          <p className="font-medium text-gray-900">{orderDetails.customer.phone}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* FINANCEIRO - DADOS REAIS */}
                  <div className="bg-gray-50 rounded-lg p-3" data-testid="order-financial">
                    <span className="text-gray-500 text-xs font-medium">Financeiro</span>
                    <div className="space-y-1.5 mt-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Valor bruto</span>
                        <span className="font-semibold text-gray-900">{formatCurrency(grossAmount)}</span>
                      </div>
                      {isCard && orderDetails.installments && orderDetails.installments > 1 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Parcelamento</span>
                          <span className="text-gray-700">{orderDetails.installments}x de {formatCurrency(Math.round(grossAmount / orderDetails.installments))}</span>
                        </div>
                      )}
                      {gwFee > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">
                            Taxa gateway{gwPercent > 0 ? ` (${gwPercent}%)` : ''}
                          </span>
                          <span className="font-medium text-red-600">-{formatCurrency(gwFee)}</span>
                        </div>
                      )}
                      {ptFee > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">
                            Taxa plataforma{ptPercent > 0 ? ` (${ptPercent}%)` : ''}
                          </span>
                          <span className="font-medium text-red-600">-{formatCurrency(ptFee)}</span>
                        </div>
                      )}
                      {totalFees === 0 && !sellerCredit && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Taxas</span>
                          <span className="font-medium text-gray-500">Sem dados</span>
                        </div>
                      )}
                      {(orderDetails.affiliateCommission || (affCommAmt !== null && affCommAmt > 0)) && viewMode !== 'affiliate' && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">
                            Comissão afiliado {typeof orderDetails.affiliateCommission !== 'number' && (orderDetails.affiliateCommission as any)?.percentage ? `(${(orderDetails.affiliateCommission as any).percentage}%)` : ''}
                          </span>
                          <span className="font-medium text-red-600">
                            -{formatCurrency(affCommAmt !== null ? affCommAmt : getAffiliateCommissionAmount(orderDetails))}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1.5 border-t border-gray-200">
                        <span className="font-semibold text-gray-900">Valor líquido</span>
                        <span className="font-bold text-[#2563eb]">{formatCurrency(realNet)}</span>
                      </div>
                      {sellerCredit !== null && viewMode !== 'affiliate' && (
                        <div className="flex justify-between pt-1 border-t border-dashed border-blue-200">
                          <span className="font-semibold text-[#2563eb]">
                            Crédito no saldo
                            {balanceType === 'pending' && !isReleased ? <span className="ml-1 text-yellow-500 font-normal">(pendente)</span> : balanceType === 'available' || isReleased ? <span className="ml-1 text-[#2563eb] font-normal">(disponível)</span> : null}
                          </span>
                          <span className="font-bold text-[#2563eb]">{formatCurrency(sellerCredit)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs pt-0.5">
                        <span className="text-gray-500">
                          Moeda: {orderDetails.currency || fin?.currency || orderDetails.financialData?.currency || 'BRL'}
                        </span>
                        <span className="text-gray-500">
                          {releaseDate ? (
                            isReleased ? `Liberado em ${releaseDate.toLocaleDateString('pt-BR')}` : `Libera em ${releaseDate.toLocaleDateString('pt-BR')}`
                          ) : releaseDays > 0 ? `Liberação D+${releaseDays}` : null}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ORDER BUMPS */}
                  {orderDetails.orderBumps && orderDetails.orderBumps.length > 0 && (
                    <div className="bg-orange-50 rounded-lg p-3 border border-orange-200" data-testid="order-bumps">
                      <div className="flex items-center gap-1.5 mb-2">
                        <ShoppingCart className="w-3.5 h-3.5 text-orange-600" />
                        <span className="text-xs font-semibold text-orange-700">
                          Order Bumps ({orderDetails.orderBumps.length})
                        </span>
                      </div>
                      {orderDetails.orderBumps.map((bump, index) => (
                        <div key={index} className="flex justify-between items-center text-sm py-1">
                          <span className="text-gray-700">{bump.title}</span>
                          <span className="font-semibold text-orange-600">{formatCurrency(bump.price)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-1.5 mt-1 border-t border-orange-200 text-sm">
                        <span className="font-semibold text-orange-700">Total bumps</span>
                        <span className="font-bold text-orange-600">
                          {formatCurrency(orderDetails.orderBumps.reduce((s, b) => s + b.price, 0))}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* AFILIADO / PRODUTOR INFO */}
                  {viewMode === 'affiliate' ? (
                    <div className="bg-cyan-50 rounded-lg p-3 border border-cyan-200" data-testid="order-affiliate">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Users className="w-3.5 h-3.5 text-cyan-600" />
                        <span className="text-xs font-semibold text-cyan-700">Sua Comissao como Afiliado</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        {orderDetails.sellerName && (
                          <div>
                            <span className="text-gray-500 text-xs">Produtor</span>
                            <p className="font-medium text-gray-900">{orderDetails.sellerName}</p>
                          </div>
                        )}
                        {(orderDetails.affiliateCode || (typeof orderDetails.affiliateCommission !== 'number' && orderDetails.affiliateCommission?.code)) && (
                          <div>
                            <span className="text-gray-500 text-xs">Seu Código</span>
                            <p className="font-medium text-gray-900">{orderDetails.affiliateCode || (typeof orderDetails.affiliateCommission !== 'number' ? orderDetails.affiliateCommission?.code : '')}</p>
                          </div>
                        )}
                        {orderDetails.affiliateCommission && (
                          <div>
                            <span className="text-gray-500 text-xs">Comissao Recebida</span>
                            <p className="font-bold text-[#2563eb]">
                              {formatCurrency(getAffiliateCommissionAmount(orderDetails))} {typeof orderDetails.affiliateCommission !== 'number' && orderDetails.affiliateCommission.percentage ? `(${orderDetails.affiliateCommission.percentage}%)` : ''}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (orderDetails.isAffiliateSale || orderDetails.affiliateCommission) && (
                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-200" data-testid="order-affiliate">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Users className="w-3.5 h-3.5 text-[#2563eb]" />
                        <span className="text-xs font-semibold text-[#374800]">Venda via Afiliado</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        {orderDetails.affiliateName && (
                          <div>
                            <span className="text-gray-500 text-xs">Nome do Afiliado</span>
                            <p className="font-medium text-gray-900">{orderDetails.affiliateName}</p>
                          </div>
                        )}
                        {orderDetails.affiliateEmail && (
                          <div>
                            <span className="text-gray-500 text-xs">Email do Afiliado</span>
                            <p className="font-medium text-gray-900 text-xs break-all">{orderDetails.affiliateEmail}</p>
                          </div>
                        )}
                        {(orderDetails.affiliateCode || (typeof orderDetails.affiliateCommission !== 'number' && orderDetails.affiliateCommission?.code)) && (
                          <div>
                            <span className="text-gray-500 text-xs">Codigo</span>
                            <p className="font-medium text-gray-900">{orderDetails.affiliateCode || (typeof orderDetails.affiliateCommission !== 'number' ? orderDetails.affiliateCommission?.code : '')}</p>
                          </div>
                        )}
                        {orderDetails.affiliateCommission && (
                          <div>
                            <span className="text-gray-500 text-xs">Comissão</span>
                            <p className="font-medium text-[#2563eb]">
                              {formatCurrency(getAffiliateCommissionAmount(orderDetails))} {typeof orderDetails.affiliateCommission !== 'number' && orderDetails.affiliateCommission.percentage ? `(${orderDetails.affiliateCommission.percentage}%)` : ''}
                            </p>
                          </div>
                        )}
                        {orderDetails.affiliateUid && (
                          <div>
                            <span className="text-gray-500 text-xs">UID Afiliado</span>
                            <p className="font-mono text-xs text-gray-900 truncate">{orderDetails.affiliateUid}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* DATAS E IDs - COMPACTO */}
                  <div className="bg-gray-50 rounded-lg p-3" data-testid="order-meta">
                    <span className="text-gray-500 text-xs font-medium">Transacao</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs">Criado</span>
                        <p className="font-medium text-gray-900 text-xs">{formatDate(orderDetails.createdAt)}</p>
                      </div>
                      {orderDetails.paidAt && (
                        <div>
                          <span className="text-gray-500 text-xs">Pago</span>
                          <p className="font-medium text-gray-900 text-xs">{formatDate(orderDetails.paidAt)}</p>
                        </div>
                      )}
                      {orderDetails.txId && (
                        <div className="col-span-2">
                          <span className="text-gray-500 text-xs">TX ID</span>
                          <p className="font-mono text-[10px] text-gray-700 break-all">{orderDetails.txId}</p>
                        </div>
                      )}
                      <div className="col-span-2">
                        <span className="text-gray-500 text-xs">ID da venda</span>
                        <p className="font-mono text-[10px] text-gray-700 break-all">{orderDetails.id}</p>
                      </div>
                    </div>
                  </div>

                  {/* REEMBOLSO/CHARGEBACK */}
                  {(orderDetails.status === 'refunded' || orderDetails.status === 'chargeback') && (
                    <div className="bg-red-50 rounded-lg p-3 border border-red-200" data-testid="order-refund">
                      <span className="text-red-700 text-xs font-semibold">
                        {orderDetails.status === 'chargeback' ? 'Chargeback' : 'Reembolso'}
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 text-sm">
                        {orderDetails.refundAmount && (
                          <div>
                            <span className="text-gray-500 text-xs">Valor</span>
                            <p className="font-bold text-red-600">{formatCurrency(orderDetails.refundAmount)}</p>
                          </div>
                        )}
                        {orderDetails.refundedAt && (
                          <div>
                            <span className="text-gray-500 text-xs">Data</span>
                            <p className="font-medium text-gray-900 text-xs">{formatDate(orderDetails.refundedAt)}</p>
                          </div>
                        )}
                        {orderDetails.refundReason && (
                          <div className="col-span-2">
                            <span className="text-gray-500 text-xs">Motivo</span>
                            <p className="text-sm text-gray-700">{orderDetails.refundReason}</p>
                          </div>
                        )}
                        {orderDetails.chargebackReason && (
                          <div className="col-span-2">
                            <span className="text-gray-500 text-xs">Motivo</span>
                            <p className="text-sm text-gray-700">{orderDetails.chargebackReason}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                </div>
              );
            })() : (
              <div className="py-8 text-center">
                <p className="text-gray-500 text-sm">
                  Erro ao carregar detalhes da venda
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
