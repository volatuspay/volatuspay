import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { CustomerSidebar } from "@/components/layout/customer-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Wallet,
  Download,
  DollarSign,
  Clock,
  CheckCircle,
  AlertCircle,
  CreditCard,
  Smartphone,
  Coins,
  TrendingUp,
  Banknote,
  Calculator
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RefundBalance {
  id: string;
  orderId: string;
  productTitle: string;
  amount: number;
  refundedAt: Date;
  status: 'available' | 'withdrawn' | 'processing';
}

interface WithdrawalRequest {
  id: string;
  amount: number;
  pixKey: string;
  pixKeyType: string;
  status: 'pending' | 'approved' | 'rejected' | 'processed';
  createdAt: Date;
  processedAt?: Date;
  adminNotes?: string;
}

export default function MyBalance() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Estados do modal de saque
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [pixKey, setPixKey] = useState("");
  const [pixKeyType, setPixKeyType] = useState("email");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  
  // BUSCAR SALDO DE REEMBOLSOS DO FIREBASE
  const { data: refundBalances = [], isLoading: balancesLoading } = useQuery({
    queryKey: ["customer-refund-balances", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      
      const response = await fetch('/api/customer/refund-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerEmail: user.email })
      });
      
      if (!response.ok) throw new Error('Erro ao buscar saldo');
      
      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const responseText = await response.text();
      if (!responseText || responseText.trim() === 'unauthorized' || responseText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema ao buscar saldo');
      }
      
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Balance JSON parse error:', responseText.substring(0, 100));
        throw new Error('Resposta inválida do servidor de saldo');
      }
      
      return result.balances.map((balance: any) => ({
        ...balance,
        refundedAt: new Date(balance.refundedAt),
      }));
    },
    enabled: !!user?.email,
    refetchInterval: 60000, // ⚡ OTIMIZADO: 60 segundos
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // BUSCAR HISTRICO DE SAQUES
  const { data: withdrawals = [], isLoading: withdrawalsLoading } = useQuery({
    queryKey: ["customer-withdrawals", user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      
      const response = await fetch('/api/customer/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerEmail: user.email })
      });
      
      if (!response.ok) throw new Error('Erro ao buscar saques');
      
      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const responseText = await response.text();
      if (!responseText || responseText.trim() === 'unauthorized' || responseText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema ao buscar saques');
      }
      
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Withdrawals JSON parse error:', responseText.substring(0, 100));
        throw new Error('Resposta inválida do servidor de saques');
      }
      
      return result.withdrawals.map((withdrawal: any) => ({
        ...withdrawal,
        createdAt: new Date(withdrawal.createdAt),
        processedAt: withdrawal.processedAt ? new Date(withdrawal.processedAt) : undefined,
      }));
    },
    enabled: !!user?.email,
    refetchInterval: 60000, // ⚡ OTIMIZADO: 60 segundos
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // MUTATION PARA SOLICITAR SAQUE
  const requestWithdrawMutation = useMutation({
    mutationFn: async ({ amount, pixKey, pixKeyType }: {
      amount: number;
      pixKey: string;
      pixKeyType: string;
    }) => {
      if (!user) throw new Error('Usuário não autenticado');
      if (!auth.currentUser) throw new Error('Sesso expirada. Faça login novamente.');
      
      const token = await auth.currentUser.getIdToken();
      
      const response = await fetch('/api/customer/request-withdrawal', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          customerEmail: user?.email,
          customerName: user?.displayName || user?.email,
          amount,
          pixKey,
          pixKeyType
        })
      });
      
      if (!response.ok) throw new Error('Erro ao solicitar saque');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: " Saque solicitado!",
        description: "Sua solicitação será analisada pelo admin em até 24h.",
      });
      queryClient.invalidateQueries({ queryKey: ["customer-refund-balances"] });
      queryClient.invalidateQueries({ queryKey: ["customer-withdrawals"] });
      setShowWithdrawModal(false);
      setPixKey("");
      setWithdrawAmount("");
    },
    onError: (error: any) => {
      toast({
        title: " Erro",
        description: error.message || "Erro ao solicitar saque. Tente novamente.",
        variant: "destructive",
      });
    }
  });

  // Calcular saldos
  const availableBalances = refundBalances.filter((b: RefundBalance) => b.status === 'available');
  const totalAvailable = availableBalances.reduce((sum: number, b: RefundBalance) => sum + b.amount, 0);
  const totalPending = withdrawals
    .filter((w: WithdrawalRequest) => w.status === 'pending')
    .reduce((sum: number, w: WithdrawalRequest) => sum + w.amount, 0);

  // Status badge helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-xs">Pendente</Badge>;
      case "approved":
        return <Badge variant="outline" className="text-xs bg-emerald-50 border-emerald-200">Aprovado</Badge>;
      case "rejected":
        return <Badge variant="outline" className="text-xs bg-red-50 border-red-200">Rejeitado</Badge>;
      case "processed":
        return <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200">Pago</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  const handleRequestWithdraw = () => {
    const amount = parseInt(withdrawAmount);
    
    if (!pixKey.trim()) {
      toast({
        title: " Erro",
        description: "Informe sua chave PIX",
        variant: "destructive",
      });
      return;
    }
    
    if (amount <= 0 || amount > totalAvailable) {
      toast({
        title: " Erro",
        description: `Valor deve ser entre R$0,01 e ${formatBRL(totalAvailable)}`,
        variant: "destructive",
      });
      return;
    }

    requestWithdrawMutation.mutate({
      amount,
      pixKey: pixKey.trim(),
      pixKeyType
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <CustomerSidebar />
      
      <main className="flex-1 min-w-0 overflow-auto lg:ml-64">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Meu Saldo</h1>
            <p className="text-gray-600">
              Gerencie seus saldos de reembolso e histórico de saques
            </p>
          </div>

          {/* Estatsticas de Saldo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo Disponível</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatBRL(totalAvailable)}</div>
                <p className="text-xs text-muted-foreground">
                  {availableBalances.length} reembolso{availableBalances.length !== 1 ? 's' : ''} aprovado{availableBalances.length !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saques Pendentes</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatBRL(totalPending)}</div>
                <p className="text-xs text-muted-foreground">
                  aguardando processamento
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total de Saques</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{withdrawals.length}</div>
                <p className="text-xs text-muted-foreground">
                  {withdrawals.length === 1 ? "solicitação" : "solicitações"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Aes */}
          <div className="flex gap-4 mb-6">
            {totalAvailable > 0 && (
              <Dialog open={showWithdrawModal} onOpenChange={setShowWithdrawModal}>
                <DialogTrigger asChild>
                  <Button>
                    <Download className="h-4 w-4 mr-2" />
                    Solicitar Saque
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Solicitar Saque</DialogTitle>
                    <DialogDescription>
                      Disponível: <strong>{formatBRL(totalAvailable)}</strong>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="amount">Valor do saque</Label>
                      <Input
                        id="amount"
                        type="number"
                        placeholder="Ex: 100"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        max={totalAvailable}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pixKey">Chave PIX</Label>
                      <Input
                        id="pixKey"
                        placeholder="Sua chave PIX"
                        value={pixKey}
                        onChange={(e) => setPixKey(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      onClick={handleRequestWithdraw}
                      disabled={requestWithdrawMutation.isPending}
                      className="w-full"
                    >
                      {requestWithdrawMutation.isPending ? "Solicitando..." : "Solicitar Saque"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Reembolsos Disponíveis */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Reembolsos Disponíveis
                {availableBalances.length > 0 && (
                  <Badge variant="secondary">{availableBalances.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Reembolsos aprovados que você pode sacar
              </CardDescription>
            </CardHeader>
            <CardContent>
              {balancesLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse bg-gray-200 h-16 rounded" />
                  ))}
                </div>
              ) : availableBalances.length === 0 ? (
                <div className="text-center py-8">
                  <Wallet className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-600">Nenhum reembolso disponível</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableBalances.map((balance: RefundBalance) => (
                    <div key={balance.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg border">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{balance.productTitle}</p>
                        <p className="text-sm text-muted-foreground">
                          Reembolsado em {format(balance.refundedAt, "dd/MM/yyyy", { locale: ptBR })}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-bold text-gray-900">{formatBRL(balance.amount)}</p>
                        <Badge variant="outline" className="text-xs">Disponível</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Histórico de Saques */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Histórico de Saques
                {withdrawals.length > 0 && (
                  <Badge variant="secondary">{withdrawals.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Todas as suas solicitações de saque
              </CardDescription>
            </CardHeader>
            <CardContent>
              {withdrawalsLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse bg-gray-200 h-16 rounded" />
                  ))}
                </div>
              ) : withdrawals.length === 0 ? (
                <div className="text-center py-8">
                  <Download className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-600">Nenhum saque solicitado ainda</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {withdrawals.map((withdrawal: WithdrawalRequest) => (
                    <div key={withdrawal.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg border">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-muted-foreground" />
                          <span className="font-mono text-gray-900 truncate">{withdrawal.pixKey}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(withdrawal.createdAt, "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-bold text-gray-900">{formatBRL(withdrawal.amount)}</p>
                        {getStatusBadge(withdrawal.status)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}