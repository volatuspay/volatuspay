import { Link, useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { LogoThemed } from "@/components/ui/logo-themed";
import { maskEmail } from "@/lib/user-display";
import {
  LayoutDashboard,
  CreditCard,
  ShoppingCart,
  Settings,
  LogOut,
  PlaySquare,
  Users,
  Shield,
  UserCheck,
  BarChart3,
  DollarSign,
  Package,
  Clock,
  RefreshCw,
  AlertTriangle,
  Skull,
  Bot,
  Store,
  ShoppingBag,
  Rocket,
  Zap,
  Image,
  MessageSquare,
  Palette,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Trophy,
  Gift,
  UserCog,
  Briefcase,
  Lock,
  FileBarChart,
  Landmark,
  Lightbulb,
  Coins,
  Building2,
  BookOpen,
  FileText,
  KeyRound,
  User,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { signOut } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { useGlobalConfigStore } from "@/stores/global-config";
import { useEffect, useState } from "react";
import { CompanySwitcher } from "@/components/layout/company-switcher";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ADMIN_CONFIG } from "@shared/app-config";
import { useUserRole } from "@/hooks/use-user-role";
import { ROLES, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "@shared/roles";
import { useSellerTeamStore } from "@/stores/seller-team";
import { SELLER_TEAM_ALLOWED_MENUS } from "@shared/seller-roles";

//  MENUS SEPARADOS POR TIPO DE USURIO

// ADMIN - Administradores (APENAS funcionalidades crticas)
const adminItems = [
  {
    title: "Dashboard Master",
    href: "/admin/dashboard",
    icon: BarChart3,
  },
  {
    title: "Central de Atendimento",
    href: "/admin/support",
    icon: MessageSquare,
  },
  {
    title: "Seller",
    icon: Users,
    subItems: [
      {
        title: "Aprovar Conta PJ",
        href: "/admin/company-approvals",
        icon: Building2,
      },
      {
        title: "Aprovar Afiliados",
        href: "/admin/affiliate-approvals",
        icon: UserCheck,
      },
      {
        title: "Pré-Registro",
        href: "/admin/pre-registro",
        icon: Clock,
      },
      {
        title: "Sellers",
        href: "/admin/manage-sellers", 
        icon: Users,
      },
      {
        title: "Sellers de Risco",
        href: "/admin/sellers-risk",
        icon: AlertTriangle,
      },
    ],
  },
  {
    title: "Produtos",
    icon: Package,
    subItems: [
      {
        title: "Gerenciar Produtos",
        href: "/admin/products",
        icon: Package,
      },
      {
        title: "Produtos Bloqueados",
        href: "/admin/products/blocked",
        icon: Ban,
      },
      {
        title: "Produtos de Risco",
        href: "/admin/products/risk",
        icon: AlertTriangle,
      },
    ],
  },
  {
    title: "Equipe",
    icon: UserCog,
    subItems: [
      {
        title: "Time",
        href: "/admin/team",
        icon: Users,
      },
      {
        title: "Cargos",
        href: "/admin/roles",
        icon: Briefcase,
      },
    ],
  },
  {
    title: "Financeiro",
    icon: DollarSign,
    subItems: [
      {
        title: "Transações",
        href: "/admin/transactions",
        icon: CreditCard,
      },
      {
        title: "Aprovar Saques",
        href: "/admin/withdrawals",
        icon: DollarSign,
      },
      {
        title: "Saques Reembolso",
        href: "/admin/refund-withdrawals",
        icon: RefreshCw,
      },
      {
        title: "MEDs/Disputas",
        href: "/admin/disputes",
        icon: AlertTriangle,
      },
      {
        title: "Taxa de Saque",
        href: "/admin/withdrawal-fee",
        icon: Settings,
      },
    ],
  },
  {
    title: "Configurações",
    icon: Settings,
    subItems: [
      {
        title: "Banners",
        href: "/admin/banners",
        icon: Image,
      },
      {
        title: "Adquirentes",
        href: "/admin/acquirers",
        icon: Palette,
      },
    ],
  },
  {
    title: " Monitoramento",
    href: "/admin/security",
    icon: Shield,
  },
];

function VolatusAIIcon({ className }: { className?: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <img src="/favicon.png" alt="Volatus AI" style={{ width: "1.1em", height: "1.1em", objectFit: "contain", display: "block" }} />
    </span>
  );
}

// SELLER - Vendedores (tem tenant)
const sellerItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Volatus AI",
    href: "/dashboard/ai-chat",
    icon: VolatusAIIcon,
    badge: "IA",
  },
  {
    title: "Vitrine",
    href: "/dashboard/showcase",
    icon: Store,
  },
  {
    title: "Produtos",
    icon: Package,
    subItems: [
      {
        title: "Meus Produtos",
        href: "/dashboard/products-list",
        icon: Package,
      },
      {
        title: "Minhas Compras",
        href: "/dashboard/my-purchases",
        icon: ShoppingBag,
      },
      {
        title: "Minhas Afiliações",
        href: "/dashboard/my-affiliations",
        icon: Users,
      },
      {
        title: "Convites Coprodução",
        href: "/dashboard/coproduction-invites",
        icon: Users,
      },
    ],
  },
  {
    title: "Vendas",
    href: "/dashboard/sales",
    icon: ShoppingCart,
  },
  {
    title: "Assinaturas",
    href: "/dashboard/subscriptions",
    icon: RefreshCw,
  },
  {
    title: "Financeiro",
    icon: DollarSign,
    subItems: [
      {
        title: "Financeiro",
        href: "/dashboard/finances",
        icon: DollarSign,
      },
      {
        title: "Extrato",
        href: "/dashboard/reports",
        icon: FileBarChart,
      },
      {
        title: "Minhas Taxas",
        href: "/dashboard/settings/fees",
        icon: DollarSign,
      },
      {
        title: "Dados Bancários",
        href: "/dashboard/banking-data",
        icon: Landmark,
      },
    ],
  },
  {
    title: "Saque em Cripto",
    href: "/dashboard/withdrawal-crypto",
    icon: Coins,
  },
  {
    title: "Premiações",
    href: "/dashboard/premiations",
    icon: Trophy,
  },
  {
    title: "Área de Membros",
    href: "/members-dashboard",
    icon: BookOpen,
  },
  {
    title: "Configurações",
    href: "/dashboard/settings",
    icon: Settings,
  },
  // ===== CATEGORIAS REMOVIDAS VISUALMENTE (BACKEND MANTIDO) =====
  // {
  //   title: "Marketplace",
  //   icon: Store,
  //   subItems: [
  //     {
  //       title: "Vitrine Pblica",
  //       href: "/showcase",
  //       icon: Store,
  //     },
  //     {
  //       title: "Afiliados",
  //       href: "/dashboard/affiliates",
  //       icon: Users,
  //     },
  //   ],
  // },
  // {
  //   title: "Meus Produtos",
  //   icon: Package,
  //   subItems: [
  //     {
  //       title: "Produtos",
  //       href: "/dashboard/checkouts",
  //       icon: CreditCard,
  //     },
  //     {
  //       title: "Área de Membros",
  //       href: "/dashboard/products",
  //       icon: PlaySquare,
  //     },
  //   ],
  // },
  // {
  //   title: "Vendas Digitais",
  //   href: "/dashboard/orders",
  //   icon: ShoppingCart,
  // },
  // {
  //   title: "Assinaturas",
  //   href: "/dashboard/subscriptions",
  //   icon: RefreshCw,
  // },
  // {
  //   title: "Financeiro",
  //   icon: DollarSign,
  //   subItems: [
  //     {
  //       title: "Solicitar Saque",
  //       href: "/dashboard/withdrawals",
  //       icon: DollarSign,
  //     },
  //     {
  //       title: "Reembolsos",
  //       href: "/dashboard/refunds",
  //       icon: Skull,
  //     },
  //     {
  //       title: "Minhas Compras",
  //       href: "/dashboard/my-purchases",
  //       icon: ShoppingBag,
  //     },
  //   ],
  // },
  // {
  //   title: "Premiações",
  //   href: "/dashboard/awards",
  //   icon: Gift,
  // },
];

