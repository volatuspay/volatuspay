import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { auth } from "@/lib/firebase";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, Download, RefreshCw, Eye, Filter, Calendar, TrendingUp, DollarSign, Users, CreditCard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useCustomToast } from "@/hooks/use-custom-toast";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building, User, X, Mail } from "lucide-react";
import type { Customer } from "@shared/schema";

interface Transaction {
  id: string;
  orderId: string;
  sellerId: string;
  sellerName: string;
  sellerEmail: string;
  companyName: string;
  productName: string;
  productId: string;
  checkoutId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerDocument: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
  platformFee: number;
  gatewayFee: number;
  netAmount: number;
  createdAt: string;
  paidAt: string;
  gateway: string;
  transactionId: string;
  affiliateId?: string;
  affiliateName?: string;
  affiliateCommission?: number;
  
  // DADOS COMPLETOS DO CLIENTE (QUANDO DISPONVEL NO DETALHAMENTO)
  customer?: Customer;
}

interface TransactionStats {
  totalTransactions: number;
  totalRevenue: number;
  totalFees: number;
  avgTicket: number;
  topSellers: Array<{
    sellerId: string;
    sellerName: string;
    revenue: number;
    transactions: number;
  }>;
}

// FUNÇÃO AUXILIAR PARA FORMATAÇÃO DE MOEDA
const formatBRL = (cents: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(cents / 100);
};

