import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { PromotionalBanner } from "@/components/dashboard/promotional-banner";
import Admin2FAVerification from "@/components/Admin2FAVerification";
import { auth } from "@/lib/firebase";
import {
  TrendingUp,
  Clock,
  CheckCircle,
  Package,
  RefreshCw,
  Users,
  Store,
  Globe,
  Activity,
  Zap,
  CreditCard,
  FileText,
  Shield,
  Loader2,
  DollarSign,
  BarChart3,
  Wallet,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Order {
  id: string;
  amount: number;
  status: string;
  productType?: string;
  createdAt: any;
  paidAt?: any;
  method?: string;
  paymentMethod?: string;
  tenantId?: string;
}

interface AdminStats {
  totalUsers: number;
  totalSellers: number;
  totalCustomers: number;
  totalCheckouts: number;
  totalRevenue: number;
  totalPaidOrders: number;
  totalPendingOrders: number;
  totalPendingRevenue: number;
  gatewayProfit: number;
  pixRevenue: number;
  cardBrRevenue: number;
  cardGlobalRevenue: number;
  boletoRevenue: number;
  topSellers: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    revenue: number;
    orders: number;
  }>;
  salesByState: Array<{ state: string; count: number; revenue: number }>;
  ticketMedio: number;
  conversionRate: number;
  totalActiveSubscriptions: number;
  totalActiveProducts: number;
}

type DateFilter =
  | "today"
  | "yesterday"
  | "7d"
  | "15d"
  | "30d"
  | "45d"
  | "60d"
  | "90d"
  | "120d"
  | "total";

const fmt = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100
  );

