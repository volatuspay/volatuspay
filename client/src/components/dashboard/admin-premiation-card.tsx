import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Trophy } from "lucide-react";
import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";

const MILESTONES = [
  { value: 10000, label: "10K", fullLabel: "R$ 10 mil" },
  { value: 100000, label: "100K", fullLabel: "R$ 100 mil" },
  { value: 500000, label: "500K", fullLabel: "R$ 500 mil" },
  { value: 1000000, label: "1M", fullLabel: "R$ 1 milho" },
];

interface Achievement {
  id: string;
  milestoneValue: number;
  title: string;
  description: string;
  imageUrl: string;
}

export function AdminPremiationCard() {
  const [currentMilestone, setCurrentMilestone] = useState(MILESTONES[0]);
  const [achievementImage, setAchievementImage] = useState<string | null>(null);

  // ACHIEVEMENTS COM FALLBACK GRACIOSO (endpoint no implementado ainda)
  const { data: achievements = [], isLoading } = useQuery<Achievement[]>({
    queryKey: ["achievements"],
    queryFn: async () => {
      try {
        const user = auth.currentUser;
        if (!user) return [];
        
        const token = await user.getIdToken();
        const response = await fetch("/api/achievements", {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        // Endpoint no existe ainda - retornar [] silenciosamente
        if (!response.ok) return [];
        return response.json();
      } catch (error) {
        // Falha silenciosa - no logar erro 403 (endpoint no existe)
        return [];
      }
    },
    retry: false, // No tentar novamente se endpoint no existe
    refetchOnWindowFocus: false, // No refazer query ao focar janela
    staleTime: 60000, // Cache de 1 minuto
  });

  const { data: withdrawalsData } = useQuery({
    queryKey: ["withdrawals-total"],
    queryFn: async () => {
      const user = auth.currentUser;
      if (!user) return { total: 0 };
      
      const token = await user.getIdToken();
      const response = await fetch("/api/withdrawals", {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) return { total: 0 };
      const withdrawals = await response.json();
      
      const completedWithdrawals = withdrawals.filter((w: any) => w.status === 'completed');
      const total = completedWithdrawals.reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
      
      return { total };
    },
  });

  useEffect(() => {
    if (achievements.length > 0) {
      const firstAchievement = achievements[0];
      const milestone = MILESTONES.find(m => m.value === firstAchievement.milestoneValue) || MILESTONES[0];
      setCurrentMilestone(milestone);
      setAchievementImage(firstAchievement.imageUrl || null);
    }
  }, [achievements]);

  if (isLoading) {
    return (
      <Card className="h-full bg-gradient-to-br from-gray-900 to-[#0d1300] border-[#f0f4ff]/30">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-32 bg-gray-800/50 rounded-lg" />
            <div className="h-4 bg-gray-800/50 rounded w-3/4" />
            <div className="h-2 bg-gray-800/50 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col bg-gradient-to-br from-gray-900 to-[#0d1300] border-[#f0f4ff]/30 overflow-hidden">
      <CardContent className="p-6 space-y-4 flex-1 flex flex-col justify-between">
        {/* Título */}
        <div className="text-center">
          <h3 className="text-lg font-bold text-white mb-1">Sua próxima premiação</h3>
          <p className="text-sm text-[#2563eb]">🎁 Alcance suas metas!</p>
        </div>

        {/* Imagem de Premiação */}
        {achievementImage ? (
          <div className="relative rounded-lg overflow-hidden bg-gradient-to-br from-lime-500/5 to-pink-500/5 min-h-[320px] flex items-center justify-center p-4">
            <img
              src={achievementImage}
              alt={currentMilestone.fullLabel}
              className="w-full h-full object-contain max-h-[320px]"
              data-testid="admin-achievement-image"
            />
          </div>
        ) : (
          <div className="min-h-[280px] flex items-center justify-center bg-gradient-to-br from-lime-500/20 to-pink-500/20 rounded-lg">
            <div className="text-center text-white/70 p-4">
              <Trophy className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium">Imagem não configurada</p>
            </div>
          </div>
        )}

        {/* Próxima Meta */}
        <div className="text-center space-y-2">
          <p className="text-xs text-[#2563eb]">Próxima meta de premiação:</p>
          <div className="text-4xl font-bold text-white mb-2">
            {currentMilestone.fullLabel}
          </div>
          <p className="text-sm text-[#2563eb]">Continue vendendo para desbloquear esta recompensa! </p>
          <div className="space-y-1.5 pt-2">
            <Progress 
              value={Math.min(100, ((withdrawalsData?.total || 0) / 1000000) * 100)} 
              className="h-2 bg-[#f0f4ff]/50"
            />
            <p className="text-xs text-[#2563eb]/80">
              R$ {((withdrawalsData?.total || 0) / 100).toFixed(2).replace('.', ',')} sacados de R$ 10.000,00
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
