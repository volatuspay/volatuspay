import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from '@/stores/auth';
import { getAuth } from 'firebase/auth';
import { Link } from "wouter";
import { ArrowLeft, ShoppingBag, Package, CheckCircle, Clock, XCircle, CreditCard, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LogoThemed } from "@/components/ui/logo-themed";
import { useGlobalConfigStore } from '@/stores/global-config';
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Purchase {
  id: string;
  type: 'purchase' | 'sale';
  checkoutTitle: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
  productType: string;
  productId?: string;
}

export default function PurchaseHistory() {
  const { user } = useAuthStore();
  const { config } = useGlobalConfigStore();

  const { data: purchases = [], isLoading, error } = useQuery({
    queryKey: ["my-purchases", user?.uid],
    queryFn: async (): Promise<Purchase[]> => {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Não autenticado');

      const response = await fetch('/api/orders/my-purchases', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Erro na resposta:', errorText);
        throw new Error('Erro ao buscar histórico');
      }
      
      const data = await response.json();
      return data.map((purchase: any) => ({
        ...purchase,
        createdAt: purchase.createdAt 
      }));
    },
    enabled: !!user,
    retry: 2,
  });

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      paid: { label: 'Pago', color: 'bg-emerald-100 text-emerald-700 border-emerald-300', icon: CheckCircle },
      pending: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: Clock },
      cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-700 border-red-300', icon: XCircle },
      refunded: { label: 'Reembolsado', color: 'bg-blue-100 text-blue-700 border-blue-300', icon: Receipt },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} border px-2.5 py-0.5 flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        <span className="text-xs font-medium">{config.label}</span>
      </Badge>
    );
  };

  const getMethodLabel = (method: string) => {
    const methods: Record<string, string> = {
      pix: 'PIX',
      credit_card: 'Cartão de Crédito',
      boleto: 'Boleto',
      debit_card: 'Cartão de Débito',
    };
    return methods[method] || method.toUpperCase();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(amount / 100);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-800 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-10 h-10 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">Carregando histórico...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <LogoThemed 
            type="site" 
            className="h-8 w-auto"
            fallbackText={config?.gatewayName || 'VolatusPay'}
          />
          
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-gray-600 dark:text-gray-300">{user?.email}</span>
            <Link href="/my-products">
              <Button 
                variant="ghost" 
                size="sm" 
                className="hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <ShoppingBag className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Histórico de Compras</h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Todas as suas compras e vendas em um só lugar
          </p>
        </div>

        {error && (
          <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
            <CardContent className="p-6">
              <p className="text-red-600 dark:text-red-400 font-medium">
                Erro ao carregar histórico. Tente novamente.
              </p>
            </CardContent>
          </Card>
        )}

        {!error && purchases.length === 0 && (
          <Card className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-700">
            <CardContent className="p-12 text-center">
              <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Nenhuma compra encontrada
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Você ainda não fez nenhuma compra ou venda.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {purchases.map((purchase) => (
            <Card 
              key={purchase.id}
              className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
            >
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-primary" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 truncate">
                          {purchase.checkoutTitle}
                        </h3>
                        
                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                            purchase.type === 'purchase' 
                              ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800' 
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-[#f0f4ff]'
                          }`}>
                            {purchase.type === 'purchase' ? 'Compra' : 'Venda'}
                          </span>
                          
                          {purchase.type === 'sale' && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className="truncate">{purchase.customerName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ml-15">
                      <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                        <CreditCard className="w-4 h-4" />
                        <span>{getMethodLabel(purchase.method)}</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                        <Clock className="w-4 h-4" />
                        <span>
                          {format(new Date(purchase.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex lg:flex-col items-center lg:items-end gap-3 lg:gap-2">
                    <div className="text-2xl font-bold text-primary">
                      {formatCurrency(purchase.amount)}
                    </div>
                    {getStatusBadge(purchase.status)}
                  </div>
                </div>

                {purchase.type === 'purchase' && purchase.productType === 'digital' && purchase.status === 'paid' && purchase.productId && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <Link href={`/members/${purchase.productId}`}>
                      <Button 
                        size="sm"
                        className="bg-primary hover:bg-primary/90"
                      >
                        Acessar Conteúdo
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
