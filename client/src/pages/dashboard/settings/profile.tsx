import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Shield, Crown } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useTenantStore } from "@/stores/tenant";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";

export default function SellerProfile() {
  const { tenant } = useTenantStore();
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          setAdminCheckComplete(true);
          return;
        }
        const res = await fetch('/api/check-admin', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setIsAdmin(data.isAdmin === true);
        }
      } catch (e) {
        console.error('Admin check failed:', e);
      } finally {
        setAdminCheckComplete(true);
      }
    };
    checkAdmin();
  }, [user?.uid]);

  // Query para preferência 2FA
  const { data: twoFactorPreference, isLoading: is2FALoading } = useQuery({
    queryKey: ['/api/seller/2fa/preference'],
    enabled: !!user?.uid,
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/seller/2fa/preference', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Falha ao carregar preferência 2FA');
      return response.json();
    },
  });

  // Mutation para atualizar 2FA
  const toggle2FAMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/seller/2fa/preference', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('Falha ao atualizar 2FA');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/seller/2fa/preference'] });
      toast({
        title: data.enabled ? "2FA Ativado" : "2FA Desativado",
        description: data.enabled 
          ? "Autenticação de dois fatores ativada com sucesso." 
          : "Autenticação de dois fatores desativada.",
      });
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar a configuração de 2FA",
        variant: "destructive"
      });
    }
  });

  const { data: sellerData, isLoading } = useQuery({
    queryKey: ['/api/sellers', user?.uid],
    enabled: !!user?.uid,
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/sellers/${user?.uid}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Falha ao carregar dados do seller');
      return response.json();
    },
  });


  // 📤 Mutation para reenviar cadastro
  const resubmitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/sellers/resubmit", "POST", {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Erro ao reenviar cadastro" }));
        throw new Error(errorData.error || "Erro ao reenviar cadastro");
      }
      const text = await res.text();
      return text ? JSON.parse(text) : { success: true };
    },
    onSuccess: () => {
      toast({ title: "Cadastro reenviado para análise!" });
      queryClient.invalidateQueries({ queryKey: ["/api/sellers", user?.uid] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao reenviar cadastro", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const updateDisplayNameMutation = useMutation({
    mutationFn: async (newDisplayName: string) => {
      // Validar que usuário está autenticado
      if (!auth.currentUser) {
        throw new Error('Usuário não autenticado');
      }
      
      const response = await apiRequest(
        `/api/sellers/${user?.uid}/display-name`,
        'PATCH',
        { businessName: newDisplayName }
      );
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sellers', user?.uid] });
      toast({
        title: "Nome atualizado!",
        description: "O nome de exibição na vitrine foi atualizado com sucesso.",
      });
      setIsEditingDisplayName(false);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error?.message || error?.error || "Não foi possível atualizar o nome",
        variant: "destructive"
      });
    }
  });

  const handleSaveDisplayName = () => {
    if (!displayName.trim()) {
      toast({
        title: "Erro",
        description: "O nome de exibição não pode estar vazio",
        variant: "destructive"
      });
      return;
    }
    updateDisplayNameMutation.mutate(displayName);
  };

  const getStatusBadge = (status: string) => {
    const statusMap = {
      approved: { label: 'Aprovado', variant: 'default' as const },
      pending: { label: 'Pendente', variant: 'secondary' as const },
      rejected: { label: 'Rejeitado', variant: 'destructive' as const },
    };
    const config = statusMap[status as keyof typeof statusMap] || statusMap.pending;
    return (
      <Badge variant={config.variant} className="text-xs">
        {config.label}
      </Badge>
    );
  };

  const parseCreatedAt = (createdAt: any): string => {
    if (!createdAt) return 'Não disponível';
    if (createdAt._seconds) {
      return new Date(createdAt._seconds * 1000).toLocaleDateString('pt-BR');
    }
    if (createdAt.seconds) {
      return new Date(createdAt.seconds * 1000).toLocaleDateString('pt-BR');
    }
    if (typeof createdAt === 'string' || typeof createdAt === 'number') {
      const date = new Date(createdAt);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('pt-BR');
      }
    }
    return 'Não disponível';
  };

  if (!adminCheckComplete) {
    return (
      <DashboardLayout>
        <div className="px-3 md:px-6 py-4 md:py-6 max-w-7xl mx-auto">
          <Card className="border border-gray-200 dark:border-lime-500/20">
            <CardContent className="p-4 md:p-6">
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  if (isAdmin) {
    return (
      <DashboardLayout>
        <div className="px-3 md:px-6 py-4 md:py-6 max-w-7xl mx-auto">
          <div className="mb-4 md:mb-6">
            <h1 className="text-lg md:text-2xl font-bold dark:text-white">Meu Perfil</h1>
            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">
              Informações da sua conta de administrador
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent">
              <CardHeader className="pb-2 px-3 md:px-4 pt-3 md:pt-4">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-[#2563eb]" />
                  <CardTitle className="text-sm font-semibold">Conta Administrador</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-3 md:px-4 pb-3 md:pb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Email</p>
                    <p className="text-sm font-medium dark:text-white mt-0.5">{user?.email || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                    <div className="mt-0.5">
                      <Badge variant="default" className="text-xs bg-[#2563eb]">
                        Administrador
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Tipo de Conta</p>
                    <p className="text-sm font-medium dark:text-white mt-0.5">Admin Master</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Acesso</p>
                    <p className="text-sm font-medium dark:text-white mt-0.5">Completo</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent">
              <CardHeader className="pb-2 px-3 md:px-4 pt-3 md:pt-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#2563eb]" />
                  <CardTitle className="text-sm font-semibold">Permissões</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-3 md:px-4 pb-3 md:pb-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">Gerenciar Sellers</Badge>
                  <Badge variant="outline" className="text-xs">Configurar Taxas</Badge>
                  <Badge variant="outline" className="text-xs">Ver Vendas</Badge>
                  <Badge variant="outline" className="text-xs">Aprovar Saques</Badge>
                  <Badge variant="outline" className="text-xs">Configurar Adquirentes</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-7xl mx-auto">
        <div className="mb-4 md:mb-6">
          <h1 className="text-lg md:text-2xl font-bold dark:text-white">Meu Perfil</h1>
          <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">
            Informações da sua conta de vendedor na VolatusPay
          </p>
        </div>

        {isLoading ? (
          <Card className="border border-gray-200 dark:border-lime-500/20">
            <CardContent className="p-4 md:p-6">
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* CARD 1: DADOS PESSOAIS */}
            <Card className="border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent">
              <CardHeader className="pb-2 px-3 md:px-4 pt-3 md:pt-4">
                <CardTitle className="text-sm font-semibold">Dados Pessoais</CardTitle>
              </CardHeader>
              <CardContent className="px-3 md:px-4 pb-3 md:pb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Email</p>
                    <p className="text-sm font-medium dark:text-white mt-0.5">{user?.email || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                    <div className="mt-0.5">{getStatusBadge(sellerData?.status || 'pending')}</div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Tenant</p>
                    <p className="text-sm font-medium dark:text-white mt-0.5">{tenant?.name || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Membro desde</p>
                    <p className="text-sm font-medium dark:text-white mt-0.5">
                      {parseCreatedAt(sellerData?.createdAt || tenant?.createdAt)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* CARD 2: NOME DE EXIBIÇÃO NA VITRINE */}
            <Card className="border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent">
              <CardHeader className="pb-2 px-3 md:px-4 pt-3 md:pt-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Nome de Exibição</CardTitle>
                  {!isEditingDisplayName && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDisplayName(sellerData?.businessName || '');
                        setIsEditingDisplayName(true);
                      }}
                      className="h-7 text-xs"
                    >
                      Editar
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-3 md:px-4 pb-3 md:pb-4 space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Nome que aparece na vitrine de afiliados
                </p>

                {isEditingDisplayName ? (
                  <div className="space-y-2">
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Ex: Minha Empresa"
                      className="h-8 text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveDisplayName}
                        disabled={updateDisplayNameMutation.isPending}
                        className="h-7 px-3 text-xs bg-[#2563eb] hover:bg-[#2563eb] text-black font-medium"
                      >
                        {updateDisplayNameMutation.isPending ? 'Salvando...' : 'Salvar'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setIsEditingDisplayName(false)}
                        disabled={updateDisplayNameMutation.isPending}
                        className="h-7 px-3 text-xs"
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-semibold dark:text-white">
                    {sellerData?.businessName || 'Não informado'}
                  </p>
                )}

                <div className="pt-2 border-t border-gray-200 dark:border-lime-500/20 mt-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">CNPJ</p>
                  <p className="text-sm font-medium dark:text-white mt-0.5">
                    {sellerData?.cnpj || 'Não informado'}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* CARD 3: SEGURANÇA - 2FA */}
            <Card className="lg:col-span-2 border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent">
              <CardHeader className="pb-2 px-3 md:px-4 pt-3 md:pt-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#2563eb]" />
                  <CardTitle className="text-sm font-semibold">Segurança</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-3 md:px-4 pb-3 md:pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium dark:text-white">
                      Autenticação de Dois Fatores (2FA)
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Receba um código por email ao fazer login para maior segurança
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      data-testid="switch-2fa-toggle"
                      checked={twoFactorPreference?.enabled !== false}
                      onCheckedChange={(checked) => toggle2FAMutation.mutate(checked)}
                      disabled={is2FALoading || toggle2FAMutation.isPending}
                    />
                    <Badge 
                      variant={twoFactorPreference?.enabled !== false ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {twoFactorPreference?.enabled !== false ? "Ativado" : "Desativado"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ALERTAS DE STATUS */}
            {sellerData?.status === 'pending' && (
              <Card className="lg:col-span-2 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
                <CardContent className="p-3 md:p-4">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-500">
                    Conta em Análise - Você terá acesso total assim que for aprovada pela equipe.
                  </p>
                </CardContent>
              </Card>
            )}

            {sellerData?.status === 'rejected' && (
              <Card className="lg:col-span-2 border-red-500 bg-red-50 dark:bg-red-950/20">
                <CardContent className="p-3 md:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-red-700 dark:text-red-500">
                        Cadastro Pendente de Ajustes
                      </p>
                      {sellerData?.rejectionReason && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          Motivo: {sellerData.rejectionReason}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => resubmitMutation.mutate()}
                      disabled={resubmitMutation.isPending}
                      data-testid="button-resubmit-documents"
                    >
                      {resubmitMutation.isPending ? "Reenviando..." : "Reenviar para An\xe1lise"}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-red-600/70 dark:text-red-400/70">
                    Atualize suas informações acima e clique em reenviar para uma nova an\xe1lise.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
