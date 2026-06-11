import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Users, Clock, CheckCircle, XCircle, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Contract {
  id: string;
  coproducerName: string;
  coproducerEmail: string;
  commissionPercent: number;
  duration: 'lifetime' | 'period';
  periodEndDate?: any;
  commissionSource: string;
  shareCustomerData: boolean;
  extendCommission: boolean;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  invitedAt: any;
  acceptedAt?: any;
}

interface CoproductionManagementProps {
  checkoutId: string;
}

export function CoproductionManagement({ checkoutId }: CoproductionManagementProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'active' | 'pending'>('active');
  const [contractToCancel, setContractToCancel] = useState<string | null>(null);

  // Buscar contratos
  const { data: contracts = [], isLoading, refetch } = useQuery<Contract[]>({
    queryKey: [`/api/coproduction/my-contracts/${checkoutId}`],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const response = await fetch(`/api/coproduction/my-contracts/${checkoutId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch contracts');
      return response.json();
    }
  });

  // Buscar resumo
  const { data: summary } = useQuery({
    queryKey: [`/api/coproduction/summary/${checkoutId}`],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      const response = await fetch(`/api/coproduction/summary/${checkoutId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch summary');
      return response.json();
    }
  });

  // Filtrar contratos
  const filteredContracts = contracts.filter(c => {
    if (activeTab === 'active') return c.status === 'accepted';
    if (activeTab === 'pending') return c.status === 'pending';
    return false;
  });

  const activeCount = contracts.filter(c => c.status === 'accepted').length;
  const pendingCount = contracts.filter(c => c.status === 'pending').length;

  // Mutation: Cancelar contrato
  const cancelMutation = useMutation({
    mutationFn: async (contractId: string) => {
      const response = await apiRequest(`/api/coproduction/cancel/${contractId}`, 'DELETE', {});
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "✅ Contrato cancelado com sucesso!" });
      setContractToCancel(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: [`/api/coproduction/summary/${checkoutId}`] });
    },
    onError: () => {
      toast({ title: "❌ Erro ao cancelar contrato", variant: "destructive" });
    }
  });

  const getCommissionSourceLabel = (source: string) => {
    switch (source) {
      case 'own_sales': return 'Minhas vendas';
      case 'affiliate_sales': return 'Vendas dos afiliados';
      case 'both': return 'Todas as vendas';
      default: return source;
    }
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    try {
      let d: Date;
      if (date._seconds !== undefined) {
        d = new Date(date._seconds * 1000);
      } else if (date.seconds !== undefined) {
        d = new Date(date.seconds * 1000);
      } else if (typeof date.toDate === 'function') {
        d = date.toDate();
      } else {
        d = new Date(date);
      }
      if (isNaN(d.getTime())) return 'N/A';
      return d.toLocaleDateString('pt-BR');
    } catch {
      return 'N/A';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Resumo */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-lime-50 to-lime-100 dark:from-[#f0f4ff]/20 dark:to-[#263200]/20 border-blue-200 dark:border-[#f0f4ff]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[#2563eb] dark:text-blue-300">Contratos Ativos</p>
                  <p className="text-2xl font-bold text-[#f0f4ff] dark:text-lime-100">{summary.activeContracts}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-[#2563eb] dark:text-blue-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-orange-700 dark:text-orange-300">Convites Pendentes</p>
                  <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">{summary.pendingInvites}</p>
                </div>
                <Clock className="h-8 w-8 text-orange-600 dark:text-orange-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-700 dark:text-blue-300">% Disponível</p>
                  <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{summary.availablePercent}%</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">de 70% máximo</p>
                </div>
                <Users className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-lime-500/20">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'active'
              ? 'border-[#2563eb] text-[#2563eb] dark:border-lime-400 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Ativos ({activeCount})
          </div>
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pending'
              ? 'border-orange-600 text-orange-600 dark:border-orange-400 dark:text-orange-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pendentes ({pendingCount})
          </div>
        </button>
      </div>

      {/* Lista de contratos */}
      <Card className="bg-white dark:bg-transparent shadow-card">
        <CardContent className="p-0">
          {filteredContracts.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{activeTab === 'active' ? 'Nenhum contrato ativo' : 'Nenhum convite pendente'}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredContracts.map(contract => (
                <div key={contract.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                          {contract.coproducerName}
                        </h4>
                        <Badge
                          variant={contract.status === 'accepted' ? 'default' : 'secondary'}
                          className={contract.status === 'accepted' 
                            ? 'bg-blue-100 text-[#f0f4ff] dark:bg-gray-700/70 dark:text-blue-400' 
                            : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                          }
                        >
                          {contract.status === 'accepted' ? 'Ativo' : 'Pendente'}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                        {contract.coproducerEmail}
                      </p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Comissão:</span>{' '}
                          <span className="font-semibold text-gray-900 dark:text-white">{contract.commissionPercent}%</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Duração:</span>{' '}
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {contract.duration === 'lifetime' ? 'Vitalício' : `Até ${formatDate(contract.periodEndDate)}`}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Fonte:</span>{' '}
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {getCommissionSourceLabel(contract.commissionSource)}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Convidado em:</span>{' '}
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {formatDate(contract.invitedAt)}
                          </span>
                        </div>
                      </div>

                      {/* Preferências */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {contract.shareCustomerData && (
                          <Badge variant="outline" className="text-xs">
                            Compartilha dados do cliente
                          </Badge>
                        )}
                        {contract.extendCommission && (
                          <Badge variant="outline" className="text-xs">
                            Comissão estendida
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setContractToCancel(contract.id)}
                        disabled={cancelMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Cancelar
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de confirmação de cancelamento */}
      <AlertDialog open={!!contractToCancel} onOpenChange={() => setContractToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Contrato de Coprodução</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja cancelar este contrato? Esta ação não pode ser desfeita.
              O coprodutor não receberá mais comissões das vendas futuras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não, manter contrato</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => contractToCancel && cancelMutation.mutate(contractToCancel)}
              disabled={cancelMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              Sim, cancelar contrato
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
