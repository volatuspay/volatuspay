import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, CreditCard, Smartphone, DollarSign, Truck, Repeat, Clock, Eye, MessageCircle } from "lucide-react";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatBRL } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface SalesCardProps {
  sale: {
    id: string;
    customer: {
      name: string;
      email: string;
      phone?: string;
    };
    amount: number;
    method: 'pix' | 'card';
    processor?: 'efibank' | 'stripe';
    status: string;
    createdAt: Date;
    paidAt?: Date;
    type: 'order';
    productType: 'digital' | 'subscription';
    checkoutTitle?: string;
    checkoutId?: string;
    productId?: string;
    financialData?: {
      grossAmount: number;
      feeAmount: number;
      netAmount: number;
      releaseDate: Date;
      released: boolean;
      feeBreakdown: {
        fixedFee: number;
        percentFee: number;
        percentAmount: number;
      };
    };
    // DADOS ESPECFICOS POR TIPO
    subscription?: {
      id: string;
      period: string;
      nextBillingDate?: Date;
      status: string;
    };
  };
}

export default function SalesCard({ sale }: SalesCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // CORES POR TIPO DE PRODUTO
  const getProductTypeColor = (_productType: string) => {
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  //  CORES POR MTODO DE PAGAMENTO
  const getPaymentMethodColor = (method: string, processor?: string) => {
    if (method === 'pix') {
      return 'bg-gray-100 text-gray-800 border-gray-200';
    } else if (method === 'card') {
      if (processor === 'stripe') {
        return 'bg-gray-100 text-gray-800 border-gray-200';
      } else {
        return 'bg-gray-100 text-gray-800 border-gray-200';
      }
    }
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  //  CALCULAR TAXA E PRAZO DE LIBERAÇÃO (PADRÃO)
  const calculateReleaseInfo = () => {
    if (!sale.financialData) {
      // FALLBACK: Clculo padrão se no houver dados financeiros salvos
      let feeAmount = 0;
      let releaseDays = 0;
      
      if (sale.method === 'pix') {
        const fixedFee = 249; // R$ 2,49
        const percentFee = Math.round(sale.amount * 0.02); // 2%
        feeAmount = fixedFee + percentFee;
        releaseDays = 0; // Imediato
      } else if (sale.method === 'card') {
        if (sale.processor === 'stripe') {
          const percentFee = Math.round(sale.amount * 0.064); // 6.4%
          const fixedFee = 150; // ~U$0.30
          feeAmount = percentFee + fixedFee;
          releaseDays = 7; // D+7
        } else {
          const fixedFee = 249; // R$ 2,49
          const percentFee = Math.round(sale.amount * 0.052); // 5.2%
          feeAmount = fixedFee + percentFee;
          releaseDays = 20; // D+20 (novo padrão)
        }
      }
      
      const referenceDate = sale.paidAt || sale.createdAt;
      const releaseDate = addDays(referenceDate, releaseDays);
      const netAmount = sale.amount - feeAmount;
      
      return {
        feeAmount,
        netAmount,
        releaseDate,
        releaseDays,
        released: new Date() >= releaseDate
      };
    }
    
    // Usar dados financeiros salvos
    return {
      feeAmount: sale.financialData.feeAmount,
      netAmount: sale.financialData.netAmount,
      releaseDate: sale.financialData.releaseDate,
      releaseDays: Math.ceil(
        (sale.financialData.releaseDate.getTime() - (sale.paidAt || sale.createdAt).getTime()) / 
        (1000 * 60 * 60 * 24)
      ),
      released: sale.financialData.released
    };
  };

  const releaseInfo = calculateReleaseInfo();

  //  CONES POR TIPO DE PRODUTO
  const getProductIcon = (productType: string) => {
    switch (productType) {
      case 'subscription':
        return <Repeat className="w-4 h-4" />;
      case 'digital':
      default:
        return <Smartphone className="w-4 h-4" />;
    }
  };

  //  CONE POR MTODO DE PAGAMENTO
  const getPaymentIcon = (method: string) => {
    return method === 'pix' ? 
      <Smartphone className="w-4 h-4" /> : 
      <CreditCard className="w-4 h-4" />;
  };

  // HANDLER WHATSAPP
  const handleWhatsAppClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sale.customer.phone) {
      alert('Cliente não possui telefone cadastrado');
      return;
    }
    const phone = sale.customer.phone.replace(/\D/g, '');
    const message = encodeURIComponent(`Ol${sale.customer.name}! Temos uma atualização sobre seu pedido ${sale.id.slice(-8).toUpperCase()}.`);
    window.open(`https://wa.me/55${phone}?text=${message}`, '_blank');
  };

  return (
    <Card className="group w-full transition-all duration-200 hover:bg-blue-50/30 dark:hover:bg-[#f0f4ff]/20 hover:border-blue-200 dark:hover:border-[#f0f4ff]">
      <CardContent className="p-4">
        {/* HEADER COMPACTO + CONES */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{sale.customer.name}</div>
            <Badge 
              variant="outline" 
              className={`text-xs px-2 py-0.5 flex-shrink-0 ${getProductTypeColor(sale.productType)}`}
            >
              {getProductIcon(sale.productType)}
              <span className="ml-1">
                {sale.productType === 'subscription' ? 'Assinatura' : 'Digital'}
              </span>
            </Badge>
          </div>

          {/* CONES DE AÇÃO */}
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
            <Badge 
              variant="outline" 
              className={`text-xs px-2 py-0.5 ${getPaymentMethodColor(sale.method, sale.processor)}`}
            >
              {getPaymentIcon(sale.method)}
              <span className="ml-1">
                {sale.method === 'pix' ? 'PIX' : 
                 sale.processor === 'stripe' ? 'Global' : 'BR'}
              </span>
            </Badge>

            {/* BOTÃO WHATSAPP */}
            {sale.customer.phone && (
              <button
                onClick={handleWhatsAppClick}
                className="p-1.5 hover:bg-blue-100 dark:hover:bg-[#f0f4ff]/30 rounded-full transition-all duration-200 hover:scale-110 flex-shrink-0"
                title="Enviar mensagem no WhatsApp"
              >
                <MessageCircle className="w-4 h-4 text-[#2563eb] dark:text-blue-400" />
              </button>
            )}

            {/* BOTÃO OLHINHO (DETALHES) */}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <button
                  className="p-1.5 hover:bg-blue-100 dark:hover:bg-[#f0f4ff]/30 rounded-full transition-all duration-200 hover:scale-110 flex-shrink-0"
                  title="Ver detalhes da venda"
                >
                  <Eye className="w-4 h-4 text-[#2563eb] dark:text-blue-400" />
                </button>
              </DialogTrigger>
              
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white dark:bg-transparent">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold bg-gradient-to-r from-[#2563eb] to-violet-400 bg-clip-text text-transparent">
                    Detalhes da Venda
                  </DialogTitle>
                  <DialogDescription>
                    Informações completas sobre o cliente, produto e valores desta transação
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 mt-4">
                  {/* IDENTIFICAÇÃO */}
                  <div className="p-4 bg-gradient-to-br from-lime-50 to-white dark:from-[#f0f4ff]/20 dark:to-gray-900 rounded-lg border border-blue-200/40">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Identificao</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500">ID da Venda:</span>
                        <p className="font-mono font-medium">{sale.id}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">ID Checkout:</span>
                        <p className="font-mono font-medium">{sale.checkoutId || 'N/A'}</p>
                      </div>
                      {sale.productId && (
                        <div className="col-span-2">
                          <span className="text-gray-500">ID Produto:</span>
                          <p className="font-mono font-medium">{sale.productId}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* CLIENTE */}
                  <div className="p-4 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-black rounded-lg border border-gray-200/40">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Dados do Cliente</h3>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-500">Nome:</span>
                        <p className="font-medium">{sale.customer.name}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Email:</span>
                        <p className="font-medium">{sale.customer.email}</p>
                      </div>
                      {sale.customer.phone && (
                        <div>
                          <span className="text-gray-500">Telefone:</span>
                          <p className="font-medium">{sale.customer.phone}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* PRODUTO */}
                  <div className="p-4 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-black rounded-lg border border-gray-200/40">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Produto</h3>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-500">Nome:</span>
                        <p className="font-medium">{sale.checkoutTitle || 'Produto'}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Tipo:</span>
                        <p className="font-medium capitalize">{sale.productType}</p>
                      </div>
                    </div>
                  </div>

                  {/* FINANCEIRO */}
                  <div className="p-4 bg-gradient-to-br from-lime-50 to-white dark:from-[#f0f4ff]/20 dark:to-gray-900 rounded-lg border border-blue-200/40">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Dados Financeiros</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Valor Bruto:</span>
                        <p className="font-bold text-gray-900 dark:text-white">{formatBRL(sale.amount)}</p>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Taxa:</span>
                        <p className="font-medium text-red-600">-{formatBRL(releaseInfo.feeAmount)}</p>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-blue-200/40">
                        <span className="text-gray-700 dark:text-gray-300 font-semibold">Valor Lquido:</span>
                        <p className="font-bold text-[#2563eb]">{formatBRL(releaseInfo.netAmount)}</p>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Método:</span>
                        <p className="font-medium">{sale.method === 'pix' ? 'PIX' : `Cartão (${sale.processor === 'stripe' ? 'Global' : 'BR'})`}</p>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Status:</span>
                        <Badge className={sale.status === 'paid' ? 'bg-blue-100 text-[#f0f4ff] border-blue-200' : 'bg-yellow-100 text-yellow-800 border-yellow-200'}>
                          {sale.status === 'paid' ? 'Pago' : 'Pendente'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Data de Liberação:</span>
                        <p className="font-medium">{format(releaseInfo.releaseDate, "dd/MM/yyyy", { locale: ptBR })}</p>
                      </div>
                    </div>
                  </div>

                  {/* DADOS ESPECÍFICOS: ASSINATURA */}
                  {sale.productType === 'subscription' && sale.subscription && (
                    <div className="p-4 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-black rounded-lg border border-gray-200/40">
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Dados da Assinatura</h3>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-500">ID Assinatura:</span>
                          <p className="font-mono font-medium">{sale.subscription.id}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Período:</span>
                          <p className="font-medium">{sale.subscription.period}</p>
                        </div>
                        {sale.subscription.nextBillingDate && (
                          <div>
                            <span className="text-gray-500">Próxima Cobrança:</span>
                            <p className="font-medium">{format(sale.subscription.nextBillingDate, "dd/MM/yyyy", { locale: ptBR })}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">Status:</span>
                          <Badge>{sale.subscription.status}</Badge>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* DATAS */}
                  <div className="p-4 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-black rounded-lg border border-gray-200/40">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Datas</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Criado em:</span>
                        <p className="font-medium">{format(sale.createdAt, "dd/MM/yyyy 's' HH:mm", { locale: ptBR })}</p>
                      </div>
                      {sale.paidAt && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Pago em:</span>
                          <p className="font-medium">{format(sale.paidAt, "dd/MM/yyyy 's' HH:mm", { locale: ptBR })}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* ID DA TRANSAÇÃO E DATA/HORA */}
        <div className="flex items-center justify-between text-xs text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-200 mb-3 transition-colors">
          <div className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded group-hover:bg-blue-100 dark:group-hover:bg-[#f0f4ff]/30 transition-colors">
            ID: {sale.id.slice(-8).toUpperCase()}
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {format(sale.paidAt || sale.createdAt, "dd/MM/yy HH:mm", { locale: ptBR })}
          </div>
        </div>

        {/* VALORES FINANCEIROS INLINE */}
        <div className="flex items-center justify-between text-sm mb-2 transition-colors">
          <div className="text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-white">
            <span className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-black dark:group-hover:text-white">{formatBRL(sale.amount)}</span>
            <span className="text-muted-foreground ml-2 group-hover:text-gray-700 dark:group-hover:text-gray-200">-{formatBRL(releaseInfo.feeAmount)}</span>
          </div>
          <div className="font-semibold text-muted-foreground group-hover:text-[#374800] dark:group-hover:text-[#2563eb] transition-colors">
            {formatBRL(releaseInfo.netAmount)}
          </div>
        </div>

        {/* STATUS E LIBERAÇÃO COMPACTO */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200 truncate max-w-[60%] transition-colors">
            {sale.customer.email}
          </div>
          <div className="flex items-center gap-1">
            {releaseInfo.released ? (
              <Badge className="bg-blue-100 text-muted-foreground border-blue-200 text-xs px-2 py-0.5">
                Liberado
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground border-amber-200 bg-blue-50 text-xs px-2 py-0.5">
                D+{releaseInfo.releaseDays}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
