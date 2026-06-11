import { useCurrencyRates } from "@/hooks/use-currency-rates";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Loader2, AlertTriangle } from "lucide-react";

interface CurrencyConverterDisplayProps {
  amount: number;
  fromCurrency: string;
  className?: string;
  showBadge?: boolean;
  showRate?: boolean;
}

export const CurrencyConverterDisplay = ({ 
  amount, 
  fromCurrency, 
  className = "", 
  showBadge = true,
  showRate = false 
}: CurrencyConverterDisplayProps) => {
  const { rates, loading, error, formatCurrencyWithConversion } = useCurrencyRates();

  // Se é BRL, no mostrar conversão
  if (fromCurrency === 'BRL') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-2xl font-bold text-gray-900">
          {new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          }).format(amount / 100)}
        </span>
        {showBadge && (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
             Brasil
          </Badge>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="text-gray-600">Carregando conversão...</span>
      </div>
    );
  }

  if (error || !rates) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <AlertTriangle className="h-5 w-5 text-yellow-500" />
        <span className="text-gray-600">
          {new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: fromCurrency
          }).format(amount / 100)}
        </span>
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
           Global
        </Badge>
      </div>
    );
  }

  const convertedAmount = (amount * rates[fromCurrency as keyof typeof rates]);
  const exchangeRate = rates[fromCurrency as keyof typeof rates];

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Valor Original */}
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-gray-900">
          {new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: fromCurrency
          }).format(amount / 100)}
        </span>
        {showBadge && (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
             Global
          </Badge>
        )}
      </div>
      
      {/* Valor Convertido */}
      <div className="flex items-center gap-2 text-gray-600">
        <TrendingUp className="h-4 w-4" />
        <span className="text-lg font-semibold">
          {new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          }).format(convertedAmount / 100)}
        </span>
        <span className="text-sm text-gray-500">em reais</span>
      </div>

      {/* Taxa de Cmbio */}
      {showRate && (
        <div className="text-xs text-gray-400">
          1 {fromCurrency} = {exchangeRate.toFixed(4)} BRL
        </div>
      )}
    </div>
  );
};