import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Shield, Activity, Ban, Unlock, RefreshCw, Filter, Search, AlertCircle, CheckCircle, Eraser, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCustomDialog } from '@/hooks/use-custom-dialog';

interface SecurityLog {
  id: string;
  threatCategory: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  riskScore: number;
  sourceIp?: string; // Manter compatibilidade com formato antigo
  ipAddress?: string; // Novo formato do agregador
  userAgent?: string;
  method?: string;
  endpoint: string;
  actionTaken: string;
  blocked?: boolean;
  ipBlocked?: boolean;
  responseCode?: number;
  processingTime?: number;
  detectionRule?: string;
  count?: number; // CONTADOR DE OCORRNCIAS AGREGADAS
  firstDetectedAt?: string; // Data da primeira ocorrência
  lastDetectedAt?: string; // Data da Última ocorrência
  evidence?: string; // Evidncia do ataque
  details?: {
    deviceInfo?: {
      platform?: string;
      language?: string;
      timezone?: string;
      screen?: {
        width: number;
        height: number;
      };
      headers?: Record<string, string>;
      network?: {
        remoteAddress?: string;
        remotePort?: number;
      };
    };
    detection_count?: number;
    reason?: string;
  };
  aiAnalysis?: {
    confidence: number;
    reasoning: string;
    patterns: string[];
    recommendations: string[];
  };
  detectedAt: string;
  blockedAt?: string;
  createdAt?: string;
}

interface BlockedIP {
  id: string;
  ipAddress: string;
  reason: string;
  threatCategories: string[];
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  riskScore: number;
  blockedBy: 'system' | 'admin' | 'ai';
  adminName?: string;
  attacksBlocked: number;
  lastAttemptAt?: string;
  totalAttempts: number;
  isActive: boolean;
  // 🌍 GEOLOCALIZAÇÃO
  country?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  isp?: string;
  isDatacenter?: boolean;
  isProxy?: boolean;
  isVPN?: boolean;
  isTor?: boolean;
  threatLevel?: string;
  geoRiskScore?: number;
  createdAt: string;
  unlockedAt?: string;
  unblockReason?: string;
}

interface SecurityStats {
  period: string;
  totalThreats: number;
  threatsBlocked: number;
  totalBlockedIPs: number;
  uniqueAttackerIPs: number;
  threatsByCategory: Record<string, number>;
  threatsBySeverity: Record<string, number>;
  actionsTaken: Record<string, number>;
  avgProcessingTime: number;
  aiAnalysisUsed: number;
  avgAiConfidence: number;
  topAttackerIPs: Array<{ ip: string; attempts: number }>;
  generatedAt: string;
}

interface BlockedEntity {
  id: string;
  uid?: string;
  ip?: string;
  deviceFingerprint?: string;
  reason: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  blockedBy: string;
  blockedAt: string;
  isActive: boolean;
  accountData?: {
    email?: string;
    displayName?: string;
    phoneNumber?: string;
  };
  deviceData?: {
    userAgent?: string;
    platform?: string;
    language?: string;
  };
  notes?: string;
  unblockReason?: string;
  unlockedAt?: string;
  unlockedBy?: string;
  expiresAt?: string;
}

interface ApprovedSeller {
  id: string;
  uid: string;
  email: string;
  name?: string;
  registrationIP?: string;
  lastLoginIP?: string;
  status: 'approved' | 'pending' | 'rejected';
  approvedAt?: string;
  createdAt: string;
  deviceFingerprint?: string;
  country?: string;
  city?: string;
}