export default function AdminTransactions() {
  const [searchTerm, setSearchTerm] = useState(() => localStorage.getItem('admin_transactions_search') || "");
  const [statusFilter, setStatusFilter] = useState<string>(() => localStorage.getItem('admin_transactions_status') || "all");
  const [gatewayFilter, setGatewayFilter] = useState<string>(() => localStorage.getItem('admin_transactions_gateway') || "all");
  const [dateFilter, setDateFilter] = useState<string>(() => localStorage.getItem('admin_transactions_date') || "24h");
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [resendingAccess, setResendingAccess] = useState(false);
  const { addToast } = useCustomToast();

  const handleResendMemberAccess = async (orderId: string) => {
    setResendingAccess(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/admin/resend-member-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao reenviar');
      addToast({ title: 'Acesso reenviado', description: data.message || 'Email de acesso enviado ao comprador', type: 'success' });
    } catch (err: any) {
      addToast({ title: 'Erro ao reenviar acesso', description: err.message, type: 'error' });
    } finally {
      setResendingAccess(false);
    }
  };
  
  const ITEMS_PER_PAGE = 10;

  useEffect(() => {
    localStorage.setItem('admin_transactions_search', searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    localStorage.setItem('admin_transactions_status', statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    localStorage.setItem('admin_transactions_gateway', gatewayFilter);
  }, [gatewayFilter]);

  useEffect(() => {
    localStorage.setItem('admin_transactions_date', dateFilter);
  }, [dateFilter]);

  // RESETAR PÁGINA QUANDO FILTROS MUDAREM
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, gatewayFilter, dateFilter]);

  async function getAuthToken(): Promise<string | null> {
    try {
      let user = auth.currentUser;
      if (!user) {
        user = await new Promise<any>((resolve) => {
          const unsub = auth.onAuthStateChanged((u) => {
            unsub();
            resolve(u);
          });
          setTimeout(() => resolve(null), 3000);
        });
      }
      if (!user) return null;
      
      const token = await user.getIdToken();
      return token;
    } catch (error) {
      console.error('Erro ao obter token:', error);
      return null;
    }
  }

  // BUSCAR TRANSAÇES COM TEMPO REAL
  const { data: transactionsResponse = { transactions: [] }, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['/api/admin/transactions', searchTerm, statusFilter, gatewayFilter, dateFilter],
    queryFn: async () => {
      const token = await getAuthToken();
      const response = await fetch('/api/admin/transactions?' + new URLSearchParams({
        search: searchTerm,
        status: statusFilter,
        gateway: gatewayFilter,
        dateFilter: dateFilter
      }), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // VALIDAÇÃO REAL - NÃO MASCARAR ERROS
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Transactions erro:', response.status, errorText);
        throw new Error(`Erro ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log('Resposta completa da API transações:', data);
      
      // VALIDAR ESTRUTURA REAL SEM FALLBACKS FAKE
      if (!data.success) {
        console.error('API retornou erro:', data);
        throw new Error(data.error || 'Erro desconhecido ao buscar transações');
      }
      
      const transactions = data.transactions || data.data || [];
      
      if (!Array.isArray(transactions)) {
        console.error('API não retornou array:', data);
        throw new Error('Formato de resposta inválido');
      }
      
      // MAPEAR CAMPOS DO BACKEND PARA O FRONTEND (compatibilidade)
      // Backend usa: method/processor | Frontend espera: paymentMethod/gateway
      const mappedTransactions = transactions.map((t: any) => ({
        ...t,
        paymentMethod: t.paymentMethod || t.method || 'unknown',
        gateway: t.gateway || t.processor || 'unknown',
      }));
      
      return {
        transactions: mappedTransactions,
        success: data.success,
        total: data.total || (Array.isArray(data) ? data.length : (data.transactions?.length || 0))
      };
    },
    staleTime: 60000, // Cache por 1 minuto - evita refetch automático
    gcTime: 5 * 60 * 1000, // Mantém em cache por 5 minutos
    refetchOnWindowFocus: false, // Não refaz ao voltar para aba
  });

  // EXTRAIR ARRAY DE TRANSAÇES DE FORMA SEGURA
  const allTransactions = transactionsResponse?.transactions || [];
  
  // PAGINAÇÃO
  const totalPages = Math.ceil(allTransactions.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const transactions = allTransactions.slice(startIndex, endIndex);

  // BUSCAR ESTATSTICAS
  const { data: statsResponse } = useQuery({
    queryKey: ['/api/admin/transactions/stats', dateFilter],
    queryFn: async () => {
      const token = await getAuthToken();
      const response = await fetch('/api/admin/transactions/stats?' + new URLSearchParams({
        dateFilter: dateFilter
      }), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Erro ao buscar estatísticas');
      }

      const data = await response.json();
      console.log('Stats API response:', data);
      return data;
    },
    staleTime: 60000, // Cache por 1 minuto
    gcTime: 5 * 60 * 1000, // Mantém por 5 minutos
    refetchOnWindowFocus: false,
  });

  // EXTRAIR STATS DO RESPONSE
  const stats = statsResponse?.stats;

  // EXPORTAR TRANSAÇES
  const handleExport = async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch('/api/admin/transactions/export?' + new URLSearchParams({
        search: searchTerm,
        status: statusFilter,
        gateway: gatewayFilter,
        dateFilter: dateFilter
      }), {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      });

      if (!response.ok) {
        throw new Error('Erro ao exportar transações');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transacoes_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      addToast({
        title: " Exportao Concluída",
        description: "Arquivo CSV baixado com sucesso!",
        type: "success"
      });
    } catch (error) {
      addToast({
        title: " Erro na Exportao",
        description: "No foi possvel exportar as transações",
        type: "error"
      });
    }
  };

  // ATUALIZAÇÃO MANUAL
  const handleRefresh = () => {
    refetch();
    addToast({
      title: " Dados Atualizados",
      description: "Transações sincronizadas com sucesso!",
      type: "success"
    });
  };

  // FORMATAÇÃO DE VALORES
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value / 100);
  };

  // FORMATAÇÃO DE STATUS
  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      'paid': 'default',
      'pending': 'secondary',
      'failed': 'destructive',
      'cancelled': 'outline',
      'refunded': 'secondary'
    };

    const labels: Record<string, string> = {
      'paid': 'Pago',
      'pending': 'Pendente',
      'failed': 'Falhou',
      'cancelled': 'Cancelado',
      'refunded': 'Reembolsado'
    };

    return (
      <Badge variant={variants[status] as any}>
        {labels[status] || status}
      </Badge>
    );
  };

  // FORMATAÇÃO DE GATEWAY
  const getGatewayBadge = (gateway: string) => {
    // MOSTRA BRANDING ORÁCULO PAY + MTODO ESPECFICO PARA CLAREZA OPERACIONAL
    return (
      <Badge className="bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-bold">
        {gateway || 'VolatusPay'}
      </Badge>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" data-testid="admin-transactions-page">
      {/* HEADER COM ESTATSTICAS */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="page-title">
            Transações Globais
          </h1>
          <p className="text-muted-foreground">
            Visão completa de todas as vendas do gateway
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm" data-testid="refresh-button">
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button onClick={handleExport} variant="outline" size="sm" data-testid="export-button">
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* CARDS DE ESTATSTICAS */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card data-testid="stats-transactions">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Transações</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalTransactions?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>

          <Card data-testid="stats-revenue">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Receita Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {formatCurrency(stats.totalRevenue || 0)}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="stats-fees">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Taxas Totais</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {formatCurrency(stats.totalFees || 0)}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="stats-avg-ticket">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ticket Médio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {formatCurrency(stats.avgTicket || 0)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* FILTROS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Filtros e Busca
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Buscar</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Empresa, email, produto..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                  data-testid="search-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="status-filter">
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="paid">Aprovados Pago</SelectItem>
                  <SelectItem value="pending">Pendentes Pendente</SelectItem>
                  <SelectItem value="failed">Rejeitados Falhou</SelectItem>
                  <SelectItem value="cancelled">Bloqueios Cancelado</SelectItem>
                  <SelectItem value="refunded"> Reembolsado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Gateway</label>
              <Select value={gatewayFilter} onValueChange={setGatewayFilter}>
                <SelectTrigger data-testid="gateway-filter">
                  <SelectValue placeholder="Todos os gateways" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="volatuspay">VolatusPay</SelectItem>
                  <SelectItem value="stripe">Stripe</SelectItem>
                  <SelectItem value="efibank">EFI Bank</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Período</label>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger data-testid="date-filter">
                  <SelectValue placeholder="Período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Últimas 24 Horas</SelectItem>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="yesterday">Ontem</SelectItem>
                  <SelectItem value="week">Esta Semana</SelectItem>
                  <SelectItem value="month">Este Ms</SelectItem>
                  <SelectItem value="quarter">Este Trimestre</SelectItem>
                  <SelectItem value="total">Todos os Tempos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/*  TABELA DE TRANSAÇES */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Todas as Transações</span>
            <Badge variant="secondary" data-testid="transactions-count">
              {allTransactions.length} registros
            </Badge>
          </CardTitle>
          <CardDescription>
            Última atualização: {dataUpdatedAt ? format(new Date(dataUpdatedAt), 'HH:mm:ss') : '--:--:--'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Nenhuma transação encontrada"
              description="No htransaes para os filtros selecionados"
            />
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seller</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Taxa</TableHead>
                    <TableHead>Gateway</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Aes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction: Transaction) => (
                    <TableRow key={transaction.id} data-testid={`transaction-row-${transaction.id}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{transaction.companyName || transaction.sellerName}</div>
                          <div className="text-sm text-muted-foreground">{transaction.sellerEmail}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{transaction.productName}</div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{transaction.customerName}</div>
                          <div className="text-sm text-muted-foreground">{transaction.customerEmail}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-bold text-emerald-600">
                          {formatCurrency(transaction.amount)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-orange-600">
                          {formatCurrency(transaction.platformFee + transaction.gatewayFee)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getGatewayBadge(transaction.gateway)}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(transaction.paymentStatus)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {format(new Date(transaction.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {format(new Date(transaction.createdAt), 'HH:mm:ss', { locale: ptBR })}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedTransaction(transaction)}
                          data-testid={`view-transaction-${transaction.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          
          {/* CONTROLES DE PAGINAÇÃO */}
          {!isLoading && allTransactions.length > 0 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Mostrando {startIndex + 1} a {Math.min(endIndex, allTransactions.length)} de {allTransactions.length} registros
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  data-testid="first-page"
                >
                  Primeira
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  data-testid="prev-page"
                >
                  Anterior
                </Button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <Button
                        key={i}
                        variant={currentPage === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        data-testid={`page-${pageNum}`}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                  {totalPages > 5 && currentPage < totalPages - 2 && (
                    <>
                      <span className="px-2">...</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(totalPages)}
                        data-testid={`page-${totalPages}`}
                      >
                        {totalPages}
                      </Button>
                    </>
                  )}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  data-testid="next-page"
                >
                  Próxima
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  data-testid="last-page"
                >
                  Última
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MODAL DE DETALHES DA TRANSAÇÃO */}
      {selectedTransaction && (
        <Dialog open={!!selectedTransaction} onOpenChange={() => setSelectedTransaction(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>Detalhes da Transação</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTransaction(null)}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogTitle>
              <DialogDescription>
                ID: {selectedTransaction.orderId} {selectedTransaction.gateway.toUpperCase()}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* DETALHES DO CLIENTE */}
              <div className="p-4 border rounded-lg">
                <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  {selectedTransaction.customer?.customerType === 'business' ? (
                    <>
                      <Building className="h-4 w-4 text-blue-600" />
                      Empresa
                    </>
                  ) : (
                    <>
                      <User className="h-4 w-4 text-emerald-600" />
                      Cliente
                    </>
                  )}
                </h4>
                
                <div className="space-y-2 text-sm">
                  {selectedTransaction.customer?.customerType === 'business' && selectedTransaction.customer.businessData ? (
                    <>
                      {/* DADOS DA EMPRESA */}
                      <div><span className="font-medium">Razo Social:</span> {selectedTransaction.customer.businessData.businessName}</div>
                      {selectedTransaction.customer.businessData.tradingName && (
                        <div><span className="font-medium">Nome Fantasia:</span> {selectedTransaction.customer.businessData.tradingName}</div>
                      )}
                      <div><span className="font-medium">CNPJ:</span> {selectedTransaction.customerDocument}</div>
                      {selectedTransaction.customer.businessData.stateRegistration && (
                        <div><span className="font-medium">Inscrio Estadual:</span> {selectedTransaction.customer.businessData.stateRegistration}</div>
                      )}
                      {selectedTransaction.customer.businessData.municipalRegistration && (
                        <div><span className="font-medium">Inscrio Municipal:</span> {selectedTransaction.customer.businessData.municipalRegistration}</div>
                      )}
                      {selectedTransaction.customer.businessData.businessType && (
                        <div><span className="font-medium">Tipo de Negócio:</span> {selectedTransaction.customer.businessData.businessType}</div>
                      )}
                      
                      {/* ENDEREÇO DA EMPRESA */}
                      {selectedTransaction.customer.businessData.businessAddress && (
                        <div className="mt-3 pt-2 border-t border-brand-muted">
                          <span className="font-medium">Endereço da Empresa:</span>
                          <div className="ml-2 text-brand-muted-foreground">
                            {`${selectedTransaction.customer.businessData.businessAddress.street}, ${selectedTransaction.customer.businessData.businessAddress.number}`}
                            {selectedTransaction.customer.businessData.businessAddress.complement && ` - ${selectedTransaction.customer.businessData.businessAddress.complement}`}
                            <br />
                            {`${selectedTransaction.customer.businessData.businessAddress.neighborhood}, ${selectedTransaction.customer.businessData.businessAddress.city}/${selectedTransaction.customer.businessData.businessAddress.state}`}
                            <br />
                            CEP: {selectedTransaction.customer.businessData.businessAddress.zipCode}
                          </div>
                        </div>
                      )}
                      
                      <div className="mt-3 pt-2 border-t border-brand-muted">
                        <span className="font-medium">Responsvel/Contato:</span>
                        <div className="ml-2 text-brand-muted-foreground">
                          {selectedTransaction.customerName} {selectedTransaction.customerEmail} {selectedTransaction.customerPhone}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* DADOS PESSOA FSICA */}
                      <div><span className="font-medium">Nome:</span> {selectedTransaction.customerName}</div>
                      <div><span className="font-medium">Email:</span> {selectedTransaction.customerEmail}</div>
                      {selectedTransaction.customerDocument && (
                        <div><span className="font-medium">CPF:</span> {selectedTransaction.customerDocument}</div>
                      )}
                      {selectedTransaction.customerPhone && (
                        <div><span className="font-medium">Telefone:</span> {selectedTransaction.customerPhone}</div>
                      )}
                      
                      {/* ENDEREÇO PESSOAL */}
                      {selectedTransaction.customer?.address && (
                        <div className="mt-3 pt-2 border-t border-brand-muted">
                          <span className="font-medium">Endereço:</span>
                          <div className="ml-2 text-brand-muted-foreground">
                            {`${selectedTransaction.customer.address.street}, ${selectedTransaction.customer.address.number} - ${selectedTransaction.customer.address.neighborhood}, ${selectedTransaction.customer.address.city}/${selectedTransaction.customer.address.state} - ${selectedTransaction.customer.address.zipCode}`}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* DETALHES FINANCEIROS */}
              <div className="p-4 border rounded-lg">
                <h4 className="font-semibold text-gray-800 mb-2">Financeiro</h4>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium">Valor Total:</span> <span className="text-emerald-600 font-bold">{formatBRL(selectedTransaction.amount)}</span></div>
                  <div><span className="font-medium">Taxa Plataforma:</span> <span className="text-orange-600">{formatBRL(selectedTransaction.platformFee)}</span></div>
                  <div><span className="font-medium">Taxa Gateway:</span> <span className="text-orange-600">{formatBRL(selectedTransaction.gatewayFee)}</span></div>
                  <div><span className="font-medium">Valor Lquido:</span> <span className="text-blue-600 font-bold">{formatBRL(selectedTransaction.netAmount)}</span></div>
                  <div><span className="font-medium">Método:</span> {selectedTransaction.paymentMethod}</div>
                  <div><span className="font-medium">Status:</span> {getStatusBadge(selectedTransaction.paymentStatus)}</div>
                  <div><span className="font-medium">Gateway:</span> {getGatewayBadge(selectedTransaction.gateway)}</div>
                </div>
              </div>

              {/* DETALHES DO PRODUTO */}
              <div className="p-4 border rounded-lg">
                <h4 className="font-semibold text-gray-800 mb-2">Produto</h4>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium">Nome:</span> {selectedTransaction.productName}</div>
                  <div><span className="font-medium">ID Produto:</span> {selectedTransaction.productId}</div>
                  <div><span className="font-medium">ID Checkout:</span> {selectedTransaction.checkoutId}</div>
                </div>
              </div>

              {/* DETALHES DO SELLER */}
              <div className="p-4 border rounded-lg">
                <h4 className="font-semibold text-gray-800 mb-2">Seller</h4>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium">Empresa:</span> {selectedTransaction.companyName || selectedTransaction.sellerName}</div>
                  <div><span className="font-medium">Email:</span> {selectedTransaction.sellerEmail}</div>
                  <div><span className="font-medium">ID:</span> {selectedTransaction.sellerId}</div>
                </div>
              </div>

              {/* DETALHES DE TEMPO */}
              <div className="p-4 border rounded-lg lg:col-span-2">
                <h4 className="font-semibold text-gray-800 mb-2">Timeline</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Criado em:</span>
                    <div className="text-brand-muted-foreground">
                      {format(new Date(selectedTransaction.createdAt), "dd/MM/yyyy 's' HH:mm:ss", { locale: ptBR })}
                    </div>
                  </div>
                  {selectedTransaction.paidAt && (
                    <div>
                      <span className="font-medium">Pago em:</span>
                      <div className="text-brand-muted-foreground">
                        {format(new Date(selectedTransaction.paidAt), "dd/MM/yyyy 's' HH:mm:ss", { locale: ptBR })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Desconto: AFILIADO (SE HOUVER) */}
              {selectedTransaction.affiliateId && (
                <div className="p-4 border rounded-lg lg:col-span-2">
                  <h4 className="font-semibold text-gray-800 mb-2">Afiliado</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="font-medium">Nome:</span> {selectedTransaction.affiliateName}</div>
                    <div><span className="font-medium">ID:</span> {selectedTransaction.affiliateId}</div>
                    {selectedTransaction.affiliateCommission && (
                      <div><span className="font-medium">Comisso:</span> <span className="text-emerald-600">{formatBRL(selectedTransaction.affiliateCommission)}</span></div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* AÇÕES DA TRANSAÇÃO */}
            {selectedTransaction.paymentStatus === 'paid' && (
              <div className="mt-4 pt-4 border-t flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  disabled={resendingAccess}
                  onClick={() => handleResendMemberAccess(selectedTransaction.orderId)}
                >
                  <Mail className="h-4 w-4" />
                  {resendingAccess ? 'Reenviando...' : 'Reenviar acesso de membro'}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
      </div>
    </DashboardLayout>
  );
}