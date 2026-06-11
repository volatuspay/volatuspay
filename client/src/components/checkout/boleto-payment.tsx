import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Copy, Check, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { 
  Checkout, 
  Customer, 
  CreatePaymentSessionResponse 
} from "@shared/schema";
import { APP_CONFIG } from "@/lib/config";
import { pixelTracker } from "@/lib/pixel-tracking";

interface BoletoPaymentProps {
  checkout: Checkout;
  customer: Customer;
  amount: number;
  addressData?: {
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  onPaymentData: (data: CreatePaymentSessionResponse) => void;
  affiliateUid?: string | null;
  offerSlug?: string;
  couponCode?: string;
  selectedOrderBumps?: string[];
}

export function BoletoPayment({ 
  checkout, 
  customer, 
  amount, 
  addressData, 
  onPaymentData,
  affiliateUid,
  offerSlug,
  couponCode,
  selectedOrderBumps = []
}: BoletoPaymentProps) {
  const [loading, setLoading] = useState(false);
  const [boletoUrl, setBoletoUrl] = useState<string | null>(null);
  const [boletoBarcode, setBoletoBarcode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const generateBoleto = async () => {
    if (loading) return;

    pixelTracker.trackAddPaymentInfo(amount, checkout?.globalSettings?.currency || checkout?.currency || 'BRL', 'boleto');
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('GERANDO BOLETO - PRODUTO:', checkout.productType);
      console.log('Valor:', amount);
      console.log('Cliente:', customer.name);
      
      const apiUrl = `${APP_CONFIG.getApiUrl('/api/payment/create-session')}`;
      
      if (!checkout?.id) {
        throw new Error('Checkout ID não encontrado');
      }
      
      if (!customer?.name || !customer?.email || !customer?.document) {
        throw new Error('Dados do cliente incompletos');
      }
      
      const trackingParams = (() => {
        try {
          const p = new URLSearchParams(window.location.search);
          return {
            src: p.get('src') || null, sck: p.get('sck') || null,
            utm_source: p.get('utm_source') || null, utm_campaign: p.get('utm_campaign') || null,
            utm_medium: p.get('utm_medium') || null, utm_content: p.get('utm_content') || null,
            utm_term: p.get('utm_term') || null,
          };
        } catch { return undefined; }
      })();

      // Resolver checkoutId por slug (igual ao PIX) para o servidor encontrar o checkout
      const urlParts = window.location.pathname.split('/');
      const checkoutIdx = urlParts.findIndex(p => p === 'checkout' || p === 'c');
      const urlSlug = checkoutIdx >= 0 ? urlParts[checkoutIdx + 1] : null;
      const resolvedCheckoutId = checkout.slug || urlSlug || checkout.id;

      const payload = {
        checkoutId: resolvedCheckoutId,
        method: 'boleto',
        customer: {
          name: customer.name,
          email: customer.email,
          document: customer.document,
          phone: customer.phone || ''
        },
        amount,
        productType: checkout.productType || 'digital',
        customerAddress: addressData,
        affiliateUid: affiliateUid || (typeof window !== 'undefined' ? 
          localStorage.getItem('affiliate_uid') : null),
        offerSlug: offerSlug || undefined,
        couponCode: couponCode || undefined,
        selectedOrderBumps: selectedOrderBumps.length > 0 ? selectedOrderBumps : [],
        trackingParameters: trackingParams
      };
      
      console.log('Enviando requisio para:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Erro HTTP:', response.status, errorText);
        throw new Error(`Erro ao gerar boleto: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Boleto gerado com sucesso:', data);
      
      if (data.boletoUrl) {
        setBoletoUrl(data.boletoUrl);
      }
      
      if (data.boletoBarcode) {
        setBoletoBarcode(data.boletoBarcode);
      }
      
      onPaymentData(data);
      
      toast({
        title: "Boleto gerado com sucesso!",
        description: "Vocpode visualizar e pagar seu boleto agora.",
      });
      
    } catch (err) {
      console.error('Erro ao gerar boleto:', err);
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      
      toast({
        title: "Erro ao gerar boleto",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const copyBarcode = async () => {
    if (!boletoBarcode) return;
    
    try {
      await navigator.clipboard.writeText(boletoBarcode);
      setCopied(true);
      toast({
        title: "Código copiado!",
        description: "Cole no app do seu banco para pagar",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Erro ao copiar",
        description: "Tente copiar manualmente",
        variant: "destructive"
      });
    }
  };

  if (!boletoUrl) {
    return (
      <div className="space-y-4">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <FileText className="h-12 w-12 mx-auto text-gray-500 mb-3" />
          <p className="text-sm text-center text-gray-900 mb-2">
            Clique no botão abaixo para gerar seu boleto bancário
          </p>
          <p className="text-xs text-center text-gray-600">
            Após gerar, você poderá pagar em qualquer banco, lotérica ou app bancário
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-medium">Erro</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        )}

        <Button
          onClick={generateBoleto}
          disabled={loading}
          className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-semibold"
          data-testid="button-confirm-generate-boleto"
        >
          {loading ? (
            <>Gerando boleto...</>
          ) : (
            <>
              <FileText className="w-5 h-5 mr-2" />
              Confirmar e Gerar Boleto
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sucesso */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
        <Check className="h-12 w-12 mx-auto text-emerald-600 mb-2" />
        <h3 className="font-semibold text-gray-900 mb-1">Boleto Gerado!</h3>
        <p className="text-sm text-gray-700">
          Pague em até 3 dias úteis para garantir seu pedido
        </p>
      </div>

      {/* Código de Barras */}
      {boletoBarcode && (
        <div className="border rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-gray-700">Código de Barras:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={boletoBarcode}
              readOnly
              className="flex-1 px-3 py-2 bg-gray-50 border rounded text-sm font-mono"
            />
            <Button
              onClick={copyBarcode}
              variant="outline"
              size="sm"
              className="shrink-0"
              data-testid="button-copy-barcode"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* Link do Boleto */}
      <Button
        onClick={() => window.open(boletoUrl, '_blank')}
        className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-semibold"
        data-testid="button-open-boleto"
      >
        <ExternalLink className="w-5 h-5 mr-2" />
        Abrir Boleto para Pagar
      </Button>

      {/* Instrues */}
      <div className="bg-gray-50 border rounded-lg p-3 text-sm text-gray-700">
        <p className="font-medium mb-2"> Como pagar:</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Copie o código de barras acima</li>
          <li>Abra o app do seu banco</li>
          <li>Procure por "Pagar Boleto"</li>
          <li>Cole o código e confirme o pagamento</li>
        </ol>
      </div>
    </div>
  );
}
