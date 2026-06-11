import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Users, UserCheck, Clock, Search, Check, X, Trash2, DollarSign } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";

type Affiliate = {
  id: string;
  affiliateId: string;
  affiliateEmail: string;
  affiliateName: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
  approvedAt?: any;
  customCommission?: number;
};

interface AffiliateManagementProps {
  checkoutId: string;
  sellerId: string;
  defaultCommission: number;
}

export function AffiliateManagement({ checkoutId, sellerId, defaultCommission }: AffiliateManagementProps) {
  const { toast } = useToast();
  const { initialized } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'approved' | 'pending'>('approved');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingCommission, setEditingCommission] = useState<string | null>(null);
  const [customCommissionValue, setCustomCommissionValue] = useState<string>('');

  // Buscar afiliados
  const { data: response, isLoading, refetch } = useQuery({
    queryKey: [`/api/products/${checkoutId}/affiliates`],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('User not authenticated');
      
      const res = await fetch(`/api/products/${checkoutId}/affiliates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to fetch affiliates: ${res.status}`);
      return res.json();
    },
    enabled: initialized,
  });
  
  const affiliates: Affiliate[] = response?.affiliates || [];

  // Filtrar afiliados
  const filteredAffiliates = affiliates.filter(aff => {
    const matchesTab = activeTab === 'approved' ? aff.status === 'approved' : aff.status === 'pending';
    const matchesSearch = searchTerm === '' || 
      aff.affiliateName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      aff.affiliateEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const pendingCount = affiliates.filter(a => a.status === 'pending').length;
  const approvedCount = affiliates.filter(a => a.status === 'approved').length;

  // Mutation: Aprovar individual
  const approveMutation = useMutation({
    mutationFn: async (affiliateId: string) => {
      return await apiRequest(`/api/affiliations/${affiliateId}/approve`, 'PATCH');
    },
    onSuccess: () => {
      toast({ title: "✅ Afiliado aprovado com sucesso!" });
      queryClient.invalidateQueries({ queryKey: [`/api/products/${checkoutId}/affiliates`] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao aprovar afiliado", 
        description: error.message || "Tente novamente",
        variant: "destructive"
      });
    }
  });

  // Mutation: Rejeitar individual
  const rejectMutation = useMutation({
    mutationFn: async (affiliateId: string) => {
      return await apiRequest(`/api/affiliations/${affiliateId}/reject`, 'PATCH');
    },
    onSuccess: () => {
      toast({ title: "❌ Afiliado rejeitado" });
      queryClient.invalidateQueries({ queryKey: [`/api/products/${checkoutId}/affiliates`] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao rejeitar afiliado", 
        description: error.message || "Tente novamente",
        variant: "destructive"
      });
    }
  });

  // Mutation: Remover afiliação
  const removeMutation = useMutation({
    mutationFn: async (affiliateId: string) => {
      return await apiRequest(`/api/affiliations/${affiliateId}`, 'DELETE');
    },
    onSuccess: () => {
      toast({ title: "🗑️ Afiliação removida com sucesso!" });
      queryClient.invalidateQueries({ queryKey: [`/api/products/${checkoutId}/affiliates`] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao remover afiliação", 
        description: error.message || "Tente novamente",
        variant: "destructive"
      });
    }
  });

  // Mutation: Alterar comissão
  const updateCommissionMutation = useMutation({
    mutationFn: async ({ affiliateId, commission }: { affiliateId: string; commission: number }) => {
      return await apiRequest(`/api/affiliations/${affiliateId}/commission`, 'PATCH', { customCommission: commission });
    },
    onSuccess: () => {
      toast({ title: "💰 Comissão atualizada com sucesso!" });
      setEditingCommission(null);
      queryClient.invalidateQueries({ queryKey: [`/api/products/${checkoutId}/affiliates`] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao atualizar comissão", 
        description: error.message || "Tente novamente",
        variant: "destructive"
      });
    }
  });

  // Formatar data de forma confiável
  const formatDate = (dateField: any) => {
    if (!dateField) return '-';
    
    try {
      // Firestore Timestamp com toDate()
      if (dateField.toDate && typeof dateField.toDate === 'function') {
        return new Date(dateField.toDate()).toLocaleDateString('pt-BR');
      }
      // Firestore Timestamp com seconds
      if (dateField.seconds) {
        return new Date(dateField.seconds * 1000).toLocaleDateString('pt-BR');
      }
      // JavaScript Date
      if (dateField instanceof Date) {
        return dateField.toLocaleDateString('pt-BR');
      }
      // String de data
      if (typeof dateField === 'string') {
        return new Date(dateField).toLocaleDateString('pt-BR');
      }
    } catch (error) {
      console.error('Erro ao formatar data:', error);
    }
    return '-';
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
      {/* Tabs */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === 'approved' ? 'default' : 'outline'}
          onClick={() => setActiveTab('approved')}
          className="flex items-center gap-2"
        >
          <UserCheck className="h-4 w-4" />
          Aprovados ({approvedCount})
        </Button>
        <Button
          variant={activeTab === 'pending' ? 'default' : 'outline'}
          onClick={() => setActiveTab('pending')}
          className="flex items-center gap-2"
        >
          <Clock className="h-4 w-4" />
          Pendentes ({pendingCount})
        </Button>
      </div>

      {/* Card de afiliados */}
      <Card>
        <CardContent className="pt-6">
          {/* Busca */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por nome ou email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {filteredAffiliates.length === 0 ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">
                {activeTab === 'approved' ? 'Nenhum afiliado aprovado' : 'Nenhuma solicitação pendente'}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {activeTab === 'approved' 
                  ? 'Quando afiliados forem aprovados, eles aparecerão aqui.'
                  : 'Quando afiliados se cadastrarem, eles aparecerão aqui.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-transparent">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Afiliado
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Data
                    </th>
                    {activeTab === 'approved' && (
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Comissão
                      </th>
                    )}
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredAffiliates.map(affiliate => (
                    <tr key={affiliate.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {affiliate.affiliateName || 'Sem nome'}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {affiliate.affiliateEmail}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge
                          variant={affiliate.status === 'approved' ? 'default' : 'secondary'}
                          className={affiliate.status === 'approved' ? 'bg-blue-100 text-[#f0f4ff] dark:bg-[#f0f4ff]/30 dark:text-blue-400' : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'}
                        >
                          {affiliate.status === 'approved' ? 'Aprovado' : 'Pendente'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(affiliate.approvedAt || affiliate.createdAt)}
                      </td>
                      
                      {/* COLUNA DE COMISSÃO (só em Aprovados) */}
                      {activeTab === 'approved' && (
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {editingCommission === affiliate.id ? (
                            <div className="flex gap-2 items-center">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={customCommissionValue}
                                onChange={(e) => setCustomCommissionValue(e.target.value)}
                                className="w-20 h-8"
                                placeholder="%"
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  const commission = parseFloat(customCommissionValue);
                                  if (!isNaN(commission) && commission >= 0 && commission <= 100) {
                                    updateCommissionMutation.mutate({ 
                                      affiliateId: affiliate.id, 
                                      commission 
                                    });
                                  }
                                }}
                                className="h-8 px-2"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingCommission(null)}
                                className="h-8 px-2"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-gray-900 dark:text-white font-medium">
                              {affiliate.customCommission ?? defaultCommission}%
                            </span>
                          )}
                        </td>
                      )}

                      {/* AÇÕES */}
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {activeTab === 'pending' ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => approveMutation.mutate(affiliate.id)}
                              disabled={approveMutation.isPending}
                              className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white h-8"
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => rejectMutation.mutate(affiliate.id)}
                              disabled={rejectMutation.isPending}
                              className="h-8"
                            >
                              <X className="h-4 w-4 mr-1" />
                              Rejeitar
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingCommission(affiliate.id);
                                setCustomCommissionValue((affiliate.customCommission ?? defaultCommission).toString());
                              }}
                              className="h-8"
                            >
                              <DollarSign className="h-4 w-4 mr-1" />
                              Comissão
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                if (confirm(`Tem certeza que deseja remover a afiliação de ${affiliate.affiliateName}?`)) {
                                  removeMutation.mutate(affiliate.id);
                                }
                              }}
                              disabled={removeMutation.isPending}
                              className="h-8"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Remover
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
