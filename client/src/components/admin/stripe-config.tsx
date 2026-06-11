import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, Key, Settings, CheckCircle, AlertTriangle, Eye, EyeOff } from 'lucide-react';

const stripeConfigSchema = z.object({
  publicKey: z.string().min(1, 'Chave pblica é obrigatria')
    .startsWith('pk_', 'Chave pblica deve começar com "pk_"'),
  secretKey: z.string().min(1, 'Chave secreta é obrigatria')
    .startsWith('sk_', 'Chave secreta deve começar com "sk_"'),
});

type StripeConfigData = z.infer<typeof stripeConfigSchema>;

interface StripeConfigProps {
  className?: string;
}

export function StripeConfig({ className = "" }: StripeConfigProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showSecretKey, setShowSecretKey] = useState(false);

  // Buscar configurações atuais
  const { data: currentConfig, isLoading: configLoading } = useQuery({
    queryKey: ['admin-stripe-config'],
    queryFn: async () => {
      const response = await fetch('/api/admin/stripe-config');
      if (!response.ok) throw new Error('Erro ao buscar configurações');
      return response.json();
    }
  });

  // Verificar status da configuração
  const { data: stripeStatus } = useQuery({
    queryKey: ['stripe-status'],
    queryFn: async () => {
      const response = await fetch('/api/admin/config/status');
      if (!response.ok) return { stripe_configured: false };
      return response.json();
    }
  });

  const form = useForm<StripeConfigData>({
    resolver: zodResolver(stripeConfigSchema),
    defaultValues: {
      publicKey: '',
      secretKey: '',
    }
  });

  // Mutation para salvar configurações
  const saveMutation = useMutation({
    mutationFn: async (data: StripeConfigData) => {
      const response = await fetch('/api/admin/stripe-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao salvar configurações');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: " Configurações salvas!",
        description: "Chaves Stripe configuradas com sucesso. Pagamentos globais agora disponíveis.",
      });
      
      queryClient.invalidateQueries({ queryKey: ['admin-stripe-config'] });
      queryClient.invalidateQueries({ queryKey: ['stripe-status'] });
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: " Erro ao salvar",
        description: error.message || "No foi possvel salvar as configurações.",
        variant: "destructive",
      });
    }
  });

  const onSubmit = (data: StripeConfigData) => {
    saveMutation.mutate(data);
  };

  const isConfigured = stripeStatus?.stripe_configured || false;

  return (
    <div className={className}>
      <Card className="max-w-2xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
              <CreditCard className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Configurao Stripe
                {isConfigured && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Configurado
                  </Badge>
                )}
                {!isConfigured && (
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Pendente
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Configure as chaves da Stripe para habilitar pagamentos globais em USD, EUR, GBP, etc.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Status atual */}
          <Alert className={isConfigured ? "bg-emerald-50 border-emerald-200" : "bg-yellow-50 border-yellow-200"}>
            <Settings className={`h-4 w-4 ${isConfigured ? "text-emerald-600" : "text-yellow-600"}`} />
            <AlertDescription className={isConfigured ? "text-[#f0f4ff]" : "text-yellow-800"}>
              {isConfigured 
                ? "Stripe configurado - Pagamentos globais habilitados"
                : "Configure as chaves para habilitar pagamentos globais"
              }
            </AlertDescription>
          </Alert>

          <Separator />

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Chave Pblica */}
            <div className="space-y-2">
              <Label htmlFor="publicKey" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                Chave Pblica (Publishable Key)
              </Label>
              <Input
                id="publicKey"
                placeholder="pk_live_... ou pk_test_..."
                {...form.register('publicKey')}
                data-testid="input-stripe-public-key"
              />
              {form.formState.errors.publicKey && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.publicKey.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Encontre em: Dashboard Stripe Developers API keys
              </p>
            </div>

            {/* Chave Secreta */}
            <div className="space-y-2">
              <Label htmlFor="secretKey" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                Chave Secreta (Secret Key)
              </Label>
              <div className="relative">
                <Input
                  id="secretKey"
                  type={showSecretKey ? "text" : "password"}
                  placeholder="sk_live_... ou sk_test_..."
                  {...form.register('secretKey')}
                  data-testid="input-stripe-secret-key"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                  onClick={() => setShowSecretKey(!showSecretKey)}
                  data-testid="button-toggle-secret-key"
                >
                  {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {form.formState.errors.secretKey && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.secretKey.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Mantenha esta chave segura - nunca compartilhe publicamente
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Como obter as chaves:
              </h4>
              <ol className="text-xs text-blue-800 dark:text-blue-200 space-y-1 ml-4">
                <li>1. Acesse o <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" className="underline">Dashboard da Stripe</a></li>
                <li>2. Vem "Developers" "API keys"</li>
                <li>3. Copie a "Publishable key" e "Secret key"</li>
                <li>4. Para produção, use chaves "live_". Para teste, use "test_"</li>
              </ol>
            </div>

            <CardFooter className="flex gap-3 p-0">
              <Button 
                type="submit" 
                className="flex-1"
                disabled={saveMutation.isPending || !form.formState.isDirty}
                data-testid="button-save-stripe-config"
              >
                {saveMutation.isPending ? "Salvando..." : "Salvar Configurações"}
              </Button>
              <Button 
                type="button" 
                variant="outline"
                onClick={() => form.reset()}
                disabled={saveMutation.isPending}
                data-testid="button-reset-form"
              >
                Limpar
              </Button>
            </CardFooter>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}