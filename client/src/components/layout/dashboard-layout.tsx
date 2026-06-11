import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";
import { RevenueBar } from "./revenue-bar";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Menu, LayoutDashboard, ShoppingCart, Settings, X, Store, Clock, Bell, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth";
import { ThemeToggle } from "./theme-toggle";
import SupportFloatButton from "@/components/support/support-float-button";
import { PwaInstallBanner } from "@/components/pwa/install-banner";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase";
import { initPushNotificationsQuietly, initPushNotifications } from "@/lib/push-notifications";
import { unlockAudio } from "@/lib/notification-sound";
import { toast } from "@/hooks/use-toast";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, isAdmin: isAdminUser } = useAuthStore();
  const { tenant, loading: tenantLoading } = useTenantStore();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  // Fechar sidebar mobile automaticamente ao navegar
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);
  const [sellerStatus, setSellerStatus] = useState<string | null>(null);
  const [sellerProfileComplete, setSellerProfileComplete] = useState(false);

  const getNotifPermission = () => {
    if (typeof Notification === 'undefined') return 'granted';
    return Notification.permission;
  };
  const BANNER_DISMISSED_KEY = 'cc_notif_banner_dismissed_v1';
  const [showNotifBanner, setShowNotifBanner] = useState(() => {
    const perm = getNotifPermission();
    const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY) === '1';
    return perm === 'default' && !dismissed;
  });
  const [activatingPush, setActivatingPush] = useState(false);

  const handleActivatePush = useCallback(async () => {
    if (!user?.uid) return;
    setActivatingPush(true);
    unlockAudio();
    try {
      const result = await initPushNotifications(user.uid);
      if (result.success) {
        setShowNotifBanner(false);
        toast({ title: '🔔 Notificações ativadas!', description: 'Você receberá alertas a cada venda aprovada.', duration: 5000 });
      } else if (result.reason === 'permission_denied') {
        setShowNotifBanner(false);
        localStorage.setItem(BANNER_DISMISSED_KEY, '1');
        toast({ title: 'Notificações bloqueadas', description: 'Para receber alertas de venda, habilite notificações nas configurações do navegador.', duration: 8000 });
      } else if (result.reason === 'not_supported') {
        toast({ title: 'Dispositivo não suportado', description: result.message, duration: 9000 });
      } else {
        toast({ title: 'Não foi possível ativar', description: result.message || 'Tente novamente nas configurações.', duration: 5000 });
      }
    } catch {
      toast({ title: 'Erro ao ativar notificações', description: 'Tente novamente.', duration: 4000 });
    } finally {
      setActivatingPush(false);
    }
  }, [user?.uid]);

  const handleDismissBanner = useCallback(() => {
    setShowNotifBanner(false);
    localStorage.setItem(BANNER_DISMISSED_KEY, '1');
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token || cancelled) return;
        const res = await fetch(`/api/sellers/${user.uid}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSellerStatus(data.status || 'pending');
          setSellerProfileComplete(data.profileComplete || false);
        }
      } catch {}
    };
    fetchStatus();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user?.uid) return;
    const permissionState = typeof Notification !== 'undefined' ? Notification.permission : 'granted';
    // Se já concedido: registra/atualiza token silenciosamente após 3s
    if (permissionState === 'granted') {
      const timer = setTimeout(() => {
        initPushNotificationsQuietly(user.uid).catch(() => {});
      }, 3000);
      return () => clearTimeout(timer);
    }
    // Se não concedido: o banner visível cuida do pedido de permissão
  }, [user?.uid]);

  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  useEffect(() => {
    const handleSaleNotification = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        title: string;
        body: string;
        productName: string;
        amount: string;
      };
      const amountCents = parseInt(detail.amount || '0', 10);
      const amountFmt = amountCents > 0
        ? `R$ ${(amountCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '';
      const produto = detail.productName || detail.body || 'Venda realizada';
      toast({
        title: '💰 Venda Aprovada!',
        description: amountFmt ? `${produto} — ${amountFmt}` : produto,
        duration: 8000,
      });
    };
    window.addEventListener('cc-sale-notification', handleSaleNotification);
    return () => window.removeEventListener('cc-sale-notification', handleSaleNotification);
  }, []);

  // ✅ Admin não usa dados de tenant — nunca bloquear layout para admin
  if (tenantLoading && !isAdminUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-background" data-testid="loading-tenant">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm text-muted-foreground dark:text-gray-400">Carregando dados da conta...</p>
        </div>
      </div>
    );
  }

  if (isMobile) {
    
    //  BOTTOM NAV ITEMS - App Style
    const bottomNavItems = [
      { href: "/dashboard", icon: LayoutDashboard, label: "Início" },
      { href: "/dashboard/sales", icon: ShoppingCart, label: "Pedidos" },
      { href: "/dashboard/showcase", icon: Store, label: "Vitrine" },
      { href: "/dashboard/settings", icon: Settings, label: "Configurações" },
    ];
    
    return (
      <div className="flex h-screen bg-background flex-col overflow-hidden">
        <main className="flex-1 overflow-hidden flex flex-col relative">
          {/* Botão Menu (esquerda) + ThemeToggle (direita) */}
          <div className="fixed top-4 left-4 z-50">
            <Button 
              variant="outline" 
              size="icon" 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              data-testid="mobile-menu-trigger"
              className="h-10 w-10 bg-background border-border shadow-md transition-transform active:scale-95"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
          <div className="fixed top-4 right-4 z-50">
            <ThemeToggle size="sm" />
          </div>
          
          {/* Menu lateral otimizado - Slide da esquerda */}
          <div 
            className={cn(
              "fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-transparent border-r border-gray-200 dark:border-violet-500/20 transform transition-transform duration-300 ease-out",
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="h-full overflow-y-auto">
              <Sidebar onNavigate={() => setSidebarOpen(false)} />
            </div>
          </div>
          
          {/* Overlay - apenas quando menu aberto */}
          {sidebarOpen && (
            <div 
              className="fixed inset-0 bg-black/30 dark:bg-black/50 z-30 transition-opacity duration-300"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          
          <div className="flex-1 overflow-y-auto pb-20 pt-14">
            <PwaInstallBanner />
            {showNotifBanner && (
              <div className="mx-3 mt-1 mb-1 flex items-center gap-3 rounded-xl bg-violet-900/80 border border-violet-500/30 px-4 py-3 shadow-lg">
                <Bell className="h-5 w-5 text-violet-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-violet-100 leading-tight">Ative as notificações de venda</p>
                  <p className="text-xs text-violet-300/80 mt-0.5 leading-tight">Receba alertas a cada pagamento aprovado</p>
                </div>
                <Button
                  size="sm"
                  className="shrink-0 bg-violet-600 hover:bg-violet-500 text-white text-xs h-8 px-3"
                  onClick={handleActivatePush}
                  disabled={activatingPush}
                >
                  {activatingPush ? 'Ativando...' : 'Ativar'}
                </Button>
                <button onClick={handleDismissBanner} className="shrink-0 text-violet-400/60 hover:text-violet-300 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {children}
          </div>
        </main>
        
        {/*  BOTTOM NAVIGATION - APP STYLE */}
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-40 shadow-[0_-2px_8px_rgba(0,0,0,0.1)] dark:shadow-[0_-2px_8px_rgba(0,0,0,0.3)]">
          <nav className="flex justify-around items-center h-16 px-2">
            {bottomNavItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              
              return (
                <Link key={item.href} href={item.href}>
                  <button
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[70px] cursor-pointer",
                      isActive 
                        ? "text-primary bg-primary/10" 
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                    data-testid={`bottom-nav-${item.href.split('/').pop()}`}
                  >
                    <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                    <span className="text-xs font-medium">{item.label}</span>
                  </button>
                </Link>
              );
            })}
          </nav>
        </div>
        
        {/*  BOTÃO FLUTUANTE DE ATENDIMENTO - MOBILE */}
        <SupportFloatButton />
      </div>
    );
  }

  //  DESKTOP: Renderizar apenas quando NÃO for mobile
  const getGreeting = () => {
    const now = new Date();
    const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    
    const dayName = days[now.getDay()];
    const day = now.getDate();
    const month = months[now.getMonth()];
    const year = now.getFullYear();
    
    return `Hoje é ${dayName}, ${day} de ${month} de ${year}`;
  };

  const userName = tenant?.name || user?.displayName || 'Usuário';
  const showAnalysisBadge = sellerStatus === 'pending';

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        {/* Header com saudação, barra de faturamento, tema e menu de usuário */}
        <header className="h-16 border-b border-border bg-background flex items-center justify-between px-6 gap-4">
          {/* Saudação personalizada */}
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <p className="font-medium">Olá, {userName}!</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{getGreeting()}</p>
            </div>
            {showAnalysisBadge && (
              <div className="flex flex-col items-start gap-0.5" data-testid="badge-em-analise">
                <Badge variant="secondary" className="bg-amber-900/40 text-amber-300 border-amber-600/40 text-[10px] px-2 py-0.5 no-default-hover-elevate no-default-active-elevate">
                  <Clock className="h-3 w-3 mr-1" />
                  Sua conta está em análise
                </Badge>
                <span className="text-[10px] text-amber-400/70 pl-1">Em até 5h úteis você será notificado</span>
              </div>
            )}
          </div>
          
          {/* Lado direito: Faturamento, Tema e Menu */}
          <div className="flex items-center gap-3">
            <RevenueBar />
            <ThemeToggle />
            {isAdminUser ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { await signOut(); window.location.href = "/login"; }}
                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1.5"
                title="Sair"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline text-sm">Sair</span>
              </Button>
            ) : (
              <UserMenu />
            )}
          </div>
        </header>
        
        <PwaInstallBanner />
        <main className="flex-1 overflow-y-auto p-4">
          {children}
        </main>
      </div>
      
      {/*  BOTÃO FLUTUANTE DE ATENDIMENTO - DESKTOP */}
      <SupportFloatButton />
    </div>
  );
}

export default DashboardLayout;
