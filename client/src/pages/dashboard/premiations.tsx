import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Lock, TrendingUp, Trophy, ArrowRight } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import BannerDisplay from "@/components/dashboard/banner-display";
const badge10kImage = "/images/badge-10k.png";

interface Reward {
  id: string;
  name: string;
  description: string;
  amount: number;
  gradient: string;
  prize?: string;
  customImage?: string;
  icon: string;
}

const REWARDS: Reward[] = [
  {
    id: "saque-10k",
    name: "Primeiro Saque",
    description: "R$ 10.000 em saques aprovados. Você está monetizando com consistência.",
    amount: 1000000,
    gradient: "from-blue-500 to-blue-700",
    customImage: badge10kImage,
    icon: "💵",
  },
  {
    id: "saque-100k",
    name: "Saque Profissional",
    description: "R$ 100.000 em saques aprovados. Operação rentável e sustentável.",
    amount: 10000000,
    gradient: "from-teal-500 to-teal-700",
    icon: "💎",
  },
  {
    id: "saque-500k",
    name: "Saque Consolidado",
    description: "R$ 500.000 em saques aprovados. Negócio consolidado com fluxo robusto.",
    amount: 50000000,
    gradient: "from-cyan-500 to-cyan-700",
    icon: "🔷",
  },
  {
    id: "saque-1m",
    name: "Saque Milionário",
    description: "R$ 1.000.000 em saques aprovados. Primeiro milhão em receita líquida.",
    amount: 100000000,
    gradient: "from-violet-500 to-violet-700",
    prize: "Troféu de Prata",
    icon: "🏆",
  },
  {
    id: "saque-5m",
    name: "Saque Multi-Milionário",
    description: "R$ 5.000.000 em saques aprovados. Elite com negócio em escala milionária.",
    amount: 500000000,
    gradient: "from-amber-500 to-orange-600",
    prize: "Troféu de Ouro",
    icon: "👑",
  },
  {
    id: "saque-10m",
    name: "Saque Lendário",
    description: "R$ 10.000.000+ em saques aprovados. Lenda do mercado digital.",
    amount: 1000000000,
    gradient: "from-rose-500 to-pink-700",
    prize: "Troféu de Diamante",
    icon: "💎",
  },
];

