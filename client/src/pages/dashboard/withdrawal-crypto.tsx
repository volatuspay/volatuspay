import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ArrowRight,
  TriangleAlert,
  CheckCircle,
  XCircle,
  Clock,
  Wallet,
} from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { queryClient } from "@/lib/queryClient";
import { format, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";

type Network = "TRC20" | "BEP20" | "ERC20" | "POLYGON";

const NETWORKS: { value: Network; label: string; sub: string; badge: string }[] = [
  { value: "TRC20",   label: "TRC20",   sub: "Tron Network",    badge: "TRX" },
  { value: "BEP20",   label: "BEP20",   sub: "BNB Smart Chain", badge: "BNB" },
  { value: "ERC20",   label: "ERC20",   sub: "Ethereum",        badge: "ETH" },
  { value: "POLYGON", label: "Polygon", sub: "MATIC Network",   badge: "POL" },
];

function fmtBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(date: any): string {
  if (!date) return "—";
  try {
    const secs = date._seconds ?? date.seconds;
    const d = secs ? new Date(secs * 1000) : new Date(date);
    return isValid(d) ? format(d, "dd/MM/yy · HH:mm", { locale: ptBR }) : "—";
  } catch { return "—"; }
}

function truncateWallet(addr: string) {
  if (!addr || addr.length < 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export default function WithdrawalCryptoPage() {
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState("");
  const [network, setNetwork] = useState<Network>("TRC20");

  const { data: balanceSummary, isLoading: isLoadingBalance } = useQuery({
    queryKey: ["/api/balance/summary"],
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const totals = (balanceSummary as any)?.totals?.BRL || {
    available: 0, pending: 0, reserved: 0, withdrawn: 0,
  };

  const { data: cryptoRateData, dataUpdatedAt } = useQuery<{ rate: number; updatedAt: string }>({
    queryKey: ["/api/withdrawals/crypto/rate"],
    refetchInterval: 60000,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    enabled: !!user,
  });

  const { data: cryptoHistory = [], isLoading: isLoadingHistory } = useQuery<any[]>({
    queryKey: ["/api/withdrawals/crypto"],
    refetchOnWindowFocus: false,
    staleTime: 30000,
    enabled: !!user,
  });

  const usdRate = cryptoRateData?.rate ?? 5.2;
  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const usdtEquivalent = amountCents > 0 ? (amountCents / 100 / usdRate).toFixed(2) : "0.00";
  const availableUsdt = totals.available > 0 ? (totals.available / 100 / usdRate).toFixed(2) : "0.00";

  const insufficientFunds = amountCents > totals.available && totals.available > 0;
  const belowMinimum = amountCents > 0 && amountCents < 40000;

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/withdrawals/crypto", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro ao solicitar saque" }));
        throw new Error(err.error || "Erro ao solicitar saque");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Solicitação enviada", description: "Saldo reservado. O saque será processado em até 24h úteis." });
      setAmount("");
      setWallet("");
      queryClient.invalidateQueries({ queryKey: ["/api/balance/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawals/crypto"] });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const canSubmit = !mutation.isPending && amountCents >= 40000 && amountCents <= totals.available && wallet.trim().length >= 10;
  const selectedNet = NETWORKS.find(n => n.value === network)!;
  const rateUpdated = dataUpdatedAt ? format(new Date(dataUpdatedAt), "HH:mm") : null;

  const handleSubmit = () => {
    if (amountCents < 40000) { toast({ title: "Valor mínimo: R$ 400,00", variant: "destructive" }); return; }
    if (amountCents > totals.available) { toast({ title: "Saldo insuficiente", variant: "destructive" }); return; }
    if (!wallet.trim() || wallet.trim().length < 10) { toast({ title: "Endereço de carteira inválido", variant: "destructive" }); return; }
    mutation.mutate({ amountBRL: amountCents, walletAddress: wallet.trim(), usdtAmount: parseFloat(usdtEquivalent), usdRate, network });
  };

  const statusMap = {
    pending:  { icon: <Clock className="h-3 w-3" />,       label: "Pendente",  cls: "text-amber-600 dark:text-amber-400" },
    approved: { icon: <CheckCircle className="h-3 w-3" />, label: "Enviado",   cls: "text-emerald-600 dark:text-emerald-400" },
    rejected: { icon: <XCircle className="h-3 w-3" />,     label: "Rejeitado", cls: "text-red-500 dark:text-red-400" },
  } as any;

  return (
    <DashboardLayout>
      <div className="px-3 md:px-5 pb-10">

        {/* ── Cabeçalho ── */}
        <div className="flex items-start justify-between gap-3 pt-1 pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">Conversão</p>
            <h1 className="text-xl font-bold text-foreground leading-tight tracking-tight">PIX → USDT</h1>
          </div>
          <div className="flex flex-col items-end gap-0.5 pt-1">
            <span className="text-[13px] font-bold text-foreground tabular-nums">1 USDT = R$ {usdRate.toFixed(2)}</span>
            {rateUpdated && (
              <span className="text-[10px] text-muted-foreground">atualizado às {rateUpdated}</span>
            )}
          </div>
        </div>

        {/* ── Saldo — linha horizontal ── */}
        <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-white dark:bg-[#0f1117] overflow-hidden mb-4">
          <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-white/[0.06]">
            {/* Disponível */}
            <div className="px-5 py-4 col-span-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Disponível para saque</p>
              {isLoadingBalance ? (
                <div className="space-y-1.5">
                  <div className="w-32 h-7 bg-muted animate-pulse rounded-lg" />
                  <div className="w-20 h-3 bg-muted animate-pulse rounded" />
                </div>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums tracking-tight">
                    R$ {fmtBRL(totals.available)}
                  </p>
                  <p className="text-xs text-muted-foreground font-medium mt-0.5 tabular-nums">
                    ≈ {availableUsdt} USDT
                  </p>
                </>
              )}
            </div>
            {/* Pendente */}
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Pendente</p>
              {isLoadingBalance
                ? <div className="w-24 h-6 bg-muted animate-pulse rounded" />
                : <p className="text-xl font-bold text-gray-700 dark:text-gray-300 tabular-nums">R$ {fmtBRL(totals.pending)}</p>
              }
            </div>
            {/* Sacado */}
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Total sacado</p>
              {isLoadingBalance
                ? <div className="w-24 h-6 bg-muted animate-pulse rounded" />
                : <p className="text-xl font-bold text-gray-700 dark:text-gray-300 tabular-nums">R$ {fmtBRL(totals.withdrawn)}</p>
              }
            </div>
          </div>
        </div>

        {/* ── Abas: Conversão | Extrato ── */}
        <Tabs defaultValue="converter">
          <TabsList className="mb-4 h-9 bg-gray-100 dark:bg-white/[0.06] rounded-xl p-1">
            <TabsTrigger
              value="converter"
              className="rounded-lg text-xs font-semibold px-5 text-gray-500 dark:text-gray-400 data-[state=active]:bg-white dark:data-[state=active]:bg-[#1a1d27] data-[state=active]:text-gray-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Nova conversão
            </TabsTrigger>
            <TabsTrigger
              value="extrato"
              className="rounded-lg text-xs font-semibold px-5 text-gray-500 dark:text-gray-400 data-[state=active]:bg-white dark:data-[state=active]:bg-[#1a1d27] data-[state=active]:text-gray-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Extrato
              {(cryptoHistory as any[]).length > 0 && (
                <span className="ml-1.5 text-[9px] font-bold bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-400 rounded-full px-1.5 py-px">
                  {(cryptoHistory as any[]).length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── ABA: CONVERTER ── */}
          <TabsContent value="converter" className="mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Coluna esquerda: bloco de conversão */}
              <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-white dark:bg-[#0f1117] overflow-hidden">
                <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-white/[0.06]">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Você envia e recebe</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Converta seu saldo BRL em USDT</p>
                </div>
                <div className="px-5 py-5 space-y-0">
                  {/* Entrada BRL */}
                  <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02] overflow-hidden">
                    <div className="px-4 pt-4 pb-3">
                      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground block mb-2">
                        Você envia (BRL)
                      </Label>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-muted-foreground shrink-0">R$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="400"
                          placeholder="0,00"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="border-0 bg-transparent text-2xl font-bold h-auto py-0 px-0 shadow-none focus-visible:ring-0 text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
                          data-testid="input-crypto-amount"
                        />
                        <span className="text-[11px] font-semibold text-muted-foreground border border-gray-300 dark:border-white/10 px-2 py-0.5 rounded-md shrink-0">PIX</span>
                      </div>
                      {belowMinimum && (
                        <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
                          <TriangleAlert className="h-3 w-3" /> Mínimo R$ 400,00
                        </p>
                      )}
                      {insufficientFunds && (
                        <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
                          <TriangleAlert className="h-3 w-3" /> Saldo insuficiente
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 px-4 py-2.5 border-y border-gray-200 dark:border-white/[0.06]">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-[11px] text-muted-foreground">
                        Cotação: <span className="font-semibold text-gray-700 dark:text-gray-300">1 USDT = R$ {usdRate.toFixed(2)}</span>
                      </span>
                    </div>

                    <div className="px-4 pt-3 pb-4">
                      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground block mb-2">
                        Você recebe (USDT)
                      </Label>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{usdtEquivalent}</span>
                        <span className="text-[11px] font-semibold text-muted-foreground border border-gray-300 dark:border-white/10 px-2 py-0.5 rounded-md shrink-0">USDT</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Coluna direita: rede + carteira + como funciona + botão */}
              <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-white dark:bg-[#0f1117] overflow-hidden">
                <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-white/[0.06]">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Destino do envio</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Rede e endereço da carteira</p>
                </div>
                <div className="px-5 py-5 space-y-5">

                  {/* Rede */}
                  <div className="space-y-2">
                    <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Rede de envio</Label>
                    <Select value={network} onValueChange={(v: any) => setNetwork(v)}>
                      <SelectTrigger className="h-11 rounded-xl border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]" data-testid="select-crypto-network">
                        <SelectValue>
                          <div className="flex items-center gap-2.5">
                            <span className="text-[10px] font-bold border border-gray-300 dark:border-white/10 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded font-mono">
                              {selectedNet.badge}
                            </span>
                            <span className="font-semibold text-sm">{selectedNet.label}</span>
                            <span className="text-xs text-muted-foreground">{selectedNet.sub}</span>
                          </div>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {NETWORKS.map((n) => (
                          <SelectItem key={n.value} value={n.value}>
                            <div className="flex items-center gap-2.5 py-0.5">
                              <span className="text-[10px] font-bold border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                                {n.badge}
                              </span>
                              <span className="font-medium">{n.label}</span>
                              <span className="text-muted-foreground text-xs">{n.sub}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Carteira */}
                  <div className="space-y-2">
                    <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Endereço da carteira · {selectedNet.label}
                    </Label>
                    <div className="relative">
                      <Wallet className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder={`Endereço USDT ${network}`}
                        value={wallet}
                        onChange={(e) => setWallet(e.target.value)}
                        className="h-11 pl-10 font-mono text-sm rounded-xl border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]"
                        data-testid="input-crypto-wallet"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 pt-0.5">
                      <TriangleAlert className="h-3 w-3 shrink-0 mt-px text-amber-500" />
                      Verifique o endereço. Envios para endereços incorretos são irreversíveis.
                    </p>
                  </div>

                  {/* Como funciona */}
                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Como funciona</p>
                    <div className="space-y-2">
                      {[
                        "Saldo debitado e reservado imediatamente.",
                        "Admin processa e envia o USDT em até 24h úteis.",
                        "Se rejeitado, o valor é devolvido automaticamente.",
                      ].map((text, i) => (
                        <div key={i} className="flex items-start gap-2.5">
                          <span className="text-[10px] font-bold text-muted-foreground mt-px w-3.5 shrink-0">{i + 1}.</span>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{text}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Botão */}
                  <Button
                    className="w-full h-11 text-sm font-bold rounded-xl transition-all mt-2"
                    style={{ background: canSubmit ? "#111827" : undefined }}
                    disabled={!canSubmit}
                    onClick={handleSubmit}
                    data-testid="button-submit-crypto-withdrawal"
                  >
                    {mutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando…</>
                    ) : (
                      <>Converter e sacar · {usdtEquivalent} USDT</>
                    )}
                  </Button>

                </div>
              </div>

            </div>
          </TabsContent>

          {/* ── ABA: EXTRATO ── */}
          <TabsContent value="extrato" className="mt-0">
            <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-white dark:bg-[#0f1117] overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-white/[0.06]">
                <p className="text-sm font-bold text-gray-900 dark:text-white">Extrato de saques cripto</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Histórico das suas conversões PIX → USDT</p>
              </div>

              {isLoadingHistory ? (
                <div className="px-5 py-12 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (cryptoHistory as any[]).length === 0 ? (
                <div className="px-5 py-16 text-center space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Nenhuma conversão ainda</p>
                  <p className="text-xs text-muted-foreground/50">Suas solicitações aparecerão aqui</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                  {(cryptoHistory as any[]).map((item: any) => {
                    const st = statusMap[item.status] ?? statusMap.pending;
                    const net = NETWORKS.find(n => n.value === item.network);
                    return (
                      <div key={item.id} className="px-5 py-4 flex items-center gap-4">
                        <div className="w-8 h-8 rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 font-mono">{net?.badge ?? "?"}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">R$ {fmtBRL(item.amountBRL || 0)}</span>
                            <span className="text-muted-foreground text-xs">→</span>
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 tabular-nums">{(item.usdtAmount || 0).toFixed(2)} USDT</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-muted-foreground font-mono">{truncateWallet(item.walletAddress || "")}</span>
                            <span className="text-[10px] text-muted-foreground/40">·</span>
                            <span className="text-[11px] text-muted-foreground">{formatDate(item.requestedAt || item.createdAt)}</span>
                          </div>
                          {item.status === "rejected" && item.rejectionReason && (
                            <p className="text-[11px] text-red-500 mt-0.5">{item.rejectionReason}</p>
                          )}
                        </div>
                        <div className={`inline-flex items-center gap-1 text-[11px] font-semibold shrink-0 ${st.cls}`}>
                          {st.icon}{st.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </DashboardLayout>
  );
}
