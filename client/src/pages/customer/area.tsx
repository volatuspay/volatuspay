import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  LogOut, 
  Package, 
  CreditCard, 
  RefreshCw,
  Calendar,
  DollarSign,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  AlertCircle,
  MoreVertical,
  ShoppingCart
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
const volatuspayMembersLogo = "";

interface Purchase {
  id: string;
  orderId: string;
  productId: string;
  productTitle: string;
  amount: number;
  status: string;
  paymentMethod: string;
  purchaseDate: Date;
}

interface MemberEntitlement {
  id: string;
  productId: string;
  productTitle: string;
  accessStartDate: Date;
  accessEndDate: Date | null;
  billingCycle: string;
  status: string;
}

interface RefundRequest {
  id: string;
  orderId: string;
  productTitle: string;
  requestAmount: number;
  reason: string;
  status: string;
  requestDate: Date;
  responseDate: Date | null;
  responseReason: string | null;
}

export default function CustomerAreaPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [customerEmail, setCustomerEmail] = useState<string>("");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [entitlements, setEntitlements] = useState<MemberEntitlement[]>([]);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'products' | 'purchases' | 'refunds'>('products');
  
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundLoading, setRefundLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        toast({
          variant: "destructive",
          title: "Sessão expirada",
          description: "Faça login novamente",
        });
        setLocation('/customer-login');
        return;
      }
      
      setCustomerEmail(user.email || "");
      await loadCustomerData();
    });

    return () => unsubscribe();
  }, []);

  const getAuthToken = async (): Promise<string | null> => {
    const user = auth.currentUser;
    if (!user) {
      toast({
        variant: "destructive",
        title: "Sessão expirada",
        description: "Faça login novamente",
      });
      setLocation('/customer-login');
      return null;
    }
    
    return await user.getIdToken();
  };

  const loadCustomerData = async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      const purchasesRes = await fetch('/api/customers/me/purchases', { headers });
      if (purchasesRes.ok) {
        const purchases = await purchasesRes.json();
        setPurchases(purchases || []);
      }

      const entitlementsRes = await fetch('/api/customers/me/entitlements', { headers });
      if (entitlementsRes.ok) {
        const entitlements = await entitlementsRes.json();
        setEntitlements(entitlements || []);
      }

      const refundsRes = await fetch('/api/customers/me/refund-requests', { headers });
      if (refundsRes.ok) {
        const requests = await refundsRes.json();
        setRefundRequests(requests || []);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast({
        variant: "destructive",
        title: "Erro ao carregar dados",
        description: "Tente novamente em alguns instantes",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setLocation('/customer-login');
  };

  const openRefundDialog = (purchase: Purchase) => {
    setSelectedPurchase(purchase);
    setRefundAmount((purchase.amount / 100).toFixed(2));
    setRefundReason("");
    setRefundDialogOpen(true);
  };

  const handleRefundRequest = async () => {
    if (!selectedPurchase || !refundReason.trim() || !refundAmount) {
      toast({
        variant: "destructive",
        title: "Campos obrigatórios",
        description: "Preencha todos os campos",
      });
      return;
    }

    const amount = parseFloat(refundAmount);
    const maxAmountReais = selectedPurchase.amount / 100;
    if (isNaN(amount) || amount <= 0 || amount > maxAmountReais) {
      toast({
        variant: "destructive",
        title: "Valor inválido",
        description: `O valor deve ser entre R$ 0,01 e R$ ${maxAmountReais.toFixed(2)}`,
      });
      return;
    }

    setRefundLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      const response = await fetch('/api/customers/me/refund-requests', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          orderId: selectedPurchase.orderId,
          amount: Math.round(amount * 100),
          reason: refundReason,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erro ao solicitar reembolso');
      }

      toast({
        title: "Solicitação enviada!",
        description: "Seu pedido de reembolso foi registrado e será analisado em breve.",
      });

      setRefundDialogOpen(false);
      await loadCustomerData();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao solicitar reembolso",
        description: error.message,
      });
    } finally {
      setRefundLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
      paid: { variant: "default", icon: CheckCircle2 },
      pending: { variant: "secondary", icon: Clock },
      cancelled: { variant: "destructive", icon: XCircle },
      refunded: { variant: "outline", icon: RefreshCw },
      approved: { variant: "default", icon: CheckCircle2 },
      denied: { variant: "destructive", icon: XCircle },
      completed: { variant: "outline", icon: CheckCircle2 },
    };
    
    const config = variants[status] || { variant: "secondary" as const, icon: AlertCircle };
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {status === 'paid' ? 'Pago' :
         status === 'pending' ? 'Pendente' :
         status === 'cancelled' ? 'Cancelado' :
         status === 'refunded' ? 'Reembolsado' :
         status === 'approved' ? 'Aprovado' :
         status === 'denied' ? 'Negado' :
         status === 'completed' ? 'Concluído' :
         status}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-violet-950/50 to-black">
        <div className="text-center space-y-4">
          <RefreshCw className="h-12 w-12 animate-spin text-violet-500 mx-auto" />
          <p className="text-white/70">Carregando seus dados...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-violet-950/40 to-black">
      {/* Header com Logo e Navegação */}
      <div className="border-b border-violet-500/20 bg-black/60 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <img src="/favicon.png?v=2" alt="VolatusPay" style={{ height: "36px", width: "36px", objectFit: "contain" }} />
            
            {/* Navegação Central */}
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={() => setActiveTab('products')}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  activeTab === 'products'
                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <Package className="h-4 w-4 inline-block mr-2" />
                Meus Produtos
              </button>
              <button
                onClick={() => setActiveTab('purchases')}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  activeTab === 'purchases'
                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <ShoppingCart className="h-4 w-4 inline-block mr-2" />
                Histórico de Compras
              </button>
              <button
                onClick={() => setActiveTab('refunds')}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  activeTab === 'refunds'
                    ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <RefreshCw className="h-4 w-4 inline-block mr-2" />
                Reembolsos
              </button>
            </div>

            {/* Logout e Email */}
            <div className="flex items-center gap-3">
              <span className="hidden sm:block text-sm text-white/60">{customerEmail}</span>
              <Button 
                variant="ghost" 
                onClick={handleLogout} 
                className="text-white/70 hover:text-white hover:bg-white/10 gap-2"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>

          {/* Navegação Mobile */}
          <div className="flex md:hidden items-center gap-2 mt-4 overflow-x-auto pb-2">
            <button
              onClick={() => setActiveTab('products')}
              className={`px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === 'products'
                  ? 'bg-violet-600 text-white'
                  : 'text-white/70 bg-white/5'
              }`}
            >
              Meus Produtos
            </button>
            <button
              onClick={() => setActiveTab('purchases')}
              className={`px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === 'purchases'
                  ? 'bg-violet-600 text-white'
                  : 'text-white/70 bg-white/5'
              }`}
            >
              Histórico
            </button>
            <button
              onClick={() => setActiveTab('refunds')}
              className={`px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === 'refunds'
                  ? 'bg-violet-600 text-white'
                  : 'text-white/70 bg-white/5'
              }`}
            >
              Reembolsos
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        
        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="space-y-4">
            {entitlements.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-violet-500/20 flex items-center justify-center">
                  <Package className="h-10 w-10 text-violet-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Nenhum produto disponível</h3>
                <p className="text-white/50 text-sm">
                  Compre produtos para ter acesso ao conteúdo exclusivo
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {entitlements.map((entitlement) => {
                  const isRefundRequested = (entitlement as any).status === 'refund_requested';
                  const isRefunded = (entitlement as any).status === 'refunded';
                  const isBlocked = isRefundRequested || isRefunded;
                  return (
                  <Card 
                    key={entitlement.id} 
                    className={`border transition-all backdrop-blur-sm ${isBlocked ? 'bg-yellow-500/5 border-yellow-500/20 cursor-default' : 'bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/15 cursor-pointer'}`}
                    onClick={() => !isBlocked && setLocation(`/customer-area/member/${entitlement.productId}`)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-white text-lg">{entitlement.productTitle}</h3>
                            {isRefundRequested && (
                              <Badge className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-xs">
                                Reembolso em Processo
                              </Badge>
                            )}
                            {isRefunded && (
                              <Badge className="bg-gray-500/20 text-gray-400 border border-gray-500/30 text-xs">
                                Reembolsado
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-3 text-sm text-white/60">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              Início: {new Date(entitlement.accessStartDate).toLocaleDateString('pt-BR')}
                            </div>
                            {entitlement.accessEndDate ? (
                              <div className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                Válido até: {new Date(entitlement.accessEndDate).toLocaleDateString('pt-BR')}
                              </div>
                            ) : !isBlocked ? (
                              <Badge className="bg-violet-600 text-white border-0">Acesso Vitalício</Badge>
                            ) : null}
                          </div>
                        </div>
                        {!isBlocked && (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation(`/customer-area/member/${entitlement.productId}`);
                            }}
                            className="bg-violet-600 hover:bg-violet-700 text-white gap-2 shadow-lg shadow-violet-500/20"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Acessar
                          </Button>
                        )}
                        {isRefundRequested && (
                          <Badge className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-3 py-1.5 text-sm">
                            Aguardando análise
                          </Badge>
                        )}
                        {isRefunded && (
                          <Badge className="bg-gray-500/10 text-gray-400 border border-gray-500/20 px-3 py-1.5 text-sm">
                            Acesso encerrado
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Purchases Tab */}
        {activeTab === 'purchases' && (
          <div className="space-y-4">
            {purchases.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-violet-500/20 flex items-center justify-center">
                  <ShoppingCart className="h-10 w-10 text-violet-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Nenhuma compra encontrada</h3>
                <p className="text-white/50 text-sm">
                  Suas compras aparecerão aqui
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {purchases.map((purchase) => (
                  <Card 
                    key={purchase.id} 
                    className="bg-violet-500/10 border-violet-500/20 backdrop-blur-sm"
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <h3 className="font-semibold text-white text-lg">{purchase.productTitle}</h3>
                          <div className="flex flex-wrap gap-4 text-sm text-white/60">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {new Date(purchase.purchaseDate).toLocaleDateString('pt-BR')}
                            </div>
                            <div className="flex items-center gap-1 text-violet-400">
                              <DollarSign className="h-3.5 w-3.5" />
                              R$ {(purchase.amount / 100).toFixed(2)}
                            </div>
                            <div className="flex items-center gap-1">
                              <CreditCard className="h-3.5 w-3.5" />
                              {purchase.paymentMethod === 'pix' ? 'PIX' :
                               purchase.paymentMethod === 'boleto' ? 'Boleto' :
                               purchase.paymentMethod}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(purchase.status)}
                          {purchase.status === 'paid' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-gray-900 border-violet-500/20">
                                <DropdownMenuItem
                                  onClick={() => openRefundDialog(purchase)}
                                  className="gap-2 text-orange-400 focus:text-orange-400 focus:bg-orange-500/10"
                                >
                                  <RefreshCw className="h-4 w-4" />
                                  Solicitar Reembolso
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Refunds Tab */}
        {activeTab === 'refunds' && (
          <div className="space-y-4">
            {refundRequests.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-violet-500/20 flex items-center justify-center">
                  <RefreshCw className="h-10 w-10 text-violet-400" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Nenhuma solicitação</h3>
                <p className="text-white/50 text-sm">
                  Suas solicitações de reembolso aparecerão aqui
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {refundRequests.map((request) => (
                  <Card 
                    key={request.id} 
                    className="bg-violet-500/10 border-violet-500/20 backdrop-blur-sm"
                  >
                    <CardContent className="p-5">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-1">
                            <h3 className="font-semibold text-white">{request.productTitle}</h3>
                            <div className="flex flex-wrap gap-4 text-sm text-white/60">
                              <div className="flex items-center gap-1">
                                <DollarSign className="h-3.5 w-3.5" />
                                R$ {request.requestAmount.toFixed(2)}
                              </div>
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                {new Date(request.requestDate).toLocaleDateString('pt-BR')}
                              </div>
                            </div>
                          </div>
                          {getStatusBadge(request.status)}
                        </div>
                        
                        <div className="pt-3 border-t border-violet-500/20">
                          <p className="text-sm font-medium text-white/80 mb-1">Motivo:</p>
                          <p className="text-sm text-white/60">{request.reason}</p>
                        </div>

                        {request.responseReason && (
                          <div className="pt-3 border-t border-violet-500/20 bg-violet-500/5 -mx-5 -mb-5 px-5 py-4 rounded-b-lg">
                            <p className="text-sm font-medium text-white/80 mb-1">Resposta do Vendedor:</p>
                            <p className="text-sm text-white/60">{request.responseReason}</p>
                            {request.responseDate && (
                              <p className="text-xs text-white/40 mt-2">
                                {new Date(request.responseDate).toLocaleDateString('pt-BR')}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Refund Request Dialog */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent className="max-w-md bg-gray-900 border-violet-500/20 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Solicitar Reembolso</DialogTitle>
            <DialogDescription className="text-white/60">
              Preencha os detalhes da sua solicitação de reembolso
            </DialogDescription>
          </DialogHeader>

          {selectedPurchase && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-violet-500/10 rounded-lg border border-violet-500/20 space-y-1">
                <p className="font-medium text-white">{selectedPurchase.productTitle}</p>
                <p className="text-sm text-white/60">
                  Valor pago: R$ {(selectedPurchase.amount / 100).toFixed(2)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="refundAmount" className="text-white">Valor do Reembolso (R$)</Label>
                <Input
                  id="refundAmount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(selectedPurchase.amount / 100)}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="0.00"
                  className="bg-black/50 border-violet-500/20 text-white"
                />
                <p className="text-xs text-white/50">
                  Valor máximo: R$ {(selectedPurchase.amount / 100).toFixed(2)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="refundReason" className="text-white">Motivo do Reembolso</Label>
                <Textarea
                  id="refundReason"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Explique o motivo da sua solicitação..."
                  rows={4}
                  className="bg-black/50 border-violet-500/20 text-white placeholder:text-white/30"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRefundDialogOpen(false)}
              disabled={refundLoading}
              className="border-violet-500/20 text-white hover:bg-white/10"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleRefundRequest}
              disabled={refundLoading}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {refundLoading ? "Enviando..." : "Enviar Solicitação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
