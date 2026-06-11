import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Copy, Edit, Trash2, ExternalLink, CreditCard, QrCode, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { EmptyState } from "@/components/ui/empty-state";
import { auth } from "@/lib/firebase";
import { formatCurrency, toCents, fromCents } from "@/lib/currency";
import type { ProductOffer } from "@shared/schema";

interface ProductOffersProps {
  productId: string;
  productSlug?: string;
  productPrice?: number;
  productCurrency?: string;
  productType?: "digital" | "subscription";
}

export function ProductOffers({ productId, productSlug, productPrice, productCurrency = "BRL", productType }: ProductOffersProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<ProductOffer | null>(null);
  const [formData, setFormData] = useState({
    slug: "",
    title: "",
    description: "",
    price: "",
    subscriptionPeriod: "monthly" as "monthly" | "quarterly" | "semiannual" | "annual",
    paymentMethods: {
      pix: true,
      boleto: false,
      card: false,
      cardBr: false,
      cardGlobal: false,
    },
    installments: {
      enabled: false,
      maxInstallments: 12,
      minInstallmentValue: 500,
      interestFree: 0,
    },
  });
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: offers = [], isLoading, error } = useQuery<ProductOffer[]>({
    queryKey: ["offers", productId],
    enabled: !!productId,
    queryFn: async () => {
      if (!productId) return [];
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/products/${productId}/offers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Erro ao buscar ofertas");
      return response.json();
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/products/${productId}/offers`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          slug: data.slug,
          title: data.title,
          description: data.description,
          price: toCents(Number(data.price)),
          currency: productCurrency,
          ...(productType === "subscription" && { subscriptionPeriod: data.subscriptionPeriod }),
          paymentMethods: data.paymentMethods,
          installments: data.installments,
        })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Erro ao criar oferta");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offers", productId] });
      setIsDialogOpen(false);
      setEditingOffer(null);
      setFormData({ 
        slug: "", title: "", description: "", price: "", subscriptionPeriod: "monthly",
        paymentMethods: { pix: true, boleto: false, card: false, cardBr: false, cardGlobal: false },
        installments: { enabled: false, maxInstallments: 12, minInstallmentValue: 500, interestFree: 0 }
      });
      toast({ title: "Oferta criada com sucesso!" });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao criar oferta",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ offerId, data }: { offerId: string; data: typeof formData }) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/products/${productId}/offers/${offerId}`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          price: toCents(Number(data.price)),
          currency: productCurrency,
          ...(productType === "subscription" && data.subscriptionPeriod && { subscriptionPeriod: data.subscriptionPeriod }),
          paymentMethods: data.paymentMethods,
          installments: data.installments,
        })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Erro ao atualizar oferta");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offers", productId] });
      setIsDialogOpen(false);
      setEditingOffer(null);
      setFormData({ 
        slug: "", title: "", description: "", price: "", subscriptionPeriod: "monthly",
        paymentMethods: { pix: true, boleto: false, card: false, cardBr: false, cardGlobal: false },
        installments: { enabled: false, maxInstallments: 12, minInstallmentValue: 500, interestFree: 0 }
      });
      toast({ title: "Oferta atualizada com sucesso!" });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao atualizar oferta",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (offerId: string) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/products/${productId}/offers/${offerId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Erro ao deletar oferta");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offers", productId] });
      toast({ title: "Oferta deletada com sucesso!" });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao deletar oferta",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "URL copiada para a área de transferência!" });
  };

  const getCheckoutUrl = (offerSlug?: string) => {
    const domain = import.meta.env.VITE_PLATFORM_DOMAIN ? `https://${import.meta.env.VITE_PLATFORM_DOMAIN}` : window.location.origin;
    if (!productSlug) return "";
    // Se não tem slug de oferta, retorna URL base
    return offerSlug ? `${domain}/checkout/${productSlug}/${offerSlug}` : `${domain}/checkout/${productSlug}`;
  };

  // URL base do checkout (sempre existe)
  const baseCheckoutUrl = getCheckoutUrl();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingOffer) {
      updateMutation.mutate({ offerId: editingOffer.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (offer: ProductOffer) => {
    console.log('🔧 Editando oferta:', offer.id);
    setEditingOffer(offer);
    const offerData = offer as any;
    setFormData({
      slug: offer.slug,
      title: offer.title,
      description: offer.description || "",
      price: String(fromCents(offer.price)),
      subscriptionPeriod: offerData.subscriptionPeriod || (productType === "subscription" ? "monthly" : undefined),
      paymentMethods: offerData.paymentMethods || { pix: true, boleto: false, card: false, cardBr: false, cardGlobal: false },
      installments: offerData.installments || { enabled: false, maxInstallments: 12, minInstallmentValue: 500, interestFree: 0 },
    });
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center space-y-2">
          <p className="text-destructive font-semibold">Erro ao carregar ofertas</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <Button onClick={() => queryClient.invalidateQueries({ queryKey: ["offers", productId] })}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg sm:text-xl font-semibold">Ofertas do Produto</h2>
          <p className="text-sm text-muted-foreground">
            {offers.length}/12 ofertas criadas • Máximo de 12 ofertas por produto
          </p>
        </div>
        <Button 
          disabled={offers.length >= 12} 
          onClick={() => {
            setEditingOffer(null);
            setFormData({ slug: "", title: "", description: "", price: "", subscriptionPeriod: "monthly", paymentMethods: { pix: true, boleto: false, card: false, cardBr: false, cardGlobal: false }, installments: { enabled: false, maxInstallments: 12, minInstallmentValue: 500, interestFree: 0 } });
            setIsDialogOpen(true);
          }}
          data-testid="button-create-offer"
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">{offers.length >= 12 ? "Limite atingido (12/12)" : "Nova Oferta"}</span>
          <span className="sm:hidden">Nova</span>
        </Button>

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setIsDialogOpen(false);
            setEditingOffer(null);
            setFormData({ slug: "", title: "", description: "", price: "", subscriptionPeriod: "monthly", paymentMethods: { pix: true, boleto: false, card: false, cardBr: false, cardGlobal: false }, installments: { enabled: false, maxInstallments: 12, minInstallmentValue: 500, interestFree: 0 } });
          } else {
            setIsDialogOpen(true);
          }
        }}>
          <DialogContent className="max-w-[95vw] sm:max-w-[500px] max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{editingOffer ? "Editar Oferta" : "Criar Nova Oferta"}</DialogTitle>
              <DialogDescription>
                {editingOffer 
                  ? "Atualize o valor ou informações da oferta (o link permanece o mesmo)"
                  : "Crie uma oferta adicional com preço diferente (máximo 12 ofertas por produto)"
                }
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 px-1">
              <div>
                <Label htmlFor="slug">Slug da Oferta *</Label>
                <Input
                  id="slug"
                  placeholder="promo-natal"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  required
                  disabled={!!editingOffer}
                  data-testid="input-offer-slug"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {editingOffer 
                    ? "O slug não pode ser alterado (mantém o link inalterado)"
                    : `URL: /checkout/${productSlug || "produto"}/${formData.slug || "slug"}`
                  }
                </p>
              </div>
              <div>
                <Label htmlFor="title">Título da Oferta *</Label>
                <Input
                  id="title"
                  placeholder="Promoção de Natal"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  data-testid="input-offer-title"
                />
              </div>
              <div>
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  placeholder="Oferta especial com desconto..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  data-testid="input-offer-description"
                />
              </div>
              
              {/* PREÇO E PERÍODO NA MESMA LINHA */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="price">Preço (R$) *</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    placeholder="97.00"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    required
                    data-testid="input-offer-price"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Moeda: {productCurrency}
                  </p>
                </div>
                
                {/* CAMPO DE PERÍODO - SÓ APARECE PARA ASSINATURAS - AO LADO DO PREÇO */}
                {productType === "subscription" && (
                  <div>
                    <Label htmlFor="subscriptionPeriod">Período *</Label>
                    <Select 
                      value={formData.subscriptionPeriod} 
                      onValueChange={(value: any) => setFormData({ ...formData, subscriptionPeriod: value })}
                      disabled={!!editingOffer}
                    >
                      <SelectTrigger data-testid="select-subscription-period" disabled={!!editingOffer}>
                        <SelectValue placeholder="Período" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Mensal</SelectItem>
                        <SelectItem value="quarterly">Trimestral</SelectItem>
                        <SelectItem value="semiannual">Semestral</SelectItem>
                        <SelectItem value="annual">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {editingOffer ? "Bloqueado" : "Recorrência"}
                    </p>
                  </div>
                )}
              </div>

              {/* MÉTODOS DE PAGAMENTO */}
              <div className="space-y-3 pt-3 border-t">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Métodos de Pagamento Aceitos
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="pix"
                      checked={formData.paymentMethods.pix}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        paymentMethods: { ...formData.paymentMethods, pix: !!checked }
                      })}
                      data-testid="checkbox-pix"
                    />
                    <Label htmlFor="pix" className="text-sm flex items-center gap-1 cursor-pointer">
                      <QrCode className="h-3 w-3" /> PIX
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="boleto"
                      checked={formData.paymentMethods.boleto}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        paymentMethods: { ...formData.paymentMethods, boleto: !!checked }
                      })}
                      data-testid="checkbox-boleto"
                    />
                    <Label htmlFor="boleto" className="text-sm flex items-center gap-1 cursor-pointer">
                      <FileText className="h-3 w-3" /> Boleto
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="cardBr"
                      checked={formData.paymentMethods.cardBr}
                      onCheckedChange={(checked) => {
                        const hasCard = Boolean(checked) || formData.paymentMethods.cardGlobal;
                        setFormData({
                          ...formData,
                          paymentMethods: { ...formData.paymentMethods, cardBr: Boolean(checked), card: hasCard }
                        });
                      }}
                      data-testid="checkbox-card-br"
                    />
                    <Label htmlFor="cardBr" className="text-sm flex items-center gap-1 cursor-pointer">
                      <CreditCard className="h-3 w-3" /> Cartão BR
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="cardGlobal"
                      checked={formData.paymentMethods.cardGlobal}
                      onCheckedChange={(checked) => {
                        const hasCard = Boolean(checked) || formData.paymentMethods.cardBr;
                        setFormData({
                          ...formData,
                          paymentMethods: { ...formData.paymentMethods, cardGlobal: Boolean(checked), card: hasCard }
                        });
                      }}
                      data-testid="checkbox-card-global"
                    />
                    <Label htmlFor="cardGlobal" className="text-sm flex items-center gap-1 cursor-pointer">
                      <CreditCard className="h-3 w-3" /> Cartão Global
                    </Label>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cartão BR = EfíBank (parcelamento) • Cartão Global = Stripe
                </p>
              </div>

              {/* CONFIGURAÇÃO DE PARCELAMENTO */}
              {(formData.paymentMethods.cardBr || formData.paymentMethods.card) && (
                <div className="space-y-3 pt-3 border-t">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="installments-enabled"
                      checked={formData.installments.enabled}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        installments: { ...formData.installments, enabled: !!checked }
                      })}
                      data-testid="checkbox-installments"
                    />
                    <Label htmlFor="installments-enabled" className="text-sm cursor-pointer font-medium">
                      Habilitar Parcelamento
                    </Label>
                  </div>
                  
                  {formData.installments.enabled && (
                    <div className="grid grid-cols-2 gap-3 pl-6">
                      <div>
                        <Label htmlFor="maxInstallments" className="text-xs">Máx. Parcelas</Label>
                        <Select
                          value={String(formData.installments.maxInstallments)}
                          onValueChange={(value) => setFormData({
                            ...formData,
                            installments: { ...formData.installments, maxInstallments: Number(value) }
                          })}
                        >
                          <SelectTrigger data-testid="select-max-installments">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                              <SelectItem key={n} value={String(n)}>{n}x</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="interestFree" className="text-xs">Sem Juros Até</Label>
                        <Select
                          value={String(formData.installments.interestFree)}
                          onValueChange={(value) => setFormData({
                            ...formData,
                            installments: { ...formData.installments, interestFree: Number(value) }
                          })}
                        >
                          <SelectTrigger data-testid="select-interest-free">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">Nenhum</SelectItem>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                              <SelectItem key={n} value={String(n)}>{n}x</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending} 
                className="w-full" 
                data-testid="button-save-offer"
              >
                {editingOffer 
                  ? (updateMutation.isPending ? "Salvando..." : "Salvar Alterações")
                  : (createMutation.isPending ? "Criando..." : "Criar Oferta")
                }
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 w-full">
        {/* URL BASE DO CHECKOUT - SEMPRE APARECE PRIMEIRO */}
        <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700 shadow-sm w-full" data-testid="card-base-checkout">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
                  URL Principal do Checkout
                  <Badge variant="default" className="text-xs flex-shrink-0">Padrão</Badge>
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Esta é a URL base do seu checkout
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1 min-w-0 bg-muted dark:bg-muted/40 p-2 rounded-md font-mono text-xs sm:text-sm break-all overflow-x-auto">
                {baseCheckoutUrl}
              </div>
              <div className="flex gap-2 flex-shrink-0 min-w-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(baseCheckoutUrl)}
                  data-testid="button-copy-base-url"
                  className="flex-1 sm:flex-none min-w-0"
                >
                  <Copy className="h-4 w-4 flex-shrink-0" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(baseCheckoutUrl, "_blank")}
                  data-testid="button-open-base-url"
                  className="flex-1 sm:flex-none min-w-0"
                >
                  <ExternalLink className="h-4 w-4 flex-shrink-0" />
                </Button>
              </div>
            </div>
            
            {/* PREÇO INTEGRADO DENTRO DO CARD */}
            {productPrice !== undefined && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground flex-1">
                  Preço padrão do produto
                </p>
                <div className="text-center sm:text-right">
                  <div className="text-2xl sm:text-3xl font-bold text-[#2563eb] dark:text-blue-400">
                    {formatCurrency(productPrice, productCurrency)}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* OFERTAS ADICIONAIS COM PREÇOS DIFERENTES */}
        {offers.map((offer) => {
          const checkoutUrl = getCheckoutUrl(offer.slug);
          return (
            <div key={offer.id} className="grid grid-cols-1 gap-4 w-full" data-testid={`offer-container-${offer.id}`}>
              <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700 shadow-sm w-full" data-testid={`card-offer-${offer.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
                        <span className="break-words">{offer.title}</span>
                        <Badge variant="secondary" className="text-xs flex-shrink-0">Oferta</Badge>
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm break-words">
                        {offer.description || "Oferta especial com preço promocional"}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(offer)}
                        data-testid={`button-edit-offer-${offer.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(offer.id)}
                        data-testid={`button-delete-offer-${offer.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="flex-1 min-w-0 bg-muted dark:bg-muted/40 p-2 rounded-md font-mono text-xs sm:text-sm break-all overflow-x-auto">
                      {checkoutUrl}
                    </div>
                    <div className="flex gap-2 flex-shrink-0 min-w-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(checkoutUrl)}
                        data-testid={`button-copy-offer-url-${offer.id}`}
                        className="flex-1 sm:flex-none min-w-0"
                      >
                        <Copy className="h-4 w-4 flex-shrink-0" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(checkoutUrl, "_blank")}
                        data-testid={`button-open-offer-url-${offer.id}`}
                        className="flex-1 sm:flex-none min-w-0"
                      >
                        <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Slug: <code className="bg-muted dark:bg-muted/40 px-1 py-0.5 rounded break-all">{offer.slug}</code>
                      </p>
                      {productType === "subscription" ? (
                        <p className="text-xs font-medium text-[#2563eb] dark:text-blue-400">
                          🔄 Assinatura: {
                            (offer as any).subscriptionPeriod === "monthly" ? "Mensal (30 dias)" :
                            (offer as any).subscriptionPeriod === "quarterly" ? "Trimestral (90 dias)" :
                            (offer as any).subscriptionPeriod === "semiannual" ? "Semestral (180 dias)" :
                            (offer as any).subscriptionPeriod === "annual" ? "Anual (365 dias)" : 
                            "Mensal (padrão)"
                          }
                        </p>
                      ) : (
                        <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                          💳 Pagamento Único
                        </p>
                      )}
                    </div>
                    <div className="text-center sm:text-right">
                      <div className="text-2xl sm:text-3xl font-bold text-blue-700 dark:text-blue-400">
                        {formatCurrency(offer.price, offer.currency)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Preço promocional</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>

      {offers.length > 0 && offers.length < 6 && (
        <p className="text-center text-sm text-muted-foreground">
          1 URL principal + {offers.length}/6 ofertas adicionais criadas
        </p>
      )}
      {offers.length >= 6 && (
        <p className="text-center text-sm text-destructive font-medium">
          Limite máximo atingido (1 URL principal + 6 ofertas adicionais = 7 total)
        </p>
      )}
      {offers.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          1 URL principal + 0/6 ofertas adicionais
        </p>
      )}
    </div>
  );
}