export default function AdminDashboard() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter>("7d");
  const [show2FA, setShow2FA] = useState(false);
  const [verified2FA, setVerified2FA] = useState(false);
  const [checking2FA, setChecking2FA] = useState(true);
  const [twoFAError, setTwoFAError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const run2FACheck = useCallback(async (signal?: AbortSignal) => {
    setChecking2FA(true);
    setTwoFAError(false);
    try {
      let currentUser = auth.currentUser;
      if (!currentUser) {
        await new Promise<void>((resolve) => {
          const unsub = auth.onAuthStateChanged((u) => {
            unsub();
            currentUser = u;
            resolve();
          });
          setTimeout(() => resolve(), 3000);
        });
      }
      if (signal?.aborted) return;
      const token = await currentUser?.getIdToken();
      if (!token) {
        setChecking2FA(false);
        setVerified2FA(true);
        return;
      }
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch("/api/admin/2fa/status", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(fetchTimeout);
      if (signal?.aborted) return;
      const data = await res.json();
      if (data.isAdmin && data.requires2FA && !data.verified) {
        setShow2FA(true);
      } else {
        setVerified2FA(true);
      }
    } catch (error) {
      if (!signal?.aborted) setTwoFAError(true);
    } finally {
      if (!signal?.aborted) setChecking2FA(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    run2FACheck(controller.signal);
    return () => controller.abort();
  }, [run2FACheck]);

  const getAuthToken = async () =>
    (await auth.currentUser?.getIdToken()) || null;

  const handle2FAVerified = () => {
    setShow2FA(false);
    setVerified2FA(true);
    toast({ title: "Acesso liberado", description: "Verificação concluída." });
  };

  const handle2FACancel = () => {
    window.location.href = "/";
  };

  const getDateRange = (filter: DateFilter) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const daysMap: Record<string, number> = {
      today: 0,
      yesterday: 1,
      "7d": 7,
      "15d": 15,
      "30d": 30,
      "45d": 45,
      "60d": 60,
      "90d": 90,
      "120d": 120,
    };

    if (filter === "total") return null;
    if (filter === "today") return { start: today, end: endOfDay };
    if (filter === "yesterday") {
      const yesterdayStart = new Date(today);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(yesterdayStart);
      yesterdayEnd.setHours(23, 59, 59, 999);
      return { start: yesterdayStart, end: yesterdayEnd };
    }
    const days = daysMap[filter] || 7;
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    return { start, end: endOfDay };
  };

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setLoading(true);
        let token: string | null = null;
        if (auth.currentUser) {
          token = await auth.currentUser.getIdToken();
        } else {
          await new Promise<void>((resolve) => {
            const unsub = auth.onAuthStateChanged((user) => {
              unsub();
              resolve();
            });
            setTimeout(() => resolve(), 3000);
          });
          token = auth.currentUser
            ? await (auth.currentUser as any).getIdToken()
            : null;
        }

        if (!token) {
          console.warn("Admin dashboard: sem token de autenticação");
          setLoading(false);
          return;
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
        };
        const dateRange = getDateRange(dateFilter);
        const queryParams = new URLSearchParams();
        if (dateRange) {
          queryParams.append("startDate", dateRange.start.getTime().toString());
          queryParams.append("endDate", dateRange.end.getTime().toString());
        }
        queryParams.append("dateFilter", dateFilter);

        try {
          const ordersResponse = await fetch(
            `/api/admin/orders?${queryParams.toString()}`,
            { headers }
          );
          if (ordersResponse.ok) {
            const ordersData = await ordersResponse.json();
            setOrders(ordersData.orders || ordersData.data || []);
          }
        } catch (e) {
          console.warn("Erro ao carregar orders:", e);
        }

        try {
          const statsResponse = await fetch(`/api/admin/stats?${queryParams.toString()}`, { headers });
          if (statsResponse.ok) {
            const stats = await statsResponse.json();
            setAdminStats(stats);
          }
        } catch (e) {
          console.warn("Erro ao carregar stats:", e);
        }

        setLastUpdated(new Date());
        setLoading(false);
      } catch (error) {
        console.error("Erro ao carregar dashboard:", error);
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [dateFilter]);

  // Gera chave de data no fuso local (evita bug UTC no Brasil UTC-3)
  const toLocalDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const chartData = useMemo(() => {
    if (orders.length === 0) return [];
    const dateRange = getDateRange(dateFilter);
    const dayMap = new Map<string, { paid: number; pending: number }>();

    if (dateRange) {
      const currentDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      while (currentDate <= endDate) {
        dayMap.set(toLocalDateKey(currentDate), { paid: 0, pending: 0 });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    orders.forEach((order) => {
      const isPaid = order.status === "paid";
      const isPending = order.status === "pending";
      if (!isPaid && !isPending) return;

      const rawDate =
        isPaid && order.paidAt
          ? order.paidAt?.toDate
            ? order.paidAt.toDate()
            : new Date(order.paidAt)
          : order.createdAt?.toDate
          ? order.createdAt.toDate()
          : new Date(order.createdAt);

      const dateKey = toLocalDateKey(rawDate);
      if (!dayMap.has(dateKey)) dayMap.set(dateKey, { paid: 0, pending: 0 });

      const data = dayMap.get(dateKey)!;
      const amountInReais = (order.amount || 0) / 100;
      if (isPaid) data.paid += amountInReais;
      else data.pending += amountInReais;
    });

    return Array.from(dayMap.entries())
      .map(([date, values]) => ({
        date,
        label: (() => {
          const [y, mo, d] = date.split("-").map(Number);
          return new Date(y, mo - 1, d).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
          });
        })(),
        paid: Math.round(values.paid * 100) / 100,
        pending: Math.round(values.pending * 100) / 100,
        total: Math.round((values.paid + values.pending) * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [orders, dateFilter]);

  const paymentMethodsData = useMemo(() => {
    const total =
      (adminStats?.pixRevenue || 0) +
      (adminStats?.cardBrRevenue || 0) +
      (adminStats?.cardGlobalRevenue || 0) +
      (adminStats?.boletoRevenue || 0);

    const pct = (v: number) =>
      total > 0 ? Math.round((v / total) * 100) : 0;

    return [
      {
        key: "pix",
        label: "PIX",
        value: adminStats?.pixRevenue || 0,
        pct: pct(adminStats?.pixRevenue || 0),
        color: "#2563eb",
        icon: Zap,
        testId: "pix-revenue",
      },
      {
        key: "cardBr",
        label: "Cartão BR",
        value: adminStats?.cardBrRevenue || 0,
        pct: pct(adminStats?.cardBrRevenue || 0),
        color: "#3b82f6",
        icon: CreditCard,
        testId: "card-br-revenue",
      },
      {
        key: "cardGlobal",
        label: "Cartão Global",
        value: adminStats?.cardGlobalRevenue || 0,
        pct: pct(adminStats?.cardGlobalRevenue || 0),
        color: "#3b82f6",
        icon: Globe,
        testId: "card-global-revenue",
      },
      {
        key: "boleto",
        label: "Boleto",
        value: adminStats?.boletoRevenue || 0,
        pct: pct(adminStats?.boletoRevenue || 0),
        color: "#f59e0b",
        icon: FileText,
        testId: "boleto-revenue",
      },
    ];
  }, [adminStats]);

  const filters: { key: DateFilter; label: string }[] = [
    { key: "today", label: "Hoje" },
    { key: "yesterday", label: "Ontem" },
    { key: "7d", label: "7d" },
    { key: "15d", label: "15d" },
    { key: "30d", label: "30d" },
    { key: "45d", label: "45d" },
    { key: "60d", label: "60d" },
    { key: "90d", label: "90d" },
    { key: "120d", label: "120d" },
    { key: "total", label: "Total" },
  ];

  if (twoFAError && !verified2FA) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <Shield className="w-12 h-12 mx-auto text-yellow-500" />
            <h2 className="text-xl font-semibold">Erro na verificação</h2>
            <p className="text-muted-foreground">
              Não foi possível verificar o status de segurança.
            </p>
            <Button
              data-testid="button-retry-2fa"
              onClick={() => run2FACheck()}
              variant="default"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Tentar novamente
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (checking2FA || loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-500" />
            <p className="text-muted-foreground text-sm">
              {checking2FA ? "Verificando segurança..." : "Carregando dados..."}
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (show2FA && !verified2FA) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4">
            <Shield className="w-12 h-12 mx-auto text-emerald-500" />
            <h2 className="text-xl font-semibold">Verificação de Segurança</h2>
            <p className="text-muted-foreground">
              Complete a verificação para acessar o painel.
            </p>
          </div>
        </div>
        <Admin2FAVerification
          open={show2FA}
          onVerified={handle2FAVerified}
          onCancel={handle2FACancel}
          getAuthToken={getAuthToken}
        />
      </DashboardLayout>
    );
  }

  const liquidRevenue =
    (adminStats?.totalRevenue || 0) - (adminStats?.gatewayProfit || 0);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6" data-testid="admin-dashboard">
        <PromotionalBanner />

        {/* ── HEADER ── */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Painel Administrativo
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Visão geral do gateway de pagamentos
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-wrap gap-1">
              {filters.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setDateFilter(key)}
                  data-testid={`filter-${key}`}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                    dateFilter === key
                      ? "bg-emerald-600 text-white shadow"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-md px-2 py-1">
              <RefreshCw className="w-3 h-3" />
              {lastUpdated.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>

        {/* ── MÉTRICAS PRINCIPAIS ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Faturamento Total */}
          <Card className="col-span-2 lg:col-span-1 border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-600/5 to-transparent">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Faturamento Total
                  </p>
                  <p
                    className="text-2xl font-bold mt-1 tabular-nums"
                    data-testid="total-revenue"
                  >
                    {fmt(adminStats?.totalRevenue || 0)}
                  </p>
                  <p className="text-xs text-emerald-500 mt-1">
                    {adminStats?.totalPaidOrders || 0} transações pagas
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Lucro do Gateway */}
          <Card className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Lucro Gateway
                  </p>
                  <p
                    className="text-2xl font-bold mt-1 text-gray-900 tabular-nums"
                    data-testid="gateway-profit"
                  >
                    {fmt(adminStats?.gatewayProfit || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Margem líquida do gateway
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Valor Líquido */}
          <Card className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Repasse Sellers
                  </p>
                  <p className="text-2xl font-bold mt-1 text-gray-900 tabular-nums">
                    {fmt(liquidRevenue > 0 ? liquidRevenue : 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total repassado
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pendente */}
          <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-amber-600/5 to-transparent">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Valor Pendente
                  </p>
                  <p className="text-2xl font-bold mt-1 text-amber-400 tabular-nums">
                    {fmt(adminStats?.totalPendingRevenue || 0)}
                  </p>
                  <p className="text-xs text-amber-500 mt-1">
                    {adminStats?.totalPendingOrders || 0} aguardando
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── CONTADORES ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Transações Pagas", value: adminStats?.totalPaidOrders || 0, color: "text-emerald-500", testId: "paid-orders" },
            { label: "Pendentes", value: adminStats?.totalPendingOrders || 0, color: "text-amber-400", testId: "pending-orders" },
            { label: "Sellers Ativos", value: adminStats?.totalSellers || 0, color: "text-gray-900", testId: "total-sellers" },
            { label: "Clientes", value: adminStats?.totalCustomers || 0, color: "text-gray-900", testId: "total-customers" },
          ].map(({ label, value, color, testId }) => (
            <Card key={label} className="border-border/50">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-xl font-bold tabular-nums mt-1 ${color}`} data-testid={testId}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── MÉTRICAS AVANÇADAS ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ticket Médio</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 mt-1">{adminStats ? fmt(adminStats.ticketMedio || 0) : "-"}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Taxa de Conversão</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 mt-1">{adminStats ? `${adminStats.conversionRate || 0}%` : "-"}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Subscriptions Ativas</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 mt-1">{adminStats?.totalActiveSubscriptions ?? 0}</p>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Produtos Ativos</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 mt-1">{adminStats?.totalActiveProducts ?? 0}</p>
            </CardContent>
          </Card>
        </div>

        {/* ── GRÁFICO + MÉTODOS DE PAGAMENTO ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Gráfico de Vendas */}
          <Card className="lg:col-span-2 border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  Volume de Vendas
                </CardTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                    Pagas
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                    Pendentes
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {chartData.length > 0 ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 10, right: 4, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorPaid"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#10b981"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#10b981"
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="colorPending"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#f59e0b"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#f59e0b"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#374151"
                        opacity={0.25}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: "#6b7280" }}
                        stroke="transparent"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#6b7280" }}
                        stroke="transparent"
                        tickFormatter={(v) =>
                          v >= 1000
                            ? `R$${(v / 1000).toFixed(0)}k`
                            : `R$${v}`
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#111827",
                          border: "1px solid #1f2937",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "#f9fafb", fontWeight: 600 }}
                        formatter={(value: number, name: string) => [
                          `R$ ${value.toFixed(2)}`,
                          name,
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="paid"
                        name="Pagas"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorPaid)"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "#10b981", stroke: "#10b981", strokeWidth: 1 }}
                        activeDot={{ r: 6, fill: "#10b981" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="pending"
                        name="Pendentes"
                        stroke="#f59e0b"
                        fillOpacity={1}
                        fill="url(#colorPending)"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "#f59e0b", stroke: "#f59e0b", strokeWidth: 1 }}
                        activeDot={{ r: 6, fill: "#f59e0b" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <p className="text-sm">Sem dados para o período selecionado</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Métodos de Pagamento */}
          <Card className="border-border/50">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">
                Métodos de Pagamento
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {paymentMethodsData.map(
                ({ key, label, value, pct, color, testId }) => (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{label}</span>
                      <div className="text-right">
                        <span
                          className="text-xs font-bold tabular-nums"
                          data-testid={testId}
                        >
                          {fmt(value)}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-1">
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>
                )
              )}

              <div className="pt-2 border-t border-border/50 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total processado</span>
                  <span className="text-sm font-bold tabular-nums">
                    {fmt(
                      (adminStats?.pixRevenue || 0) +
                        (adminStats?.cardBrRevenue || 0) +
                        (adminStats?.cardGlobalRevenue || 0) +
                        (adminStats?.boletoRevenue || 0)
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── TOP 10 SELLERS ── */}
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Top 10 Sellers
              </CardTitle>
              {adminStats?.topSellers && adminStats.topSellers.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {adminStats.topSellers.length} seller
                  {adminStats.topSellers.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {adminStats?.topSellers && adminStats.topSellers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2 w-8">
                        #
                      </th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">
                        Seller
                      </th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">
                        Vendas
                      </th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">
                        Receita
                      </th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2 hidden sm:table-cell">
                        Participação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminStats.topSellers.slice(0, 10).map((seller, index) => {
                      const totalRev = adminStats.topSellers.reduce(
                        (sum, s) => sum + s.revenue,
                        0
                      );
                      const pct =
                        totalRev > 0
                          ? Math.round((seller.revenue / totalRev) * 100)
                          : 0;
                      const displayName =
                        seller.name && seller.name !== "Seller"
                          ? seller.name
                          : seller.email?.split("@")[0] || "Seller";

                      return (
                        <tr
                          key={seller.id}
                          data-testid={`seller-card-${index}`}
                          className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3 w-8">
                            <span
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                index === 0
                                  ? "bg-amber-400/20 text-amber-400"
                                  : index === 1
                                  ? "bg-gray-400/20 text-gray-400"
                                  : index === 2
                                  ? "bg-orange-400/20 text-orange-400"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {index + 1}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/30 to-violet-500/30 border border-border/50 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {displayName[0]?.toUpperCase() || "S"}
                              </div>
                              <div className="min-w-0">
                                <p
                                  className="text-sm font-medium truncate max-w-[150px]"
                                  title={displayName}
                                >
                                  {displayName}
                                </p>
                                <p
                                  className="text-xs text-muted-foreground truncate max-w-[150px]"
                                  title={seller.email}
                                >
                                  {seller.email || "-"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className="font-medium">{seller.orders}</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className="font-bold text-emerald-400">
                              {fmt(seller.revenue)}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-7 text-right">
                                {pct}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <p className="text-sm">Nenhum seller com vendas no período</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── RODAPÉ DE CONTADORES ── */}
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <Card className="border-border/40">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Checkouts</p>
              <p className="text-xl font-bold tabular-nums mt-1">{adminStats?.totalCheckouts || 0}</p>
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Usuários Registrados</p>
              <p className="text-xl font-bold tabular-nums mt-1">{adminStats?.totalUsers || 0}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
