import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Download, 
  CheckCircle, 
  XCircle, 
  Clock, 
  RefreshCw, 
  DollarSign,
  Eye,
  AlertTriangle,
  User,
  Mail,
  Phone,
  Calendar
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/dashboard-layout";

export default function RefundWithdrawals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Estados para modal de detalhes
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Estados para processamento
  const [adminNotes, setAdminNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  async function getAdminToken(): Promise<string> {
    const { auth } = await import("@/lib/firebase");
    const user = auth.currentUser;
    if (!user) throw new Error('Sessão expirada. Faça login novamente.');
    return user.getIdToken();
  }

  // BUSCAR SAQUES REAIS DO FIREBASE
  const { data: withdrawals = [], isLoading } = useQuery<any[]>({
    queryKey: ["admin-refund-withdrawals"],
    queryFn: async () => {
      const token = await getAdminToken();
      const response = await fetch('/api/admin/customer-withdrawals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({})
      });
      
      if (!response.ok) throw new Error('Erro ao buscar saques');
      
      const responseText = await response.text();
      if (!responseText || responseText.includes('unauthorized')) {
        throw new Error('Erro de autenticação');
      }
      
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Refund withdrawals JSON parse error:', responseText.substring(0, 100));
        throw new Error('Resposta inválida do servidor');
      }
      return result.withdrawals || [];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Processar saque (aprovação/rejeição real)
  const processWithdrawalMutation = useMutation({
    mutationFn: async ({ withdrawalId, action, notes }: { withdrawalId: string; action: string; notes?: string }) => {
      const token = await getAdminToken();
      const response = await fetch(`/api/admin/customer-withdrawals/${withdrawalId}/${action}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ notes }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao processar saque');
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      const actionText = (variables as any).action === "approve" ? "aprovado" : "rejeitado";
      toast({
        title: `Saque ${actionText}!`,
        description: `O saque foi ${actionText} com sucesso.`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-refund-withdrawals"] });
      setShowDetailsModal(false);
      setSelectedWithdrawal(null);
      setAdminNotes("");
    },
    onError: (error) => {
      console.error("Erro ao processar saque:", error);
      toast({
        title: " Erro ao Processar",
        description: "Ocorreu um erro inesperado. Tente novamente em alguns minutos.",
        variant: "destructive",
      });
    }
  });

  // Obter estatísticas
  const pendingWithdrawals = withdrawals.filter(w => w.status === "pending");
  const approvedWithdrawals = withdrawals.filter(w => w.status === "approved");
  const rejectedWithdrawals = withdrawals.filter(w => w.status === "rejected");
  const processedWithdrawals = withdrawals.filter(w => w.status === "processed");

  const totalPendingAmount = pendingWithdrawals.reduce((sum, w) => sum + w.amount, 0);
  const totalApprovedAmount = approvedWithdrawals.reduce((sum, w) => sum + w.amount, 0);

  // Badge do status
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-emerald-50 text-muted-foreground border-yellow-200">Pendente</Badge>;
      case "approved":
        return <Badge variant="default" className="bg-emerald-100 text-muted-foreground">Aprovado</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="bg-red-100 text-muted-foreground">Rejeitado</Badge>;
      case "processed":
        return <Badge variant="outline" className="bg-emerald-50 text-muted-foreground border-blue-200">Processado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Abrir modal de detalhes
  const openDetailsModal = (withdrawal: any) => {
    setSelectedWithdrawal(withdrawal);
    setShowDetailsModal(true);
    setAdminNotes(withdrawal.adminNotes || "");
  };

  // Processar aprovação/rejeio
  const handleProcessWithdrawal = async (action: string) => {
    if (!selectedWithdrawal) return;
    
    setIsProcessing(true);
    try {
      await processWithdrawalMutation.mutateAsync({
        withdrawalId: selectedWithdrawal.id,
        action,
        notes: adminNotes.trim() || undefined
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const formatPixKeyType = (type: string) => {
    const types = {
      cpf: "CPF",
      cnpj: "CNPJ", 
      email: "E-mail",
      phone: "Telefone",
      random: "Aleatria"
    };
    return (types as Record<string, string>)[type] || type;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
      {/* CABEÇALHO */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Saques de Reembolso</h1>
        <p className="text-brand-muted-foreground mt-1">
          Gerencie solicitações de saque de clientes que receberam reembolsos
        </p>
      </div>

      {/* ESTATSTICAS */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Solicitações</CardTitle>
            <Download className="h-4 w-4 text-emerald-700" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withdrawals.length}</div>
            <p className="text-xs text-muted-foreground">
              Todas as solicitações
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
            <Clock className="h-4 w-4 text-emerald-700" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{pendingWithdrawals.length}</div>
            <p className="text-xs text-muted-foreground">
              R$ {(totalPendingAmount / 100).toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Aprovados</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-700" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{approvedWithdrawals.length}</div>
            <p className="text-xs text-muted-foreground">
              R$ {(totalApprovedAmount / 100).toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rejeitados</CardTitle>
            <XCircle className="h-4 w-4 text-emerald-700" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{rejectedWithdrawals.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Processados</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-700" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{processedWithdrawals.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* TABELAS COM ABAS */}
      <Card>
        <CardHeader>
          <CardTitle>Solicitações de Saque</CardTitle>
          <CardDescription>
            Visualize e processe todas as solicitações de saque de reembolso
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="pending" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="pending">Pendentes ({pendingWithdrawals.length})</TabsTrigger>
              <TabsTrigger value="approved">Aprovados ({approvedWithdrawals.length})</TabsTrigger>
              <TabsTrigger value="rejected">Rejeitados ({rejectedWithdrawals.length})</TabsTrigger>
              <TabsTrigger value="all">Todos ({withdrawals.length})</TabsTrigger>
            </TabsList>

            {["pending", "approved", "rejected", "all"].map((tab) => (
              <TabsContent key={tab} value={tab}>
                {isLoading ? (
                  <div className="flex justify-center items-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    <span className="ml-3 text-brand-muted-foreground">Carregando saques...</span>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Chave PIX</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Aes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {withdrawals
                          .filter(withdrawal => {
                            if (tab === "all") return true;
                            return withdrawal.status === tab;
                          })
                          .map((withdrawal) => (
                          <TableRow key={withdrawal.id}>
                            <TableCell>
                              <div>
                                <div className="font-medium">{withdrawal.customerName}</div>
                                <div className="text-sm text-muted-foreground">{withdrawal.customerEmail}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-bold text-muted-foreground">
                                R$ {(withdrawal.amount / 100).toFixed(2)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-mono text-sm">{withdrawal.pixKey}</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatPixKeyType(withdrawal.pixKeyType)}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(withdrawal.status)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {format(withdrawal.createdAt, "dd/MM/yyyy", { locale: ptBR })}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openDetailsModal(withdrawal)}
                                data-testid={`button-view-withdrawal-${withdrawal.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {withdrawals.filter(withdrawal => {
                          if (tab === "all") return true;
                          return withdrawal.status === tab;
                        }).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-12 text-brand-muted-foreground">
                              {tab === "pending" && "Nenhuma solicitação pendente"}
                              {tab === "approved" && "Nenhum saque aprovado"}
                              {tab === "rejected" && "Nenhuma solicitação rejeitada"}
                              {tab === "all" && "Nenhuma solicitação encontrada"}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* MODAL DE DETALHES E PROCESSAMENTO */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-emerald-700" />
              Detalhes da Solicitação de Saque
            </DialogTitle>
            <DialogDescription>
              Revise todos os dados antes de aprovar ou rejeitar o saque
            </DialogDescription>
          </DialogHeader>

          {selectedWithdrawal && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* DADOS DO CLIENTE */}
              <div className="space-y-4">
                <div className="bg-emerald-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Dados do Cliente
                  </h3>
                  <div className="space-y-2 text-sm">
                    <p><strong>Nome:</strong> {selectedWithdrawal.customerName}</p>
                    <p className="flex items-center gap-2">
                      <Mail className="w-3 h-3" />
                      <strong>Email:</strong> {selectedWithdrawal.customerEmail}
                    </p>
                    {selectedWithdrawal.customerPhone && (
                      <p className="flex items-center gap-2">
                        <Phone className="w-3 h-3" />
                        <strong>Telefone:</strong> {selectedWithdrawal.customerPhone}
                      </p>
                    )}
                    <p className="flex items-center gap-2">
                      <Calendar className="w-3 h-3" />
                      <strong>Data da Solicitação:</strong> {format(selectedWithdrawal.createdAt, "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                  </div>
                </div>

                {/* DADOS DO SAQUE */}
                <div className="bg-emerald-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Dados do Saque
                  </h3>
                  <div className="space-y-2 text-sm">
                    <p><strong>Valor Solicitado:</strong> <span className="text-lg font-bold text-muted-foreground">R$ {(selectedWithdrawal.amount / 100).toFixed(2)}</span></p>
                    <p><strong>Chave PIX:</strong> <span className="font-mono">{selectedWithdrawal.pixKey}</span></p>
                    <p><strong>Tipo da Chave:</strong> {formatPixKeyType(selectedWithdrawal.pixKeyType)}</p>
                    <p><strong>Reembolsos Relacionados:</strong> {selectedWithdrawal.refundBalanceIds.length} transações</p>
                  </div>
                </div>
              </div>

              {/* STATUS E PROCESSAMENTO */}
              <div className="space-y-4">
                <div className="bg-brand-subtle p-4 rounded-lg">
                  <h3 className="font-semibold text-foreground mb-3">Status e Histórico</h3>
                  <div className="space-y-2 text-sm">
                    <p><strong>Status Atual:</strong> {getStatusBadge(selectedWithdrawal.status)}</p>
                    <p><strong>Data da Solicitação:</strong> {format(selectedWithdrawal.createdAt, "dd/MM/yyyy 's' HH:mm", { locale: ptBR })}</p>
                    {selectedWithdrawal.processedAt && (
                      <p><strong>Data de Processamento:</strong> {format(selectedWithdrawal.processedAt, "dd/MM/yyyy 's' HH:mm", { locale: ptBR })}</p>
                    )}
                    {selectedWithdrawal.adminNotes && (
                      <div>
                        <p><strong>Notas do Administrador:</strong></p>
                        <div className="mt-1 p-2 bg-white border border-brand-muted rounded text-sm">
                          {selectedWithdrawal.adminNotes}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* AÇES DE PROCESSAMENTO */}
                {selectedWithdrawal.status === "pending" && (
                  <div className="bg-emerald-50 p-4 rounded-lg border border-orange-200">
                    <h3 className="font-semibold text-muted-foreground mb-3">Deciso sobre o Saque</h3>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="admin-notes">Notas Administrativas (Opcional)</Label>
                        <Textarea
                          id="admin-notes"
                          value={adminNotes}
                          onChange={(e) => setAdminNotes(e.target.value)}
                          placeholder="Adicione comentrios sobre sua deciso..."
                          rows={3}
                          className="mt-1"
                        />
                      </div>
                      <div className="flex gap-3 justify-end">
                        <Button
                          variant="destructive"
                          onClick={() => handleProcessWithdrawal("reject")}
                          disabled={isProcessing}
                          className="bg-emerald-500 hover:bg-emerald-500"
                        >
                          {isProcessing ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                          ) : (
                            <XCircle className="w-4 h-4 mr-2" />
                          )}
                          Rejeitar Saque
                        </Button>
                        <Button
                          onClick={() => handleProcessWithdrawal("approve")}
                          disabled={isProcessing}
                          className="bg-emerald-500 hover:bg-emerald-500"
                        >
                          {isProcessing ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                          ) : (
                            <CheckCircle className="w-4 h-4 mr-2" />
                          )}
                          Aprovar Saque
                        </Button>
                      </div>
                      
                      {/* Avisão importante */}
                      <div className="p-3 bg-emerald-50 border border-amber-200 rounded-lg mt-4">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-emerald-700 mt-0.5" />
                          <div className="text-sm">
                            <p className="text-muted-foreground font-medium">Importante</p>
                            <p className="text-muted-foreground">
                              Ao aprovar este saque, vocdeve processar o PIX manualmente para a chave informada. 
                              O sistema no processa PIX automaticamente.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}