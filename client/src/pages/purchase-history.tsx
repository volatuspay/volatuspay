import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { CustomerSidebar } from "@/components/layout/customer-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatBRL } from "@/lib/utils";
import { 
  Calendar,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  ExternalLink,
  Search,
  ShoppingBag,
  User
} from "lucide-react";
import { getOrdersByCustomerEmail, getSellerEmailByTenantId } from "@/lib/firestore";
import { auth } from "@/lib/firebase";

interface PurchaseHistoryOrder {
  id: string;
  orderId: string;
  checkoutId?: string;
  productTitle: string;
  amount: number;
  method: string;
  status: string;
  createdAt: Date;
  paidAt?: Date;
  sellerEmail?: string;
  tenantId?: string;
  checkoutSnapshot?: {
    title?: string;
    subtitle?: string;
    description?: string;
  };
}

export default function PurchaseHistory() {
  const { user } = useAuthStore();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ["/api/customer/products", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('Usuário não autenticado no Firebase');
        return [];
      }
      
      const token = await currentUser.getIdToken();
      
      const response = await fetch(`/api/customer/products?email=${encodeURIComponent(user.email)}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Erro ao buscar histórico:', response.status, errorText);
        throw new Error('Erro ao buscar histórico de compras');
      }
      
      const data = await response.json();
      console.log('Total de orders encontradas:', data.length);
      return data;
    },
    enabled: !!user?.email,
  });

  // Enriquecer orders com email do vendedor real
  const [enrichedOrders, setEnrichedOrders] = useState<any[]>([]);

  useEffect(() => {
    const enrichOrdersWithSellerEmails = async () => {
      if (!orders || orders.length === 0) {
        setEnrichedOrders([]);
        return;
      }

      console.log("Enriquecendo orders com emails dos vendedores...");
      
      const enriched = await Promise.all(
        orders.map(async (order: any) => {
          if (order.tenantId) {
            const sellerEmail = await getSellerEmailByTenantId(order.tenantId);
            return { ...order, sellerEmail };
          }
          return order;
        })
      );

      console.log("Orders enriquecidas:", enriched.length);
      setEnrichedOrders(enriched);
    };

    enrichOrdersWithSellerEmails();
  }, [orders]);

  // Usar enriched orders ao invés de orders direto
  const filteredOrders = enrichedOrders.filter((order: any) =>
    order.checkoutSnapshot?.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.orderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.checkoutId?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalCompras = filteredOrders.length;
  const valorTotal = filteredOrders.reduce((acc: number, order: any) => acc + (order.amount || 0), 0);


  const getPaymentMethodBadge = (method: string) => {
    if (method === "pix") {
      return <Badge variant="secondary" className="bg-emerald-100 text-muted-foreground">PIX</Badge>;
    }
    return <Badge variant="secondary" className="bg-blue-100 text-muted-foreground">Cartão</Badge>;
  };

  const getStatusBadge = (status: string) => {
    if (status === "paid") {
      return <Badge variant="default" className="bg-emerald-100 text-muted-foreground">Pago</Badge>;
    }
    if (status === "pending") {
      return <Badge variant="secondary" className="bg-yellow-100 text-muted-foreground">Pendente</Badge>;
    }
    return <Badge variant="destructive" className="bg-red-100 text-muted-foreground">{status}</Badge>;
  };

  const exportToCSV = () => {
    const csvData = filteredOrders.map((order: any): Record<string, any> => ({
      'Data/Hora': format(new Date(order.createdAt), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }),
      'ID da Compra': order.orderId,
      'ID do Checkout': order.checkoutId || '-',
      'Produto': order.checkoutSnapshot?.title || 'Produto sem ttulo',
      'Valor (R$)': formatBRL(order.amount).replace('R$ ', ''),
      'Forma de Pagamento': order.method === 'pix' ? 'PIX' : 'Cartão de Crédito',
      'Status': order.status === 'paid' ? 'Pago' : order.status,
      'Email do Vendedor': order.sellerEmail || '-'
    }));

    const csvContent = [
      Object.keys(csvData[0] || {}).join(','),
      ...csvData.map((row: Record<string, any>) => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `historico-compras-${format(new Date(), 'dd-MM-yyyy')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Redirecionando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <CustomerSidebar />
      
      {/* Conteúdo principal - TELA CHEIA */}
      <div className="lg:ml-64">
        <div className="p-4 lg:p-8 w-full max-w-none">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="h-8 w-8 text-emerald-400" />
              <h1 className="text-3xl font-bold text-white">
                Histórico de Compras
              </h1>
            </div>
            <p className="text-emerald-300/70">
              Histórico completo de todas as suas compras realizadas na plataforma
            </p>
          </div>

          {/* Estatsticas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="bg-gray-900/50 border-emerald-900/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-emerald-200">Total de Compras</CardTitle>
                <ShoppingBag className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{totalCompras}</div>
                <p className="text-xs text-emerald-400/70">
                  {totalCompras === 1 ? "compra realizada" : "compras realizadas"}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/50 border-emerald-900/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-emerald-200">Valor Total</CardTitle>
                <DollarSign className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{formatBRL(valorTotal)}</div>
                <p className="text-xs text-emerald-400/70">
                  investido em produtos
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/50 border-emerald-900/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-emerald-200">Última Compra</CardTitle>
                <Calendar className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">
                  {filteredOrders.length > 0 
                    ? format(new Date(filteredOrders[0].createdAt), "dd/MM", { locale: ptBR })
                    : "-"
                  }
                </div>
                <p className="text-xs text-emerald-400/70">
                  {filteredOrders.length > 0 
                    ? format(new Date(filteredOrders[0].createdAt), "yyyy", { locale: ptBR })
                    : "nenhuma compra"
                  }
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filtros e Aes */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-emerald-400" />
                <Input
                  placeholder="Buscar por produto, ID da compra ou checkout..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-gray-900/50 border-emerald-900/50 text-white placeholder:text-emerald-400/50"
                />
              </div>
            </div>
            
            {filteredOrders.length > 0 && (
              <Button onClick={exportToCSV} variant="outline" className="gap-2 border-emerald-700 text-emerald-300 hover:bg-emerald-900/50">
                <Download className="h-4 w-4" />
                Exportar CSV
              </Button>
            )}
          </div>

          {/* Tabela de Compras */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5" />
                Compras Realizadas
                {filteredOrders.length > 0 && (
                  <Badge variant="secondary">{filteredOrders.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Lista detalhada de todas as suas transações
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center space-x-4">
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-[200px]" />
                        <Skeleton className="h-4 w-[150px]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <EmptyState
                  icon={ShoppingBag}
                  title="Erro ao carregar compras"
                  description="Ocorreu um erro ao carregar seu histórico. Tente novamente."
                />
              ) : filteredOrders.length === 0 ? (
                <EmptyState
                  icon={ShoppingBag}
                  title={searchTerm ? "Nenhuma compra encontrada" : "Ainda no hcompras"}
                  description={
                    searchTerm 
                      ? "Tente usar termos diferentes na busca." 
                      : "Quando vocrealizar uma compra, ela apareceraqui."
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[120px]">Data/Hora</TableHead>
                        <TableHead className="min-w-[180px]">Produto</TableHead>
                        <TableHead className="min-w-[100px]">Valor</TableHead>
                        <TableHead className="min-w-[100px]">Pagamento</TableHead>
                        <TableHead className="min-w-[180px]">Vendedor (Dono do Checkout)</TableHead>
                        <TableHead className="min-w-[200px]">IDs da Transação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((order: any) => (
                        <TableRow key={order.id}>
                          <TableCell className="min-w-[120px]">
                            <div className="font-medium">
                              {format(new Date(order.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {format(new Date(order.createdAt), "HH:mm:ss", { locale: ptBR })}
                            </div>
                          </TableCell>
                          
                          <TableCell className="min-w-[180px]">
                            <div className="font-medium">
                              {order.checkoutSnapshot?.title || "Produto sem ttulo"}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {order.checkoutSnapshot?.subtitle || order.checkoutSnapshot?.description || "-"}
                            </div>
                          </TableCell>

                          <TableCell className="min-w-[100px]">
                            <div className="font-medium text-muted-foreground">
                              {formatBRL(order.amount || order.originalAmount || 0)}
                            </div>
                          </TableCell>

                          <TableCell className="min-w-[100px]">
                            {getPaymentMethodBadge(order.method || order.provider?.name || "pix")}
                          </TableCell>

                          <TableCell className="min-w-[180px]">
                            <div className="text-sm">
                              <div className="bg-emerald-50 border border-blue-200 rounded-lg p-2">
                                <div className="flex items-center gap-2 mb-1">
                                  <User className="h-4 w-4 text-emerald-700" />
                                  <span className="text-xs font-medium text-muted-foreground">VENDEDOR REAL</span>
                                </div>
                                <div className="font-mono text-sm text-muted-foreground break-all">
                                  {order.sellerEmail || `Tenant: ${order.tenantId}`}
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="min-w-[200px]">
                            <div className="text-xs space-y-1">
                              <div className="font-mono">
                                <span className="text-muted-foreground">Compra:</span> {order.orderId}
                              </div>
                              {order.checkoutId && (
                                <div className="font-mono">
                                  <span className="text-muted-foreground">Checkout:</span> {order.checkoutId}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}