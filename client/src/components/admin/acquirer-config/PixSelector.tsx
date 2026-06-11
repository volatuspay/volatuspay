import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Smartphone, Check } from "lucide-react";
import { PAYMENT_METHOD_OPTIONS } from "./types";

interface PixSelectorProps {
  defaultAcquirers: any;
  setDefaultAcquirers: (value: any) => void;
}

export function PixSelector({ defaultAcquirers, setDefaultAcquirers }: PixSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Adquirente Padrão para PIX
        </CardTitle>
        <CardDescription>
          Escolha qual processador será usado para pagamentos PIX
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <Label htmlFor="pix-acquirer">Processador PIX</Label>
            <Select
              value={defaultAcquirers?.pix || ''}
              onValueChange={(value) => setDefaultAcquirers({ ...defaultAcquirers, pix: value })}
            >
              <SelectTrigger id="pix-acquirer" data-testid="select-pix-acquirer">
                <SelectValue placeholder="Selecione o processador" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHOD_OPTIONS.pix.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex flex-col">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-gray-500">{option.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {defaultAcquirers?.pix && (
            <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-[#f0f4ff] rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Check className="w-5 h-5 text-emerald-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                    Processador selecionado: {PAYMENT_METHOD_OPTIONS.pix.find(o => o.value === defaultAcquirers.pix)?.label}
                  </p>
                  <p className="text-xs text-emerald-700 dark:text-blue-300 mt-1">
                    Certifique-se de ter configurado as chaves na aba "Chaves"
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
