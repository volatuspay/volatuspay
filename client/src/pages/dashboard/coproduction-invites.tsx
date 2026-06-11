import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Users, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2,
  Mail,
  Percent,
  Calendar,
  ShoppingBag
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
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

interface CoproductionInvite {
  id: string;
  productName: string;
  sellerName: string;
  sellerEmail: string;
  commissionPercent: number;
  duration: 'lifetime' | 'period';
  periodEndDate?: any;
  commissionSource: string;
  shareCustomerData: boolean;
  extendCommission: boolean;
  status: string;
  invitedAt: any;
}

export default function CoproductionInvitesPage() {
  const { toast } = useToast();
  const [selectedInvite, setSelectedInvite] = useState<CoproductionInvite | null>(null);
  const [actionType, setActionType] = useState<'accept' | 'reject' | null>(null);

  const { data: invitesData, isLoading } = useQuery<CoproductionInvite[]>({
    queryKey: ['/api/coproduction/my-invites'],
    enabled: true,
  });
  
  const invites: CoproductionInvite[] = Array.isArray(invitesData) ? invitesData : [];

  const acceptMutation = useMutation({
    mutationFn: async (contractId: string) => {
      const res = await apiRequest(`/api/coproduction/accept/${contractId}`, 'POST', {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Erro ao aceitar convite' }));
        throw new Error(errorData.error || 'Erro ao aceitar convite');
      }
      const text = await res.text();
      return text ? JSON.parse(text) : { success: true };
    },
    onSuccess: () => {
      toast({ title: "Convite aceito com sucesso!" });
      setSelectedInvite(null);
      setActionType(null);
      queryClient.invalidateQueries({ queryKey: ['/api/coproduction/my-invites'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao aceitar convite", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (contractId: string) => {
      const res = await apiRequest(`/api/coproduction/reject/${contractId}`, 'POST', {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Erro ao recusar convite' }));
        throw new Error(errorData.error || 'Erro ao recusar convite');
      }
      const text = await res.text();
      return text ? JSON.parse(text) : { success: true };
    },
    onSuccess: () => {
      toast({ title: "Convite recusado" });
      setSelectedInvite(null);
      setActionType(null);
      queryClient.invalidateQueries({ queryKey: ['/api/coproduction/my-invites'] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao recusar convite", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

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

  const getCommissionSourceLabel = (source: string) => {
    switch (source) {
      case 'own_sales': return 'Vendas diretas';
      case 'affiliate_sales': return 'Vendas de afiliados';
      case 'both': return 'Todas as vendas';
      default: return source;
    }
  };

  const handleAction = () => {
    if (!selectedInvite) return;
    
    if (actionType === 'accept') {
      acceptMutation.mutate(selectedInvite.id);
    } else if (actionType === 'reject') {
      rejectMutation.mutate(selectedInvite.id);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-[#2563eb]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6" data-testid="coproduction-invites-page">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg md:text-2xl font-bold">Convites de Coprodução</h1>
            <p className="text-muted-foreground">
              Gerencie os convites de coprodução que você recebeu
            </p>
          </div>
          <Badge variant="outline" className="gap-1">
            <Mail className="w-3 h-3" />
            {invites.length} convite{invites.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {invites.length === 0 ? (
          <Card className="border-lime-500/20">
            <CardContent className="py-12 text-center">
              <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">Nenhum convite pendente</h3>
              <p className="text-muted-foreground text-sm">
                Quando alguém te convidar para coproduzi, você verá aqui
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {invites.map((invite) => (
              <Card key={invite.id} className="border-lime-500/20 hover:border-lime-500/40 transition-colors">
                <CardContent className="p-3 md:p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/10">
                          <ShoppingBag className="w-5 h-5 text-[#2563eb]" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{invite.productName}</h3>
                          <p className="text-sm text-muted-foreground">
                            Convite de {invite.sellerName || invite.sellerEmail}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-3">
                        <Badge variant="secondary" className="gap-1">
                          <Percent className="w-3 h-3" />
                          {invite.commissionPercent}% de comissão
                        </Badge>
                        <Badge variant="outline" className="gap-1">
                          <Calendar className="w-3 h-3" />
                          {invite.duration === 'lifetime' ? 'Vitalício' : `Até ${formatDate(invite.periodEndDate)}`}
                        </Badge>
                        <Badge variant="outline" className="gap-1">
                          {getCommissionSourceLabel(invite.commissionSource)}
                        </Badge>
                      </div>
                      
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Recebido em {formatDate(invite.invitedAt)}
                      </div>
                    </div>
                    
                    <div className="flex gap-2 w-full sm:w-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedInvite(invite);
                          setActionType('reject');
                        }}
                        className="border-red-500/30 text-red-500 hover:bg-red-500/10 flex-1 sm:flex-initial"
                        data-testid={`button-reject-${invite.id}`}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Recusar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedInvite(invite);
                          setActionType('accept');
                        }}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] flex-1 sm:flex-initial"
                        data-testid={`button-accept-${invite.id}`}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Aceitar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <AlertDialog open={!!selectedInvite && !!actionType} onOpenChange={() => { setSelectedInvite(null); setActionType(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {actionType === 'accept' ? 'Aceitar convite?' : 'Recusar convite?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {actionType === 'accept' ? (
                  <>
                    Você receberá <strong>{selectedInvite?.commissionPercent}%</strong> das vendas 
                    do produto <strong>{selectedInvite?.productName}</strong>.
                    {selectedInvite?.duration === 'lifetime' 
                      ? ' Este contrato é vitalício.'
                      : ` O contrato expira em ${formatDate(selectedInvite?.periodEndDate)}.`
                    }
                  </>
                ) : (
                  <>
                    Tem certeza que deseja recusar este convite de coprodução?
                    Esta ação não pode ser desfeita.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleAction}
                className={actionType === 'accept' ? 'bg-[#2563eb] hover:bg-[#1d4ed8]' : 'bg-red-600 hover:bg-red-700'}
              >
                {acceptMutation.isPending || rejectMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : null}
                {actionType === 'accept' ? 'Aceitar' : 'Recusar'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
