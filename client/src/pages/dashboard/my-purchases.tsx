import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  getProductsByEmail, 
  createRefund
} from "@/lib/firestore";
import { Link, useLocation } from "wouter";
import { Play, MoreVertical, RefreshCw, AlertTriangle, ShoppingBag, Skull } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import DashboardLayout from "@/components/layout/dashboard-layout";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { type InsertRefund } from "@shared/schema";

export default function MyPurchases() {
  const [, setLocation] = useLocation();
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Estados do modal de reembolso
  const [refundModal, setRefundModal] = useState<{
    isOpen: boolean;
    product: any;
  }>({ isOpen: false, product: null });

  const [refundReason, setRefundReason] = useState<"not_satisfied" | "technical_issues" | "wrong_purchase" | "duplicate_purchase" | "product_defect" | "other">("not_satisfied");
  const [refundDescription, setRefundDescription] = useState("");
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);

  // 🛡️ HELPER: Converter qualquer formato de data do Firestore para Date
  const parseFirestoreDate = (dateField: any): Date | null => {
    if (!dateField) return null;
    
    try {
      if (dateField instanceof Date) {
        return isNaN(dateField.getTime()) ? null : dateField;
      }
      
      if (dateField?._seconds) {
        return new Date(dateField._seconds * 1000);
      }
      
      if (dateField?.seconds) {
        return new Date(dateField.seconds * 1000);
      }
      
      if (typeof dateField === "string") {
        const parsed = new Date(dateField);
        return isNaN(parsed.getTime()) ? null : parsed;
      }
      
      if (typeof dateField === "number") {
        const parsed = new Date(dateField);
        return isNaN(parsed.getTime()) ? null : parsed;
      }
      
      return null;
    } catch {
      return null;
    }
  };

  //  BUSCAR PRODUTOS COMPRADOS POR EMAIL (de outros vendedores no ecossistema)
  const { data: purchasedProducts = [], isLoading: loadingPurchased } = useQuery({
    queryKey: ["purchased-products", user?.email],
    queryFn: () => getProductsByEmail(user?.email || ""),
    enabled: !!user?.email,
  });

  // Verificar se produto é elegvel para reembolso
  const isRefundEligible = (product: any) => {
    if (!product.createdAt) return false;
    
    const createdDate = parseFirestoreDate(product.createdAt);
    if (!createdDate) return false;
    
    const daysSinceCreated = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    const guaranteeDays = product.guaranteeDays || 7;
    
    return daysSinceCreated <= guaranteeDays;
  };

  // Verificar se o seller é dono do produto (não pode reembolsar prprios produtos)
  const isOwner = (product: any) => {
    return product.tenantId === tenant?.id;
  };

  const openRefundModal = (product: any) => {
    // DONO DO PRODUTO NÃO PODE SOLICITAR REEMBOLSO
    if (isOwner(product)) {
      toast({
        title: " No Autorizado",
        description: "Vocnão pode solicitar reembolso de produtos que vocmesmo criou.",
        variant: "destructive",
      });
      return;
    }

    if (!isRefundEligible(product)) {
      toast({
        title: "Prazo de Garantia Expirado",
        description: "O prazo de 7 dias para solicitar reembolso jpassou. Entre em contato com o suporte se necessário.",
        variant: "destructive",
      });
      return;
    }

    setRefundModal({ isOpen: true, product });
    setRefundReason("not_satisfied");
    setRefundDescription("");
  };

  const submitRefund = async () => {
    if (!refundModal.product || !user || !refundDescription.trim()) {
      toast({
        title: " Erro",
        description: "Preencha todos os campos obrigatórios.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmittingRefund(true);
    
    try {
      const product = refundModal.product;
      
      // Determinar tipo do produto baseado na estrutura de dados
      let productType: "digital" | "subscription" = "digital";
      
      if (product.billingType === "subscription") {
        productType = "subscription";
      }

      const refundData: InsertRefund = {
        tenantId: product.tenantId,
        customerId: user.uid,
        productType,
        productId: product.productId || "",
        productTitle: product.title || product.name || product.checkoutSnapshot?.title || product.productId || "Produto",
        checkoutId: product.checkoutId || "",
        orderId: product.orderId || product.id || "",
        reason: refundReason,
        description: refundDescription,
        customerEmail: user.email || "",
        customerName: user.displayName || user.email || "",
        // 💳 DADOS FINANCEIROS
        originalAmount: product.amount || 0,
        refundAmount: product.amount || 0,
        paymentMethod: (product.paymentMethod || product.method || "pix") as "pix" | "card" | "stripe",
        // ⏱️ CONTROLE DE TEMPO
        purchaseDate: parseFirestoreDate(product.createdAt) || new Date(),
        guaranteePeriodDays: product.guaranteeDays || 7,
        isWithinGuarantee: isRefundEligible(product),
        // 🚦 STATUS
        status: "pending" as const,
      };

      console.log(' Dados do reembolso:', refundData);

      await createRefund(refundData);
      
      toast({
        title: " Solicitação Enviada",
        description: "Sua solicitação de reembolso foi enviada com sucesso. Você será notificado sobre o status.",
      });

      setRefundModal({ isOpen: false, product: null });
      setRefundReason("not_satisfied");
      setRefundDescription("");
      
      // Invalidar cache para atualizar a lista
      queryClient.invalidateQueries({ queryKey: ["purchased-products"] });
      
    } catch (error) {
      console.error(' Erro ao solicitar reembolso:', error);
      toast({
        title: " Erro",
        description: "No foi possvel enviar a solicitação. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  const openProductArea = (product: any) => {
    // Usar APENAS productId real - nunca usar orderId (product.id) como fallback,
    // pois /members/<orderId> seria uma rota inválida.
    const productId = product.productId;
    
    if (productId) {
      setLocation(`/members/${productId}`);
    } else {
      toast({
        title: "Indisponível",
        description: "Área de membros não encontrada para este produto. Entre em contato com o suporte.",
        variant: "destructive",
      });
    }
  };

  const ProductCard = ({ product, isPurchased = false }: { product: any; isPurchased?: boolean }) => {
    const title = product.title || product.name || product.checkoutSnapshot?.title || 'Produto';
    const image = product.image || product.thumbnail || product.coverImage || product.checkoutSnapshot?.logoUrl || product.checkoutSnapshot?.bannerUrl;
    const productType = product.type || product.productType || 'digital';
    const amountFormatted = product.amount ? `R$ ${(product.amount / 100).toFixed(2).replace('.', ',')}` : null;

    return (
      <Card 
        key={product.id} 
        onClick={() => openProductArea(product)}
        className="relative w-full bg-white dark:bg-transparent border border-gray-200 dark:border-lime-500/20 hover:shadow-lg transition-shadow cursor-pointer overflow-hidden"
        data-testid={`card-purchase-${product.id}`}
      >
        <div className="aspect-square w-full overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          {image ? (
            <img 
              src={image} 
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <ShoppingBag className="h-12 w-12 text-gray-400" />
          )}
        </div>
        
        <div className="absolute top-2 right-2 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button 
                variant="secondary" 
                size="icon" 
                className="bg-white/90 dark:bg-black/60 shadow-sm"
                data-testid={`button-menu-${product.id}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={(e) => {
                  e.stopPropagation();
                  openProductArea(product);
                }}
                className="flex items-center gap-2"
              >
                <Play className="h-4 w-4" />
                Acessar Área de Membros
              </DropdownMenuItem>
              
              {isPurchased && !isOwner(product) && (
                <DropdownMenuItem 
                  onClick={(e) => {
                    e.stopPropagation();
                    openRefundModal(product);
                  }}
                  className="flex items-center gap-2 text-red-600 dark:text-red-400"
                >
                  <Skull className="h-4 w-4" />
                  Solicitar Reembolso
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        <CardContent className="p-4 space-y-2">
          <h3 className="font-semibold text-sm text-gray-900 dark:text-white line-clamp-2 min-h-[40px]" data-testid={`text-title-${product.id}`}>
            {title}
          </h3>
          
          {amountFormatted && (
            <p className="text-sm font-bold text-lime-500" data-testid={`text-amount-${product.id}`}>
              {amountFormatted}
            </p>
          )}
          
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={isPurchased ? "default" : "secondary"} className="text-xs">
              {isPurchased ? "Comprado" : "Criado"}
            </Badge>
            
            <Badge variant="outline" className="text-xs">
              {productType === "subscription" ? "Assinatura" : "Digital"}
            </Badge>
            
            {(() => {
              const parsedDate = parseFirestoreDate(product.createdAt || product.paidAt);
              return parsedDate ? (
                <Badge variant="outline" className="text-xs">
                  {format(parsedDate, "dd/MM/yyyy", { locale: ptBR })}
                </Badge>
              ) : null;
            })()}
            
            {isPurchased && isRefundEligible(product) && !isOwner(product) && (
              <Badge variant="outline" className="text-xs text-[#2563eb] dark:text-blue-400">
                Reembolso disponível
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loadingPurchased) {
    return (
      <DashboardLayout>
        <div className="px-3 md:px-4 space-y-4 md:space-y-6">
          <h1 className="text-lg md:text-2xl font-bold mb-4 md:mb-6">Minhas Compras</h1>
          <div className="text-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-brand-muted-foreground" />
            <p className="text-brand-muted-foreground dark:text-gray-400">Carregando compras...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="px-3 md:px-4 space-y-4 md:space-y-6">
        <div className="mb-4 md:mb-6">
          <h1 className="text-lg md:text-2xl font-bold text-foreground dark:text-foreground">Minhas Compras</h1>
          <p className="text-brand-muted-foreground dark:text-gray-400 mt-2">
            Produtos que você comprou na vitrine e ofertas do ecossistema
          </p>
        </div>

        {purchasedProducts.length === 0 ? (
          <Card className="p-4 md:p-8 text-center">
            <ShoppingBag className="h-12 w-12 mx-auto mb-4 text-brand-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Nenhuma compra realizada</h3>
            <p className="text-brand-muted-foreground dark:text-gray-400 mb-4">
              Você ainda não comprou nenhum produto. Explore a vitrine e ofertas de outros sellers!
            </p>
            <Button asChild>
              <Link href="/dashboard/showcase">Explorar Vitrine</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {purchasedProducts.map((product) => (
              <ProductCard key={product.id} product={product} isPurchased={true} />
            ))}
          </div>
        )}

      {/* Modal de Reembolso */}
      <Dialog open={refundModal.isOpen} onOpenChange={(open) => 
        !open && setRefundModal({ isOpen: false, product: null })
      }>
        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-700 dark:backdrop-blur-md border-brand-muted dark:border-lime-500/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground dark:text-foreground">
              <Skull className="h-5 w-5" />
              Solicitar Reembolso
            </DialogTitle>
            <DialogDescription className="text-brand-muted-foreground dark:text-gray-400">
              Produto: <strong className="text-foreground dark:text-foreground">
                {refundModal.product?.title || refundModal.product?.name || refundModal.product?.checkoutSnapshot?.title || refundModal.product?.productId || "Produto"}
              </strong>
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="reason">Motivo do reembolso</Label>
              <Select value={refundReason} onValueChange={(v) => setRefundReason(v as typeof refundReason)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um motivo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_satisfied">Não satisfeito com o produto</SelectItem>
                  <SelectItem value="technical_issues">Problema técnico</SelectItem>
                  <SelectItem value="wrong_purchase">Compra errada / não autorizada</SelectItem>
                  <SelectItem value="duplicate_purchase">Compra duplicada</SelectItem>
                  <SelectItem value="product_defect">Produto com defeito / incompleto</SelectItem>
                  <SelectItem value="other">Outro motivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="description">Descrição detalhada *</Label>
              <Textarea
                id="description"
                placeholder="Descreva o motivo da solicitação de reembolso..."
                value={refundDescription}
                onChange={(e) => setRefundDescription(e.target.value)}
                className="min-h-[100px]"
              />
              <p className="text-xs text-brand-muted-foreground">
                Mnimo de 10 caracteres. Seja especfico sobre o problema.
              </p>
            </div>
            
            <div className="bg-blue-50 dark:bg-amber-950 p-3 rounded-lg border border-amber-200 dark:border-blue-500">
              <div className="flex items-center gap-2 text-muted-foreground dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-medium">Prazo de garantia</p>
              </div>
              <p className="text-xs text-muted-foreground dark:text-amber-300 mt-1">
                Voctem até 7 dias após a compra para solicitar reembolso.
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRefundModal({ isOpen: false, product: null })}
              disabled={isSubmittingRefund}
            >
              Cancelar
            </Button>
            <Button
              onClick={submitRefund}
              disabled={isSubmittingRefund || refundDescription.length < 10}
              className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
            >
              {isSubmittingRefund ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Skull className="mr-2 h-4 w-4" />
                  Solicitar Reembolso
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </DashboardLayout>
  );
}