// CUSTOMER - Compradores (não tem tenant)
const customerItems: any[] = [];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { user, isAdmin: isAdminUser } = useAuthStore();
  const { tenant, loading: tenantLoading } = useTenantStore();
  const [userType, setUserType] = useState<"admin" | "seller" | "customer" | null>(null);
  const [sellerApprovalStatus, setSellerApprovalStatus] = useState<'pending' | 'approved' | 'rejected' | 'not_seller'>('approved');
  const [hasAffiliateProducts, setHasAffiliateProducts] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  const [blockedCategories, setBlockedCategories] = useState<string[]>([]);

  //  CONFIGURAÇES GLOBAIS
  const { config: globalConfig } = useGlobalConfigStore();

  useEffect(() => {
    if (!user) {
      setUserType(null);
      return;
    }

    // ✅ Admin check PRIMEIRO — não depende de tenant nem de tenantLoading
    if (isAdminUser) {
      setUserType("admin");
      return;
    }

    // ✅ Enquanto tenant ainda carrega, usar localStorage como fallback rápido
    // evita que o menu fique vazio durante o carregamento inicial
    if (tenantLoading) {
      const cachedIsSeller = localStorage.getItem(`cc_is_seller_${user.uid}`) === 'true';
      if (cachedIsSeller) {
        setUserType("seller");
      }
      return;
    }

    // Fallback: verificar no servidor (igual ao admin-route.tsx)
    const detectUserType = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) {
          const res = await fetch(`/api/user-type/${user.uid}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.type === 'admin') {
              setUserType("admin");
              return;
            }
          }
        }
      } catch {
        // ignora erro e continua com lógica local
      }

      if (tenant) {
        setUserType("seller");
      } else {
        setUserType("customer");
        setSellerApprovalStatus('not_seller');
      }
    };

    detectUserType();
  }, [user, tenant, tenantLoading, isAdminUser]);

  //  BUSCAR STATUS DE APROVAÇÃO DO SELLER (separado, evita conflito com deteco de tipo)
  useEffect(() => {
    if (!user || userType !== "seller") {
      return;
    }

    const fetchSellerStatus = async () => {
      try {
        //  ESPERA O AUTH ESTAR PRONTO
        if (!auth.currentUser) {
          await new Promise((resolve) => {
            const unsubscribe = auth.onAuthStateChanged((authUser) => {
              if (authUser) {
                unsubscribe();
                resolve(authUser);
              }
            });
          });
        }
        
        const token = await auth.currentUser?.getIdToken();
        
        const response = await fetch(`/api/sellers/${user.uid}`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const sellerData = await response.json();
          const status = sellerData.status || 'approved';
          setSellerApprovalStatus(status);
          // CAPTURAR CATEGORIAS BLOQUEADAS
          setBlockedCategories(sellerData.blockedCategories || []);
        } else {
          setSellerApprovalStatus('approved');
          setBlockedCategories([]);
        }
      } catch (error) {
        setSellerApprovalStatus('approved');
      }
    };

    fetchSellerStatus();
  }, [user, userType]);

  //  VERIFICAR SE SELLER TEM PRODUTOS COM AFILIADOS HABILITADOS
  useEffect(() => {
    if (userType === "seller" && tenant && sellerApprovalStatus === 'approved') {
      const checkAffiliateProducts = async () => {
        try {
          if (!auth.currentUser) return;
          const token = await auth.currentUser.getIdToken();
          const response = await fetch(`/api/checkouts-by-tenant/${tenant.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            const data = await response.json();
            const hasAffiliateSystems = Array.isArray(data) 
              ? data.some((checkout: any) => checkout.affiliate?.enabled === true)
              : data.checkouts?.some((checkout: any) => checkout.affiliate?.enabled === true);
            setHasAffiliateProducts(hasAffiliateSystems);
            console.log(`SIDEBAR: Seller ${tenant} ${hasAffiliateSystems ? 'TEM' : 'NÃO TEM'} produtos com afiliados habilitados`);
          }
        } catch (error) {
          console.warn(' Erro ao verificar produtos com afiliados:', error);
          setHasAffiliateProducts(false);
        }
      };
      
      checkAffiliateProducts();
    } else {
      setHasAffiliateProducts(false);
    }
  }, [userType, tenant, sellerApprovalStatus]);

  // AUTO-EXPANDIR MENUS QUANDO USUÁRIO ESTÁ EM ROTA FILHA
  useEffect(() => {
    const currentMenuItems = getMenuItems();
    
    currentMenuItems.forEach((item: any) => {
      if (item.subItems && item.subItems.length > 0) {
        const hasActiveChild = item.subItems.some((subItem: any) => fullPath === subItem.href || location === subItem.href);
        
        if (hasActiveChild && !expandedMenus[item.title]) {
          setExpandedMenus(prev => ({
            ...prev,
            [item.title]: true
          }));
        }
      }
    });
  }, [location, userType]);

  // BUSCAR ROLE DO USURIO ADMIN
  const { isCEO: isUserCEO, hasPermission, isLoading: isRoleLoading } = useUserRole();

  // TEAM SELLER
  const { isTeamMember, teamRole } = useSellerTeamStore();

  //  SELECIONAR ITENS DO MENU BASEADO NO TIPO DE USURIO
  const getMenuItems = () => {
    switch (userType) {
      case "admin": {
        // ✅ Enquanto role carrega (prod: ~500ms), exibir todos os itens p/ evitar sidebar vazio
        if (isUserCEO || isRoleLoading) return adminItems;

        const filtered: any[] = [];

        for (const item of adminItems) {
          if (item.title === "Dashboard Master") {
            if (hasPermission(PERMISSIONS.VIEW_DASHBOARD)) filtered.push(item);
          } else if (item.title === "Central de Atendimento") {
            if (hasPermission(PERMISSIONS.VIEW_SUPPORT)) filtered.push(item);
          } else if (item.title === " Monitoramento") {
            if (hasPermission(PERMISSIONS.VIEW_SECURITY)) filtered.push(item);
          } else if (item.subItems) {
            if (item.title === "Seller") {
              if (hasPermission(PERMISSIONS.VIEW_SELLERS) || hasPermission(PERMISSIONS.VIEW_PRODUCTS)) {
                const subItems = item.subItems.filter((sub: any) => {
                  if (sub.title === "Aprovar Conta PJ") return hasPermission(PERMISSIONS.APPROVE_SELLERS);
                  if (sub.title === "Aprovar Afiliados") return hasPermission(PERMISSIONS.APPROVE_SELLERS);
                  if (sub.title === "Pré-Registro") return hasPermission(PERMISSIONS.VIEW_SELLERS);
                  if (sub.title === "Sellers") return hasPermission(PERMISSIONS.VIEW_SELLERS);
                  if (sub.title === "Sellers de Risco") return hasPermission(PERMISSIONS.VIEW_RISK_SELLERS);
                  if (sub.title === "Produtos") return hasPermission(PERMISSIONS.VIEW_PRODUCTS);
                  return true;
                });
                if (subItems.length > 0) filtered.push({ ...item, subItems });
              }
            } else if (item.title === "Equipe") {
              if (hasPermission(PERMISSIONS.MANAGE_TEAM)) filtered.push(item);
            } else if (item.title === "Financeiro") {
              if (hasPermission(PERMISSIONS.VIEW_TRANSACTIONS) || hasPermission(PERMISSIONS.APPROVE_WITHDRAWALS)) {
                const subItems = item.subItems.filter((sub: any) => {
                  if (sub.title === "Transações") return hasPermission(PERMISSIONS.VIEW_TRANSACTIONS);
                  if (sub.title === "Aprovar Saques") return hasPermission(PERMISSIONS.APPROVE_WITHDRAWALS);
                  if (sub.title === "Saques Reembolso") return hasPermission(PERMISSIONS.REFUND_WITHDRAWALS);
                  if (sub.title === "MEDs/Disputas") return hasPermission(PERMISSIONS.VIEW_TRANSACTIONS);
                  return true;
                });
                if (subItems.length > 0) filtered.push({ ...item, subItems });
              }
            } else if (item.title === "Configurações") {
              if (hasPermission(PERMISSIONS.MANAGE_CONFIGS) || hasPermission(PERMISSIONS.MANAGE_BANNERS)) {
                const subItems = item.subItems.filter((sub: any) => {
                  if (sub.title === "Banners") return hasPermission(PERMISSIONS.MANAGE_BANNERS);
                  if (sub.title === "Adquirentes") return hasPermission(PERMISSIONS.MANAGE_ACQUIRERS);
                  return hasPermission(PERMISSIONS.MANAGE_CONFIGS);
                });
                if (subItems.length > 0) filtered.push({ ...item, subItems });
              }
            } else if (item.title === "Produtos") {
              if (hasPermission(PERMISSIONS.VIEW_PRODUCTS)) filtered.push(item);
            } else {
              filtered.push(item);
            }
          } else {
            filtered.push(item);
          }
        }

        // ✅ Fallback: se filtro retornar vazio (role fetch falhou), exibe tudo — API protege no servidor
        return filtered.length > 0 ? filtered : adminItems;
      }
      case "seller": {
        // Membro de time: mostrar apenas menus permitidos pelo cargo
        if (isTeamMember && teamRole) {
          const allowed = SELLER_TEAM_ALLOWED_MENUS[teamRole] || [];
          return sellerItems.filter(item => allowed.includes(item.title));
        }
        // Dono da conta: mostrar tudo, mas "Equipe" só se aprovado (KYC)
        if (sellerApprovalStatus !== 'approved') {
          return sellerItems.filter(item => item.title !== 'Equipe');
        }
        return sellerItems;
      }
      case "customer":
        return customerItems;
      default:
        return [];
    }
  };

  const menuItems = getMenuItems();

  // MAPEAR TTULO DO MENU PARA SLUG DE CATEGORIA
  const getCategorySlug = (menuTitle: string): string => {
    const slugMap: Record<string, string> = {
      'Dashboard': 'dashboard',
      'Marketplace': 'marketplace',
      'Meus Produtos': 'produtos',
      'Vendas Digitais': 'vendas-digitais',
      'Assinaturas': 'assinaturas',
      'Financeiro': 'financeiro',
      'Integrações': 'integracoes',
      'Configurações': 'configuracoes',
      'Premiações': 'premiacoes',
      'Suporte': 'suporte'
    };
    return slugMap[menuTitle] || '';
  };

  // VERIFICAR SE CATEGORIA ESTBLOQUEADA
  const isCategoryBlocked = (menuTitle: string): boolean => {
    if (userType !== 'seller') return false;
    const slug = getCategorySlug(menuTitle);
    return blockedCategories.includes(slug);
  };

  // FUNÇÃO PARA ALTERNAR SUBMENU
  const toggleSubmenu = (menuTitle: string) => {
    setExpandedMenus(prev => ({
      ...prev,
      [menuTitle]: !prev[menuTitle]
    }));
  };

  //  VERIFICAR SE ROTA ATUAL ESTNO SUBMENU
  const fullPath = location + search;
  const isSubItemActive = (subItems: any[]) => {
    return subItems.some(item => fullPath === item.href || location === item.href);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      // REDIRECIONAR PARA LANDING PAGE APS LOGOUT
      window.location.href = '/';
    } catch (error) {
      console.error("Erro no logout:", error);
      //  FORCE LOGOUT: Se falhar, redirecionar mesmo assim
      window.location.href = '/';
    }
  };

  return (
    <div 
      className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border" 
      data-testid="sidebar"
      style={{ 
        backgroundColor: globalConfig.backgroundColor === "#ffffff" ? undefined : globalConfig.backgroundColor,
        color: globalConfig.textColor === "#1f2937" ? undefined : globalConfig.textColor 
      }}
    >
      <div className="flex h-16 items-center border-b border-sidebar-border px-6">
        <LogoThemed 
          type="header"
          className="h-auto w-auto max-h-14 max-w-[168px]" 
          data-testid="sidebar-logo"
        />
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-1">
          {/*  MENU ITENS DINMICOS BASEADOS NO TIPO DE USURIO */}
          <TooltipProvider>
            {menuItems.map((item: any) => {
              // VERIFICAR SE CATEGORIA ESPECFICA ESTBLOQUEADA
              const categoryBlocked = isCategoryBlocked(item.title);
              
              // BLOQUEAR APENAS "Produtos" PARA SELLERS NÃO APROVADOS (demais categorias ficam liberadas)
              const isProductsCategory = item.title === "Produtos";
              const isSellerNotApproved = userType === "seller" && sellerApprovalStatus !== 'approved';
              
              const isDisabled = (isProductsCategory && isSellerNotApproved) || categoryBlocked;
              
              // VERIFICAR SE UM ITEM COM SUBMENU
              const hasSubItems = item.subItems && item.subItems.length > 0;
              const isExpanded = expandedMenus[item.title];
              const hasActiveSubItem = hasSubItems && isSubItemActive(item.subItems);

              // RENDERIZAR ITEM BLOQUEADO (sellers não aprovados)
              if (isDisabled) {
                return (
                  <Tooltip key={item.title}>
                    <TooltipTrigger asChild className="w-full">
                      <div className="w-full">
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full justify-start",
                            "opacity-40 cursor-not-allowed",
                            "text-muted-foreground hover:bg-transparent"
                          )}
                          data-testid={`nav-${userType}-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                          disabled={true}
                        >
                          <item.icon className="mr-2 h-4 w-4 opacity-50" />
                          <span className="line-through opacity-60">{item.title}</span>
                          <AlertTriangle className="ml-auto h-4 w-4 text-yellow-500" />
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-semibold">{isProductsCategory && isSellerNotApproved ? 'Verifique sua conta para desbloquear Produtos' : 'Bloqueado pelo admin'}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              }

              // RENDERIZAR ITEM COM SUBMENU
              if (hasSubItems) {
                return (
                  <div key={item.title}>
                    <Button
                      variant={hasActiveSubItem ? "secondary" : "ghost"}
                      className={cn(
                        "w-full justify-start",
                        hasActiveSubItem && "bg-accent text-accent-foreground"
                      )}
                      onClick={() => {
                        if (onNavigate && item.subItems[0]?.href) {
                          navigate(item.subItems[0].href);
                          onNavigate();
                        } else {
                          toggleSubmenu(item.title);
                        }
                      }}
                      data-testid={`nav-${userType}-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <item.icon className="mr-2 h-4 w-4 icon-sophisticated-active" />
                      {item.title}
                      {isExpanded ? (
                        <ChevronDown className="ml-auto h-4 w-4" />
                      ) : (
                        <ChevronRight className="ml-auto h-4 w-4" />
                      )}
                    </Button>
                    
                    {isExpanded && (
                      <div className="ml-4 mt-1 space-y-1">
                        {item.subItems.map((subItem: any) => {
                          const isFinanceiroSubBlocked =
                            item.title === "Financeiro" &&
                            subItem.title === "Financeiro" &&
                            isSellerNotApproved;

                          if (isFinanceiroSubBlocked) {
                            return (
                              <Tooltip key={subItem.href}>
                                <TooltipTrigger asChild className="w-full">
                                  <div className="w-full">
                                    <Button
                                      variant="ghost"
                                      className="w-full justify-start text-sm opacity-40 cursor-not-allowed text-muted-foreground hover:bg-transparent"
                                      disabled={true}
                                    >
                                      <subItem.icon className="mr-2 h-3 w-3 opacity-50" />
                                      <span className="line-through opacity-60">{subItem.title}</span>
                                      <AlertTriangle className="ml-auto h-3 w-3 text-yellow-500" />
                                    </Button>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="font-semibold">Verifique sua conta para desbloquear</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          }

                          return (
                            <Button
                              key={subItem.href}
                              asChild
                              variant={(fullPath === subItem.href || location === subItem.href) ? "secondary" : "ghost"}
                              className={cn(
                                "w-full justify-start text-sm",
                                (fullPath === subItem.href || location === subItem.href) &&
                                  "bg-accent text-accent-foreground"
                              )}
                              data-testid={`nav-${userType}-${subItem.title.toLowerCase().replace(/\s+/g, '-')}`}
                              onClick={onNavigate}
                            >
                              <Link href={subItem.href}>
                                <subItem.icon className="mr-2 h-3 w-3 icon-sophisticated-active" />
                                {subItem.title}
                              </Link>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              if (item.iconOnly) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Button
                        asChild
                        variant={location === item.href ? "secondary" : "ghost"}
                        size="icon"
                        className={cn(
                          location === item.href && "bg-accent text-accent-foreground"
                        )}
                        data-testid={`nav-${userType}-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                        onClick={onNavigate}
                      >
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4 text-violet-500" />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>{item.title}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return (
                <Button
                  key={item.href}
                  asChild
                  variant={location === item.href ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    location === item.href &&
                      "bg-accent text-accent-foreground"
                  )}
                  data-testid={`nav-${userType}-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={onNavigate}
                >
                  <Link href={item.href}>
                    <item.icon className="mr-2 h-4 w-4 icon-sophisticated-active" />
                    {item.title}
                  </Link>
                </Button>
              );
            })}
          </TooltipProvider>
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <div className="flex flex-col gap-1 text-center">
          <Link href="/terms">
            <button className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-400 transition-colors">
              Termos de uso
            </button>
          </Link>
          <Link href="/privacy">
            <button className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-400 transition-colors">
              Política de privacidade
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}