export default function SecurityDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showConfirm, showPrompt } = useCustomDialog();
  
  // Estados locais
  const [selectedPeriod, setSelectedPeriod] = useState('24h');
  const [logsFilter, setLogsFilter] = useState({ category: 'all', severity: 'all', search: '' });
  const [ipFilter, setIpFilter] = useState({ active: 'true', search: '' });
  const [entityFilter, setEntityFilter] = useState({ active: 'true', search: '', severity: 'all', type: 'all' });
  const [sellerFilter, setSellerFilter] = useState({ search: '' });

  // Query para sade do sistema (Firebase + Cache)
  const { data: systemHealth } = useQuery<any>({
    queryKey: ['/api/security/system-health'],
    queryFn: async () => {
      const response = await apiRequest('/api/security/system-health', 'GET');
      return response.json();
    },
    refetchInterval: 120000, // ⚡ OTIMIZADO: 2 minutos
    refetchOnWindowFocus: false,
    staleTime: 60000,
  });

  // Query para estatísticas
  const { data: stats, refetch: refetchStats } = useQuery<SecurityStats>({
    queryKey: ['/api/security/stats', selectedPeriod],
    queryFn: async () => {
      const response = await apiRequest(`/api/security/stats?period=${selectedPeriod}`, 'GET');
      return response.json();
    },
    refetchInterval: 300000, // ⚡ OTIMIZADO: 5 minutos
    refetchOnWindowFocus: false,
    staleTime: 120000,
  });

  //  Query para logs de segurança
  const { data: logs, refetch: refetchLogs } = useQuery<SecurityLog[]>({
    queryKey: ['/api/security/logs', logsFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (logsFilter.category !== 'all') params.append('category', logsFilter.category);
      if (logsFilter.severity !== 'all') params.append('severity', logsFilter.severity);
      const response = await apiRequest(`/api/security/logs?${params.toString()}`, 'GET');
      return response.json();
    },
    refetchInterval: 300000, // ⚡ OTIMIZADO: 5 minutos
    refetchOnWindowFocus: false,
    staleTime: 120000,
  });

  // Query para IPs bloqueados
  const { data: blockedIPs, refetch: refetchBlockedIPs } = useQuery<BlockedIP[]>({
    queryKey: ['/api/security/blocked-ips', ipFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ipFilter.active !== 'all') params.append('active', ipFilter.active);
      const response = await apiRequest(`/api/security/blocked-ips?${params.toString()}`, 'GET');
      return response.json();
    },
    refetchInterval: 300000, // ⚡ OTIMIZADO: 5 minutos
    refetchOnWindowFocus: false,
    staleTime: 120000,
  });

  // Query para entidades bloqueadas
  const { data: blockedEntitiesResponse, refetch: refetchBlockedEntities } = useQuery<{ blocks: BlockedEntity[]; count: number }>({
    queryKey: ['/api/admin/security/blocked-entities', entityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (entityFilter.active !== 'all') params.append('active', entityFilter.active);
      if (entityFilter.severity !== 'all') params.append('severity', entityFilter.severity);
      if (entityFilter.type !== 'all') params.append('type', entityFilter.type);
      const response = await apiRequest(`/api/admin/security/blocked-entities?${params.toString()}`, 'GET');
      const data = await response.json();
      
      // Normalizar campos do backend para o frontend
      if (data.blocks) {
        data.blocks = data.blocks.map((block: any) => ({
          ...block,
          blockedAt: block.timestamp || block.blockedAt,
          isActive: block.active !== undefined ? block.active : block.isActive
        }));
      }
      
      return data;
    },
    refetchInterval: 300000, // ⚡ OTIMIZADO: 5 minutos
    refetchOnWindowFocus: false,
    staleTime: 120000,
  });

  const blockedEntities = blockedEntitiesResponse?.blocks || [];

  // Query para sellers aprovados
  const { data: approvedSellers, refetch: refetchApprovedSellers } = useQuery<ApprovedSeller[]>({
    queryKey: ['/api/admin/sellers/approved', sellerFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sellerFilter.search) params.append('search', sellerFilter.search);
      const response = await apiRequest(`/api/admin/sellers/approved?${params.toString()}`, 'GET');
      return response.json();
    },
    refetchInterval: 300000, // ⚡ OTIMIZADO: 5 minutos
    refetchOnWindowFocus: false,
    staleTime: 120000,
  });

  // Mutation para desbloquear IP
  const unblockIPMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const response = await apiRequest(`/api/security/blocked-ips/${id}`, 'DELETE', { reason });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "IP Desbloqueado",
        description: `IP ${data.ipAddress} foi desbloqueado com sucesso.`,
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/security/blocked-ips'] });
      refetchStats();
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao Desbloquear IP",
        description: error.message || "Ocorreu um erro ao tentar desbloquear o IP.",
        variant: "destructive",
      });
    },
  });

  // Mutation para recarregar cache
  const reloadCacheMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('/api/security/reload-cache', 'POST');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Cache Recarregado",
        description: "Cache de segurança foi recarregado com sucesso.",
        variant: "default",
      });
      refetchStats();
      refetchLogs();
      refetchBlockedIPs();
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao Recarregar Cache",
        description: error.message || "Ocorreu um erro ao recarregar o cache.",
        variant: "destructive",
      });
    },
  });

  // Mutation para bloquear IP
  const blockIPMutation = useMutation({
    mutationFn: async ({ ipAddress, reason, severity }: { ipAddress: string; reason: string; severity: string }) => {
      const response = await apiRequest('/api/security/block-ip', 'POST', { ipAddress, reason, severity });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "IP Bloqueado",
        description: `IP ${data.ipAddress} foi bloqueado permanentemente.`,
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/security/blocked-ips'] });
      refetchStats();
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao Bloquear IP",
        description: error.message || "Ocorreu um erro ao tentar bloquear o IP.",
        variant: "destructive",
      });
    },
  });

  // Mutation para desbloquear entidade
  const unblockEntityMutation = useMutation({
    mutationFn: async ({ blockId, unlockReason }: { blockId: string; unlockReason: string }) => {
      const response = await apiRequest('/api/admin/security/unblock-entity', 'POST', { blockId, unlockReason });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Entidade Desbloqueada",
        description: "A entidade foi desbloqueada com sucesso e pode acessar o sistema novamente.",
        variant: "default",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/security/blocked-entities'] });
      refetchBlockedEntities();
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao Desbloquear Entidade",
        description: error.message || "Ocorreu um erro ao tentar desbloquear a entidade.",
        variant: "destructive",
      });
    },
  });

  // Helper functions
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'info': return 'bg-brand-subtle text-gray-800 border-brand-muted';
      default: return 'bg-brand-subtle text-gray-800 border-brand-muted';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'xss_injection': return '';
      case 'sql_injection': return '';
      case 'html_injection': return '';
      case 'path_traversal': return '';
      case 'code_injection': return '';
      case 'flood_attack': return '';
      case 'bot_detection': return '';
      case 'farm_detection': return '';
      case 'malicious_upload': return '';
      case 'brute_force': return '';
      case 'credential_stuffing': return '';
      case 'inspection_attempt': return '';
      case 'suspicious_behavior': return '';
      case 'rate_limit_exceeded': return '';
      default: return '';
    }
  };

  const getCategoryName = (category: string) => {
    switch (category) {
      case 'xss_injection': return 'XSS Injection';
      case 'sql_injection': return 'SQL Injection';
      case 'html_injection': return 'HTML Injection';
      case 'path_traversal': return 'Path Traversal';
      case 'code_injection': return 'Code Injection';
      case 'flood_attack': return 'Flood Attack';
      case 'bot_detection': return 'Bot Detection';
      case 'farm_detection': return 'Farm Detection';
      case 'malicious_upload': return 'Malicious Upload';
      case 'brute_force': return 'Brute Force';
      case 'credential_stuffing': return 'Credential Stuffing';
      case 'inspection_attempt': return 'Inspection Attempt';
      case 'suspicious_behavior': return 'Suspicious Behavior';
      case 'rate_limit_exceeded': return 'Rate Limit';
      default: return category;
    }
  };

  // EXPLICAÇES DETALHADAS DOS ATAQUES
  const getAttackExplanation = (category: string, endpoint: string) => {
    const explanations: Record<string, { what: string; intent: string; danger: string }> = {
      'xss_injection': {
        what: 'Tentativa de injetar código JavaScript malicioso',
        intent: 'Roubar cookies, sessões de usuários ou executar ações em nome da vítima',
        danger: 'ALTA - Pode comprometer contas de usuários e dados sensíveis'
      },
      'sql_injection': {
        what: 'Tentativa de manipular consultas SQL do banco de dados',
        intent: 'Acessar, modificar ou deletar dados confidenciais do banco',
        danger: 'CRTICA - Pode expor toda a base de dados'
      },
      'path_traversal': {
        what: 'Tentativa de acessar arquivos fora do diretrio permitido',
        intent: 'Ler arquivos do sistema, códigos-fonte ou dados confidenciais',
        danger: 'ALTA - Pode expor informações crticas do servidor'
      },
      'bot_detection': {
        what: 'Comportamento automatizado suspeito detectado',
        intent: 'Scraping de dados, ataques automatizados ou spam',
        danger: 'MDIA - Pode sobrecarregar o sistema e coletar dados'
      },
      'rate_limit_exceeded': {
        what: 'Excesso de requisições em pouco tempo',
        intent: 'Sobrecarga do sistema, DDoS ou tentativa de quebrar protees',
        danger: 'MDIA - Pode derrubar o serviço para usuários legtimos'
      },
      'inspection_attempt': {
        what: 'Tentativa de mapear estrutura e vulnerabilidades',
        intent: 'Reconhecimento para ataques futuros ou coleta de informações',
        danger: 'BAIXA - Preparao para ataques mais sofisticados'
      },
      'brute_force': {
        what: 'Tentativas massivas de login com diferentes senhas',
        intent: 'Quebrar senhas e obter acesso não autorizado',
        danger: 'ALTA - Pode comprometer contas de usuários'
      }
    };
    
    return explanations[category] || {
      what: 'Atividade suspeita detectada',
      intent: 'Comportamento anmalo que pode indicar tentativa de ataque',
      danger: 'MONITORAMENTO - Requer análise adicional'
    };
  };

  // Desconto: ANALISAR ENDPOINT TENTADO
  const analyzeEndpoint = (endpoint: string, method: string) => {
    const sensitive = [
      { pattern: '/admin', risk: 'CRTICO', desc: 'área administrativa' },
      { pattern: '/api/auth', risk: 'ALTO', desc: 'Sistema de autenticação' },
      { pattern: '/login', risk: 'ALTO', desc: 'Página de login' },
      { pattern: '/api/users', risk: 'ALTO', desc: 'Dados de usuários' },
      { pattern: '/api/payments', risk: 'CRTICO', desc: 'Sistema de pagamentos' },
      { pattern: '/api/security', risk: 'CRTICO', desc: 'Configurações de segurança' },
      { pattern: '/.env', risk: 'CRTICO', desc: 'Variveis de ambiente' },
      { pattern: '/config', risk: 'ALTO', desc: 'Arquivos de configuração' },
      { pattern: '/backup', risk: 'ALTO', desc: 'Arquivos de backup' },
    ];
    
    for (const item of sensitive) {
      if (endpoint.toLowerCase().includes(item.pattern)) {
        return { risk: item.risk, desc: item.desc, critical: true };
      }
    }
    
    return { risk: 'BAIXO', desc: 'Endpoint padrão', critical: false };
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR');
  };

  // Filtrar logs por pesquisa
  const filteredLogs = logs?.filter((log: SecurityLog) => {
    if (!logsFilter.search) return true;
    const search = logsFilter.search.toLowerCase();
    return (
      (log.sourceIp || log.ipAddress || '').toLowerCase().includes(search) ||
      log.endpoint.toLowerCase().includes(search) ||
      getCategoryName(log.threatCategory).toLowerCase().includes(search)
    );
  }) || [];

  // Filtrar IPs bloqueados por pesquisa
  const filteredBlockedIPs = blockedIPs?.filter((ip: BlockedIP) => {
    if (!ipFilter.search) return true;
    const search = ipFilter.search.toLowerCase();
    return (
      ip.ipAddress.toLowerCase().includes(search) ||
      ip.reason.toLowerCase().includes(search) ||
      (ip.country && ip.country.toLowerCase().includes(search))
    );
  }) || [];

  // Filtrar entidades bloqueadas por pesquisa
  const filteredBlockedEntities = blockedEntities?.filter((entity: BlockedEntity) => {
    if (!entityFilter.search) return true;
    const search = entityFilter.search.toLowerCase();
    return (
      (entity.uid && entity.uid.toLowerCase().includes(search)) ||
      (entity.ip && entity.ip.toLowerCase().includes(search)) ||
      (entity.deviceFingerprint && entity.deviceFingerprint.toLowerCase().includes(search)) ||
      entity.reason.toLowerCase().includes(search) ||
      (entity.accountData?.email && entity.accountData.email.toLowerCase().includes(search))
    );
  }) || [];

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="security-dashboard">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-red-600" />
            Central de Segurana
          </h1>
          <p className="text-muted-foreground">
            Monitoramento em tempo real de ameaas e protees ativas
          </p>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="inline-flex items-center gap-1.5 bg-black text-[#2563eb] border border-[#2563eb]/30 text-xs font-mono font-bold px-3 py-1 rounded-full">
              Anticheat V3
            </span>
            <span className="text-xs text-muted-foreground font-mono">desenvolvido por <span className="text-[#2563eb] font-bold">@zendev</span></span>
          </div>
        </div>
        <div className="flex gap-2">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Última Hora</SelectItem>
              <SelectItem value="24h">Últimas 24h</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
          
          <Button 
            onClick={() => reloadCacheMutation.mutate()} 
            disabled={reloadCacheMutation.isPending}
            data-testid="button-reload-cache"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${reloadCacheMutation.isPending ? 'animate-spin' : ''}`} />
            Recarregar Cache
          </Button>
        </div>
      </div>

      {/* System Health Monitor */}
      {systemHealth && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              Sade do Sistema
              <Badge variant={systemHealth.system?.firebase?.healthy ? "default" : "destructive"} className="ml-auto">
                {systemHealth.system?.firebase?.status === 'operational' ? 'Operacional' : 'Degradado'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Firebase Health */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium">Firebase</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className={systemHealth.system?.firebase?.healthy ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                      {systemHealth.system?.firebase?.healthy ? 'Saudvel' : 'Com Problemas'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Erros consecutivos:</span>
                    <span className="font-medium">{systemHealth.system?.firebase?.consecutiveErrors || 0}</span>
                  </div>
                  {systemHealth.system?.firebase?.lastError && (
                    <div className="flex justify-between">
                      <span>Último erro:</span>
                      <span className="font-medium text-red-600">
                        {new Date(systemHealth.system.firebase.lastError).toLocaleTimeString('pt-BR')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Cache Stats */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">Cache</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Total de entradas:</span>
                    <span className="font-medium text-emerald-600">{systemHealth.system?.cache?.totalEntries || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Stats (TTL: 30s):</span>
                    <span className="font-medium">{systemHealth.system?.cache?.stats?.size || 0} entradas</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Logs (TTL: 10s):</span>
                    <span className="font-medium">{systemHealth.system?.cache?.logs?.size || 0} entradas</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IPs (TTL: 15s):</span>
                    <span className="font-medium">{systemHealth.system?.cache?.blockedIPs?.size || 0} entradas</span>
                  </div>
                </div>
              </div>

              {/* Analytics */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-medium">Analytics</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Total de breaches:</span>
                    <span className="font-medium text-red-600">{systemHealth.system?.analytics?.totalBreaches || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Atacantes nicos:</span>
                    <span className="font-medium">{systemHealth.system?.analytics?.uniqueAttackers || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IPs suspeitos:</span>
                    <span className="font-medium text-orange-600">{systemHealth.system?.analytics?.suspiciousIPs || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Atualizado:</span>
                    <span className="font-medium">
                      {systemHealth.timestamp ? new Date(systemHealth.timestamp).toLocaleTimeString('pt-BR') : '--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Ameaas</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600" data-testid="stat-total-threats">
                {stats.totalThreats.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.threatsBlocked} bloqueadas ({Math.round((stats.threatsBlocked / Math.max(stats.totalThreats, 1)) * 100)}%)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">IPs Bloqueados</CardTitle>
              <Ban className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600" data-testid="stat-blocked-ips">
                {stats.totalBlockedIPs.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.uniqueAttackerIPs} IPs nicos atacantes
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Anlise AI</CardTitle>
              <Activity className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600" data-testid="stat-ai-analysis">
                {stats.aiAnalysisUsed.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                {Math.round(stats.avgAiConfidence)}% confiana média
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Performance</CardTitle>
              <CheckCircle className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600" data-testid="stat-avg-processing">
                {Math.round(stats.avgProcessingTime)}ms
              </div>
              <p className="text-xs text-muted-foreground">
                Tempo médio de processamento
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs Content */}
      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs">Logs de Segurana</TabsTrigger>
          <TabsTrigger value="blocked-ips">IPs Bloqueados</TabsTrigger>
          <TabsTrigger value="blocked-entities">Bloqueios</TabsTrigger>
          <TabsTrigger value="approved-sellers">Sellers Aprovados</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="shadow-mode">Shadow Mode</TabsTrigger>
        </TabsList>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          {/* Filtros */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros de Logs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  <Input
                    placeholder="Buscar por IP, endpoint..."
                    value={logsFilter.search}
                    onChange={(e) => setLogsFilter({ ...logsFilter, search: e.target.value })}
                    className="w-64"
                    data-testid="input-logs-search"
                  />
                </div>
                
                <Select value={logsFilter.category} onValueChange={(value) => setLogsFilter({ ...logsFilter, category: value })}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as Categorias</SelectItem>
                    <SelectItem value="xss_injection">XSS Injection</SelectItem>
                    <SelectItem value="sql_injection">SQL Injection</SelectItem>
                    <SelectItem value="html_injection">HTML Injection</SelectItem>
                    <SelectItem value="path_traversal">Path Traversal</SelectItem>
                    <SelectItem value="code_injection">Code Injection</SelectItem>
                    <SelectItem value="flood_attack">Flood Attack</SelectItem>
                    <SelectItem value="bot_detection">Bot Detection</SelectItem>
                    <SelectItem value="inspection_attempt">Tentativas de Inspeção</SelectItem>
                    <SelectItem value="suspicious_behavior">Suspicious Behavior</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={logsFilter.severity} onValueChange={(value) => setLogsFilter({ ...logsFilter, severity: value })}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Severidade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="critical">Crtica</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Lista de Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Logs de Ameaas Detectadas ({filteredLogs?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredLogs?.map((log: SecurityLog) => {
                  const explanation = getAttackExplanation(log.threatCategory, log.endpoint);
                  const endpointAnalysis = analyzeEndpoint(log.endpoint, log.method || 'GET');
                  
                  return (
                  <Card key={log.id} className={`transition-all duration-200 hover:shadow-lg border-l-4 ${
                    log.severity === 'critical' ? 'border-l-red-500 bg-red-50/50' :
                    log.severity === 'high' ? 'border-l-orange-500 bg-orange-50/50' :
                    log.severity === 'medium' ? 'border-l-yellow-500 bg-yellow-50/50' :
                    log.severity === 'low' ? 'border-l-blue-500 bg-blue-50/50' :
                    'border-l-gray-400 bg-brand-subtle/50'
                  }`} data-testid={`log-${log.id}`}>
                    <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getCategoryIcon(log.threatCategory)}</span>
                        <span className="font-medium">{getCategoryName(log.threatCategory)}</span>
                        <Badge className={getSeverityColor(log.severity)}>
                          {log.severity.toUpperCase()}
                        </Badge>
                        {/* CONTADOR DE OCORRNCIAS AGREGADAS */}
                        {log.count && log.count > 1 && (
                          <Badge className="bg-emerald-600 text-white border-emerald-700 font-bold px-3 py-1">
                            {log.count}x
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground">
                          Score: {log.riskScore}/100
                        </span>
                        {endpointAnalysis.critical && (
                          <Badge className="bg-red-200 text-red-800 border-red-300">
                            Desconto: ALVO CRTICO
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {log.count && log.count > 1 ? (
                          <div className="text-right">
                            <div className="text-xs">Primeira: {formatDate(log.firstDetectedAt || log.detectedAt)}</div>
                            <div className="text-xs font-medium">Última: {formatDate(log.lastDetectedAt || log.detectedAt)}</div>
                          </div>
                        ) : (
                          formatDate(log.detectedAt)
                        )}
                      </div>
                    </div>

                    {/* EXPLICAÇÃO DETALHADA DO ATAQUE */}
                    <div className="bg-gradient-to-r from-red-50 to-orange-50 border-l-4 border-red-500 p-3 rounded-r">
                      <div className="space-y-2">
                        <div className="text-sm">
                          <span className="font-bold text-red-700">O que tentaram:</span>
                          <p className="text-red-600 mt-1">{explanation.what}</p>
                        </div>
                        <div className="text-sm">
                          <span className="font-bold text-orange-700">Objetivo:</span>
                          <p className="text-orange-600 mt-1">{explanation.intent}</p>
                        </div>
                        <div className="text-sm">
                          <span className="font-bold text-red-800">Nvel de Perigo:</span>
                          <p className="text-red-700 mt-1 font-medium">{explanation.danger}</p>
                        </div>
                        <div className="text-sm">
                          <span className="font-bold text-emerald-700">Alvo Especfico:</span>
                          <p className="text-emerald-600 mt-1">
                            <code className="bg-emerald-100 px-2 py-1 rounded text-xs">{log.method} {log.endpoint}</code>
                            <span className="ml-2 text-xs">({endpointAnalysis.desc} - Risco: {endpointAnalysis.risk})</span>
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="font-medium">IP:</span> <code>{log.ipAddress || log.sourceIp}</code>
                      </div>
                      <div>
                        <span className="font-medium">Endpoint:</span> <code>{log.method || 'GET'} {log.endpoint}</code>
                      </div>
                      <div>
                        <span className="font-medium">Ao:</span> {log.actionTaken.replace('_', ' ')}
                      </div>
                      <div>
                        <span className="font-medium">Status:</span> {log.responseCode || 'N/A'}
                      </div>
                    </div>

                    {log.blocked && (
                      <div className="flex items-center gap-2 text-red-600">
                        <Ban className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          {log.ipBlocked ? 'IP Bloqueado' : 'Requisio Bloqueada'}
                        </span>
                      </div>
                    )}

                    {log.aiAnalysis && (
                      <div className="bg-blue-50 p-3 rounded border-l-4 border-blue-400">
                        <div className="text-sm">
                          <span className="font-medium">Anlise AI:</span> {log.aiAnalysis.confidence}% confiana
                        </div>
                        <div className="text-sm text-blue-700 mt-1">
                          {log.aiAnalysis.reasoning}
                        </div>
                      </div>
                    )}

                    {/* SISTEMA DE BLOQUEIO INTELIGENTE */}
                    <div className="bg-gradient-to-r from-gray-50 to-gray-100 border border-brand-muted rounded-lg p-4 mt-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-medium text-foreground">
                            Status da Ao:
                            <span className={`ml-2 px-3 py-1 rounded-full text-xs font-bold ${
                              log.actionTaken === 'block_immediate' ? 'bg-red-200 text-red-800' :
                              log.actionTaken === 'blocked' ? 'bg-red-200 text-red-800' :
                              log.actionTaken === 'logged' ? 'bg-yellow-200 text-yellow-800' :
                              'bg-blue-200 text-blue-800'
                            }`}>
                              {log.actionTaken === 'block_immediate' ? 'BLOQUEADO AUTOMATICAMENTE' :
                               log.actionTaken === 'blocked' ? 'BLOQUEADO' :
                               log.actionTaken === 'logged' ? 'REGISTRADO' :
                               'MONITORADO'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          {/* ATAQUES CRTICOS - BLOQUEIO AUTOMTICO */}
                          {(log.severity === 'critical' && 
                            ['xss_injection', 'sql_injection', 'code_injection', 'path_traversal', 'html_injection'].includes(log.threatCategory)) ? (
                            <div className="flex items-center gap-2">
                              <Badge className="bg-red-600 text-white border-red-700 px-3 py-1 animate-pulse">
                                BLOQUEIO AUTOMTICO
                              </Badge>
                              <span className="text-xs text-red-600 font-medium">IP bloqueado instantaneamente</span>
                            </div>
                          ) : (
                            /* BOTÃO MANUAL para ameaas menores */
                            !log.ipBlocked && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="border-orange-500 text-orange-600 hover:bg-orange-50 font-medium"
                                onClick={async () => {
                                  const ipToBlock = log.ipAddress || log.sourceIp || 'unknown';
                                  const confirmed = await showConfirm(`Confirmar bloqueio manual do IP ${ipToBlock}?\n\nMotivo: ${getCategoryName(log.threatCategory)}\nEsta ação impedirtodos os acessos deste endereço.`, 'Confirmar bloqueio', 'warning');
                                  if (confirmed) {
                                    blockIPMutation.mutate({
                                      ipAddress: ipToBlock,
                                      reason: `Bloqueio manual: ${getCategoryName(log.threatCategory)}`,
                                      severity: log.severity
                                    });
                                  }
                                }}
                                disabled={blockIPMutation.isPending}
                                data-testid={`button-block-ip-${log.sourceIp}`}
                              >
                                <Ban className="h-4 w-4 mr-1" />
                                Bloquear Manualmente
                              </Button>
                            )
                          )}
                          
                          {log.ipBlocked && (
                            <Badge className="bg-red-200 text-red-800 border-red-300 px-3 py-1">
                              <Ban className="h-3 w-3 mr-1" />
                              IP BLOQUEADO
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ANLISE TCNICA AVANÇADA */}
                    <div className="bg-brand-subtle p-3 rounded border-l-4 border-brand-muted">
                      <div className="text-sm font-medium text-gray-800 mb-2">
                        Anlise Técnica Detalhada
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        {/* User Agent Analysis */}
                        <div>
                          <div className="font-medium text-blue-700 mb-1">Navegador/Cliente:</div>
                          <div className="bg-blue-50 p-2 rounded border">
                            <div className="text-blue-600 font-mono text-xs break-all">
                              {log.userAgent || 'No informado'}
                            </div>
                            {log.userAgent && (
                              <div className="mt-1 text-blue-500 text-xs">
                                {log.userAgent.includes('bot') || log.userAgent.includes('Bot') ? 
                                  'Detectado como BOT' : 
                                  log.userAgent.includes('curl') || log.userAgent.includes('wget') ? 
                                  'Ferramenta de linha de comando' :
                                  'Navegador humano aparente'
                                }
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Network Analysis */}
                        <div>
                          <div className="font-medium text-emerald-700 mb-1">Rede/Localização:</div>
                          <div className="bg-emerald-50 p-2 rounded border space-y-1">
                            <div><strong>IP:</strong> <code className="bg-emerald-100 px-1 rounded">{log.ipAddress || log.sourceIp}</code></div>
                            <div><strong>Resposta:</strong> <span className={`font-bold ${
                              (log.responseCode || 0) >= 400 ? 'text-red-600' : 'text-emerald-600'
                            }`}>{log.responseCode || 'N/A'}</span></div>
                            <div><strong>Tempo:</strong> {log.processingTime || 0}ms</div>
                            {log.details?.detection_count && (
                              <div><strong>Deteces:</strong> <span className="text-red-600 font-bold">{log.details.detection_count}x</span></div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* DETALHES COMPLETOS DO DISPOSITIVO - MELHORADOS */}
                    {log.details?.deviceInfo && (
                      <div className="bg-red-50 p-3 rounded border-l-4 border-red-400 mt-2">
                        <div className="text-sm font-medium text-red-800 mb-2">
                          Informações Completas do Dispositivo
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                          {/* Hardware */}
                          <div>
                            <div className="font-medium text-red-700 mb-1">Hardware:</div>
                            <div className="space-y-1 text-red-600">
                              <div><strong>Plataforma:</strong> {log.details.deviceInfo.platform || 'Unknown'}</div>
                              {(log.details.deviceInfo as any)?.hardwareConcurrency && (
                                <div><strong>CPU Cores:</strong> {(log.details.deviceInfo as any).hardwareConcurrency}</div>
                              )}
                              {(log.details.deviceInfo as any)?.deviceMemory && (log.details.deviceInfo as any).deviceMemory !== 'unknown' && (
                                <div><strong>RAM:</strong> {(log.details.deviceInfo as any).deviceMemory}GB</div>
                              )}
                              {log.details.deviceInfo.screen && (
                                <>
                                  <div><strong>Resoluo:</strong> {log.details.deviceInfo.screen.width}x{log.details.deviceInfo.screen.height}</div>
                                  {(log.details.deviceInfo.screen as any)?.colorDepth && (
                                    <div><strong>Cor:</strong> {(log.details.deviceInfo.screen as any).colorDepth}-bit</div>
                                  )}
                                </>
                              )}
                              {log.details.detection_count && (
                                <div><strong>Tentativas:</strong> {log.details.detection_count}</div>
                              )}
                            </div>
                          </div>

                          {/* Sistema */}
                          <div>
                            <div className="font-medium text-red-700 mb-1">Sistema:</div>
                            <div className="space-y-1 text-red-600">
                              <div><strong>Idioma:</strong> {log.details.deviceInfo.language || 'Unknown'}</div>
                              <div><strong>Timezone:</strong> {log.details.deviceInfo.timezone || 'Unknown'}</div>
                              {(log.details.deviceInfo as any)?.cookieEnabled !== undefined && (
                                <div><strong>Cookies:</strong> {(log.details.deviceInfo as any).cookieEnabled ? 'Habilitados' : 'Desabilitados'}</div>
                              )}
                              {(log.details.deviceInfo as any)?.onLine !== undefined && (
                                <div><strong>Status:</strong> {(log.details.deviceInfo as any).onLine ? 'Online' : 'Offline'}</div>
                              )}
                              {(log.details.deviceInfo as any)?.plugins && (log.details.deviceInfo as any).plugins.length > 0 && (
                                <div><strong>Plugins:</strong> {(log.details.deviceInfo as any).plugins.length} detectados</div>
                              )}
                            </div>
                          </div>

                          {/* Rede */}
                          <div>
                            <div className="font-medium text-red-700 mb-1">Rede:</div>
                            <div className="space-y-1 text-red-600">
                              <div><strong>IP Origem:</strong> <code>{log.ipAddress || log.sourceIp}</code></div>
                              {log.details.deviceInfo.network?.remoteAddress && (
                                <div><strong>Endereço Remoto:</strong> <code>{log.details.deviceInfo.network.remoteAddress}</code></div>
                              )}
                              {log.details.deviceInfo.network?.remotePort && (
                                <div><strong>Porta Remota:</strong> {log.details.deviceInfo.network.remotePort}</div>
                              )}
                              <div><strong>User-Agent:</strong></div>
                              <code className="text-xs break-all block bg-red-100 p-1 rounded">
                                {log.userAgent || 'Unknown'}
                              </code>
                            </div>
                          </div>

                          {/* Headers Importantes */}
                          {log.details.deviceInfo.headers && (
                            <div className="md:col-span-2">
                              <div className="font-medium text-red-700 mb-1">Headers Suspeitos:</div>
                              <div className="text-red-600 space-y-1 max-h-20 overflow-y-auto">
                                {Object.entries(log.details.deviceInfo.headers)
                                  .filter(([key, value]) => key && value && !['host', 'connection', 'accept'].includes(key.toLowerCase()))
                                  .map(([key, value]) => (
                                    <div key={key} className="text-xs">
                                      <strong>{key}:</strong> <code className="break-all">{String(value).substring(0, 100)}</code>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}

                          {/* Razo da Deteco */}
                          {log.details.reason && (
                            <div className="md:col-span-2">
                              <div className="font-medium text-red-700 mb-1">Método de Deteco:</div>
                              <div className="text-red-600 text-sm bg-red-100 p-2 rounded">
                                {log.details.reason}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                  );
                })}

                {filteredLogs?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum log de segurança encontrado no período selecionado.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Blocked IPs Tab */}
        <TabsContent value="blocked-ips" className="space-y-4">
          {/* Filtros IPs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros de IPs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  <Input
                    placeholder="Buscar por IP, motivo..."
                    value={ipFilter.search}
                    onChange={(e) => setIpFilter({ ...ipFilter, search: e.target.value })}
                    className="w-64"
                    data-testid="input-ips-search"
                  />
                </div>
                
                <Select value={ipFilter.active} onValueChange={(value) => setIpFilter({ ...ipFilter, active: value })}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Apenas Ativos</SelectItem>
                    <SelectItem value="false">Apenas Inativos</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Lista de IPs Bloqueados */}
          <Card>
            <CardHeader>
              <CardTitle>IPs Bloqueados ({filteredBlockedIPs?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredBlockedIPs?.map((ip: BlockedIP) => (
                  <div key={ip.id} className="border rounded-lg p-4 space-y-2" data-testid={`blocked-ip-${ip.id}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-lg">{ip.ipAddress}</code>
                        <Badge className={getSeverityColor(ip.severity)}>
                          {ip.severity.toUpperCase()}
                        </Badge>
                        <Badge variant={ip.isActive ? "destructive" : "secondary"}>
                          {ip.isActive ? "ATIVO" : "INATIVO"}
                        </Badge>
                        {ip.country && (
                          <Badge variant="outline" className="text-xs">
                            {ip.countryCode || ''} {ip.country}{ip.city ? `, ${ip.city}` : ''}
                          </Badge>
                        )}
                        {ip.isDatacenter && (
                          <Badge variant="destructive" className="text-xs">
                            VPS/Datacenter
                          </Badge>
                        )}
                        {ip.isVPN && (
                          <Badge variant="destructive" className="text-xs">
                            VPN
                          </Badge>
                        )}
                        {ip.isProxy && !ip.isVPN && (
                          <Badge className="bg-orange-500 text-white text-xs">
                            Proxy
                          </Badge>
                        )}
                        {ip.isTor && (
                          <Badge className="bg-emerald-600 text-white text-xs">
                            TOR
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {formatDate(ip.createdAt)}
                        </span>
                        {ip.isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => unblockIPMutation.mutate({ id: ip.id })}
                            disabled={unblockIPMutation.isPending}
                            data-testid={`button-unblock-${ip.id}`}
                          >
                            <Unlock className="h-4 w-4 mr-1" />
                            Desbloquear
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">Motivo:</span> {ip.reason}
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <span className="font-medium">Ataques:</span> {ip.attacksBlocked}
                      </div>
                      <div>
                        <span className="font-medium">Tentativas:</span> {ip.totalAttempts}
                      </div>
                      <div>
                        <span className="font-medium">Score:</span> {ip.riskScore}/100
                      </div>
                      <div>
                        <span className="font-medium">Bloqueado por:</span> {ip.blockedBy}
                      </div>
                      {ip.isp && (
                        <div>
                          <span className="font-medium">ISP:</span> {ip.isp}
                        </div>
                      )}
                    </div>

                    {ip.lastAttemptAt && (
                      <div className="text-sm text-muted-foreground">
                        <span className="font-medium">Última tentativa:</span> {formatDate(ip.lastAttemptAt)}
                      </div>
                    )}

                    {!ip.isActive && ip.unblockReason && (
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded border-l-4 border-lime-400 text-sm">
                        <span className="font-medium">Desbloqueado:</span> {ip.unblockReason}
                        {ip.unlockedAt && <span className="text-muted-foreground"> em {formatDate(ip.unlockedAt)}</span>}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1">
                      {ip.threatCategories.map((category) => (
                        <Badge key={category} variant="outline" className="text-xs">
                          {getCategoryIcon(category)} {getCategoryName(category)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}

                {filteredBlockedIPs?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Ban className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum IP bloqueado encontrado.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Blocked Entities Tab */}
        <TabsContent value="blocked-entities" className="space-y-4">
          {/* Filtros */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros de Bloqueios
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  <Input
                    placeholder="Buscar por UID, IP, email..."
                    value={entityFilter.search}
                    onChange={(e) => setEntityFilter({ ...entityFilter, search: e.target.value })}
                    className="w-64"
                    data-testid="input-entities-search"
                  />
                </div>

                <Select value={entityFilter.active} onValueChange={(value) => setEntityFilter({ ...entityFilter, active: value })}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="true">Ativos</SelectItem>
                    <SelectItem value="false">Inativos</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={entityFilter.type} onValueChange={(value) => setEntityFilter({ ...entityFilter, type: value })}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os Tipos</SelectItem>
                    <SelectItem value="uid">UID</SelectItem>
                    <SelectItem value="ip">IP</SelectItem>
                    <SelectItem value="deviceFingerprint">Device Fingerprint</SelectItem>
                    <SelectItem value="multi">Mltiplo</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={entityFilter.severity} onValueChange={(value) => setEntityFilter({ ...entityFilter, severity: value })}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Severidade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="critical">Crtica</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="low">Baixa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Lista de Entidades Bloqueadas */}
          <Card>
            <CardHeader>
              <CardTitle>Entidades Bloqueadas ({filteredBlockedEntities?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {filteredBlockedEntities?.map((entity: BlockedEntity) => (
                  <Card key={entity.id} className={`transition-all duration-200 hover:shadow-lg border-l-4 ${
                    entity.severity === 'critical' ? 'border-l-red-500 bg-red-50/50' :
                    entity.severity === 'high' ? 'border-l-orange-500 bg-orange-50/50' :
                    entity.severity === 'medium' ? 'border-l-yellow-500 bg-yellow-50/50' :
                    'border-l-blue-500 bg-blue-50/50'
                  } ${!entity.isActive ? 'opacity-60' : ''}`} data-testid={`blocked-entity-${entity.id}`}>
                    <CardContent className="p-4 space-y-3">
                      {/* Header com Severidade e Status */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Ban className="h-5 w-5 text-red-600" />
                          <span className="font-semibold">Bloqueio de Entidade</span>
                          <Badge className={getSeverityColor(entity.severity)}>
                            {entity.severity.toUpperCase()}
                          </Badge>
                          {entity.isActive ? (
                            <Badge variant="destructive">ATIVO</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-100 text-[#f0f4ff]">
                              INATIVO
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatDate(entity.blockedAt)}
                        </div>
                      </div>

                      {/* Motivo do Bloqueio */}
                      <div className="bg-red-50 p-3 rounded border-l-4 border-red-400">
                        <div className="font-medium text-red-900 mb-1">Motivo do Bloqueio:</div>
                        <div className="text-red-800">{entity.reason}</div>
                      </div>

                      {/* Identificadores */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        {entity.uid && (
                          <div className="bg-brand-subtle p-2 rounded">
                            <div className="font-medium text-foreground mb-1">UID:</div>
                            <code className="text-xs">{entity.uid}</code>
                          </div>
                        )}
                        {entity.ip && (
                          <div className="bg-brand-subtle p-2 rounded">
                            <div className="font-medium text-foreground mb-1">IP Address:</div>
                            <code className="text-xs">{entity.ip}</code>
                          </div>
                        )}
                        {entity.deviceFingerprint && (
                          <div className="bg-brand-subtle p-2 rounded">
                            <div className="font-medium text-foreground mb-1">Device Fingerprint:</div>
                            <code className="text-xs truncate">{entity.deviceFingerprint}</code>
                          </div>
                        )}
                      </div>

                      {/* Account Data */}
                      {entity.accountData && (
                        <div className="bg-blue-50 p-2 rounded text-sm">
                          <div className="font-medium text-blue-900 mb-1">Dados da Conta:</div>
                          <div className="space-y-1 text-blue-800">
                            {entity.accountData.email && <div>Email: {entity.accountData.email}</div>}
                            {entity.accountData.displayName && <div>Nome: {entity.accountData.displayName}</div>}
                            {entity.accountData.phoneNumber && <div>{entity.accountData.phoneNumber}</div>}
                          </div>
                        </div>
                      )}

                      {/* Device Data */}
                      {entity.deviceData && (
                        <div className="bg-emerald-50 p-2 rounded text-sm">
                          <div className="font-medium text-emerald-900 mb-1">Dados do Dispositivo:</div>
                          <div className="space-y-1 text-[#f0f4ff] text-xs">
                            {entity.deviceData.platform && <div>{entity.deviceData.platform}</div>}
                            {entity.deviceData.language && <div>{entity.deviceData.language}</div>}
                            {entity.deviceData.userAgent && (
                              <div className="truncate" title={entity.deviceData.userAgent}>
                                {entity.deviceData.userAgent}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Notas Adicionais */}
                      {entity.notes && (
                        <div className="bg-yellow-50 p-2 rounded text-sm border-l-4 border-yellow-400">
                          <div className="font-medium text-yellow-900 mb-1">Notas:</div>
                          <div className="text-yellow-800">{entity.notes}</div>
                        </div>
                      )}

                      {/* Informao de Desbloqueio */}
                      {!entity.isActive && entity.unblockReason && (
                        <div className="bg-emerald-50 p-2 rounded border-l-4 border-lime-400 text-sm">
                          <div className="font-medium text-emerald-900 mb-1">Desbloqueado:</div>
                          <div className="text-[#f0f4ff]">{entity.unblockReason}</div>
                          {entity.unlockedAt && (
                            <div className="text-emerald-600 text-xs mt-1">
                              {formatDate(entity.unlockedAt)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Footer com Admin e Ao */}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="text-sm text-muted-foreground">
                          Bloqueado por: <span className="font-medium">{entity.blockedBy}</span>
                        </div>
                        {entity.isActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const unlockReason = await showPrompt(
                                "Por que vocestdesbloqueando esta entidade?",
                                "",
                                "Digite o motivo"
                              );
                              if (unlockReason) {
                                unblockEntityMutation.mutate({
                                  blockId: entity.id,
                                  unlockReason
                                });
                              }
                            }}
                            disabled={unblockEntityMutation.isPending}
                            data-testid={`button-unblock-${entity.id}`}
                          >
                            <Unlock className="h-4 w-4 mr-1" />
                            Desbloquear
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {filteredBlockedEntities?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma entidade bloqueada encontrada.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approved Sellers Tab */}
        <TabsContent value="approved-sellers" className="space-y-4">
          {/* Filtros */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <div className="flex-1">
                  <Input
                    placeholder="Buscar por email, UID, IP..."
                    value={sellerFilter.search}
                    onChange={(e) => setSellerFilter({ ...sellerFilter, search: e.target.value })}
                    className="w-full"
                  />
                </div>
                <Button onClick={() => refetchApprovedSellers()} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Atualizar
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Tabela de Sellers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Sellers Aprovados ({approvedSellers?.length || 0})</span>
                <Badge variant="outline">Rastreamento Completo</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-semibold">Email</th>
                      <th className="text-left p-3 font-semibold">UID</th>
                      <th className="text-left p-3 font-semibold">IP de Cadastroo</th>
                      <th className="text-left p-3 font-semibold">Último IP</th>
                      <th className="text-left p-3 font-semibold">Localização</th>
                      <th className="text-left p-3 font-semibold">Status</th>
                      <th className="text-left p-3 font-semibold">Aprovado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedSellers?.filter(seller => {
                      if (!sellerFilter.search) return true;
                      const search = sellerFilter.search.toLowerCase();
                      return (
                        seller.email?.toLowerCase().includes(search) ||
                        seller.uid?.toLowerCase().includes(search) ||
                        seller.registrationIP?.includes(search) ||
                        seller.lastLoginIP?.includes(search)
                      );
                    }).map((seller) => (
                      <tr key={seller.id} className="border-t hover:bg-muted/30">
                        <td className="p-3">
                          <div className="font-medium">{seller.email}</div>
                          {seller.name && (
                            <div className="text-xs text-muted-foreground">{seller.name}</div>
                          )}
                        </td>
                        <td className="p-3">
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {seller.uid?.substring(0, 12)}...
                          </code>
                        </td>
                        <td className="p-3">
                          {seller.registrationIP ? (
                            <code className="text-xs bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded font-mono">
                              {seller.registrationIP}
                            </code>
                          ) : (
                            <span className="text-xs text-muted-foreground">No registrado</span>
                          )}
                        </td>
                        <td className="p-3">
                          {seller.lastLoginIP ? (
                            <code className="text-xs bg-emerald-100 dark:bg-gray-700 px-2 py-1 rounded font-mono">
                              {seller.lastLoginIP}
                            </code>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="p-3">
                          {seller.country || seller.city ? (
                            <div className="text-xs">
                              {seller.city && <div>{seller.city}</div>}
                              {seller.country && <div className="text-muted-foreground">{seller.country}</div>}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="p-3">
                          <Badge 
                            variant={
                              seller.status === 'approved' ? 'default' : 
                              seller.status === 'pending' ? 'secondary' : 
                              'destructive'
                            }
                            className="text-xs"
                          >
                            {seller.status === 'approved' ? 'Aprovado' :
                             seller.status === 'pending' ? 'Pendente' :
                             'Rejeitado'}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {seller.approvedAt 
                            ? new Date(seller.approvedAt).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {(!approvedSellers || approvedSellers.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum seller aprovado encontrado.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
            <CardContent className="pt-6">
              <div className="text-sm text-blue-900 dark:text-blue-100">
                <div className="font-semibold mb-1">Sistema Anti-Fraude Ativo</div>
                <p className="mb-2">
                  Esta lista mostra todos os sellers aprovados com seus <strong>IPs reais de cadastro</strong>. 
                  Isso permite identificar:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Mltiplos cadastros do mesmo IP (possvel fraude)</li>
                  <li>Acessos de VPNs ou proxies (IPs suspeitos)</li>
                  <li>Mudanas bruscas de localização (conta comprometida)</li>
                  <li>Padres de comportamento anmalo</li>
                </ul>
                <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                  IPs são capturados automaticamente no cadastro e em cada login para máxima rastreabilidade.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          {stats && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Ameaas por Categoria */}
              <Card>
                <CardHeader>
                  <CardTitle>Ameaas por Categoria</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.threatsByCategory).map(([category, count]) => (
                      <div key={category} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>{getCategoryIcon(category)}</span>
                          <span className="text-sm">{getCategoryName(category)}</span>
                        </div>
                        <Badge variant="outline">{String(count)}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Ameaas por Severidade */}
              <Card>
                <CardHeader>
                  <CardTitle>Ameaas por Severidade</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.threatsBySeverity).map(([severity, count]) => (
                      <div key={severity} className="flex items-center justify-between">
                        <Badge className={getSeverityColor(severity)}>
                          {severity.toUpperCase()}
                        </Badge>
                        <Badge variant="outline">{String(count)}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Top Atacantes */}
              <Card>
                <CardHeader>
                  <CardTitle>Top Atacantes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {stats.topAttackerIPs?.slice(0, 10).map((attacker: { ip: string; attempts: number }, index: number) => (
                      <div key={attacker.ip} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono w-6 text-center">{index + 1}</span>
                          <code className="text-sm">{attacker.ip}</code>
                        </div>
                        <Badge variant="destructive">{attacker.attempts} tentativas</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Aes Tomadas */}
              <Card>
                <CardHeader>
                  <CardTitle>Aes Tomadas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.actionsTaken).map(([action, count]) => (
                      <div key={action} className="flex items-center justify-between">
                        <span className="text-sm">{action.replace('_', ' ')}</span>
                        <Badge variant="outline">{String(count)}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Shadow Mode Tab */}
        <TabsContent value="shadow-mode" className="space-y-4">
          <ShadowModePanel />
        </TabsContent>

      </Tabs>
    </div>
  );
}

// SHADOW MODE PANEL - APROVAÇÃO HUMANA DE BLOQUEIOS
function ShadowModePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Query: Config
  const { data: configData } = useQuery({
    queryKey: ['/api/admin/shadow-mode/config'],
    queryFn: async () => {
      const res = await apiRequest('/api/admin/shadow-mode/config', 'GET');
      return res.json();
    }
  });
  
  // Query: Stats
  const { data: statsData } = useQuery({
    queryKey: ['/api/admin/shadow-mode/stats'],
    queryFn: async () => {
      const res = await apiRequest('/api/admin/shadow-mode/stats', 'GET');
      return res.json();
    }
  });
  
  // Query: Pending Blocks
  const { data: pendingData } = useQuery({
    queryKey: ['/api/admin/shadow-mode/pending-blocks'],
    queryFn: async () => {
      const res = await apiRequest('/api/admin/shadow-mode/pending-blocks', 'GET');
      return res.json();
    }
  });
  
  // Mutation: Update Config
  const updateConfigMutation = useMutation({
    mutationFn: async (config: { enabled: boolean; autoBlockThreshold: number; requireApprovalBelow: number }) => {
      const res = await apiRequest('/api/admin/shadow-mode/config', 'PATCH', config);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/shadow-mode/config'] });
      toast({ title: 'Configuração atualizada com sucesso!' });
    }
  });
  
  // Mutation: Approve Block
  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const res = await apiRequest(`/api/admin/shadow-mode/pending-blocks/${id}/approve`, 'POST', { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/shadow-mode/pending-blocks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/shadow-mode/stats'] });
      toast({ title: 'Bloqueio aprovado com sucesso!' });
    }
  });
  
  // Mutation: Reject Block
  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const res = await apiRequest(`/api/admin/shadow-mode/pending-blocks/${id}/reject`, 'POST', { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/shadow-mode/pending-blocks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/shadow-mode/stats'] });
      toast({ title: 'Bloqueio rejeitado' });
    }
  });
  
  const config = configData?.config;
  const stats = statsData?.stats;
  const pendingBlocks = pendingData?.pendingBlocks || [];
  
  return (
    <div className="space-y-6">
      {/* Configuração */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Configuração Shadow Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Shadow Mode:</strong> IA detecta ameaas mas NÃO bloqueia automaticamente. 
              Admin revisa e decide se aprova ou rejeita o bloqueio. Reduz falsos positivos!
            </p>
          </div>
          
          {config && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Status do Shadow Mode</label>
                <div className="flex items-center gap-2">
                  <Button
                    variant={config.shadowMode.enabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateConfigMutation.mutate({
                      ...config.shadowMode,
                      enabled: true
                    })}
                    data-testid="button-enable-shadow-mode"
                  >
                    ATIVADO
                  </Button>
                  <Button
                    variant={!config.shadowMode.enabled ? 'destructive' : 'outline'}
                    size="sm"
                    onClick={() => updateConfigMutation.mutate({
                      ...config.shadowMode,
                      enabled: false
                    })}
                    data-testid="button-disable-shadow-mode"
                  >
                    DESATIVADO
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Threshold de Bloqueio Automático: {config.shadowMode.autoBlockThreshold}%
                </label>
                <Input
                  type="range"
                  min="0"
                  max="100"
                  value={config.shadowMode.autoBlockThreshold}
                  onChange={(e) => updateConfigMutation.mutate({
                    ...config.shadowMode,
                    autoBlockThreshold: parseInt(e.target.value)
                  })}
                  className="w-full"
                  data-testid="slider-auto-block-threshold"
                />
                <p className="text-xs text-muted-foreground">
                  Bloqueio automático apenas se AI confidence {config.shadowMode.autoBlockThreshold}%
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Estatísticas */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600" data-testid="stat-pending-blocks">
                {stats.totalPending}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Aprovados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600" data-testid="stat-approved-blocks">
                {stats.totalApproved}
              </div>
              <p className="text-xs text-muted-foreground">
                Média: {stats.avgConfidenceApproved.toFixed(1)}% confidence
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Rejeitados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600" data-testid="stat-rejected-blocks">
                {stats.totalRejected}
              </div>
              <p className="text-xs text-muted-foreground">
                Média: {stats.avgConfidenceRejected.toFixed(1)}% confidence
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Taxa de Rejeio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600" data-testid="stat-rejection-rate">
                {stats.totalApproved + stats.totalRejected > 0 
                  ? ((stats.totalRejected / (stats.totalApproved + stats.totalRejected)) * 100).toFixed(1)
                  : 0}%
              </div>
              <p className="text-xs text-muted-foreground">Falsos positivos evitados</p>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Bloqueios Pendentes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Bloqueios Pendentes de Aprovação ({pendingBlocks.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingBlocks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-2 text-emerald-500" />
              <p>Nenhum bloqueio pendente! </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingBlocks.map((block: any) => (
                <Card key={block.id} className="border-l-4 border-l-orange-500">
                  <CardContent className="pt-4">
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant={
                              block.riskLevel === 'critical' ? 'destructive' :
                              block.riskLevel === 'high' ? 'destructive' :
                              block.riskLevel === 'medium' ? 'default' : 'secondary'
                            }>
                              {block.riskLevel.toUpperCase()}
                            </Badge>
                            <Badge variant="outline">{block.aiConfidence}% Confidence</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{block.detectedAt}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => approveMutation.mutate({ id: block.id })}
                            disabled={approveMutation.isPending}
                            data-testid={`button-approve-${block.id}`}
                          >
                            Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => rejectMutation.mutate({ id: block.id })}
                            disabled={rejectMutation.isPending}
                            data-testid={`button-reject-${block.id}`}
                          >
                            Rejeitar
                          </Button>
                        </div>
                      </div>
                      
                      {/* Detalhes */}
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="font-medium">Identificadores:</p>
                          <p className="text-muted-foreground">IP: {block.ip || 'N/A'}</p>
                          {block.uid && <p className="text-muted-foreground">UID: {block.uid}</p>}
                          {block.deviceFingerprint && <p className="text-muted-foreground">Fingerprint: {block.deviceFingerprint.substring(0, 16)}...</p>}
                        </div>
                        <div>
                          <p className="font-medium">Request:</p>
                          <p className="text-muted-foreground">{block.action} {block.route}</p>
                          <p className="text-muted-foreground text-xs">{block.userAgent?.substring(0, 50)}...</p>
                        </div>
                      </div>
                      
                      {/* AI Analysis */}
                      <div className="bg-brand-subtle dark:bg-card rounded-lg p-3">
                        <p className="font-medium text-sm mb-1">Anlise AI:</p>
                        <p className="text-sm text-muted-foreground mb-2">{block.reason}</p>
                        <div className="flex flex-wrap gap-1">
                          {block.aiPatterns?.map((pattern: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {pattern}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      
                      {/* Account Data */}
                      {block.accountData && (
                        <div className="text-sm">
                          <p className="font-medium">Conta:</p>
                          <p className="text-muted-foreground">
                            {block.accountData.email} ({block.accountData.displayName})
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}