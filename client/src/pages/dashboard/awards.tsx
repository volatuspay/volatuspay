import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveImageUrl } from "@/lib/image-url";
import { Gift, Award, Trophy, DollarSign, TrendingUp } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import BannerDisplay from "@/components/dashboard/banner-display";

interface Banner {
  id: string;
  imageUrl: string;
  position: string;
  active: boolean;
  createdAt: any;
}

export default function AwardsPage() {
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const [totalSales, setTotalSales] = useState(0);
  const [totalWithdrawals, setTotalWithdrawals] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);

  // Banners de premiação removidos - feature descontinuada
  const banners: Banner[] = [];
  const loading = false;

  useEffect(() => {
    loadFinancialStats();
  }, [user, tenant]);

  const loadFinancialStats = async () => {
    if (!user || !tenant) return;
    
    try {
      setLoadingStats(true);
      const token = await auth.currentUser?.getIdToken();
      
      const [ordersResponse, withdrawalsResponse] = await Promise.all([
        //  CRITICAL: Passar limit=9999 para garantir TODOS os dados para KPIs
        fetch(`/api/orders?tenantId=${tenant.id}&limit=9999`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }),
        fetch('/api/withdrawals', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
      ]);

      if (ordersResponse.ok) {
        const rawResponse = await ordersResponse.json();
        //  BACKWARD COMPATIBILITY: Normalizar response (array OU { data, pagination })
        const normalized = import('@/lib/firestore').then(m => m.normalizePaginatedResponse<any>(rawResponse));
        const orders = (await normalized).data;
        
        // Calcular total de vendas PAGAS (valores em centavos, converter para reais)
        const totalPaidInCents = orders
          .filter((order: any) => order.status === 'paid')
          .reduce((sum: number, order: any) => sum + (order.amount || 0), 0);
        setTotalSales(totalPaidInCents / 100); // Converter centavos para reais
      }

      if (withdrawalsResponse.ok) {
        const withdrawalsData = await withdrawalsResponse.json();
        const approved = withdrawalsData.filter((w: any) => w.status === 'approved');
        // Valores de saque jestão em reais
        const totalApproved = approved.reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
        setTotalWithdrawals(totalApproved);
      }
    } catch (error) {
      console.error('Erro ao carregar estatísticas financeiras:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  const formatBRL = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  return (
    <DashboardLayout>
      <div className="px-3 md:px-4 space-y-2">
        {/* BANNER HORIZONTAL DO ADMIN - IGUAL DASHBOARD E MARKETPLACE */}
        <BannerDisplay position="awards_top" />

        {/* LOADING STATE */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="bg-white dark:bg-card border border-brand-muted dark:border-border">
                <CardContent className="p-6">
                  <Skeleton className="w-full h-64 rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* LAYOUT DUAS COLUNAS - RESPONSIVO */}
        {!loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-8">
            {/* COLUNA ESQUERDA - BARRAS DE PROGRESSO */}
            <div className="space-y-6 lg:sticky lg:top-4 lg:self-start">
              {/* TOTAL FATURADO */}
              <div className="bg-white dark:bg-card rounded-2xl border border-gray-100 dark:border-border shadow-sm p-4 md:p-8">
                <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
                  <div className="w-10 h-10 md:w-14 md:h-14 bg-gradient-to-br from-lime-400 to-[#2563eb] rounded-xl flex items-center justify-center shadow-md">
                    <DollarSign className="h-5 w-5 md:h-7 md:w-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-brand-muted-foreground dark:text-gray-400">Total Faturado</h3>
                    <p className="text-xl md:text-3xl font-bold text-foreground">
                      {loadingStats ? '...' : formatBRL(totalSales)}
                    </p>
                  </div>
                </div>
                
                {/* BARRA DE PROGRESSO */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-brand-muted-foreground dark:text-gray-400">Progresso de vendas</span>
                    <span className="font-bold text-[#2563eb] dark:text-blue-400">
                      {loadingStats ? '0%' : totalSales > 0 ? '100%' : '0%'}
                    </span>
                  </div>
                  <div className="w-full bg-brand-subtle dark:bg-gray-700 dark:backdrop-blur-md rounded-full h-3 overflow-hidden shadow-inner">
                    <div 
                      className="bg-gradient-to-r from-[#2563eb] via-lime-400 to-[#2563eb] h-3 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: loadingStats ? '0%' : totalSales > 0 ? '100%' : '0%' }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs text-brand-muted-foreground dark:text-gray-400 pt-1">
                    <span>R$ 0,00</span>
                    <span className="font-medium">{loadingStats ? '...' : formatBRL(totalSales)}</span>
                  </div>
                </div>
              </div>

              {/* TOTAL EM SAQUE APROVADO */}
              <div className="bg-white dark:bg-card rounded-2xl border border-gray-100 dark:border-border shadow-sm p-4 md:p-8">
                <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
                  <div className="w-10 h-10 md:w-14 md:h-14 bg-gradient-to-br from-blue-400 to-cyan-500 rounded-xl flex items-center justify-center shadow-md">
                    <TrendingUp className="h-5 w-5 md:h-7 md:w-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-brand-muted-foreground dark:text-gray-400">Saques Aprovados</h3>
                    <p className="text-xl md:text-3xl font-bold text-foreground">
                      {loadingStats ? '...' : formatBRL(totalWithdrawals)}
                    </p>
                  </div>
                </div>
                
                {/* BARRA DE PROGRESSO */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-brand-muted-foreground dark:text-gray-400">Valor jsacado</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">
                      {loadingStats ? '0%' : totalSales > 0 ? Math.min(((totalWithdrawals / totalSales) * 100), 100).toFixed(0) : '0'}%
                    </span>
                  </div>
                  <div className="w-full bg-brand-subtle dark:bg-gray-700 dark:backdrop-blur-md rounded-full h-3 overflow-hidden shadow-inner">
                    <div 
                      className="bg-gradient-to-r from-blue-500 via-blue-400 to-cyan-500 h-3 rounded-full transition-all duration-1000 ease-out"
                      style={{ 
                        width: loadingStats ? '0%' : totalSales > 0 ? `${Math.min(((totalWithdrawals / totalSales) * 100), 100)}%` : '0%' 
                      }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs text-brand-muted-foreground dark:text-gray-400 pt-1">
                    <span>R$ 0,00</span>
                    <span className="font-medium">{loadingStats ? '...' : formatBRL(totalSales)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* COLUNA DIREITA - BANNER VERTICAL COMPLETO */}
            {banners.length > 0 ? (
              <div className="bg-white dark:bg-card rounded-2xl border border-gray-100 dark:border-border shadow-sm p-4">
                {/* IMAGEM VERTICAL COMPLETA - SEM CORTAR */}
                <img
                  src={resolveImageUrl(banners[0].imageUrl) || ''}
                  alt="Banner de Premiação"
                  className="w-full h-auto rounded-lg"
                />
              </div>
            ) : (
              <div className="bg-white dark:bg-card rounded-2xl border border-gray-100 dark:border-border shadow-sm">
                <div className="p-8 md:p-16 text-center">
                  <div className="w-20 h-20 md:w-32 md:h-32 mx-auto bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 rounded-3xl flex items-center justify-center mb-6 md:mb-8 shadow-inner">
                    <Gift className="h-10 w-10 md:h-16 md:w-16 text-amber-500 dark:text-amber-400" />
                  </div>
                  <h3 className="text-lg md:text-2xl font-bold text-foreground mb-3">
                    Nenhuma premiação disponível no momento
                  </h3>
                  <p className="text-brand-muted-foreground dark:text-gray-400 max-w-lg mx-auto text-lg leading-relaxed">
                    O administrador ainda não configurou campanhas de premiação. Fique atento às próximas novidades!
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
