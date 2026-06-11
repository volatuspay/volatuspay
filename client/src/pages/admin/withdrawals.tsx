import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DollarSign, CreditCard, Smartphone, Clock, CheckCircle, XCircle, TrendingUp, Eye, Shield, AlertCircle, Wallet, ArrowUpRight, Coins, Copy } from "lucide-react";
import { format, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useToast } from "@/hooks/use-toast";

const toDate = (date: any): Date | null => {
  if (!date) return null;
  if (date instanceof Date) return date;
  // Firestore Timestamp serializado pelo Admin SDK: { _seconds, _nanoseconds }
  if (typeof date === 'object' && (date._seconds !== undefined || date.seconds !== undefined)) {
    const secs = date._seconds ?? date.seconds;
    return new Date(secs * 1000);
  }
  // String ISO ou número (unix ms)
  const d = new Date(date);
  return isValid(d) ? d : null;
};

const formatSafeDate = (date: any, formatString: string = "dd/MM HH:mm", fallback: string = "N/A"): string => {
  if (!date) return fallback;
  try {
    const dateObj = toDate(date);
    if (!dateObj || !isValid(dateObj)) return fallback;
    return format(dateObj, formatString, { locale: ptBR });
  } catch (error) {
    console.warn('Erro ao formatar data:', date, error);
    return fallback;
  }
};

