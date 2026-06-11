/**
 * 📊 MONITORING DASHBOARD - ADMIN
 * Dashboard completo para monitoramento de saldos, saques, fraudes e reconciliação
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { 
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  Zap,
  RefreshCw,
  Users,
  Shield,
  Info
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface MonitoringDashboard {
  generatedAt: any;
  balances: {
    BRL: BalanceAggregation;
    USD: BalanceAggregation;
    EUR: BalanceAggregation;
  };
  reconciliation: ReconciliationMetrics;
  withdrawals: WithdrawalMetrics;
  fraud: FraudMetrics;
  systemHealth: number;
}

interface BalanceAggregation {
  currency: string;
  totalAvailable: number;
  totalReserved: number;
  totalWithdrawn: number;
  topSellers: Array<{
    sellerId: string;
    sellerEmail: string;
    available: number;
    reserved: number;
    withdrawn: number;
  }>;
  lastUpdated: any;
}

interface ReconciliationMetrics {
  lastRunAt?: any;
  lastRunStatus: 'success' | 'partial_success' | 'failed';
  sellersChecked: number;
  discrepanciesFound: number;
  totalDiscrepancyAmount: number;
  topDiscrepancies: Array<{
    sellerId: string;
    sellerEmail: string;
    currency: string;
    storedBalance: number;
    calculatedBalance: number;
    difference: number;
  }>;
  healthScore: number;
}

interface WithdrawalMetrics {
  totalPending: number;
  totalApproved: number;
  totalRejected: number;
  totalCompleted: number;
  amountPendingBRL: number;
  amountPendingUSD: number;
  amountPendingEUR: number;
  amountApprovedBRL: number;
  amountApprovedUSD: number;
  amountApprovedEUR: number;
  averageApprovalTime: number;
  rejectionRate: number;
  recentWithdrawals: {
    count: number;
    totalAmount: number;
    currency: string;
  };
}

interface FraudMetrics {
  totalAlerts: number;
  totalUnreviewed: number;
  totalHighRisk: number;
  totalMediumRisk: number;
  totalLowRisk: number;
  fraudConfirmationRate: number;
  falsePositiveRate: number;
  circuitBreakerStatus: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  circuitBreakerFailures: number;
  aiAvailable: boolean;
  aiAverageConfidence: number;
  recentAlerts: {
    count: number;
    highRiskCount: number;
  };
}

const COLORS = ['#2563eb', '#f59e0b', '#ef4444', '#2563eb', '#06b6d4'];

export default function MonitoringDashboard() {
  const { toast } = useToast();
  const [dashboard, setDashboard] = useState<MonitoringDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const formatCurrency = (amount: number, currency: string): string => {
    const value = amount / 100;
    if (currency === 'BRL') {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    } else if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    } else if (currency === 'EUR') {
      return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
    }
    return `${currency} ${value.toFixed(2)}`;
  };

  const loadDashboard = async () => {
    try {
      setLoading(true);
      
      let user = auth.currentUser;
      if (!user) {
        user = await new Promise<any>((resolve) => {
          const unsub = auth.onAuthStateChanged((u) => {
            unsub();
            resolve(u);
          });
          setTimeout(() => resolve(null), 3000);
        });
      }
      if (!user) {
        console.warn('Monitoring: sem autenticação');
        return;
      }
      
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/monitoring/dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        console.warn('Monitoring dashboard response:', response.status);
        return;
      }

      const data = await response.json();

      if (data.success) {
        setDashboard(data.data);
        setLastUpdated(new Date());
      }
    } catch (error: any) {
      console.error('Erro ao carregar dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadDashboard();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const getHealthColor = (score: number): string => {
    if (score >= 90) return "text-emerald-600";
    if (score >= 70) return "text-yellow-600";
    if (score >= 50) return "text-orange-600";
    return "text-red-600";
  };

  const getHealthBadge = (score: number) => {
    if (score >= 90) return <Badge className="bg-emerald-600">Saudável</Badge>;
    if (score >= 70) return <Badge className="bg-yellow-600">Atenção</Badge>;
    if (score >= 50) return <Badge className="bg-orange-600">Alerta</Badge>;
    return <Badge className="bg-red-600">Crítico</Badge>;
  };

  if (loading && !dashboard) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!dashboard) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <AlertTriangle className="w-16 h-16 text-muted-foreground" />
          <h2 className="text-2xl font-bold">Carregando dados do monitoramento</h2>
          <p className="text-muted-foreground">Tente novamente em alguns instantes.</p>
          <Button onClick={loadDashboard}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Tentar Novamente
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const balancesData = [
    { name: 'BRL', available: dashboard.balances.BRL.totalAvailable / 100, reserved: dashboard.balances.BRL.totalReserved / 100, withdrawn: dashboard.balances.BRL.totalWithdrawn / 100 },
    { name: 'USD', available: dashboard.balances.USD.totalAvailable / 100, reserved: dashboard.balances.USD.totalReserved / 100, withdrawn: dashboard.balances.USD.totalWithdrawn / 100 },
    { name: 'EUR', available: dashboard.balances.EUR.totalAvailable / 100, reserved: dashboard.balances.EUR.totalReserved / 100, withdrawn: dashboard.balances.EUR.totalWithdrawn / 100 }
  ];

  const withdrawalStatusData = [
    { name: 'Pendentes', value: dashboard.withdrawals.totalPending, color: '#f59e0b' },
    { name: 'Aprovados', value: dashboard.withdrawals.totalApproved, color: '#2563eb' },
    { name: 'Rejeitados', value: dashboard.withdrawals.totalRejected, color: '#ef4444' },
    { name: 'Concluídos', value: dashboard.withdrawals.totalCompleted, color: '#06b6d4' }
  ];

  const fraudRiskData = [
    { name: 'Baixo Risco', value: dashboard.fraud.totalLowRisk, color: '#2563eb' },
    { name: 'Médio Risco', value: dashboard.fraud.totalMediumRisk, color: '#f59e0b' },
    { name: 'Alto Risco', value: dashboard.fraud.totalHighRisk, color: '#ef4444' }
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8 p-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Monitoring Dashboard</h1>
            <p className="text-muted-foreground">Sistema de monitoramento completo</p>
          </div>
          <div className="flex gap-2 items-center">
            <Badge variant="outline">
              Atualizado: {lastUpdated.toLocaleTimeString('pt-BR')}
            </Badge>
            <Button 
              onClick={loadDashboard} 
              variant="outline" 
              size="icon"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              onClick={() => setAutoRefresh(!autoRefresh)}
              variant={autoRefresh ? "default" : "outline"}
            >
              {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">System Health</CardTitle>
              <Activity className={`w-4 h-4 ${getHealthColor(dashboard.systemHealth)}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard.systemHealth}%</div>
              <div className="mt-2">{getHealthBadge(dashboard.systemHealth)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo Disponível (BRL)</CardTitle>
              <DollarSign className="w-4 h-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(dashboard.balances.BRL.totalAvailable, 'BRL')}</div>
              <p className="text-xs text-muted-foreground">
                Reservado: {formatCurrency(dashboard.balances.BRL.totalReserved, 'BRL')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saques Pendentes</CardTitle>
              <Clock className="w-4 h-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard.withdrawals.totalPending}</div>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(dashboard.withdrawals.amountPendingBRL, 'BRL')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Alertas de Fraude</CardTitle>
              <Shield className="w-4 h-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard.fraud.totalUnreviewed}</div>
              <p className="text-xs text-muted-foreground">
                {dashboard.fraud.totalHighRisk} de alto risco
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="balances" className="space-y-4">
          <TabsList>
            <TabsTrigger value="balances">Saldos</TabsTrigger>
            <TabsTrigger value="withdrawals">Saques</TabsTrigger>
            <TabsTrigger value="fraud">Fraude</TabsTrigger>
            <TabsTrigger value="reconciliation">Reconciliação</TabsTrigger>
          </TabsList>

          <TabsContent value="balances" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Saldos por Moeda</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={balancesData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                      <Legend />
                      <Bar dataKey="available" fill="#2563eb" name="Disponível" />
                      <Bar dataKey="reserved" fill="#f59e0b" name="Reservado" />
                      <Bar dataKey="withdrawn" fill="#06b6d4" name="Sacado (Total)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Sellers (BRL)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dashboard.balances.BRL.topSellers.slice(0, 10).map((seller, index) => (
                    <div key={seller.sellerId} className="flex justify-between items-center p-2 rounded hover:bg-muted">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">#{index + 1}</Badge>
                        <div>
                          <p className="text-sm font-medium truncate max-w-[200px]">{seller.sellerEmail}</p>
                          <p className="text-xs text-muted-foreground">
                            Disponível: {formatCurrency(seller.available, 'BRL')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">{formatCurrency(seller.available + seller.reserved, 'BRL')}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="withdrawals" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Status dos Saques</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={withdrawalStatusData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value}`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {withdrawalStatusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Métricas de Saques</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Taxa de Rejeição</p>
                      <p className="text-2xl font-bold">{dashboard.withdrawals.rejectionRate}%</p>
                    </div>
                    <XCircle className="w-8 h-8 text-red-600" />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Tempo Médio de Aprovação</p>
                      <p className="text-2xl font-bold">{dashboard.withdrawals.averageApprovalTime}min</p>
                    </div>
                    <Clock className="w-8 h-8 text-blue-600" />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Saques Recentes (24h)</p>
                      <p className="text-2xl font-bold">{dashboard.withdrawals.recentWithdrawals.count}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(dashboard.withdrawals.recentWithdrawals.totalAmount, dashboard.withdrawals.recentWithdrawals.currency)}
                      </p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-emerald-600" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="fraud" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Distribuição de Risco</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={fraudRiskData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value}`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {fraudRiskData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Sistema de Detecção de Fraude</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Circuit Breaker</p>
                      <Badge className={
                        dashboard.fraud.circuitBreakerStatus === 'CLOSED' ? 'bg-emerald-600' :
                        dashboard.fraud.circuitBreakerStatus === 'HALF_OPEN' ? 'bg-yellow-600' :
                        'bg-red-600'
                      }>
                        {dashboard.fraud.circuitBreakerStatus}
                      </Badge>
                    </div>
                    <Zap className="w-8 h-8" />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">AI Disponível</p>
                      <p className="text-2xl font-bold">{dashboard.fraud.aiAvailable ? 'Sim' : 'Não'}</p>
                      <p className="text-xs text-muted-foreground">
                        Confiança média: {dashboard.fraud.aiAverageConfidence}%
                      </p>
                    </div>
                    <CheckCircle className={`w-8 h-8 ${dashboard.fraud.aiAvailable ? 'text-emerald-600' : 'text-red-600'}`} />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Taxa de Fraude Confirmada</p>
                      <p className="text-2xl font-bold">{dashboard.fraud.fraudConfirmationRate}%</p>
                    </div>
                    <AlertTriangle className="w-8 h-8 text-red-600" />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Taxa de Falsos Positivos</p>
                      <p className="text-2xl font-bold">{dashboard.fraud.falsePositiveRate}%</p>
                    </div>
                    <Info className="w-8 h-8 text-blue-600" />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Alertas Recentes (24h)</p>
                      <p className="text-2xl font-bold">{dashboard.fraud.recentAlerts.count}</p>
                      <p className="text-xs text-muted-foreground">
                        {dashboard.fraud.recentAlerts.highRiskCount} de alto risco
                      </p>
                    </div>
                    <Shield className="w-8 h-8 text-yellow-600" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="reconciliation" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Status da Reconciliação</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Health Score</p>
                      <div className="flex items-center gap-2 mt-2">
                        <p className="text-4xl font-bold">{dashboard.reconciliation.healthScore}%</p>
                        {getHealthBadge(dashboard.reconciliation.healthScore)}
                      </div>
                    </div>
                    <Activity className={`w-12 h-12 ${getHealthColor(dashboard.reconciliation.healthScore)}`} />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Última Execução</p>
                      <Badge className={
                        dashboard.reconciliation.lastRunStatus === 'success' ? 'bg-emerald-600' :
                        dashboard.reconciliation.lastRunStatus === 'partial_success' ? 'bg-yellow-600' :
                        'bg-red-600'
                      }>
                        {dashboard.reconciliation.lastRunStatus.toUpperCase()}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Sellers Verificados</p>
                      <p className="text-2xl font-bold">{dashboard.reconciliation.sellersChecked}</p>
                    </div>
                    <Users className="w-8 h-8 text-blue-600" />
                  </div>

                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">Discrepâncias Encontradas</p>
                      <p className="text-2xl font-bold">{dashboard.reconciliation.discrepanciesFound}</p>
                      <p className="text-xs text-muted-foreground">
                        Total: {formatCurrency(dashboard.reconciliation.totalDiscrepancyAmount, 'BRL')}
                      </p>
                    </div>
                    <AlertTriangle className="w-8 h-8 text-red-600" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top 5 Discrepâncias</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dashboard.reconciliation.topDiscrepancies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center">
                      <CheckCircle className="w-16 h-16 text-emerald-600 mb-4" />
                      <p className="text-lg font-medium">Nenhuma Discrepância</p>
                      <p className="text-sm text-muted-foreground">Todos os saldos estão corretos!</p>
                    </div>
                  ) : (
                    dashboard.reconciliation.topDiscrepancies.map((disc, index) => (
                      <div key={disc.sellerId} className="flex justify-between items-center p-3 rounded border">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive">#{index + 1}</Badge>
                          <div>
                            <p className="text-sm font-medium truncate max-w-[200px]">{disc.sellerEmail}</p>
                            <p className="text-xs text-muted-foreground">
                              Armazenado: {formatCurrency(disc.storedBalance, disc.currency)} | 
                              Calculado: {formatCurrency(disc.calculatedBalance, disc.currency)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-600">
                            Δ {formatCurrency(disc.difference, disc.currency)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
