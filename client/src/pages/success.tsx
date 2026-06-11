import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ArrowLeft, Home, CreditCard, DollarSign, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { formatBRL } from "@/lib/utils";

export default function SuccessPage() {
  const [, setLocation] = useLocation();
  const [orderInfo, setOrderInfo] = useState<{
    amount?: string;
    method?: string;
    orderId?: string;
    customerName?: string;
    productTitle?: string;
  } | null>(null);

  useEffect(() => {
    // Configurar o ttulo da página
    document.title = "Pagamento Realizado - VolatusPay";
    
    // Extrair informações da URL se disponíveis
    const urlParams = new URLSearchParams(window.location.search);
    const amount = urlParams.get('amount');
    const method = urlParams.get('method');
    const orderId = urlParams.get('orderId');
    const customerName = urlParams.get('customerName');
    const productTitle = urlParams.get('productTitle');
    
    if (amount || method || orderId) {
      setOrderInfo({
        amount: amount || undefined,
        method: method || undefined,
        orderId: orderId || undefined,
        customerName: customerName || undefined,
        productTitle: productTitle || undefined
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        {/* Card Principal de Sucesso */}
        <Card className="border-emerald-200 bg-white shadow-lg" data-testid="success-page">
          <CardContent className="p-8 text-center">
            {/* ícone de sucesso */}
            <div className="w-20 h-20 mx-auto mb-6 bg-emerald-100 rounded-full flex items-center justify-center">
              <Check className="h-10 w-10 text-emerald-700" />
            </div>

            {/* Ttulo */}
            <h1 className="text-2xl font-bold text-muted-foreground mb-3">
              Pagamento Realizado!
            </h1>

            {/* Descrição personalizada com nome do cliente */}
            <p className="text-muted-foreground mb-6 leading-relaxed">
              {orderInfo?.customerName ? (
                <>Ol<span className="font-semibold">{orderInfo.customerName}</span>! Seu pagamento foi processado com sucesso!</>
              ) : (
                "Seu pagamento foi processado com sucesso!"
              )}
              <br />
              Você receberáum email de confirmação em breve.
            </p>

            {/* Botes de ao */}
            <div className="space-y-3">
              <Button 
                onClick={() => setLocation('/dashboard')}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                data-testid="button-dashboard"
              >
                <Home className="w-4 h-4 mr-2" />
                Ir para Dashboard
              </Button>

              <Button 
                onClick={() => setLocation('/')}
                variant="outline"
                className="w-full border-blue-300 text-emerald-700 hover:bg-emerald-50"
                data-testid="button-home"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar ao Início
              </Button>
            </div>

            {/* Nota informativa */}
            <div className="mt-6 pt-4 border-t border-emerald-200">
              <p className="text-sm text-muted-foreground">
                Transação segura processada
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card com Detalhes do Pedido (se disponível) */}
        {orderInfo && (
          <Card className="border-emerald-200 bg-white shadow-md">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                Detalhes do Pagamento
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Valor */}
              {orderInfo.amount && (
                <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Valor Pago:</span>
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                    {formatBRL(parseInt(orderInfo.amount))}
                  </Badge>
                </div>
              )}

              {/* Método de Pagamento */}
              {orderInfo.method && (
                <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Método:
                  </span>
                  <Badge variant="outline" className="capitalize">
                    {orderInfo.method === 'pix' ? 'PIX' : 
                     orderInfo.method === 'card' ? 'Cartão' : 
                     orderInfo.method}
                  </Badge>
                </div>
              )}

              {/* Produto */}
              {orderInfo.productTitle && (
                <div className="p-3 bg-emerald-50 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground mb-2 block">Produto:</span>
                  <p className="text-sm font-semibold text-emerald-700">{orderInfo.productTitle}</p>
                </div>
              )}

              {/* ID do Pedido */}
              {orderInfo.orderId && (
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    ID do Pedido:
                  </span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {orderInfo.orderId.slice(-8).toUpperCase()}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}