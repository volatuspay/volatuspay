import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Skeleton } from "@/components/ui/skeleton";

interface SellerRisk {
  id: string;
  tenantId: string;
  sellerEmail: string;
  sellerName: string;
  businessName?: string;
  totalRefunds: number;
  totalRefundAmount: number;
  riskLevel: number;
  riskCategory: "baixo" | "medio" | "alto" | "urgente";
  status: string;
  isBlocked: boolean;
  needsReview: boolean;
  productQualityScore?: number;
}

interface BlockingRules {
  autoBlockEnabled: boolean;
  productQualityEnabled: boolean;
  chargebackThreshold: number;
  refundThreshold: number;
  chargebackCountThreshold: number;
  refundCountThreshold: number;
  blockType: "account" | "all_products" | "specific_product";
  chargebackMode: "percentage" | "quantity";
  refundMode: "percentage" | "quantity";
}

interface ProductQualityItem {
  productId: string;
  productName: string;
  score: number;
  issues: string[];
}

const RISK_COLOR: Record<string, string> = {
  urgente: "text-red-600",
  alto: "text-orange-600",
  medio: "text-yellow-600",
  baixo: "text-emerald-600",
};

const RISK_LABEL_CLASS: Record<string, string> = {
  urgente: "bg-red-50 text-red-700 border border-red-200",
  alto: "bg-orange-50 text-orange-700 border border-orange-200",
  medio: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  baixo: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const formatCurrency = (amount: number): string => {
  if (!Number.isFinite(amount)) return "R$ 0,00";
  return (amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const RISK_LABEL_PT: Record<string, string> = {
  urgente: "Urgente",
  alto: "Alto",
  medio: "Medio",
  baixo: "Baixo",
  low: "Baixo",
  medium: "Medio",
  high: "Alto",
  urgent: "Urgente",
};

const STATUS_LABEL_PT: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  active: "Ativo",
  blocked: "Bloqueado",
  rejected: "Rejeitado",
};

export default function SellersRiskPage() {
  const [sellers, setSellers] = useState<SellerRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<SellerRisk | null>(null);
  const [actionType, setActionType] = useState<"block" | "unblock">("block");
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [rules, setRules] = useState<BlockingRules>({
    autoBlockEnabled: false,
    productQualityEnabled: true,
    chargebackThreshold: 5,
    refundThreshold: 10,
    chargebackCountThreshold: 3,
    refundCountThreshold: 10,
    blockType: "account",
    chargebackMode: "percentage",
    refundMode: "percentage",
  });
  const [acquirerStats, setAcquirerStats] = useState<{ chargebacks: number; refunds: number; total: number } | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [qualityDialogOpen, setQualityDialogOpen] = useState(false);
  const [productQuality, setProductQuality] = useState<{ averageScore: number; issues: ProductQualityItem[] } | null>(null);
  const [loadingQuality, setLoadingQuality] = useState(false);
  const [blockTypeDialogOpen, setBlockTypeDialogOpen] = useState(false);
  const [selectedBlockType, setSelectedBlockType] = useState<"account" | "all_products" | "specific_product">("account");
  const { toast } = useToast();

  const stats = {
    total: sellers.length,
    urgente: sellers.filter((s) => s.riskCategory === "urgente" || s.riskCategory === ("urgent" as any)).length,
    alto: sellers.filter((s) => s.riskCategory === "alto" || s.riskCategory === ("high" as any)).length,
    medio: sellers.filter((s) => s.riskCategory === "medio" || s.riskCategory === ("medium" as any)).length,
    baixo: sellers.filter((s) => s.riskCategory === "baixo" || s.riskCategory === ("low" as any)).length,
  };

  const getToken = async () => {
    const { auth } = await import("@/lib/firebase");
    const user = auth.currentUser;
    if (!user) throw new Error("Nao autenticado");
    return user.getIdToken();
  };

  const fetchSellersRisk = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      if (riskFilter && riskFilter !== "all") params.set("risk", riskFilter);
      const url = "/api/admin/sellers-risk" + (params.toString() ? "?" + params.toString() : "");
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error("Erro " + res.status);
      const data = await res.json();
      if (data.success && data.sellers) setSellers(data.sellers);
    } catch {
      toast({ title: "Erro ao carregar sellers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchRules = async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/blocking-rules", { headers: { Authorization: "Bearer " + token } });
      if (res.ok) {
        const data = await res.json();
        if (data.rules) setRules((prev) => ({ ...prev, ...data.rules }));
      }
    } catch {}
  };

  const fetchAcquirerStats = async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/acquirer-stats", { headers: { Authorization: "Bearer " + token } });
      if (res.ok) {
        const data = await res.json();
        setAcquirerStats(data.stats || { chargebacks: 0, refunds: 0, total: 0 });
      }
    } catch {}
  };

  const saveRules = async () => {
    try {
      setSavingRules(true);
      const token = await getToken();
      const res = await fetch("/api/admin/blocking-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ rules }),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      toast({ title: "Regras salvas com sucesso" });
      setRulesDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setSavingRules(false);
    }
  };

  const fetchProductQuality = async (sellerId: string) => {
    try {
      setLoadingQuality(true);
      const token = await getToken();
      const res = await fetch("/api/admin/sellers/" + sellerId + "/product-quality", {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.ok) {
        const data = await res.json();
        setProductQuality(data);
        setQualityDialogOpen(true);
      }
    } catch {
      toast({ title: "Erro ao carregar qualidade", variant: "destructive" });
    } finally {
      setLoadingQuality(false);
    }
  };

  const handleBlockAction = async () => {
    if (!selectedSeller) return;
    try {
      setBlockingId(selectedSeller.id);
      const token = await getToken();
      const endpoint =
        actionType === "block"
          ? "/api/admin/sellers/" + selectedSeller.tenantId + "/block"
          : "/api/admin/sellers/" + selectedSeller.tenantId + "/unblock";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ blockType: selectedBlockType }),
      });
      if (!res.ok) throw new Error("Erro ao processar");
      toast({
        title: actionType === "block" ? "Seller bloqueado" : "Seller desbloqueado",
        description: selectedSeller.sellerName,
      });
      setBlockDialogOpen(false);
      setBlockTypeDialogOpen(false);
      setSelectedSeller(null);
      fetchSellersRisk();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setBlockingId(null);
    }
  };

  const openBlockDialog = (seller: SellerRisk, action: "block" | "unblock") => {
    setSelectedSeller(seller);
    setActionType(action);
    if (action === "block") setBlockTypeDialogOpen(true);
    else setBlockDialogOpen(true);
  };

  const filteredSellers = sellers.filter((s) => {
    const hasValid = (s.sellerEmail && s.sellerEmail.includes("@")) || (s.sellerName && s.sellerName !== "n/a");
    if (!hasValid) return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      if (!(s.sellerName?.toLowerCase().includes(t) || s.sellerEmail?.toLowerCase().includes(t))) return false;
    }
    const cat = RISK_LABEL_PT[s.riskCategory]?.toLowerCase() || s.riskCategory?.toLowerCase();
    const filterMap: Record<string, string[]> = {
      urgente: ["urgente", "urgent"],
      alto: ["alto", "high"],
      medio: ["medio", "medium"],
      baixo: ["baixo", "low"],
    };
    if (riskFilter !== "all") {
      const allowed = filterMap[riskFilter] || [riskFilter];
      if (!allowed.includes(s.riskCategory?.toLowerCase())) return false;
    }
    return true;
  });

  useEffect(() => {
    fetchSellersRisk();
    fetchRules();
  }, []);

  const statsCards = [
    { label: "Total", value: stats.total, color: "text-gray-900" },
    { label: "Urgente", value: stats.urgente, color: "text-red-600" },
    { label: "Alto", value: stats.alto, color: "text-orange-600" },
    { label: "Medio", value: stats.medio, color: "text-yellow-600" },
    { label: "Baixo", value: stats.baixo, color: "text-emerald-600" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6 p-3 md:p-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">Gestao de Risco</h1>
            <p className="text-sm text-gray-500 mt-0.5">Sellers com comportamento suspeito ou fora dos limites</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setRulesDialogOpen(true); fetchAcquirerStats(); }}
              className="bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Regras
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchSellersRisk}
              disabled={loading}
              className="bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </Button>
          </div>
        </div>

        {/* Cards de resumo - igual ao extrato */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-3 lg:gap-4">
          {statsCards.map(({ label, value, color }) => (
            <Card key={label} className="bg-white shadow-card">
              <CardContent className="p-3 md:p-6">
                <h3 className="text-xs md:text-sm font-medium text-gray-600 mb-1 md:mb-2">{label}</h3>
                <p className={`text-xl md:text-3xl font-bold ${color}`}>{value}</p>
                <div className="mt-2 md:mt-4 h-1 bg-gradient-to-r from-[#2563eb] to-[#1d4ed8] rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex flex-col gap-2 md:gap-3">
          <div className="flex gap-2 items-center flex-wrap w-full">
            <div className="relative flex-1 min-w-[160px]">
              <Input
                type="text"
                placeholder="Buscar por nome ou email"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-white border-gray-200 text-sm"
              />
            </div>
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-44 bg-white border-gray-200 text-sm">
                <SelectValue placeholder="Nivel de risco" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os niveis</SelectItem>
                <SelectItem value="urgente">Urgente</SelectItem>
                <SelectItem value="alto">Alto</SelectItem>
                <SelectItem value="medio">Medio</SelectItem>
                <SelectItem value="baixo">Baixo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabela - mesmo padrão do extrato */}
        <Card className="bg-white shadow-card">
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto">
              <table className="w-full table-fixed">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="w-[25%] px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Seller</th>
                    <th className="w-[14%] px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Qualidade</th>
                    <th className="w-[18%] px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Reembolsos</th>
                    <th className="w-[18%] px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Risco</th>
                    <th className="w-[13%] px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="w-[12%] px-3 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-3 py-3"><Skeleton className="h-8 w-40" /></td>
                          <td className="px-3 py-3"><Skeleton className="h-4 w-20" /></td>
                          <td className="px-3 py-3"><Skeleton className="h-4 w-24" /></td>
                          <td className="px-3 py-3"><Skeleton className="h-4 w-20" /></td>
                          <td className="px-3 py-3"><Skeleton className="h-5 w-16" /></td>
                          <td className="px-3 py-3"><Skeleton className="h-7 w-20 ml-auto" /></td>
                        </tr>
                      ))
                    : filteredSellers.length === 0
                    ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-16">
                            <div className="flex flex-col items-center justify-center text-center">
                              <div className="mb-3 p-4 bg-gray-100 rounded-full w-14 h-14 flex items-center justify-center">
                                <span className="text-gray-400 text-2xl font-light">-</span>
                              </div>
                              <p className="text-sm font-medium text-gray-900">Nenhum seller encontrado</p>
                              <p className="text-xs text-gray-400 mt-1">Tente ajustar os filtros de busca</p>
                            </div>
                          </td>
                        </tr>
                      )
                    : filteredSellers.map((seller) => {
                        const catKey = seller.riskCategory?.toLowerCase() as string;
                        const riskLabel = RISK_LABEL_PT[catKey] || catKey;
                        const riskColorClass = RISK_COLOR[catKey] || RISK_COLOR["baixo"];
                        const riskBadgeClass = RISK_LABEL_CLASS[catKey] || RISK_LABEL_CLASS["baixo"];
                        const statusLabel = STATUS_LABEL_PT[seller.status?.toLowerCase()] || seller.status || "Ativo";

                        return (
                          <tr key={seller.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-3 py-3 text-xs text-gray-900">
                              <div className="min-w-0">
                                <div className="font-medium truncate">{seller.sellerName || "-"}</div>
                                <div className="text-[10px] text-gray-400 truncate">{seller.sellerEmail || "-"}</div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-900">
                              <button
                                onClick={() => fetchProductQuality(seller.tenantId)}
                                disabled={loadingQuality}
                                className="flex items-center gap-2 group text-left"
                              >
                                <div className="w-16">
                                  <Progress value={seller.productQualityScore ?? 70} className="h-1.5" />
                                </div>
                                <span className="text-xs text-gray-500 group-hover:text-gray-700 tabular-nums">
                                  {seller.productQualityScore ?? 70}%
                                </span>
                              </button>
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-900">
                              <span className="font-medium tabular-nums">{seller.totalRefunds}</span>
                              <span className="text-gray-400 ml-1 tabular-nums">
                                {formatCurrency(seller.totalRefundAmount)}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-900">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className={`font-semibold tabular-nums ${riskColorClass}`}>
                                    {seller.riskLevel ?? 0}%
                                  </span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${riskBadgeClass}`}>
                                    {riskLabel}
                                  </span>
                                </div>
                                <Progress value={seller.riskLevel ?? 0} className="h-1" />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-900">
                              {seller.isBlocked ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-medium">
                                  Bloqueado
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 border border-gray-200 font-medium">
                                  {statusLabel}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              {seller.isBlocked ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openBlockDialog(seller, "unblock")}
                                  disabled={blockingId === seller.id}
                                  className="text-xs h-7 bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                                >
                                  Desbloquear
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openBlockDialog(seller, "block")}
                                  disabled={blockingId === seller.id}
                                  className="text-xs h-7 bg-white border-red-200 text-red-600 hover:bg-red-50"
                                >
                                  Bloquear
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── Modal: Regras de Bloqueio - layout amplo horizontal ── */}
        <Dialog open={rulesDialogOpen} onOpenChange={setRulesDialogOpen}>
          <DialogContent className="bg-white text-gray-900 border border-gray-200 shadow-lg max-w-2xl p-0 overflow-hidden">
            {/* Header */}
            <div className="px-7 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-base font-semibold text-gray-900">Regras de Bloqueio</DialogTitle>
                <DialogDescription className="text-sm text-gray-500 mt-0.5">
                  Configure os limites para bloqueio de sellers
                </DialogDescription>
              </div>
              {acquirerStats && (
                <div className="flex gap-5 text-center shrink-0">
                  <div>
                    <div className="text-lg font-bold text-red-600 tabular-nums">{acquirerStats.chargebacks}</div>
                    <div className="text-[10px] text-gray-400">Chargebacks</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-orange-600 tabular-nums">{acquirerStats.refunds}</div>
                    <div className="text-[10px] text-gray-400">Reembolsos</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-900 tabular-nums">{acquirerStats.total}</div>
                    <div className="text-[10px] text-gray-400">Total</div>
                  </div>
                </div>
              )}
            </div>

            {/* Corpo em 2 colunas - sem scroll */}
            <div className="px-7 py-6 grid grid-cols-2 gap-x-8 gap-y-5">

              {/* Coluna esquerda */}
              <div className="space-y-5">
                {/* Switch bloqueio */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-900">Bloqueio Automatico</Label>
                    <p className="text-xs text-gray-400 mt-0.5">Bloquear ao atingir os limites</p>
                  </div>
                  <Switch checked={rules.autoBlockEnabled} onCheckedChange={(c) => setRules({ ...rules, autoBlockEnabled: c })} />
                </div>

                {/* Switch qualidade */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-900">Verificar Qualidade</Label>
                    <p className="text-xs text-gray-400 mt-0.5">Incluir score de produtos na analise</p>
                  </div>
                  <Switch checked={rules.productQualityEnabled} onCheckedChange={(c) => setRules({ ...rules, productQualityEnabled: c })} />
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <Label className="text-sm font-medium text-gray-900 mb-2 block">Tipo de Bloqueio</Label>
                  <Select value={rules.blockType} onValueChange={(v) => setRules({ ...rules, blockType: v as BlockingRules["blockType"] })}>
                    <SelectTrigger className="bg-white border-gray-200 text-sm w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="account">Bloquear Conta</SelectItem>
                      <SelectItem value="all_products">Bloquear Produtos</SelectItem>
                      <SelectItem value="specific_product">Produto Especifico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Coluna direita */}
              <div className="space-y-5">
                {/* Chargeback */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-900">Limite de Chargeback</Label>
                  <div className="flex gap-1.5">
                    {(["percentage", "quantity"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setRules({ ...rules, chargebackMode: mode })}
                        className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                          rules.chargebackMode === mode
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 text-gray-500 bg-white hover:border-gray-300"
                        }`}
                      >
                        {mode === "percentage" ? "% Percentual" : "Qtd Absoluta"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min="0"
                      max={rules.chargebackMode === "percentage" ? 100 : 999}
                      value={rules.chargebackMode === "percentage" ? rules.chargebackThreshold : rules.chargebackCountThreshold}
                      onChange={(e) =>
                        setRules({
                          ...rules,
                          [rules.chargebackMode === "percentage" ? "chargebackThreshold" : "chargebackCountThreshold"]: Number(e.target.value),
                        })
                      }
                      className="w-20 bg-white border-gray-200 text-sm"
                    />
                    <span className="text-sm text-gray-400">{rules.chargebackMode === "percentage" ? "%" : "qtd"}</span>
                  </div>
                </div>

                {/* Reembolso */}
                <div className="space-y-2 pt-1">
                  <Label className="text-sm font-medium text-gray-900">Limite de Reembolso</Label>
                  <div className="flex gap-1.5">
                    {(["percentage", "quantity"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setRules({ ...rules, refundMode: mode })}
                        className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                          rules.refundMode === mode
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 text-gray-500 bg-white hover:border-gray-300"
                        }`}
                      >
                        {mode === "percentage" ? "% Percentual" : "Qtd Absoluta"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min="0"
                      max={rules.refundMode === "percentage" ? 100 : 999}
                      value={rules.refundMode === "percentage" ? rules.refundThreshold : rules.refundCountThreshold}
                      onChange={(e) =>
                        setRules({
                          ...rules,
                          [rules.refundMode === "percentage" ? "refundThreshold" : "refundCountThreshold"]: Number(e.target.value),
                        })
                      }
                      className="w-20 bg-white border-gray-200 text-sm"
                    />
                    <span className="text-sm text-gray-400">{rules.refundMode === "percentage" ? "%" : "qtd"}</span>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="px-7 py-4 border-t border-gray-100 gap-2">
              <Button variant="outline" size="sm" onClick={() => setRulesDialogOpen(false)} className="bg-white border-gray-200 text-gray-600">
                Cancelar
              </Button>
              <Button size="sm" onClick={saveRules} disabled={savingRules} className="bg-gray-900 hover:bg-gray-800 text-white">
                {savingRules ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Modal: Tipo de Bloqueio ── */}
        <Dialog open={blockTypeDialogOpen} onOpenChange={setBlockTypeDialogOpen}>
          <DialogContent className="bg-white text-gray-900 border border-gray-200 shadow-lg max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-gray-900">Tipo de Bloqueio</DialogTitle>
              <DialogDescription className="text-sm text-gray-500">
                Escolha como bloquear {selectedSeller?.sellerName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-3">
              {[
                { value: "account" as const, label: "Bloquear Conta", desc: "Suspende conta e todos os checkouts" },
                { value: "all_products" as const, label: "Bloquear Produtos", desc: "Mantém conta ativa, bloqueia vendas" },
                { value: "specific_product" as const, label: "Produto Especifico", desc: "Selecionar individualmente" },
              ].map(({ value, label, desc }) => (
                <div
                  key={value}
                  onClick={() => setSelectedBlockType(value)}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedBlockType === value ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setBlockTypeDialogOpen(false)} className="bg-white border-gray-200 text-gray-600">
                Cancelar
              </Button>
              <Button size="sm" onClick={() => { setBlockTypeDialogOpen(false); setBlockDialogOpen(true); }} className="bg-gray-900 hover:bg-gray-800 text-white">
                Continuar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Modal: Confirmar Acao ── */}
        <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
          <DialogContent className="bg-white text-gray-900 border border-gray-200 shadow-lg max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-gray-900">
                {actionType === "block" ? "Confirmar Bloqueio" : "Confirmar Desbloqueio"}
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500">
                {actionType === "block" ? "O checkout exibira Produto Indisponivel" : "Os checkouts serao reativados"}
              </DialogDescription>
            </DialogHeader>
            {selectedSeller && (
              <div className="divide-y divide-gray-100 py-1">
                {[
                  { label: "Seller", value: selectedSeller.sellerName },
                  { label: "Email", value: selectedSeller.sellerEmail },
                  {
                    label: "Risco",
                    value: (selectedSeller.riskLevel ?? 0) + "%",
                    className: RISK_COLOR[selectedSeller.riskCategory?.toLowerCase()] || "",
                  },
                  ...(actionType === "block"
                    ? [{
                        label: "Tipo",
                        value:
                          selectedBlockType === "account"
                            ? "Conta completa"
                            : selectedBlockType === "all_products"
                            ? "Todos os produtos"
                            : "Produto especifico",
                      }]
                    : []),
                ].map(({ label, value, className }) => (
                  <div key={label} className="flex justify-between items-center py-2.5">
                    <span className="text-sm text-gray-500">{label}</span>
                    <span className={`text-sm font-medium text-gray-900 ${className ?? ""}`}>{value}</span>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter className="gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBlockDialogOpen(false)}
                disabled={blockingId !== null}
                className="bg-white border-gray-200 text-gray-600"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleBlockAction}
                disabled={blockingId !== null}
                className={actionType === "block" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"}
              >
                {blockingId ? "Processando..." : actionType === "block" ? "Bloquear" : "Desbloquear"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Modal: Qualidade dos Produtos ── */}
        <Dialog open={qualityDialogOpen} onOpenChange={setQualityDialogOpen}>
          <DialogContent className="bg-white text-gray-900 border border-gray-200 shadow-lg max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-gray-900">Qualidade dos Produtos</DialogTitle>
            </DialogHeader>
            {productQuality && (
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50 border border-gray-100">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Score Medio</p>
                    <p className="text-2xl font-bold text-gray-900 tabular-nums">{productQuality.averageScore}%</p>
                  </div>
                  <div className="w-32">
                    <Progress value={productQuality.averageScore} className="h-2" />
                  </div>
                </div>
                {productQuality.issues.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Problemas</p>
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {productQuality.issues.map((item, i) => (
                        <div key={i} className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{item.productName}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {item.issues.map((issue, j) => (
                                  <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">
                                    {issue}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <span className={`text-sm font-bold tabular-nums ${item.score < 50 ? "text-red-600" : item.score < 70 ? "text-yellow-600" : "text-emerald-600"}`}>
                              {item.score}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setQualityDialogOpen(false)} className="bg-white border-gray-200 text-gray-600">
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </DashboardLayout>
  );
}