export default function PremiationsPage() {
  const { user } = useAuthStore();
  const [totalWithdrawn, setTotalWithdrawn] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentReward, setCurrentReward] = useState<Reward | null>(null);
  const [nextReward, setNextReward] = useState<Reward | null>(null);
  const [rewardProgress, setRewardProgress] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const withdrawalsRes = await fetch(`/api/withdrawals?tenantId=${user.uid}`, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (withdrawalsRes.ok) {
          const data = await withdrawalsRes.json();
          const approved = data.filter((w: any) => w.status === "approved");
          const total = approved.reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
          setTotalWithdrawn(total);
        }
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let current: Reward | null = null;
    let next: Reward | null = null;
    for (let i = 0; i < REWARDS.length; i++) {
      if (totalWithdrawn >= REWARDS[i].amount) {
        current = REWARDS[i];
        next = REWARDS[i + 1] || null;
      } else {
        if (!current) next = REWARDS[i];
        break;
      }
    }
    setCurrentReward(current);
    setNextReward(next);
    if (next) {
      const prev = current?.amount || 0;
      setRewardProgress(Math.min(((totalWithdrawn - prev) / (next.amount - prev)) * 100, 100));
    } else {
      setRewardProgress(100);
    }
  }, [totalWithdrawn, user]);

  const isAchieved = (r: Reward) => totalWithdrawn >= r.amount;

  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v / 100);

  return (
    <DashboardLayout>
      <div className="px-3 md:px-4 space-y-3 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <>
            <BannerDisplay position="award_page" />

            {/* ── Hero: nível atual + progresso ── */}
            <div className="rounded-2xl overflow-hidden border border-gray-100 dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-sm">
              {/* Topo colorido */}
              <div className="px-5 pt-5 pb-4 bg-gradient-to-r from-[#2563eb]/5 to-[#2563eb]/0 dark:from-[#2563eb]/10 dark:to-transparent border-b border-gray-100 dark:border-white/[0.06]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                      Trajetória de Saques
                    </p>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      {currentReward?.name ?? "Sem nível ainda"}
                    </h2>
                    {currentReward && (
                      <p className="text-xs text-muted-foreground mt-0.5">{currentReward.description}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-[11px] font-medium text-muted-foreground">Total sacado</p>
                    <p className="text-xl font-bold text-[#2563eb] tabular-nums leading-tight">
                      {fmt(totalWithdrawn)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Barra de progresso */}
              {nextReward && (
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-[#2563eb]" />
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Próximo: <span className="text-[#2563eb]">{nextReward.name}</span>
                      </span>
                    </div>
                    <span className="text-xs font-bold text-gray-500 tabular-nums">
                      {fmt(totalWithdrawn)} <span className="text-gray-400 font-normal">/ {fmt(nextReward.amount)}</span>
                    </span>
                  </div>
                  <Progress value={rewardProgress} className="h-2 rounded-full" />
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Faltam <span className="font-semibold text-gray-700 dark:text-gray-300">{fmt(Math.max(0, nextReward.amount - totalWithdrawn))}</span> para o próximo nível
                  </p>
                </div>
              )}
              {!nextReward && (
                <div className="px-5 py-4 flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">Nível máximo atingido!</span>
                </div>
              )}
            </div>

            {/* ── Linha do tempo de marcos ── */}
            <div className="space-y-0">
              {REWARDS.map((reward, idx) => {
                const achieved = isAchieved(reward);
                const isNext = !achieved && nextReward?.id === reward.id;
                const isLast = idx === REWARDS.length - 1;

                return (
                  <div key={reward.id} className="relative flex gap-3">
                    {/* Linha vertical conectora */}
                    {!isLast && (
                      <div className="absolute left-[19px] top-[40px] w-[2px] bottom-0 z-0"
                        style={{ background: achieved ? '#2563eb22' : '#e5e7eb33', minHeight: 24 }} />
                    )}

                    {/* Ícone / badge */}
                    <div className="relative z-10 shrink-0 mt-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-base border-2 transition-all
                        ${achieved
                          ? 'bg-[#2563eb] border-[#2563eb] shadow-md shadow-blue-500/20'
                          : isNext
                            ? 'bg-white dark:bg-[#0f1117] border-[#2563eb] shadow-sm'
                            : 'bg-gray-100 dark:bg-white/5 border-gray-200 dark:border-white/10'
                        }`}>
                        {achieved ? (
                          <CheckCircle2 className="h-5 w-5 text-white" />
                        ) : isNext ? (
                          <span className="text-base">{reward.icon}</span>
                        ) : (
                          <Lock className="h-4 w-4 text-gray-400 dark:text-gray-600" />
                        )}
                      </div>
                    </div>

                    {/* Conteúdo do card */}
                    <div className={`flex-1 mb-2 rounded-xl border px-4 py-3 transition-all
                      ${achieved
                        ? 'bg-white dark:bg-[#0f1117] border-[#2563eb]/20 shadow-sm'
                        : isNext
                          ? 'bg-white dark:bg-[#0f1117] border-dashed border-[#2563eb]/30 shadow-sm'
                          : 'bg-gray-50 dark:bg-white/[0.02] border-gray-100 dark:border-white/[0.05]'
                      }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-semibold leading-tight ${
                              achieved
                                ? 'text-gray-900 dark:text-white'
                                : isNext
                                  ? 'text-gray-700 dark:text-gray-300'
                                  : 'text-gray-400 dark:text-gray-600'
                            }`}>
                              {reward.name}
                            </span>
                            {achieved && reward.prize && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
                                🏆 {reward.prize}
                              </span>
                            )}
                            {isNext && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-[#2563eb] border border-blue-200 dark:border-blue-500/20">
                                <ArrowRight className="h-2.5 w-2.5" /> Próximo
                              </span>
                            )}
                          </div>
                          <p className={`text-[11px] mt-0.5 leading-snug ${
                            achieved
                              ? 'text-gray-500 dark:text-gray-400'
                              : 'text-gray-400 dark:text-gray-600'
                          }`}>
                            {reward.description}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <p className={`text-sm font-bold tabular-nums ${
                            achieved
                              ? 'text-[#2563eb]'
                              : isNext
                                ? 'text-gray-500 dark:text-gray-400'
                                : 'text-gray-300 dark:text-gray-700'
                          }`}>
                            {fmt(reward.amount)}
                          </p>
                          {achieved && (
                            <p className="text-[10px] font-semibold text-emerald-500 mt-0.5">Atingido</p>
                          )}
                        </div>
                      </div>

                      {/* Barra de progresso interna só para o próximo */}
                      {isNext && (
                        <div className="mt-2.5">
                          <Progress value={rewardProgress} className="h-1.5 rounded-full" />
                          <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                            {fmt(totalWithdrawn)} de {fmt(reward.amount)} — {Math.round(rewardProgress)}%
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
