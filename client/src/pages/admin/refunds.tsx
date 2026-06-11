import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, DollarSign, User, Package } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { auth } from "@/lib/firebase";
import { getBrowserId } from "@/lib/browser-session";

interface Refund {
  id: string;
  orderId: string;
  customerId: string;
  customerEmail?: string;
  sellerId: string;
  sellerEmail?: string;
  productId: string;
  productName?: string;
  amount: number;
  currency: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: any;
  approvedAt?: any;
  rejectedAt?: any;
  approvedBy?: string;
}

export default function AdminRefunds() {
  const { toast } = useToast();
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [selectedRefund, setSelectedRefund] = useState<Refund | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    loadRefunds();
  }, []);

  const loadRefunds = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) return;
      
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/refunds', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': getBrowserId()
        },
        credentials: 'include'
      });

      if (!response.ok) throw new Error('Erro ao carregar reembolsos');

      const data = await response.json();
      setRefunds(data.refunds || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar reembolsos",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAction = (refund: Refund, type: 'approve' | 'reject') => {
    setSelectedRefund(refund);
    setActionType(type);
    setRejectionReason('');
    setShowDialog(true);
  };

  const confirmAction = async () => {
    if (!selectedRefund) return;

    try {
      setProcessing(selectedRefund.id);
      const user = auth.currentUser;
      if (!user) return;
      
      const token = await user.getIdToken();
      const endpoint = actionType === 'approve' 
        ? `/api/admin/refunds/${selectedRefund.id}/approve`
        : `/api/admin/refunds/${selectedRefund.id}/reject`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': getBrowserId(),
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ reason: rejectionReason })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao processar reembolso');
      }

      toast({
        title: actionType === 'approve' ? "Reembolso aprovado!" : "Reembolso rejeitado",
        description: actionType === 'approve' 
          ? "O saldo do seller foi debitado e o acesso do membro foi bloqueado."
          : "O pedido de reembolso foi rejeitado.",
      });

      setShowDialog(false);
      loadRefunds();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: error.message,
      });
    } finally {
      setProcessing(null);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'BRL',
    }).format(amount / 100);
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const pendingRefunds = refunds.filter(r => r.status === 'pending');
  const processedRefunds = refunds.filter(r => r.status !== 'pending');

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Carregando reembolsos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <DollarSign className="w-8 h-8" />
          Gerenciar Reembolsos
        </h1>
        <p className="text-muted-foreground mt-1">
          Aprovar ou rejeitar solicitações de reembolso de membros
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-500" />
              Pendentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingRefunds.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Aprovados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {refunds.filter(r => r.status === 'approved').length}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              Rejeitados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {refunds.filter(r => r.status === 'rejected').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pendentes */}
      <Card>
        <CardHeader>
          <CardTitle>Reembolsos Pendentes</CardTitle>
          <CardDescription>Aguardando sua aprovação</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingRefunds.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Nenhum reembolso pendente
            </p>
          ) : (
            <div className="space-y-4">
              {pendingRefunds.map((refund) => (
                <Card key={refund.id} className="border-yellow-500/30">
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{refund.productName || 'Produto'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            Cliente: {refund.customerEmail || refund.customerId}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-muted-foreground" />
                          <span className="font-bold text-lg">
                            {formatCurrency(refund.amount, refund.currency)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Solicitado em: {formatDate(refund.requestedAt)}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="text-sm">
                          <span className="font-medium">Motivo:</span>
                          <p className="text-muted-foreground mt-1">{refund.reason}</p>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Seller: {refund.sellerEmail || refund.sellerId}
                        </div>
                        <div className="text-sm text-muted-foreground font-mono">
                          ID: {refund.id.substring(0, 12)}...
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleAction(refund, 'approve')}
                        disabled={processing === refund.id}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleAction(refund, 'reject')}
                        disabled={processing === refund.id}
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Rejeitar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Processados */}
      {processedRefunds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico</CardTitle>
            <CardDescription>Reembolsos já processados</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {processedRefunds.slice(0, 10).map((refund) => (
                <div
                  key={refund.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex-1">
                    <div className="font-medium">{refund.productName || 'Produto'}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatCurrency(refund.amount, refund.currency)} • {formatDate(refund.requestedAt)}
                    </div>
                  </div>
                  <Badge variant={refund.status === 'approved' ? 'default' : 'destructive'}>
                    {refund.status === 'approved' ? 'Aprovado' : 'Rejeitado'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog de Confirmação */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === 'approve' ? 'Aprovar Reembolso' : 'Rejeitar Reembolso'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'approve' 
                ? 'O saldo do seller será debitado e o acesso do membro será bloqueado.'
                : 'O pedido de reembolso será rejeitado e o membro manterá o acesso.'}
            </DialogDescription>
          </DialogHeader>

          {selectedRefund && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm">
                  <span className="font-medium">Produto:</span> {selectedRefund.productName}
                </div>
                <div className="text-sm">
                  <span className="font-medium">Valor:</span> {formatCurrency(selectedRefund.amount, selectedRefund.currency)}
                </div>
                <div className="text-sm">
                  <span className="font-medium">Motivo do cliente:</span>
                  <p className="text-muted-foreground mt-1">{selectedRefund.reason}</p>
                </div>
              </div>

              {actionType === 'reject' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Motivo da rejeição (opcional)</label>
                  <Textarea
                    placeholder="Explique por que o reembolso foi rejeitado..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    rows={3}
                  />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  Cancelar
                </Button>
                <Button
                  variant={actionType === 'approve' ? 'default' : 'destructive'}
                  onClick={confirmAction}
                  disabled={!!processing}
                >
                  {actionType === 'approve' ? 'Confirmar Aprovação' : 'Confirmar Rejeição'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
