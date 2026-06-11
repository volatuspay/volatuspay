import { useQuery } from "@tanstack/react-query";
import { getWithdrawalsByTenant } from "@/lib/firestore";
import { useTenantStore } from "@/stores/tenant";
import { useAuthStore } from "@/stores/auth";

// Hook para calcular total de saques realizados
export const useWithdrawalsTotals = () => {
  const { tenant } = useTenantStore();
  const { user } = useAuthStore();
  
  // DETECTAR SE SELLER OU AFILIADO
  const isAffiliate = !tenant && !!user?.uid;
  const isSeller = !!tenant;
  
  return useQuery({
    queryKey: ["withdrawalsTotals", tenant?.id || user?.uid],
    queryFn: async () => {
      if (!tenant?.id && !user?.uid) throw new Error("Usuário não identificado");
      
      // Para sellers, usar tenant.id; para afiliados, usar user.uid
      const targetId = tenant?.id || user?.uid;
      const withdrawals = await getWithdrawalsByTenant(targetId!);
      
      // FILTRAR APENAS SAQUES REALIZADOS/PROCESSADOS (não pendentes nem rejeitados)
      const completedWithdrawals = withdrawals.filter(w => 
        ['approved', 'paid', 'completed', 'processed', 'processing'].includes(w.status)
      );
      
      // SOMAR VALOR LQUIDO DOS SAQUES REALIZADOS (com deteco de dados legados)
      const totalWithdrawnCentavos = completedWithdrawals.reduce((total, withdrawal) => {
        // Usar netAmount se disponível, senão usar amount
        const rawAmount = withdrawal.netAmount || withdrawal.amount || 0;
        
        // DETECÇÃO DE DADOS LEGADOS: Converter para centavos se necessário
        // Se valor tem casas decimais ou é menor que 100, provavelmente estem reais
        // Se valor é inteiro grande (>= 100), provavelmente jestem centavos
        let amountInCentavos;
        if (rawAmount % 1 !== 0 || rawAmount < 100) {
          // Tem decimais ou é muito pequeno - converter de reais para centavos
          amountInCentavos = Math.round(rawAmount * 100);
        } else {
          // um inteiro >= 100 - assumir que jestem centavos
          amountInCentavos = Math.round(rawAmount);
        }
        
        return total + amountInCentavos;
      }, 0);
      
      // CONVERTER PARA REAIS PARA EXIBIÇÃO
      const totalWithdrawnReais = totalWithdrawnCentavos / 100;
      
      
      return {
        totalWithdrawnCentavos,
        totalWithdrawnReais,
        completedWithdrawalsCount: completedWithdrawals.length,
        isAffiliate,
        isSeller
      };
    },
    enabled: !!(tenant?.id || user?.uid),
    refetchInterval: 120000, // ⚡ OTIMIZADO: 2 minutos
    refetchOnWindowFocus: false,
    staleTime: 60000,
    retry: 1,
  });
};