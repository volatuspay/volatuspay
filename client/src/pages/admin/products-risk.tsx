import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, AlertTriangle, ShieldAlert, TrendingDown, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { resolveImageUrl } from "@/lib/image-url";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useToast } from "@/hooks/use-toast";

interface RiskProduct {
  id: string;
  title: string;
  imageUrl?: string;
  sellerName?: string;
  sellerEmail?: string;
  tenantId: string;
  paidCount: number;
  refundCount: number;
  chargebackCount: number;
  medCount: number;
  refundRate: number;
  chargebackRate: number;
  medRate: number;
  riskScore: number;
  riskLevel: "baixo" | "médio" | "alto" | "crítico";
}

function getRiskLevel(score: number): RiskProduct["riskLevel"] {
  if (score >= 75) return "crítico";
  if (score >= 50) return "alto";
  if (score >= 25) return "médio";
  return "baixo";
}

function getRiskColor(level: RiskProduct["riskLevel"]) {
  switch (level) {
    case "crítico": return { bar: "bg-red-500", badge: "bg-red-500/20 text-red-300 border-red-500/30", text: "text-red-400" };
    case "alto":    return { bar: "bg-orange-500", badge: "bg-orange-500/20 text-orange-300 border-orange-500/30", text: "text-orange-400" };
    case "médio":   return { bar: "bg-yellow-500", badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30", text: "text-yellow-400" };
    default:        return { bar: "bg-emerald-500", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", text: "text-emerald-400" };
  }
}

export default function AdminProductsRisk() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [riskProducts, setRiskProducts] = useState<RiskProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Token não disponível");

      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // Busca produtos e a primeira página de orders em paralelo
      const [productsRes, firstPageRes] = await Promise.all([
        fetch("/api/admin/products", { credentials: "include", headers }),
        fetch("/api/admin/orders?limit=500", { credentials: "include", headers }),
      ]);

      if (!productsRes.ok) throw new Error("Erro ao carregar produtos");
      if (!firstPageRes.ok) throw new Error("Erro ao carregar orders");

      const [products, firstPage] = await Promise.all([productsRes.json(), firstPageRes.json()]);

      // Paginar todas as orders
      let ordersArray: any[] = Array.isArray(firstPage)
        ? firstPage
        : firstPage.orders || firstPage.data || [];

      let hasMore: boolean = firstPage.hasMore ?? false;
      let cursor = firstPage.nextCursor ?? null;

      while (hasMore && cursor?.lastDocId && cursor?.lastCreatedAt) {
        const params = new URLSearchParams({
          limit: "500",
          lastDocId: cursor.lastDocId,
          lastCreatedAt: String(cursor.lastCreatedAt),
        });
        const nextRes = await fetch(`/api/admin/orders?${params}`, { credentials: "include", headers });
        if (!nextRes.ok) break;
        const nextPage = await nextRes.json();
        const nextOrders: any[] = Array.isArray(nextPage)
          ? nextPage
          : nextPage.orders || nextPage.data || [];
        ordersArray = ordersArray.concat(nextOrders);
        hasMore = nextPage.hasMore ?? false;
        cursor = nextPage.nextCursor ?? null;
      }
      const productsArray: any[] = Array.isArray(products) ? products : products.products || products.data || [];

      // Indexar orders por productId ou checkoutId
      const statsMap = new Map<string, { paid: number; refund: number; chargeback: number; med: number }>();

      const getOrCreate = (key: string) => {
        if (!statsMap.has(key)) statsMap.set(key, { paid: 0, refund: 0, chargeback: 0, med: 0 });
        return statsMap.get(key)!;
      };

      ordersArray.forEach((order: any) => {
        const productId = order.productId || order.product_id;
        const checkoutId = order.checkoutId || order.checkout_id;
        const keys = [productId, checkoutId].filter(Boolean);
        const status = (order.status || "").toLowerCase();

        keys.forEach((key: string) => {
          const s = getOrCreate(key);
          if (status === "paid") s.paid++;
          else if (status === "refunded" || status === "refund") s.refund++;
          else if (status === "chargeback" || status === "chargedback") s.chargeback++;
          else if (status === "disputed" || status === "med" || status === "dispute") s.med++;
        });
      });

      const result: RiskProduct[] = productsArray
        .filter((p: any) => !p.deletedAt && !p.deleted)
        .map((p: any) => {
          const pid = p.id || p.productId;
          const cid = p.checkoutId;
          const s1 = statsMap.get(pid) || { paid: 0, refund: 0, chargeback: 0, med: 0 };
          const s2 = cid ? (statsMap.get(cid) || { paid: 0, refund: 0, chargeback: 0, med: 0 }) : { paid: 0, refund: 0, chargeback: 0, med: 0 };

          const paid = Math.max(s1.paid, s2.paid);
          const refund = s1.refund + s2.refund;
          const chargeback = s1.chargeback + s2.chargeback;
          const med = s1.med + s2.med;
          const total = paid + refund + chargeback + med;

          const refundRate = total > 0 ? (refund / total) * 100 : 0;
          const chargebackRate = total > 0 ? (chargeback / total) * 100 : 0;
          const medRate = total > 0 ? (med / total) * 100 : 0;

          // Score: chargeback pesa 3x, MED e refund pesam 2x
          const riskScore = Math.min(100, chargebackRate * 3 + medRate * 2 + refundRate * 2);

          return {
            id: pid,
            title: p.title || p.name || "Sem nome",
            imageUrl: p.imageUrl,
            sellerName: p.sellerName,
            sellerEmail: p.sellerEmail,
            tenantId: p.tenantId,
            paidCount: paid,
            refundCount: refund,
            chargebackCount: chargeback,
            medCount: med,
            refundRate,
            chargebackRate,
            medRate,
            riskScore,
            riskLevel: getRiskLevel(riskScore),
          };
        })
        .filter((p) => p.riskScore > 0 || p.refundCount > 0 || p.chargebackCount > 0 || p.medCount > 0)
        .sort((a, b) => b.riskScore - a.riskScore);

      setRiskProducts(result);
    } catch (e: any) {
      toast({ title: "Erro ao carregar produtos de risco", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filtered = riskProducts.filter((p) =>
    !searchTerm ||
    p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sellerEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.sellerName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const counts = {
    crítico: riskProducts.filter((p) => p.riskLevel === "crítico").length,
    alto: riskProducts.filter((p) => p.riskLevel === "alto").length,
    médio: riskProducts.filter((p) => p.riskLevel === "médio").length,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">Produtos de Risco</h1>
            <p className="text-emerald-600 dark:text-blue-400 mt-1">
              Produtos com alto índice de chargeback, MED ou reembolso
            </p>
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-emerald-600/50 rounded-md text-emerald-900 dark:text-blue-300 hover:bg-emerald-600 hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Crítico", count: counts.crítico, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
            { label: "Alto", count: counts.alto, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
            { label: "Médio", count: counts.médio, color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
          ].map(({ label, count, color, bg }) => (
            <Card key={label} className={`border ${bg}`}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${color}`}>{count}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Busca */}
        <Card className="bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-blue-400" />
              <Input
                placeholder="Buscar por produto, seller ou email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-emerald-950/30 border-emerald-600/50 text-emerald-100 placeholder-emerald-400"
              />
            </div>
          </CardContent>
        </Card>

        {/* Lista */}
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Carregando métricas de risco...</div>
        ) : filtered.length === 0 ? (
          <Card className="bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20">
            <CardContent className="p-12 text-center">
              <ShieldAlert className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
              <p className="text-emerald-400">
                {searchTerm ? "Nenhum produto encontrado para a busca" : "Nenhum produto em situação de risco"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filtered.map((product) => {
              const colors = getRiskColor(product.riskLevel);
              return (
                <Card key={product.id} className="bg-white dark:bg-transparent border border-gray-200 dark:border-emerald-500/20 hover:shadow-lg transition-all">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      {product.imageUrl && (
                        <img
                          src={resolveImageUrl(product.imageUrl) || ""}
                          alt={product.title}
                          className="w-14 h-14 object-cover rounded-lg flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">{product.title}</h3>
                          <Badge className={`text-xs border ${colors.badge}`}>
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {product.riskLevel.charAt(0).toUpperCase() + product.riskLevel.slice(1)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          Seller: {product.sellerName || product.sellerEmail || product.tenantId}
                        </p>

                        {/* Barra de proteção */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-muted-foreground">Score de Risco</span>
                            <span className={`font-bold ${colors.text}`}>{product.riskScore.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-zinc-800 rounded-full h-2.5 overflow-hidden">
                            <div
                              className={`h-2.5 rounded-full transition-all ${colors.bar}`}
                              style={{ width: `${Math.min(100, product.riskScore)}%` }}
                            />
                          </div>

                          {/* Métricas individuais */}
                          <div className="grid grid-cols-3 gap-2 mt-3">
                            {[
                              { label: "Chargeback", count: product.chargebackCount, rate: product.chargebackRate, color: "text-red-400", icon: <TrendingDown className="w-3 h-3" /> },
                              { label: "MED/Disputa", count: product.medCount, rate: product.medRate, color: "text-orange-400", icon: <AlertTriangle className="w-3 h-3" /> },
                              { label: "Reembolso", count: product.refundCount, rate: product.refundRate, color: "text-yellow-400", icon: <RefreshCw className="w-3 h-3" /> },
                            ].map(({ label, count, rate, color, icon }) => (
                              <div key={label} className="bg-zinc-900/30 dark:bg-zinc-800/40 rounded-lg p-2 text-center border border-zinc-700/30">
                                <div className={`flex items-center justify-center gap-1 ${color} mb-1`}>
                                  {icon}
                                  <span className="text-xs font-medium">{label}</span>
                                </div>
                                <p className={`text-lg font-bold ${color}`}>{count}</p>
                                <p className="text-xs text-muted-foreground">{rate.toFixed(1)}%</p>
                              </div>
                            ))}
                          </div>

                          <p className="text-xs text-muted-foreground mt-1">
                            Base: {product.paidCount} venda{product.paidCount !== 1 ? "s" : ""} pagas
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
