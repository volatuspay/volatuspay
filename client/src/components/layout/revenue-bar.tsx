import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useTenantStore } from "@/stores/tenant";
import { getOrdersByTenant } from "@/lib/firestore";
import { auth } from "@/lib/firebase";
import { getBrowserId } from "@/lib/browser-session";

export function RevenueBar() {
  const { tenant } = useTenantStore();
  
  if (!tenant) {
    return null;
  }
  
  const { data: orders = [] } = useQuery({
    queryKey: ["orders", tenant?.id],
    queryFn: () => getOrdersByTenant(tenant!.id),
    enabled: !!tenant,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: affiliateBalance } = useQuery<any>({
    queryKey: ['/api/affiliate/balance'],
    queryFn: async () => {
      const user = auth.currentUser;
      if (!user) return null;
      const token = await user.getIdToken();
      const browserId = getBrowserId();
      const res = await fetch('/api/affiliate/balance', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': browserId,
        }
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!tenant,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const paidOrders = orders.filter((order: any) => order.status === 'paid');
  const sellerNet = paidOrders.reduce((sum: number, order: any) => {
    const net = order.netAmount || order.sellerNetAmount || order.amount || 0;
    const affComm = order.affiliateCommission;
    const affAmount = affComm ? (typeof affComm === 'number' ? affComm : affComm.amount || 0) : 0;
    return sum + (net - affAmount);
  }, 0);
  
  const affiliateAvailable = affiliateBalance?.balanceAvailable_BRL || 0;
  const affiliatePending = affiliateBalance?.balancePending_BRL || 0;
  const totalAffiliateEarnings = affiliateAvailable + affiliatePending;

  const currentRevenue = (sellerNet + totalAffiliateEarnings) / 100;
  const goalRevenue = 1000000;
  const percentage = Math.min((currentRevenue / goalRevenue) * 100, 100);
  
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };
  
  return (
    <Card className="flex items-center px-4 py-2 bg-white dark:bg-transparent border border-gray-200 dark:border-lime-500/20 min-w-[280px] shadow-sm hover:shadow-md transition-shadow">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            Vendas Aprovadas Líquida
          </span>
          <span className="text-xs font-bold text-gray-900 dark:text-white">
            {formatCurrency(currentRevenue)}
          </span>
        </div>
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[#2563eb] via-[#9D4EDD] to-[#7B2CBF] dark:from-[#2563eb] dark:via-[#C77DFF] dark:to-[#E0AAFF] rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(181,101,255,0.6)]"
            style={{ 
              width: `${percentage}%`,
              boxShadow: '0 0 10px rgba(118, 255, 3, 0.8), 0 0 20px rgba(118, 255, 3, 0.4)'
            }}
          />
        </div>
      </div>
    </Card>
  );
}
