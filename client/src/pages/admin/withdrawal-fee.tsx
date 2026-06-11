import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Banknote } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

export default function AdminWithdrawalFee() {
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState("");

  const { data, isLoading } = useQuery<{ feeFixed: number }>({
    queryKey: ["/api/withdrawals/admin/fee"],
    onSuccess: (d: { feeFixed: number }) => {
      setInputValue(String(d.feeFixed));
    },
  } as any);

  const mutation = useMutation({
    mutationFn: async (feeFixed: number) => {
      return apiRequest("/api/withdrawals/admin/fee", "PUT", { feeFixed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawals/admin/fee"] });
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawals/fee"] });
      toast({ title: "✅ Taxa atualizada", description: "A nova taxa de saque global foi salva com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "❌ Erro", description: err.message || "Erro ao salvar taxa.", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const parsed = parseFloat(inputValue.replace(",", "."));
    if (isNaN(parsed) || parsed < 0) {
      toast({ title: "❌ Valor inválido", description: "Informe um valor fixo em R$ maior ou igual a 0 (ex: 5).", variant: "destructive" });
      return;
    }
    mutation.mutate(parsed);
  };

  const currentFeeFixed = data?.feeFixed ?? 5;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-lg">
        <div className="flex items-center gap-2 mb-6">
          <Banknote className="h-6 w-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-900">Taxa de Saque</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Taxa global de saque (valor fixo)</CardTitle>
            <CardDescription>
              Valor fixo em R$ cobrado sobre cada saque realizado pelos sellers. Aplicada igualmente a todos os sellers - novos e existentes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando taxa atual...
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                Taxa global atual: <span className="font-semibold text-gray-900">R$ {currentFeeFixed.toFixed(2).replace(".", ",")}</span>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="fee-input">Nova taxa (R$)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">R$</span>
                <Input
                  id="fee-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="5.00"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="max-w-[120px]"
                />
              </div>
              <p className="text-xs text-gray-400">
                Exemplos: 5 = R$5,00 · 0 = gratuito · 2.50 = R$2,50
              </p>
            </div>

            <Button
              onClick={handleSave}
              disabled={mutation.isPending || !inputValue}
              className="bg-gray-900 hover:bg-gray-800 text-white"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar taxa global"
              )}
            </Button>
          </CardContent>
        </Card>

        <p className="mt-4 text-xs text-gray-400">
          A taxa global é aplicada automaticamente a todos os sellers no momento do saque.
        </p>
      </div>
    </DashboardLayout>
  );
}
