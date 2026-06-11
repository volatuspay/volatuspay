import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/auth";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Palette, Database, MessageSquare, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useCustomToast } from "@/hooks/use-custom-toast";
import ToastContainer from "@/components/ui/toast-container";
import { auth } from "@/lib/firebase";

// TIPOS PARA CONFIGURAÇES (SIMPLIFICADO - SEM LOGOS)
interface AppConfiguration {
  // Dados da empresa
  gatewayName: string;
  companyRegistration: string; // CNPJ
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  
  // SEO
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  
  // Configurações visuais
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
}

export default function AdminConfigurations() {
  const { user } = useAuthStore();
  const { toasts, removeToast, success, error, warning, info } = useCustomToast();
  const initialTab = new URLSearchParams(window.location.search).get('tab') || 'company';

  // Estados das configurações
  const [config, setConfig] = useState<AppConfiguration>({
    gatewayName: "VolatusPay",
    companyRegistration: "60.416.460/0001-27",
    companyAddress: "",
    companyPhone: "5515998000086",
    companyEmail: "volatuspay@gmail.com",
    siteTitle: "VolatusPay",
    siteSubtitle: "Gateway de Pagamentos",
    siteDescription: "O melhor Gateway de pagamentos do Brasil",
    primaryColor: "#2563eb",
    secondaryColor: "#06b6d4",
    backgroundColor: "#ffffff",
    textColor: "#1f2937"
  });
  // ✅ Ref espelha config sempre - timeout do debounce lê daqui p/ evitar stale closure
  const configRef = useRef<AppConfiguration>(config);
  configRef.current = config;

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // WHATSAPP ESTADO
  const [whatsapp, setWhatsapp] = useState({
    enabled: true,
    apiKey: '',
    sessionName: 'volatuspay',
    notifyPixGenerated: true,
    notifyPixPaid: true,
    notifyMemberAccess: true,
  });
  const [waSaving, setWaSaving] = useState(false);
  const [waTesting, setWaTesting] = useState(false);
  const [waSendingTest, setWaSendingTest] = useState(false);
  const [waStatus, setWaStatus] = useState<{ connected: boolean; phone?: string; message?: string } | null>(null);
  const [waTestPhone, setWaTestPhone] = useState('');

  // CARREGAR CONFIGURAÇES DO BACKEND
  useEffect(() => {
    const loadConfigurations = async () => {
      setLoading(true);
      try {
        if (!user) {
          setLoading(false);
          return;
        }

        console.log('Carregando configurações...');
        
        const token = await auth.currentUser?.getIdToken(true);
        
        if (!token) {
          console.log('Token no obtido');
          setLoading(false);
          return;
        }

        const response = await fetch('/api/admin/configurations', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          },
          cache: 'no-cache'
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Configurações carregadas:', data);
          setConfig(data);
          info('Configurações carregadas', 'Dados atualizados com sucesso.');
        } else {
          const errorData = await response.json();
          console.error('Erro ao carregar configurações:', errorData);
          error('Erro ao carregar', errorData.error || 'No foi possvel carregar as configurações.');
        }

        // CARREGAR CONFIG WHATSAPP
        try {
          const waRes = await fetch('/api/admin/whatsapp/config', {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
          });
          if (waRes.ok) {
            const waData = await waRes.json();
            if (waData.config) setWhatsapp(prev => ({ ...prev, ...waData.config }));
          }
        } catch {}
      } catch (err) {
        console.error('Erro ao carregar configurações:', err);
        error('Erro de conexo', 'Verifique sua conexo com a internet.');
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadConfigurations();
    }
  }, [user]);

  // ATUALIZAR CONFIGURAÇÃO EM TEMPO REAL
  const updateConfig = (field: keyof AppConfiguration, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    
    // SALVAMENTO AUTOMTICO EM TEMPO REAL
    debounceAutoSave();
  };

  // DEBOUNCE PARA SALVAMENTO AUTOMTICO
  // ✅ useRef persiste entre renders - sem ref, clearTimeout limpava undefined a cada render
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debounceAutoSave = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      handleSaveConfigurations(true); // true = salvamento silencioso
    }, 1000); // Salva 1 segundo após parar de digitar
  };

  // SALVAR CONFIGURAÇES GLOBAIS
  const handleSaveConfigurations = async (silent = false) => {
    if (!silent) setSaving(true);
    
    try {
      if (!silent) {
        info('Salvando configurações...', 'Aplicando mudanas globalmente...');
      }
      
      if (!user) {
        error('Erro de autenticação', 'Usuário não está logado.');
        return;
      }

      const token = await auth.currentUser?.getIdToken(true);
      
      if (!token) {
        error('Erro de autenticação', 'Token de acesso não encontrado.');
        return;
      }

      // ✅ Usar configRef.current - lê o estado mais recente mesmo em closures do debounce
      const requestData = {
        ...configRef.current,
        updatedBy: user.email || 'admin',
        updatedAt: new Date().toISOString()
      };
      
      console.log('Salvando configurações:', requestData);
      
      const response = await fetch('/api/admin/configurations', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(requestData),
        cache: 'no-cache'
      });

      if (response.ok) {
        const result = await response.json();
        if (!silent) {
          success('Configurações salvas!', 'As configurações foram aplicadas globalmente com sucesso.');
        }
        console.log('Configurações salvas:', result);
        
        // FORÇAR ATUALIZAÇÃO GLOBAL
        window.dispatchEvent(new CustomEvent('configUpdated', { detail: configRef.current }));
        
      } else {
        const errorData = await response.json();
        console.error('Erro ao salvar:', errorData);
        error('Erro ao salvar', errorData.error || 'No foi possvel salvar as configurações.');
      }
      
    } catch (err) {
      console.error('Erro ao salvar configurações:', err);
      if (!silent) {
        error('Erro de conexo', 'Verifique sua conexo com a internet.');
      }
    } finally {
      if (!silent) setSaving(false);
    }
  };

  // SALVAR CONFIG WHATSAPP
  const handleSaveWhatsApp = async () => {
    setWaSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch('/api/admin/whatsapp/config', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(whatsapp),
      });
      const data = await res.json();
      if (res.ok) {
        success('WhatsApp salvo!', 'Configurações do WhatsApp salvas com sucesso.');
      } else {
        error('Erro', data.error || 'Erro ao salvar configurações do WhatsApp');
      }
    } catch {
      error('Erro de conexão', 'Não foi possível salvar as configurações do WhatsApp.');
    } finally {
      setWaSaving(false);
    }
  };

  // TESTAR CONEXÃO WHATSAPP
  const handleTestConnection = async () => {
    if (!whatsapp.apiKey) { error('API Key obrigatória', 'Informe a chave de API do WhatsApp.'); return; }
    setWaTesting(true);
    setWaStatus(null);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch('/api/admin/whatsapp/test-connection', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: whatsapp.apiKey }),
      });
      const data = await res.json();
      setWaStatus({ connected: data.connected, phone: data.phone, message: data.message });
    } catch {
      setWaStatus({ connected: false, message: 'Erro de conexão' });
    } finally {
      setWaTesting(false);
    }
  };

  // ENVIAR MENSAGEM DE TESTE
  const handleSendTestMessage = async () => {
    if (!whatsapp.apiKey || !whatsapp.sessionName || !waTestPhone) {
      error('Campos obrigatórios', 'Preencha API Key, nome da sessão e número de teste.');
      return;
    }
    setWaSendingTest(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch('/api/admin/whatsapp/test-message', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: whatsapp.apiKey, sessionName: whatsapp.sessionName, phone: waTestPhone }),
      });
      const data = await res.json();
      if (data.success) {
        success('Mensagem enviada!', 'Mensagem de teste enviada com sucesso pelo WhatsApp.');
      } else {
        error('Falha ao enviar', data.message || 'Não foi possível enviar a mensagem de teste.');
      }
    } catch {
      error('Erro de conexão', 'Não foi possível enviar a mensagem de teste.');
    } finally {
      setWaSendingTest(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Loading... Configurações do Sistema
            </h1>
            <p className="text-muted-foreground mt-2">
              Configure dados da empresa e personalizao visual global
            </p>
          </div>
          
          <Badge variant="outline" className="text-xs">
            Admin Only
          </Badge>
        </div>

        <Tabs defaultValue={initialTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="company">Dados da Empresa</TabsTrigger>
            <TabsTrigger value="visual" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Visual & SEO
            </TabsTrigger>
            <TabsTrigger value="system" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Sistema
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              WhatsApp
            </TabsTrigger>
          </TabsList>

          {/* ABA: DADOS DA EMPRESA */}
          <TabsContent value="company">
            <Card>
              <CardHeader>
                <CardTitle>Dados Informações da Empresa</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Configure os dados bsicos da sua empresa que aparecerão no site
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="gatewayName">Nome da Empresa</Label>
                    <Input
                      id="gatewayName"
                      value={config.gatewayName}
                      onChange={(e) => updateConfig('gatewayName', e.target.value)}
                      placeholder="Ex: VolatusPay"
                      data-testid="input-gateway-name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="companyRegistration">CNPJ</Label>
                    <Input
                      id="companyRegistration"
                      value={config.companyRegistration}
                      onChange={(e) => updateConfig('companyRegistration', e.target.value)}
                      placeholder="Ex: 00.000.000/0001-00"
                      data-testid="input-company-registration"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="companyPhone">Telefone</Label>
                    <Input
                      id="companyPhone"
                      value={config.companyPhone}
                      onChange={(e) => updateConfig('companyPhone', e.target.value)}
                      placeholder="Ex: (11) 99999-9999"
                      data-testid="input-company-phone"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="companyEmail">E-mail</Label>
                    <Input
                      id="companyEmail"
                      type="email"
                      value={config.companyEmail}
                      onChange={(e) => updateConfig('companyEmail', e.target.value)}
                      placeholder="Ex: contato@empresa.com"
                      data-testid="input-company-email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyAddress">Endereço Completo</Label>
                  <Textarea
                    id="companyAddress"
                    value={config.companyAddress}
                    onChange={(e) => updateConfig('companyAddress', e.target.value)}
                    placeholder="Ex: Rua das Flores, 123 - Centro - São Paulo/SP - CEP: 01000-000"
                    className="min-h-20"
                    data-testid="input-company-address"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA: VISUAL & SEO */}
          <TabsContent value="visual">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Configurações Visuais & SEO
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Personalize a aparncia e otimizao do site
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* SEO */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">SEO & Meta Tags</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="siteTitle">Ttulo do Site</Label>
                      <Input
                        id="siteTitle"
                        value={config.siteTitle}
                        onChange={(e) => updateConfig('siteTitle', e.target.value)}
                        placeholder="Ex: VolatusPay"
                        data-testid="input-site-title"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="siteSubtitle">Subttulo</Label>
                      <Input
                        id="siteSubtitle"
                        value={config.siteSubtitle}
                        onChange={(e) => updateConfig('siteSubtitle', e.target.value)}
                        placeholder="Ex: Gateway de Pagamentos"
                        data-testid="input-site-subtitle"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="siteDescription">Descrição Meta</Label>
                    <Textarea
                      id="siteDescription"
                      value={config.siteDescription}
                      onChange={(e) => updateConfig('siteDescription', e.target.value)}
                      placeholder="Descrição para motores de busca (SEO)"
                      className="min-h-20"
                      data-testid="input-site-description"
                    />
                  </div>
                </div>

                {/* CORES */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Paleta de Cores</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="primaryColor">Cor Primria</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          id="primaryColor"
                          value={config.primaryColor}
                          onChange={(e) => updateConfig('primaryColor', e.target.value)}
                          className="w-12 h-10 rounded border"
                          data-testid="input-primary-color"
                        />
                        <Input
                          value={config.primaryColor}
                          onChange={(e) => updateConfig('primaryColor', e.target.value)}
                          placeholder="#2563eb"
                          className="flex-1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="secondaryColor">Cor Secundria</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          id="secondaryColor"
                          value={config.secondaryColor}
                          onChange={(e) => updateConfig('secondaryColor', e.target.value)}
                          className="w-12 h-10 rounded border"
                          data-testid="input-secondary-color"
                        />
                        <Input
                          value={config.secondaryColor}
                          onChange={(e) => updateConfig('secondaryColor', e.target.value)}
                          placeholder="#06b6d4"
                          className="flex-1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="backgroundColor">Cor de Fundo</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          id="backgroundColor"
                          value={config.backgroundColor}
                          onChange={(e) => updateConfig('backgroundColor', e.target.value)}
                          className="w-12 h-10 rounded border"
                          data-testid="input-background-color"
                        />
                        <Input
                          value={config.backgroundColor}
                          onChange={(e) => updateConfig('backgroundColor', e.target.value)}
                          placeholder="#ffffff"
                          className="flex-1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="textColor">Cor do Texto</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          id="textColor"
                          value={config.textColor}
                          onChange={(e) => updateConfig('textColor', e.target.value)}
                          className="w-12 h-10 rounded border"
                          data-testid="input-text-color"
                        />
                        <Input
                          value={config.textColor}
                          onChange={(e) => updateConfig('textColor', e.target.value)}
                          placeholder="#1f2937"
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA: SISTEMA */}
          <TabsContent value="system">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Configurações do Sistema
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Status e informações técnicas
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Logos do Sistema</Label>
                    <div className="p-4 border rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground">
                        Logos VolatusPay (fixas do sistema)
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Logo branca (landing page)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Logo escura (dashboard)
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Loading... Status do Sistema</Label>
                    <div className="space-y-2">
                      <div className="flex justify-between p-2 border rounded">
                        <span className="text-sm">Salvamento</span>
                        <Badge variant="default" className="bg-emerald-100 text-[#f0f4ff]">
                          Automático
                        </Badge>
                      </div>
                      <div className="flex justify-between p-2 border rounded">
                        <span className="text-sm">Propagao</span>
                        <Badge variant="default" className="bg-blue-100 text-blue-800">
                          Instantnea
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA: WHATSAPP */}
          <TabsContent value="whatsapp">
            <div className="space-y-6">
              {/* Instrução de setup */}
              <Card className="border-blue-200 bg-blue-50 dark:bg-green-950/20 dark:border-green-800">
                <CardContent className="pt-6">
                  <div className="flex gap-3">
                    <MessageSquare className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div className="space-y-3 flex-1">
                      <p className="font-semibold text-green-800 dark:text-green-300">Como conectar o WhatsApp</p>
                      <ol className="text-sm text-blue-700 dark:text-blue-400 space-y-1.5 list-decimal list-inside">
                        <li>Clique no botão abaixo para acessar o painel WasenderAPI</li>
                        <li>Crie uma sessão (dê um nome, ex: <strong>volatuspay</strong>) e escaneie o QR Code com seu celular</li>
                        <li>Anote o nome da sessão e coloque no campo "Nome da Sessão" abaixo</li>
                        <li>A API Key já está pré-configurada - clique em <strong>Salvar</strong></li>
                      </ol>
                      <a
                        href="https://wasenderapi.com/dashboard/whatsapp-sessions"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="sm" className="bg-blue-600 hover:bg-green-700 mt-1">
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Abrir WasenderAPI - Escanear QR Code
                        </Button>
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Configurações principais */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Configuração da API WasenderAPI
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Ativar/Desativar */}
                  <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                    <div>
                      <p className="font-medium">Ativar notificações WhatsApp</p>
                      <p className="text-sm text-muted-foreground">Enviar mensagens automáticas via WhatsApp</p>
                    </div>
                    <Switch
                      checked={whatsapp.enabled}
                      onCheckedChange={(v) => setWhatsapp(p => ({ ...p, enabled: v }))}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="wa-apikey">API Key da Sessão 🔑</Label>
                      <Input
                        id="wa-apikey"
                        type="password"
                        placeholder="Cole aqui a API Key do ícone 🔑"
                        value={whatsapp.apiKey}
                        onChange={(e) => setWhatsapp(p => ({ ...p, apiKey: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">Encontre no painel WasenderAPI → Sessão → ícone 🔑</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="wa-session">Nome da Sessão</Label>
                      <Input
                        id="wa-session"
                        placeholder="Ex: volatuspay"
                        value={whatsapp.sessionName}
                        onChange={(e) => setWhatsapp(p => ({ ...p, sessionName: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">O nome que você deu à sessão no WasenderAPI</p>
                    </div>
                  </div>

                  {/* Status da conexão */}
                  {waStatus && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg text-sm font-medium ${waStatus.connected ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-green-950/20 dark:text-blue-400' : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/20 dark:text-red-400'}`}>
                      {waStatus.connected ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      {waStatus.connected ? `Conectado${waStatus.phone ? ` - ${waStatus.phone}` : ''}` : `${waStatus.message || 'Desconectado'}`}
                    </div>
                  )}

                  <Button onClick={handleTestConnection} disabled={waTesting} variant="outline" className="w-full sm:w-auto">
                    {waTesting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Testando...</> : 'Testar Conexão'}
                  </Button>
                </CardContent>
              </Card>

              {/* Notificações */}
              <Card>
                <CardHeader>
                  <CardTitle>Notificações Automáticas</CardTitle>
                  <p className="text-sm text-muted-foreground">Escolha quais eventos disparam mensagem WhatsApp</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { key: 'notifyPixGenerated' as const, label: 'PIX Gerado', desc: 'Envia o código PIX Copia e Cola assim que o cliente cria o pedido' },
                    { key: 'notifyPixPaid' as const, label: 'Pagamento Confirmado', desc: 'Notifica quando o pagamento PIX é confirmado pelo banco' },
                    { key: 'notifyMemberAccess' as const, label: 'Acesso de Membros', desc: 'Envia email e senha de acesso à área de membros após compra' },
                  ].map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between p-4 rounded-lg border">
                      <div>
                        <p className="font-medium">{label}</p>
                        <p className="text-sm text-muted-foreground">{desc}</p>
                      </div>
                      <Switch
                        checked={whatsapp[key]}
                        onCheckedChange={(v) => setWhatsapp(p => ({ ...p, [key]: v }))}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Mensagem de teste */}
              <Card>
                <CardHeader>
                  <CardTitle>Enviar Mensagem de Teste</CardTitle>
                  <p className="text-sm text-muted-foreground">Envie uma mensagem de teste para verificar a integração</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="wa-test-phone">Número para Teste (com DDI)</Label>
                    <Input
                      id="wa-test-phone"
                      placeholder="Ex: 5511999999999"
                      value={waTestPhone}
                      onChange={(e) => setWaTestPhone(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Somente números: DDI + DDD + número (ex: 5511999999999)</p>
                  </div>
                  <Button onClick={handleSendTestMessage} disabled={waSendingTest} variant="outline">
                    {waSendingTest ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando...</> : '📤 Enviar Teste'}
                  </Button>
                </CardContent>
              </Card>

              {/* Botão salvar WhatsApp */}
              <div className="flex justify-end">
                <Button onClick={handleSaveWhatsApp} disabled={waSaving} size="lg" className="bg-blue-600 hover:bg-green-700">
                  {waSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : '💾 Salvar Configurações WhatsApp'}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* BOTÃO DE SALVAMENTO MANUAL */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-semibold">Salvar Configurações</h3>
                <p className="text-sm text-muted-foreground">
                  As configurações são salvas automaticamente, mas você pode forçar um salvamento manual
                </p>
              </div>
              
              <Button
                onClick={() => handleSaveConfigurations()}
                disabled={saving}
                size="lg"
                data-testid="save-configurations"
              >
                {saving ? 'Salvando...' : 'Salvar Agora'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* NOTIFICAÇES */}
        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </DashboardLayout>
  );
}