import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DollarSign, CreditCard, Smartphone, Settings, Shield, AlertCircle, CheckCircle, Zap, Building, Banknote, TrendingUp, Globe, X, ChevronRight, Layers, Eye, EyeOff, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DashboardLayout from "@/components/layout/dashboard-layout";

import { useToast } from "@/hooks/use-toast";

export default function AdminAcquirers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();


  // BUSCAR CONFIGURAÇÕES VIA API EXPRESS (usa Admin SDK, bypassa regras Firestore)
  const { data: config, isLoading } = useQuery({
    queryKey: ["admin-acquirers-config"],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/acquirers-config', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return {};
      const json = await res.json();
      return json.config || json || {};
    },
  });

  // SALVAR VIA API EXPRESS (usa Admin SDK, bypassa regras Firestore)
  const saveConfigMutation = useMutation({
    mutationFn: async ({ acquirer, config }: { acquirer: string, config: Record<string, any> }) => {
      if (!config || typeof config !== 'object') throw new Error('Dados de configuração inválidos');
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/acquirers-config', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ [acquirer]: config })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Falha ao salvar');
      }
      return await res.json();
    },
    onSuccess: (data, variables) => {
      console.log('SALVAMENTO CONFIRMADO NO FRONTEND:', data);
      toast({
        title: " CONFIGURAÇES SALVAS ETERNAMENTE!",
        description: `Taxas ${variables.acquirer.toUpperCase()} aplicadas globalmente em Firebase real!`,
      });
      
      // FORÇAR RECARREGAMENTO DOS DADOS
      queryClient.invalidateQueries({ queryKey: ["admin-acquirers-config"] });
      
      // LOG DETALHADO DO SUCESSO
      console.log('DADOS PERSISTIDOS NO FIREBASE ETERNO:', {
        acquirer: variables.acquirer,
        timestamp: data.timestamp,
        config: variables.config
      });
    },
    onError: (error) => {
      console.error("ERRO CRTICO ao salvar:", error);
      console.error("Stack trace:", error.stack);
      toast({
        title: " FALHA NO SALVAMENTO",
        description: `Erro: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  // GERENCIAR GATEWAYS PADRÃO - 4 CATEGORIAS SEPARADAS
  const [defaultAcquirers, setDefaultAcquirers] = useState({
    pix: 'efibank',
    creditCardBR: 'efibank',
    creditCardGlobal: 'stripe',
    boleto: 'efibank'
  });

  // Atualizar quando config carregar
  useEffect(() => {
    if (config?.defaultAcquirers) {
      console.log('Atualizando defaultAcquirers com config:', config.defaultAcquirers);
      const legacyCard = config.defaultAcquirers.creditCard;
      const isLegacyGlobal = legacyCard === 'stripe';
      setDefaultAcquirers({
        pix: config.defaultAcquirers.pix || 'efibank',
        creditCardBR: config.defaultAcquirers.creditCardBR || (!isLegacyGlobal && legacyCard ? legacyCard : 'efibank'),
        creditCardGlobal: config.defaultAcquirers.creditCardGlobal || (isLegacyGlobal ? legacyCard : 'stripe'),
        boleto: config.defaultAcquirers.boleto || 'efibank'
      });
    }
  }, [config?.defaultAcquirers]);

  // MUTATION PARA SALVAR GATEWAYS PADRÃO (via API Express)
  const saveDefaultAcquirersMutation = useMutation({
    mutationFn: async (defaults: typeof defaultAcquirers) => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/acquirers-config', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ defaultAcquirers: defaults })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Falha ao salvar gateways padrão');
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "GATEWAYS PADRÃO SALVOS!",
        description: "As configurações foram aplicadas e ficaro permanentes.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-acquirers-config"] });
    },
    onError: (error) => {
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleDefaultChange = (method: 'pix' | 'creditCardBR' | 'creditCardGlobal' | 'boleto', acquirer: string) => {
    const newDefaults = { ...defaultAcquirers, [method]: acquirer };
    setDefaultAcquirers(newDefaults);
    saveDefaultAcquirersMutation.mutate(newDefaults);
  };

  const handleSave = (acquirer: string, newData: Record<string, any>) => {
    console.log(`Salvando configuração para ${acquirer}:`, newData);
    saveConfigMutation.mutate({ 
      acquirer: acquirer, 
      config: newData 
    });
  };

  // Estado do card selecionado
  const [selectedAcquirer, setSelectedAcquirer] = useState<string | null>(null);

  // ── BUNNY CDN: estado e persistência ─────────────────────────────
  const [bunny, setBunny] = useState({
    storageApiKey: '',
    streamApiKey: '',
    storageZoneName: '',
    cdnHostname: '',
    storageRegion: 'de',
    streamLibraryId: '',
    enabled: true,
  });
  const [showBunnyKey, setShowBunnyKey] = useState(false);
  const [showBunnyStreamKey, setShowBunnyStreamKey] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/admin/payment-config', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const json = await res.json();
        const b = json?.bunny;
        if (b) setBunny(prev => ({ ...prev, ...b }));
      } catch {}
    })();
  }, []);

  const saveBunnyMutation = useMutation({
    mutationFn: async (data: typeof bunny) => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/payment-config', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bunny: data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Falha ao salvar Bunny CDN');
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: '✅ Bunny CDN salvo!', description: 'Credenciais persistidas no Firebase.' });
    },
    onError: (e: any) => {
      toast({ title: '❌ Erro ao salvar Bunny CDN', description: e.message, variant: 'destructive' });
    },
  });


  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-base font-medium text-muted-foreground">Carregando adquirentes...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Definição dos adquirentes
  const ACQUIRERS = [
    {
      id: 'efibank',
      name: 'Efi Bank',
      description: 'PIX · Boleto · Cartão BR',
      logo: '/logos/efibank.svg',
    },
    {
      id: 'onzfinance',
      name: 'ONZ Finance',
      description: 'PIX · Cash-out · TEF',
      logo: '/logos/onzfinance.svg',
    },
    {
      id: 'stripe',
      name: 'Stripe',
      description: 'Cartão Global · Internacional',
      logo: '/logos/stripe.svg',
    },
    {
      id: 'woovi',
      name: 'Woovi',
      description: 'PIX Instantâneo · OpenPix',
      logo: '/logos/woovi.svg',
    },
    {
      id: 'pagarme',
      name: 'Pagar.me',
      description: 'PIX · Boleto · Cartão',
      logo: '/logos/pagarme.svg',
    },

  ] as const;

  const isActive = (id: string) => {
    if (id === 'onzfinance') return true;
    return !!(config as any)?.[id]?.enabled;
  };

  const isDefaultFor = (id: string) => {
    return Object.values(defaultAcquirers).includes(id as any);
  };

  const selectedInfo = ACQUIRERS.find(a => a.id === selectedAcquirer);

  return (
    <DashboardLayout>
      <div className="space-y-8">

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Adquirentes</h1>
              <p className="text-sm text-muted-foreground">Selecione um adquirente para configurar</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-emerald-600 border-emerald-300 dark:border-emerald-700">
              <CheckCircle className="w-3 h-3 mr-1" />
              Em produção
            </Badge>
          </div>
        </div>

        {/* ── GATEWAYS PADRÃO (compacto) ─────────────────────────────── */}
        <div className="rounded-2xl border bg-card dark:bg-zinc-900/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Gateways Padrão</span>
            <span className="text-xs text-muted-foreground ml-1">- salvo automaticamente</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(
              [
                {
                  key: 'pix' as const,
                  label: 'PIX',
                  icon: Smartphone,
                  options: [
                    { id: 'efibank', label: 'Efi Bank' },
                    { id: 'onzfinance', label: 'ONZ Finance' },
                    { id: 'woovi', label: 'Woovi' },
                    { id: 'pagarme', label: 'Pagar.me' },

                  ],
                },
                {
                  key: 'creditCardBR' as const,
                  label: 'Cartão BR',
                  icon: CreditCard,
                  options: [
                    { id: 'efibank', label: 'Efi Bank' },
                    { id: 'stripe', label: 'Stripe' },
                    { id: 'pagarme', label: 'Pagar.me' },
                  ],
                },
                {
                  key: 'creditCardGlobal' as const,
                  label: 'Cartão Global',
                  icon: Globe,
                  options: [
                    { id: 'stripe', label: 'Stripe' },
                  ],
                },
                {
                  key: 'boleto' as const,
                  label: 'Boleto',
                  icon: Banknote,
                  options: [
                    { id: 'efibank', label: 'Efi Bank' },
                    { id: 'woovi', label: 'Woovi' },
                    { id: 'pagarme', label: 'Pagar.me' },
                  ],
                },
              ] as const
            ).map(({ key, label, icon: Icon, options }) => (
              <div key={key} className="rounded-xl border bg-background dark:bg-zinc-800 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">{label}</span>
                </div>
                <select
                  value={defaultAcquirers[key]}
                  onChange={(e) => handleDefaultChange(key, e.target.value)}
                  className="w-full text-xs rounded-lg border bg-background dark:bg-zinc-900 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  data-testid={`select-default-${key}`}
                >
                  {options.map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {saveDefaultAcquirersMutation.isPending && (
            <p className="text-xs text-yellow-600 mt-3 flex items-center gap-1">
              <span className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin inline-block" />
              Salvando...
            </p>
          )}
        </div>

        {/* ── GRID DE ADQUIRENTES ────────────────────────────────────── */}
        {(() => {
          const PIX_IDS = ['efibank', 'onzfinance', 'woovi', 'pagarme'];
          const CARD_IDS = ['stripe'];
          const pixAcquirers = ACQUIRERS.filter(a => PIX_IDS.includes(a.id));
          const cardAcquirers = ACQUIRERS.filter(a => CARD_IDS.includes(a.id));

          const renderCard = (acq: typeof ACQUIRERS[number]) => {
            const active = isActive(acq.id);
            const isDefault = isDefaultFor(acq.id);
            const selected = selectedAcquirer === acq.id;
            return (
              <button
                key={acq.id}
                onClick={() => {
                  if (acq.comingSoon) return;
                  setSelectedAcquirer(acq.id);
                }}
                disabled={!!acq.comingSoon}
                className={[
                  'relative text-left rounded-2xl border p-4 transition-all duration-200 group',
                  'bg-white dark:bg-zinc-900',
                  selected
                    ? 'border-emerald-500 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-500/30'
                    : 'border-border hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-md',
                  acq.comingSoon ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
              >
                <span className={['absolute top-3 right-3 w-2.5 h-2.5 rounded-full', active ? 'bg-zinc-50 dark:bg-zinc-800/600 shadow-sm shadow-emerald-400' : 'bg-zinc-300 dark:bg-zinc-600'].join(' ')} />
                <div className="w-11 h-11 rounded-xl bg-white dark:bg-zinc-800 border border-border flex items-center justify-center mb-3 shadow-sm overflow-hidden">
                  <img src={acq.logo} alt={acq.name} className="w-8 h-8 object-contain" />
                </div>
                <p className="text-sm font-bold text-foreground leading-tight">{acq.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{acq.description}</p>
                {isDefault && !acq.comingSoon && (
                  <span className="inline-block mt-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                    Padrão
                  </span>
                )}
                {!acq.comingSoon && (
                  <ChevronRight className={['absolute bottom-4 right-3 w-4 h-4 transition-all', selected ? 'text-emerald-500 rotate-90' : 'text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500'].join(' ')} />
                )}
              </button>
            );
          };

          return (
            <>
              {/* PIX */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-500" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">PIX</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {pixAcquirers.map(renderCard)}
                </div>
              </div>

              {/* CARTÃO */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cartão</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {cardAcquirers.map(renderCard)}
                </div>
              </div>

            </>
          );
        })()}

        {/* ── MODAL DE CONFIGURAÇÃO ─────────────────────────────────── */}
        <Dialog open={!!selectedAcquirer && !!selectedInfo} onOpenChange={(open) => { if (!open) setSelectedAcquirer(null); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            {selectedInfo && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white dark:bg-zinc-800 border border-border flex items-center justify-center shadow overflow-hidden">
                      <img src={selectedInfo.logo} alt={selectedInfo.name} className="w-7 h-7 object-contain"  />
                    </div>
                    <div>
                      <span className="text-base font-bold">{selectedInfo.name}</span>
                      <p className="text-xs font-normal text-muted-foreground mt-0.5">{selectedInfo.description}</p>
                    </div>
                  </DialogTitle>
                </DialogHeader>

                <div className="pt-2">
                  {selectedAcquirer === 'efibank' && (
                    <EfiBankConfig
                      config={config?.efibank}
                      onSave={(data: EfiBankConfigData) => handleSave('efibank', data)}
                      isLoading={saveConfigMutation.isPending}
                    />
                  )}
                  {selectedAcquirer === 'onzfinance' && (
                    <ONZFinanceConfig />
                  )}
                  {selectedAcquirer === 'stripe' && (
                    <StripeConfig
                      config={config?.stripe}
                      onSave={(data: StripeConfigData) => handleSave('stripe', data)}
                      isLoading={saveConfigMutation.isPending}
                    />
                  )}

                  {selectedAcquirer === 'woovi' && (
                    <WooviConfig
                      config={config?.woovi}
                      onSave={(data: WooviConfigData) => handleSave('woovi', data)}
                      isLoading={saveConfigMutation.isPending}
                    />
                  )}
                  {selectedAcquirer === 'pagarme' && (
                    <PagarMeConfig
                      config={config?.pagarme}
                      onSave={(data: PagarMeConfigData) => handleSave('pagarme', data)}
                      isLoading={saveConfigMutation.isPending}
                    />
                  )}

                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </DashboardLayout>
  );
}

// ─── WITHDRAWAL DAY SELECTORS ────────────────────────────────────────────────

const WITHDRAWAL_OPTIONS = [0, 2, 7, 15, 20, 30];

function WithdrawalPills({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {WITHDRAWAL_OPTIONS.map(d => (
        <button key={d} type="button" onClick={() => onChange(d)}
          className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-all ${
            value === d
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-background text-muted-foreground border-border hover:border-blue-400 hover:text-blue-600'
          }`}>
          D{d}
        </button>
      ))}
    </div>
  );
}

function WithdrawalDaysSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={e => onChange(parseInt(e.target.value))}
      className="h-8 w-full text-sm border border-input bg-background rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-ring">
      {WITHDRAWAL_OPTIONS.map(d => (
        <option key={d} value={d}>D{d}</option>
      ))}
    </select>
  );
}

// ─── UNIFIED FEE TAB PANEL ───────────────────────────────────────────────────

interface FeeState {
  pixFeeFixed: number;
  pixFeePercent: number;
  pixWithdrawalDays: number;
  cardFeeFixed: number;
  cardFeePercent: number;
  installment1x: number;
  withdrawalDays1x: number;
  installment6x: number;
  withdrawalDays6x: number;
  installment8x: number;
  withdrawalDays8x: number;
  installment12x: number;
  withdrawalDays12x: number;
  cardAnticipationDays: number;
  cardAnticipationFeePercent: number;
}

function FeeTabPanel({
  capabilities,
  data,
  onChange,
}: {
  capabilities: { pix?: boolean; card?: boolean };
  data: Partial<FeeState>;
  onChange: (updates: Partial<FeeState>) => void;
}) {
  const hasBoth = capabilities.pix && capabilities.card;
  const [activeTab, setActiveTab] = useState<'pix' | 'card'>(
    capabilities.pix ? 'pix' : 'card'
  );
  const n = (v: string) => parseFloat(v) || 0;
  const i = (v: string) => parseInt(v) || 0;

  const INSTALLMENTS: { label: string; rateKey: keyof FeeState; daysKey: keyof FeeState }[] = [
    { label: '1x',      rateKey: 'installment1x',  daysKey: 'withdrawalDays1x'  },
    { label: 'até 6x',  rateKey: 'installment6x',  daysKey: 'withdrawalDays6x'  },
    { label: 'até 8x',  rateKey: 'installment8x',  daysKey: 'withdrawalDays8x'  },
    { label: 'até 12x', rateKey: 'installment12x', daysKey: 'withdrawalDays12x' },
  ];

  return (
    <div className="border rounded-xl overflow-hidden">
      {hasBoth && (
        <div className="flex border-b bg-zinc-50 dark:bg-zinc-800/60">
          {(['pix', 'card'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? `bg-background border-b-2 ${tab === 'pix' ? 'border-emerald-500 text-emerald-600' : 'border-blue-500 text-blue-600'}`
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'pix' ? <Smartphone className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
              {tab === 'pix' ? 'PIX' : 'Cartão'}
            </button>
          ))}
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* PIX tab */}
        {capabilities.pix && (!hasBoth || activeTab === 'pix') && (
          <>
            {!hasBoth && (
              <div className="flex items-center gap-2 pb-2 border-b">
                <Smartphone className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-sm">Taxas PIX</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Taxa Fixa (R$)</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={data.pixFeeFixed ?? 0}
                  onChange={e => onChange({ pixFeeFixed: n(e.target.value) })}
                  className="mt-1 h-9"
                />
                <p className="text-xs text-muted-foreground mt-1">Valor fixo por venda</p>
              </div>
              <div>
                <Label className="text-xs font-medium">Taxa % (%)</Label>
                <Input
                  type="number" step="0.01" min="0" max="20"
                  value={data.pixFeePercent ?? 0}
                  onChange={e => onChange({ pixFeePercent: n(e.target.value) })}
                  className="mt-1 h-9"
                />
                <p className="text-xs text-muted-foreground mt-1">% sobre a venda</p>
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium">Prazo de Saque</Label>
              <WithdrawalPills
                value={data.pixWithdrawalDays ?? 1}
                onChange={v => onChange({ pixWithdrawalDays: v })}
              />
              <p className="text-xs text-muted-foreground mt-1">Dias após aprovação do PIX</p>
            </div>
          </>
        )}

        {/* Cartão tab */}
        {capabilities.card && (!hasBoth || activeTab === 'card') && (
          <>
            {!hasBoth && (
              <div className="flex items-center gap-2 pb-2 border-b">
                <CreditCard className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-sm">Taxas Cartão</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Taxa Fixa (R$)</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={data.cardFeeFixed ?? 0}
                  onChange={e => onChange({ cardFeeFixed: n(e.target.value) })}
                  className="mt-1 h-9"
                />
                <p className="text-xs text-muted-foreground mt-1">Valor fixo por venda</p>
              </div>
              <div>
                <Label className="text-xs font-medium">Taxa Base (%)</Label>
                <Input
                  type="number" step="0.01" min="0" max="30"
                  value={data.cardFeePercent ?? 0}
                  onChange={e => onChange({ cardFeePercent: n(e.target.value) })}
                  className="mt-1 h-9"
                />
                <p className="text-xs text-muted-foreground mt-1">% à vista s/ parcelamento</p>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-3 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 border-b text-xs font-semibold text-muted-foreground">
                <span>Parcelamento</span>
                <span>Taxa (%)</span>
                <span>Prazo Saque</span>
              </div>
              {INSTALLMENTS.map(({ label, rateKey, daysKey }) => (
                <div key={label} className="grid grid-cols-3 items-center px-3 py-2 border-b last:border-b-0 gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  <Input
                    type="number" step="0.01" min="0" max="30"
                    value={(data[rateKey] as number) ?? 0}
                    onChange={e => onChange({ [rateKey]: n(e.target.value) })}
                    className="h-8 text-sm"
                  />
                  <WithdrawalDaysSelect
                    value={(data[daysKey] as number) ?? 30}
                    onChange={v => onChange({ [daysKey]: v })}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Assinaturas: valor único (sem parcelamento). Digital: até 12x.
            </p>

            {/* ── Antecipação de Recebimento ── */}
            <div className="border rounded-lg p-3 space-y-3 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm font-semibold">Antecipação de Recebimento</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Define o prazo antecipado e a taxa extra cobrada quando o seller ativa a antecipação.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Prazo Antecipado</Label>
                  <WithdrawalPills
                    value={data.cardAnticipationDays ?? 15}
                    onChange={v => onChange({ cardAnticipationDays: v })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Seller recebe em D+X ao ativar</p>
                </div>
                <div>
                  <Label className="text-xs font-medium">Taxa Adicional (%)</Label>
                  <Input
                    type="number" step="0.1" min="0" max="10"
                    value={data.cardAnticipationFeePercent ?? 1.0}
                    onChange={e => onChange({ cardAnticipationFeePercent: n(e.target.value) })}
                    className="mt-1 h-9"
                  />
                  <p className="text-xs text-muted-foreground mt-1">% extra cobrado pela antecipação</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── EFI BANK ─────────────────────────────────────────────────────────────────

interface EfiBankConfigData {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  pixFeeFixed: number;
  pixFeePercent: number;
  pixWithdrawalDays: number;
  cardFeeFixed: number;
  cardFeePercent: number;
  installment1x: number;
  withdrawalDays1x: number;
  installment6x: number;
  withdrawalDays6x: number;
  installment8x: number;
  withdrawalDays8x: number;
  installment12x: number;
  cardAnticipationDays: number;
  cardAnticipationFeePercent: number;
  withdrawalDays12x: number;
  productionClientId?: string;
  productionClientSecret?: string;
  pixKey?: string;
  [key: string]: any;
}

interface EfiBankConfigProps {
  config?: EfiBankConfigData;
  onSave: (data: EfiBankConfigData) => void;
  isLoading: boolean;
}

const EFI_DEFAULTS: EfiBankConfigData = {
  enabled: true,
  environment: 'sandbox',
  pixFeeFixed: 0,
  pixFeePercent: 0.99,
  pixWithdrawalDays: 1,
  cardFeeFixed: 0,
  cardFeePercent: 3.99,
  installment1x: 3.99,
  withdrawalDays1x: 20,
  installment6x: 4.99,
  withdrawalDays6x: 25,
  installment8x: 5.99,
  withdrawalDays8x: 30,
  installment12x: 6.99,
  withdrawalDays12x: 30,
  cardAnticipationDays: 15,
  cardAnticipationFeePercent: 1.0,
  productionClientId: '',
  productionClientSecret: '',
  pixKey: '',
};

function normalizeEfi(raw: any): EfiBankConfigData {
  return {
    ...EFI_DEFAULTS,
    ...raw,
    pixWithdrawalDays: raw.pixWithdrawalDays ?? raw.withdrawalDays ?? EFI_DEFAULTS.pixWithdrawalDays,
    installment6x: raw.installment6x ?? raw.installment2to6x ?? EFI_DEFAULTS.installment6x,
    installment8x: raw.installment8x ?? raw.installment7to9x ?? EFI_DEFAULTS.installment8x,
    installment12x: raw.installment12x ?? raw.installment10to12x ?? EFI_DEFAULTS.installment12x,
    withdrawalDays6x: raw.withdrawalDays6x ?? raw.withdrawalDays2to6x ?? EFI_DEFAULTS.withdrawalDays6x,
    withdrawalDays8x: raw.withdrawalDays8x ?? raw.withdrawalDays7to9x ?? EFI_DEFAULTS.withdrawalDays8x,
    withdrawalDays12x: raw.withdrawalDays12x ?? raw.withdrawalDays10to12x ?? EFI_DEFAULTS.withdrawalDays12x,
    productionClientId: raw.productionClientId || '',
    productionClientSecret: raw.productionClientSecret || '',
    pixKey: raw.pixKey || '',
  };
}

function EfiBankConfig({ config, onSave, isLoading }: EfiBankConfigProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<EfiBankConfigData>(config ? normalizeEfi(config) : EFI_DEFAULTS);
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certUploading, setCertUploading] = useState(false);

  useEffect(() => {
    if (config) setFormData(normalizeEfi(config));
  }, [config]);

  const set = (updates: Partial<EfiBankConfigData>) =>
    setFormData(prev => ({ ...prev, ...updates }));

  const toggleShow = (field: string) =>
    setShowPass(prev => ({ ...prev, [field]: !prev[field] }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      installment2to6x: formData.installment6x,
      installment7to9x: formData.installment8x,
      installment10to12x: formData.installment12x,
      withdrawalDays: formData.pixWithdrawalDays,
      withdrawalDays2to6x: formData.withdrawalDays6x,
      withdrawalDays7to9x: formData.withdrawalDays8x,
      withdrawalDays10to12x: formData.withdrawalDays12x,
    });
  };

  const handleCertUpload = async () => {
    if (!certFile) return;
    setCertUploading(true);
    try {
      const { auth } = await import('@/lib/firebase');
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado');
      const token = await user.getIdToken();
      const fd = new FormData();
      fd.append('certificate', certFile);
      const res = await fetch('/api/admin/efibank/certificate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Erro ${res.status}`);
      }
      toast({ title: 'Certificado enviado com sucesso!' });
      setCertFile(null);
    } catch (err: any) {
      toast({ title: 'Erro ao enviar certificado', description: err?.message, variant: 'destructive' });
    } finally {
      setCertUploading(false);
    }
  };

  const credField = (
    label: string,
    field: keyof EfiBankConfigData,
    placeholder: string,
    secret = true,
  ) => (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="relative">
        <Input
          type={secret && !showPass[field as string] ? 'password' : 'text'}
          value={(formData[field] as string) || ''}
          onChange={e => set({ [field]: e.target.value })}
          placeholder={placeholder}
          className="pr-9 text-sm font-mono"
          autoComplete="off"
        />
        {secret && (
          <button
            type="button"
            onClick={() => toggleShow(field as string)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showPass[field as string] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Smartphone className="w-5 h-5" /> Efi Bank - PIX + Cartao + Boleto
        </CardTitle>
        <CardDescription>Configure credenciais e taxas da Efi Bank</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label className="font-medium">Ativar Efi Bank</Label>
                <p className="text-xs text-muted-foreground">Habilitar PIX, cartao e boleto</p>
              </div>
              <Switch checked={formData.enabled} onCheckedChange={v => set({ enabled: v })} />
            </div>
            <div className="p-3 border rounded-lg">
              <Label className="font-medium mb-2 block">Ambiente</Label>
              <div className="flex gap-4">
                {(['sandbox', 'production'] as const).map(env => (
                  <label key={env} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio" name="efi-env"
                      checked={formData.environment === env}
                      onChange={() => set({ environment: env })}
                      className="w-4 h-4 accent-emerald-500"
                    />
                    {env === 'sandbox' ? 'Sandbox (Teste)' : <span className="font-semibold text-emerald-600">Producao</span>}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Credenciais */}
          <div className="border rounded-lg p-4 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" /> Credenciais
            </p>

            <div className="grid grid-cols-2 gap-3">
              {credField('Client ID', 'productionClientId', 'Client_Id_producao...')}
              {credField('Client Secret', 'productionClientSecret', 'Client_Secret_producao...')}
            </div>

            {credField('Chave PIX', 'pixKey', 'CPF, CNPJ, e-mail, telefone ou chave aleatoria', false)}

            {/* Certificado .p12 */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Certificado (.p12)</Label>
              <div className="flex items-center gap-2">
                <label className="flex-1 flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer text-sm text-muted-foreground hover:bg-muted/40 transition-colors">
                  <Upload className="w-4 h-4 shrink-0" />
                  <span className="truncate">{certFile ? certFile.name : 'Selecionar arquivo .p12...'}</span>
                  <input
                    type="file"
                    accept=".p12,.pfx"
                    className="hidden"
                    onChange={e => setCertFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!certFile || certUploading}
                  onClick={handleCertUpload}
                  className="shrink-0"
                >
                  {certUploading ? 'Enviando...' : 'Enviar'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O certificado e salvo no servidor de forma segura. Envie apenas quando precisar atualizar.
              </p>
            </div>
          </div>

          <FeeTabPanel
            capabilities={{ pix: true, card: true }}
            data={formData}
            onChange={set}
          />

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? 'Salvando...' : 'Salvar Efi Bank'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── STRIPE ───────────────────────────────────────────────────────────────────

interface StripeConfigData {
  enabled: boolean;
  cardFeeFixed: number;
  cardFeePercent: number;
  installment1x: number;
  withdrawalDays1x: number;
  installment6x: number;
  withdrawalDays6x: number;
  installment8x: number;
  withdrawalDays8x: number;
  installment12x: number;
  withdrawalDays12x: number;
  cardAnticipationDays: number;
  cardAnticipationFeePercent: number;
  [key: string]: any;
}

interface StripeConfigProps {
  config?: StripeConfigData;
  onSave: (data: StripeConfigData) => void;
  isLoading: boolean;
}

const STRIPE_DEFAULTS: StripeConfigData = {
  enabled: true,
  cardFeeFixed: 0.39,
  cardFeePercent: 5.2,
  installment1x: 5.2,
  withdrawalDays1x: 30,
  installment6x: 6.2,
  withdrawalDays6x: 30,
  installment8x: 7.2,
  withdrawalDays8x: 30,
  installment12x: 8.2,
  withdrawalDays12x: 30,
  cardAnticipationDays: 15,
  cardAnticipationFeePercent: 1.0,
};

function normalizeStripe(raw: any): StripeConfigData {
  return {
    ...STRIPE_DEFAULTS,
    ...raw,
    installment6x: raw.installment6x ?? raw.installment2to6x ?? STRIPE_DEFAULTS.installment6x,
    installment8x: raw.installment8x ?? raw.installment7to9x ?? STRIPE_DEFAULTS.installment8x,
    installment12x: raw.installment12x ?? raw.installment10to12x ?? STRIPE_DEFAULTS.installment12x,
    withdrawalDays1x: raw.withdrawalDays1x ?? raw.withdrawalDays ?? STRIPE_DEFAULTS.withdrawalDays1x,
    withdrawalDays6x: raw.withdrawalDays6x ?? raw.withdrawalDays ?? STRIPE_DEFAULTS.withdrawalDays6x,
    withdrawalDays8x: raw.withdrawalDays8x ?? raw.withdrawalDays ?? STRIPE_DEFAULTS.withdrawalDays8x,
    withdrawalDays12x: raw.withdrawalDays12x ?? raw.withdrawalDays ?? STRIPE_DEFAULTS.withdrawalDays12x,
  };
}

function StripeConfig({ config, onSave, isLoading }: StripeConfigProps) {
  const [formData, setFormData] = useState<StripeConfigData>(config ? normalizeStripe(config) : STRIPE_DEFAULTS);

  useEffect(() => {
    if (config) setFormData(normalizeStripe(config));
  }, [config]);

  const set = (updates: Partial<StripeConfigData>) =>
    setFormData(prev => ({ ...prev, ...updates }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      installment2to6x: formData.installment6x,
      installment7to9x: formData.installment8x,
      installment10to12x: formData.installment12x,
      withdrawalDays: formData.withdrawalDays1x,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CreditCard className="w-5 h-5" /> Stripe - Cartão Global
        </CardTitle>
        <CardDescription>Configure taxas do Stripe para cartões internacionais</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Ativar Stripe</Label>
              <p className="text-xs text-muted-foreground">Habilitar pagamentos internacionais</p>
            </div>
            <Switch checked={formData.enabled} onCheckedChange={v => set({ enabled: v })} />
          </div>

          <FeeTabPanel
            capabilities={{ card: true }}
            data={formData}
            onChange={set}
          />

          <div className="border rounded-lg p-3 bg-zinc-50 dark:bg-zinc-800/60 text-xs text-muted-foreground">
            <strong>Segurança:</strong> Chave pública e secreta gerenciadas exclusivamente no servidor.
          </div>

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? 'Salvando...' : 'Salvar Stripe'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── PAGAR.ME ─────────────────────────────────────────────────────────────────

interface PagarMeConfigData {
  enabled: boolean;
  environment: 'test' | 'live';
  apiKey: string;
  encryptionKey: string;
  pixFeeFixed: number;
  pixFeePercent: number;
  pixWithdrawalDays: number;
  cardFeeFixed: number;
  cardFeePercent: number;
  installment1x: number;
  withdrawalDays1x: number;
  installment6x: number;
  withdrawalDays6x: number;
  installment8x: number;
  withdrawalDays8x: number;
  installment12x: number;
  withdrawalDays12x: number;
  boletoFeeFixed: number;
  boletoFeePercent: number;
  boletoReleaseDays: number;
  cardAnticipationDays: number;
  cardAnticipationFeePercent: number;
  [key: string]: any;
}

interface PagarMeConfigProps {
  config?: PagarMeConfigData;
  onSave: (data: PagarMeConfigData) => void;
  isLoading: boolean;
}

const PAGARME_DEFAULTS: PagarMeConfigData = {
  enabled: false,
  environment: 'test',
  apiKey: '',
  encryptionKey: '',
  pixFeeFixed: 0,
  pixFeePercent: 2.99,
  pixWithdrawalDays: 1,
  cardFeeFixed: 0,
  cardFeePercent: 3.99,
  installment1x: 3.99,
  withdrawalDays1x: 30,
  installment6x: 4.99,
  withdrawalDays6x: 30,
  installment8x: 5.99,
  withdrawalDays8x: 30,
  installment12x: 6.99,
  withdrawalDays12x: 30,
  boletoFeeFixed: 3.49,
  boletoFeePercent: 0,
  boletoReleaseDays: 2,
  cardAnticipationDays: 15,
  cardAnticipationFeePercent: 1.0,
};

function normalizePagarMe(raw: any): PagarMeConfigData {
  const centToReal = (v: number) => v > 10 ? v / 100 : v;
  return {
    ...PAGARME_DEFAULTS,
    ...raw,
    pixFeeFixed: centToReal(raw.pixFeeFixed ?? 0),
    cardFeeFixed: centToReal(raw.cardFeeFixed ?? 0),
    boletoFeeFixed: centToReal(raw.boletoFeeFixed ?? 349),
    pixWithdrawalDays: raw.pixWithdrawalDays ?? raw.pixReleaseDays ?? PAGARME_DEFAULTS.pixWithdrawalDays,
    installment6x: raw.installment6x ?? raw.installment2to6x ?? PAGARME_DEFAULTS.installment6x,
    installment8x: raw.installment8x ?? raw.installment7to9x ?? PAGARME_DEFAULTS.installment8x,
    installment12x: raw.installment12x ?? raw.installment10to12x ?? PAGARME_DEFAULTS.installment12x,
    withdrawalDays1x: raw.withdrawalDays1x ?? raw.cardReleaseDays ?? PAGARME_DEFAULTS.withdrawalDays1x,
    withdrawalDays6x: raw.withdrawalDays6x ?? raw.cardReleaseDays ?? PAGARME_DEFAULTS.withdrawalDays6x,
    withdrawalDays8x: raw.withdrawalDays8x ?? raw.cardReleaseDays ?? PAGARME_DEFAULTS.withdrawalDays8x,
    withdrawalDays12x: raw.withdrawalDays12x ?? raw.cardReleaseDays ?? PAGARME_DEFAULTS.withdrawalDays12x,
  };
}

function PagarMeConfig({ config, onSave, isLoading }: PagarMeConfigProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<PagarMeConfigData>(config ? normalizePagarMe(config) : PAGARME_DEFAULTS);

  useEffect(() => {
    if (config) setFormData(normalizePagarMe(config));
  }, [config]);

  const set = (updates: Partial<PagarMeConfigData>) =>
    setFormData(prev => ({ ...prev, ...updates }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.apiKey?.trim()) {
      toast({ title: 'API Key obrigatória', variant: 'destructive' });
      return;
    }
    onSave({
      ...formData,
      installment2to6x: formData.installment6x,
      installment7to9x: formData.installment8x,
      installment10to12x: formData.installment12x,
      pixReleaseDays: formData.pixWithdrawalDays,
      cardReleaseDays: formData.withdrawalDays1x,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <DollarSign className="w-5 h-5 text-emerald-600" /> Pagar.me - PIX + Cartão + Boleto
        </CardTitle>
        <CardDescription>Configure taxas e credenciais do Pagar.me</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <Label className="font-medium">Ativar Pagar.me</Label>
              <Switch checked={formData.enabled} onCheckedChange={v => set({ enabled: v })} />
            </div>
            <div className="p-3 border rounded-lg">
              <Label className="font-medium mb-2 block">Ambiente</Label>
              <div className="flex gap-4">
                {(['test', 'live'] as const).map(env => (
                  <label key={env} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="radio" name="pm-env" checked={formData.environment === env}
                      onChange={() => set({ environment: env })} className="w-4 h-4 accent-emerald-500" />
                    {env === 'test' ? 'Teste' : <span className="font-semibold text-emerald-600">Produção</span>}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Credenciais Pagar.me</h3>
            <div>
              <Label htmlFor="pm-apikey" className="text-xs">API Key (sk_test_ ou sk_live_) *</Label>
              <Input id="pm-apikey" type="password" value={formData.apiKey}
                onChange={e => set({ apiKey: e.target.value })} placeholder="sk_test_..." className="mt-1" />
            </div>
            <div>
              <Label htmlFor="pm-enckey" className="text-xs">Encryption Key (ek_... - opcional)</Label>
              <Input id="pm-enckey" type="password" value={formData.encryptionKey}
                onChange={e => set({ encryptionKey: e.target.value })} placeholder="ek_test_..." className="mt-1" />
            </div>
          </div>

          <FeeTabPanel
            capabilities={{ pix: true, card: true }}
            data={formData}
            onChange={set}
          />

          {/* Boleto */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b">
              <Banknote className="w-4 h-4 text-yellow-600" />
              <span className="font-semibold text-sm">Taxas Boleto</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-medium">Taxa Fixa (R$)</Label>
                <Input type="number" step="0.01" min="0" value={formData.boletoFeeFixed ?? 3.49}
                  onChange={e => set({ boletoFeeFixed: parseFloat(e.target.value) || 0 })} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs font-medium">Taxa % (%)</Label>
                <Input type="number" step="0.01" min="0" value={formData.boletoFeePercent ?? 0}
                  onChange={e => set({ boletoFeePercent: parseFloat(e.target.value) || 0 })} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs font-medium">Prazo Saque (D+)</Label>
                <Input type="number" step="1" min="0" value={formData.boletoReleaseDays ?? 2}
                  onChange={e => set({ boletoReleaseDays: parseInt(e.target.value) || 0 })} className="mt-1 h-9" />
              </div>
            </div>
          </div>

          <Button type="submit" disabled={isLoading} className="w-full bg-emerald-600 hover:bg-emerald-700">
            {isLoading ? 'Salvando...' : 'Salvar Pagar.me'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface PagarMeQuickConfigProps {
  config?: PagarMeConfigData;
  onSave: (data: PagarMeConfigData) => void;
  isLoading: boolean;
}

function PagarMeQuickConfig({ config, onSave, isLoading }: PagarMeQuickConfigProps) {
  return <PagarMeConfig config={config} onSave={onSave} isLoading={isLoading} />;
}

// ─── WOOVI ────────────────────────────────────────────────────────────────────

interface WooviConfigData {
  enabled: boolean;
  pixFeeFixed: number;
  pixFeePercent: number;
  pixWithdrawalDays: number;
  [key: string]: any;
}

interface WooviConfigProps {
  config?: WooviConfigData;
  onSave: (data: WooviConfigData) => void;
  isLoading: boolean;
}

const WOOVI_DEFAULTS: WooviConfigData = {
  enabled: false,
  pixFeeFixed: 0.80,
  pixFeePercent: 0,
  pixWithdrawalDays: 1,
};

function normalizeWoovi(raw: any): WooviConfigData {
  const fee = raw.pixFeeFixed ?? 0;
  return {
    ...WOOVI_DEFAULTS,
    ...raw,
    pixFeeFixed: fee > 10 ? fee / 100 : fee,
    pixFeePercent: raw.pixFeePercent ?? 0,
    pixWithdrawalDays: raw.pixWithdrawalDays ?? raw.withdrawalDays ?? 1,
  };
}

function WooviConfig({ config, onSave, isLoading }: WooviConfigProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<WooviConfigData>(config ? normalizeWoovi(config) : WOOVI_DEFAULTS);

  useEffect(() => {
    if (config) setFormData(normalizeWoovi(config));
  }, [config]);

  const set = (updates: Partial<WooviConfigData>) =>
    setFormData(prev => ({ ...prev, ...updates }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const MIN = 0.80;
    if (formData.pixFeeFixed < MIN) {
      toast({ title: 'Taxa mínima Woovi: R$ 0,80', variant: 'destructive' });
      return;
    }
    onSave({
      ...formData,
      pixFeeFixed: Math.round(formData.pixFeeFixed * 100),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Zap className="w-5 h-5 text-emerald-600" /> Woovi (OpenPix) - PIX Instantâneo
        </CardTitle>
        <CardDescription>Configure taxas para pagamentos PIX via Woovi/OpenPix</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label className="font-medium">Ativar Woovi</Label>
              <p className="text-xs text-muted-foreground">Habilitar PIX via Woovi/OpenPix</p>
            </div>
            <Switch checked={formData.enabled} onCheckedChange={v => set({ enabled: v })} />
          </div>

          <div className="border-l-4 border-orange-500 bg-orange-50 dark:bg-orange-950/30 p-3 rounded text-xs text-orange-800 dark:text-orange-300">
            Taxa fixa mínima Woovi: <strong>R$ 0,80</strong> por transação PIX.
          </div>

          <FeeTabPanel
            capabilities={{ pix: true }}
            data={formData}
            onChange={set}
          />

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? 'Salvando...' : 'Salvar Woovi'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── ONZ FINANCE ──────────────────────────────────────────────────────────────

function ONZFinanceConfig() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState({ cashIn: false, cashOut: false });
  const [form, setForm] = useState({
    clientIdCashIn: '',
    clientSecretCashIn: '',
    clientIdCashOut: '',
    clientSecretCashOut: '',
    pixKey: '',
    environment: 'production',
    pixFeeFixed: 0,
    pixFeePercent: 1.5,
    pixWithdrawalDays: 1,
  });

  useEffect(() => {
    (async () => {
      try {
        const { auth } = await import('@/lib/firebase');
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/admin/onz-finance-credentials', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && data.credentials) {
          setForm(prev => ({
            ...prev,
            clientIdCashIn: data.credentials.clientIdCashIn || '',
            clientSecretCashIn: data.credentials.clientSecretCashIn || '',
            clientIdCashOut: data.credentials.clientIdCashOut || '',
            clientSecretCashOut: data.credentials.clientSecretCashOut || '',
            pixKey: data.credentials.pixKey || '',
            environment: data.credentials.environment || 'production',
            pixFeeFixed: data.credentials.pixFeeFixed ?? 0,
            pixFeePercent: data.credentials.pixFeePercent ?? 1.5,
            pixWithdrawalDays: data.credentials.pixWithdrawalDays ?? data.credentials.withdrawalDays ?? 1,
          }));
        }
      } catch { /* silently ignore */ }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { auth } = await import('@/lib/firebase');
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/onz-finance-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'ONZ Finance salvo!', description: 'Credenciais e taxas salvas.' });
      } else {
        throw new Error(data.message || 'Erro ao salvar');
      }
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const setF = (k: keyof typeof form) => (v: any) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Credenciais ONZ Finance</h3>
        <div>
          <Label htmlFor="onz-id-in" className="text-xs">Client ID Cash-in</Label>
          <Input id="onz-id-in" value={form.clientIdCashIn} onChange={e => setF('clientIdCashIn')(e.target.value)}
            placeholder="000111320..." className="mt-1 font-mono text-sm" />
        </div>
        <div>
          <Label htmlFor="onz-sec-in" className="text-xs">Client Secret Cash-in</Label>
          <div className="relative mt-1">
            <Input id="onz-sec-in" type={showSecrets.cashIn ? 'text' : 'password'}
              value={form.clientSecretCashIn} onChange={e => setF('clientSecretCashIn')(e.target.value)}
              placeholder="••••••••" className="font-mono text-sm pr-10" />
            <button type="button" onClick={() => setShowSecrets(p => ({ ...p, cashIn: !p.cashIn }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showSecrets.cashIn ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="onz-id-out" className="text-xs">Client ID Cash-out</Label>
          <Input id="onz-id-out" value={form.clientIdCashOut} onChange={e => setF('clientIdCashOut')(e.target.value)}
            placeholder="000111320..." className="mt-1 font-mono text-sm" />
        </div>
        <div>
          <Label htmlFor="onz-sec-out" className="text-xs">Client Secret Cash-out</Label>
          <div className="relative mt-1">
            <Input id="onz-sec-out" type={showSecrets.cashOut ? 'text' : 'password'}
              value={form.clientSecretCashOut} onChange={e => setF('clientSecretCashOut')(e.target.value)}
              placeholder="••••••••" className="font-mono text-sm pr-10" />
            <button type="button" onClick={() => setShowSecrets(p => ({ ...p, cashOut: !p.cashOut }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showSecrets.cashOut ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="onz-pix-key" className="text-xs">Chave PIX de Recebimento</Label>
          <Input id="onz-pix-key" value={form.pixKey} onChange={e => setF('pixKey')(e.target.value)}
            placeholder="4c075c70-..." className="mt-1 font-mono text-sm" />
        </div>
        <div>
          <Label className="text-xs font-medium">Ambiente</Label>
          <div className="flex gap-3 mt-2">
            {['production', 'sandbox'].map(env => (
              <label key={env} className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" name="onz-env" value={env} checked={form.environment === env}
                  onChange={() => setF('environment')(env)} className="accent-emerald-500" />
                {env === 'production' ? 'Produção' : 'Sandbox (Teste)'}
              </label>
            ))}
          </div>
        </div>
      </div>

      <FeeTabPanel
        capabilities={{ pix: true }}
        data={{ pixFeeFixed: form.pixFeeFixed, pixFeePercent: form.pixFeePercent, pixWithdrawalDays: form.pixWithdrawalDays }}
        onChange={updates => setForm(p => ({
          ...p,
          ...(updates.pixFeeFixed !== undefined ? { pixFeeFixed: updates.pixFeeFixed! } : {}),
          ...(updates.pixFeePercent !== undefined ? { pixFeePercent: updates.pixFeePercent! } : {}),
          ...(updates.pixWithdrawalDays !== undefined ? { pixWithdrawalDays: updates.pixWithdrawalDays! } : {}),
        }))}
      />

      <Button onClick={handleSave} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
        {saving ? 'Salvando...' : 'Salvar ONZ Finance'}
      </Button>
    </div>
  );
}