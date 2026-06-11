import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTenantStore } from "@/stores/tenant";
import { auth } from "@/lib/firebase";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Download, Eye, EyeOff, ChevronDown, ArrowUpRight, TrendingUp,
  HelpCircle, RefreshCw, Calendar, Filter, Receipt, ArrowDownLeft,
  CreditCard, Banknote, ShoppingCart, RotateCcw, Zap
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/* ─── helpers ─── */
const fmt = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (ts: any): string => {
  try {
    const d = ts?._seconds ? new Date(ts._seconds * 1000) : ts ? new Date(ts) : null;
    if (!d || isNaN(d.getTime())) return "–";
    return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  } catch { return "–"; }
};

const tsToMs = (ts: any): number => {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

/* ─── types ─── */
type TabKey = "lancamentos" | "saida_pix" | "evolucao";
type PeriodKey = "7" | "30" | "90" | "365" | "all";

interface Entry {
  id: string;
  type: "sale" | "withdrawal" | "refund" | "commission";
  title: string;
  subtitle: string;
  method: string;
  amount: number; // cents, negative = debit
  ts: any;
  status: string;
}

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX", credit_card: "Cartão", boleto: "Boleto",
  card: "Cartão", bank_transfer: "TED", other: "Outro",
};

export default function ExtratoPage() {
  const { tenant } = useTenantStore();
  const [tab, setTab] = useState<TabKey>("lancamentos");
  const [hideValues, setHideValues] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [tipoSaldo, setTipoSaldo] = useState("todos");
  const [tipoTx, setTipoTx] = useState("todas");
  const [gateway, setGateway] = useState("todos");

  /* ── data ── */
  const { data: balanceSummary, isLoading: loadingBalance, refetch: refetchBalance } = useQuery<any>({
    queryKey: ["/api/balance/summary"],
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const { data: withdrawalsRaw = [], isLoading: loadingW } = useQuery<any[]>({
    queryKey: ["/api/withdrawals"],
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const { data: ordersRaw, isLoading: loadingO, refetch: refetchOrders } = useQuery<{ data: any[] }>({
    queryKey: [`/api/orders?tenantId=${tenant?.id}&limit=9999`],
    enabled: !!tenant?.id,
  });

  const isLoading = loadingBalance || loadingW || loadingO;

  /* ── saldos ── */
  const totals = (balanceSummary as any)?.totals?.BRL || { available: 0, pending: 0, reserved: 0, withdrawn: 0 };
  const saldoDisponivel = totals.available ?? 0;
  const saldoLiberar   = totals.pending  ?? 0;
  const saldoBloqueado = totals.reserved ?? 0;
  const saldoAtraso    = 0; // futuro

  /* ── merge entries ── */
  const allEntries: Entry[] = useMemo(() => {
    const withdrawals: Entry[] = (Array.isArray(withdrawalsRaw) ? withdrawalsRaw : []).map((w: any) => ({
      id: w.id || String(Math.random()),
      type: "withdrawal",
      title: w.status === "completed" ? "Saque realizado" : "Saque solicitado",
      subtitle: `Saque via PIX${w.pixKey ? ` - ${w.pixKey}` : ""}`,
      method: "pix",
      amount: -Math.abs(w.amount || 0),
      ts: w.createdAt,
      status: w.status || "pending",
    }));

    const orders: Entry[] = (ordersRaw?.data || [])
      .filter((o: any) => ["paid", "approved", "completed"].includes(o.status))
      .map((o: any) => ({
        id: o.id,
        type: "sale",
        title: o.checkoutTitle || o.productName || o.checkoutSnapshot?.title || "Venda aprovada",
        subtitle: o.customerName || o.customerEmail || "Cliente",
        method: o.paymentMethod || o.method || "pix",
        amount: Math.abs(o.netAmount || o.amount || 0),
        ts: o.paidAt || o.createdAt,
        status: o.status,
      }));

    return [...withdrawals, ...orders].sort((a, b) => tsToMs(b.ts) - tsToMs(a.ts));
  }, [withdrawalsRaw, ordersRaw]);

  /* ── period filter ── */
  const filtered = useMemo(() => {
    const now = Date.now();
    const days = period === "all" ? Infinity : Number(period);
    const cutoff = now - days * 86400000;
    return allEntries.filter(e => {
      const ms = tsToMs(e.ts);
      if (period !== "all" && ms < cutoff) return false;
      if (tipoTx !== "todas") {
        if (tipoTx === "venda" && e.type !== "sale") return false;
        if (tipoTx === "saque" && e.type !== "withdrawal") return false;
      }
      if (gateway !== "todos" && e.method !== gateway) return false;
      return true;
    });
  }, [allEntries, period, tipoTx, gateway]);

  /* ── exportar CSV ── */
  const exportCSV = () => {
    const header = ["Data", "Tipo", "Título", "Subtítulo", "Método", "Valor (R$)", "Status"];
    const rows = filtered.map(e => {
      const d = tsToMs(e.ts) ? new Date(tsToMs(e.ts)) : null;
      const dateStr = d ? format(d, "dd/MM/yyyy HH:mm", { locale: ptBR }) : "–";
      const typeLabel = e.type === "sale" ? "Venda" : e.type === "withdrawal" ? "Saque" : e.type === "refund" ? "Reembolso" : "Comissão";
      const methodLabel = METHOD_LABELS[e.method] ?? e.method.toUpperCase();
      const value = (e.amount / 100).toFixed(2).replace(".", ",");
      return [dateStr, typeLabel, e.title, e.subtitle, methodLabel, value, e.status];
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extrato_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mask = (v: string) => hideValues ? "••••" : v;

  /* ── color ── */
  const amtColor = (v: number) => v < 0 ? "text-red-400" : "text-emerald-400";
  const amtPrefix = (v: number) => v < 0 ? "-" : "+";

  /* ── method badge ── */
  const MethodBadge = ({ m }: { m: string }) => (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
      {METHOD_LABELS[m] ?? m.toUpperCase()}
    </span>
  );

  /* ── entry icon ── */
  const EntryIcon = ({ e }: { e: Entry }) => {
    if (e.type === "withdrawal") return (
      <div className="w-9 h-9 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
        <ArrowUpRight className="h-4 w-4 text-red-400" />
      </div>
    );
    if (e.type === "refund") return (
      <div className="w-9 h-9 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center flex-shrink-0">
        <RotateCcw className="h-4 w-4 text-yellow-400" />
      </div>
    );
    return (
      <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
        <ShoppingCart className="h-4 w-4 text-emerald-400" />
      </div>
    );
  };

  const TABS = [
    { key: "lancamentos" as TabKey, label: "Lançamentos", icon: Receipt },
    { key: "saida_pix"  as TabKey, label: "Saída PIX", icon: Zap },
    { key: "evolucao"   as TabKey, label: "Sua evolução", icon: TrendingUp },
  ];

  return (
    <DashboardLayout>
      <div className="px-3 md:px-6 py-4 md:py-6 space-y-5 min-h-screen bg-background">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-0.5">Extrato</p>
            <h1 className="text-2xl font-bold text-foreground">Extrato</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => { refetchBalance(); refetchOrders(); }}
              className="h-9 px-4 text-sm font-semibold rounded-lg"
              style={{ background: "#2563eb", color: "#0a0a0a" }}
            >
              <Filter className="h-4 w-4 mr-1.5" />
              Filtrar
            </Button>
            <div className="flex items-center rounded-lg border border-border overflow-hidden">
              <Button
                variant="ghost"
                className="h-9 px-4 text-sm font-medium text-foreground hover:text-foreground hover:bg-muted/40 rounded-none gap-2"
                onClick={exportCSV}
              >
                <Download className="h-4 w-4" />
                Exportar extrato
              </Button>
              <div className="w-px h-5 bg-muted" />
              <Button
                variant="ghost"
                className="h-9 px-2 hover:bg-muted/40 rounded-none"
                onClick={exportCSV}
              >
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Balance cards ── */}
        <div className="flex flex-wrap items-center gap-6 px-5 py-4 rounded-xl border border-border bg-card">
          <div className="space-y-0.5 min-w-[120px]">
            <p className="text-xs text-muted-foreground">Saldo disponível</p>
            <p className="text-xl font-bold text-foreground">
              {isLoading ? "..." : `R$ ${mask(fmt(saldoDisponivel))}`}
            </p>
          </div>
          <div className="w-px h-8 bg-muted/60 hidden sm:block" />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">Saldo a liberar</p>
              <HelpCircle className="h-3 w-3 text-muted-foreground/70" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {isLoading ? "..." : `R$ ${mask(fmt(saldoLiberar))}`}
            </p>
          </div>
          <div className="w-px h-8 bg-muted/60 hidden sm:block" />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">Saldo bloqueado</p>
              <HelpCircle className="h-3 w-3 text-muted-foreground/70" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {isLoading ? "..." : `R$ ${mask(fmt(saldoBloqueado))}`}
            </p>
          </div>
          <div className="w-px h-8 bg-muted/60 hidden sm:block" />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">Valor em atraso</p>
              <HelpCircle className="h-3 w-3 text-muted-foreground/70" />
            </div>
            <p className="text-sm font-semibold text-red-400">
              {isLoading ? "..." : `R$ ${mask(fmt(saldoAtraso))}`}
            </p>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setHideValues(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors ml-auto"
          >
            {hideValues
              ? <Eye className="h-4 w-4" />
              : <EyeOff className="h-4 w-4" />}
            {hideValues ? "Mostrar valores" : "Ocultar valores"}
          </button>
        </div>

        {/* ── Main card ── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">

          {/* Tabs */}
          <div className="flex border-b border-border px-5">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap mr-2 ${
                    active
                      ? "border-emerald-400 text-emerald-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === "lancamentos" && (
            <>
              {/* Filters */}
              <div className="flex flex-wrap items-end gap-3 px-5 py-4 border-b border-border">
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">Período</p>
                  <Select value={period} onValueChange={v => setPeriod(v as PeriodKey)}>
                    <SelectTrigger className="h-9 text-sm bg-muted/40 border-border text-foreground w-[180px] gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="7">Últimos 7 dias</SelectItem>
                      <SelectItem value="30">Últimos 30 dias</SelectItem>
                      <SelectItem value="90">Últimos 90 dias</SelectItem>
                      <SelectItem value="365">Último ano</SelectItem>
                      <SelectItem value="all">Todo o período</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">Tipo de saldo</p>
                  <Select value={tipoSaldo} onValueChange={setTipoSaldo}>
                    <SelectTrigger className="h-9 text-sm bg-muted/40 border-border text-foreground w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="disponivel">Disponível</SelectItem>
                      <SelectItem value="bloqueado">Bloqueado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">Tipo de transação</p>
                  <Select value={tipoTx} onValueChange={setTipoTx}>
                    <SelectTrigger className="h-9 text-sm bg-muted/40 border-border text-foreground w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="todas">Todas</SelectItem>
                      <SelectItem value="venda">Vendas</SelectItem>
                      <SelectItem value="saque">Saques</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">Gateway</p>
                  <Select value={gateway} onValueChange={setGateway}>
                    <SelectTrigger className="h-9 text-sm bg-muted/40 border-border text-foreground w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="todos">Todos os gateways</SelectItem>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="credit_card">Cartão de crédito</SelectItem>
                      <SelectItem value="boleto">Boleto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Transaction list */}
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="h-5 w-5 text-muted-foreground/70 animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center mb-3">
                    <Receipt className="h-5 w-5 text-muted-foreground/70" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">Nenhum lançamento encontrado</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Ajuste os filtros ou aguarde novos lançamentos</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {filtered.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-card transition-colors"
                    >
                      <EntryIcon e={entry} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{entry.title}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.subtitle}</p>
                        <div className="mt-1.5">
                          <MethodBadge m={entry.method} />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-semibold ${amtColor(entry.amount)}`}>
                          {amtPrefix(entry.amount)}R$ {mask(fmt(Math.abs(entry.amount)))}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">{fmtDate(entry.ts)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "saida_pix" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center mb-3">
                <Zap className="h-5 w-5 text-muted-foreground/70" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Saída PIX</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Histórico de saques via PIX realizados</p>
              <div className="divide-y divide-white/[0.04] w-full mt-6 text-left">
                {Array.isArray(withdrawalsRaw) && withdrawalsRaw.length > 0
                  ? withdrawalsRaw.map((w: any) => (
                    <div key={w.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-card transition-colors">
                      <div className="w-9 h-9 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                        <ArrowUpRight className="h-4 w-4 text-red-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{w.status === "completed" ? "Saque realizado" : "Saque solicitado"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{`Saque via PIX${w.pixKey ? ` - ${w.pixKey}` : ""}`}</p>
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">PIX</span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-red-400">-R$ {mask(fmt(Math.abs(w.amount || 0)))}</p>
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">{fmtDate(w.createdAt)}</p>
                      </div>
                    </div>
                  ))
                  : null}
              </div>
            </div>
          )}

          {tab === "evolucao" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center mb-3">
                <TrendingUp className="h-5 w-5 text-muted-foreground/70" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Sua evolução</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Gráfico de evolução de receita em breve</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