export default function AdminWithdrawals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);

  // ── Cripto ───────────────────────────────────────────────────────────────────
  const [selectedCrypto, setSelectedCrypto] = useState<any>(null);
  const [isCryptoDialogOpen, setIsCryptoDialogOpen] = useState(false);
  const [cryptoRejectReason, setCryptoRejectReason] = useState("");
  const [isCryptoRejectDialogOpen, setIsCryptoRejectDialogOpen] = useState(false);

  async function getAuthToken(): Promise<string | null> {
    try {
      const { auth } = await import("@/lib/firebase");
      const user = auth.currentUser;
      if (!user) return null;
      
      const token = await user.getIdToken();
      console.log('Token obtido para admin saques:', user.uid);
      return token;
    } catch (error) {
      console.error('Erro ao obter token:', error);
      return null;
    }
  }

  const { data: withdrawals = [], isLoading } = useQuery({
    queryKey: ["admin-withdrawals"],
    queryFn: async () => {
      console.log("Admin buscando TODOS os saques via API segura...");
      
      const token = await getAuthToken();
      const response = await fetch('/api/admin/withdrawals', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Erro ao buscar saques');
      }

      const result = await response.json();
      
      // ✅ GARANTIR QUE SEMPRE RETORNA ARRAY (proteção contra erro de índice)
      if (!Array.isArray(result)) {
        console.warn("⚠️ API retornou objeto ao invés de array (índice ausente?):", result);
        return [];
      }
      
      console.log("ADMIN encontrou", result.length, "saques via API");
      return result;
    },
    refetchInterval: 300000, // ⚡ Auto-refresh a cada 5 minutos (economia de quota)
    refetchOnWindowFocus: false, // ⚡ DESATIVADO para economizar Firebase
    staleTime: 120000, // Cache de 2 minutos
    retry: 1, // Só 1 retry em caso de erro
  });

  const approveMutation = useMutation({
    mutationFn: async (withdrawalId: string) => {
      console.log("Admin aprovando saque via API segura:", withdrawalId);
      
      const token = await getAuthToken();
      const response = await fetch(`/api/admin/withdrawals/${withdrawalId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao aprovar saque');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Saque aprovado",
        description: "Valor debitado automaticamente com segurança.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/balance/summary"] });
      setSelectedWithdrawal(null);
      setIsDialogOpen(false);
      setIsRejectDialogOpen(false);
      setRejectionReason("");
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao aprovar saque",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ withdrawalId, reason }: { withdrawalId: string; reason: string }) => {
      console.log("Admin rejeitando saque via API segura:", withdrawalId, reason);
      
      const token = await getAuthToken();
      const response = await fetch(`/api/admin/withdrawals/${withdrawalId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao rejeitar saque');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Saque rejeitado",
        description: "Valor devolvido ao saldo disponível.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin-withdrawals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/balance/summary"] });
      setSelectedWithdrawal(null);
      setIsDialogOpen(false);
      setIsRejectDialogOpen(false);
      setRejectionReason("");
    }
  });

  // ── Query: saques em cripto ──────────────────────────────────────────────────
  const { data: cryptoWithdrawals = [], isLoading: isLoadingCrypto } = useQuery({
    queryKey: ["admin-crypto-withdrawals"],
    queryFn: async () => {
      const token = await getAuthToken();
      const response = await fetch('/api/withdrawals/admin/crypto-withdrawals', {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Erro ao buscar saques cripto');
      return response.json();
    },
    refetchInterval: 120000,
    refetchOnWindowFocus: false,
    staleTime: 60000,
  });

  const approveCryptoMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getAuthToken();
      const response = await fetch(`/api/withdrawals/admin/crypto-withdrawals/${id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao aprovar');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Saque USDT aprovado", description: "Saldo debitado do seller." });
      queryClient.invalidateQueries({ queryKey: ["admin-crypto-withdrawals"] });
      setSelectedCrypto(null);
      setIsCryptoDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Erro ao aprovar", description: error.message, variant: "destructive" });
    }
  });

  const rejectCryptoMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const token = await getAuthToken();
      const response = await fetch(`/api/withdrawals/admin/crypto-withdrawals/${id}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao rejeitar');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Saque USDT rejeitado", description: "Valor devolvido ao saldo do seller." });
      queryClient.invalidateQueries({ queryKey: ["admin-crypto-withdrawals"] });
      setSelectedCrypto(null);
      setIsCryptoDialogOpen(false);
      setIsCryptoRejectDialogOpen(false);
      setCryptoRejectReason("");
    },
    onError: (error: any) => {
      toast({ title: "Erro ao rejeitar", description: error.message, variant: "destructive" });
    }
  });

  const pendingCryptoWithdrawals = (cryptoWithdrawals as any[]).filter((w: any) => w.status === 'pending');
  const completedCryptoWithdrawals = (cryptoWithdrawals as any[]).filter((w: any) => w.status !== 'pending');

  const pendingWithdrawals = withdrawals.filter((w: any) => w.status === "pending");
  const processingWithdrawals = withdrawals.filter((w: any) => w.status === "processing");
  const completedWithdrawals = withdrawals.filter((w: any) => ["approved", "rejected"].includes(w.status));
  const approvedWithdrawals = withdrawals.filter((w: any) => w.status === "approved");
  const rejectedWithdrawals = withdrawals.filter((w: any) => w.status === "rejected");

  const totalPendingAmount = pendingWithdrawals.reduce((sum: number, w: any) => sum + w.amount, 0);
  const totalApprovedAmount = approvedWithdrawals.reduce((sum: number, w: any) => sum + w.amount, 0);
  const totalRejectedAmount = rejectedWithdrawals.reduce((sum: number, w: any) => sum + w.amount, 0);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <div className="w-8 h-8 border-2 border-brand-muted border-t-gray-900 rounded-full animate-spin mx-auto" />
            <p className="text-sm font-medium text-brand-muted-foreground">Carregando saques para aprovação...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 lg:space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* HEADER */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-6">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              Aprovação de Saques
            </h1>
            <p className="text-sm text-brand-muted-foreground dark:text-gray-400">
              Gerencie solicitações de saque dos sellers
            </p>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-right">
              <div className="text-xl sm:text-2xl font-semibold text-foreground">
                {pendingWithdrawals.length}
              </div>
              <div className="text-xs text-brand-muted-foreground uppercase tracking-wide">Pendentes</div>
            </div>
            <div className="h-10 sm:h-12 w-px bg-brand-subtle dark:bg-gray-700" />
            <div className="text-right">
              <div className="text-xl sm:text-2xl font-semibold text-foreground">
                R$ {(totalPendingAmount / 100).toFixed(2)}
              </div>
              <div className="text-xs text-brand-muted-foreground uppercase tracking-wide">Aguardando</div>
            </div>
          </div>
        </div>

        {/* ESTATÍSTICAS */}
        <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
          <Card className="border-brand-muted dark:border-emerald-500/20 bg-white dark:bg-transparent">
            <CardContent className="p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold text-foreground">{pendingWithdrawals.length}</div>
              <div className="text-xs sm:text-sm text-brand-muted-foreground mt-1">Pendentes</div>
              <div className="text-xs text-brand-muted-foreground">R$ {(totalPendingAmount / 100).toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card className="border-brand-muted dark:border-emerald-500/20 bg-white dark:bg-transparent">
            <CardContent className="p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold text-foreground">{approvedWithdrawals.length}</div>
              <div className="text-xs sm:text-sm text-brand-muted-foreground mt-1">Aprovados</div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">R$ {(totalApprovedAmount / 100).toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card className="border-brand-muted dark:border-emerald-500/20 bg-white dark:bg-transparent">
            <CardContent className="p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold text-foreground">{rejectedWithdrawals.length}</div>
              <div className="text-xs sm:text-sm text-brand-muted-foreground mt-1">Falhas</div>
              <div className="text-xs text-red-600 dark:text-red-400 font-medium">R$ {(totalRejectedAmount / 100).toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card className="border-brand-muted dark:border-emerald-500/20 bg-white dark:bg-transparent">
            <CardContent className="p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-semibold text-blue-600 dark:text-blue-400">R$ {(totalApprovedAmount / 100).toFixed(2)}</div>
              <div className="text-xs sm:text-sm text-brand-muted-foreground mt-1">Total Aprovado</div>
              <div className="text-xs text-brand-muted-foreground">Saques pagos</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="pending" className="space-y-6">
          <TabsList className="bg-brand-subtle dark:bg-card p-1">
            <TabsTrigger value="pending" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-950">
              Pendentes ({pendingWithdrawals.length})
            </TabsTrigger>
            <TabsTrigger value="processing" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-950">
              Processando ({processingWithdrawals.length})
            </TabsTrigger>
            <TabsTrigger value="completed" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-950">
              Finalizados ({completedWithdrawals.length})
            </TabsTrigger>
            <TabsTrigger value="usdt" className="data-[state=active]:bg-amber-50 dark:data-[state=active]:bg-amber-900/20 text-amber-700 data-[state=active]:text-amber-800">
              USDT ({pendingCryptoWithdrawals.length})
            </TabsTrigger>
          </TabsList>

          {/* ABA PENDENTES */}
          <TabsContent value="pending">
            <Card className="border-brand-muted dark:border-emerald-500/20">
              <CardHeader className="border-b border-brand-muted dark:border-emerald-500/20">
                <CardTitle className="text-lg font-semibold text-foreground">Saques Pendentes</CardTitle>
                <CardDescription className="text-sm text-brand-muted-foreground">
                  Sellers aguardando aprovação dos saques. Aprove ou rejeite.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {pendingWithdrawals.length === 0 ? (
                  <div className="text-center py-12 sm:py-16 px-6">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-brand-subtle dark:bg-card flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="h-6 w-6 sm:h-8 sm:w-8 text-brand-muted-foreground" />
                    </div>
                    <p className="text-base sm:text-lg font-medium text-foreground mb-1">
                      Nenhum saque pendente
                    </p>
                    <p className="text-sm text-brand-muted-foreground">
                      Todos os saques foram processados
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-brand-muted dark:border-emerald-500/20 hover:bg-transparent">
                        <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Seller</TableHead>
                        <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor</TableHead>
                        <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Chave PIX</TableHead>
                        <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Data/Hora</TableHead>
                        <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingWithdrawals.map((withdrawal: any) => (
                        <TableRow key={withdrawal.id} className="border-brand-muted dark:border-emerald-500/20">
                          <TableCell>
                            <div className="font-medium text-foreground">{withdrawal.sellerName || "N/A"}</div>
                            <div className="text-sm text-brand-muted-foreground">{withdrawal.sellerEmail || "N/A"}</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-foreground">
                              R$ {((withdrawal.amount || 0) / 100).toFixed(2)}
                            </div>
                            {withdrawal.fee > 0 && (
                              <div className="text-sm text-brand-muted-foreground">
                                Taxa: R$ {((withdrawal.fee || 0) / 100).toFixed(2)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-brand-muted-foreground dark:text-gray-400">
                            {withdrawal.pixData?.pixKey || withdrawal.pixKey || "N/A"}
                          </TableCell>
                          <TableCell className="text-sm text-brand-muted-foreground dark:text-gray-400">
                            {formatSafeDate(withdrawal.requestedAt || withdrawal.createdAt, "dd/MM/yyyy HH:mm")}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Dialog 
                                open={isDialogOpen && selectedWithdrawal?.id === withdrawal.id}
                                onOpenChange={(open) => {
                                  setIsDialogOpen(open);
                                  if (!open) {
                                    setSelectedWithdrawal(null);
                                    setRejectionReason("");
                                    setIsRejectDialogOpen(false);
                                  }
                                }}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedWithdrawal(withdrawal);
                                      setIsDialogOpen(true);
                                    }}
                                    className="border-brand-muted dark:border-emerald-500/20"
                                  >
                                    <Eye className="w-4 h-4 mr-1.5" />
                                    Revisar
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl">
                                  <DialogHeader>
                                    <DialogTitle className="text-xl font-semibold">Detalhes do Saque</DialogTitle>
                                    <DialogDescription className="text-sm text-brand-muted-foreground">
                                      Revise as informações antes de aprovar ou rejeitar
                                    </DialogDescription>
                                  </DialogHeader>
                                  
                                  {selectedWithdrawal && (
                                    <div className="space-y-6">
                                      <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-1">
                                          <label className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Seller</label>
                                          <p className="text-base font-medium text-foreground">{selectedWithdrawal.sellerName || "N/A"}</p>
                                          <p className="text-sm text-brand-muted-foreground">{selectedWithdrawal.sellerEmail || "N/A"}</p>
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Data/Hora</label>
                                          <p className="text-base font-medium text-foreground">{formatSafeDate(selectedWithdrawal.requestedAt || selectedWithdrawal.createdAt, "dd/MM/yyyy HH:mm")}</p>
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor Bruto</label>
                                          <p className="text-2xl font-semibold text-foreground">R$ {((selectedWithdrawal.amount || 0) / 100).toFixed(2)}</p>
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor Líquido</label>
                                          <p className="text-2xl font-semibold text-foreground">R$ {((selectedWithdrawal.netAmount || 0) / 100).toFixed(2)}</p>
                                        </div>
                                        <div className="col-span-2 space-y-1">
                                          <label className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Chave PIX</label>
                                          <p className="text-base font-mono bg-brand-subtle dark:bg-card p-3 rounded-lg border border-brand-muted dark:border-emerald-500/20">
                                            {selectedWithdrawal.pixData?.pixKey || selectedWithdrawal.pixKey || "N/A"}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="bg-brand-subtle dark:bg-card p-4 rounded-lg border border-brand-muted dark:border-emerald-500/20">
                                        <h4 className="font-medium text-foreground mb-3 text-sm">Transferência PIX</h4>
                                        <div className="text-sm text-brand-muted-foreground dark:text-gray-400 space-y-2">
                                          <div className="mt-2 space-y-1">
                                            <div><span className="font-medium text-foreground">Destino:</span> <span className="font-mono">{selectedWithdrawal.pixData?.pixKey || selectedWithdrawal.pixKey || "N/A"}</span></div>
                                            <div><span className="font-medium text-foreground">Valor líquido:</span> R$ {((selectedWithdrawal.netAmount || selectedWithdrawal.amount || 0) / 100).toFixed(2)}</div>
                                          </div>
                                          <p className="text-xs text-brand-muted-foreground mt-2">Realize a transferência PIX manualmente e então aprove o saque.</p>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  <DialogFooter className="gap-2">
                                    <Dialog 
                                      open={isRejectDialogOpen}
                                      onOpenChange={(open) => {
                                        setIsRejectDialogOpen(open);
                                        if (!open) {
                                          setRejectionReason("");
                                        }
                                      }}
                                    >
                                      <DialogTrigger asChild>
                                        <Button 
                                          variant="outline" 
                                          className="border-brand-muted dark:border-emerald-500/20"
                                          onClick={() => setIsRejectDialogOpen(true)}
                                        >
                                          <XCircle className="w-4 h-4 mr-2" />
                                          Rejeitar
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle>Rejeitar Saque</DialogTitle>
                                          <DialogDescription>
                                            Informe o motivo da rejeição para o seller
                                          </DialogDescription>
                                        </DialogHeader>
                                        <Textarea
                                          placeholder="Ex: Dados bancários inválidos, saldo insuficiente..."
                                          value={rejectionReason}
                                          onChange={(e) => setRejectionReason(e.target.value)}
                                          className="min-h-[100px]"
                                        />
                                        <DialogFooter>
                                          <Button
                                            variant="outline"
                                            onClick={() => {
                                              if (selectedWithdrawal) {
                                                rejectMutation.mutate({
                                                  withdrawalId: selectedWithdrawal.id,
                                                  reason: rejectionReason
                                                });
                                              }
                                            }}
                                            disabled={!rejectionReason.trim() || rejectMutation.isPending}
                                            className="border-brand-muted dark:border-emerald-500/20"
                                          >
                                            Confirmar Rejeição
                                          </Button>
                                        </DialogFooter>
                                      </DialogContent>
                                    </Dialog>

                                    <Button
                                      onClick={() => {
                                        if (selectedWithdrawal) {
                                          approveMutation.mutate(selectedWithdrawal.id);
                                        }
                                      }}
                                      disabled={!selectedWithdrawal || approveMutation.isPending}
                                      className="bg-gray-900 hover:bg-gray-800 text-white dark:bg-white dark:text-foreground dark:hover:bg-brand-subtle"
                                    >
                                      <CheckCircle className="w-4 h-4 mr-2" />
                                      {approveMutation.isPending ? "Aprovando..." : "Aprovar Saque"}
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
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
          </TabsContent>

          {/* ABA PROCESSANDO */}
          <TabsContent value="processing">
            <Card className="border-brand-muted dark:border-emerald-500/20">
              <CardHeader className="border-b border-brand-muted dark:border-emerald-500/20">
                <CardTitle className="text-lg font-semibold text-foreground">Saques em Processamento</CardTitle>
                <CardDescription className="text-sm text-brand-muted-foreground">
                  Saques aprovados aguardando confirmação da transferência
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-brand-muted dark:border-emerald-500/20 hover:bg-transparent">
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Seller</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Chave PIX</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Aprovado em</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processingWithdrawals.map((withdrawal: any) => (
                      <TableRow key={withdrawal.id} className="border-brand-muted dark:border-emerald-500/20">
                        <TableCell>
                          <div className="font-medium text-foreground">{withdrawal.sellerName || "N/A"}</div>
                          <div className="text-sm text-brand-muted-foreground">{withdrawal.sellerEmail || "N/A"}</div>
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">
                          R$ {((withdrawal.netAmount || 0) / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-brand-muted-foreground dark:text-gray-400">
                          {withdrawal.pixData?.pixKey || withdrawal.pixKey || "N/A"}
                        </TableCell>
                        <TableCell className="text-sm text-brand-muted-foreground dark:text-gray-400">
                          {formatSafeDate(withdrawal.approvedAt || withdrawal.reviewedAt, "dd/MM/yyyy HH:mm")}
                        </TableCell>
                        <TableCell>
                          {withdrawal.pixTransferStatus === 'sent' ? (
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle className="w-3 h-3 mr-1.5" />
                              PIX Enviado
                            </Badge>
                          ) : withdrawal.pixTransferStatus === 'failed' ? (
                            <Badge variant="outline" className="border-red-500/40 text-red-500">
                              <XCircle className="w-3 h-3 mr-1.5" />
                              PIX Falhou
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-brand-muted dark:border-emerald-500/20 text-foreground">
                              <TrendingUp className="w-3 h-3 mr-1.5" />
                              Processando
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA FINALIZADOS */}
          <TabsContent value="completed">
            <Card className="border-brand-muted dark:border-emerald-500/20">
              <CardHeader className="border-b border-brand-muted dark:border-emerald-500/20">
                <CardTitle className="text-lg font-semibold text-foreground">Saques Finalizados</CardTitle>
                <CardDescription className="text-sm text-brand-muted-foreground">
                  Histórico de saques aprovados e rejeitados
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-brand-muted dark:border-emerald-500/20 hover:bg-transparent">
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Seller</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Chave PIX</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Data/Hora</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedWithdrawals.map((withdrawal: any) => (
                      <TableRow key={withdrawal.id} className="border-brand-muted dark:border-emerald-500/20">
                        <TableCell>
                          <div className="font-medium text-foreground">{withdrawal.sellerName || "N/A"}</div>
                          <div className="text-sm text-brand-muted-foreground">{withdrawal.sellerEmail || "N/A"}</div>
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">
                          R$ {((withdrawal.netAmount || withdrawal.amount || 0) / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-brand-muted-foreground dark:text-gray-400">
                          {withdrawal.pixData?.pixKey || withdrawal.pixKey || "N/A"}
                        </TableCell>
                        <TableCell>
                          {withdrawal.status === "approved" ? (
                            <Badge variant="outline" className="border-brand-muted dark:border-emerald-500/20 text-foreground">
                              <CheckCircle className="w-3 h-3 mr-1.5" />
                              Aprovado
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-brand-muted dark:border-emerald-500/20 text-brand-muted-foreground dark:text-gray-400">
                              <XCircle className="w-3 h-3 mr-1.5" />
                              Rejeitado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-brand-muted-foreground dark:text-gray-400">
                          {formatSafeDate(
                            withdrawal.status === "approved" ? (withdrawal.approvedAt || withdrawal.reviewedAt) : (withdrawal.rejectedAt || withdrawal.reviewedAt),
                            "dd/MM/yyyy HH:mm"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          {/* ABA USDT - Saques em Cripto */}
          <TabsContent value="usdt">
            <Card className="border-amber-200 dark:border-amber-500/20">
              <CardHeader className="border-b border-amber-200 dark:border-amber-500/20">
                <div className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-amber-600" />
                  <div>
                    <CardTitle className="text-lg font-semibold text-foreground">Saques em USDT</CardTitle>
                    <CardDescription className="text-sm text-brand-muted-foreground">
                      Solicitações de saque em criptomoeda dos sellers. Aprove após realizar a transferência manual.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingCrypto ? (
                  <div className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-brand-muted-foreground">Carregando...</p>
                  </div>
                ) : pendingCryptoWithdrawals.length === 0 ? (
                  <div className="text-center py-12 px-6">
                    <Coins className="h-10 w-10 text-brand-muted-foreground mx-auto mb-3 opacity-40" />
                    <p className="text-base font-medium text-foreground mb-1">Nenhum saque USDT pendente</p>
                    <p className="text-sm text-brand-muted-foreground">Todos os saques foram processados</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-amber-200 dark:border-amber-500/20 hover:bg-transparent">
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Seller</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor BRL</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor USDT</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Carteira</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Data</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingCryptoWithdrawals.map((cw: any) => (
                          <TableRow key={cw.id} className="border-amber-100 dark:border-amber-500/10">
                            <TableCell>
                              <div className="font-medium text-foreground">{cw.sellerName || "N/A"}</div>
                              <div className="text-sm text-brand-muted-foreground">{cw.sellerEmail || "N/A"}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-semibold text-foreground">R$ {((cw.amountBRL || 0) / 100).toFixed(2)}</div>
                            </TableCell>
                            <TableCell>
                              <div className="font-semibold text-amber-600">{(cw.usdtAmount || 0).toFixed(2)} USDT</div>
                              {cw.usdRate > 0 && (
                                <div className="text-xs text-brand-muted-foreground">Cotação: R$ {cw.usdRate.toFixed(2)}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="font-mono text-xs text-brand-muted-foreground max-w-[160px] truncate" title={cw.walletAddress}>
                                {cw.walletAddress || "N/A"}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-brand-muted-foreground">
                              {formatSafeDate(cw.requestedAt || cw.createdAt, "dd/MM/yyyy HH:mm")}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-amber-300 text-amber-700 hover:bg-amber-50"
                                onClick={() => { setSelectedCrypto(cw); setIsCryptoDialogOpen(true); }}
                              >
                                <Eye className="w-4 h-4 mr-1.5" />
                                Revisar
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Histórico cripto */}
                {completedCryptoWithdrawals.length > 0 && (
                  <div className="border-t border-amber-100 dark:border-amber-500/10 p-4">
                    <p className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide mb-3">Histórico</p>
                    <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-amber-100 dark:border-amber-500/10 hover:bg-transparent">
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Seller</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Valor BRL</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">USDT</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Carteira</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Solicitado em</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Processado em</TableHead>
                          <TableHead className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {completedCryptoWithdrawals.slice(0, 20).map((cw: any) => (
                          <TableRow key={cw.id} className="border-amber-100/50">
                            <TableCell>
                              <div className="text-sm font-medium text-foreground">{cw.sellerName || "N/A"}</div>
                              <div className="text-xs text-brand-muted-foreground">{cw.sellerEmail}</div>
                            </TableCell>
                            <TableCell className="text-sm font-semibold">R$ {((cw.amountBRL || 0) / 100).toFixed(2)}</TableCell>
                            <TableCell className="text-sm text-amber-600 font-medium">{(cw.usdtAmount || 0).toFixed(2)} USDT</TableCell>
                            <TableCell>
                              <div className="font-mono text-xs text-brand-muted-foreground max-w-[120px] truncate" title={cw.walletAddress}>
                                {cw.walletAddress || "N/A"}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-brand-muted-foreground">
                              {formatSafeDate(cw.requestedAt || cw.createdAt, "dd/MM/yyyy HH:mm")}
                            </TableCell>
                            <TableCell className="text-xs text-brand-muted-foreground">
                              {formatSafeDate(cw.approvedAt || cw.rejectedAt, "dd/MM/yyyy HH:mm")}
                            </TableCell>
                            <TableCell>
                              {cw.status === 'approved' ? (
                                <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                                  <CheckCircle className="w-3 h-3 mr-1" />Aprovado
                                </Badge>
                              ) : (
                                <div>
                                  <Badge variant="outline" className="text-red-500 border-red-300">
                                    <XCircle className="w-3 h-3 mr-1" />Rejeitado
                                  </Badge>
                                  {cw.rejectionReason && (
                                    <div className="text-[10px] text-brand-muted-foreground mt-0.5 max-w-[120px] truncate" title={cw.rejectionReason}>
                                      {cw.rejectionReason}
                                    </div>
                                  )}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Modal de revisão do saque cripto */}
            <Dialog open={isCryptoDialogOpen} onOpenChange={(open) => { setIsCryptoDialogOpen(open); if (!open) setSelectedCrypto(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Coins className="h-5 w-5 text-amber-600" />
                    Saque em USDT - Revisão
                  </DialogTitle>
                  <DialogDescription>Realize a transferência manual e depois clique em Aprovar</DialogDescription>
                </DialogHeader>

                {selectedCrypto && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide mb-1">Seller</p>
                        <p className="text-sm font-semibold">{selectedCrypto.sellerName || "N/A"}</p>
                        <p className="text-xs text-brand-muted-foreground">{selectedCrypto.sellerEmail}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide mb-1">Data</p>
                        <p className="text-sm">{formatSafeDate(selectedCrypto.requestedAt, "dd/MM/yyyy HH:mm")}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide mb-1">Valor em BRL</p>
                        <p className="text-2xl font-bold text-foreground">R$ {((selectedCrypto.amountBRL || 0) / 100).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide mb-1">Equivalente em USDT</p>
                        <p className="text-2xl font-bold text-amber-600">{(selectedCrypto.usdtAmount || 0).toFixed(2)} USDT</p>
                        <p className="text-xs text-brand-muted-foreground">Cotação: R$ {(selectedCrypto.usdRate || 0).toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <p className="text-xs font-medium text-brand-muted-foreground uppercase tracking-wide mb-1">Endereço da Carteira</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm font-mono bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-md p-2.5 break-all">
                          {selectedCrypto.walletAddress}
                        </code>
                        <Button
                          size="icon"
                          variant="outline"
                          className="shrink-0 border-amber-200"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedCrypto.walletAddress);
                            toast({ title: "Copiado!", description: "Endereço da carteira copiado." });
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-md p-3">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-1.5">Instruções para transferência manual:</p>
                      <ol className="text-xs text-amber-700 dark:text-amber-500 space-y-1 list-decimal list-inside">
                        <li>Acesse sua exchange ou carteira cripto</li>
                        <li>Envie <strong>{(selectedCrypto.usdtAmount || 0).toFixed(2)} USDT</strong> para o endereço acima</li>
                        <li>Após confirmar o envio, clique em <strong>Aprovar</strong> - o saldo já foi reservado na solicitação</li>
                        <li>Se não conseguir enviar, clique em <strong>Rejeitar</strong> para devolver o saldo ao seller</li>
                      </ol>
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => setIsCryptoRejectDialogOpen(true)}
                    disabled={rejectCryptoMutation.isPending}
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Rejeitar
                  </Button>
                  <Button
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => { if (selectedCrypto) approveCryptoMutation.mutate(selectedCrypto.id); }}
                    disabled={approveCryptoMutation.isPending || !selectedCrypto}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {approveCryptoMutation.isPending ? "Aprovando..." : "Aprovar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

        </Tabs>
      </div>

      {/* Dialog de rejeição de saque cripto com campo de motivo */}
      <Dialog open={isCryptoRejectDialogOpen} onOpenChange={(open) => {
        setIsCryptoRejectDialogOpen(open);
        if (!open) setCryptoRejectReason("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Saque USDT</DialogTitle>
            <DialogDescription>
              O valor será devolvido ao saldo disponível do seller automaticamente.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Ex: Endereço de carteira inválido, saldo insuficiente na exchange..."
            value={cryptoRejectReason}
            onChange={(e) => setCryptoRejectReason(e.target.value)}
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setIsCryptoRejectDialogOpen(false); setCryptoRejectReason(""); }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedCrypto) {
                  rejectCryptoMutation.mutate({ id: selectedCrypto.id, reason: cryptoRejectReason || "Rejeitado pelo admin" });
                }
              }}
              disabled={rejectCryptoMutation.isPending}
            >
              <XCircle className="w-4 h-4 mr-2" />
              {rejectCryptoMutation.isPending ? "Rejeitando..." : "Confirmar Rejeição"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  );
}
