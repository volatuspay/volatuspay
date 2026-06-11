import { useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, Copy, Check, ExternalLink, ChevronDown, ChevronUp, Info, User, Mail, Phone, Globe, FileText, Link2, ShoppingCart, TrendingUp, DollarSign, BarChart3, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { resolveImageUrl } from "@/lib/image-url";

export default function MyAffiliationsPage() {
  const [, setLocation] = useLocation();
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const { toast } = useToast();
  
  const { data: affiliationsData, isLoading } = useQuery({
    queryKey: ['/api/affiliations'],
    staleTime: 30000,
  });
  
  const affiliations = (affiliationsData as any)?.affiliations || [];
  
  // Copiar link de afiliado
  const copyAffiliateLink = (link: string | undefined, offerName: string) => {
    // Validação robusta: link deve existir e ser válido (URL absoluta OU path relativo)
    if (!link || link.trim() === '' || link === 'undefined') {
      toast({
        title: "Link indisponível",
        description: "Este produto não possui link de afiliado configurado",
        variant: "destructive"
      });
      return;
    }

    // Aceitar URLs absolutas OU paths relativos
    const isAbsoluteUrl = link.startsWith('http://') || link.startsWith('https://');
    const fullLink = isAbsoluteUrl ? link : `${window.location.origin}${link}`;
    
    navigator.clipboard.writeText(fullLink);
    setCopiedLink(link);
    toast({
      title: "Link copiado!",
      description: `Link de "${offerName}" copiado com sucesso`,
    });
    setTimeout(() => setCopiedLink(null), 2000);
  };
  
  const toggleProduct = (productId: string) => {
    setExpandedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };
  
  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <h1 className="text-xl md:text-3xl font-bold text-gray-900 dark:text-white">
              Minhas Afiliações
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Copie o link do produto e comece a vender
            </p>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : affiliations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-20">
                <div className="mb-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                  <Package className="h-12 w-12 text-gray-400" />
                </div>
                <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Nenhuma afiliação encontrada
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Você ainda não se afiliou a nenhum produto
                </p>
                <Button onClick={() => setLocation('/dashboard/showcase')}>
                  Explorar Produtos
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3 sm:gap-4">
              {affiliations.map((affiliation: any) => {
                const commissionPercent =
                  affiliation.realCommission !== undefined ? affiliation.realCommission :
                  affiliation.customCommission !== undefined ? affiliation.customCommission :
                  affiliation.commissionSnapshot?.single !== undefined ? affiliation.commissionSnapshot.single :
                  10;
                const maxOffer = affiliation.offers && affiliation.offers.length > 0
                  ? affiliation.offers.reduce((max: any, o: any) => (o.price || 0) > (max.price || 0) ? o : max, affiliation.offers[0])
                  : null;
                const productPrice = maxOffer ? maxOffer.price : 0;
                const commissionValue = Math.round((productPrice * commissionPercent) / 100);
                
                return (
                  <Card 
                    key={affiliation.id} 
                    className="cursor-pointer bg-white dark:bg-[hsl(142,15%,8%)] border border-gray-200 dark:border-lime-500/20 hover:shadow-lg hover:border-lime-500/40 transition-all duration-200 overflow-hidden group"
                    onClick={() => setSelectedProduct(affiliation)}
                    data-testid={`card-affiliation-${affiliation.id}`}
                  >
                    <div className="aspect-square w-full overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center relative">
                      {affiliation.productImage ? (
                        <img 
                          src={resolveImageUrl(affiliation.productImage) || ''} 
                          alt={affiliation.productName}
                          className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const fallback = target.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div className={`${affiliation.productImage ? 'hidden' : 'flex'} items-center justify-center w-full h-full`}>
                        <Package className="h-8 w-8 text-gray-400" />
                      </div>
                      <div className="absolute top-1.5 right-1.5">
                        <Badge 
                          variant={affiliation.status === 'approved' ? 'default' : 'secondary'}
                          className={`text-[9px] ${affiliation.status === 'approved' ? 'bg-[#2563eb] text-white' : 'bg-yellow-500 text-white'}`}
                        >
                          {affiliation.status === 'approved' ? 'Aprovado' : 'Pendente'}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-2.5 sm:p-3">
                      <h3 className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-white line-clamp-2 h-8 sm:h-10 leading-4 sm:leading-5">
                        {affiliation.productName || 'Produto'}
                      </h3>
                      <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate mt-1 h-4">
                        <span className="text-[#2563eb]">Empresa:</span> {affiliation.sellerName || 'Vendedor'}
                      </p>
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-lime-500/10">
                        <div className="flex flex-col">
                          <span className="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wide">{"Comissão"}</span>
                          <span className="text-xs sm:text-sm font-bold text-green-500 dark:text-blue-400 truncate">
                            R$ {(commissionValue / 100).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex flex-col text-right">
                          <span className="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wide">Valor</span>
                          <span className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white truncate">
                            R$ {(productPrice / 100).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Popup de Detalhes do Produto */}
          <Dialog open={!!selectedProduct} onOpenChange={() => setSelectedProduct(null)}>
            <DialogContent className="sm:max-w-2xl bg-[#100C1A] border border-gray-700/50 shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold text-white">
                  Detalhes da Afiliação
                </DialogTitle>
              </DialogHeader>
              
              {selectedProduct && (
                <div className="space-y-4 mt-2">
                  {/* Cabeçalho: Foto e Nome do Produto */}
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 sm:gap-4 p-3 sm:p-4 bg-[#1a1625] rounded-xl border border-gray-700/30">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-gray-700/30 overflow-hidden bg-[#1a1625] flex items-center justify-center flex-shrink-0">
                      {selectedProduct.productImage ? (
                        <img 
                          src={selectedProduct.productImage} 
                          alt={selectedProduct.productName || "Produto"}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Package className="h-8 w-8 text-gray-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-center sm:text-left">
                      <h3 className="text-base font-bold text-white break-words">
                        {selectedProduct.productName || "Produto sem nome"}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                        <User className="h-3 w-3" />
                        {selectedProduct.sellerName || "Vendedor"}
                      </p>
                      <Badge 
                        variant={selectedProduct.status === 'approved' ? 'default' : 'secondary'}
                        className={`mt-2 text-xs ${selectedProduct.status === 'approved' ? 'bg-blue-600 text-white' : 'bg-yellow-600 text-white'}`}
                      >
                        {selectedProduct.status === 'approved' ? (
                          <><Check className="h-3 w-3 mr-1" /> Aprovado</>
                        ) : (
                          <>Pendente</>
                        )}
                      </Badge>
                    </div>
                  </div>

                  {/* Estatísticas - Cards destacados */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-[#1a1625] rounded-lg border border-gray-700/30 text-center">
                      <TrendingUp className="h-4 w-4 text-green-500 mx-auto mb-1" />
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Comissão</p>
                      <p className="text-lg font-bold text-green-500">
                        {selectedProduct.realCommission !== undefined ? selectedProduct.realCommission :
                         selectedProduct.customCommission !== undefined ? selectedProduct.customCommission :
                         selectedProduct.commissionSnapshot?.single !== undefined ? selectedProduct.commissionSnapshot.single :
                         10}%
                      </p>
                    </div>
                    <div className="p-3 bg-[#1a1625] rounded-lg border border-gray-700/30 text-center">
                      <BarChart3 className="h-4 w-4 text-gray-400 mx-auto mb-1" />
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Vendas</p>
                      <p className="text-lg font-bold text-white">
                        {selectedProduct.totalSales || 0}
                      </p>
                    </div>
                    <div className="p-3 bg-[#1a1625] rounded-lg border border-gray-700/30 text-center">
                      <DollarSign className="h-4 w-4 text-gray-400 mx-auto mb-1" />
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Ganhos</p>
                      <p className="text-lg font-bold text-white">
                        R$ {((selectedProduct.totalEarnings || 0) / 100).toFixed(2).replace('.', ',')}
                      </p>
                    </div>
                  </div>

                  {/* Links de Afiliado */}
                  {selectedProduct.status === 'approved' && (
                    <div className="p-4 bg-[#1a1625] border border-gray-700/30 rounded-lg">
                      <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-gray-400" />
                        Links de Afiliado
                      </h4>
                      
                      {selectedProduct.affiliateSalesPageUrl && (
                        <div className="mb-4">
                          <p className="text-xs text-gray-400 mb-2 flex items-center gap-1 font-medium">
                            <Globe className="h-3.5 w-3.5" /> Link da Página de Vendas
                          </p>
                          <div className="p-2.5 bg-black/30 border border-gray-600/40 rounded-md mb-2">
                            <p className="text-[11px] text-[#2563eb] break-all font-mono" data-testid="text-sales-page-url">
                              {selectedProduct.affiliateSalesPageUrl.startsWith('http') 
                                ? selectedProduct.affiliateSalesPageUrl 
                                : `${window.location.origin}${selectedProduct.affiliateSalesPageUrl}`}
                            </p>
                          </div>
                          <Button
                            variant="default"
                            size="sm"
                            className="w-full bg-[#2563eb] hover:bg-[#374800] text-white text-xs"
                            data-testid="button-copy-main-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyAffiliateLink(selectedProduct.affiliateSalesPageUrl, 'Página de Vendas');
                            }}
                          >
                            {copiedLink === selectedProduct.affiliateSalesPageUrl ? (
                              <><Check className="h-3 w-3 mr-2" /> Copiado!</>
                            ) : (
                              <><Copy className="h-3 w-3 mr-2" /> Copiar Link Principal</>
                            )}
                          </Button>
                        </div>
                      )}

                      {selectedProduct.offerUrls && selectedProduct.offerUrls.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-3 pt-3 border-t border-gray-700/30 font-medium">
                            <ShoppingCart className="h-3.5 w-3.5" /> Links diretos por oferta
                          </p>
                          {selectedProduct.offerUrls.map((offerUrl: any) => (
                            <div key={offerUrl.offerId} className="p-3 bg-black/20 border border-gray-700/30 rounded-md" data-testid={`offer-link-${offerUrl.offerId}`}>
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-1.5">
                                <span className="text-xs text-white font-medium break-words">{offerUrl.offerName}</span>
                                {offerUrl.priceFormatted && (
                                  <span className="text-[10px] text-gray-400 flex-shrink-0">{offerUrl.priceFormatted}</span>
                                )}
                              </div>
                              <div className="p-2 bg-black/30 border border-gray-600/30 rounded mb-2">
                                <p className="text-[11px] text-[#2563eb] break-all font-mono">
                                  {offerUrl.affiliateUrl.startsWith('http') 
                                    ? offerUrl.affiliateUrl 
                                    : `${window.location.origin}${offerUrl.affiliateUrl}`}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs border-gray-600 text-white"
                                data-testid={`button-copy-offer-${offerUrl.offerId}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyAffiliateLink(offerUrl.affiliateUrl, offerUrl.offerName);
                                }}
                              >
                                {copiedLink === offerUrl.affiliateUrl ? (
                                  <><Check className="h-3 w-3 mr-2" /> Copiado!</>
                                ) : (
                                  <><Copy className="h-3 w-3 mr-2" /> Copiar Link</>
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Sem links configurados */}
                      {!selectedProduct.affiliateSalesPageUrl && (!selectedProduct.offerUrls || selectedProduct.offerUrls.length === 0) && (
                        <div className="flex items-start gap-2 p-3 bg-yellow-900/20 border border-yellow-600/20 rounded-lg">
                          <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs text-yellow-400 font-medium">Links ainda não configurados</p>
                            <p className="text-[10px] text-yellow-300/60 mt-0.5">
                              O vendedor ainda não configurou os links de afiliado para este produto.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status Pendente */}
                  {selectedProduct.status === 'pending' && (
                    <div className="p-4 bg-yellow-900/20 border border-yellow-600/20 rounded-lg">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-yellow-600/20 flex items-center justify-center flex-shrink-0">
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-yellow-400">Aguardando Aprovação</p>
                          <p className="text-xs text-yellow-300/60 mt-1">
                            Sua solicitação está sendo analisada pelo vendedor. Os links de afiliado estarão disponíveis após a aprovação.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Suporte ao Afiliado - Sempre visível */}
                  <div className="p-4 bg-[#1a1625] border border-gray-700/30 rounded-lg">
                    <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4 text-gray-400" />
                      Suporte ao Afiliado
                    </h4>
                    
                    {selectedProduct.supportData && (selectedProduct.supportData.name || selectedProduct.supportData.email || selectedProduct.supportData.phone || selectedProduct.supportData.salesPage) ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {selectedProduct.supportData.name && (
                          <div className="flex items-center gap-2 text-xs">
                            <User className="h-3.5 w-3.5 text-gray-500" />
                            <span className="text-gray-400">Responsável:</span>
                            <span className="text-gray-200">{selectedProduct.supportData.name}</span>
                          </div>
                        )}
                        {selectedProduct.supportData.email && (
                          <div className="flex items-center gap-2 text-xs">
                            <Mail className="h-3.5 w-3.5 text-gray-500" />
                            <span className="text-gray-400">E-mail:</span>
                            <a href={`mailto:${selectedProduct.supportData.email}`} className="text-white hover:underline">{selectedProduct.supportData.email}</a>
                          </div>
                        )}
                        {selectedProduct.supportData.phone && (
                          <div className="flex items-center gap-2 text-xs">
                            <Phone className="h-3.5 w-3.5 text-gray-500" />
                            <span className="text-gray-400">Telefone:</span>
                            <span className="text-white">{selectedProduct.supportData.phone}</span>
                          </div>
                        )}
                        {selectedProduct.supportData.salesPage && (
                          <div className="flex items-center gap-2 text-xs sm:col-span-2">
                            <Globe className="h-3.5 w-3.5 text-gray-500" />
                            <span className="text-gray-400">Página:</span>
                            <a 
                              href={selectedProduct.supportData.salesPage} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-white hover:underline truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {selectedProduct.supportData.salesPage}
                            </a>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 italic">
                        Informações de suporte não configuradas pelo vendedor.
                      </p>
                    )}
                  </div>

                  {/* Regras do Programa - Sempre visível */}
                  <div className="p-4 bg-[#1a1625] border border-gray-700/30 rounded-lg">
                    <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-gray-400" />
                      Regras do Programa
                    </h4>
                    {selectedProduct.affiliateRules ? (
                      <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
                        {selectedProduct.affiliateRules}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 italic">
                        Nenhuma regra específica definida pelo vendedor.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </DashboardLayout>
  );
}
