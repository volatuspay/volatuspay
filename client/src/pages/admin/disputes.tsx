import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCw, CheckCircle, Clock, XCircle, CreditCard, Smartphone, Building2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { auth } from "@/lib/firebase";
import { getBrowserId } from "@/lib/browser-session";

interface UnifiedDispute {
  id: string;
  gateway: 'stripe' | 'efibank' | 'woovi';
  type: 'dispute' | 'chargeback' | 'refund' | 'med';
  status: string;
  amount: number;
  currency: string;
  reason?: string;
  orderId?: string;
  paymentIntentId?: string;
  customerEmail?: string;
  customerName?: string;
  createdAt: string;
  updatedAt?: string;
  dueDate?: string;
  rawData: any;
}

interface DisputeSummary {
  totalDisputes: number;
  totalAmount: number;
  byGateway: Record<string, number>;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

const gatewayIcons: Record<string, any> = {
  stripe: CreditCard,
  woovi: Smartphone,
  efibank: Building2,
  pagbank: CreditCard,
  mercadopago: CreditCard,
  pagarme: CreditCard,
};

const gatewayColors: Record<string, string> = {
  stripe: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  woovi: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  efibank: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  pagbank: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  mercadopago: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  pagarme: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
};

const statusColors: Record<string, string> = {
  needs_response: 'bg-red-500/10 text-red-600 dark:text-red-400',
  warning_needs_response: 'bg-red-500/10 text-red-600 dark:text-red-400',
  under_review: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  warning_under_review: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  won: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  lost: 'bg-red-500/10 text-red-600 dark:text-red-400',
  charge_refunded: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  PENDING: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  COMPLETED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  FAILED: 'bg-red-500/10 text-red-600 dark:text-red-400',
  completed: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  partial: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
};

const typeLabels: Record<string, string> = {
  dispute: 'Disputa',
  chargeback: 'Chargeback',
  refund: 'Devolucao',
  med: 'MED PIX',
};

export default function AdminDisputes() {
  const { toast } = useToast();
  const [disputes, setDisputes] = useState<UnifiedDispute[]>([]);
  const [summary, setSummary] = useState<DisputeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<UnifiedDispute | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [days, setDays] = useState('30');
  const [gatewayFilter, setGatewayFilter] = useState<string>('all');

  useEffect(() => {
    loadDisputes();
    loadSummary();
  }, [days]);

  const loadDisputes = async () => {
    try {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) return;
      
      const token = await user.getIdToken();
      const gateways = gatewayFilter !== 'all' ? `&gateways=${gatewayFilter}` : '';
      const response = await fetch(`/api/admin/disputes?days=${days}${gateways}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': getBrowserId()
        },
        credentials: 'include'
      });

      if (!response.ok) throw new Error('Erro ao carregar disputas');

      const data = await response.json();
      setDisputes(data.disputes || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar disputas",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/disputes/summary?days=${days}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': getBrowserId()
        },
        credentials: 'include'
      });

      if (!response.ok) return;
      const data = await response.json();
      setSummary(data);
    } catch (error) {
      console.error('Erro ao carregar resumo:', error);
    }
  };

  const handleScan = async () => {
    try {
      setScanning(true);
      const user = auth.currentUser;
      if (!user) return;
      
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/disputes/scan', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': getBrowserId(),
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ days: parseInt(days) })
      });

      if (!response.ok) throw new Error('Erro ao escanear disputas');

      const data = await response.json();
      toast({
        title: "Scan concluido",
        description: `${data.totalDisputes} disputas encontradas, ${data.newAlerts} novos alertas criados.`,
      });

      loadDisputes();
      loadSummary();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao escanear",
        description: error.message,
      });
    } finally {
      setScanning(false);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    const value = amount / 100;
    if (currency === 'BRL') {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredDisputes = gatewayFilter === 'all' 
    ? disputes 
    : disputes.filter(d => d.gateway === gatewayFilter);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">MEDs e Disputas</h1>
          <p className="text-muted-foreground">
            Acompanhe chargebacks, MEDs PIX e disputas de todos os gateways
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-32" data-testid="select-days">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="60">60 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Select value={gatewayFilter} onValueChange={setGatewayFilter}>
            <SelectTrigger className="w-36" data-testid="select-gateway">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="stripe">Stripe</SelectItem>
              <SelectItem value="woovi">Woovi</SelectItem>
              <SelectItem value="efibank">EfiBank</SelectItem>
              <SelectItem value="pagbank">PagBank</SelectItem>
              <SelectItem value="mercadopago">MercadoPago</SelectItem>
              <SelectItem value="pagarme">Pagar.me</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleScan} disabled={scanning} data-testid="button-scan">
            <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Escaneando...' : 'Escanear'}
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">Total de Disputas</CardTitle>
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-total-disputes">
                {summary.totalDisputes}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">Valor Total</CardTitle>
              <CreditCard className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" data-testid="text-total-amount">
                {formatCurrency(summary.totalAmount, 'BRL')}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">Por Gateway</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {Object.entries(summary.byGateway).map(([gateway, count]) => (
                  <Badge key={gateway} variant="secondary" className={gatewayColors[gateway]}>
                    {gateway}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">Por Tipo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {Object.entries(summary.byType).map(([type, count]) => (
                  <Badge key={type} variant="secondary">
                    {typeLabels[type] || type}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lista de Disputas</CardTitle>
          <CardDescription>
            Disputas e MEDs dos ultimos {days} dias
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredDisputes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
              <p className="text-lg font-medium">Nenhuma disputa encontrada</p>
              <p className="text-sm">Sem MEDs ou chargebacks no periodo selecionado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDisputes.map((dispute) => {
                const GatewayIcon = gatewayIcons[dispute.gateway] || CreditCard;
                return (
                  <div
                    key={dispute.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-md border hover-elevate"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-md ${gatewayColors[dispute.gateway]}`}>
                        <GatewayIcon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className={gatewayColors[dispute.gateway]}>
                            {dispute.gateway.toUpperCase()}
                          </Badge>
                          <Badge variant="secondary">
                            {typeLabels[dispute.type] || dispute.type}
                          </Badge>
                          <Badge variant="secondary" className={statusColors[dispute.status] || ''}>
                            {dispute.status}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium mt-1 truncate">
                          {dispute.customerName || dispute.customerEmail || dispute.orderId || dispute.id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dispute.reason || 'Sem motivo especificado'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(dispute.createdAt)}
                          {dispute.dueDate && (
                            <span className="ml-2 text-red-500">
                              Prazo: {formatDate(dispute.dueDate)}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-lg font-bold tabular-nums">
                          {formatCurrency(dispute.amount, dispute.currency)}
                        </p>
                        <p className="text-xs text-muted-foreground">{dispute.currency}</p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setSelectedDispute(dispute);
                          setShowDetails(true);
                        }}
                        data-testid={`button-view-${dispute.id}`}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da Disputa</DialogTitle>
            <DialogDescription>
              Informacoes completas sobre a disputa ou MED
            </DialogDescription>
          </DialogHeader>
          {selectedDispute && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">ID</p>
                  <p className="font-mono text-sm">{selectedDispute.id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Gateway</p>
                  <Badge className={gatewayColors[selectedDispute.gateway]}>
                    {selectedDispute.gateway.toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tipo</p>
                  <p>{typeLabels[selectedDispute.type] || selectedDispute.type}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge className={statusColors[selectedDispute.status]}>
                    {selectedDispute.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Valor</p>
                  <p className="text-xl font-bold tabular-nums">
                    {formatCurrency(selectedDispute.amount, selectedDispute.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Data</p>
                  <p>{formatDate(selectedDispute.createdAt)}</p>
                </div>
                {selectedDispute.orderId && (
                  <div>
                    <p className="text-sm text-muted-foreground">Pedido</p>
                    <p className="font-mono text-sm">{selectedDispute.orderId}</p>
                  </div>
                )}
                {selectedDispute.customerEmail && (
                  <div>
                    <p className="text-sm text-muted-foreground">Cliente</p>
                    <p>{selectedDispute.customerEmail}</p>
                  </div>
                )}
                {selectedDispute.reason && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Motivo</p>
                    <p>{selectedDispute.reason}</p>
                  </div>
                )}
                {selectedDispute.dueDate && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Prazo para Resposta</p>
                    <p className="text-red-500 font-medium">{formatDate(selectedDispute.dueDate)}</p>
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Dados Brutos (JSON)</p>
                <pre className="p-3 bg-muted rounded-md text-xs overflow-x-auto max-h-48">
                  {JSON.stringify(selectedDispute.rawData, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </DashboardLayout>
  );
}
