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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, Key, Settings, CheckCircle, AlertTriangle, Eye, EyeOff, Globe } from 'lucide-react';

const adyenConfigSchema = z.object({
  merchantAccount: z.string().min(1, 'Merchant Account é obrigatório'),
  clientKey: z.string().min(1, 'Client Key é obrigatria')
    .startsWith('live_', 'Client Key deve começar com "live_" para produção')
    .or(z.string().startsWith('test_', 'Client Key deve começar com "test_" para sandbox')),
  apiKey: z.string().min(1, 'API Key é obrigatria'),
  environment: z.enum(['test', 'live'], {
    required_error: 'Selecione o ambiente'
  }),
  hmacKey: z.string().min(1, 'HMAC Key é obrigatria para webhooks'),
});

type AdyenConfigData = z.infer<typeof adyenConfigSchema>;

interface AdyenConfigProps {
  className?: string;
}

export function AdyenConfig({ className = "" }: AdyenConfigProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showHmacKey, setShowHmacKey] = useState(false);

  // Buscar configurações atuais
  const { data: currentConfig, isLoading: configLoading } = useQuery({
    queryKey: ['admin-adyen-config'],
    queryFn: async () => {
      const response = await fetch('/api/admin/adyen-config');
      if (!response.ok) throw new Error('Erro ao buscar configurações');
      return response.json();
    }
  });

  // Verificar status da configuração
  const { data: adyenStatus } = useQuery({
    queryKey: ['adyen-status'],
    queryFn: async () => {
      const response = await fetch('/api/admin/config/status');
      if (!response.ok) return { adyen_configured: false };
      const data = await response.json();
      return { adyen_configured: data.payments?.adyen_configured || false };
    }
  });

  const form = useForm<AdyenConfigData>({
    resolver: zodResolver(adyenConfigSchema),
    defaultValues: {
      merchantAccount: '',
      clientKey: '',
      apiKey: '',
      environment: 'test',
      hmacKey: '',
    }
  });

  // Detectar ambiente baseado na Client Key
  React.useEffect(() => {
    const clientKey = form.watch('clientKey');
    if (clientKey) {
      if (clientKey.startsWith('live_')) {
        form.setValue('environment', 'live');
      } else if (clientKey.startsWith('test_')) {
        form.setValue('environment', 'test');
      }
    }
  }, [form.watch('clientKey')]);

  // Mutation para salvar configurações
  const saveMutation = useMutation({
    mutationFn: async (data: AdyenConfigData) => {
      const response = await fetch('/api/admin/adyen-config', {
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
        title: " Configurações Adyen salvas!",
        description: "Pagamentos globais com Adyen agora disponíveis.",
      });
      
      queryClient.invalidateQueries({ queryKey: ['admin-adyen-config'] });
      queryClient.invalidateQueries({ queryKey: ['adyen-status'] });
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

  const onSubmit = (data: AdyenConfigData) => {
    saveMutation.mutate(data);
  };

  const isConfigured = adyenStatus?.adyen_configured || false;

  return (
    <div className={className}>
      <Card className="max-w-2xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg dark:bg-gray-700">
              <Globe className="h-6 w-6 text-emerald-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Configurao Adyen
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
                Configure as credenciais da Adyen para habilitar pagamentos globais alternativos ao Stripe.
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
                ? "Adyen configurado - Pagamentos globais alternativos habilitados"
                : "Configure as credenciais para habilitar Adyen como opo global"
              }
            </AlertDescription>
          </Alert>

          <Separator />

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Merchant Account */}
            <div className="space-y-2">
              <Label htmlFor="merchantAccount" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Merchant Account
              </Label>
              <Input
                id="merchantAccount"
                placeholder="YourMerchantAccount"
                {...form.register('merchantAccount')}
                data-testid="input-adyen-merchant-account"
              />
              {form.formState.errors.merchantAccount && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.merchantAccount.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Encontre em: Adyen Customer Area Settings Account details
              </p>
            </div>

            {/* Environment */}
            <div className="space-y-2">
              <Label htmlFor="environment" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Ambiente
              </Label>
              <Select 
                value={form.watch('environment')} 
                onValueChange={(value) => form.setValue('environment', value as 'test' | 'live')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o ambiente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">Test (Sandbox)</SelectItem>
                  <SelectItem value="live">Live (Produção)</SelectItem>
                </SelectContent>
              </Select>
              {form.formState.errors.environment && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.environment.message}
                </p>
              )}
            </div>

            {/* Client Key */}
            <div className="space-y-2">
              <Label htmlFor="clientKey" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                Client Key (Frontend)
              </Label>
              <Input
                id="clientKey"
                placeholder="test_... ou live_..."
                {...form.register('clientKey')}
                data-testid="input-adyen-client-key"
              />
              {form.formState.errors.clientKey && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.clientKey.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Encontre em: Adyen Customer Area Developers API credentials Client key
              </p>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="apiKey" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                API Key (Backend)
              </Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showApiKey ? "text" : "password"}
                  placeholder="API Key para operaes backend"
                  {...form.register('apiKey')}
                  data-testid="input-adyen-api-key"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                  data-testid="button-toggle-api-key"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {form.formState.errors.apiKey && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.apiKey.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Mantenha esta chave segura - nunca compartilhe publicamente
              </p>
            </div>

            {/* HMAC Key */}
            <div className="space-y-2">
              <Label htmlFor="hmacKey" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                HMAC Key (Webhooks)
              </Label>
              <div className="relative">
                <Input
                  id="hmacKey"
                  type={showHmacKey ? "text" : "password"}
                  placeholder="HMAC Key para validao de webhooks"
                  {...form.register('hmacKey')}
                  data-testid="input-adyen-hmac-key"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                  onClick={() => setShowHmacKey(!showHmacKey)}
                  data-testid="button-toggle-hmac-key"
                >
                  {showHmacKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {form.formState.errors.hmacKey && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.hmacKey.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Necessria para validar webhooks de confirmação de pagamento
              </p>
            </div>

            <div className="bg-emerald-50 dark:bg-gray-700 p-4 rounded-lg space-y-2">
              <h4 className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                Como obter as credenciais:
              </h4>
              <ol className="text-xs text-[#f0f4ff] dark:text-emerald-200 space-y-1 ml-4">
                <li>1. Acesse o <a href="https://ca-test.adyen.com" target="_blank" rel="noopener noreferrer" className="underline">Adyen Customer Area</a></li>
                <li>2. Vem "Developers" "API credentials"</li>
                <li>3. Copie o "Client key", "API key" e configure "Allowed origins"</li>
                <li>4. Configure o HMAC key em "Webhooks" para receber notificações</li>
                <li>5. Para produção, use o ambiente Live. Para teste, use Test</li>
              </ol>
            </div>

            <CardFooter className="flex gap-3 p-0">
              <Button 
                type="submit" 
                className="flex-1"
                disabled={saveMutation.isPending || !form.formState.isDirty}
                data-testid="button-save-adyen-config"
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