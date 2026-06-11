import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { resolveImageUrl } from "@/lib/image-url";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth";
import { Info, ExternalLink, Copy, Check, ShieldOff, Globe } from "lucide-react";
import { useState } from "react";

export default function AffiliateInvitePage() {
  const params = useParams<{ checkoutId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [copied, setCopied] = useState(false);
  const [copiedOffer, setCopiedOffer] = useState<string | null>(null);

  const { data: product, isLoading } = useQuery({
    queryKey: [`/api/showcase/checkouts/${params?.checkoutId}`],
    queryFn: async () => {
      const response = await fetch(`/api/showcase/checkouts/${params?.checkoutId}`);
      if (!response.ok) throw new Error("Produto não encontrado");
      return response.json();
    },
    enabled: !!params?.checkoutId,
  });

  const { data: offers = [] } = useQuery({
    queryKey: [`/api/products/${params?.checkoutId}/offers`],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/products/${params?.checkoutId}/offers`);
        if (!response.ok) return [];
        return await response.json();
      } catch {
        return [];
      }
    },
    enabled: !!params?.checkoutId && !!product,
  });

  const isOwner = !!user && !!product && (
    user.uid === product.tenantId ||
    user.uid === product.seller?.uid ||
    user.uid === (product as any).userId
  );

  const createAffiliateMutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        navigate(`/login?redirect=/convite/${params?.checkoutId}`);
        throw new Error("Faça login para se afiliar");
      }
      const { auth } = await import("@/lib/firebase");
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/affiliate/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ checkoutId: params?.checkoutId, sellerId: product?.tenantId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erro ao se afiliar");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Afiliação solicitada!", description: "Aguarde a aprovação do produtor." });
      navigate("/dashboard/my-affiliations");
    },
    onError: (error: Error) => {
      if (!error.message.includes("login")) {
        toast({ title: "Erro", description: error.message, variant: "destructive" });
      }
    },
  });

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Link copiado!" });
  };

  const copyOfferUrl = (url: string, offerId: string) => {
    navigator.clipboard.writeText(url);
    setCopiedOffer(offerId);
    setTimeout(() => setCopiedOffer(null), 2000);
    toast({ title: "Link da oferta copiado!" });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white">Produto não encontrado</p>
      </div>
    );
  }

  // ── Bloquear dono do produto ──────────────────────────────────────────────
  if (isOwner) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: '#18181b', border: '1px solid #27272a' }}>
              <ShieldOff className="w-10 h-10 text-zinc-500" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Ação não permitida</h1>
            <p className="text-gray-400">
              Você é o produtor deste produto e não pode se afiliar a ele.
            </p>
          </div>
          <div className="rounded-xl p-4 text-left space-y-3" style={{ backgroundColor: '#18181b', border: '1px solid #27272a' }}>
            <div className="flex items-start gap-3">
              {product.imageUrl ? (
                <img src={resolveImageUrl(product.imageUrl) || ''} alt={product.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#27272a' }}>
                  <span className="text-xl font-bold text-zinc-400">{product.name?.charAt(0) || "P"}</span>
                </div>
              )}
              <div>
                <p className="font-semibold text-white">{product.name}</p>
                <p className="text-sm text-gray-500">{product.sellerName || "Produtor"}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={copyInviteLink} variant="outline" className="w-full gap-2" style={{ borderColor: '#3f3f46', color: '#d4d4d8', backgroundColor: 'transparent' }}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copiado!" : "Copiar link de convite para afiliados"}
            </Button>
            <Button onClick={() => navigate("/dashboard/showcase")} variant="ghost" className="w-full text-gray-500 hover:text-gray-300">
              Voltar à vitrine
            </Button>
          </div>
          <div className="pt-4">
            <img src="/logo-volatuspay.png" alt="VolatusPay" className="h-7 mx-auto opacity-50" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Dados derivados ───────────────────────────────────────────────────────
  const commissionPercent = product.affiliateCommission || 30;
  const isRecurring = product.productType === "subscription";
  const displayOffers: any[] = (offers as any[]).length > 0
    ? (offers as any[])
    : [{ id: "main", name: product.name, price: product.price, billingCycle: product.productType === "subscription" ? "monthly" : null }];
  const maxOfferPrice = Math.max(...displayOffers.map((o: any) => o.price || 0), 0);
  const maxCommission = (maxOfferPrice * commissionPercent) / 100;
  const baseCheckoutUrl = `${window.location.origin}/checkout/${product.id}`;
  const salesPageUrl = product.salesPageUrl || baseCheckoutUrl;

  // ── Render principal ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-0">

        {/* ── Hero ── */}
        <div className="grid lg:grid-cols-3 gap-8 pb-8">
          <div className="lg:col-span-2 space-y-3">
            <h1 className="text-3xl lg:text-4xl font-bold leading-tight text-white">
              Solicitar afiliação
            </h1>
            <p className="text-gray-300 text-lg">
              Divulgue este produto e ganhe comissão em cada venda realizada.
            </p>
            <p className="text-sm text-gray-500">
              *O valor recebido pode variar conforme o método de pagamento e parcelamento escolhido pelo comprador.
            </p>
          </div>

          {/* Card lateral de afiliação */}
          <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: '#18181b', border: '1px solid #27272a' }}>
            <div className="flex items-start gap-3">
              {product.imageUrl ? (
                <img src={resolveImageUrl(product.imageUrl) || ''} alt={product.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#059669,#2563eb)' }}>
                  <span className="text-2xl font-bold text-white">{product.name?.charAt(0) || "P"}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full mb-1 text-white" style={{ backgroundColor: '#059669' }}>
                  {commissionPercent}% COMISSÃO
                </span>
                <h3 className="font-semibold text-white truncate">{product.name}</h3>
                <p className="text-xs text-gray-400">{product.salesCount || 0} vendas realizadas</p>
              </div>
            </div>
            <div className="text-center py-2">
              <p className="text-sm text-gray-400">Você pode lucrar até</p>
              <p className="text-2xl font-bold text-blue-400">
                R$ {(maxCommission / 100).toFixed(2).replace(".", ",")}
                <span className="text-sm font-normal text-gray-400"> por venda</span>
              </p>
            </div>
            <Button
              onClick={() => createAffiliateMutation.mutate()}
              disabled={createAffiliateMutation.isPending}
              className="w-full font-semibold py-3 text-white"
              style={{ backgroundColor: '#2563eb' }}
              data-testid="button-affiliate-signup"
            >
              {createAffiliateMutation.isPending ? "Processando..." : "Estou ciente e quero me afiliar"}
            </Button>
            <p className="text-xs text-center text-gray-500">Sujeito à aprovação</p>
          </div>
        </div>

        <Separator style={{ backgroundColor: '#27272a' }} />

        {/* ── Informações gerais ── */}
        <section className="py-8 space-y-5">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
            <Info className="w-5 h-5 text-emerald-400" />
            Informações gerais
          </h2>
          {product.description && (
            <p className="text-gray-400 text-sm leading-relaxed">{product.description}</p>
          )}
          {/* Tabela de informações — estilo extrato, sem branco-sobre-branco */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #27272a' }}>
            <table className="w-full text-sm">
              <tbody>
                {[
                  {
                    label: "Produtor",
                    value: <span className="text-white font-medium">{product.sellerName || "Produtor"}</span>
                  },
                  {
                    label: "Página de vendas",
                    value: (
                      <a href={salesPageUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors">
                        <Globe className="w-4 h-4" />
                        Ver página
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )
                  },
                  {
                    label: "Tipo",
                    value: <span className="text-white">{product.productType === "subscription" ? "Assinatura" : "Digital"}</span>
                  },
                  {
                    label: "Idioma",
                    value: <span className="text-white flex items-center gap-1.5">🇧🇷 Português</span>
                  },
                  {
                    label: "Aprovação",
                    value: <span className="text-white">{product.affiliateApproval === "automatic" ? "Imediata" : "Manual"}</span>
                  },
                  {
                    label: "Comissão",
                    value: (
                      <span className="text-white">
                        {commissionPercent}% em ofertas de preço único
                        {isRecurring && <> · {commissionPercent}% recorrente (todas as cobranças)</>}
                      </span>
                    )
                  },
                  {
                    label: "Comissão estendida",
                    value: <span className="text-gray-400 text-xs">Não aplicada em cross sell, upsell, downsell e order bump</span>
                  },
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < 6 ? '1px solid #27272a' : undefined }}>
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap w-44" style={{ backgroundColor: '#111111' }}>
                      {row.label}
                    </td>
                    <td className="px-5 py-3" style={{ backgroundColor: '#18181b' }}>
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Separator style={{ backgroundColor: '#27272a' }} />

        {/* ── Ofertas — tabela horizontal estilo extrato ── */}
        <section className="py-8 space-y-5">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
            Ofertas
            <Info className="w-4 h-4 text-gray-500" />
          </h2>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #27272a' }}>
            {/* Cabeçalho da tabela */}
            <div className="grid gap-0 text-xs font-semibold uppercase tracking-wider text-gray-500 px-5 py-3"
              style={{ backgroundColor: '#111111', gridTemplateColumns: '2fr 120px 140px 1fr auto' }}>
              <span>Oferta</span>
              <span className="text-right">Valor</span>
              <span className="text-right">Você recebe</span>
              <span className="pl-4">URL da oferta</span>
              <span />
            </div>

            {/* Linhas */}
            {displayOffers.slice(0, 8).map((offer: any, idx: number) => {
              const offerId = offer.id || offer.uuid || offer.slug || `main-${idx}`;
              const offerSlug = offer.slug || (offer.id !== "main" ? offer.id : null) || offer.uuid;
              const offerUrl = offerSlug
                ? `${baseCheckoutUrl}?offer=${offerSlug}`
                : baseCheckoutUrl;
              const offerCommission = ((offer.price || 0) * commissionPercent) / 100;
              const billingLabel = offer.billingCycle === "monthly" ? "Mensal" :
                                   offer.billingCycle === "yearly" ? "Anual" :
                                   offer.billingCycle === "weekly" ? "Semanal" : null;

              return (
                <div key={offerId}
                  className="grid items-center gap-0 px-5 py-4 transition-colors hover:brightness-110"
                  style={{
                    gridTemplateColumns: '2fr 120px 140px 1fr auto',
                    backgroundColor: idx % 2 === 0 ? '#18181b' : '#111111',
                    borderTop: '1px solid #27272a'
                  }}>
                  {/* Nome */}
                  <div>
                    <p className="font-medium text-white text-sm">{offer.name || offer.title || "Oferta principal"}</p>
                    {billingLabel && <p className="text-xs text-gray-500 mt-0.5">{billingLabel}</p>}
                  </div>

                  {/* Valor */}
                  <p className="text-sm font-semibold text-white text-right">
                    R$ {((offer.price || 0) / 100).toFixed(2).replace(".", ",")}
                  </p>

                  {/* Comissão */}
                  <div className="text-right">
                    <p className="text-base font-bold text-blue-400">
                      R$ {(offerCommission / 100).toFixed(2).replace(".", ",")}
                    </p>
                    <p className="text-xs text-gray-500">{commissionPercent}%</p>
                  </div>

                  {/* URL */}
                  <div className="pl-4 min-w-0">
                    <code className="text-[10px] text-gray-400 truncate block" title={offerUrl}>
                      {offerUrl}
                    </code>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1 pl-2">
                    <button
                      onClick={() => copyOfferUrl(offerUrl, offerId)}
                      className="p-1.5 rounded-lg transition-colors hover:bg-zinc-700"
                      title="Copiar URL"
                    >
                      {copiedOffer === offerId
                        ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                        : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                    <a href={offerUrl} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 rounded-lg transition-colors hover:bg-zinc-700" title="Abrir página">
                      <ExternalLink className="w-3.5 h-3.5 text-gray-400 hover:text-emerald-400" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Regras (se existir) ── */}
        {product.affiliate?.rules && (
          <>
            <Separator style={{ backgroundColor: '#27272a' }} />
            <section className="py-8 space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                Regras
                <Info className="w-4 h-4 text-gray-500" />
              </h2>
              <div className="rounded-xl p-4 text-sm text-gray-300 whitespace-pre-line leading-relaxed"
                style={{ backgroundColor: '#18181b', border: '1px solid #27272a' }}>
                {product.affiliate.rules}
              </div>
            </section>
          </>
        )}

        {/* ── Botão copiar link ── */}
        <div className="py-6 flex justify-center">
          <button
            onClick={copyInviteLink}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-gray-300 transition-colors hover:text-white"
            style={{ border: '1px solid #3f3f46', backgroundColor: 'transparent' }}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copiado!" : "Copiar link de convite"}
          </button>
        </div>

        {/* ── Logo ── */}
        <div className="pb-10 flex justify-center">
          <img
            src="/logo-volatuspay.png"
            alt="VolatusPay"
            className="h-8 opacity-40"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

      </div>
    </div>
  );
}
