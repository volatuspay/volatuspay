import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Smartphone, 
  CreditCard, 
  Globe, 
  Clock, 
  ArrowUpCircle,
  TrendingUp,
  Calendar,
  FileText
} from "lucide-react";
import { formatBRL } from "@/lib/utils";

interface BalanceCardsProps {
  balances: {
    pix: { available: number; processing: number };
    cardBR: { available: number; processing: number };
    cardGlobal: { available: number; processing: number };
    boleto?: { available: number; processing: number };
  };
  onWithdraw: (type: 'pix' | 'cardBR' | 'cardGlobal' | 'boleto') => void;
  isLoading?: boolean;
}

export default function BalanceCards({ balances, onWithdraw, isLoading }: BalanceCardsProps) {
  const boletoBalance = balances.boleto || { available: 0, processing: 0 };
  
  const totalAvailable = balances.pix.available + balances.cardBR.available + balances.cardGlobal.available + boletoBalance.available;
  const totalProcessing = balances.pix.processing + balances.cardBR.processing + balances.cardGlobal.processing + boletoBalance.processing;
  const grandTotal = totalAvailable + totalProcessing;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-3">
              <div className="h-4 bg-muted rounded w-3/4"></div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="h-6 bg-muted rounded w-full"></div>
                <div className="h-4 bg-muted rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <TrendingUp className="w-5 h-5" />
            Resumo Financeiro Total
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground font-medium">Disponivel para Saque</p>
              <p className="text-2xl font-bold text-foreground">
                {formatBRL(totalAvailable)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground font-medium">Em Processamento</p>
              <p className="text-2xl font-bold text-foreground">
                {formatBRL(totalProcessing)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground font-medium">Total Geral</p>
              <p className="text-2xl font-bold text-foreground">
                {formatBRL(grandTotal)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* PIX - Verde */}
        <Card className="border border-blue-200 dark:border-green-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-foreground">
                <Smartphone className="w-5 h-5 text-blue-600" />
                PIX
              </div>
              <Badge variant="outline" className="border-green-300 text-blue-700 dark:border-green-700 dark:text-blue-400">
                Imediato
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Bloqueado (a liberar)</p>
                <p className="text-lg font-semibold text-foreground">
                  {formatBRL(balances.pix.processing)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Disponivel p/ saque</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatBRL(balances.pix.available)}
                </p>
              </div>
              <Button
                onClick={() => onWithdraw('pix')}
                disabled={balances.pix.available <= 0}
                className="w-full bg-blue-600 hover:bg-green-700"
                size="sm"
              >
                <ArrowUpCircle className="w-4 h-4 mr-2" />
                Sacar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cartao BR - Roxo padrao */}
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-foreground">
                <CreditCard className="w-5 h-5" />
                Cartao BR
              </div>
              <Badge variant="outline">
                D+20
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Bloqueado (a liberar)</p>
                <p className="text-lg font-semibold text-foreground">
                  {formatBRL(balances.cardBR.processing)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Disponivel p/ saque</p>
                <p className="text-xl font-bold text-foreground">
                  {formatBRL(balances.cardBR.available)}
                </p>
              </div>
              <Button
                onClick={() => onWithdraw('cardBR')}
                disabled={balances.cardBR.available <= 0}
                className="w-full"
                size="sm"
              >
                <ArrowUpCircle className="w-4 h-4 mr-2" />
                Sacar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cartao Global - Roxo padrao */}
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-foreground">
                <Globe className="w-5 h-5" />
                Cartao Global
              </div>
              <Badge variant="outline">
                D+7
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Bloqueado (a liberar)</p>
                <p className="text-lg font-semibold text-foreground">
                  {formatBRL(balances.cardGlobal.processing)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Disponivel p/ saque</p>
                <p className="text-xl font-bold text-foreground">
                  {formatBRL(balances.cardGlobal.available)}
                </p>
              </div>
              <Button
                onClick={() => onWithdraw('cardGlobal')}
                disabled={balances.cardGlobal.available <= 0}
                className="w-full"
                size="sm"
              >
                <ArrowUpCircle className="w-4 h-4 mr-2" />
                Sacar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Boleto - Roxo padrao */}
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-foreground">
                <FileText className="w-5 h-5" />
                Boleto
              </div>
              <Badge variant="outline">
                D+3
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Bloqueado (a liberar)</p>
                <p className="text-lg font-semibold text-foreground">
                  {formatBRL(boletoBalance.processing)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Disponivel p/ saque</p>
                <p className="text-xl font-bold text-foreground">
                  {formatBRL(boletoBalance.available)}
                </p>
              </div>
              <Button
                onClick={() => onWithdraw('boleto')}
                disabled={boletoBalance.available <= 0}
                className="w-full"
                size="sm"
              >
                <ArrowUpCircle className="w-4 h-4 mr-2" />
                Sacar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-full bg-muted">
              <Calendar className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">
                Prazos de Liberacao de Saldo
              </h4>
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>PIX:</strong> Liberado imediatamente apos confirmacao</p>
                <p><strong>Cartao BR:</strong> Liberado apos 20 dias corridos (D+20)</p>
                <p><strong>Cartao Global:</strong> Liberado apos 7 dias corridos (D+7)</p>
                <p><strong>Boleto:</strong> Liberado apos 3 dias uteis (D+3)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
