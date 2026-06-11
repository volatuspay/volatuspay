import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CheckCircle2 } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useTenantStore } from "@/stores/tenant";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { formatCentsToReais } from "@shared/schema";

// Tipo que o schema aceita - sempre D30 ou D20 (chave do tier, não o número de dias)
type AnticipationTier = 'D30' | 'D20';

export default function SellerFees() {
  const { tenant } = useTenantStore();
  const { toast } = useToast();
  // D30 = padrão, D20 = antecipado (independente dos dias reais configurados pelo admin)
  const [selectedTier, setSelectedTier] = useState<AnticipationTier>('D30');

  const { data: globalFees, isLoading: loadingGlobal } = useQuery({
    queryKey: ['/api/fees/global'],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/fees/global', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Falha ao carregar taxas globais');
      return response.json();
    },
  });

  // Taxas reais do adquirente padrão configurado no admin (fonte primária)
  const { data: acquirerFees } = useQuery({
    queryKey: ['/api/payment-fees'],
    queryFn: async () => {
      const response = await fetch('/api/payment-fees');
      if (!response.ok) return null;
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: sellerFees, isLoading: loadingSeller } = useQuery({
    queryKey: ['/api/fees/seller', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/fees/seller/${tenant?.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Falha ao carregar taxas do seller');
      }
      return response.json();
    },
  });

  // Inicializa com a preferência salva do seller, ou o default global
  useEffect(() => {
    if (sellerFees?.creditCardBR_selected) {
      setSelectedTier(sellerFees.creditCardBR_selected as AnticipationTier);
    } else if (globalFees?.creditCardBR_default) {
      setSelectedTier(globalFees.creditCardBR_default as AnticipationTier);
    }
  }, [sellerFees, globalFees]);

  const updateAnticipationMutation = useMutation({
    mutationFn: async (tier: AnticipationTier) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/fees/seller/${tenant?.id}/anticipation`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ anticipation: tier }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao atualizar preferência');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fees/seller', tenant?.id] });
      toast({
        title: "Preferência atualizada!",
        description: "Sua escolha de antecipação foi salva com sucesso.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Erro ao atualizar",
        description: err.message || "Não foi possível salvar sua preferência. Tente novamente.",
        variant: "destructive",
      });
      // Reverte estado visual em caso de erro
      const saved = sellerFees?.creditCardBR_selected ?? globalFees?.creditCardBR_default ?? 'D30';
      setSelectedTier(saved as AnticipationTier);
    },
  });

  const handleAnticipationToggle = (checked: boolean) => {
    const tier: AnticipationTier = checked ? 'D20' : 'D30';
    setSelectedTier(tier);
    updateAnticipationMutation.mutate(tier);
  };

  // Taxas reais do adquirente padrão > override do seller > config global estática
  const pixFee = sellerFees?.pix ?? (acquirerFees ? {
    percentageFee: acquirerFees.pixPercentFee,
    fixedFeeCents: acquirerFees.pixFixedFee,
    releaseDays: acquirerFees.pixReleaseDays,
  } : globalFees?.pix);

  const d30Fee = sellerFees?.creditCardBR_D30 ?? (acquirerFees ? {
    percentageFee: acquirerFees.creditCardBRPercentFee,
    fixedFeeCents: acquirerFees.creditCardBRFixedFee,
    releaseDays: acquirerFees.creditCardBRReleaseDays,
  } : globalFees?.creditCardBR_D30);

  const d20Fee = sellerFees?.creditCardBR_D20 ?? globalFees?.creditCardBR_D20;

  const boletoFee = sellerFees?.boleto ?? (acquirerFees ? {
    percentageFee: acquirerFees.boletoPercentFee,
    fixedFeeCents: acquirerFees.boletoFixedFee,
    releaseDays: acquirerFees.boletoReleaseDays,
  } : globalFees?.boleto);

  // Prazo exibido é dinâmico - definido pelo admin no painel de adquirentes
  const standardDays: number = d30Fee?.releaseDays ?? 30;
  const anticipationDays: number = d20Fee?.releaseDays ?? 20;

  const anticipationExtraPercent: number = (() => {
    const extra = d20Fee?.anticipationFeePercent;
    if (extra !== undefined && extra > 0) return extra;
    const diff = (d20Fee?.percentageFee ?? 0) - (d30Fee?.percentageFee ?? 0);
    return diff > 0 ? diff : 0;
  })();

  const isLoading = loadingGlobal || loadingSeller;
  const isAnticipationActive = selectedTier === 'D20';

  return (
    <DashboardLayout>
      <div className="container mx-auto px-3 md:px-6 py-4 md:py-6 max-w-7xl">
        {isLoading ? (
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-muted rounded w-3/4"></div>
                <div className="h-4 bg-muted rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="shadow-sm border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Taxas de Pagamento
                </CardTitle>
                <CardDescription className="text-xs">
                  PIX, Cartão de Crédito e opções de antecipação
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Toggle de Antecipação */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-muted/30 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={isAnticipationActive}
                      onCheckedChange={handleAnticipationToggle}
                      disabled={updateAnticipationMutation.isPending}
                    />
                    <div>
                      <Label className="text-sm font-semibold">
                        Antecipação Automática (D{anticipationDays})
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Receba em {anticipationDays} dias com taxa adicional
                        {anticipationExtraPercent > 0 && ` de +${anticipationExtraPercent.toFixed(1)}%`}
                      </p>
                    </div>
                  </div>
                  {isAnticipationActive && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#2563eb]/10 rounded-full self-start sm:self-auto">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#2563eb]" />
                      <span className="text-xs font-medium text-[#2563eb]">Ativo</span>
                    </div>
                  )}
                </div>

                <Separator />

                {/* 4 Cards: PIX, Boleto, Standard, Antecipado */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* PIX */}
                  <Card className="shadow-sm border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">PIX</CardTitle>
                      <p className="text-xs text-muted-foreground">Recebimento Instantâneo</p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Percentual</label>
                        <p className="text-lg font-semibold mt-0.5">{pixFee?.percentageFee ?? 0}%</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Fixa</label>
                        <p className="text-sm font-medium mt-0.5">{formatCentsToReais(pixFee?.fixedFeeCents ?? 0)}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prazo</label>
                        <p className="text-sm font-medium mt-0.5 text-[#2563eb]">
                          {(pixFee?.releaseDays ?? 0) === 0 ? 'Imediato (D0)' : `D${pixFee?.releaseDays}`}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Boleto */}
                  <Card className="shadow-sm border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Boleto</CardTitle>
                      <p className="text-xs text-muted-foreground">Bancário</p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Percentual</label>
                        <p className="text-lg font-semibold mt-0.5">{boletoFee?.percentageFee ?? 0}%</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Fixa</label>
                        <p className="text-sm font-medium mt-0.5">{formatCentsToReais(boletoFee?.fixedFeeCents ?? 0)}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prazo</label>
                        <p className="text-sm font-medium mt-0.5">{boletoFee?.releaseDays ?? 2} dias</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Padrão (D30 tier) */}
                  <Card
                    className={`shadow-sm transition-all cursor-pointer ${!isAnticipationActive ? 'ring-2 ring-[#2563eb]' : 'hover:shadow-md'}`}
                    onClick={() => { setSelectedTier('D30'); updateAnticipationMutation.mutate('D30'); }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold">D{standardDays}</CardTitle>
                        {!isAnticipationActive && <CheckCircle2 className="h-3.5 w-3.5 text-[#2563eb]" />}
                      </div>
                      <p className="text-xs text-muted-foreground">Padrão</p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Total</label>
                        <p className="text-lg font-semibold mt-0.5">{d30Fee?.percentageFee ?? 0}%</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Fixa</label>
                        <p className="text-sm font-medium mt-0.5">{formatCentsToReais(d30Fee?.fixedFeeCents ?? 0)}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prazo</label>
                        <p className="text-sm font-medium mt-0.5">{standardDays} dias</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Antecipado (D20 tier) */}
                  <Card
                    className={`shadow-sm transition-all cursor-pointer ${isAnticipationActive ? 'ring-2 ring-[#2563eb]' : 'hover:shadow-md'}`}
                    onClick={() => { setSelectedTier('D20'); updateAnticipationMutation.mutate('D20'); }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold">D{anticipationDays}</CardTitle>
                        {isAnticipationActive && <CheckCircle2 className="h-3.5 w-3.5 text-[#2563eb]" />}
                      </div>
                      <p className="text-xs text-muted-foreground">Antecipado</p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Total</label>
                        <p className="text-lg font-semibold mt-0.5">{d20Fee?.percentageFee ?? 0}%</p>
                        {anticipationExtraPercent > 0 && (
                          <p className="text-xs text-muted-foreground">(+{anticipationExtraPercent.toFixed(1)}% antecipação)</p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Taxa Fixa</label>
                        <p className="text-sm font-medium mt-0.5">{formatCentsToReais(d20Fee?.fixedFeeCents ?? 0)}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prazo</label>
                        <p className="text-sm font-medium mt-0.5">{anticipationDays} dias</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
