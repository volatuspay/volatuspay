import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Info, UserPlus, AlertCircle } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";

interface CoproductionInviteProps {
  checkoutId: string;
  productName: string;
}

export function CoproductionInvite({ checkoutId, productName }: CoproductionInviteProps) {
  const { toast } = useToast();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Form state
  const [coproducerName, setCoproducerName] = useState('');
  const [coproducerEmail, setCoproducerEmail] = useState('');
  const [commissionPercent, setCommissionPercent] = useState('50');
  const [duration, setDuration] = useState<'lifetime' | 'period'>('period');
  const [periodMonths, setPeriodMonths] = useState('12');
  const [commissionSource, setCommissionSource] = useState<'own_sales' | 'affiliate_sales' | 'both'>('own_sales');
  const [shareCustomerData, setShareCustomerData] = useState(false);
  const [extendCommission, setExtendCommission] = useState(true);

  // Buscar resumo de coprodutores
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

  const availablePercent = summary?.availablePercent || 70;

  // Mutation: Enviar convite
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const data = {
        checkoutId,
        coproducerName,
        coproducerEmail,
        commissionPercent: parseFloat(commissionPercent),
        duration,
        periodMonths: duration === 'period' ? parseInt(periodMonths) : undefined,
        commissionSource,
        shareCustomerData,
        extendCommission
      };
      const response = await apiRequest('/api/coproduction/invite', 'POST', data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "✅ Convite enviado com sucesso!" });
      setShowConfirmDialog(false);
      // Limpar form
      setCoproducerName('');
      setCoproducerEmail('');
      setCommissionPercent('50');
      queryClient.invalidateQueries({ queryKey: [`/api/coproduction/summary/${checkoutId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/coproduction/my-contracts/${checkoutId}`] });
    },
    onError: (error: any) => {
      toast({ 
        title: "❌ Erro ao enviar convite", 
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSubmit = () => {
    // Validações
    if (!coproducerName.trim()) {
      toast({ title: "❌ Digite o nome do coprodutor", variant: "destructive" });
      return;
    }
    if (!coproducerEmail.trim() || !coproducerEmail.includes('@')) {
      toast({ title: "❌ Digite um email válido", variant: "destructive" });
      return;
    }
    const percent = parseFloat(commissionPercent);
    if (isNaN(percent) || percent < 0 || percent > 70) {
      toast({ title: "❌ Comissão deve estar entre 0% e 70%", variant: "destructive" });
      return;
    }
    if (percent > availablePercent) {
      toast({ 
        title: "❌ Comissão excede o disponível", 
        description: `Você tem apenas ${availablePercent}% disponível`,
        variant: "destructive" 
      });
      return;
    }

    setShowConfirmDialog(true);
  };

  return (
    <div className="space-y-6">
      <Card className="bg-white dark:bg-transparent shadow-card">
        <CardContent className="p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Convite de coprodução
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Convide um parceiro para coprodu\u00e7\u00e3o e defina as regras de compartilhamento
            </p>
          </div>

          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="coproducer-name" className="text-sm font-medium text-gray-900 dark:text-white">
              Nome
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">Nome do coprodutor</p>
            <Input
              id="coproducer-name"
              value={coproducerName}
              onChange={(e) => setCoproducerName(e.target.value)}
              placeholder="Ex: João Silva"
              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="coproducer-email" className="text-sm font-medium text-gray-900 dark:text-white">
              E-mail
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">E-mail do coprodutor</p>
            <Input
              id="coproducer-email"
              type="email"
              value={coproducerEmail}
              onChange={(e) => setCoproducerEmail(e.target.value)}
              placeholder="coprodutor@email.com"
              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
            />
          </div>

          {/* Porcentagem */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="commission-percent" className="text-sm font-medium text-gray-900 dark:text-white">
                Porcentagem de comissão
              </Label>
              <Info className="h-4 w-4 text-gray-400" />
            </div>
            <div className="flex items-center gap-3">
              <Input
                id="commission-percent"
                type="number"
                min="0"
                max="70"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                className="w-24 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
            </div>
            <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-blue-900 dark:text-blue-100">
                Até 70% do produto pode ser destinado a coprodutores, você ainda tem <strong>{availablePercent}%</strong> disponível
              </p>
            </div>
          </div>

          {/* Duração do contrato */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-900 dark:text-white">
              Duração do contrato
            </Label>
            <RadioGroup value={duration} onValueChange={(v) => setDuration(v as any)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="lifetime" id="lifetime" />
                <Label htmlFor="lifetime" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Vitalício
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="period" id="period" />
                <Label htmlFor="period" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer flex items-center gap-2">
                  Período determinado
                  <span className="px-2 py-0.5 text-xs bg-blue-100 text-[#f0f4ff] dark:bg-gray-700/70 dark:text-blue-400 rounded">
                    Recomendado
                  </span>
                </Label>
              </div>
            </RadioGroup>
            {duration === 'period' && (
              <div className="ml-6">
                <Input
                  type="number"
                  min="1"
                  max="60"
                  value={periodMonths}
                  onChange={(e) => setPeriodMonths(e.target.value)}
                  placeholder="Meses"
                  className="w-32 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Número de meses</p>
              </div>
            )}
          </div>

          {/* Comissões */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-900 dark:text-white">
              Comissões
            </Label>
            <RadioGroup value={commissionSource} onValueChange={(v) => setCommissionSource(v as any)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="own_sales" id="own-sales" />
                <Label htmlFor="own-sales" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Minhas vendas
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="affiliate_sales" id="affiliate-sales" />
                <Label htmlFor="affiliate-sales" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Vendas dos afiliados
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="both" id="both-sales" />
                <Label htmlFor="both-sales" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Ambas (minhas vendas + vendas dos afiliados)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Preferências */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-gray-900 dark:text-white">
              Preferências
            </Label>
            
            <div className="flex items-start space-x-2">
              <Checkbox
                id="share-data"
                checked={shareCustomerData}
                onCheckedChange={(checked) => setShareCustomerData(checked as boolean)}
              />
              <div className="space-y-1">
                <Label htmlFor="share-data" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Compartilhar os dados do comprador com o coprodutor
                </Label>
              </div>
            </div>

            <div className="flex items-start space-x-2">
              <Checkbox
                id="extend-commission"
                checked={extendCommission}
                onCheckedChange={(checked) => setExtendCommission(checked as boolean)}
              />
              <div className="space-y-1">
                <Label htmlFor="extend-commission" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Estender comissão: order bump, cross sell, upsell e downsell
                </Label>
              </div>
            </div>
          </div>

          {/* Aviso legal */}
          <div className="flex items-start gap-2 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-900 dark:text-yellow-100">
              Ao clicar em convidar você está concordando com a criação de um contrato de coprodução com o usuário convidado, com a porcentagem e duração definida acima.
            </p>
          </div>

          {/* Botões */}
          <div className="flex items-center gap-3 pt-4">
            <Button
              onClick={handleSubmit}
              disabled={inviteMutation.isPending}
              className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              {inviteMutation.isPending ? 'Enviando...' : 'Convidar'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setCoproducerName('');
                setCoproducerEmail('');
                setCommissionPercent('50');
              }}
            >
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de confirmação */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Convite de Coprodução</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Você está prestes a enviar um convite de coprodução com as seguintes condições:</p>
              <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-md space-y-1 text-sm">
                <p><strong>Coprodutor:</strong> {coproducerName} ({coproducerEmail})</p>
                <p><strong>Comissão:</strong> {commissionPercent}%</p>
                <p><strong>Duração:</strong> {duration === 'lifetime' ? 'Vitalício' : `${periodMonths} meses`}</p>
                <p><strong>Fonte:</strong> {
                  commissionSource === 'own_sales' ? 'Minhas vendas' :
                  commissionSource === 'affiliate_sales' ? 'Vendas dos afiliados' :
                  'Minhas vendas + Vendas dos afiliados'
                }</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revisar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
              className="bg-[#2563eb] hover:bg-[#1d4ed8]"
            >
              Confirmar e Enviar Convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
