import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, SlidersHorizontal, Eye, Share2, DollarSign, Loader2, TrendingUp, ChevronLeft, ChevronRight, RefreshCw, ArrowDownLeft, ArrowUpRight, ShoppingCart, AlertTriangle, Gavel, CreditCard, Users, Clock, Wallet, Coins, Info } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { auth } from "@/lib/firebase";
import { getBrowserId } from "@/lib/browser-session";
import { queryClient, apiRequest } from "@/lib/queryClient";

type TransactionType = 
  | 'all'
  | 'sale_approved'
  | 'sale_refunded'
  | 'sale_chargeback'
  | 'withdrawal_request'
  | 'withdrawal_completed'
  | 'adjustment'
  | 'med'
  | 'affiliate_commission';

export default function FinancesPage() {
  const { toast } = useToast();
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"todas" | "entrada" | "saida">("todas");
  const [activeTransactionType, setActiveTransactionType] = useState<TransactionType>('all');
  const [isWithdrawalDialogOpen, setIsWithdrawalDialogOpen] = useState(false);
  const [showValues, setShowValues] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<'hoje' | 'ontem' | '7dias' | '15dias' | '30dias' | '60dias' | '90dias' | 'total'>('total');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [withdrawalSource, setWithdrawalSource] = useState<'pix' | 'card_br' | 'card_global' | 'affiliate'>('pix');

  // ── Saque em Cripto ──────────────────────────────────────────────────────────
  const [isCryptoDialogOpen, setIsCryptoDialogOpen] = useState(false);
  const [cryptoAmount, setCryptoAmount] = useState("");
  const [cryptoWallet, setCryptoWallet] = useState("");
  const [withdrawalData, setWithdrawalData] = useState({
    amount: "",
    pixKey: "",
    pixKeyType: "cpf" as "cpf" | "cnpj" | "email" | "phone" | "random",
    holderName: "",
    holderEmail: "",
    holderDocument: ""
  });

  const { data: withdrawalFeeData } = useQuery<{ feePercent: number; isCustom?: boolean }>({
    queryKey: ['/api/withdrawals/fee'],
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: true,
  });
  const withdrawalFeePercent = withdrawalFeeData?.feePercent ?? 5;

  const { data: bankingDataResponse } = useQuery<{ bankingData: any }>({
    queryKey: ['/api/sellers/banking-data'],
    enabled: !!user,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isWithdrawalDialogOpen && user) {
      const bd = bankingDataResponse?.bankingData;
      setWithdrawalData({
        amount: "",
        pixKey: bd?.pixKey || "",
        pixKeyType: bd?.pixKeyType || "cpf",
        holderName: bd?.holderName || user.displayName || tenant?.name || "",
        holderEmail: user.email || "",
        holderDocument: bd?.holderDocument || ""
      });
    }
  }, [isWithdrawalDialogOpen, user, tenant, bankingDataResponse]);

  // 🔄 Inicializar saldo e corrigir órfãos se necessário (uma vez ao montar)
  // ⚡ OTIMIZAÇÃO: Inicialização movida para o backend (executada apenas 1x por sessão)
  // Removido useEffect de inicialização para economizar quota do Firebase

  // 💰 Buscar resumo de saldo unificado (OTIMIZADO: sem polling frequente)
  const { data: balanceSummary, isLoading: isLoadingBalance } = useQuery({
    queryKey: ['/api/balance/summary'],
    refetchInterval: 60000, // ⚡ Auto-refresh a cada 60 segundos (economia de quota)
    refetchOnWindowFocus: false, // ⚡ DESATIVADO para economizar Firebase
    staleTime: 30000, // Cache de 30 segundos
  });

  // 📦 Buscar orders para calcular saldo real (OTIMIZADO)
  const { data: orders = [] } = useQuery({
    queryKey: ["orders", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id || !auth.currentUser) return [];
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(`/api/orders?tenantId=${tenant.id}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!tenant?.id,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 📊 Buscar saques reais do seller
  const { data: withdrawalsData = [] } = useQuery({
    queryKey: ['/api/withdrawals'],
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const { data: sellerRefundRequests = [], isLoading: isLoadingRefunds } = useQuery({
    queryKey: ['seller-refunds', user?.uid],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/seller/refunds', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const { data: myAffiliationsData } = useQuery({
    queryKey: ['/api/affiliations'],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const hasApprovedAffiliations = ((myAffiliationsData as any)?.affiliations || []).some((a: any) => a.status === 'approved');

  const { data: affiliateBalance, isLoading: affiliateBalanceLoading } = useQuery<any>({
    queryKey: ['/api/affiliate/balance'],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      const token = await currentUser.getIdToken();
      const browserId = getBrowserId();
      const response = await fetch('/api/affiliate/balance', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-Browser-Id': browserId },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!user,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const affiliateAvailable = (affiliateBalance as any)?.balanceAvailable_BRL || 0;
  const affiliatePending = (affiliateBalance as any)?.balancePending_BRL || 0;
  const affiliateLifetime = (affiliateBalance as any)?.lifetimeCommissions_BRL || 0;
  const affiliateWithdrawn = (affiliateBalance as any)?.totalWithdrawn_BRL || 0;
  const showAffiliateCard = hasApprovedAffiliations || affiliateAvailable > 0 || affiliatePending > 0 || affiliateLifetime > 0;

  const { data: affiliateOrders = [] } = useQuery<any[]>({
    queryKey: ['/api/affiliate/my-orders'],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const token = await currentUser.getIdToken();
      const browserId = getBrowserId();
      const response = await fetch('/api/affiliate/my-orders', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-Browser-Id': browserId },
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.data || result.orders || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 💱 Cotação USD/BRL em tempo real
  const { data: cryptoRateData } = useQuery<{ rate: number; updatedAt: string }>({
    queryKey: ['/api/withdrawals/crypto/rate'],
    refetchInterval: 60000,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    enabled: !!user,
  });
  const usdRate = cryptoRateData?.rate ?? 5.20;
  const cryptoAmountCents = Math.round(parseFloat(cryptoAmount || "0") * 100);
  const usdtEquivalent = cryptoAmountCents > 0 ? (cryptoAmountCents / 100 / usdRate).toFixed(2) : "0.00";

  // 🔶 Mutation de saque em cripto
  const createCryptoWithdrawalMutation = useMutation({
    mutationFn: async (data: any) => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/withdrawals/crypto', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao solicitar saque' }));
        throw new Error(err.error || 'Erro ao solicitar saque');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "✅ Solicitação enviada!", description: "O admin irá processar seu saque em USDT em breve." });
      setIsCryptoDialogOpen(false);
      setCryptoAmount("");
      setCryptoWallet("");
    },
    onError: (error: any) => {
      toast({ title: "❌ Erro", description: error.message, variant: "destructive" });
    },
  });

  // 💸 Mutation para criar saque (evita race conditions e duplo submit)
  const createWithdrawalMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('/api/withdrawals', 'POST', data);
      
      // ✅ Verificar se request foi bem-sucedido
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Erro ao solicitar saque' }));
        throw new Error(errorData.error || `Erro ${res.status}: ${res.statusText}`);
      }
      
      return await res.json();
    },
    onSuccess: (data, variables) => {
      const amount = variables.amount / 100;
      toast({
        title: "✅ Saque solicitado!",
        description: `Valor: R$ ${amount.toFixed(2)}. Aguarde aprovação do admin.`,
      });
      
      // ⚡ Fechar dialog IMEDIATAMENTE para prevenir duplo clique
      setIsWithdrawalDialogOpen(false);
      setWithdrawalData({ ...withdrawalData, amount: "", pixKey: "" });
      
      // 🔄 Invalidar TODOS os caches relacionados a saques/balanço
      queryClient.invalidateQueries({ queryKey: ['/api/balance/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
    },
    onError: (error: any) => {
      // ⚠️ Dialog PERMANECE ABERTO em caso de erro
      toast({
        title: "❌ Erro ao solicitar saque",
        description: error.message || "Saldo insuficiente ou erro no servidor.",
        variant: "destructive",
      });
    }
  });

  // 💱 Formatar moeda
  const formatCurrency = (amount: number, currency: 'BRL' | 'USD' | 'EUR') => {
    const value = amount / 100; // Converter centavos para reais
    const symbol = currency === 'BRL' ? 'R$' : currency === 'USD' ? '$' : '€';
    return `${symbol} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 📊 USAR SALDO REAL DO FIRESTORE (já desconta saques)
  // O balanceSummary.totals.BRL.available já vem calculado corretamente do backend
  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeAffiliateOrders = Array.isArray(affiliateOrders) ? affiliateOrders : [];
  const paidOrders = (safeOrders as any[]).filter((order: any) => order.status === 'paid');
  
  // 📊 Cards de saldo (usar saldo do Firestore - já inclui saques descontados)
  const totals = (balanceSummary as any)?.totals?.BRL || { available: 0, pending: 0, reserved: 0, withdrawn: 0 };
  
  // ✅ NÃO sobrescrever - usar o valor real do Firestore que já desconta saques
  
  // 💳 Separar saldo pendente por tipo de cartão (BR vs Global)
  const breakdown = (balanceSummary as any)?.breakdown || {};
  const creditCardBR = breakdown?.BRL?.creditCard || [];
  const creditCardGlobal = [...(breakdown?.USD?.creditCard || []), ...(breakdown?.EUR?.creditCard || [])];
  
  const pendingCardBR = creditCardBR.reduce((sum: number, acq: any) => sum + (acq.pending || 0), 0);
  const pendingCardGlobal = creditCardGlobal.reduce((sum: number, acq: any) => sum + (acq.pending || 0), 0);
  const availableCardBR = creditCardBR.reduce((sum: number, acq: any) => sum + (acq.available || 0), 0);
  const availableCardGlobal = creditCardGlobal.reduce((sum: number, acq: any) => sum + (acq.available || 0), 0);
  
  const openWithdrawal = (source: 'pix' | 'card_br' | 'card_global' | 'affiliate') => {
    setWithdrawalSource(source);
    setIsWithdrawalDialogOpen(true);
  };
  
  const getMaxWithdrawal = () => {
    switch (withdrawalSource) {
      case 'pix': return totals.available;
      case 'card_br': return availableCardBR;
      case 'card_global': return availableCardGlobal;
      case 'affiliate': return affiliateAvailable;
      default: return 0;
    }
  };
  
  const getSourceLabel = () => {
    switch (withdrawalSource) {
      case 'pix': return 'PIX';
      case 'card_br': return 'Cartão BR';
      case 'card_global': return 'Cartão Global';
      case 'affiliate': return 'Comissões Afiliado';
      default: return 'Saldo';
    }
  };
  
  const statsCards = [
    {
      title: "Saldo disponível",
      value: showValues ? formatCurrency(totals.available, 'BRL') : '••••••',
      badge: totals.available > 0 ? 'Disponível' : 'Zero',
      badgeVariant: totals.available > 0 ? 'default' : 'secondary' as 'default' | 'secondary',
      color: 'violet' as const,
      tooltip: "Saldo liberado para saque imediato"
    },
    {
      title: "Pendente Cartão BR",
      value: showValues ? formatCurrency(pendingCardBR, 'BRL') : '••••••',
      color: 'yellow' as const,
      tooltip: "Saldo de cartões brasileiros em período de espera. Será liberado automaticamente após o prazo configurado."
    },
    {
      title: "Pendente Cartão Global",
      value: showValues ? formatCurrency(pendingCardGlobal, 'BRL') : '••••••',
      color: 'orange' as const,
      tooltip: "Saldo de cartões internacionais em período de espera. Será liberado automaticamente após o prazo configurado."
    },
    {
      title: "Saldo reservado",
      value: showValues ? formatCurrency(totals.reserved, 'BRL') : '••••••',
      color: 'gray' as const,
      tooltip: "Saldo em processo de saque (aguardando aprovação do admin)"
    },
  ];
  
  // 📅 FILTRO DE DATA E STATUS PARA TRANSAÇÕES
  // 🔄 Combinar todas as transações (saques reais + reembolsos + chargebacks)
  const realWithdrawals = Array.isArray(withdrawalsData) ? withdrawalsData : (withdrawalsData as any)?.withdrawals || [];
  const balanceWithdrawals = (balanceSummary as any)?.recentWithdrawals || [];
  
  // Combinar saques de ambas as fontes (sem duplicatas)
  const allWithdrawalsMap = new Map();
  [...realWithdrawals, ...balanceWithdrawals].forEach((w: any) => {
    const id = w.id || w.withdrawalId;
    if (id && !allWithdrawalsMap.has(id)) {
      allWithdrawalsMap.set(id, { ...w, transactionType: 'withdrawal_request' });
    }
  });
  
  // Buscar reembolsos e chargebacks das orders
  const refundedOrders = (safeOrders as any[]).filter((o: any) => o.status === 'refunded').map((o: any) => ({
    ...o,
    transactionType: 'sale_refunded',
    amount: o.totalAmount || o.amount || 0,
    requestedAt: o.refundedAt || o.updatedAt || o.createdAt
  }));
  
  const pendingRefundRequests = (sellerRefundRequests as any[]).map((r: any) => ({
    ...r,
    transactionType: 'sale_refunded',
    amount: r.refundAmount || r.amount || 0,
    requestedAt: r.requestedAt || r.createdAt,
    productName: r.productTitle,
    customerName: r.customerName,
    isRefundRequest: true,
  }));
  
  const refundRequestIds = new Set(pendingRefundRequests.map((r: any) => r.orderId));
  const filteredRefundedOrders = refundedOrders.filter((o: any) => !refundRequestIds.has(o.id));
  
  const chargebackOrders = (safeOrders as any[]).filter((o: any) => o.status === 'chargeback').map((o: any) => ({
    ...o,
    transactionType: 'sale_chargeback',
    amount: o.totalAmount || o.amount || 0,
    requestedAt: o.chargebackAt || o.updatedAt || o.createdAt
  }));

  // MED (mediação PIX EfíBank) - débito do seller assim como chargeback
  const medOrders = (safeOrders as any[]).filter((o: any) => o.status === 'med' || o.status === 'mediation').map((o: any) => ({
    ...o,
    transactionType: 'med',
    amount: o.totalAmount || o.amount || 0,
    requestedAt: o.medAt || o.updatedAt || o.createdAt
  }));

  const affiliateCommissionTx = showAffiliateCard ? safeAffiliateOrders
    .filter((o: any) => ['paid', 'approved', 'completed'].includes(o.status))
    .map((o: any) => {
      const affComm = o.affiliateCommission;
      const commission = o.commissionAmount || (typeof affComm === 'number' ? affComm : affComm?.amount) || o.commission || 0;
      const dateField = o.paidAt || o.approvedAt || o.createdAt;
      return {
        ...o,
        transactionType: 'affiliate_commission',
        amount: commission,
        status: 'completed',
        requestedAt: dateField,
        createdAt: dateField,
      };
    }) : [];

  // Chargebacks e MEDs de vendas feitas como afiliado - débito da comissão
  const affiliateChargebackTx = showAffiliateCard ? safeAffiliateOrders
    .filter((o: any) => o.status === 'chargeback')
    .map((o: any) => {
      const affComm = o.affiliateCommission;
      const commission = o.commissionAmount || (typeof affComm === 'number' ? affComm : affComm?.amount) || o.commission || 0;
      return {
        ...o,
        transactionType: 'sale_chargeback',
        amount: commission,
        requestedAt: o.chargebackAt || o.updatedAt || o.createdAt,
        _isAffiliateSideDebit: true,
      };
    }) : [];

  const affiliateMedTx = showAffiliateCard ? safeAffiliateOrders
    .filter((o: any) => o.status === 'med' || o.status === 'mediation')
    .map((o: any) => {
      const affComm = o.affiliateCommission;
      const commission = o.commissionAmount || (typeof affComm === 'number' ? affComm : affComm?.amount) || o.commission || 0;
      return {
        ...o,
        transactionType: 'med',
        amount: commission,
        requestedAt: o.medAt || o.updatedAt || o.createdAt,
        _isAffiliateSideDebit: true,
      };
    }) : [];

  const allTransactions = [
    ...Array.from(allWithdrawalsMap.values()),
    ...filteredRefundedOrders,
    ...pendingRefundRequests,
    ...chargebackOrders,
    ...medOrders,
    ...affiliateCommissionTx,
    ...affiliateChargebackTx,
    ...affiliateMedTx,
  ];
  
  // Filtrar por tipo de transação selecionado
  const rawWithdrawals = activeTransactionType === 'all' 
    ? allTransactions
    : allTransactions.filter((t: any) => t.transactionType === activeTransactionType);
  
  const filteredWithdrawals = rawWithdrawals.filter((withdrawal: any) => {
    // Filtro por status
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending' && withdrawal.status !== 'pending') return false;
      if (statusFilter === 'completed' && !['approved', 'completed', 'processing'].includes(withdrawal.status)) return false;
    }
    
    if (dateFilter === 'total') return true;
    
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let withdrawalDate: Date;
    const dateField = withdrawal.requestedAt || withdrawal.createdAt;
    
    if (dateField?._seconds) {
      withdrawalDate = new Date(dateField._seconds * 1000);
    } else if (dateField?.seconds) {
      withdrawalDate = new Date(dateField.seconds * 1000);
    } else if (typeof dateField === "string") {
      withdrawalDate = new Date(dateField);
    } else if (dateField instanceof Date) {
      withdrawalDate = dateField;
    } else {
      return false;
    }
    
    const diffDays = Math.floor((now.getTime() - withdrawalDate.getTime()) / (1000 * 60 * 60 * 24));
    
    switch (dateFilter) {
      case 'hoje':
        return withdrawalDate >= startOfToday;
      case 'ontem':
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        return withdrawalDate >= startOfYesterday && withdrawalDate < startOfToday;
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

  // 📄 Paginação
  const totalPages = Math.ceil(filteredWithdrawals.length / ITEMS_PER_PAGE);
  const paginatedTransactions = filteredWithdrawals.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  
  // Reset página quando mudar filtro
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTransactionType, statusFilter, dateFilter]);

  return (
    <DashboardLayout>
      <div className="space-y-4 px-3 md:px-6 py-4 md:py-6">
        <div className={`grid grid-cols-1 md:grid-cols-2 ${showAffiliateCard ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
          {/* CARD 1: PIX - Verde */}
          <Card className="border border-blue-500/30 dark:border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                  PIX
                </p>
                <Button 
                  size="sm"
                  className="h-7 text-xs bg-blue-600 hover:bg-green-700 text-white"
                  disabled={isLoadingBalance || totals.available <= 0}
                  onClick={() => openWithdrawal('pix')}
                  data-testid="button-withdrawal-pix"
                >
                  <DollarSign className="h-3 w-3 mr-1" />
                  Sacar
                </Button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Disponivel p/ saque</span>
                  {isLoadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-sm font-semibold text-violet-600 tabular-nums">
                      {showValues ? formatCurrency(totals.available, 'BRL') : '******'}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CARD 2: CARTAO BR - Roxo padrao */}
          <Card className="border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-foreground uppercase tracking-wide">
                  Cartao BR
                </p>
                <Button 
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={isLoadingBalance || availableCardBR <= 0}
                  onClick={() => openWithdrawal('card_br')}
                  data-testid="button-withdrawal-card-br"
                >
                  <DollarSign className="h-3 w-3 mr-1" />
                  Sacar
                </Button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Bloqueado (a liberar)</span>
                  {isLoadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {showValues ? formatCurrency(pendingCardBR, 'BRL') : '******'}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Disponivel p/ saque</span>
                  {isLoadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {showValues ? formatCurrency(availableCardBR, 'BRL') : '******'}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CARD 3: CARTAO GLOBAL - Roxo padrao */}
          <Card className="border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-foreground uppercase tracking-wide">
                  Cartao Global
                </p>
                <Button 
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={isLoadingBalance || availableCardGlobal <= 0}
                  onClick={() => openWithdrawal('card_global')}
                  data-testid="button-withdrawal-card-global"
                >
                  <DollarSign className="h-3 w-3 mr-1" />
                  Sacar
                </Button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Bloqueado (a liberar)</span>
                  {isLoadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {showValues ? formatCurrency(pendingCardGlobal, 'BRL') : '******'}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Disponivel p/ saque</span>
                  {isLoadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {showValues ? formatCurrency(availableCardGlobal, 'BRL') : '******'}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CARD 4: BOLETO */}
          <Card className="border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-foreground uppercase tracking-wide">
                  Boleto
                </p>
                <Button 
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={true}
                  data-testid="button-withdrawal-boleto"
                >
                  <DollarSign className="h-3 w-3 mr-1" />
                  Sacar
                </Button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Bloqueado (a liberar)</span>
                  {isLoadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {showValues ? formatCurrency(0, 'BRL') : '******'}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Disponivel p/ saque</span>
                  {isLoadingBalance ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {showValues ? formatCurrency(0, 'BRL') : '******'}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {showAffiliateCard && (
            <Card className="border border-lime-500/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-[#2563eb] uppercase tracking-wide">
                    Afiliado
                  </p>
                  <Button 
                    size="sm"
                    className="h-7 text-xs bg-[#2563eb] hover:bg-[#374800] text-white"
                    disabled={affiliateBalanceLoading || affiliateAvailable <= 0}
                    onClick={() => openWithdrawal('affiliate')}
                    data-testid="button-withdrawal-affiliate"
                  >
                    <DollarSign className="h-3 w-3 mr-1" />
                    Sacar
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Pendente (a liberar)</span>
                    {affiliateBalanceLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {showValues ? formatCurrency(affiliatePending, 'BRL') : '******'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Disponivel p/ saque</span>
                    {affiliateBalanceLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-sm font-semibold text-[#2563eb] tabular-nums">
                        {showValues ? formatCurrency(affiliateAvailable, 'BRL') : '******'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-blue-200/30">
                    <span className="text-[10px] text-muted-foreground">Total ganho</span>
                    <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                      {showValues ? formatCurrency(affiliateLifetime, 'BRL') : '******'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </div>

        {/* Barra de Filtros e Busca - UNIFICADA */}
        <div className="flex flex-wrap gap-2 items-start lg:items-center justify-start lg:justify-between w-full bg-card p-3 rounded-lg shadow-sm border border-border">
          {/* Filtros de Tipo */}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={activeTransactionType === 'withdrawal_request' ? "default" : "outline"}
              className={`cursor-pointer transition-colors ${
                activeTransactionType === 'withdrawal_request' 
                  ? 'bg-[#2563eb] hover:bg-[#2563eb] text-white border-[#2563eb]' 
                  : 'hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb]'
              }`}
              onClick={() => setActiveTransactionType(activeTransactionType === 'withdrawal_request' ? 'all' : 'withdrawal_request')}
              data-testid="badge-filter-saques"
            >
              <ArrowUpRight className="h-3 w-3 mr-1" />
              Saques
            </Badge>
            <Badge
              variant={activeTransactionType === 'sale_refunded' ? "default" : "outline"}
              className={`cursor-pointer transition-colors ${
                activeTransactionType === 'sale_refunded' 
                  ? 'bg-yellow-600 hover:bg-yellow-700 text-white border-yellow-600' 
                  : 'hover:bg-yellow-600 hover:text-white hover:border-yellow-600'
              }`}
              onClick={() => setActiveTransactionType(activeTransactionType === 'sale_refunded' ? 'all' : 'sale_refunded')}
              data-testid="badge-filter-reembolsos"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Reembolsos
            </Badge>
            <Badge
              variant={activeTransactionType === 'sale_chargeback' ? "default" : "outline"}
              className={`cursor-pointer transition-colors ${
                activeTransactionType === 'sale_chargeback' 
                  ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' 
                  : 'hover:bg-red-600 hover:text-white hover:border-red-600'
              }`}
              onClick={() => setActiveTransactionType(activeTransactionType === 'sale_chargeback' ? 'all' : 'sale_chargeback')}
              data-testid="badge-filter-chargeback"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              Chargeback
            </Badge>
            <Badge
              variant={activeTransactionType === 'med' ? "default" : "outline"}
              className={`cursor-pointer transition-colors ${
                activeTransactionType === 'med' 
                  ? 'bg-orange-600 hover:bg-orange-700 text-white border-orange-600' 
                  : 'hover:bg-orange-600 hover:text-white hover:border-orange-600'
              }`}
              onClick={() => setActiveTransactionType(activeTransactionType === 'med' ? 'all' : 'med')}
              data-testid="badge-filter-med"
            >
              <Gavel className="h-3 w-3 mr-1" />
              MED
            </Badge>
            {showAffiliateCard && (
              <Badge
                variant={activeTransactionType === 'affiliate_commission' ? "default" : "outline"}
                className={`cursor-pointer transition-colors ${
                  activeTransactionType === 'affiliate_commission' 
                    ? 'bg-[#2563eb] hover:bg-[#374800] text-white border-[#2563eb]' 
                    : 'hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb]'
                }`}
                onClick={() => setActiveTransactionType(activeTransactionType === 'affiliate_commission' ? 'all' : 'affiliate_commission')}
                data-testid="badge-filter-affiliate"
              >
                <Users className="h-3 w-3 mr-1" />
                Comissoes
              </Badge>
            )}
          </div>

          {/* Busca */}
          <div className="relative w-full lg:w-64 order-last lg:order-none basis-full lg:basis-auto">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar por código"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-background border-border"
            />
          </div>

          {/* Botões de Ação */}
          <div className="flex gap-1 sm:gap-2">
            <DropdownMenu open={isFilterOpen} onOpenChange={setIsFilterOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-card border-border hover:bg-muted shadow-sm"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-card border-border">
                <DropdownMenuItem onClick={() => setDateFilter('hoje')} className={dateFilter === 'hoje' ? 'bg-gray-100' : ''}>
                  Hoje
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('ontem')} className={dateFilter === 'ontem' ? 'bg-gray-100' : ''}>
                  Ontem
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('7dias')} className={dateFilter === '7dias' ? 'bg-gray-100' : ''}>
                  Últimos 7 dias
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('15dias')} className={dateFilter === '15dias' ? 'bg-gray-100' : ''}>
                  Últimos 15 dias
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('30dias')} className={dateFilter === '30dias' ? 'bg-gray-100' : ''}>
                  Últimos 30 dias
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('60dias')} className={dateFilter === '60dias' ? 'bg-gray-100' : ''}>
                  Últimos 60 dias
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateFilter('90dias')} className={dateFilter === '90dias' ? 'bg-gray-100' : ''}>
                  Últimos 90 dias
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
              className="bg-card border-border hover:bg-muted shadow-sm"
              title={showValues ? "Ocultar valores" : "Mostrar valores"}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="bg-card border-border hover:bg-muted shadow-sm"
              title="Compartilhar"
            >
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* DIALOG DE SAQUE CRIPTO */}
        <Dialog open={isCryptoDialogOpen} onOpenChange={setIsCryptoDialogOpen}>
          <DialogContent className="sm:max-w-[400px] bg-white">
            <DialogHeader className="pb-1">
              <DialogTitle className="text-base font-semibold text-gray-900">Realizar Saque - PIX</DialogTitle>
            </DialogHeader>

            {/* Saldo disponível */}
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
              <Info className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-xs text-gray-600">
                Saldo disponível na carteira PIX: <strong className="text-gray-900">R$ {(totals.available / 100).toFixed(2).replace('.', ',')}</strong>
              </span>
            </div>

            <div className="space-y-3 py-1">
              {/* Valor do Saque */}
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-700">Valor do Saque</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="400"
                  placeholder="R$0,00"
                  value={cryptoAmount}
                  onChange={(e) => setCryptoAmount(e.target.value)}
                  className="h-9 text-sm border-gray-200 bg-white"
                />
                {cryptoAmountCents > 0 && (
                  <p className="text-xs text-amber-600 font-medium">
                    ≈ {usdtEquivalent} USDT (cotação: R$ {usdRate.toFixed(2)})
                  </p>
                )}
              </div>

              {/* Método de Saque */}
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-700">Método de Saque</Label>
                <Select defaultValue="crypto" disabled>
                  <SelectTrigger className="h-9 text-sm border-gray-200 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="crypto">Criptomoeda</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Aviso USDT */}
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-1">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-700 leading-relaxed">
                    <p><strong>Atenção:</strong> Todos os saques em criptomoeda são processados em USDT (Tether).</p>
                    <p className="mt-0.5">A cotação pode variar ao momento do processamento.</p>
                    <p className="mt-0.5 font-semibold">Valor mínimo para saque em criptomoeda: R$ 400,00</p>
                  </div>
                </div>
              </div>

              {/* Endereço da Carteira */}
              <div className="space-y-1">
                <Label className="text-xs font-medium text-gray-700">Endereço da Carteira</Label>
                <Input
                  placeholder="Digite o endereço sua carteira"
                  value={cryptoWallet}
                  onChange={(e) => setCryptoWallet(e.target.value)}
                  className="h-9 text-sm border-gray-200 bg-white font-mono"
                />
                <p className="text-[10px] text-gray-400">Cole o endereço sua carteira de criptomoeda (Bitcoin, Ethereum, etc.)</p>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-1">
              <Button variant="outline" onClick={() => setIsCryptoDialogOpen(false)} className="flex-1 h-9 text-sm">
                Cancelar
              </Button>
              <Button
                className="flex-1 h-9 text-sm bg-gray-800 hover:bg-gray-900 text-white"
                disabled={createCryptoWithdrawalMutation.isPending || cryptoAmountCents < 40000 || !cryptoWallet.trim()}
                onClick={() => {
                  if (cryptoAmountCents < 40000) {
                    toast({ title: "❌ Valor mínimo: R$ 400,00", variant: "destructive" });
                    return;
                  }
                  if (!cryptoWallet.trim() || cryptoWallet.trim().length < 10) {
                    toast({ title: "❌ Endereço de carteira inválido", variant: "destructive" });
                    return;
                  }
                  createCryptoWithdrawalMutation.mutate({
                    amountBRL: cryptoAmountCents,
                    walletAddress: cryptoWallet.trim(),
                    usdtAmount: parseFloat(usdtEquivalent),
                    usdRate,
                  });
                }}
              >
                {createCryptoWithdrawalMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Enviando...</>
                ) : "Continuar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* DIALOG DE SAQUE - Aberto pelo botão do card de saldo */}
        <Dialog open={isWithdrawalDialogOpen} onOpenChange={setIsWithdrawalDialogOpen}>
                <DialogContent className="sm:max-w-[420px] bg-white">
                  <DialogHeader className="pb-2">
                    <DialogTitle className="text-lg text-gray-900">
                      Solicitar Saque - {getSourceLabel()}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-gray-600">
                      Saldo disponível: {formatCurrency(getMaxWithdrawal(), 'BRL')}
                    </DialogDescription>
                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-xs text-yellow-700">
                        <strong>Taxa de saque:</strong> {withdrawalFeePercent}% sobre o valor sacado (descontado do saldo ao solicitar)
                      </p>
                    </div>
                  </DialogHeader>
                  <div className="grid gap-2 py-2 w-full">
                    <div className="grid gap-1 w-full">
                      <Label htmlFor="amount" className="text-xs font-medium text-gray-700">Valor (R$)</Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        placeholder="100.00"
                        value={withdrawalData.amount}
                        onChange={(e) => setWithdrawalData({ ...withdrawalData, amount: e.target.value })}
                        className="h-9 w-full bg-white border-gray-200 text-sm"
                      />
                    </div>
                    
                    <div className="grid gap-1 w-full">
                      <Label htmlFor="holderEmail" className="text-xs font-medium text-gray-700">Email da conta</Label>
                      <Input
                        id="holderEmail"
                        type="email"
                        value={withdrawalData.holderEmail}
                        readOnly
                        className="h-9 w-full bg-gray-100 border-gray-200 text-sm text-gray-600 cursor-not-allowed"
                      />
                    </div>
                    
                    <div className="grid gap-1 w-full">
                      <Label htmlFor="holderDocument" className="text-xs font-medium text-gray-700">CPF/CNPJ cadastrado</Label>
                      <Input
                        id="holderDocument"
                        value={withdrawalData.holderDocument || "Não cadastrado"}
                        readOnly
                        className="h-9 w-full bg-gray-100 border-gray-200 text-sm text-gray-600 cursor-not-allowed font-mono"
                      />
                    </div>
                    
                    <div className="grid gap-1 w-full">
                      <Label htmlFor="pixKey" className="text-xs font-semibold text-gray-900">Chave PIX *</Label>
                      <Input
                        id="pixKey"
                        placeholder="Digite sua chave PIX (CPF, email, telefone ou aleatória)"
                        value={withdrawalData.pixKey}
                        onChange={(e) => setWithdrawalData({ ...withdrawalData, pixKey: e.target.value })}
                        className="h-9 w-full bg-white border-gray-300 focus:border-[#0f9960] focus:ring-[#0f9960] text-sm"
                      />
                    </div>
                  </div>
                  <DialogFooter className="gap-2 pt-2 flex-col sm:flex-row">
                    <Button
                      variant="outline"
                      onClick={() => setIsWithdrawalDialogOpen(false)}
                      className="h-9 text-sm w-full sm:w-auto"
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => {
                        const amount = parseFloat(withdrawalData.amount);
                        
                        if (!withdrawalData.pixKey.trim()) {
                          toast({
                            title: "❌ Erro",
                            description: "Informe sua chave PIX para continuar.",
                            variant: "destructive",
                          });
                          return;
                        }
                        
                        if (!amount || amount <= 0) {
                          toast({
                            title: "❌ Erro",
                            description: "Informe um valor válido maior que R$ 0,00.",
                            variant: "destructive",
                          });
                          return;
                        }
                        
                        const maxAmount = getMaxWithdrawal();
                        const amountInCentavos = Math.round(amount * 100);
                        const feeCentavos = Math.round(amountInCentavos * withdrawalFeePercent / 100);
                        const totalNeeded = amountInCentavos + feeCentavos;
                        
                        if (totalNeeded > maxAmount) {
                          const maxWithdrawable = Math.max(0, maxAmount / (1 + withdrawalFeePercent / 100) / 100);
                          toast({
                            title: "❌ Saldo insuficiente",
                            description: `Para sacar R$ ${amount.toFixed(2)}, você precisa de R$ ${(totalNeeded / 100).toFixed(2)} (valor + ${withdrawalFeePercent}% de taxa = R$ ${(feeCentavos / 100).toFixed(2)}). Disponível: ${formatCurrency(maxAmount, 'BRL')}. Máximo para saque: R$ ${maxWithdrawable.toFixed(2)}`,
                            variant: "destructive",
                          });
                          return;
                        }
                        
                        const detectPixKeyType = (key: string): string => {
                          const cleanKey = key.replace(/[^\w@.+-]/g, '');
                          if (/^\d{11}$/.test(cleanKey)) return 'cpf';
                          if (/^\d{14}$/.test(cleanKey)) return 'cnpj';
                          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanKey)) return 'email';
                          if (/^\+?55\d{10,11}$/.test(cleanKey)) return 'phone';
                          return 'random';
                        };

                        // ⚡ Usar mutation (evita race conditions e duplo submit)
                        createWithdrawalMutation.mutate({
                          amount: Math.round(amount * 100),
                          currency: 'BRL',
                          source: withdrawalSource,
                          userType: withdrawalSource === 'affiliate' ? 'affiliate' : 'seller',
                          pixData: {
                            pixKey: withdrawalData.pixKey,
                            pixKeyType: detectPixKeyType(withdrawalData.pixKey),
                            holderName: withdrawalData.holderName,
                            holderEmail: withdrawalData.holderEmail,
                            holderDocument: withdrawalData.holderDocument
                          }
                        });
                      }}
                      disabled={createWithdrawalMutation.isPending || isLoadingBalance}
                      className="h-9 w-full sm:w-auto bg-[#0f9960] hover:bg-[#0d8050] text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {createWithdrawalMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Processando...
                        </>
                      ) : (
                        "Confirmar Saque"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
          </Dialog>

        {/* TABELA DE TRANSAÇÕES - COM ABAS DE STATUS */}
        <Card className="bg-card border border-border shadow-card">
          <CardHeader className="p-3 md:p-6">
            <div className="flex flex-col gap-4">
              <CardTitle className="text-base sm:text-lg font-semibold text-foreground">
                {activeTransactionType === 'withdrawal_request' && 'Historico de Saques'}
                {activeTransactionType === 'sale_refunded' && 'Historico de Reembolsos'}
                {activeTransactionType === 'sale_chargeback' && 'Historico de Chargebacks'}
                {activeTransactionType === 'med' && 'Historico de MEDs'}
                {activeTransactionType === 'affiliate_commission' && 'Historico de Comissoes'}
                {activeTransactionType === 'all' && 'Historico de Transacoes'}
                {' '}({filteredWithdrawals.length})
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={statusFilter === 'all' ? 'default' : 'outline'}
                  onClick={() => setStatusFilter('all')}
                  className={`text-xs sm:text-sm ${statusFilter === 'all' ? 'bg-violet-600 hover:bg-violet-700' : ''}`}
                >
                  Todos
                </Button>
                <Button
                  size="sm"
                  variant={statusFilter === 'pending' ? 'default' : 'outline'}
                  onClick={() => setStatusFilter('pending')}
                  className={`text-xs sm:text-sm ${statusFilter === 'pending' ? 'bg-yellow-600 hover:bg-yellow-700' : ''}`}
                >
                  Pendentes
                </Button>
                <Button
                  size="sm"
                  variant={statusFilter === 'completed' ? 'default' : 'outline'}
                  onClick={() => setStatusFilter('completed')}
                  className={`text-xs sm:text-sm ${statusFilter === 'completed' ? 'bg-violet-600 hover:bg-violet-700' : ''}`}
                >
                  Concluídos
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <div className="w-full min-w-full">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border sticky top-0">
                  <tr>
                    <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Data
                    </th>
                    <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Tipo
                    </th>
                    <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                      Detalhes
                    </th>
                    <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Valor
                    </th>
                    <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedTransactions && paginatedTransactions.length > 0 ? (
                    paginatedTransactions.map((withdrawal: any, index: number) => {
                      const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
                        pending: { label: 'Pendente', variant: 'secondary' },
                        approved: { label: 'Aprovado', variant: 'outline' },
                        rejected: { label: 'Rejeitado', variant: 'destructive' },
                        processing: { label: 'Processando', variant: 'default' },
                        completed: { label: 'Concluído', variant: 'default' },
                        paid: { label: 'Pago', variant: 'default' },
                        refunded: { label: 'Reembolsado', variant: 'secondary' },
                        chargeback: { label: 'Chargeback', variant: 'destructive' },
                        med: { label: 'MED', variant: 'destructive' },
                        mediation: { label: 'Mediação', variant: 'destructive' },
                        failed: { label: 'Falhou', variant: 'destructive' },
                        cancelled: { label: 'Cancelado', variant: 'secondary' }
                      };
                      
                      const status = statusConfig[withdrawal.status] || { label: withdrawal.status, variant: 'secondary' };
                      
                      const dateField = withdrawal.requestedAt || withdrawal.createdAt;
                      let date: Date;
                      if (dateField?._seconds) {
                        date = new Date(dateField._seconds * 1000);
                      } else if (dateField?.toDate) {
                        date = dateField.toDate();
                      } else if (dateField) {
                        date = new Date(dateField);
                      } else {
                        date = new Date();
                      }
                      
                      const typeConfig: Record<string, { label: string; icon: any; color: string }> = {
                        withdrawal_request: { label: 'Saque', icon: ArrowUpRight, color: 'text-violet-600' },
                        sale_refunded: { label: 'Reembolso', icon: RefreshCw, color: 'text-yellow-600' },
                        sale_chargeback: { label: 'Chargeback', icon: AlertTriangle, color: 'text-red-600' },
                        med: { label: 'MED', icon: Gavel, color: 'text-orange-600' },
                        affiliate_commission: { label: 'Comissao', icon: Users, color: 'text-[#2563eb]' },
                      };
                      const txType = typeConfig[withdrawal.transactionType] || { label: 'Transação', icon: DollarSign, color: 'text-gray-600' };
                      const TypeIcon = txType.icon;
                      
                      const getDetails = () => {
                        if (withdrawal.transactionType === 'withdrawal_request') {
                          return (
                            <div className="flex flex-col">
                              <span className="text-sm text-gray-900">
                                PIX: {withdrawal.pixData?.pixKey || withdrawal.pixKey || 'N/A'}
                              </span>
                              <span className="text-xs text-gray-500">
                                {withdrawal.rejectionReason ? `Motivo: ${withdrawal.rejectionReason}` : `ID: ${withdrawal.withdrawalId || withdrawal.id || 'N/A'}`}
                              </span>
                            </div>
                          );
                        }
                        if (withdrawal.transactionType === 'sale_refunded') {
                          return (
                            <div className="flex flex-col gap-1">
                              <span className="text-sm text-gray-900">
                                {withdrawal.productName || withdrawal.checkoutName || 'Produto'}
                              </span>
                              <span className="text-xs text-gray-500">
                                Cliente: {withdrawal.customerName || withdrawal.customer?.name || 'N/A'}
                              </span>
                              {withdrawal.reason && (
                                <span className="text-xs text-yellow-600">
                                  Motivo: {withdrawal.reason.length > 60 ? withdrawal.reason.substring(0, 60) + '...' : withdrawal.reason}
                                </span>
                              )}
                              {withdrawal.pixKey && (
                                <span className="text-xs text-emerald-600 font-medium">
                                  Chave PIX do cliente: {withdrawal.pixKey}
                                </span>
                              )}
                              {withdrawal.isRefundRequest && withdrawal.status === 'pending' && (
                                <div className="flex gap-1.5 mt-1">
                                  <Button
                                    size="sm"
                                    className="h-6 px-2 text-xs bg-violet-600 hover:bg-violet-700"
                                    data-testid={`btn-approve-refund-${withdrawal.id}`}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        const token = await auth.currentUser?.getIdToken();
                                        const resp = await fetch(`/api/seller/refunds/${withdrawal.id}/approve`, {
                                          method: 'POST',
                                          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                          body: JSON.stringify({})
                                        });
                                        if (!resp.ok) throw new Error((await resp.json()).error);
                                        toast({ title: 'Reembolso aprovado', description: 'O cliente receberá o valor.' });
                                        queryClient.invalidateQueries({ queryKey: ['seller-refunds'] });
                                        queryClient.invalidateQueries({ queryKey: ['/api/balance/summary'] });
                                      } catch (err: any) {
                                        toast({ variant: 'destructive', title: 'Erro', description: err.message });
                                      }
                                    }}
                                  >
                                    Aprovar
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        }
                        if (withdrawal.transactionType === 'sale_chargeback') {
                          return (
                            <div className="flex flex-col">
                              <span className="text-sm text-gray-900">
                                {withdrawal.productName || withdrawal.checkoutSnapshot?.title || withdrawal.checkoutName || 'Produto'}
                              </span>
                              <span className="text-xs text-gray-500">
                                Cliente: {withdrawal.customerName || withdrawal.customer?.name || 'N/A'}
                              </span>
                              {withdrawal._isAffiliateSideDebit && (
                                <span className="text-xs text-orange-500">Débito de comissão (venda sua)</span>
                              )}
                              {withdrawal.chargebackReason && (
                                <span className="text-xs text-red-500">Motivo: {withdrawal.chargebackReason}</span>
                              )}
                            </div>
                          );
                        }
                        if (withdrawal.transactionType === 'med') {
                          return (
                            <div className="flex flex-col">
                              <span className="text-sm text-gray-900">
                                {withdrawal.productName || withdrawal.checkoutSnapshot?.title || withdrawal.checkoutName || 'Produto'}
                              </span>
                              <span className="text-xs text-gray-500">
                                Cliente: {withdrawal.customerName || withdrawal.customer?.name || 'N/A'}
                              </span>
                              {withdrawal._isAffiliateSideDebit && (
                                <span className="text-xs text-orange-500">Débito de comissão (venda sua)</span>
                              )}
                              <span className="text-xs text-orange-500 font-medium">Mediação PIX em andamento</span>
                            </div>
                          );
                        }
                        if (withdrawal.transactionType === 'affiliate_commission') {
                          return (
                            <div className="flex flex-col">
                              <span className="text-sm text-gray-900">
                                {withdrawal.productName || withdrawal.checkoutSnapshot?.title || 'Produto afiliado'}
                              </span>
                              <span className="text-xs text-gray-500">
                                Comprador: {withdrawal.customerName || withdrawal.customer?.name || withdrawal.buyerName || 'N/A'}
                              </span>
                            </div>
                          );
                        }
                        return <span className="text-sm text-gray-500">-</span>;
                      };
                      
                      return (
                        <tr key={withdrawal.withdrawalId || withdrawal.id || index} className="hover:bg-muted/50 transition-colors border-b border-border" data-testid={`row-transaction-${index}`}>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-foreground">
                            <div className="flex flex-col">
                              <span className="font-medium">{date.toLocaleDateString('pt-BR')}</span>
                              <span className="text-xs text-muted-foreground">{date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1 sm:gap-2">
                              <TypeIcon className={`h-3 w-3 sm:h-4 sm:w-4 ${txType.color}`} />
                              <span className={`text-xs sm:text-sm font-medium ${txType.color}`}>{txType.label}</span>
                            </div>
                          </td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 hidden sm:table-cell text-xs sm:text-sm">
                            {getDetails()}
                          </td>
                          <td className={`px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap text-xs sm:text-sm font-semibold tabular-nums ${
                            withdrawal.transactionType === 'affiliate_commission' 
                              ? 'text-[#2563eb]' 
                              : ['sale_refunded', 'sale_chargeback', 'med'].includes(withdrawal.transactionType)
                                ? 'text-red-600'
                                : 'text-foreground'
                          }`}>
                            {showValues ? (
                              <>
                                {withdrawal.transactionType === 'affiliate_commission' && '+'}
                                {['sale_refunded', 'sale_chargeback', 'med'].includes(withdrawal.transactionType) && '-'}
                                {formatCurrency(withdrawal.amount || 0, withdrawal.currency || 'BRL')}
                              </>
                            ) : '••••••'}
                          </td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap">
                            <Badge variant={status.variant} className="font-medium text-xs">
                              {status.label}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-3 sm:px-6 py-12 sm:py-20">
                        <div className="flex flex-col items-center justify-center text-center">
                          <div className="mb-4 p-5 bg-violet-100 rounded-full">
                            {activeTransactionType === 'withdrawal_request' && <ArrowUpRight className="h-10 w-10 text-violet-600" />}
                            {activeTransactionType === 'sale_refunded' && <RefreshCw className="h-10 w-10 text-yellow-600" />}
                            {activeTransactionType === 'sale_chargeback' && <AlertTriangle className="h-10 w-10 text-red-600" />}
                            {activeTransactionType === 'med' && <Gavel className="h-10 w-10 text-orange-600" />}
                            {activeTransactionType === 'affiliate_commission' && <Users className="h-10 w-10 text-[#2563eb]" />}
                            {activeTransactionType === 'all' && <DollarSign className="h-10 w-10 text-violet-600" />}
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {activeTransactionType === 'withdrawal_request' && 'Nenhum saque solicitado'}
                            {activeTransactionType === 'sale_refunded' && 'Nenhum reembolso registrado'}
                            {activeTransactionType === 'sale_chargeback' && 'Nenhum chargeback registrado'}
                            {activeTransactionType === 'med' && 'Nenhum MED registrado'}
                            {activeTransactionType === 'affiliate_commission' && 'Nenhuma comissao registrada'}
                            {activeTransactionType === 'all' && 'Nenhuma transacao encontrada'}
                          </h3>
                          <p className="text-sm text-gray-600 max-w-md mb-4">
                            {activeTransactionType === 'withdrawal_request' && 'Seus saques aparecerao aqui. Quando solicitar um saque, ele ficara pendente ate o admin aprovar.'}
                            {activeTransactionType === 'sale_refunded' && 'Reembolsos solicitados pelos clientes aparecerao aqui.'}
                            {activeTransactionType === 'sale_chargeback' && 'Disputas de pagamento (chargebacks) aparecerao aqui.'}
                            {activeTransactionType === 'med' && 'Mediacoes e disputas do Mercado Livre aparecerao aqui.'}
                            {activeTransactionType === 'affiliate_commission' && 'Comissoes de vendas como afiliado aparecerao aqui.'}
                            {activeTransactionType === 'all' && 'Selecione uma categoria acima para ver transacoes especificas.'}
                          </p>
                          {activeTransactionType === 'withdrawal_request' && totals.available > 0 && (
                            <p className="text-xs text-violet-600 font-medium">
                              Você tem <strong>{formatCurrency(totals.available, 'BRL')}</strong> disponível para saque!
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            {/* PAGINAÇÃO */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 sm:px-4 py-3 border-t border-gray-200">
                <div className="text-xs sm:text-sm text-gray-500 order-last sm:order-first">
                  Mostrando {((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, filteredWithdrawals.length)} de {filteredWithdrawals.length}
                </div>
                <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    data-testid="button-prev-page"
                    className="h-8 w-8 p-0"
                  >
                    <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                  
                  {/* Páginas */}
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      
                      return (
                        <Button
                          key={pageNum}
                          size="sm"
                          variant={currentPage === pageNum ? 'default' : 'outline'}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`h-8 w-8 p-0 text-xs sm:text-sm ${currentPage === pageNum ? 'bg-violet-600' : ''}`}
                          data-testid={`button-page-${pageNum}`}
                        >
                          {pageNum}
                        </Button>
                      );
                    })}
                    {totalPages > 5 && currentPage < totalPages - 2 && (
                      <>
                        <span className="text-gray-400 px-0.5 sm:px-1 text-xs">...</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCurrentPage(totalPages)}
                          className="h-8 w-8 p-0 text-xs sm:text-sm"
                          data-testid={`button-page-${totalPages}`}
                        >
                          {totalPages}
                        </Button>
                      </>
                    )}
                  </div>
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    data-testid="button-next-page"
                    className="h-8 w-8 p-0"
                  >
                    <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
