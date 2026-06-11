import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { DollarSign, TrendingUp } from "lucide-react";
import { formatBRL } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useTenantStore } from "@/stores/tenant";
import { getOrdersByTenant } from "@/lib/firestore";

// METAS DE FATURAMENTO (VENDAS PAGAS)
const MILESTONES = [
  { value: 10000, label: "R$ 10 mil", color: "from-orange-500 to-amber-500" },
  { value: 100000, label: "R$ 100 mil", color: "from-emerald-500 to-pink-500" },
  { value: 500000, label: "R$ 500 mil", color: "from-blue-500 to-cyan-500" },
  { value: 1000000, label: "R$ 1 milho", color: "from-emerald-500 to-emerald-500" },
];

export function WithdrawalPremiations() {
  const { tenant } = useTenantStore();
  const [currentMilestone, setCurrentMilestone] = useState(MILESTONES[0]);
  const [progress, setProgress] = useState(0);

  // BUSCAR TOTAL ETERNO DE VENDAS PAGAS (SEM FILTROS)
  const { data: orders = [] } = useQuery({
    queryKey: ["orders-total-revenue", tenant?.id],
    queryFn: () => getOrdersByTenant(tenant!.id),
    enabled: !!tenant,
    staleTime: 30000, // Cache 30s
    refetchOnWindowFocus: false,
  });

  //  CALCULAR TOTAL FATURADO DE VENDAS PAGAS
  const totalRevenue = orders
    .filter((order: any) => order.status === 'paid')
    .reduce((sum: number, order: any) => sum + (order.amount || 0), 0);

  useEffect(() => {
    // ENCONTRAR A PRXIMA META
    const nextMilestone = MILESTONES.find(m => totalRevenue < m.value) || MILESTONES[MILESTONES.length - 1];
    setCurrentMilestone(nextMilestone);

    // CALCULAR PROGRESSO
    const milestoneIndex = MILESTONES.findIndex(m => m.value === nextMilestone.value);
    const previousMilestoneValue = milestoneIndex > 0 ? MILESTONES[milestoneIndex - 1].value : 0;
    
    const progressValue = ((totalRevenue - previousMilestoneValue) / (nextMilestone.value - previousMilestoneValue)) * 100;
    setProgress(Math.min(Math.max(progressValue, 0), 100));
  }, [totalRevenue]);

  // PROGRESSO ATMETA MXIMA (R$ 99.999.999,00)
  const MAX_REVENUE = 99999999;
  const progressToMax = Math.min((totalRevenue / MAX_REVENUE) * 100, 100);

  return (
    <div className="px-3 pb-3 border-b border-border">
      {/* BARRA DE FATURAMENTO TOTAL ETERNO */}
      <div className="space-y-1.5">
        <Progress 
          value={progressToMax} 
          className="h-2.5 bg-gray-200 dark:bg-gray-700"
          data-testid="revenue-progress"
        />
        <div className="flex justify-end">
          <span className="text-xs font-bold text-foreground" data-testid="total-revenue">
            {formatBRL(totalRevenue)}
          </span>
        </div>
      </div>
    </div>
  );
}
