import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StripeConfig } from '@/components/admin/stripe-config';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { CreditCard, Shield, Globe, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';

export function StripeSettingsPage() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Configurações Stripe</h1>
              <p className="text-muted-foreground">
                Configure pagamentos globais em mltiplas moedas
              </p>
            </div>
          </div>
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            <Globe className="h-3 w-3 mr-1" />
            Pagamentos Globais
          </Badge>
        </div>

        <Separator />

        {/* Informações importantes */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CreditCard className="h-5 w-5 text-blue-600" />
                Moedas Suportadas
              </CardTitle>
              <CardDescription>
                Aceite pagamentos em diferentes moedas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                <Badge variant="outline">USD </Badge>
                <Badge variant="outline">EUR </Badge>
                <Badge variant="outline">GBP </Badge>
                <Badge variant="outline">CAD </Badge>
                <Badge variant="outline">AUD </Badge>
                <Badge variant="outline">+140 mais</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-emerald-600" />
                Segurana
              </CardTitle>
              <CardDescription>
                PCI-DSS Level 1 compliant
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  <span>Criptografia de ponta a ponta</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  <span>Tokenizao de cartões</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  <span>Deteco de fraude com ML</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Avisão importante */}
        <Alert className="bg-yellow-50 border-yellow-200">
          <Shield className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800">
            <strong>Importante:</strong> As chaves são salvas de forma segura no Firebase. 
            Para produção, recomendamos usar chaves "live". Para testes, use chaves "test".
            <br />
            <span className="text-sm">
              As conversões de moeda são feitas automaticamente usando taxas em tempo real.
            </span>
          </AlertDescription>
        </Alert>

        {/* Interface de configuração */}
        <StripeConfig className="w-full" />

        {/* Informações sobre conversão de moeda */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Como funciona a conversão de moeda
            </CardTitle>
            <CardDescription>
              Sistema automático de conversão USD BRL
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium mb-2">Conversão Automática</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Taxas atualizadas em tempo real</li>
                  <li>Mltiplas fontes de cotao</li>
                  <li>Fallback para taxas conservadoras</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2">Exibio para Clientes</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Preo original (USD $5.30)</li>
                  <li>Conversão em reais (R$ 28,15)</li>
                  <li>Taxa de cmbio transparente</li>
                </ul>
              </div>
            </div>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Exemplo:</strong> Um produto de $5.30 USD serexibido como 
                " $5.30 R$ 28,15 em reais" usando a taxa atual (1 USD = 5.3225 BRL)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}