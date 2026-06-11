import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { useAuthStore } from '@/stores/auth';
import { auth } from '@/lib/firebase';
import { apiRequest } from '@/lib/queryClient';
import { useCustomDialog } from '@/hooks/use-custom-dialog';
import { 
  Settings, 
  Webhook, 
  CreditCard, 
  BarChart3, 
  Mail, 
  MessageSquare,
  Package,
  Plus,
  Key,
  ExternalLink,
  FileText,
  Check,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Play,
  Loader2,
  TestTube2,
  ChevronRight,
  Send,
  Truck
} from 'lucide-react';

export default function IntegrationsPage({ inline = false }: { inline?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState("webhook");
  const { user } = useAuthStore();
  const { showAlert, showConfirm } = useCustomDialog();
  
  // Estados dos formulrios
  const [webhookData, setWebhookData] = useState({
    url: "",
    events: [] as string[],
    secret: ""
  });
  
  const [apiKeyData, setApiKeyData] = useState({
    name: "",
    permissions: [] as string[]
  });

  // Estado para popup de chave gerada
  const [showApiKeyPopup, setShowApiKeyPopup] = useState(false);
  const [generatedApiKey, setGeneratedApiKey] = useState("");

  // Estado para popup de webhook criado
  const [showWebhookPopup, setShowWebhookPopup] = useState(false);
  const [createdWebhookData, setCreatedWebhookData] = useState({ url: "", secret: "" });

  // Estados do UTMify
  const [utmifyData, setUtmifyData] = useState({
    apiToken: "",
    enabled: false,
    loading: false,
    configured: false,
    last4: "",
    testing: false
  });

  // Estados do Notazz
  const [notazzData, setNotazzData] = useState({
    apiKey: "",
    cnae: "",
    enabled: false,
    loading: false,
    configured: false,
    last4: ""
  });

  // Estados do Telegram
  const [telegramData, setTelegramData] = useState({
    botToken: "",
    chatId: "",
    events: [] as string[],
    enabled: false,
    loading: false,
    testing: false,
    configured: false,
    last4: "",
  });

  // Estados do Discord
  const [discordData, setDiscordData] = useState({
    webhookUrl: "",
    events: [] as string[],
    enabled: false,
    loading: false,
    testing: false,
    configured: false,
    last4: "",
  });

  // Estados do Xtracky
  const [xtrackyData, setXtrackyData] = useState({
    productId: "",
    enabled: false,
    loading: false,
    testing: false,
    configured: false,
    last4: "",
  });

  // Modal de integração aberta
  const [openIntegrationModal, setOpenIntegrationModal] = useState<'utmify' | 'notazz' | 'telegram' | 'xtracky' | 'discord' | null>(null);



  // Estados para listar dados reais
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);

  // Carregar webhooks e API keys ao montar
  useEffect(() => {
    if (user) {
      loadWebhooks();
      loadApiKeys();
    }
  }, [user]);

  const loadWebhooks = async () => {
    try {
      const response = await apiRequest('/api/integrations/webhooks', 'GET');
      
      if (response.ok) {
        const data = await response.json();
        setWebhooks(data.webhooks || []);
      }
    } catch (error) {
      console.error('Erro ao carregar webhooks:', error);
    }
  };

  const loadApiKeys = async () => {
    try {
      const response = await apiRequest('/api/integrations/api-keys', 'GET');
      
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.apiKeys || []);
      }
    } catch (error) {
      console.error('Erro ao carregar API keys:', error);
    }
  };

  const handleWebhookSubmit = async () => {
    const webhookUrl = webhookData.url;
    const webhookEvents = webhookData.events ?? [];
    const webhookSecret = webhookData.secret;

    if (!webhookUrl || webhookEvents.length === 0) {
      await showAlert("Preencha a URL e selecione pelo menos um evento!", "Ateno", "warning");
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await apiRequest('/api/integrations/webhooks', 'POST', { url: webhookUrl, events: webhookEvents, secret: webhookSecret });
      
      if (response.ok) {
        const result = await response.json();
        // Mostrar popup moderno
        setCreatedWebhookData({ 
          url: webhookData.url, 
          secret: result.secret || webhookData.secret 
        });
        setShowWebhookPopup(true);
        setWebhookData({ url: "", events: [], secret: "" });
        await loadWebhooks(); // Recarregar lista
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao criar webhook');
      }
    } catch (error: any) {
      console.error('Erro ao criar webhook:', error);
      await showAlert(`Erro: ${error.message}`, "Erro ao criar webhook", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleApiKeySubmit = async () => {
    const keyName = apiKeyData.name;
    const keyPermissions = apiKeyData.permissions ?? [];

    if (!keyName || keyPermissions.length === 0) {
      await showAlert("Preencha o nome e selecione pelo menos uma permisso!", "Ateno", "warning");
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await apiRequest('/api/integrations/api-keys', 'POST', { name: keyName, permissions: keyPermissions });
      
      if (response.ok) {
        const result = await response.json();
        // Mostrar chave completa APENAS UMA VEZ no popup
        setGeneratedApiKey(result.apiKey);
        setShowApiKeyPopup(true);
        setApiKeyData({ name: "", permissions: [] });
        await loadApiKeys(); // Recarregar lista
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao gerar chave API');
      }
    } catch (error: any) {
      console.error('Erro ao gerar API key:', error);
      await showAlert(`Erro: ${error.message}`, "Erro ao gerar chave API", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    const confirmed = await showConfirm('Tem certeza que deseja deletar este webhook?', 'Confirmar exclusão');
    if (!confirmed) {
      return;
    }
    
    try {
      const response = await apiRequest(`/api/integrations/webhooks/${webhookId}`, 'DELETE');
      
      if (response.ok) {
        await showAlert('Webhook deletado com sucesso!', 'Sucesso', 'success');
        await loadWebhooks();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao deletar webhook');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, 'Erro ao deletar webhook', 'error');
    }
  };

  const handleDeleteApiKey = async (apiKeyId: string) => {
    const confirmed = await showConfirm('Tem certeza que deseja revogar esta chave API?', 'Confirmar revogao');
    if (!confirmed) {
      return;
    }
    
    try {
      const response = await apiRequest(`/api/integrations/api-keys/${apiKeyId}`, 'DELETE');
      
      if (response.ok) {
        await showAlert('Chave API revogada com sucesso!', 'Sucesso', 'success');
        await loadApiKeys();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao revogar chave API');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, 'Erro ao revogar chave', 'error');
    }
  };

  const handleTestWebhook = async (webhookId: string, eventType: string) => {
    setTestingWebhookId(webhookId);
    
    try {
      const response = await apiRequest(`/api/integrations/webhooks/${webhookId}/test`, 'POST', { eventType });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await showAlert(
            `Evento "${eventType}" enviado com sucesso!\n\nStatus: ${result.statusCode}\nResposta: ${result.responseTime}ms`,
            'Teste Enviado',
            'success'
          );
        } else {
          await showAlert(
            `Falha ao enviar evento.\n\nStatus: ${result.statusCode}\nErro: ${result.error || 'Sem resposta'}`,
            'Teste Falhou',
            'warning'
          );
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao testar webhook');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, 'Erro ao testar webhook', 'error');
    } finally {
      setTestingWebhookId(null);
    }
  };

  const toggleWebhookEvent = (event: string) => {
    setWebhookData(prev => ({
      ...prev,
      events: prev.events.includes(event) 
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event]
    }));
  };

  const toggleApiPermission = (permission: string) => {
    setApiKeyData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission]
    }));
  };

  const ALL_API_PERMISSIONS = [
    'orders:read','orders:write',
    'checkouts:read','checkouts:create',
    'products:read','products:write',
    'customers:read','customers:write',
    'refunds:create','balance:read','analytics:read',
    'subscriptions:read','subscriptions:write',
    'delivery:read','delivery:write',
    'payments:create','payments:read',
    'boleto:create','boleto:read',
    'card:create','card:read',
  ];

  const toggleAllApiPermissions = () => {
    const allSelected = ALL_API_PERMISSIONS.every(p => apiKeyData.permissions.includes(p));
    setApiKeyData(prev => ({
      ...prev,
      permissions: allSelected ? [] : [...ALL_API_PERMISSIONS],
    }));
  };

  // INTEGRATIONS CONFIG LOADING
  useEffect(() => {
    loadNotazzConfig();
    loadUtmifyConfig();
    loadTelegramConfig();
    loadDiscordConfig();
    loadXtrackyConfig();
  }, [user]);

  const loadNotazzConfig = async () => {
    if (!user) return;
    
    try {
      const response = await apiRequest('/api/integrations/notazz/config', 'GET');

      if (response.ok) {
        const config = await response.json();
        setNotazzData(prev => ({
          ...prev,
          apiKey: config.configured ? `****${config.last4}` : "",
          cnae: config.cnae || "",
          enabled: config.enabled || false,
          configured: config.configured || false,
          last4: config.last4 || ""
        }));
      }
    } catch (error) {
      console.error('Erro ao carregar configuração do Notazz:', error);
    }
  };

  const handleNotazzSave = async () => {
    // Para nova configuração, precisa de API Key. Para atualização, permite vazio se jconfigurado
    if (!user || (!notazzData.apiKey.trim() && !notazzData.configured)) {
      await showAlert("Preencha a API Key do Notazz!", "Ateno", "warning");
      return;
    }

    setNotazzData(prev => ({ ...prev, loading: true }));

    try {
      // Senviar API Key se foi digitada uma nova (no comea com ****)
      const shouldUpdateApiKey = notazzData.apiKey.trim() && !notazzData.apiKey.startsWith('****');
      
      const response = await apiRequest('/api/integrations/notazz/config', 'POST', {
        ...(shouldUpdateApiKey && { apiKey: notazzData.apiKey.trim() }),
        cnae: notazzData.cnae.trim() || undefined
      });

      if (response.ok) {
        const result = await response.json();
        setNotazzData(prev => ({ 
          ...prev, 
          enabled: true,
          configured: result.configured || true
        }));
        await showAlert("Configuração do Notazz salva com sucesso!", "Sucesso", "success");
        // Recarregar configuração para exibir API Key mascarada
        await loadNotazzConfig();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao salvar configuração');
      }
    } catch (error: any) {
      console.error('Erro ao salvar configuração do Notazz:', error);
      await showAlert(`Erro ao salvar configuração: ${error.message}`, "Erro ao salvar", "error");
    } finally {
      setNotazzData(prev => ({ ...prev, loading: false }));
    }
  };

  const loadUtmifyConfig = async () => {
    if (!user) return;
    try {
      const response = await apiRequest('/api/integrations/utmify/config', 'GET');
      if (response.ok) {
        const config = await response.json();
        setUtmifyData(prev => ({
          ...prev,
          apiToken: config.configured ? `****${config.last4}` : "",
          enabled: config.enabled || false,
          configured: config.configured || false,
          last4: config.last4 || ""
        }));
      }
    } catch (error) {
      console.error('Erro ao carregar configuração do UTMify:', error);
    }
  };

  const handleUtmifySave = async () => {
    if (!user || (!utmifyData.apiToken.trim() && !utmifyData.configured)) {
      await showAlert("Preencha o Token da API do UTMify!", "Atenção", "warning");
      return;
    }

    setUtmifyData(prev => ({ ...prev, loading: true }));
    try {
      const shouldUpdateToken = utmifyData.apiToken.trim() && !utmifyData.apiToken.startsWith('****');
      const response = await apiRequest('/api/integrations/utmify/config', 'POST', {
        ...(shouldUpdateToken && { apiToken: utmifyData.apiToken.trim() }),
        enabled: true
      });

      if (response.ok) {
        setUtmifyData(prev => ({ ...prev, enabled: true, configured: true }));
        await showAlert("Configuração do UTMify salva com sucesso!", "Sucesso", "success");
        await loadUtmifyConfig();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao salvar configuração');
      }
    } catch (error: any) {
      console.error('Erro ao salvar configuração do UTMify:', error);
      await showAlert(`Erro ao salvar: ${error.message}`, "Erro", "error");
    } finally {
      setUtmifyData(prev => ({ ...prev, loading: false }));
    }
  };

  const handleUtmifyTest = async () => {
    if (!utmifyData.configured) {
      await showAlert("Configure o UTMify primeiro!", "Atenção", "warning");
      return;
    }
    setUtmifyData(prev => ({ ...prev, testing: true }));
    try {
      const response = await apiRequest('/api/integrations/utmify/test', 'POST');
      if (response.ok) {
        await showAlert("Conexão com UTMify testada com sucesso!", "Sucesso", "success");
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Falha no teste');
      }
    } catch (error: any) {
      await showAlert(`Erro no teste: ${error.message}`, "Erro", "error");
    } finally {
      setUtmifyData(prev => ({ ...prev, testing: false }));
    }
  };

  const handleUtmifyDisable = async () => {
    setUtmifyData(prev => ({ ...prev, loading: true }));
    try {
      const response = await apiRequest('/api/integrations/utmify/config', 'POST', {
        enabled: false
      });
      if (response.ok) {
        setUtmifyData(prev => ({ ...prev, enabled: false }));
        await showAlert("UTMify desativado com sucesso!", "Sucesso", "success");
        await loadUtmifyConfig();
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setUtmifyData(prev => ({ ...prev, loading: false }));
    }
  };

  // ── TELEGRAM ───────────────────────────────────────────────────────────────
  const TELEGRAM_EVENTS = [
    { value: 'payment.pix.paid',     label: '✅ Venda aprovada (PIX)' },
    { value: 'payment.card.approved',label: '✅ Cartão aprovado' },
    { value: 'payment.pix.created',  label: '🟡 PIX gerado (aguardando)' },
    { value: 'payment.pix.expired',  label: '⏰ PIX expirado' },
    { value: 'payment.boleto.created',label: '📄 Boleto gerado' },
    { value: 'payment.boleto.paid',  label: '🟢 Boleto pago' },
    { value: 'payment.refunded',     label: '🔴 Reembolso' },
    { value: 'payment.chargeback',   label: '⚠️ Chargeback' },
    { value: 'payment.declined',     label: '❌ Pagamento recusado' },
    { value: 'cart.abandoned',       label: '🛒 Carrinho abandonado' },
  ];

  const loadTelegramConfig = async () => {
    if (!user) return;
    try {
      const response = await apiRequest('/api/integrations/telegram/config', 'GET');
      if (response.ok) {
        const config = await response.json();
        setTelegramData(prev => ({
          ...prev,
          botToken: config.configured ? `****${config.last4}` : "",
          chatId: config.chatId || "",
          events: config.events || [],
          enabled: config.enabled || false,
          configured: config.configured || false,
          last4: config.last4 || "",
        }));
      }
    } catch {}
  };

  const handleTelegramSave = async () => {
    if (!telegramData.botToken.trim() || !telegramData.chatId.trim()) {
      await showAlert("Preencha o Bot Token e o Chat ID!", "Atenção", "warning");
      return;
    }
    setTelegramData(prev => ({ ...prev, loading: true }));
    try {
      const shouldUpdateToken = telegramData.botToken && !telegramData.botToken.startsWith('****');
      const response = await apiRequest('/api/integrations/telegram/config', 'POST', {
        ...(shouldUpdateToken && { botToken: telegramData.botToken.trim() }),
        chatId: telegramData.chatId.trim(),
        events: telegramData.events,
        enabled: true,
      });
      if (response.ok) {
        setTelegramData(prev => ({ ...prev, enabled: true, configured: true }));
        await showAlert("Telegram configurado com sucesso!", "Sucesso", "success");
        await loadTelegramConfig();
        setOpenIntegrationModal(null);
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao salvar');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setTelegramData(prev => ({ ...prev, loading: false }));
    }
  };

  const handleTelegramTest = async () => {
    if (!telegramData.configured) {
      await showAlert("Configure o Telegram primeiro!", "Atenção", "warning");
      return;
    }
    setTelegramData(prev => ({ ...prev, testing: true }));
    try {
      const response = await apiRequest('/api/integrations/telegram/test', 'POST');
      if (response.ok) {
        await showAlert("Mensagem de teste enviada! Verifique seu Telegram.", "Sucesso", "success");
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Falha no teste');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setTelegramData(prev => ({ ...prev, testing: false }));
    }
  };

  const handleTelegramDisable = async () => {
    setTelegramData(prev => ({ ...prev, loading: true }));
    try {
      await apiRequest('/api/integrations/telegram/disable', 'POST');
      setTelegramData(prev => ({ ...prev, enabled: false }));
      await showAlert("Telegram desativado!", "Sucesso", "success");
      await loadTelegramConfig();
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setTelegramData(prev => ({ ...prev, loading: false }));
    }
  };

  const toggleTelegramEvent = (event: string) => {
    setTelegramData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event],
    }));
  };
  // ───────────────────────────────────────────────────────────────────────────

  // ── DISCORD ──────────────────────────────────────────────────────────────
  const discordEvents = [
    { value: 'payment.pix.paid',      label: '✅ PIX pago' },
    { value: 'payment.card.approved', label: '💳 Cartão aprovado' },
    { value: 'payment.boleto.paid',   label: '📄 Boleto pago' },
    { value: 'payment.pix.created',   label: '🟡 PIX gerado (aguardando)' },
    { value: 'payment.refunded',      label: '🔴 Reembolso' },
    { value: 'payment.declined',      label: '❌ Pagamento recusado' },
    { value: 'payment.chargeback',    label: '⚠️ Chargeback' },
  ];

  const loadDiscordConfig = async () => {
    if (!user) return;
    try {
      const response = await apiRequest('/api/integrations/discord/config', 'GET');
      if (response.ok) {
        const config = await response.json();
        setDiscordData(prev => ({
          ...prev,
          webhookUrl: config.configured ? `****${config.last4}` : "",
          events: config.events || [],
          enabled: config.enabled || false,
          configured: config.configured || false,
          last4: config.last4 || "",
        }));
      }
    } catch {}
  };

  const handleDiscordSave = async () => {
    if (!discordData.webhookUrl.trim()) {
      await showAlert("Preencha a Webhook URL do Discord!", "Atenção", "warning");
      return;
    }
    setDiscordData(prev => ({ ...prev, loading: true }));
    try {
      const shouldUpdate = discordData.webhookUrl && !discordData.webhookUrl.startsWith('****');
      const response = await apiRequest('/api/integrations/discord/config', 'POST', {
        ...(shouldUpdate && { webhookUrl: discordData.webhookUrl.trim() }),
        events: discordData.events,
        enabled: true,
      });
      if (response.ok) {
        setDiscordData(prev => ({ ...prev, enabled: true, configured: true }));
        await showAlert("Discord configurado com sucesso!", "Sucesso", "success");
        await loadDiscordConfig();
        setOpenIntegrationModal(null);
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao salvar');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setDiscordData(prev => ({ ...prev, loading: false }));
    }
  };

  const handleDiscordTest = async () => {
    if (!discordData.configured) {
      await showAlert("Configure o Discord primeiro!", "Atenção", "warning");
      return;
    }
    setDiscordData(prev => ({ ...prev, testing: true }));
    try {
      const response = await apiRequest('/api/integrations/discord/test', 'POST');
      if (response.ok) {
        await showAlert("Mensagem de teste enviada! Verifique seu canal Discord.", "Sucesso", "success");
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Falha no teste');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setDiscordData(prev => ({ ...prev, testing: false }));
    }
  };

  const handleDiscordDisable = async () => {
    setDiscordData(prev => ({ ...prev, loading: true }));
    try {
      await apiRequest('/api/integrations/discord/disable', 'POST');
      setDiscordData(prev => ({ ...prev, enabled: false }));
      await showAlert("Discord desativado!", "Sucesso", "success");
      await loadDiscordConfig();
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setDiscordData(prev => ({ ...prev, loading: false }));
    }
  };

  const toggleDiscordEvent = (event: string) => {
    setDiscordData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event],
    }));
  };
  // ─────────────────────────────────────────────────────────────────────────

  // ── XTRACKY ──────────────────────────────────────────────────────────────
  const loadXtrackyConfig = async () => {
    if (!user) return;
    try {
      const response = await apiRequest('/api/integrations/xtracky/config', 'GET');
      if (response.ok) {
        const config = await response.json();
        setXtrackyData(prev => ({
          ...prev,
          productId: config.configured ? `****${config.last4}` : "",
          enabled: config.enabled || false,
          configured: config.configured || false,
          last4: config.last4 || "",
        }));
      }
    } catch {}
  };

  const handleXtrackySave = async () => {
    if (!xtrackyData.productId.trim()) {
      await showAlert("Preencha o Product ID do Xtracky!", "Atenção", "warning");
      return;
    }
    setXtrackyData(prev => ({ ...prev, loading: true }));
    try {
      const shouldUpdate = xtrackyData.productId && !xtrackyData.productId.startsWith('****');
      if (!shouldUpdate) {
        await showAlert("Nenhuma alteração detectada.", "Aviso", "warning");
        return;
      }
      const response = await apiRequest('/api/integrations/xtracky/config', 'POST', {
        productId: xtrackyData.productId.trim(),
      });
      if (response.ok) {
        setXtrackyData(prev => ({ ...prev, enabled: true, configured: true }));
        await showAlert("Xtracky configurado com sucesso!", "Sucesso", "success");
        await loadXtrackyConfig();
        setOpenIntegrationModal(null);
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao salvar');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setXtrackyData(prev => ({ ...prev, loading: false }));
    }
  };

  const handleXtrackyTest = async () => {
    if (!xtrackyData.configured) {
      await showAlert("Configure o Xtracky primeiro!", "Atenção", "warning");
      return;
    }
    setXtrackyData(prev => ({ ...prev, testing: true }));
    try {
      const response = await apiRequest('/api/integrations/xtracky/test', 'POST');
      if (response.ok) {
        await showAlert("Evento de teste enviado ao Xtracky! Verifique seu painel.", "Sucesso", "success");
      } else {
        const err = await response.json();
        throw new Error(err.error || 'Falha no teste');
      }
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setXtrackyData(prev => ({ ...prev, testing: false }));
    }
  };

  const handleXtrackyDisable = async () => {
    setXtrackyData(prev => ({ ...prev, loading: true }));
    try {
      await apiRequest('/api/integrations/xtracky/disable', 'POST');
      setXtrackyData(prev => ({ ...prev, enabled: false }));
      await showAlert("Xtracky desativado!", "Sucesso", "success");
      await loadXtrackyConfig();
    } catch (error: any) {
      await showAlert(`Erro: ${error.message}`, "Erro", "error");
    } finally {
      setXtrackyData(prev => ({ ...prev, loading: false }));
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Funo para copiar API key
  const copyApiKey = () => {
    navigator.clipboard.writeText(generatedApiKey);
  };

  // Funo para copiar webhook secret
  const copyWebhookSecret = () => {
    navigator.clipboard.writeText(createdWebhookData.secret);
  };

  const inner = (
    <>
      {/*  POPUP DE WEBHOOK CRIADO - ESTILO REPLIT/GOOGLE */}
      {showWebhookPopup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center px-3 sm:pt-24 sm:items-start">
          <div className="bg-white dark:bg-card rounded-lg shadow-2xl w-full max-w-2xl animate-in fade-in slide-in-from-top-4 duration-300 sm:max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 px-4 sm:px-6 py-3 sm:py-4 border-b border-blue-100 dark:border-blue-800 rounded-t-lg">
              <div className="flex items-start sm:items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base sm:text-lg font-semibold text-foreground dark:text-foreground">Webhook configurado com sucesso!</h3>
                  <p className="text-xs sm:text-sm text-brand-muted-foreground dark:text-gray-400">Seu endpoint estpronto para receber notificações</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-6 space-y-4">
              {/* URL do Webhook */}
              <div>
                <Label className="text-sm font-medium text-foreground  mb-2 block">URL do Webhook:</Label>
                <div className="bg-brand-subtle dark:bg-gray-700 dark:backdrop-blur-md border border-brand-muted dark:border-[#2563eb]/20 rounded-lg p-3 sm:p-4 font-mono text-xs sm:text-sm break-all text-foreground dark:text-foreground overflow-x-auto">
                  {createdWebhookData.url}
                </div>
              </div>

              {/* Secret (se houver) */}
              {createdWebhookData.secret && (
                <div>
                  <Label className="text-xs sm:text-sm font-medium text-foreground mb-2 block"> Segredo de Validao:</Label>
                  <div className="relative">
                    <div className="bg-brand-subtle dark:bg-gray-700 dark:backdrop-blur-md border border-brand-muted dark:border-[#2563eb]/20 rounded-lg p-3 sm:p-4 pr-10 sm:pr-12 font-mono text-xs sm:text-sm break-all text-foreground dark:text-foreground overflow-x-auto">
                      {createdWebhookData.secret}
                    </div>
                    <button
                      onClick={copyWebhookSecret}
                      className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 p-1 sm:p-2 hover:bg-brand-subtle dark:hover:bg-brand-muted rounded-md transition-colors group"
                      title="Copiar segredo"
                    >
                      <Copy className="w-3 h-3 sm:w-4 sm:h-4 text-brand-muted-foreground dark:text-gray-400 group-hover:text-foreground dark:group-hover:text-gray-100" />
                    </button>
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="text-xs sm:text-sm text-brand-muted-foreground dark:text-gray-400 space-y-2 bg-blue-50 dark:bg-blue-950 p-3 sm:p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                <p className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 font-semibold flex-shrink-0"></span>
                  <span>Este webhook recebernotificações em tempo real dos eventos selecionados</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 font-semibold flex-shrink-0"></span>
                  <span>Use o segredo para validar a autenticidade das requisições</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 font-semibold flex-shrink-0"></span>
                  <span>Vocpode editar ou desativar este webhook a qualquer momento</span>
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-brand-subtle dark:bg-gray-700 dark:backdrop-blur-md px-4 sm:px-6 py-3 sm:py-4 border-t border-brand-muted dark:border-[#2563eb]/20 rounded-b-lg flex justify-end">
              <Button
                onClick={() => {
                  setShowWebhookPopup(false);
                  setCreatedWebhookData({ url: "", secret: "" });
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6"
              >
                OK, entendi!
              </Button>
            </div>
          </div>
        </div>
      )}

      {/*  POPUP DE CHAVE API GERADA - ESTILO REPLIT/GOOGLE */}
      {showApiKeyPopup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center px-3 sm:pt-24 sm:items-start">
          <div className="bg-white dark:bg-card rounded-lg shadow-2xl w-full max-w-2xl animate-in fade-in slide-in-from-top-4 duration-300 sm:max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-gradient-to-r from-lime-50 to-lime-50 dark:from-[#0d1300] dark:to-[#0d1300] px-4 sm:px-6 py-3 sm:py-4 border-b border-blue-100 dark:border-[#f0f4ff] rounded-t-lg">
              <div className="flex items-start sm:items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#2563eb] rounded-full flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base sm:text-lg font-semibold text-foreground dark:text-foreground">Chave API gerada com sucesso!</h3>
                  <p className="text-xs sm:text-sm text-brand-muted-foreground dark:text-gray-400">Sua chave de integração estpronta</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 sm:p-6 space-y-4">
              {/* Warning Banner */}
              <div className="bg-amber-50 border-l-4 border-amber-400 p-3 sm:p-4 rounded-r flex items-start gap-2 sm:gap-3">
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900 text-xs sm:text-sm">GUARDE EM LOCAL SEGURO!</p>
                  <p className="text-xs sm:text-sm text-amber-800 mt-1">
                    Esta chave no serexibida novamente. Copie-a agora e armazene em um local seguro.
                  </p>
                </div>
              </div>

              {/* API Key Display */}
              <div>
                <Label className="text-xs sm:text-sm font-medium text-foreground mb-2 block"> CHAVE:</Label>
                <div className="relative">
                  <div className="bg-brand-subtle border border-brand-muted rounded-lg p-3 sm:p-4 pr-10 sm:pr-12 font-mono text-xs sm:text-sm break-all text-foreground overflow-x-auto">
                    {generatedApiKey}
                  </div>
                  <button
                    onClick={copyApiKey}
                    className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 p-1 sm:p-2 hover:bg-brand-subtle rounded-md transition-colors group"
                    title="Copiar chave"
                  >
                    <Copy className="w-3 h-3 sm:w-4 sm:h-4 text-brand-muted-foreground group-hover:text-foreground" />
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="text-xs sm:text-sm text-brand-muted-foreground space-y-2 bg-blue-50 p-3 sm:p-4 rounded-lg border border-blue-100">
                <p className="flex items-start gap-2">
                  <span className="text-blue-600 font-semibold flex-shrink-0"></span>
                  <span>Use esta chave no header Authorization: Bearer YOUR_API_KEY</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-blue-600 font-semibold flex-shrink-0"></span>
                  <span>A chave fornece acesso s permisses configuradas</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="text-blue-600 font-semibold flex-shrink-0"></span>
                  <span>Vocpode revogar esta chave a qualquer momento na lista abaixo</span>
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-brand-subtle px-4 sm:px-6 py-3 sm:py-4 border-t border-brand-muted rounded-b-lg flex justify-end">
              <Button
                onClick={() => {
                  setShowApiKeyPopup(false);
                  setGeneratedApiKey("");
                }}
                className="bg-[#2563eb] hover:bg-[#2563eb] text-white px-4 sm:px-6"
              >
                OK, entendi!
              </Button>
            </div>
          </div>
        </div>
      )}
      
      <div className="px-3 md:px-6 space-y-6">
        <div className="flex justify-between items-center flex-col sm:flex-row gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Integrações</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-2">
              Configure APIs, webhooks e integrações externas para seu negócio
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-0 overflow-x-auto">
            <TabsTrigger value="webhook" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm p-2 sm:p-3">
              <Webhook className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="hidden sm:inline">Webhooks</span>
              <span className="sm:hidden">Webhk</span>
            </TabsTrigger>
            <TabsTrigger value="api" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm p-2 sm:p-3">
              <Key className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              API
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm p-2 sm:p-3">
              <BarChart3 className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="hidden sm:inline">Ferramentas</span>
              <span className="sm:hidden">Ferr</span>
            </TabsTrigger>
          </TabsList>

        <TabsContent value="webhook" className="space-y-4">
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="w-5 h-5" />
                  Criar Webhook Personalizado
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">URL do Webhook</Label>
                  <Input
                    id="webhook-url"
                    placeholder="https://sua-aplicacao.com/webhook"
                    value={webhookData.url}
                    onChange={(e) => setWebhookData(prev => ({ ...prev, url: e.target.value }))}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-4">
                  <Label htmlFor="webhook-events">Eventos para Receber</Label>
                  
                  {/* PAGAMENTOS */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Pagamentos</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-pix-created" className="rounded" 
                          checked={webhookData.events.includes('payment.pix.created')}
                          onChange={() => toggleWebhookEvent('payment.pix.created')} />
                        <Label htmlFor="event-pix-created" className="text-sm">PIX Gerado</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-pix-paid" className="rounded" 
                          checked={webhookData.events.includes('payment.pix.paid')}
                          onChange={() => toggleWebhookEvent('payment.pix.paid')} />
                        <Label htmlFor="event-pix-paid" className="text-sm">PIX Aprovado</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-pix-expired" className="rounded" 
                          checked={webhookData.events.includes('payment.pix.expired')}
                          onChange={() => toggleWebhookEvent('payment.pix.expired')} />
                        <Label htmlFor="event-pix-expired" className="text-sm">PIX Expirado</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-card-approved" className="rounded" 
                          checked={webhookData.events.includes('payment.card.approved')}
                          onChange={() => toggleWebhookEvent('payment.card.approved')} />
                        <Label htmlFor="event-card-approved" className="text-sm">Cartão Aprovado</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-boleto-created" className="rounded" 
                          checked={webhookData.events.includes('payment.boleto.created')}
                          onChange={() => toggleWebhookEvent('payment.boleto.created')} />
                        <Label htmlFor="event-boleto-created" className="text-sm">Boleto Gerado</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-boleto-paid" className="rounded" 
                          checked={webhookData.events.includes('payment.boleto.paid')}
                          onChange={() => toggleWebhookEvent('payment.boleto.paid')} />
                        <Label htmlFor="event-boleto-paid" className="text-sm">Boleto Pago</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-boleto-expired" className="rounded" 
                          checked={webhookData.events.includes('payment.boleto.expired')}
                          onChange={() => toggleWebhookEvent('payment.boleto.expired')} />
                        <Label htmlFor="event-boleto-expired" className="text-sm">Boleto Expirado</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-declined" className="rounded" 
                          checked={webhookData.events.includes('payment.declined')}
                          onChange={() => toggleWebhookEvent('payment.declined')} />
                        <Label htmlFor="event-declined" className="text-sm">Compra Recusada</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-refunded" className="rounded" 
                          checked={webhookData.events.includes('payment.refunded')}
                          onChange={() => toggleWebhookEvent('payment.refunded')} />
                        <Label htmlFor="event-refunded" className="text-sm">Reembolso</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-chargeback" className="rounded" 
                          checked={webhookData.events.includes('payment.chargeback')}
                          onChange={() => toggleWebhookEvent('payment.chargeback')} />
                        <Label htmlFor="event-chargeback" className="text-sm">Chargeback</Label>
                      </div>
                    </div>
                  </div>

                  {/* ASSINATURAS */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Assinaturas</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-sub-created" className="rounded" 
                          checked={webhookData.events.includes('subscription.created')}
                          onChange={() => toggleWebhookEvent('subscription.created')} />
                        <Label htmlFor="event-sub-created" className="text-sm">Assinatura Criada</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-sub-renewed" className="rounded" 
                          checked={webhookData.events.includes('subscription.renewed')}
                          onChange={() => toggleWebhookEvent('subscription.renewed')} />
                        <Label htmlFor="event-sub-renewed" className="text-sm">Assinatura Renovada</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-sub-cancelled" className="rounded" 
                          checked={webhookData.events.includes('subscription.cancelled')}
                          onChange={() => toggleWebhookEvent('subscription.cancelled')} />
                        <Label htmlFor="event-sub-cancelled" className="text-sm">Assinatura Cancelada</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-sub-overdue" className="rounded" 
                          checked={webhookData.events.includes('subscription.overdue')}
                          onChange={() => toggleWebhookEvent('subscription.overdue')} />
                        <Label htmlFor="event-sub-overdue" className="text-sm">Assinatura Atrasada</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-sub-failed" className="rounded" 
                          checked={webhookData.events.includes('subscription.payment_failed')}
                          onChange={() => toggleWebhookEvent('subscription.payment_failed')} />
                        <Label htmlFor="event-sub-failed" className="text-sm">Pagamento Falhou</Label>
                      </div>
                    </div>
                  </div>

                  {/* ACESSO - PRODUTOS DIGITAIS */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Acesso (Produtos Digitais)</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-access-granted" className="rounded" 
                          checked={webhookData.events.includes('access.granted')}
                          onChange={() => toggleWebhookEvent('access.granted')} />
                        <Label htmlFor="event-access-granted" className="text-sm">Acesso Liberado</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-access-revoked" className="rounded" 
                          checked={webhookData.events.includes('access.revoked')}
                          onChange={() => toggleWebhookEvent('access.revoked')} />
                        <Label htmlFor="event-access-revoked" className="text-sm">Acesso Revogado</Label>
                      </div>
                    </div>
                  </div>

                  {/* CARRINHO */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Carrinho</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="event-cart-abandoned" className="rounded" 
                          checked={webhookData.events.includes('cart.abandoned')}
                          onChange={() => toggleWebhookEvent('cart.abandoned')} />
                        <Label htmlFor="event-cart-abandoned" className="text-sm">Carrinho Abandonado</Label>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="webhook-secret">Secret Token (Opcional)</Label>
                  <Input
                    id="webhook-secret"
                    placeholder="Token para validar autenticidade"
                    type="password"
                    value={webhookData.secret}
                    onChange={(e) => setWebhookData(prev => ({ ...prev, secret: e.target.value }))}
                  />
                </div>
                <Button className="w-full" onClick={handleWebhookSubmit} disabled={loading}>
                  {loading ? (
                    <>
                      <Settings className="w-4 h-4 mr-2 animate-spin" />
                      Criando...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Criar Webhook
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Webhooks Configurados ({webhooks.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {webhooks.length === 0 ? (
                  <div className="text-center py-8">
                    <Webhook className="w-12 h-12 text-[#2563eb] mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">
                      Nenhum webhook configurado ainda.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Crie seu primeiro webhook acima para começar a receber notificações.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {webhooks.map((webhook) => (
                      <div key={webhook.id} className="border rounded-lg p-3 sm:p-4 space-y-2">
                        <div className="flex items-start justify-between flex-col sm:flex-row gap-2 sm:gap-4 break-words">
                          <code className="text-xs sm:text-sm font-mono bg-muted px-2 py-1 rounded flex-1 min-w-0 block overflow-x-auto">{webhook.url}</code>
                          <Badge variant={webhook.active ? "default" : "secondary"} className="flex-shrink-0">
                            {webhook.active ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(webhook.events || []).map((event: string) => (
                            <Badge key={event} variant="outline" className="text-xs">
                              {event}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground pt-2">
                          <span>Criado em: {new Date(webhook.createdAt).toLocaleDateString('pt-BR')}</span>
                          <div className="flex items-center gap-1 sm:gap-2 w-full sm:w-auto flex-wrap">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleTestWebhook(webhook.id, webhook.events[0] || 'order.paid')}
                              disabled={testingWebhookId === webhook.id}
                              className="text-blue-600 hover:text-blue-700 border-blue-200 hover:border-green-300 flex-1 sm:flex-initial"
                              data-testid={`button-test-webhook-${webhook.id}`}
                            >
                              {testingWebhookId === webhook.id ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  <span className="hidden sm:inline">Testando</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-3 h-3 mr-1" />
                                  <span className="hidden sm:inline">Testar</span>
                                </>
                              )}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleDeleteWebhook(webhook.id)}
                              className="text-red-600 hover:text-red-700 flex-1 sm:flex-initial"
                            >
                              <span className="hidden sm:inline">Deletar</span>
                              <span className="sm:hidden">Del</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  Chaves de API
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api-name">Nome da Integração</Label>
                  <Input
                    id="api-name"
                    placeholder="Ex: Meu Sistema de Vendas"
                    value={apiKeyData.name}
                    onChange={(e) => setApiKeyData(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Permissões da API</Label>
                    <button
                      type="button"
                      onClick={toggleAllApiPermissions}
                      className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 underline"
                    >
                      {ALL_API_PERMISSIONS.every(p => apiKeyData.permissions.includes(p)) ? 'Desmarcar todos' : 'Marcar todos'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                  
                  {/* PEDIDOS */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Pedidos</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-orders-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('orders:read')}
                          onChange={() => toggleApiPermission('orders:read')} />
                        <Label htmlFor="perm-orders-read" className="text-sm">Ler pedidos e vendas</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-orders-write" className="rounded" 
                          checked={apiKeyData.permissions.includes('orders:write')}
                          onChange={() => toggleApiPermission('orders:write')} />
                        <Label htmlFor="perm-orders-write" className="text-sm">Atualizar status de pedidos</Label>
                      </div>
                    </div>
                  </div>

                  {/* CHECKOUTS */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Checkouts</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-checkouts-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('checkouts:read')}
                          onChange={() => toggleApiPermission('checkouts:read')} />
                        <Label htmlFor="perm-checkouts-read" className="text-sm">Ler checkouts</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-checkouts-create" className="rounded" 
                          checked={apiKeyData.permissions.includes('checkouts:create')}
                          onChange={() => toggleApiPermission('checkouts:create')} />
                        <Label htmlFor="perm-checkouts-create" className="text-sm">Criar checkouts</Label>
                      </div>
                    </div>
                  </div>

                  {/* PRODUTOS */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Produtos</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-products-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('products:read')}
                          onChange={() => toggleApiPermission('products:read')} />
                        <Label htmlFor="perm-products-read" className="text-sm">Ler produtos</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-products-write" className="rounded" 
                          checked={apiKeyData.permissions.includes('products:write')}
                          onChange={() => toggleApiPermission('products:write')} />
                        <Label htmlFor="perm-products-write" className="text-sm">Gerenciar produtos</Label>
                      </div>
                    </div>
                  </div>

                  {/* CLIENTES */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Clientes</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-customers-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('customers:read')}
                          onChange={() => toggleApiPermission('customers:read')} />
                        <Label htmlFor="perm-customers-read" className="text-sm">Ler dados de clientes</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-customers-write" className="rounded" 
                          checked={apiKeyData.permissions.includes('customers:write')}
                          onChange={() => toggleApiPermission('customers:write')} />
                        <Label htmlFor="perm-customers-write" className="text-sm">Gerenciar clientes</Label>
                      </div>
                    </div>
                  </div>

                  {/* FINANCEIRO */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Financeiro</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-refunds-create" className="rounded" 
                          checked={apiKeyData.permissions.includes('refunds:create')}
                          onChange={() => toggleApiPermission('refunds:create')} />
                        <Label htmlFor="perm-refunds-create" className="text-sm">Processar reembolsos</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-balance-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('balance:read')}
                          onChange={() => toggleApiPermission('balance:read')} />
                        <Label htmlFor="perm-balance-read" className="text-sm">Consultar saldo</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-analytics-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('analytics:read')}
                          onChange={() => toggleApiPermission('analytics:read')} />
                        <Label htmlFor="perm-analytics-read" className="text-sm">Acessar relatórios</Label>
                      </div>
                    </div>
                  </div>

                  {/* ASSINATURAS */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Assinaturas</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-subscriptions-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('subscriptions:read')}
                          onChange={() => toggleApiPermission('subscriptions:read')} />
                        <Label htmlFor="perm-subscriptions-read" className="text-sm">Ler assinaturas</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-subscriptions-write" className="rounded" 
                          checked={apiKeyData.permissions.includes('subscriptions:write')}
                          onChange={() => toggleApiPermission('subscriptions:write')} />
                        <Label htmlFor="perm-subscriptions-write" className="text-sm">Gerenciar assinaturas</Label>
                      </div>
                    </div>
                  </div>

                  {/* ENTREGAS */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Entregas</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-delivery-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('delivery:read')}
                          onChange={() => toggleApiPermission('delivery:read')} />
                        <Label htmlFor="perm-delivery-read" className="text-sm">Ler status de entregas</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-delivery-write" className="rounded" 
                          checked={apiKeyData.permissions.includes('delivery:write')}
                          onChange={() => toggleApiPermission('delivery:write')} />
                        <Label htmlFor="perm-delivery-write" className="text-sm">Atualizar status de entregas</Label>
                      </div>
                    </div>
                  </div>

                  {/* PAGAMENTOS PIX */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Pagamentos PIX</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-payments-create" className="rounded" 
                          checked={apiKeyData.permissions.includes('payments:create')}
                          onChange={() => toggleApiPermission('payments:create')} />
                        <Label htmlFor="perm-payments-create" className="text-sm">Gerar cobrança PIX</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-payments-read" className="rounded" 
                          checked={apiKeyData.permissions.includes('payments:read')}
                          onChange={() => toggleApiPermission('payments:read')} />
                        <Label htmlFor="perm-payments-read" className="text-sm">Consultar status de pagamento</Label>
                      </div>
                    </div>
                  </div>

                  {/* PAGAMENTOS BOLETO */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Pagamentos Boleto</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-boleto-create" className="rounded"
                          checked={apiKeyData.permissions.includes('boleto:create')}
                          onChange={() => toggleApiPermission('boleto:create')} />
                        <Label htmlFor="perm-boleto-create" className="text-sm">Gerar boleto</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-boleto-read" className="rounded"
                          checked={apiKeyData.permissions.includes('boleto:read')}
                          onChange={() => toggleApiPermission('boleto:read')} />
                        <Label htmlFor="perm-boleto-read" className="text-sm">Consultar status de boleto</Label>
                      </div>
                    </div>
                  </div>

                  {/* PAGAMENTOS CARTÃO */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Pagamentos Cartão</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-card-create" className="rounded"
                          checked={apiKeyData.permissions.includes('card:create')}
                          onChange={() => toggleApiPermission('card:create')} />
                        <Label htmlFor="perm-card-create" className="text-sm">Processar pagamento cartão</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input type="checkbox" id="perm-card-read" className="rounded"
                          checked={apiKeyData.permissions.includes('card:read')}
                          onChange={() => toggleApiPermission('card:read')} />
                        <Label htmlFor="perm-card-read" className="text-sm">Consultar status cartão</Label>
                      </div>
                    </div>
                  </div>
                  </div>{/* fecha grid grid-cols-2 */}
                </div>
                <Button className="w-full" onClick={handleApiKeySubmit} disabled={loading}>
                  {loading ? (
                    <>
                      <Settings className="w-4 h-4 mr-2 animate-spin" />
                      Gerando...
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4 mr-2" />
                      Gerar Chave API
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Documentação da API</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Endpoint Base</h4>
                  <code className="text-sm bg-background p-2 rounded block">
                    https://volatuspay.com/api/v1
                  </code>
                </div>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  <h4 className="font-medium">Endpoints por Recurso:</h4>
                  
                  <div className="border-l-2 border-blue-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-gray-500">PEDIDOS</p>
                    <div><code className="text-blue-600">GET</code> /orders - Listar pedidos</div>
                    <div><code className="text-blue-600">GET</code> /orders/:id - Detalhes do pedido</div>
                    <div><code className="text-yellow-600">PATCH</code> /orders/:id - Atualizar status</div>
                  </div>

                  <div className="border-l-2 border-blue-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-gray-500">CHECKOUTS</p>
                    <div><code className="text-blue-600">GET</code> /checkouts - Listar checkouts</div>
                    <div><code className="text-blue-600">POST</code> /checkouts - Criar checkout</div>
                  </div>

                  <div className="border-l-2 border-[#2563eb] pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-gray-500">PRODUTOS</p>
                    <div><code className="text-blue-600">GET</code> /products - Listar produtos</div>
                    <div><code className="text-blue-600">POST</code> /products - Criar produto</div>
                    <div><code className="text-yellow-600">PATCH</code> /products/:id - Atualizar</div>
                  </div>

                  <div className="border-l-2 border-orange-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-gray-500">CLIENTES</p>
                    <div><code className="text-blue-600">GET</code> /customers - Listar clientes</div>
                    <div><code className="text-blue-600">GET</code> /customers/:id - Detalhes</div>
                  </div>

                  <div className="border-l-2 border-red-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-gray-500">FINANCEIRO</p>
                    <div><code className="text-blue-600">POST</code> /refunds - Processar reembolso</div>
                    <div><code className="text-blue-600">GET</code> /balance - Consultar saldo</div>
                    <div><code className="text-blue-600">GET</code> /analytics - Relatórios</div>
                  </div>

                  <div className="border-l-2 border-indigo-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-gray-500">ASSINATURAS</p>
                    <div><code className="text-blue-600">GET</code> /subscriptions - Listar</div>
                    <div><code className="text-yellow-600">PATCH</code> /subscriptions/:id - Atualizar</div>
                    <div><code className="text-red-600">DELETE</code> /subscriptions/:id - Cancelar</div>
                  </div>

                  <div className="border-l-2 border-teal-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-gray-500">ENTREGAS</p>
                    <div><code className="text-blue-600">GET</code> /delivery/:orderId - Status</div>
                    <div><code className="text-yellow-600">PATCH</code> /delivery/:orderId - Atualizar</div>
                  </div>

                  <div className="border-l-2 border-green-600 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">PAGAMENTOS PIX</p>
                    <div><code className="text-blue-600">POST</code> /payments - Gerar cobrança PIX</div>
                    <div className="text-xs text-gray-500 mt-1">Body: <code className="bg-muted px-1 rounded">{'{ method: "pix", amount: 9990, customer: { name, cpf, email } }'}</code></div>
                    <div className="text-xs text-gray-500">Retorna: <code className="bg-muted px-1 rounded">qrCode, qrCodeImage, orderId, status</code></div>
                  </div>

                  <div className="border-l-2 border-orange-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">PAGAMENTOS BOLETO</p>
                    <div><code className="text-blue-600">POST</code> /payments - Gerar boleto</div>
                    <div className="text-xs text-gray-500 mt-1">Body: <code className="bg-muted px-1 rounded">{'{ method: "boleto", amount: 9990, customer: { name, cpf, email, address } }'}</code></div>
                    <div className="text-xs text-gray-500">Retorna: <code className="bg-muted px-1 rounded">boletoUrl, barCode, orderId, status, expiresAt</code></div>
                  </div>

                  <div className="border-l-2 border-blue-500 pl-3 space-y-1 text-sm">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">PAGAMENTOS CARTÃO</p>
                    <div><code className="text-blue-600">POST</code> /payments - Processar cartão</div>
                    <div className="text-xs text-gray-500 mt-1">Body: <code className="bg-muted px-1 rounded">{'{ method: "card", amount: 9990, installments: 1, card: { number, expiry, cvv, name }, customer: { name, cpf } }'}</code></div>
                    <div className="text-xs text-gray-500">Retorna: <code className="bg-muted px-1 rounded">orderId, status, authCode</code></div>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => window.open('/docs', '_blank')}
                  data-testid="button-view-docs"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Ver Documentação Completa
                </Button>
              </CardContent>
            </Card>

            <Card className="sm:col-span-2">
              <CardHeader>
                <CardTitle>Suas Chaves API ({apiKeys.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {apiKeys.length === 0 ? (
                  <div className="text-center py-8">
                    <Key className="w-12 h-12 text-[#2563eb] mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">
                      Nenhuma chave API criada ainda.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Gere sua primeira chave API acima para começar a integrar com a VolatusPay.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {apiKeys.map((apiKey) => (
                      <div key={apiKey.id} className="border rounded-lg p-3 sm:p-4 space-y-2">
                        <div className="flex items-start justify-between flex-col sm:flex-row gap-2 sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-medium text-sm sm:text-base break-words">{apiKey.name}</h4>
                            <code className="text-xs text-muted-foreground block break-all">***************{apiKey.last4}</code>
                          </div>
                          <Badge variant={apiKey.active ? "default" : "secondary"} className="flex-shrink-0">
                            {apiKey.active ? "Ativa" : "Revogada"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(apiKey.permissions || []).map((perm: string) => (
                            <Badge key={perm} variant="outline" className="text-xs">
                              {perm}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground pt-2">
                          <div className="space-x-2 sm:space-x-3 flex flex-col sm:flex-row gap-2">
                            <span>Criada: {new Date(apiKey.createdAt).toLocaleDateString('pt-BR')}</span>
                            <span className="hidden sm:inline">|</span>
                            <span>Usos: {apiKey.usageCount}</span>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleDeleteApiKey(apiKey.id)}
                            className="text-red-600 hover:text-red-700 w-full sm:w-auto text-center"
                          >
                            Revogar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tools" className="space-y-4">
          {/* Modal UTMify */}
          <Dialog open={openIntegrationModal === 'utmify'} onOpenChange={(open) => !open && setOpenIntegrationModal(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#2563eb]" />
                  Configurar UTMify
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Rastreamento avançado de UTMs e conversões. Envia automaticamente dados de pedidos para o UTMify.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="utmify-token">API Token</Label>
                  <Input
                    id="utmify-token"
                    data-testid="input-utmify-token"
                    placeholder="Insira seu token da API UTMify"
                    value={utmifyData.apiToken}
                    onChange={(e) => setUtmifyData(prev => ({ ...prev, apiToken: e.target.value }))}
                    type={utmifyData.apiToken.startsWith('****') ? "text" : "password"}
                  />
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                {utmifyData.configured && utmifyData.enabled && (
                  <Button
                    data-testid="button-utmify-disable"
                    variant="ghost"
                    className="text-red-500 w-full sm:w-auto"
                    onClick={handleUtmifyDisable}
                    disabled={utmifyData.loading}
                  >
                    Desativar
                  </Button>
                )}
                {utmifyData.configured && (
                  <Button
                    data-testid="button-utmify-test"
                    variant="outline"
                    onClick={handleUtmifyTest}
                    disabled={utmifyData.testing}
                    className="w-full sm:w-auto"
                  >
                    {utmifyData.testing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube2 className="w-4 h-4 mr-2" />
                    )}
                    Testar
                  </Button>
                )}
                <Button
                  data-testid="button-utmify-save"
                  className="bg-[#2563eb] hover:bg-[#1d4ed8] w-full sm:w-auto"
                  onClick={async () => { await handleUtmifySave(); if (!utmifyData.loading) setOpenIntegrationModal(null); }}
                  disabled={utmifyData.loading}
                >
                  {utmifyData.loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4 mr-2" />
                  )}
                  {utmifyData.configured ? "Atualizar" : "Conectar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Modal Notazz */}
          <Dialog open={openIntegrationModal === 'notazz'} onOpenChange={(open) => !open && setOpenIntegrationModal(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#2563eb]" />
                  Configurar Notazz
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Emissão automática de NFS-e e NF-e para suas vendas.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="notazz-key">API Key</Label>
                  <Input
                    id="notazz-key"
                    placeholder="Insira sua chave de API do Notazz"
                    type="password"
                    value={notazzData.apiKey}
                    onChange={(e) => setNotazzData(prev => ({ ...prev, apiKey: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notazz-cnae">CNAE (Opcional)</Label>
                  <Input
                    id="notazz-cnae"
                    placeholder="Ex: 8599604"
                    value={notazzData.cnae}
                    onChange={(e) => setNotazzData(prev => ({ ...prev, cnae: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  <strong>Como obter:</strong> Acesse app.notazz.com → Configurações → Empresas → Copie a API KEY
                </p>
              </div>
              <DialogFooter>
                <Button
                  className="w-full bg-[#2563eb] hover:bg-[#1d4ed8]"
                  onClick={async () => { await handleNotazzSave(); }}
                  disabled={notazzData.loading}
                >
                  {notazzData.loading ? (
                    <>
                      <Settings className="w-4 h-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : notazzData.enabled ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Atualizar Configuração
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4 mr-2" />
                      Salvar Configuração
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Modal Telegram */}
          <Dialog open={openIntegrationModal === 'telegram'} onOpenChange={(open) => !open && setOpenIntegrationModal(null)}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center">
                    <Send className="w-4 h-4 text-white" />
                  </div>
                  Configurar Telegram
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Receba notificações de vendas diretamente no Telegram. Configure um bot e escolha quais eventos receber.
                </p>

                <div className="rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 p-3 text-xs text-sky-800 dark:text-sky-300 space-y-1">
                  <p className="font-semibold">Como configurar:</p>
                  <p>1. Fale com <b>@BotFather</b> no Telegram e crie um bot com <code>/newbot</code></p>
                  <p>2. Copie o <b>Bot Token</b> fornecido pelo BotFather</p>
                  <p>3. Adicione o bot ao seu grupo/canal e use <b>@userinfobot</b> para obter o <b>Chat ID</b></p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tg-token">Bot Token</Label>
                  <Input
                    id="tg-token"
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                    value={telegramData.botToken}
                    onChange={(e) => setTelegramData(prev => ({ ...prev, botToken: e.target.value }))}
                    type={telegramData.botToken.startsWith('****') ? "text" : "password"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tg-chatid">Chat ID</Label>
                  <Input
                    id="tg-chatid"
                    placeholder="-100123456789 ou @seucanal"
                    value={telegramData.chatId}
                    onChange={(e) => setTelegramData(prev => ({ ...prev, chatId: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Eventos para notificar</Label>
                  <div className="rounded-lg border p-3 space-y-2 max-h-48 overflow-y-auto">
                    {TELEGRAM_EVENTS.map(ev => (
                      <div key={ev.value} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`tg-ev-${ev.value}`}
                          checked={telegramData.events.includes(ev.value)}
                          onChange={() => toggleTelegramEvent(ev.value)}
                          className="rounded"
                        />
                        <label htmlFor={`tg-ev-${ev.value}`} className="text-sm cursor-pointer select-none">
                          {ev.label}
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Nenhum selecionado = notifica todos os eventos</p>
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                {telegramData.configured && telegramData.enabled && (
                  <Button
                    variant="ghost"
                    className="text-red-500 w-full sm:w-auto"
                    onClick={handleTelegramDisable}
                    disabled={telegramData.loading}
                  >
                    Desativar
                  </Button>
                )}
                {telegramData.configured && (
                  <Button
                    variant="outline"
                    onClick={handleTelegramTest}
                    disabled={telegramData.testing}
                    className="w-full sm:w-auto"
                  >
                    {telegramData.testing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube2 className="w-4 h-4 mr-2" />
                    )}
                    Testar
                  </Button>
                )}
                <Button
                  className="bg-sky-500 hover:bg-sky-600 w-full sm:w-auto"
                  onClick={handleTelegramSave}
                  disabled={telegramData.loading}
                >
                  {telegramData.loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  {telegramData.configured ? "Atualizar" : "Conectar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Modal Discord */}
          <Dialog open={openIntegrationModal === 'discord'} onOpenChange={(open) => !open && setOpenIntegrationModal(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#5865F2] flex items-center justify-center">
                    <MessageSquare className="w-4 h-4 text-white" />
                  </div>
                  Configurar Discord
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Receba notificações de vendas diretamente no seu servidor Discord via Webhook - sem precisar de bot.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="discord-webhook">Webhook URL <span className="text-red-500">*</span></Label>
                  <Input
                    id="discord-webhook"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={discordData.webhookUrl}
                    onChange={(e) => setDiscordData(prev => ({ ...prev, webhookUrl: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    <strong>Como obter:</strong> Canal Discord → ⚙️ Configurações → Integrações → Webhooks → Criar Webhook → Copiar URL
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Eventos para notificar</Label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {discordEvents.map((ev) => (
                      <label key={ev.value} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted/50 transition-colors">
                        <input
                          type="checkbox"
                          className="accent-[#5865F2]"
                          checked={discordData.events.includes(ev.value)}
                          onChange={() => toggleDiscordEvent(ev.value)}
                        />
                        <span className="text-sm">{ev.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Deixe vazio para receber todos os eventos.</p>
                </div>
                {discordData.configured && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleDiscordTest} disabled={discordData.testing} className="flex-1">
                      {discordData.testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TestTube2 className="w-4 h-4 mr-2" />}
                      Testar
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDiscordDisable} disabled={discordData.loading} className="flex-1 text-red-500 hover:text-red-600">
                      Desativar
                    </Button>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenIntegrationModal(null)}>Cancelar</Button>
                <Button
                  className="bg-[#5865F2] hover:bg-[#4752C4] text-white"
                  onClick={handleDiscordSave}
                  disabled={discordData.loading}
                >
                  {discordData.loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  {discordData.configured ? "Atualizar" : "Conectar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Modal Xtracky */}
          <Dialog open={openIntegrationModal === 'xtracky'} onOpenChange={(open) => !open && setOpenIntegrationModal(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-white" />
                  </div>
                  Configurar Xtracky
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Rastreie 100% das suas conversões no TikTok, Kwai, Facebook e Google. Configure seu Product ID para enviar eventos automaticamente a cada venda aprovada.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="xtracky-pid">Product ID <span className="text-red-500">*</span></Label>
                  <Input
                    id="xtracky-pid"
                    placeholder="Ex: 550e8400-e29b-41d4-a716-446655440000"
                    value={xtrackyData.productId}
                    onChange={(e) => setXtrackyData(prev => ({ ...prev, productId: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    <strong>Como obter:</strong> Acesse <a href="https://xtracky.com" target="_blank" rel="noreferrer" className="text-[#2563eb] underline">xtracky.com</a> → Produtos → Copie o UUID do produto
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">O que é rastreado automaticamente:</p>
                  <p>✅ PIX pago → evento <code>paid</code> enviado ao Xtracky</p>
                  <p>✅ Boleto pago → evento <code>paid</code> enviado ao Xtracky</p>
                  <p>✅ Dados do lead (nome, e-mail, telefone) incluídos quando disponíveis</p>
                </div>
                {xtrackyData.configured && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleXtrackyTest}
                      disabled={xtrackyData.testing}
                      className="flex-1"
                    >
                      {xtrackyData.testing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <TestTube2 className="w-4 h-4 mr-2" />
                      )}
                      Testar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleXtrackyDisable}
                      disabled={xtrackyData.loading}
                      className="flex-1 text-red-500 hover:text-red-600"
                    >
                      Desativar
                    </Button>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenIntegrationModal(null)}>Cancelar</Button>
                <Button
                  className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white"
                  onClick={handleXtrackySave}
                  disabled={xtrackyData.loading}
                >
                  {xtrackyData.loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" />
                  )}
                  {xtrackyData.configured ? "Atualizar" : "Conectar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>



          {/* Cards compactos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* UTMify */}
            <Card
              className="cursor-pointer hover:shadow-md hover:border-[#2563eb]/40 transition-all duration-200"
              onClick={() => setOpenIntegrationModal('utmify')}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#2563eb] to-[#a855f7] flex items-center justify-center flex-shrink-0">
                      <BarChart3 className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-foreground">UTMify</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        Rastreamento avançado de UTMs e conversões
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge
                      variant={utmifyData.enabled ? "default" : "secondary"}
                      className={utmifyData.enabled ? "bg-[#2563eb] text-xs" : "text-xs"}
                    >
                      {utmifyData.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notazz */}
            <Card
              className="cursor-pointer hover:shadow-md hover:border-[#2563eb]/40 transition-all duration-200"
              onClick={() => setOpenIntegrationModal('notazz')}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-foreground">Notazz</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        Emissão automática de NFS-e e NF-e para suas vendas
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge
                      variant={notazzData.enabled ? "default" : "secondary"}
                      className={notazzData.enabled ? "bg-emerald-500 text-xs" : "text-xs"}
                    >
                      {notazzData.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Telegram */}
            <Card
              className="cursor-pointer hover:shadow-md hover:border-sky-400/40 transition-all duration-200"
              onClick={() => setOpenIntegrationModal('telegram')}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center flex-shrink-0">
                      <Send className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-foreground">Telegram</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        Notificações de vendas em tempo real no Telegram
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge
                      variant={telegramData.enabled ? "default" : "secondary"}
                      className={telegramData.enabled ? "bg-sky-500 text-xs" : "text-xs"}
                    >
                      {telegramData.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Discord */}
            <Card
              className="cursor-pointer hover:shadow-md hover:border-[#5865F2]/40 transition-all duration-200"
              onClick={() => setOpenIntegrationModal('discord')}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#5865F2] flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-foreground">Discord</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        Notificações de vendas em tempo real no Discord
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge
                      variant={discordData.enabled ? "default" : "secondary"}
                      className={discordData.enabled ? "bg-[#5865F2] text-xs" : "text-xs"}
                    >
                      {discordData.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Xtracky */}
            <Card
              className="cursor-pointer hover:shadow-md hover:border-orange-400/40 transition-all duration-200"
              onClick={() => setOpenIntegrationModal('xtracky')}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0">
                      <BarChart3 className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm text-foreground">Xtracky</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        Rastreamento de conversões para TikTok, Kwai, Meta e Google
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge
                      variant={xtrackyData.enabled ? "default" : "secondary"}
                      className={xtrackyData.enabled ? "bg-orange-500 text-xs" : "text-xs"}
                    >
                      {xtrackyData.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </TabsContent>
      </Tabs>
      </div>
    </>
  );
  return inline ? inner : <DashboardLayout>{inner}</DashboardLayout>;
}