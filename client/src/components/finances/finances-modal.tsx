import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, ArrowRight, Wallet, Clock, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

interface FinancesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FinancesModal({ open, onOpenChange }: FinancesModalProps) {
  const { data: balanceSummary, isLoading: isLoadingBalance } = useQuery<any>({
    queryKey: ['/api/balance/summary'],
    refetchInterval: 120000,
    enabled: open,
  });

  const formatCurrency = (amount: number, currency: 'BRL' | 'USD' | 'EUR') => {
    const value = amount / 100;
    const symbol = currency === 'BRL' ? 'R$' : currency === 'USD' ? '$' : '€';
    return `${symbol} ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const totals = {
    available: balanceSummary?.totals?.BRL?.available ?? 0,
    pending: balanceSummary?.totals?.BRL?.pending ?? 0,
    reserved: balanceSummary?.totals?.BRL?.reserved ?? 0,
    withdrawn: balanceSummary?.totals?.BRL?.withdrawn ?? 0,
  };

  const statsCards = [
    {
      title: "Saldo disponível",
      value: formatCurrency(totals.available, 'BRL'),
      badge: totals.available > 0 ? 'Disponível' : 'Zero',
      badgeVariant: totals.available > 0 ? 'default' : 'secondary' as 'default' | 'secondary',
      icon: Wallet,
      color: "text-[#2563eb]",
    },
    {
      title: "Saldo pendente",
      value: formatCurrency(totals.pending, 'BRL'),
      icon: Clock,
      color: "text-yellow-600",
    },
    {
      title: "Saldo reservado",
      value: formatCurrency(totals.reserved, 'BRL'),
      tooltip: "Saldo em processo de saque",
      icon: Lock,
      color: "text-blue-600",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <DollarSign className="h-6 w-6 text-primary" />
            Resumo Financeiro
          </DialogTitle>
          <DialogDescription>
            Visualize seus saldos em tempo real e gerencie suas finanças
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {isLoadingBalance ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[0,1,2].map(i => (
                  <Card key={i} className="bg-white border border-gray-200">
                    <CardContent className="p-6 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-lg bg-gray-200 animate-pulse" />
                        <div className="h-3 w-24 rounded bg-gray-200 animate-pulse" />
                      </div>
                      <div className="h-7 w-32 rounded bg-gray-200 animate-pulse" />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card className="bg-white border border-gray-200">
                <CardContent className="p-6 space-y-3">
                  <div className="h-4 w-40 rounded bg-gray-200 animate-pulse" />
                  {[0,1,2].map(i => (
                    <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
                  ))}
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {statsCards.map((stat, index) => {
                  const Icon = stat.icon;
                  return (
                    <Card key={index} className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className={`p-2 rounded-lg bg-gray-100 ${stat.color}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <h3 className="text-sm font-medium text-gray-600">
                              {stat.title}
                            </h3>
                          </div>
                          {stat.badge && (
                            <Badge 
                              variant={stat.badgeVariant || 'secondary'}
                              className="text-xs"
                            >
                              {stat.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-2xl font-bold text-gray-900 mb-1">
                          {stat.value}
                        </p>
                        {stat.tooltip && (
                          <p className="text-xs text-gray-500">
                            {stat.tooltip}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {balanceSummary?.breakdown && (
                <Card className="bg-white border border-gray-200 shadow-sm">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Saldo por Adquirente
                    </h3>
                    <Tabs defaultValue="BRL" className="w-full">
                      <TabsList className="grid w-full grid-cols-3 mb-4">
                        <TabsTrigger value="BRL">BRL (R$)</TabsTrigger>
                        <TabsTrigger value="USD">USD ($)</TabsTrigger>
                        <TabsTrigger value="EUR">EUR (€)</TabsTrigger>
                      </TabsList>

                      <TabsContent value="BRL" className="space-y-4">
                        {Object.entries(balanceSummary?.breakdown?.BRL ?? {}).map(([method, acquirers]: [string, any]) => (
                          <div key={method} className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-700 capitalize">
                              {method === 'pix' ? 'PIX' : method === 'creditCard' ? 'Cartão de Crédito' : 'Boleto'}
                            </h4>
                            {Array.isArray(acquirers) && acquirers.length > 0 ? (
                              <div className="space-y-2">
                                {acquirers.map((acq: any) => (
                                  <div 
                                    key={acq.acquirer}
                                    className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex-1">
                                      <p className="font-medium text-gray-900 uppercase text-sm">
                                        {acq.acquirer}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        {acq.transactionCount || 0} transaç{acq.transactionCount === 1 ? 'ão' : 'ões'}
                                      </p>
                                    </div>
                                    <div className="text-right space-y-1">
                                      <p className="text-sm text-gray-600">
                                        Disp: <span className="font-semibold text-[#2563eb]">
                                          {formatCurrency(acq.available || 0, 'BRL')}
                                        </span>
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        Pend: {formatCurrency(acq.pending || 0, 'BRL')}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">
                                Nenhuma transação registrada
                              </p>
                            )}
                          </div>
                        ))}
                        {Object.keys(balanceSummary?.breakdown?.BRL ?? {}).length === 0 && (
                          <p className="text-center text-gray-500 py-6">
                            Nenhuma transação BRL registrada
                          </p>
                        )}
                      </TabsContent>

                      <TabsContent value="USD" className="space-y-4">
                        {balanceSummary?.breakdown?.USD?.creditCard && Array.isArray(balanceSummary?.breakdown?.USD?.creditCard) && balanceSummary.breakdown.USD.creditCard.length > 0 ? (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-700">
                              Cartão de Crédito Internacional
                            </h4>
                            {balanceSummary.breakdown.USD.creditCard.map((acq: any) => (
                              <div 
                                key={acq.acquirer}
                                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex-1">
                                  <p className="font-medium text-gray-900 uppercase text-sm">
                                    {acq.acquirer}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {acq.transactionCount || 0} transaç{acq.transactionCount === 1 ? 'ão' : 'ões'}
                                  </p>
                                </div>
                                <div className="text-right space-y-1">
                                  <p className="text-sm text-gray-600">
                                    Disp: <span className="font-semibold text-[#2563eb]">
                                      {formatCurrency(acq.available || 0, 'USD')}
                                    </span>
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    Pend: {formatCurrency(acq.pending || 0, 'USD')}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-center text-gray-500 py-6">
                            Nenhuma transação USD registrada
                          </p>
                        )}
                      </TabsContent>

                      <TabsContent value="EUR" className="space-y-4">
                        {balanceSummary?.breakdown?.EUR?.creditCard && Array.isArray(balanceSummary?.breakdown?.EUR?.creditCard) && balanceSummary.breakdown.EUR.creditCard.length > 0 ? (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-700">
                              Cartão de Crédito Internacional
                            </h4>
                            {balanceSummary.breakdown.EUR.creditCard.map((acq: any) => (
                              <div 
                                key={acq.acquirer}
                                className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex-1">
                                  <p className="font-medium text-gray-900 uppercase text-sm">
                                    {acq.acquirer}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {acq.transactionCount || 0} transaç{acq.transactionCount === 1 ? 'ão' : 'ões'}
                                  </p>
                                </div>
                                <div className="text-right space-y-1">
                                  <p className="text-sm text-gray-600">
                                    Disp: <span className="font-semibold text-[#2563eb]">
                                      {formatCurrency(acq.available || 0, 'EUR')}
                                    </span>
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    Pend: {formatCurrency(acq.pending || 0, 'EUR')}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-center text-gray-500 py-6">
                            Nenhuma transação EUR registrada
                          </p>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-gray-500">
            Atualizado automaticamente a cada 2 minutos
          </p>
          <Link href="/dashboard/finances" onClick={() => onOpenChange(false)}>
            <Button className="gap-2">
              Ver detalhes completos
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
