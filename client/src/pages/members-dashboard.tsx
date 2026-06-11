import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { resolveImageUrl } from "@/lib/image-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Play, BookOpen, MoreVertical, RefreshCw, Calendar, CreditCard, Package, LogOut, ShoppingCart, Clock, Hash, AlertTriangle, KeyRound, LayoutDashboard } from "lucide-react";
import { useLocation } from "wouter";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LogoThemed } from "@/components/ui/logo-themed";

interface Product {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  memberAreaId?: string;
  type: string;
  engagementPercent: number;
  completedLessons: number;
  totalLessons: number;
  enrolledAt: any;
}

interface Purchase {
  id: string;
  productId: string;
  productName: string;
  amount: number;
  currency: string;
  purchaseDate: any;
  paymentMethod: string;
  canRefund: boolean;
  status?: string;
}

export default function MembersDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<Purchase[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Purchase | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundDescription, setRefundDescription] = useState("");
  const [refundPixKey, setRefundPixKey] = useState("");
  const [refundLoading, setRefundLoading] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<'products' | 'history'>('products');
  const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      toast({ variant: "destructive", title: "Senha fraca", description: "A senha deve ter pelo menos 6 caracteres." });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: "destructive", title: "Senhas diferentes", description: "As senhas não coincidem." });
      return;
    }
    const user = auth.currentUser;
    if (!user) return;
    setPasswordChangeLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/members/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao alterar senha');
      toast({ title: "Senha alterada!", description: "Sua senha foi atualizada com sucesso." });
      setShowChangePasswordDialog(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erro ao alterar senha", description: err.message || "Tente novamente." });
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLocation('/areademembros');
        return;
      }

      try {
        const token = await user.getIdToken();

        const response = await fetch('/api/members/dashboard', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Erro ao carregar dashboard');
        }

        const data = await response.json();
        setProducts(data.products || []);
        setPurchaseHistory(data.purchaseHistory || []);
      } catch (error: any) {
        console.error('Erro ao carregar dashboard:', error);
        toast({
          variant: "destructive",
          title: "Erro ao carregar dados",
          description: error.message,
        });
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleAccessProduct = (product: Product) => {
    if (product.memberAreaId) {
      setLocation(`/members/${product.memberAreaId}`);
    } else {
      setLocation(`/members/${product.id}`);
    }
  };

  const handleRequestRefund = (purchase: Purchase) => {
    setSelectedOrder(purchase);
    setRefundReason("");
    setRefundDescription("");
    setRefundPixKey("");
    setShowRefundDialog(true);
  };

  const handleSubmitRefund = async () => {
    if (!selectedOrder || !refundReason.trim()) {
      toast({
        variant: "destructive",
        title: "Motivo obrigatório",
        description: "Por favor, selecione o motivo do reembolso",
      });
      return;
    }

    if (!refundDescription.trim() || refundDescription.trim().length < 20) {
      toast({
        variant: "destructive",
        title: "Descrição obrigatória",
        description: "Por favor, descreva detalhadamente o motivo (mínimo 20 caracteres)",
      });
      return;
    }

    setRefundLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Não autenticado');

      const token = await user.getIdToken();
      const response = await fetch('/api/members/refunds/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          reason: `${refundReason}: ${refundDescription}`,
          pixKey: refundPixKey.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Erro ao solicitar reembolso');
      }

      toast({
        title: "Solicitação enviada!",
        description: "O vendedor tem até 7 dias para analisar. Após esse prazo, o reembolso é aprovado automaticamente.",
      });

      setShowRefundDialog(false);
      
      setPurchaseHistory(prev =>
        prev.map(p =>
          p.id === selectedOrder.id ? { ...p, canRefund: false } : p
        )
      );

    } catch (error: any) {
      console.error('Erro ao solicitar reembolso:', error);
      toast({
        variant: "destructive",
        title: "Erro ao solicitar reembolso",
        description: error.message,
      });
    } finally {
      setRefundLoading(false);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency === 'USD' ? 'USD' : 'BRL',
    }).format(amount / 100);
  };

  const formatDateTime = (timestamp: any) => {
    if (!timestamp) return { date: '-', time: '-' };
    try {
      let date: Date;
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      } else if (timestamp._seconds) {
        date = new Date(timestamp._seconds * 1000);
      } else if (typeof timestamp === 'string') {
        date = new Date(timestamp);
      } else if (typeof timestamp === 'number') {
        date = new Date(timestamp);
      } else {
        date = new Date(timestamp);
      }
      
      if (isNaN(date.getTime())) {
        return { date: '-', time: '-' };
      }
      
      return {
        date: new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(date),
        time: new Intl.DateTimeFormat('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(date),
      };
    } catch (error) {
      console.error('Erro ao formatar data:', error);
      return { date: '-', time: '-' };
    }
  };

  const truncateId = (id: string) => {
    if (!id) return '-';
    if (id.length <= 20) return id;
    return `${id.substring(0, 12)}...${id.substring(id.length - 6)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-[#120820] to-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <RefreshCw className="h-12 w-12 animate-spin mx-auto" style={{ color: '#2563eb' }} />
          <p className="text-white/70">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-[#120820] to-black">
      {/* Header com Logo e Navegação */}
      <div className="border-b bg-black/60 backdrop-blur-xl sticky top-0 z-50" style={{ borderColor: 'rgba(139,92,246,0.2)' }}>
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <LogoThemed type="site" variant="dark" className="h-8 w-auto" fallbackText="VolatusPay" data-testid="members-logo" />
            
            {/* Navegação Central */}
            <div className="hidden md:flex items-center gap-2">
              <button
                data-testid="tab-products"
                onClick={() => setActiveTab('products')}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  activeTab === 'products'
                    ? 'text-black shadow-lg'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                style={activeTab === 'products' ? { background: '#2563eb', boxShadow: '0 4px 14px rgba(127,223,0,0.3)' } : {}}
              >
                <BookOpen className="h-4 w-4 inline-block mr-2" />
                Meus Produtos
              </button>
              <button
                data-testid="tab-history"
                onClick={() => setActiveTab('history')}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'text-black shadow-lg'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                style={activeTab === 'history' ? { background: '#2563eb', boxShadow: '0 4px 14px rgba(127,223,0,0.3)' } : {}}
              >
                <ShoppingCart className="h-4 w-4 inline-block mr-2" />
                Histórico de Compras
              </button>
            </div>

            {/* Ações */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setLocation('/dashboard')}
                className="text-white/70 hover:text-white hover:bg-white/10 gap-2"
                data-testid="btn-back-dashboard"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Painel de Vendas</span>
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowChangePasswordDialog(true)}
                className="text-white/70 hover:text-white hover:bg-white/10 gap-2"
              >
                <KeyRound className="h-4 w-4" />
                <span className="hidden sm:inline">Alterar Senha</span>
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => { auth.signOut(); setLocation('/areademembros'); }} 
                className="text-white/70 hover:text-white hover:bg-white/10 gap-2"
                data-testid="btn-logout"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>

          {/* Navegação Mobile */}
          <div className="flex md:hidden items-center gap-2 mt-4">
            <button
              onClick={() => setActiveTab('products')}
              className={`flex-1 px-4 py-2 rounded-full text-xs font-medium transition-all ${
                activeTab === 'products'
                  ? 'text-black'
                  : 'text-white/70 bg-white/5'
              }`}
              style={activeTab === 'products' ? { background: '#2563eb' } : {}}
            >
              Meus Produtos
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 px-4 py-2 rounded-full text-xs font-medium transition-all ${
                activeTab === 'history'
                  ? 'text-black'
                  : 'text-white/70 bg-white/5'
              }`}
              style={activeTab === 'history' ? { background: '#2563eb' } : {}}
            >
              Histórico
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        
        {/* Meus Produtos */}
        {activeTab === 'products' && (
          <div>
            {products.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.15)' }}>
                  <Package className="h-10 w-10" style={{ color: '#2563eb' }} />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Nenhum produto disponível</h3>
                <p className="text-white/50 text-sm">
                  Suas compras aparecerão aqui
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {products.filter(p => p !== null).map((product) => (
                  <Card
                    key={product.id}
                    data-testid={`card-product-${product.id}`}
                    className="transition-all cursor-pointer backdrop-blur-sm group overflow-hidden"
                    style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}
                    onClick={() => handleAccessProduct(product)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(127,223,0,0.12)'; e.currentTarget.style.borderColor = 'rgba(127,223,0,0.35)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.06)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.15)'; }}
                  >
                    {/* Imagem Compacta */}
                    <div className="relative aspect-video overflow-hidden">
                      {product.imageUrl ? (
                        <img
                          src={resolveImageUrl(product.imageUrl) || ''}
                          alt={product.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(127,223,0,0.05) 100%)' }}>
                          <BookOpen className="h-8 w-8" style={{ color: '#2563eb' }} />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                    </div>

                    <CardContent className="p-3">
                      <h3 className="text-white font-medium text-sm line-clamp-2 mb-2">
                        {product.title}
                      </h3>
                      
                      <Button
                        size="sm"
                        className="w-full text-black text-xs font-semibold"
                        style={{ background: '#2563eb', boxShadow: '0 4px 14px rgba(139,92,246,0.2)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAccessProduct(product);
                        }}
                      >
                        <Play className="w-3 h-3 mr-1" />
                        Acessar Aulas
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Histórico de Compras */}
        {activeTab === 'history' && (
          <div>
            {purchaseHistory.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.15)' }}>
                  <ShoppingCart className="h-10 w-10" style={{ color: '#2563eb' }} />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Nenhuma compra</h3>
                <p className="text-white/50 text-sm">
                  Seu histórico de compras aparecerá aqui
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {purchaseHistory.map((purchase) => {
                  const { date, time } = formatDateTime(purchase.purchaseDate);
                  return (
                    <Card
                      key={purchase.id}
                      data-testid={`card-purchase-${purchase.id}`}
                      className="backdrop-blur-sm transition-all"
                      style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}
                    >
                      <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          {/* Info Principal */}
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Nome do Produto */}
                            <h4 className="font-semibold text-white text-lg">
                              {purchase.productName}
                            </h4>
                            
                            {/* Detalhes */}
                            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                              {/* Data e Hora */}
                              <div className="flex items-center gap-1.5 text-white/60">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>{date}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-white/60">
                                <Clock className="w-3.5 h-3.5" />
                                <span>{time}</span>
                              </div>
                              
                              {/* Método de Pagamento */}
                              <div className="flex items-center gap-1.5 text-white/60">
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>
                                  {purchase.paymentMethod === 'pix' ? 'PIX' : 
                                   purchase.paymentMethod === 'credit_card' ? 'Cartão' :
                                   purchase.paymentMethod === 'boleto' ? 'Boleto' :
                                   purchase.paymentMethod}
                                </span>
                              </div>
                            </div>
                            
                            {/* ID da Ordem */}
                            <div className="flex items-center gap-1.5 text-xs text-white/40">
                              <Hash className="w-3 h-3" />
                              <span className="font-mono">{truncateId(purchase.id)}</span>
                            </div>
                          </div>

                          {/* Valor e Ações */}
                          <div className="flex items-center gap-4">
                            {/* Valor */}
                            <div className="text-right">
                              <div className="text-xl font-bold text-violet-400">
                                {formatCurrency(purchase.amount, purchase.currency)}
                              </div>
                              {purchase.status && (
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs mt-1 ${
                                    purchase.status === 'paid' ? 'border-violet-500/50 text-violet-400' :
                                    purchase.status === 'refunded' ? 'border-orange-500/50 text-orange-400' :
                                    'border-white/30 text-white/60'
                                  }`}
                                >
                                  {purchase.status === 'paid' ? 'Pago' :
                                   purchase.status === 'refunded' ? 'Reembolsado' :
                                   purchase.status === 'completed' ? 'Concluído' :
                                   purchase.status}
                                </Badge>
                              )}
                            </div>

                            {/* Menu de Ações */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 text-white/60 hover:text-white hover:bg-white/10"
                                >
                                  <MoreVertical className="w-5 h-5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-gray-900" style={{ borderColor: 'rgba(139,92,246,0.2)' }}>
                                {purchase.canRefund ? (
                                  <DropdownMenuItem
                                    onClick={() => handleRequestRefund(purchase)}
                                    className="gap-2 text-orange-400 focus:text-orange-400 focus:bg-orange-500/10 cursor-pointer"
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                    Solicitar Reembolso
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    disabled
                                    className="gap-2 text-white/40 cursor-not-allowed"
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                    Reembolso indisponível
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dialog de Reembolso Detalhado */}
      <Dialog open={showRefundDialog} onOpenChange={setShowRefundDialog}>
        <DialogContent className="max-w-lg mx-4 sm:mx-auto bg-gray-900 text-white max-h-[90vh] overflow-y-auto" style={{ borderColor: 'rgba(139,92,246,0.2)' }}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-orange-400" />
              Solicitar Reembolso
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Sua solicitação será enviada ao vendedor para análise.
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-5 py-2">
              {/* Info do Produto */}
              <div className="p-4 rounded-lg" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-white">{selectedOrder.productName}</p>
                    <p className="text-sm text-white/60 mt-1">
                      ID: {truncateId(selectedOrder.id)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-violet-400">
                      {formatCurrency(selectedOrder.amount, selectedOrder.currency)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Aviso */}
              <div className="flex items-start gap-3 p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                <AlertTriangle className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-orange-200/80">
                  <p className="font-medium text-orange-300">Importante:</p>
                  <p>O vendedor tem até <strong>7 dias</strong> para analisar sua solicitação. Após esse prazo, o reembolso é aprovado automaticamente conforme o CDC.</p>
                </div>
              </div>

              {/* Motivo */}
              <div className="space-y-2">
                <Label className="text-white">Motivo do Reembolso *</Label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-black/50 text-white focus:outline-none"
                  style={{ border: '1px solid rgba(139,92,246,0.2)', outline: 'none' }}
                >
                  <option value="">Selecione o motivo...</option>
                  <option value="Produto não atendeu expectativas">Produto não atendeu expectativas</option>
                  <option value="Problema técnico no acesso">Problema técnico no acesso</option>
                  <option value="Conteúdo diferente do anunciado">Conteúdo diferente do anunciado</option>
                  <option value="Compra duplicada">Compra duplicada</option>
                  <option value="Desistência dentro do prazo">Desistência dentro do prazo (7 dias)</option>
                  <option value="Outro motivo">Outro motivo</option>
                </select>
              </div>

              {/* Descrição Detalhada */}
              <div className="space-y-2">
                <Label className="text-white">Descreva detalhadamente o motivo *</Label>
                <Textarea
                  placeholder="Explique com detalhes o motivo da sua solicitação de reembolso. Quanto mais detalhes, mais rápido será a análise..."
                  value={refundDescription}
                  onChange={(e) => setRefundDescription(e.target.value)}
                  className="bg-black/50 text-white min-h-[120px] placeholder:text-white/30"
                  style={{ borderColor: 'rgba(139,92,246,0.2)' }}
                />
                <p className="text-xs text-white/40">
                  Mínimo 20 caracteres ({refundDescription.length}/20)
                </p>
              </div>

              {/* Chave PIX para receber o reembolso */}
              <div className="space-y-2">
                <Label className="text-white">Sua Chave PIX para receber o reembolso</Label>
                <Input
                  placeholder="CPF, e-mail, celular ou chave aleatória"
                  value={refundPixKey}
                  onChange={(e) => setRefundPixKey(e.target.value)}
                  className="bg-black/50 text-white placeholder:text-white/30"
                  style={{ borderColor: 'rgba(139,92,246,0.2)' }}
                />
                <p className="text-xs text-white/40">
                  Informe a chave PIX onde você deseja receber o valor reembolsado.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowRefundDialog(false)}
              disabled={refundLoading}
              className="text-white hover:bg-white/10 w-full sm:w-auto order-2 sm:order-1"
              style={{ borderColor: 'rgba(139,92,246,0.2)' }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmitRefund}
              disabled={refundLoading || !refundReason || refundDescription.length < 20}
              className="bg-orange-600 hover:bg-orange-700 text-white w-full sm:w-auto order-1 sm:order-2"
            >
              {refundLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Enviar Solicitação'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Alterar Senha */}
      <Dialog open={showChangePasswordDialog} onOpenChange={(open) => { setShowChangePasswordDialog(open); if (!open) { setNewPassword(""); setConfirmPassword(""); } }}>
        <DialogContent className="sm:max-w-[400px]" style={{ background: '#111', border: '1px solid rgba(139,92,246,0.2)' }}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <KeyRound className="h-5 w-5" style={{ color: '#2563eb' }} />
              Alterar Senha
            </DialogTitle>
            <DialogDescription className="text-white/50">
              Defina uma nova senha para acessar a área de membros.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-white">Nova senha</Label>
              <Input
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-black/50 text-white placeholder:text-white/30"
                style={{ borderColor: 'rgba(139,92,246,0.2)' }}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white">Confirmar nova senha</Label>
              <Input
                type="password"
                placeholder="Repita a nova senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-black/50 text-white placeholder:text-white/30"
                style={{ borderColor: 'rgba(139,92,246,0.2)' }}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowChangePasswordDialog(false)}
              disabled={passwordChangeLoading}
              className="text-white hover:bg-white/10 w-full sm:w-auto"
              style={{ borderColor: 'rgba(139,92,246,0.2)' }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleChangePassword}
              disabled={passwordChangeLoading || newPassword.length < 6 || newPassword !== confirmPassword}
              className="w-full sm:w-auto text-black font-bold"
              style={{ background: '#2563eb' }}
            >
              {passwordChangeLoading ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Alterando...</>
              ) : 'Salvar Senha'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
