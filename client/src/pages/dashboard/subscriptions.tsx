import React, { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { auth } from "@/lib/firebase";
import { apiRequest } from "@/lib/queryClient";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CheckCircle2, XCircle, Clock, Ban, RefreshCw, ChevronLeft, ChevronRight, MoreVertical, XOctagon, User, Users2, Download, Plus, ChevronDown, SlidersHorizontal, Sparkles, Bell, HelpCircle, Eye, EyeOff, AlertCircle, Mail, MessageCircle, BrainCircuit, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface Subscription {
  id: string;
  customerName: string;
  customerEmail: string;
  productName: string;
  productId?: string;
  offerId?: string;
  offerName?: string;
  checkoutId?: string;
  amount: number;
  currency: string;
  status: 'active' | 'expiring' | 'expired' | 'cancelled';
  nextBillingDate: string;
  recurringCount: number;
  autoRenew: boolean;
  createdAt: string;
  affiliateId?: string;
  affiliateName?: string;
  affiliateEmail?: string;
  period?: string;
  billingCycle?: string;
}

const getPeriodLabel = (sub: Subscription): string => {
  const raw = sub.period || sub.billingCycle || '';
  const map: Record<string, string> = {
    'monthly': 'Mensal',
    'mensal': 'Mensal',
    'quarterly': 'Trimestral',
    'trimestral': 'Trimestral',
    'semiannual': 'Semestral',
    'semestral': 'Semestral',
    'annual': 'Anual',
    'anual': 'Anual',
    'yearly': 'Anual',
  };
  return map[raw.toLowerCase()] || 'Mensal';
};

const getPeriodKey = (sub: Subscription): string => {
  const label = getPeriodLabel(sub);
  const keyMap: Record<string, string> = {
    'Mensal': 'mensal',
    'Trimestral': 'trimestral',
    'Semestral': 'semestral',
    'Anual': 'anual',
  };
  return keyMap[label] || 'mensal';
};

interface SubscriptionStats {
  active: number;
  expiring: number;
  expired: number;
  cancelled: number;
  revenueGross: number;
  revenueNet: number;
  fees: number;
  nextMonthForecast: number;
  expectedRenewals: number;
}

const ITEMS_PER_PAGE = 10;

export default function SubscriptionsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [offerFilter, setOfferFilter] = useState<string>("all");
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'subscribers' | 'regua'>('subscribers');
  const [hideValues, setHideValues] = useState(false);
  const [reguaToggles, setReguaToggles] = useState({
    dias7: false,
    dias3: true,
    dia1antes: true,
    vencimento: true,
    dia1depois: true,
    dia2depois: false,
    dia3depois: false,
  });
  const [reguaSaving, setReguaSaving] = useState(false);
  const [reguaLoaded, setReguaLoaded] = useState(false);
  const [testingTrigger, setTestingTrigger] = useState<string | null>(null);
  const toggleRegua = (key: keyof typeof reguaToggles) =>
    setReguaToggles(prev => ({ ...prev, [key]: !prev[key] }));
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const checkAdmin = async () => {
      if (!auth.currentUser) { setIsAdmin(false); setAdminCheckComplete(true); return; }
      try {
        const tokenResult = await auth.currentUser.getIdTokenResult();
        setIsAdmin(tokenResult.claims.admin === true);
        setAdminCheckComplete(true);
      } catch { setIsAdmin(false); setAdminCheckComplete(true); }
    };
    checkAdmin();
  }, [user]);

  // Carregar reguaConfig do seller
  useEffect(() => {
    if (!user || reguaLoaded) return;
    const loadRegua = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch('/api/sellers/profile', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const cfg = data?.seller?.reguaConfig || data?.reguaConfig || null;
        if (cfg && typeof cfg === 'object') {
          setReguaToggles(prev => ({
            ...prev,
            dias7:      typeof cfg.dias7      === 'boolean' ? cfg.dias7      : prev.dias7,
            dias3:      typeof cfg.dias3      === 'boolean' ? cfg.dias3      : prev.dias3,
            dia1antes:  typeof cfg.dia1antes  === 'boolean' ? cfg.dia1antes  : prev.dia1antes,
            vencimento: typeof cfg.vencimento === 'boolean' ? cfg.vencimento : prev.vencimento,
            dia1depois: typeof cfg.dia1depois === 'boolean' ? cfg.dia1depois : prev.dia1depois,
            dia2depois: typeof cfg.dia2depois === 'boolean' ? cfg.dia2depois : prev.dia2depois,
            dia3depois: typeof cfg.dia3depois === 'boolean' ? cfg.dia3depois : prev.dia3depois,
          }));
        }
      } catch { /* silencioso */ } finally {
        setReguaLoaded(true);
      }
    };
    loadRegua();
  }, [user, reguaLoaded]);

  const saveReguaConfig = async () => {
    if (reguaSaving) return;
    setReguaSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Não autenticado');
      const res = await fetch('/api/subscriptions/save-regua', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reguaConfig: reguaToggles }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao salvar');
      toast({ title: 'Régua salva!', description: 'As configurações foram salvas e já estão ativas.' });
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setReguaSaving(false);
    }
  };

  const sendTestEmail = async (trigger: string) => {
    if (testingTrigger) return;
    setTestingTrigger(trigger);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Não autenticado');
      const res = await fetch('/api/subscriptions/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trigger }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao enviar');
      toast({ title: 'Email de teste enviado!', description: json.message });
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setTestingTrigger(null);
    }
  };

  const { data, isLoading } = useQuery<{ subscriptions: Subscription[]; stats: SubscriptionStats }>({
    queryKey: isAdmin
      ? ['/api/subscriptions?limit=1000']
      : [`/api/subscriptions?limit=1000&tenantId=${tenant?.id}`],
    enabled: adminCheckComplete && (isAdmin || !!tenant?.id),
  });

  const { data: productsResponse } = useQuery<{ products: Array<{ id: string; name: string }> }>({
    queryKey: isAdmin
      ? ["/api/products?productType=subscription&limit=9999"]
      : [`/api/products?productType=subscription&tenantId=${tenant?.id}&limit=9999`],
    enabled: adminCheckComplete && (isAdmin || !!tenant?.id),
  });

  const allSubscriptions = data?.subscriptions || [];
  const realProducts = productsResponse?.products || [];
  const stats = data?.stats || { active: 0, expiring: 0, expired: 0, cancelled: 0, revenueGross: 0, revenueNet: 0, fees: 0, nextMonthForecast: 0, expectedRenewals: 0 };

  const subscriptions = useMemo(() => {
    let filtered = [...allSubscriptions];
    if (periodFilter !== "all") {
      const now = new Date();
      const cutoffDate = periodFilter === "7" ? subDays(now, 7) : periodFilter === "30" ? subDays(now, 30) : periodFilter === "90" ? subDays(now, 90) : null;
      if (cutoffDate) filtered = filtered.filter(sub => new Date(sub.createdAt) >= cutoffDate);
    }
    if (statusFilter !== "all") filtered = filtered.filter(sub => sub.status === statusFilter);
    if (productFilter !== "all") filtered = filtered.filter(sub => (sub.productId || sub.checkoutId) === productFilter);
    if (offerFilter !== "all") filtered = filtered.filter(sub => (sub.offerId || sub.checkoutId) === offerFilter);
    if (cycleFilter !== "all") filtered = filtered.filter(sub => getPeriodKey(sub) === cycleFilter);
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      filtered = filtered.filter(sub =>
        sub.customerName?.toLowerCase().includes(q) ||
        sub.customerEmail?.toLowerCase().includes(q) ||
        sub.productName?.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allSubscriptions, periodFilter, statusFilter, productFilter, offerFilter, cycleFilter, searchFilter]);

  const uniqueProducts = useMemo(() => {
    const map = new Map<string, string>();
    realProducts.forEach((p: any) => { if (!map.has(p.id)) map.set(p.id, p.name ?? p.title ?? 'Produto sem nome'); });
    allSubscriptions.forEach(sub => {
      const pid = sub.productId || sub.checkoutId;
      if (pid && !map.has(pid)) map.set(pid, sub.productName || 'Produto');
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [realProducts, allSubscriptions]);

  const productIdToNameMap = useMemo(() => {
    const map = new Map<string, string>();
    realProducts.forEach((p: any) => map.set(p.id, p.name || 'Produto sem nome'));
    return map;
  }, [realProducts, allSubscriptions]);

  const uniqueOffers = useMemo(() => {
    if (productFilter === "all") return [];
    const offersMap = new Map();
    allSubscriptions
      .filter(sub => (sub.productId || sub.checkoutId) === productFilter)
      .forEach(sub => {
        const oid = sub.offerId || sub.checkoutId;
        if (!offersMap.has(oid)) offersMap.set(oid, sub.offerName || 'Oferta');
      });
    return Array.from(offersMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allSubscriptions, productFilter]);

  const formatCurrency = (value: number, currency: string = 'BRL') => {
    if (hideValues) return '••••';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value / 100);
  };

  const formatCount = (value: number) => hideValues ? '••' : value;

  const getPaginatedData = () => subscriptions.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const getTotalPages = () => Math.ceil(subscriptions.length / ITEMS_PER_PAGE);

  const cancelSubscriptionMutation = useMutation({
    mutationFn: async (subscriptionId: string) => apiRequest(`/api/subscriptions/${subscriptionId}/cancel`, 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      toast({ title: "Assinatura cancelada", description: "A assinatura foi cancelada com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao cancelar", description: error.message || "Não foi possível cancelar a assinatura.", variant: "destructive" });
    },
  });

  const handleCancelSubscription = (subscriptionId: string, customerName: string) => {
    if (confirm(`Tem certeza que deseja cancelar a assinatura de ${customerName}?`)) {
      cancelSubscriptionMutation.mutate(subscriptionId);
    }
  };

  const clearFilters = () => {
    setPeriodFilter("all");
    setStatusFilter("all");
    setProductFilter("all");
    setOfferFilter("all");
    setCycleFilter("all");
    setSearchFilter("");
    setCurrentPage(1);
  };

  const exportToCSV = () => {
    const headers = ['Cliente', 'Email', 'Produto', 'Oferta', 'Valor (R$)', 'Ciclo', 'Status', 'Próx. Cobrança', 'Cobranças', 'Criado em'];
    const rows = subscriptions.map(sub => [
      sub.customerName || '',
      sub.customerEmail || '',
      sub.productName || '',
      sub.offerName || '',
      (sub.amount / 100).toFixed(2).replace('.', ','),
      getPeriodLabel(sub),
      sub.status,
      sub.nextBillingDate ? format(new Date(sub.nextBillingDate), 'dd/MM/yyyy', { locale: ptBR }) : '',
      sub.recurringCount || 1,
      sub.createdAt ? format(new Date(sub.createdAt), 'dd/MM/yyyy', { locale: ptBR }) : '',
    ]);
    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `assinaturas_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; icon: any; color: string }> = {
      active:    { label: 'Ativa',     icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
      expiring:  { label: 'Vencendo',  icon: Clock,        color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
      expired:   { label: 'Vencida',   icon: XCircle,      color: 'text-red-600 bg-red-50 border-red-200' },
      cancelled: { label: 'Cancelada', icon: Ban,          color: 'text-gray-500 bg-gray-100 border-gray-200' },
    };
    const v = variants[status] || variants.active;
    const Icon = v.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${v.color}`}>
        <Icon className="h-3 w-3" />
        {v.label}
      </span>
    );
  };

  const renderPagination = () => {
    const totalPages = getTotalPages();
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-center gap-2 mt-6">
        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
          className="p-1.5 rounded-md border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300 disabled:opacity-30 transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
          <button key={page} onClick={() => setCurrentPage(page)}
            className={`min-w-[32px] h-8 rounded-md text-sm font-medium transition-colors border ${currentPage === page ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}>
            {page}
          </button>
        ))}
        <button onClick={() => setCurrentPage(p => Math.min(getTotalPages(), p + 1))} disabled={currentPage === getTotalPages()}
          className="p-1.5 rounded-md border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-300 disabled:opacity-30 transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const statCards = [
    { key: 'mrr',       label: 'MRR',        value: formatCurrency(stats.revenueGross), accent: '#2563eb',  hint: true },
    { key: 'active',    label: 'ATIVAS',      value: formatCount(stats.active),          accent: '#0d9488',  hint: false },
    { key: 'expiring',  label: 'VENCENDO',    value: formatCount(stats.expiring),        accent: '#ca8a04',  hint: false, color: '#ca8a04' },
    { key: 'expired',   label: 'VENCIDAS',    value: formatCount(stats.expired),         accent: '#dc2626',  hint: false, color: '#dc2626' },
    { key: 'cancelled', label: 'CANCELADAS',  value: formatCount(stats.cancelled),       accent: '#6b7280',  hint: false },
    { key: 'forecast',  label: 'PRÓX. MÊS',  value: formatCurrency(stats.nextMonthForecast), accent: '#2563eb', hint: true },
  ];

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-4 md:py-6 space-y-5 bg-gray-50 min-h-full">

        {/* ── HEADER ── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Assinaturas</h1>
            <p className="text-sm text-gray-500 mt-0.5">Gerencie assinantes, automações e régua de cobrança</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportToCSV}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors bg-white">
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </button>
            <button
              onClick={() => navigate('/dashboard/products-list')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors">
              <Plus className="h-4 w-4" />
              Novo Produto
            </button>
          </div>
        </div>

        {/* ── STAT CARDS ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {statCards.map(card => (
            <div key={card.key}
              className="relative rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: card.accent }} />
              <div className="p-4 pt-5">
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase">{card.label}</span>
                  {card.hint && <HelpCircle className="h-3 w-3 text-gray-300" />}
                </div>
                <div className={`text-xl font-bold ${card.color ? '' : 'text-gray-900'}`} style={card.color ? { color: card.color } : {}}>
                  {card.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── OCULTAR VALORES ── */}
        <div className="flex justify-end">
          <button onClick={() => setHideValues(v => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            {hideValues ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {hideValues ? 'Mostrar valores' : 'Ocultar valores'}
          </button>
        </div>

        {/* ── MAIN CARD ── */}
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">

          {/* TABS */}
          <div className="border-b border-gray-200 px-5">
            <div className="flex items-center gap-0">
              {[
                { key: 'subscribers', label: 'Assinantes',        icon: User },
                { key: 'regua',       label: 'Régua de Cobrança', icon: Bell },
              ].map(tab => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`inline-flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                      active
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-400 hover:text-gray-700'
                    }`}>
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* CONTENT */}
          <div className="p-5">
            {activeTab === 'subscribers' ? (
              <>
                {/* FILTERS */}
                <div className="flex flex-wrap items-end gap-3 mb-6">
                  {/* Busca */}
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Busca</label>
                    <input
                      type="text"
                      placeholder="Nome, email, produto..."
                      value={searchFilter}
                      onChange={e => setSearchFilter(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-400 transition-colors"
                    />
                  </div>

                  {/* Status */}
                  <div className="min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-9 border-gray-200 bg-white text-sm text-gray-900 focus:border-blue-400 focus:ring-0">
                        <SelectValue placeholder="Todos os status" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200 text-gray-900">
                        <SelectItem value="all">Todos os status</SelectItem>
                        <SelectItem value="active">Ativas</SelectItem>
                        <SelectItem value="expiring">Vencendo</SelectItem>
                        <SelectItem value="expired">Vencidas</SelectItem>
                        <SelectItem value="cancelled">Canceladas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Período */}
                  <div className="min-w-[150px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Período</label>
                    <Select value={periodFilter} onValueChange={setPeriodFilter}>
                      <SelectTrigger className="h-9 border-gray-200 bg-white text-sm text-gray-900 focus:border-blue-400 focus:ring-0">
                        <SelectValue placeholder="Todo período" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200 text-gray-900">
                        <SelectItem value="all">Todo período</SelectItem>
                        <SelectItem value="7">Últimos 7 dias</SelectItem>
                        <SelectItem value="30">Últimos 30 dias</SelectItem>
                        <SelectItem value="90">Últimos 90 dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Ciclo */}
                  <div className="min-w-[155px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Ciclo</label>
                    <Select value={cycleFilter} onValueChange={setCycleFilter}>
                      <SelectTrigger className="h-9 border-gray-200 bg-white text-sm text-gray-900 focus:border-blue-400 focus:ring-0">
                        <SelectValue placeholder="Todos os ciclos" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200 text-gray-900">
                        <SelectItem value="all">Todos os ciclos</SelectItem>
                        <SelectItem value="mensal">Mensal</SelectItem>
                        <SelectItem value="trimestral">Trimestral</SelectItem>
                        <SelectItem value="semestral">Semestral</SelectItem>
                        <SelectItem value="anual">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Produto */}
                  <div className="min-w-[170px]">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Produto</label>
                    <Select value={productFilter} onValueChange={v => { setProductFilter(v); setOfferFilter("all"); }}>
                      <SelectTrigger className="h-9 border-gray-200 bg-white text-sm text-gray-900 focus:border-blue-400 focus:ring-0">
                        <SelectValue placeholder="Todos os produtos" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200 text-gray-900">
                        <SelectItem value="all">Todos os produtos</SelectItem>
                        {uniqueProducts.map(([id, name]) => (
                          <SelectItem key={id} value={id}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Oferta (cascateada) */}
                  {productFilter !== "all" && uniqueOffers.length > 0 && (
                    <div className="min-w-[150px]">
                      <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Oferta</label>
                      <Select value={offerFilter} onValueChange={setOfferFilter}>
                        <SelectTrigger className="h-9 border-gray-200 bg-white text-sm text-gray-900 focus:border-blue-400 focus:ring-0">
                          <SelectValue placeholder="Todas as ofertas" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-gray-200 text-gray-900">
                          <SelectItem value="all">Todas as ofertas</SelectItem>
                          {uniqueOffers.map(([id, name]) => (
                            <SelectItem key={id} value={id}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Limpar filtros */}
                  <button onClick={clearFilters}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 transition-colors bg-white self-end">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Limpar filtros
                  </button>
                </div>

                {/* TABLE / EMPTY STATE */}
                {isLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-gray-500" />
                  </div>
                ) : subscriptions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-12 h-12 rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center mb-4">
                      <RefreshCw className="h-5 w-5 text-gray-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-700">Nenhuma assinatura encontrada</p>
                    <p className="text-xs text-gray-400 mt-1">Tente alterar os filtros ou aguarde novas vendas</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {['Cliente', 'Produto', 'Oferta', 'Valor', 'Próx. Cobrança', 'Ciclo', 'Origem', 'Status', ''].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold tracking-widest text-gray-400 uppercase whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {getPaginatedData().map((sub, i) => {
                          const productId = sub.productId || sub.checkoutId;
                          const productName = (productId ? productIdToNameMap.get(productId) : null) || sub.productName || '-';
                          return (
                            <tr key={sub.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-3">
                                <div className="font-medium text-gray-900 truncate max-w-[160px]">{sub.customerName}</div>
                                <div className="text-xs text-gray-400 truncate max-w-[160px]">{sub.customerEmail}</div>
                              </td>
                              <td className="px-3 py-3">
                                <span className="text-gray-700 truncate max-w-[120px] block">{productName}</span>
                              </td>
                              <td className="px-3 py-3">
                                <span className="text-gray-400 truncate max-w-[100px] block">{sub.offerName || '-'}</span>
                              </td>
                              <td className="px-3 py-3">
                                <span className="font-semibold text-gray-900 tabular-nums">
                                  {hideValues ? '••••' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: sub.currency || 'BRL' }).format(sub.amount / 100)}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span className="text-gray-500 text-xs">
                                  {format(new Date(sub.nextBillingDate), "dd/MM/yy", { locale: ptBR })}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-col items-start gap-0.5">
                                  <span className="px-2 py-0.5 rounded-full text-[11px] border border-gray-200 text-gray-600 bg-gray-50">
                                    {getPeriodLabel(sub)}
                                  </span>
                                  <span className="text-[10px] text-gray-400">{sub.recurringCount || 1}ª cobrança</span>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                {sub.affiliateId ? (
                                  <div className="flex items-center gap-1.5">
                                    <Users2 className="h-3.5 w-3.5 text-blue-500" />
                                    <span className="text-xs text-gray-600">Afiliado</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <User className="h-3.5 w-3.5 text-gray-400" />
                                    <span className="text-xs text-gray-400">Direta</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {getStatusBadge(sub.status)}
                              </td>
                              <td className="px-3 py-3">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                                      <MoreVertical className="h-4 w-4" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="bg-white border-gray-200 text-gray-900">
                                    {sub.status === 'active' && (
                                      <DropdownMenuItem
                                        className="text-red-600 cursor-pointer focus:bg-red-50 focus:text-red-600"
                                        onClick={() => handleCancelSubscription(sub.id, sub.customerName)}
                                        disabled={cancelSubscriptionMutation.isPending}>
                                        <XOctagon className="h-4 w-4 mr-2" />
                                        Cancelar Assinatura
                                      </DropdownMenuItem>
                                    )}
                                    {(sub.status === 'cancelled' || sub.status === 'expired') && (
                                      <DropdownMenuItem disabled className="text-gray-400">
                                        {sub.status === 'cancelled' ? <Ban className="h-4 w-4 mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                                        {sub.status === 'cancelled' ? 'Já cancelada' : 'Expirada'}
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="mt-4 text-xs text-gray-400 text-center">
                      {subscriptions.length} {subscriptions.length === 1 ? 'assinatura encontrada' : 'assinaturas encontradas'}
                    </div>
                    {renderPagination()}
                  </div>
                )}
              </>
            ) : (
              /* ── RÉGUA DE COBRANÇA ── */
              <div className="space-y-1">
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Régua de Comunicação</h2>
                    <p className="text-xs text-gray-500 mt-1 max-w-xl">
                      Configure quando seus assinantes recebem notificações antes e depois do vencimento.
                      Sem débito automático - apenas avisos por email e WhatsApp.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={saveReguaConfig}
                    disabled={reguaSaving}
                    className="flex-shrink-0 text-xs h-8"
                  >
                    {reguaSaving ? 'Salvando...' : 'Salvar configuração'}
                  </Button>
                </div>

                {/* ── REGRAS ── */}
                {([
                  {
                    key: 'dias7' as const,
                    label: '7 dias antes',
                    sub: 'Lembrete antecipado de renovação',
                    icon: Clock,
                    iconColor: '#6b7280',
                    accentColor: '#6b7280',
                    channels: ['email'],
                    badge: null,
                  },
                  {
                    key: 'dias3' as const,
                    label: '3 dias antes',
                    sub: 'Aviso urgente de vencimento',
                    icon: Clock,
                    iconColor: '#6b7280',
                    accentColor: '#ca8a04',
                    channels: ['email', 'whatsapp'],
                    badge: null,
                  },
                  {
                    key: 'dia1antes' as const,
                    label: '1 dia antes',
                    sub: 'Último aviso antes do corte',
                    icon: Clock,
                    iconColor: '#6b7280',
                    accentColor: '#ea580c',
                    channels: ['email', 'whatsapp'],
                    badge: null,
                  },
                  {
                    key: 'vencimento' as const,
                    label: 'No vencimento',
                    sub: 'Notificação de acesso cortado',
                    icon: Clock,
                    iconColor: '#6b7280',
                    accentColor: '#dc2626',
                    channels: ['email', 'whatsapp'],
                    badge: 'Acesso cortado',
                  },
                  {
                    key: 'dia1depois' as const,
                    label: '+1 dia depois',
                    sub: 'Oferta de reativação - ainda dá tempo!',
                    icon: Clock,
                    iconColor: '#6b7280',
                    accentColor: '#7c3aed',
                    channels: ['email', 'whatsapp'],
                    badge: null,
                  },
                  {
                    key: 'dia2depois' as const,
                    label: '+2 dias depois',
                    sub: 'Recuperação - seu acesso ainda está esperando',
                    icon: Clock,
                    iconColor: '#6b7280',
                    accentColor: '#d97706',
                    channels: ['email', 'whatsapp'],
                    badge: null,
                  },
                  {
                    key: 'dia3depois' as const,
                    label: '+3 dias depois',
                    sub: 'Última chance de reativação',
                    icon: Clock,
                    iconColor: '#6b7280',
                    accentColor: '#dc2626',
                    channels: ['email', 'whatsapp'],
                    badge: 'Última notificação',
                  },
                ] as Array<{
                  key: keyof typeof reguaToggles;
                  label: string;
                  sub: string;
                  icon: React.ElementType;
                  iconColor: string;
                  accentColor: string;
                  channels: string[];
                  badge: string | null;
                }>).map((rule, idx, arr) => {
                  const Icon = rule.icon;
                  const active = reguaToggles[rule.key];
                  const isTesting = testingTrigger === rule.key;
                  return (
                    <div key={rule.key}>
                      <div
                        className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-all ${
                          active
                            ? 'border-gray-200 bg-white'
                            : 'border-gray-100 bg-gray-50 opacity-60'
                        }`}
                        style={{ borderLeft: `3px solid ${active ? rule.accentColor : '#d1d5db'}` }}
                      >
                        {/* Icon */}
                        <div
                          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                          style={{ background: `${rule.iconColor}18`, border: `1.5px solid ${rule.iconColor}40` }}
                        >
                          <Icon className="h-5 w-5" style={{ color: rule.iconColor }} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900">{rule.label}</span>
                            {rule.badge && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200">
                                {rule.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{rule.sub}</p>
                          {active && rule.channels.length > 0 && (
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {rule.channels.includes('email') && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border border-gray-200 text-gray-600 bg-gray-50">
                                  <Mail className="h-3 w-3" />
                                  Email
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                </span>
                              )}
                              {rule.channels.includes('whatsapp') && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border border-gray-200 text-gray-600 bg-gray-50">
                                  <MessageCircle className="h-3 w-3 text-emerald-500" />
                                  WhatsApp
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                </span>
                              )}
                              <button
                                onClick={() => sendTestEmail(rule.key)}
                                disabled={isTesting || !!testingTrigger}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Mail className="h-3 w-3" />
                                {isTesting ? 'Enviando...' : 'Testar'}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Toggle */}
                        <button
                          onClick={() => toggleRegua(rule.key)}
                          className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-all duration-300 focus:outline-none ${
                            active ? 'bg-blue-600' : 'bg-gray-200'
                          }`}
                          aria-pressed={active}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow bg-white transition-transform duration-300 ${
                              active ? 'translate-x-6' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                      {idx < arr.length - 1 && (
                        <div className="w-px h-3 bg-gray-200" style={{ marginLeft: '32px' }} />
                      )}
                    </div>
                  );
                })}

                {/* Aviso informativo */}
                <div className="mt-5 flex items-start gap-3 px-4 py-3 rounded-xl border border-yellow-200 bg-yellow-50">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-700">
                    Emails são enviados automaticamente pelo sistema a cada hora. WhatsApp requer integração ativa nas configurações. Clique em <strong>Testar</strong> para receber um email de exemplo no seu endereço cadastrado.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
