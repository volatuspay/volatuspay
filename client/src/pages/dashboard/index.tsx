import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, Redirect, useLocation } from "wouter";
import { useMemo, useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { isUserSeller } from "@/lib/firestore";
import { 
  CreditCard, 
  ShoppingCart, 
  TrendingUp, 
  Users,
  Plus,
  ArrowUpRight,
  DollarSign,
  BarChart3,
  Clock,
  Filter,
  Smartphone,
  FileText,
  CheckCircle,
  Globe,
  MapPin,
  LayoutDashboard,
  Package,
  RefreshCw,
  Menu,
  CalendarDays,
  Gift,
  Trophy,
  Target,
  Eye,
  EyeOff,
  ArrowRight,
  BadgeDollarSign,
  Receipt,
  Wallet
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { ApprovalBanner } from "@/components/seller/approval-banner";
import AccountVerificationModal from "@/components/seller/account-verification-modal";
import { Seller2FAVerification } from "@/components/Seller2FAVerification";
import { useSeller2FAStore } from "@/stores/seller-2fa";
import { useTenantStore } from "@/stores/tenant";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCheckoutsByTenant, getOrdersByTenant, normalizeTimestamp } from "@/lib/firestore";
import { useToast } from "@/hooks/use-toast";
import { format, startOfDay, startOfHour, eachDayOfInterval, eachHourOfInterval, subDays, isToday, isWithinInterval, isYesterday, isSameDay, isSameHour, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatBRL } from "@/lib/utils";
import React from "react";
import type { Order, Checkout } from "@shared/schema";
import SalesCard from "@/components/dashboard/sales-card";
import BannerDisplay from "@/components/dashboard/banner-display";
import { PromotionalBanner } from "@/components/dashboard/promotional-banner";
import { AdminPremiationCard } from "@/components/dashboard/admin-premiation-card";
import { WithdrawalPremiations } from "@/components/sidebar/withdrawal-premiations";
import { CircularProgress } from "@/components/dashboard/CircularProgress";

// Hook para animação de counting-up nos números
function useCountUp(end: number, duration: number = 1000, delay: number = 0) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let animationFrame: number;
    let startTime: number | null = null;
    let timeoutId: NodeJS.Timeout;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      
      // Easing function (easeOutExpo para suavidade profissional)
      const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      setCount(Math.floor(end * easeOutExpo));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        setCount(end); // Garantir valor final exato
      }
    };

    // Delay antes de iniciar
    timeoutId = setTimeout(() => {
      animationFrame = requestAnimationFrame(animate);
    }, delay);

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [end, duration, delay]);

  return count;
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  // Desconto: FILTRO NICO PARA OS 3 BLOCOS
  const [dateFilter, setDateFilter] = useState("hoje"); //  PADRÃO "HOJE" - Vendas do dia atual
  const [productTypeFilter, setProductTypeFilter] = useState<"all" | "digital" | "subscription">("all"); // Filtro de tipo de produto
  const [userType, setUserType] = useState<"seller" | "customer" | null>(null);
  const [loading, setLoading] = useState(true);
  const [sellerApprovalStatus, setSellerApprovalStatus] = useState<'pending' | 'approved' | 'rejected' | 'not_seller'>('pending');
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [hideRevenueValue, setHideRevenueValue] = useState(false);
  const [hideQuantityValue, setHideQuantityValue] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);

  const { isVerified: verified2FA, setVerified: setVerified2FA, isSessionValid: isSeller2FASessionValid } = useSeller2FAStore();
  
  // ===== HELPERS DE CONVERSÃO DE TIMESTAMP =====
  // Resolve timestamp de order - USA paidAt para vendas pagas, createdAt para pendentes
  const resolveOrderTimestamp = (order: any): Date | null => {
    const now = new Date();
    
    // Vendas pagas usam paidAt para aparecer no gráfico de picos no dia correto
    if (order.status === 'paid' && order.paidAt) {
      const paidDate = normalizeTimestamp(order.paidAt);
      
      //  CRITICAL FIX: Se paidAt for futuro, usar createdAt ao invés
      if (paidDate && paidDate.getTime() > now.getTime()) {
        return normalizeTimestamp(order.createdAt);
      }
      
      return paidDate;
    }
    // Vendas pendentes usam createdAt
    return normalizeTimestamp(order.createdAt);
  };
  
  // Resolve timestamp de venda
  const resolveSaleTimestamp = (sale: any): Date | null => {
    return normalizeTimestamp(sale.paidAt) || normalizeTimestamp(sale.createdAt);
  };
  
  // Helper para calcular ranges de data em BRT (UTC-3)
  const getBRTDateRange = (filter: string, referenceDate: Date = new Date()) => {
    const now = referenceDate;
    
    // Calcular início do dia em BRT (00:00 BRT = 03:00 UTC)
    const getBRTDayStart = (date: Date) => {
      const result = new Date(date);
      result.setUTCHours(3, 0, 0, 0);
      return result;
    };
    
    // Calcular fim do dia em BRT (23:59:59.999 BRT = 02:59:59.999 UTC do próximo dia)
    const getBRTDayEnd = (dayStart: Date) => {
      return new Date(dayStart.getTime() + (24 * 60 * 60 * 1000) - 1);
    };
    
    //  Detectar se estamos antes das 03:00 UTC (meia-noite BRT ainda não passou)
    const currentUTCHour = now.getUTCHours();
    const isBeforeBRTMidnight = currentUTCHour < 3;
    
    switch (filter) {
      case "hoje": {
        const todayStart = getBRTDayStart(isBeforeBRTMidnight ? subDays(now, 1) : now);
        const todayEnd = getBRTDayEnd(todayStart);
        return { start: todayStart, end: todayEnd };
      }
      case "ontem": {
        // Se antes das 03:00 UTC, ontem em BRT = UTC - 2 dias
        const daysToSubtract = isBeforeBRTMidnight ? 2 : 1;
        const yesterdayStart = getBRTDayStart(subDays(now, daysToSubtract));
        const yesterdayEnd = getBRTDayEnd(yesterdayStart);
        return { start: yesterdayStart, end: yesterdayEnd };
      }
      default:
        return { start: startOfDay(now), end: now };
    }
  };
  // ===== FIM DOS HELPERS =====

  const { data: checkouts = [], isLoading: checkoutsLoading } = useQuery<Checkout[]>({
    queryKey: ["checkouts", tenant?.id],
    queryFn: async () => {
      const { auth } = await import('@/lib/firebase');
      const { getBrowserId } = await import('@/lib/browser-session');
      const currentUser = auth.currentUser;
      if (!currentUser || !tenant?.id) return [];
      const token = await currentUser.getIdToken();
      const browserId = getBrowserId();
      const response = await fetch(`/api/checkouts?tenantId=${tenant.id}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': browserId,
        },
      });
      if (!response.ok) throw new Error('Falha ao buscar checkouts');
      const result = await response.json();
      return result.data || [];
    },
    enabled: !loading && Boolean(tenant?.id) && userType === "seller",
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });

  const safeCheckouts = Array.isArray(checkouts) ? checkouts : [];

  // MAPEAMENTO DE CORES POR TIPO DE PRODUTO
  const getProductTypeColor = (productType: string) => {
    switch (productType) {
      case 'pending':
        return '#f97316'; // Laranja - Vendas pendentes/no pagas
      case 'subscription':
        return '#2563eb'; // Verde - Assinaturas/recorrente
      case 'digital':
      default:
        return '#2563eb'; // Verde - Produtos digitais
    }
  };

  //  CRIAR MAPEAMENTO CHECKOUT ID -> PRODUCT TYPE
  const checkoutMap = useMemo(() => {
    const map = new Map();
    safeCheckouts.forEach(checkout => {
      map.set(checkout.id, checkout.productType || 'digital');
    });
    return map;
  }, [checkouts]);

  const { data: orders = [], isLoading: ordersLoading, error: ordersError } = useQuery<Order[]>({
    queryKey: ["orders", tenant?.id],
    queryFn: () => getOrdersByTenant(tenant!.id),
    enabled: !loading && !!tenant && userType === "seller",
    retry: 3,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) return false;
      const hasPendingPix = data.some((order: any) => 
        order?.method === 'pix' && order?.status === 'pending'
      );
      return hasPendingPix ? 10000 : false;
    }
  });
  
  const safeOrders = Array.isArray(orders) ? orders : [];

  // Dashboard data loaded from Firestore
  useEffect(() => {
    // Orders are ready to use
  }, [orders, ordersLoading]);

  const { data: balanceSummary, isLoading: balancesLoading } = useQuery({
    queryKey: ['/api/balance/summary'],
    enabled: !loading && !!tenant && userType === "seller",
    staleTime: 10 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previousData) => previousData,
    refetchInterval: (data) => {
      const hasPendingPix = safeOrders.some((order: any) => 
        order?.method === 'pix' && order?.status === 'pending'
      );
      return hasPendingPix ? 15000 : 60000;
    }
  });

  // ✅ balanceSummary já está no formato correto da API - não precisa adapter
  // Código downstream usa balanceSummary.totals.BRL.available diretamente (linha 2820)


  const { data: subscriptionStats, isLoading: subscriptionStatsLoading } = useQuery({
    queryKey: ['/api/subscriptions/stats', tenant?.id],
    queryFn: async () => {
      const response = await apiRequest(`/api/subscriptions/stats?tenantId=${tenant!.id}`, 'GET');
      return response.json();
    },
    enabled: !loading && !!tenant && userType === "seller",
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });

  const { data: personalSalesData } = useQuery({
    queryKey: ['/api/personal-sales', tenant?.id],
    queryFn: async () => {
      const response = await apiRequest(`/api/personal-sales`, 'GET');
      return response.json();
    },
    enabled: !loading && !!tenant && userType === "seller",
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData: any) => previousData,
  });

  const { data: affiliateStats, isLoading: affiliateStatsLoading } = useQuery({
    queryKey: ['/api/affiliate/dashboard-stats', tenant?.id],
    queryFn: async () => {
      const response = await apiRequest(`/api/affiliate/dashboard-stats?tenantId=${tenant!.id}`, 'GET');
      return response.json();
    },
    enabled: !loading && !!tenant && userType === "seller",
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });

  const { data: myAffiliationsData } = useQuery({
    queryKey: ['/api/affiliations'],
    enabled: !loading && !!user && userType === "seller",
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const hasApprovedAffiliations = ((myAffiliationsData as any)?.affiliations || []).some((a: any) => a.status === 'approved');

  const { data: affiliateOrders = [], isLoading: affiliateOrdersLoading } = useQuery<any[]>({
    queryKey: ['/api/affiliate/my-orders'],
    queryFn: async () => {
      const { auth } = await import('@/lib/firebase');
      const { getBrowserId } = await import('@/lib/browser-session');
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const token = await currentUser.getIdToken();
      const browserId = getBrowserId();
      const response = await fetch('/api/affiliate/my-orders', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-Browser-Id': browserId },
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.data || result.orders || [];
    },
    enabled: !loading && !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const safeAffiliateOrders = Array.isArray(affiliateOrders) ? affiliateOrders : [];

  const { data: affiliateBalance } = useQuery<any>({
    queryKey: ['/api/affiliate/balance'],
    queryFn: async () => {
      const { auth } = await import('@/lib/firebase');
      const { getBrowserId } = await import('@/lib/browser-session');
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      const token = await currentUser.getIdToken();
      const browserId = getBrowserId();
      const response = await fetch('/api/affiliate/balance', {
        headers: { 'Authorization': `Bearer ${token}`, 'X-Browser-Id': browserId },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !loading && !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const getAffCommission = (order: any) => {
    if (typeof order.affiliateCommission === 'number') return order.affiliateCommission;
    return order.affiliateCommission?.amount || 0;
  };

  const parseAffDate = (order: any): Date | null => {
    const field = order.paidAt || order.createdAt;
    if (!field) return null;
    if (field._seconds) return new Date(field._seconds * 1000);
    if (field.toDate) return field.toDate();
    const d = new Date(field);
    return isNaN(d.getTime()) ? null : d;
  };

  const isAffApproved = (status: string) => ['paid', 'approved', 'completed'].includes(status);

  // Desconto: FILTRAR ORDERS POR PERODO SELECIONADO (PARA OS CARDS)
  const getFilteredOrdersByPeriod = () => {
    const now = new Date();
    let start: Date;
    let end: Date = now;

    switch (dateFilter) {
      case "hoje":
      case "ontem": {
        const range = getBRTDateRange(dateFilter, now);
        start = range.start;
        end = range.end;
        break;
      }
      case "7d":
        start = startOfDay(subDays(now, 6));
        end = now;
        break;
      case "15d":
        start = startOfDay(subDays(now, 14));
        end = now;
        break;
      case "30d":
        start = startOfDay(subDays(now, 29));
        end = now;
        break;
      case "60d":
        start = startOfDay(subDays(now, 59));
        end = now;
        break;
      case "90d":
        start = startOfDay(subDays(now, 89));
        end = now;
        break;
      case "total":
      default:
        if (safeOrders.length === 0) {
          start = startOfDay(now);
          end = now;
        } else {
          const oldestOrder = safeOrders.reduce((oldest, order) => {
            const orderDate = normalizeTimestamp(order.createdAt);
            if (!orderDate) return oldest; // Ignorar timestamps inválidos sem colapsar cronologia
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          start = startOfDay(oldestOrder);
          end = now; // Incluir hoje
        }
    }
    
    return safeOrders.filter(order => {
      //  USAR HELPER QUE CENTRALIZA TODA A LÓGICA DE CONVERSÃO
      const orderDate = resolveOrderTimestamp(order);
      
      // Rejeitar orders sem data válida
      if (!orderDate) {
        console.warn('Data inválida ao filtrar order:', order.id);
        return false;
      }
      
      const inRange = orderDate >= start && orderDate <= end;
      
      // Desconto: APLICAR FILTRO DE TIPO DE PRODUTO
      if (productTypeFilter !== "all") {
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        const isSubscription = checkout?.productType === 'subscription' || 
                               order.checkoutSnapshot?.productType === 'subscription' ||
                               checkout?.pricing?.subscriptionPeriod;
        const isDigital = !isSubscription;

        if (productTypeFilter === "subscription" && !isSubscription) return false;
        if (productTypeFilter === "digital" && !isDigital) return false;
      }
      
      return inRange;
    });
  };

  // Desconto: CALCULAR MTRICAS COM BASE NO FILTRO DE PERODO
  const advancedMetrics = useMemo(() => {
    const filteredOrders = getFilteredOrdersByPeriod();
    const paidOrders = filteredOrders.filter(order => order.status === 'paid');
    
    // PIX
    const pixSales = paidOrders.filter(order => order.method === 'pix');
    const pixTotal = pixSales.length;
    const pixRevenue = pixSales.reduce((sum, order) => sum + order.amount, 0);
    
    // Cartão BR (EfBank/local)
    const cardBRSales = paidOrders.filter(order => 
      (order.method === 'card' || order.method === 'credit_card') && 
      order.processor !== 'stripe'
    );
    const cardBRTotal = cardBRSales.length;
    const cardBRRevenue = cardBRSales.reduce((sum, order) => sum + order.amount, 0);
    
    // Cartão Global (Stripe)
    const cardGlobalSales = paidOrders.filter(order => 
      (order.method === 'card' || order.method === 'credit_card') && 
      order.processor === 'stripe'
    );
    const cardGlobalTotal = cardGlobalSales.length;
    const cardGlobalRevenue = cardGlobalSales.reduce((sum, order) => sum + order.amount, 0);
    
    // Boleto
    const boletoSales = paidOrders.filter(order =>
      order.method === 'boleto' || order.method === 'bank_slip' || order.paymentMethod === 'boleto'
    );
    const boletoTotal = boletoSales.length;
    const boletoRevenue = boletoSales.reduce((sum, order) => sum + order.amount, 0);
    
    let affPixTotal = 0, affPixRevenue = 0, affCardTotal = 0, affCardRevenue = 0, affBoletoTotal = 0, affBoletoRevenue = 0;
    if (safeAffiliateOrders.length > 0) {
      const now = new Date();
      let aStart: Date, aEnd: Date = now;
      switch (dateFilter) {
        case "hoje": { const r = getBRTDateRange("hoje", now); aStart = r.start; aEnd = r.end; break; }
        case "ontem": { const r = getBRTDateRange("ontem", now); aStart = r.start; aEnd = r.end; break; }
        case "7d": aStart = startOfDay(subDays(now, 6)); break;
        case "15d": aStart = startOfDay(subDays(now, 14)); break;
        case "30d": aStart = startOfDay(subDays(now, 29)); break;
        case "60d": aStart = startOfDay(subDays(now, 59)); break;
        case "90d": aStart = startOfDay(subDays(now, 89)); break;
        case "total": default: aStart = new Date(0); break;
      }
      const affPaid = safeAffiliateOrders.filter((o: any) => {
        const d = parseAffDate(o);
        return d && d >= aStart && d <= aEnd && isAffApproved(o.status);
      });
      affPaid.forEach((o: any) => {
        const comm = getAffCommission(o);
        const m = o.method || o.paymentMethod || 'pix';
        if (m === 'pix') { affPixTotal++; affPixRevenue += comm; }
        else if (m === 'card') { affCardTotal++; affCardRevenue += comm; }
        else if (m === 'boleto') { affBoletoTotal++; affBoletoRevenue += comm; }
        else { affPixTotal++; affPixRevenue += comm; }
      });
    }

    return {
      pixTotal: pixTotal + affPixTotal,
      pixRevenue: pixRevenue + affPixRevenue,
      cardBRTotal: cardBRTotal + affCardTotal,
      cardBRRevenue: cardBRRevenue + affCardRevenue,
      cardGlobalTotal,
      cardGlobalRevenue,
      boletoTotal: boletoTotal + affBoletoTotal,
      boletoRevenue: boletoRevenue + affBoletoRevenue
    };
  }, [orders, dateFilter, productTypeFilter, checkouts, affiliateOrders]);


  const totalPendingMetrics = useMemo(() => {
    const allPendingOrders = safeOrders.filter((order: Order) => order.status === 'pending');
    
    const pixPendingSales = allPendingOrders.filter((order: Order) => order.method === 'pix');
    let pixPending = pixPendingSales.reduce((sum: number, order: Order) => sum + order.amount, 0);
    
    const cardPendingSales = allPendingOrders.filter((order: Order) => order.method === 'card' || order.method === 'credit_card');
    let cardPending = cardPendingSales.reduce((sum: number, order: Order) => sum + order.amount, 0);
    
    const boletoPendingSales = allPendingOrders.filter((order: Order) => order.method === 'boleto');
    let boletoPending = boletoPendingSales.reduce((sum: number, order: Order) => sum + order.amount, 0);
    
    if (safeAffiliateOrders.length > 0) {
      safeAffiliateOrders.filter((o: any) => o.status === 'pending').forEach((o: any) => {
        const comm = getAffCommission(o);
        const m = o.method || o.paymentMethod || 'pix';
        if (m === 'pix') pixPending += comm;
        else if (m === 'card') cardPending += comm;
        else if (m === 'boleto') boletoPending += comm;
        else pixPending += comm;
      });
    }
    
    return { pixPending, cardPending, boletoPending };
  }, [orders, affiliateOrders]);
  //  CDIGO OTIMIZADO - CARDS DE VENDAS REMOVIDOS

  //  COMBINAR TODAS AS VENDAS REAIS PARA VENDAS RECENTES (LTIMAS 5 REAIS)
  const recentCombinedSales = useMemo(() => {
    //  Vendas de assinatura e digitais (orders) - EXCLUIR MAXTORO
    const orderSales = safeOrders
      .filter(order => {
        // EXCLUIR VENDAS MAXTORO DAS VENDAS RECENTES DIGITAIS
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        const checkoutTitle = checkout?.title || order.checkoutSnapshot?.title || '';
        const isMaxTouro = checkoutTitle.toLowerCase().includes('maxtouro') || 
                           checkoutTitle.toLowerCase().includes('maxtour') ||
                           checkoutTitle.toLowerCase().includes('max tour');
        
        if (isMaxTouro) {
          return false; //  No incluir MaxTouro nas vendas recentes digitais
        }
        
        return true;
      })
      .map(order => {
        // Desconto: DETECTAR PRODUTOS FSICOS REAIS
        const isPaid = order.status === 'paid';
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        
        //  PRIMEIRO: Verificar se é ASSINATURA (prioridade máxima)
        const isSubscriptionProduct = checkout?.productType === 'subscription' || 
                                     order.checkoutSnapshot?.productType === 'subscription' ||
                                     checkout?.pricing?.subscriptionPeriod;
        
        // CLASSIFICAÇÃO FINAL: assinatura subscription, restante digital
        const finalProductType = isSubscriptionProduct ? 'subscription' : 'digital';
        
        if (isSubscriptionProduct) {
          console.log(` DETECTADO PRODUTO ASSINATURA: ${order.customer?.name} - ${checkout?.title || order.checkoutSnapshot?.title} Tipo: subscription`);
        }
        
        return {
          ...order,
          type: 'order',
          productType: finalProductType,
          createdAt: normalizeTimestamp(order.createdAt) || new Date(),
        };
      });
    
    //  COMBINAR E LIMITAR A 5 VENDAS MAIS RECENTES
    const allSales = [...orderSales]
      .filter(sale => sale.status === 'paid' || sale.status === 'completed') // Apenas vendas confirmadas
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5); // Máximo 5 vendas recentes
    
    return allSales;
  }, [orders, checkoutMap]);

  // CATEGORIZAÇÃO REAL: VENDAS NICAS vs ASSINATURAS - TODOS OS HOOKS DEVEM VIR ANTES DOS RETURNS CONDICIONAIS  
  const categorizedSales = useMemo(() => {
    //  PROTEÇÃO: Garantir que orders é array
    if (!safeOrders.length) return {
      oneTime: { total: 0, paid: 0, revenue: 0 },
      subscription: { total: 0, paid: 0, revenue: 0 },
      combined: { total: 0, paid: 0, revenue: 0 }
    };

    // Desconto: USAR FILTROS DE DATA - REUTILIZAR FUNÇÃO getFilteredOrdersForCards
    const now = new Date();
    
    // 🌎 FIX TIMEZONE: Brasil é UTC-3 (sem horário de verão desde 2019)
    const brazilOffsetMs = -3 * 60 * 60 * 1000;
    
    let start: Date, end: Date;
    
    switch (dateFilter) {
      case "hoje":
      case "ontem": {
        const range = getBRTDateRange(dateFilter, now);
        start = range.start;
        end = range.end;
        break;
      }
      case "7d":
        //  LTIMOS 7 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 6));
        end = now;
        break;
      case "15d":
        //  LTIMOS 15 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 14));
        end = now;
        break;
      case "30d":
        //  LTIMOS 30 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 29));
        end = now;
        break;
      case "60d":
        //  LTIMOS 60 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 59));
        end = now;
        break;
      case "90d":
        //  LTIMOS 90 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 89));
        end = now;
        break;
      case "total":
      default:
        //  TOTAL = DESDE PRIMEIRA VENDA ATAGORA (incluindo hoje)
        if (safeOrders.length === 0) {
          start = startOfDay(now);
          end = now;
        } else {
          const oldestOrder = safeOrders.reduce((oldest, order) => {
            const orderDate = normalizeTimestamp(order.createdAt);
            if (!orderDate) return oldest; // Ignorar timestamps inválidos sem colapsar cronologia
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          start = startOfDay(oldestOrder);
          end = now; // Até agora (inclui hoje)
        }
        break;
    }
    
    //  SEMPRE FILTRAR - USAR PAIDT + EXCLUIR VENDAS FSICAS
    const filteredOrdersForCategory = safeOrders.filter(order => {
      //  USAR PAIDT QUANDO DISPONVEL, SENÃO CREATEDAT
      const orderDate = normalizeTimestamp(order.paidAt) || normalizeTimestamp(order.createdAt);
      
      //  VERIFICAR SE ESTNO PERODO (proteção contra null)
      if (!orderDate) return false;
      const inPeriod = orderDate >= start && orderDate <= end;
      if (!inPeriod) return false;
      
      //  DETECTAR VENDAS FSICAS (MaxTouro) PARA EXCLUSÃO DOS CARDS DIGITAIS
      const checkoutProductType = checkoutMap.get(order.checkoutId);
      const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
      const checkoutTitle = checkout?.title || order.checkoutSnapshot?.title || '';
      const isMaxTouro = checkoutTitle.toLowerCase().includes('maxtouro') || 
                         checkoutTitle.toLowerCase().includes('maxtour') ||
                         checkoutTitle.toLowerCase().includes('max tour');
      
      if (isMaxTouro) {
        return false;
      }
      
      return true;
    });
    
    // Desconto: LGICA CORRIGIDA: DETECTAR TIPO CORRETO BASEADO NO CHECKOUT
    const getSmartBillingType = (order: any) => {
      // Obter dados do checkout via checkoutMap
      const productType = checkoutMap.get(order.checkoutId) || 'digital';
      
      // Verificar se é MaxTouro ou produto físico (sempre físico)
      const checkoutTitle = order.checkoutSnapshot?.title || order.productName || '';
      const isMaxTouro = checkoutTitle.toLowerCase().includes('maxtour') || 
                        checkoutTitle.toLowerCase().includes('max tour') ||
                        checkoutTitle.toLowerCase().includes('maxtouro') ||
                        checkoutTitle.toLowerCase().includes('fsic');
      
      // 1. MaxTouro = ONE_TIME
      if (isMaxTouro) {
        console.log(`MAXTURO DETECTADO: ${checkoutTitle}`);
        return 'one_time';
      }
      
      // 2.  PRODUTOS COM SUBSCRIPTION PERIOD = SUBSCRIPTION
      if (order.checkoutSnapshot?.pricing?.billingType === 'subscription' || 
          order.checkoutSnapshot?.pricing?.subscriptionPeriod) return 'subscription';
      
      // 3. DEMAIS VENDAS = DIGITAL ONE_TIME
      return 'one_time';
    };

    //  VENDAS NICAS (one_time payment) - LGICA INTELIGENTE
    const oneTimeSales = filteredOrdersForCategory.filter(order => {
      return getSmartBillingType(order) === 'one_time';
    });
    const oneTimePaid = oneTimeSales.filter(order => order.status === 'paid');
    const oneTimeRevenue = oneTimePaid.reduce((sum, order) => sum + order.amount, 0);
    
    //  DEBUG REMOVIDO - Sistema funcional
    
    //  VENDAS DE ASSINATURA (subscription) - LGICA INTELIGENTE  
    const subscriptionSales = filteredOrdersForCategory.filter(order => {
      return getSmartBillingType(order) === 'subscription';
    });
    const subscriptionPaid = subscriptionSales.filter(order => order.status === 'paid');
    const subscriptionRevenue = subscriptionPaid.reduce((sum, order) => sum + order.amount, 0);
    
    return {
      oneTime: {
        total: oneTimeSales.length,
        paid: oneTimePaid.length,
        revenue: oneTimeRevenue
      },
      subscription: {
        total: subscriptionSales.length,
        paid: subscriptionPaid.length,
        revenue: subscriptionRevenue
      },
      combined: {
        total: oneTimeSales.length + subscriptionSales.length,
        paid: oneTimePaid.length + subscriptionPaid.length,
        revenue: oneTimeRevenue + subscriptionRevenue
      }
    };
  }, [orders, dateFilter, checkoutMap, checkouts]);

  // Gerar dados do grfico de vendas - INCLUIR VENDAS FSICAS MAXTORO
  const salesChartData = useMemo(() => {
    if (!safeOrders.length) return { dailyData: [], hourlyData: [], peakHours: [] };

    const now = new Date();
    
    //  CORREÇÃO TOTAL DA LGICA DE FILTROS DE DATA
    const getDateRange = () => {
      switch (dateFilter) {
        case "hoje": {
          const range = getBRTDateRange("hoje", now);
          return { 
            start: range.start, 
            end: range.end,
            label: "Hoje"
          };
        }
        case "ontem": {
          const range = getBRTDateRange("ontem", now);
          return { 
            start: range.start, 
            end: range.end,
            label: "Ontem"
          };
        }
        case "7d":
          //  CORRIGIDO: LTIMOS 7 DIAS INCLUINDO HOJE
          return { 
            start: startOfDay(subDays(now, 6)), // Últimos 7 dias incluindo hoje
            end: now, //  ATAGORA (incluindo hoje)
            label: "Últimos 7 dias"
          };
        case "15d":
          //  CORRIGIDO: LTIMOS 15 DIAS INCLUINDO HOJE
          return { 
            start: startOfDay(subDays(now, 14)), // Últimos 15 dias incluindo hoje
            end: now, //  ATAGORA (incluindo hoje)
            label: "Últimos 15 dias"
          };
        case "30d":
          //  CORRIGIDO: LTIMOS 30 DIAS INCLUINDO HOJE
          return { 
            start: startOfDay(subDays(now, 29)), // Últimos 30 dias incluindo hoje
            end: now, //  ATAGORA (incluindo hoje)
            label: "Últimos 30 dias"
          };
        case "60d":
          //  CORRIGIDO: LTIMOS 60 DIAS INCLUINDO HOJE
          return { 
            start: startOfDay(subDays(now, 59)), // Últimos 60 dias incluindo hoje
            end: now, //  ATAGORA (incluindo hoje)
            label: "Últimos 60 dias"
          };
        case "90d":
          //  CORRIGIDO: LTIMOS 90 DIAS INCLUINDO HOJE
          return { 
            start: startOfDay(subDays(now, 89)), // Últimos 90 dias incluindo hoje
            end: now, //  ATAGORA (incluindo hoje)
            label: "Últimos 90 dias"
          };
        case "total":
          //  TOTAL - desde primeira venda até agora (INCLUINDO hoje)
          if (safeOrders.length === 0) {
            return { start: startOfDay(now), end: now, label: "Total" };
          }
          const oldestOrder = safeOrders.reduce((oldest, order) => {
            const orderDate = normalizeTimestamp(order.createdAt);
            if (!orderDate) return oldest;
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          return { 
            start: startOfDay(oldestOrder), 
            end: now, // Até agora (incluindo hoje)
            label: "Total"
          };
        default:
          //  CORRIGIDO: INCLUIR VENDAS DE HOJE nos filtros de período
          return { 
            start: startOfDay(subDays(now, 7)), 
            end: now, //  ATAGORA (incluindo hoje)
            label: "Últimos 7 dias"
          };
      }
    };

    const { start, end, label } = getDateRange();
    
    //  FILTRAR VENDAS APENAS NO PERODO SELECIONADO - SEMPRE USAR PAIDAT PARA VENDAS PAGAS
    const filteredOrders = safeOrders.filter(order => {
      const orderDate = resolveOrderTimestamp(order);
      
      if (!orderDate) {
        console.warn('Data inválida para order:', order.id);
        return false;
      }
      
      const isInRange = orderDate >= start && orderDate <= end;
      
      //  DEBUG ESPECIAL para filtros PROBLEMAS - MOSTRAR TODAS AS VENDAS
      if (["7d", "15d", "30d", "60d", "90d"].includes(dateFilter)) {
        console.log(`FILTRO ${dateFilter.toUpperCase()} - ${order.customer?.name}:`, {
          orderId: order.id,
          customer: order.customer?.name,
          status: order.status,
          amount: `R$${(order.amount / 100).toFixed(0)}`,
          orderDate: orderDate.toLocaleString('pt-BR'),
          startRange: start.toLocaleString('pt-BR'),
          endRange: end.toLocaleString('pt-BR'),
          passou: isInRange,
          checkoutId: order.checkoutId,
          orderDateISO: orderDate.toISOString(),
          startISO: start.toISOString(),
          endISO: end.toISOString()
        });
      }
      
      //  DEBUG ESPECIAL para filtro HOJE - MOSTRAR TODAS AS VENDAS
      if (dateFilter === "hoje") {
        console.log(`FILTRO HOJE - ${order.customer?.name}:`, {
          orderId: order.id,
          customer: order.customer?.name,
          status: order.status,
          amount: `R$${(order.amount / 100).toFixed(0)}`,
          orderDate: orderDate.toLocaleString('pt-BR'),
          startRange: start.toLocaleString('pt-BR'),
          endRange: end.toLocaleString('pt-BR'),
          passou: isInRange,
          checkoutId: order.checkoutId
        });
      }
      
      return isInRange;
    });
    
    console.log(`Desconto: ${dateFilter.toUpperCase()}: ${filteredOrders.filter(o => o.status === 'paid').length} vendas digitais pagas encontradas`);
    console.log(` Vendas:`, filteredOrders.filter(o => o.status === 'paid').map(o => 
      `${o.customer?.name} (${o.status}) - R$${(o.amount / 100).toFixed(0)}`
    ));

    //  DEBUG ESPECFICO PARA VENDAS DE HOJE (3 vendas pagas esperadas)
    if (dateFilter === 'hoje') {
      const vendasHoje = filteredOrders.filter(o => o.status === 'paid');
      console.log(` VENDAS HOJE DETALHADAS:`, vendasHoje.map(o => ({
        id: o.id,
        customer: o.customer?.name,
        amount: `R$${(o.amount / 100).toFixed(0)}`,
        paidAt: o.paidAt,
        checkoutId: o.checkoutId,
        checkoutType: checkoutMap.get(o.checkoutId) || 'digital'
      })));
      
      console.log(` RANGE HOJE:`, {
        start: start.toISOString(),
        end: end.toISOString(),
        agora: now.toISOString()
      });
      
    }

    const filteredPhysicalSales: any[] = [];

    //  GERAR RANGE DE DIAS BASEADO NAS VENDAS REAIS DO FIREBASE
    const getRealSalesDays = () => {
      // Combinar todas as vendas (orders + physical) com suas datas reais - COM VALIDAÇÃO
      const allSalesWithDates = [
        ...filteredOrders.map((order: any) => {
          const saleDate = resolveOrderTimestamp(order) || new Date();
              //  DETECÇÃO UNIFICADA DE TIPO - NICA FONTE DE VERDADE
          const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
          const checkoutTitle = order.checkoutSnapshot?.title || checkout?.title || (order as any).productName || '';
          const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
          
          //  LGICA NICA DE CATEGORIZAÇÃO (SINCRONIZADA)
          let salesType = 'digital'; // Default
          
          // 1ASSINATURAS: Verificar primeiro se é assinatura
          const hasSubscriptionPeriod = checkout?.pricing?.subscriptionPeriod;
          const isSubscriptionType = checkoutType === 'subscription' || 
                                   order.checkoutSnapshot?.productType === 'subscription' ||
                                   checkout?.productType === 'subscription' ||
                                   hasSubscriptionPeriod;
          
          if (isSubscriptionType) {
            salesType = 'subscription';
          }
          // DIGITAL: Tudo que não é assinatura
          
          return {
            date: saleDate,
            amount: order.amount,
            type: salesType,
            status: order.status, //  INCLUIR STATUS PARA DEBUG
            customer: order.customer?.name,
            orderId: order.id
          };
        }),
      ];
      
      if (allSalesWithDates.length === 0) {
        return [now]; // Se no hvendas, mostrar hoje
      }
      
      // Agrupar vendas por dia e pegar os dias que realmente tiveram vendas
      const salesByDay = new Map();
      allSalesWithDates.forEach(sale => {
        const dayKey = format(sale.date, 'yyyy-MM-dd');
        if (!salesByDay.has(dayKey)) {
          salesByDay.set(dayKey, []);
        }
        salesByDay.get(dayKey).push(sale);
      });
      
      // Pegar os dias nicos e ordenar
      const realSalesDays = Array.from(salesByDay.keys())
        .map(dayKey => new Date(dayKey))
        .sort((a, b) => a.getTime() - b.getTime());
      
      // Limitar baseado no filtro
      switch (dateFilter) {
        case "hoje":
          return realSalesDays.filter(day => isToday(day)).slice(0, 1);
        case "ontem": 
          return realSalesDays.filter(day => isYesterday(day)).slice(0, 1);
        case "7d":
          return realSalesDays.filter(day => isWithinInterval(day, { start: subDays(now, 6), end: now })).slice(-7);
        case "15d":
          return realSalesDays.filter(day => isWithinInterval(day, { start: subDays(now, 14), end: now })).slice(-15);
        case "30d":
          return realSalesDays.filter(day => isWithinInterval(day, { start: subDays(now, 29), end: now })).slice(-30);
        case "60d":
          return realSalesDays.filter(day => isWithinInterval(day, { start: subDays(now, 59), end: now })).slice(-60);
        case "90d":
          return realSalesDays.filter(day => isWithinInterval(day, { start: subDays(now, 89), end: now })).slice(-90);
        case "total":
          return realSalesDays; // Todos os dias com vendas
        default:
          return realSalesDays.slice(-7); // Últimos 7 dias com vendas
      }
    };
    
    const chartDayRange = getRealSalesDays();

    //  RANGE DE HORAS BASEADO NAS VENDAS REAIS
    const getRealSalesHours = () => {
      // Para filtros de hoje/ontem, mostrar todas as 24 horas do dia relevante
      const targetDay = dateFilter === "ontem" ? subDays(now, 1) : now;
      const startOfTargetDay = startOfDay(targetDay);
      
      // Desconto: APENAS "HOJE" USA INTERVALOS DE HORA
      if (dateFilter === "hoje") {
        // Mostrar 24 horas completas (00:00-23:00) para hoje
        return eachHourOfInterval({ start: startOfTargetDay, end: new Date(startOfTargetDay.getTime() + 23 * 60 * 60 * 1000) });
      }
      
      // Desconto: OUTROS FILTROS (ONTEM, 7D, 30D, ETC) USAM INTERVALOS DE DIAS
      // Retornar os dias do chartDayRange
      return chartDayRange;
    };
    
    const hourlyRange = getRealSalesHours();

    // DADOS DIRIOS REAIS - APENAS DIAS COM VENDAS
    const dailyData = chartDayRange.map((day, dayIndex) => {
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      
      //  USAR VENDAS FILTRADAS PELO PERODO SELECIONADO - SEMPRE PAIDT (COM PROTEÇÃO)
      const dayOrders = filteredOrders.filter(order => {
        try {
          let orderDate;
          orderDate = normalizeTimestamp(order.paidAt) || normalizeTimestamp(order.createdAt) || new Date();
          
          if (isNaN(orderDate.getTime())) {
            console.warn('Data inválida para order no grfico:', order.id);
            return false;
          }
          
          return orderDate >= dayStart && orderDate <= dayEnd;
        } catch (e) {
          console.warn('Erro ao processar data da order no grfico:', order.id, e);
          return false;
        }
      });

      const paidOrders = dayOrders.filter(order => order.status === 'paid');
      
      // 100% DADOS REAIS - SEM MULTIPLICAÇÃO OU MOCK DATA
      const totalSales = paidOrders.length;
      const revenue = paidOrders.reduce((sum, order) => sum + order.amount, 0);

      const finalDailySales = totalSales;

      // Desconto: CLASSIFICAR VENDAS POR TIPO PARA VISUALIZAÇÃO
      const subscriptionCount = paidOrders.filter(order => {
        const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
        if (checkoutType === 'subscription') return true;
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        return checkout?.pricing?.subscriptionPeriod ? true : false;
      }).length;
      const digitalCount = paidOrders.filter(order => {
        const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
        return checkoutType === 'digital' && !checkoutType.includes('subscription');
      }).length;

      return {
        date: format(day, 'dd/MM', { locale: ptBR }),
        fullDate: format(day, 'dd/MM/yyyy', { locale: ptBR }),
        sales: finalDailySales,
        paidSales: finalDailySales,
        revenue: revenue / 100,
        isToday: isToday(day),
        orders: dayOrders,
        // SEPARAÇÃO POR TIPO
        physicalSales: 0,
        subscriptionSales: subscriptionCount,
        digitalSales: digitalCount,
        //  DETALHE DAS VENDAS REAIS
        realSalesDetails: [
          ...paidOrders.map(order => {
            try {
              let orderDate;
              if (order.paidAt) {
                //  CONVERTER FIRESTORE TIMESTAMP CORRETAMENTE
                if (typeof order.paidAt === 'object' && (order.paidAt as any).seconds) {
                  // Firestore Timestamp object
                  orderDate = new Date((order.paidAt as any).seconds * 1000 + ((order.paidAt as any).nanoseconds || 0) / 1000000);
                } else {
                  // String ou Date object normal
                  orderDate = new Date(order.paidAt);
                }
              } else {
                orderDate = normalizeTimestamp(order.createdAt) || new Date();
              }
              
              const timeStr = isNaN(orderDate.getTime()) ? '00:00' : format(orderDate, 'HH:mm');
              
              //  DETECTAR TIPO CORRETO DA VENDA DIRIA
              const salesType = 'digital';
              
              return {
                id: order.id,
                customer: order.customer?.name,
                amount: order.amount / 100,
                time: timeStr,
                type: salesType
              };
            } catch (e) {
              console.warn('Erro ao formatar data da order diria:', order.id, e);
              return {
                id: order.id,
                customer: order.customer?.name,
                amount: order.amount / 100,
                time: '00:00',
                type: 'digital'
              };
            }
          }),
        ]
      };
    }).filter(day => day.sales > 0); //  REMOVER DIAS SEM VENDAS

    //  DADOS POR HORA REAIS - APENAS PARA FILTRO "HOJE"
    const hourlyData = (dateFilter === "hoje" ? hourlyRange : []).map((hour, index) => {
        //  FIX: GARANTIR QUE HORA COMECE EXATAMENTE NO MINUTO :00
        const hourStart = startOfHour(hour);
        const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000 - 1);
        
        //  USAR HELPER CENTRALIZADO
        const hourOrders = filteredOrders.filter(order => {
          const orderDate = resolveOrderTimestamp(order);
          
          if (!orderDate) {
            console.warn('Data inválida para hour order:', order.id);
            return false;
          }
          
          return orderDate >= hourStart && orderDate <= hourEnd;
        });

      const paidOrders = hourOrders.filter(order => order.status === 'paid');
      const pendingOrders = hourOrders.filter(order => order.status === 'pending');
      
      //  SEPARAR VENDAS PAGAS vs PENDENTES (CRÍTICO PARA GRÁFICO!)
      const totalPaidSales = paidOrders.length;
      const totalPendingSales = pendingOrders.length;
      const totalSales = totalPaidSales + totalPendingSales;
      
      const revenue = paidOrders.reduce((sum, order) => sum + order.amount, 0);

      const finalSales = totalSales;
      const finalPaidSales = totalPaidSales; //  VENDAS PAGAS SEPARADAS!
      const finalPendingSales = totalPendingSales; //  VENDAS PENDENTES SEPARADAS!

      const subscriptionCount = paidOrders.filter(order => {
        const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
        if (checkoutType === 'subscription') return true;
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        return checkout?.pricing?.subscriptionPeriod ? true : false;
      }).length;
      const digitalCount = paidOrders.filter(order => {
        const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
        return checkoutType === 'digital' && !checkoutType.includes('subscription');
      }).length;

      return {
        hour: isNaN(hour.getTime()) ? '00:00' : format(hour, 'HH:mm'),
        fullHour: isNaN(hour.getTime()) ? '00:00' : format(hour, 'HH:mm', { locale: ptBR }),
        sales: finalSales, //  TOTAL (pagas + pendentes)
        paidSales: finalPaidSales, //  APENAS PAGAS (para barra roxa)
        pendingSales: finalPendingSales, //  APENAS PENDENTES (para barra laranja)
        revenue: revenue / 100,
        physicalSales: 0,
        subscriptionSales: subscriptionCount,
        digitalSales: digitalCount,
        //  DETALHE DAS VENDAS REAIS DA HORA (COM PROTEÇÃO FIRESTORE)
        realSalesDetails: [
          ...paidOrders.map(order => {
            try {
              let orderDate;
              if (order.paidAt) {
                //  CONVERTER FIRESTORE TIMESTAMP CORRETAMENTE
                if (typeof order.paidAt === 'object' && (order.paidAt as any).seconds) {
                  // Firestore Timestamp object
                  orderDate = new Date((order.paidAt as any).seconds * 1000 + ((order.paidAt as any).nanoseconds || 0) / 1000000);
                } else {
                  // String ou Date object normal
                  orderDate = new Date(order.paidAt);
                }
              } else {
                orderDate = normalizeTimestamp(order.createdAt) || new Date();
              }
              
              const timeStr = isNaN(orderDate.getTime()) ? '00:00' : format(orderDate, 'HH:mm');
              
              //  DETECTAR TIPO CORRETO DA VENDA DIRIA
              const productType = checkoutMap.get(order.checkoutId) || 'digital';
              const checkoutTitle = order.checkoutSnapshot?.title || (order as any).productName || '';
              const isMaxTouro = checkoutTitle.toLowerCase().includes('maxtour') || 
                                checkoutTitle.toLowerCase().includes('max tour') ||
                                checkoutTitle.toLowerCase().includes('fsic');
              
              const salesType = 'digital';
              
              return {
                id: order.id,
                customer: order.customer?.name || 'Cliente',
                amount: order.amount / 100,
                time: timeStr,
                type: salesType
              };
            } catch (e) {
              console.warn('Erro ao formatar data da hour order:', order.id, e);
              return {
                id: order.id,
                customer: order.customer?.name || 'Cliente',
                amount: order.amount / 100,
                time: '00:00',
                type: 'digital'
              };
            }
          })
        ]
      };
    }); //  MANTER TODAS AS 24 HORAS PARA PADRONIZAÇÃO

    //  PERODOS FIXOS DE PICO - 3 CARDS ESTTICOS
    const fixedPeakPeriods = [
      {
        period: "6:00 - 12:00",
        label: "Manh",
        startHour: 6,
        endHour: 12,
        color: "violet"
      },
      {
        period: "12:00 - 17:00", 
        label: "Tarde",
        startHour: 12,
        endHour: 17,
        color: "blue"
      },
      {
        period: "17:00 - 6:00",
        label: "Noite/Madrugada", 
        startHour: 17,
        endHour: 30, // 30 = next day 6AM (17-24 + 0-6)
        color: "gray"
      }
    ];

    // PICOS POR HORA - APENAS SE HVENDAS NO PERODO FILTRADO
    const peakHours = filteredOrders.length > 0 ? 
      fixedPeakPeriods.map(period => {
        // Filtrar vendas do período selecionado pelo usuário
        const periodOrders = filteredOrders.filter(order => {
          const orderDate = resolveOrderTimestamp(order);
          
          if (!orderDate) {
            console.warn('Data inválida para period order:', order.id);
            return false;
          }
          
          const hour = orderDate.getHours();
          
          // Período noite/madrugada (17h-6h) - lgica especial
          if (period.startHour === 17) {
            return hour >= 17 || hour < 6;
          }
          // Perodos normais (manhe tarde)
          return hour >= period.startHour && hour < period.endHour;
        });
      
      const paidOrders = periodOrders.filter(order => order.status === 'paid');
      
      const revenue = paidOrders.reduce((sum, order) => sum + order.amount, 0);
      
      // SEPARAR VENDAS POR TIPO DE PRODUTO PARA EXIBIÇÃO
      const salesByType = {
        subscription: paidOrders.filter(order => {
          const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
          const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
          
          if (checkoutType === 'subscription') return true;
          
          // Verificar se produto digital tem subscriptionPeriod
          return checkout?.pricing?.subscriptionPeriod ? true : false;
        }).length,
        digital: paidOrders.filter(order => {
          const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
          const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
          
          if (checkoutType !== 'digital') return false;
          
          // digital apenas se não tem subscriptionPeriod
          return !checkout?.pricing?.subscriptionPeriod;
        }).length
      };
      
      return {
        hour: period.period,
        fullHour: period.period,
        label: period.label,
        sales: periodOrders.length,
        paidSales: paidOrders.length,
        revenue: revenue / 100,
        color: period.color,
        // DADOS POR TIPO DE PRODUTO PARA OS CARDS
        physicalSales: 0,
        subscriptionSales: salesByType.subscription,
        digitalSales: salesByType.digital,
        orders: [
          ...periodOrders.map(o => {
            const checkoutType = checkoutMap.get(o.checkoutId) || 'digital';
            const checkout = safeCheckouts.find(c => c.id === o.checkoutId);
            const hasSubscriptionPeriod = checkout?.pricing?.subscriptionPeriod;
            
            let smartType = 'digital';
            if (checkoutType === 'subscription' || hasSubscriptionPeriod) {
              smartType = 'subscription';
            }
            
            const isPending = o.status === 'pending';
            const saleType = isPending ? 'pending' : smartType;
            
            return {
              name: o.customer?.name,
              product: (o as any).checkoutSnapshot?.title || `${(o.method || 'pix').toUpperCase()} - ${smartType === 'subscription' ? 'Assinatura' : 'Produto Digital'}`,
              amount: o.amount / 100,
              type: saleType
            };
          })
        ]
      };
    }) : []; //  VAZIO se no hvendas no período

    return { 
      dailyData, 
      hourlyData, // SEMPRE MOSTRAR OS 2 BLOCOS INDEPENDENTE DO FILTRO
      peakHours 
    };
  }, [orders, dateFilter, checkoutMap]);

  // Desconto: FUNÇÃO PARA GERAR DADOS DE GRFICO POR TIPO ESPECFICO - 100% REAL
  const generateChartDataByType = useCallback((productType: string, selectedFilter: string) => {
    //  SEMPRE MOSTRAR TIMELINE COMPLETA - MESMO SEM VENDAS (PADRONIZAÇÃO TOTAL)

    const now = new Date();
    
    // Processando filtro para produto tipo: ${productType.toUpperCase()}
    
    //  APLICAR FILTRO DE DATA ESPECFICO PARA CADA ABA
    const getDateRangeForType = () => {
      switch (selectedFilter) {
        case "hoje":
        case "ontem": {
          const range = getBRTDateRange(selectedFilter, now);
          return { start: range.start, end: range.end };
        }
        case "7d":
          //  LTIMOS 7 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf7d = endOfDay(subDays(now, 2)); // Fim de anteontem (no incluir ontem)
          return { start: startOfDay(subDays(now, 8)), end: endOf7d }; // De 8 dias atrs até anteontem
        case "15d":
          //  LTIMOS 15 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf15d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { start: startOfDay(subDays(now, 16)), end: endOf15d }; // De 16 dias atrs até anteontem
        case "30d":
          //  LTIMOS 30 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf30d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { start: startOfDay(subDays(now, 31)), end: endOf30d }; // De 31 dias atrs até anteontem
        case "60d":
          //  LTIMOS 60 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf60d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { start: startOfDay(subDays(now, 61)), end: endOf60d }; // De 61 dias atrs até anteontem
        case "90d":
          //  LTIMOS 90 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf90d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { start: startOfDay(subDays(now, 91)), end: endOf90d }; // De 91 dias atrs até anteontem
        case "total":
        default:
          //  TOTAL REAL - desde primeira venda até agora
          if (safeOrders.length === 0) {
            return { start: startOfDay(now), end: now };
          }
          const oldestOrderReal = safeOrders.reduce((oldest, order) => {
            const orderDate = normalizeTimestamp(order.createdAt);
            if (!orderDate) return oldest; // Ignorar timestamps inválidos sem colapsar cronologia
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          return { start: startOfDay(oldestOrderReal), end: now }; //  DESDE PRIMEIRA VENDA ATAGORA
      }
    };
    
    const { start, end } = getDateRangeForType();
    // Range de data aplicado para filtro selecionado
    
    //  FILTRAR ORDERS ORIGINAIS DIRETAMENTE POR DATA
    const dateFilteredOrders = safeOrders.filter(order => {
      //  CORRIGIR PROBLEMA DE DATAS INVLIDAS NO FIREBASE
      let orderDate;
      
      //  SEMPRE USAR CREATEDAT PARA CONSISTNCIA NOS FILTROS
      try {
        orderDate = normalizeTimestamp(order.createdAt) || new Date();
      } catch (error) {
        console.warn('Erro ao processar data da ordem:', order.id, error);
        orderDate = new Date(); // fallback para agora se der erro
      }
      
      const passou = orderDate >= start && orderDate <= end;
      
      // Log para todas as assinaturas, no apenas DadosFy
      if (productType === 'subscription') {
        console.log(`FILTRO DATA - ${order.customer?.name}:`, {
          orderId: order.id,
          customer: order.customer?.name,
          checkoutId: order.checkoutId,
          orderDate: orderDate.toLocaleString('pt-BR'),
          paidAtOriginal: order.paidAt,
          createdAt: order.createdAt,
          start: start.toLocaleString('pt-BR'),
          end: end.toLocaleString('pt-BR'),
          passou,
          filtro: selectedFilter
        });
      }
      
      return passou;
    });
    
    // Filtrar vendas apenas do tipo especfico
    let typeOrders: Order[] = [];
    
    //  USAR VENDAS FILTRADAS POR DATA
    typeOrders = dateFilteredOrders.filter(order => {
      const checkoutType = checkoutMap.get(order.checkoutId) || 'digital';
      
      if (productType === 'subscription') {
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        const hasSubscriptionPeriod = checkout?.pricing?.subscriptionPeriod;
        const orderProductType = (order as any).productType || checkoutType;
        const isSubscription = orderProductType === 'subscription' || hasSubscriptionPeriod === 'monthly' || hasSubscriptionPeriod === 'quarterly' || hasSubscriptionPeriod === 'annual' || hasSubscriptionPeriod === 'semiannual';
        return isSubscription;
      }
      
      if (productType === 'digital') {
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        const hasSubscriptionPeriod = checkout?.pricing?.subscriptionPeriod;
        const orderProductType = (order as any).productType || checkoutType;
        const isDigitalContent = orderProductType === 'digital' || (!hasSubscriptionPeriod && orderProductType !== 'subscription');
        return isDigitalContent;
      }
      
      return checkoutType === productType;
    });

    //  SEM VALIDAÇÃO RESTRITIVA - Cada aba processa seus prprios dados independentemente

    //  SEMPRE GERAR ESTRUTURA BASE MESMO SEM DADOS DO TIPO
    // Para garantir que grficos sempre renderizem corretamente

    // Desconto: RANGE CORRETO BASEADO NO FILTRO SELECIONADO
    const getDateRangeForChart = () => {
      switch (selectedFilter) {
        case "hoje":
        case "ontem": {
          const range = getBRTDateRange(selectedFilter, now);
          return { chartStart: range.start, chartEnd: range.end, chartDays: 1 };
        }
        case "7d":
          //  LTIMOS 7 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf7d = endOfDay(subDays(now, 2)); // Fim de anteontem (no incluir ontem)
          return { chartStart: startOfDay(subDays(now, 8)), chartEnd: endOf7d, chartDays: 7 };
        case "15d":
          //  LTIMOS 15 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf15d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { chartStart: startOfDay(subDays(now, 16)), chartEnd: endOf15d, chartDays: 15 };
        case "30d":
          //  LTIMOS 30 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf30d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { chartStart: startOfDay(subDays(now, 31)), chartEnd: endOf30d, chartDays: 30 };
        case "60d":
          //  LTIMOS 60 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf60d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { chartStart: startOfDay(subDays(now, 61)), chartEnd: endOf60d, chartDays: 60 };
        case "90d":
          //  LTIMOS 90 DIAS EXCLUINDO HOJE E ONTEM (svendas antigas)
          const endOf90d = endOfDay(subDays(now, 2)); // Fim de anteontem
          return { chartStart: startOfDay(subDays(now, 91)), chartEnd: endOf90d, chartDays: 90 };
        case "total":
          //  TOTAL REAL - desde primeira venda até agora
          if (safeOrders.length === 0) {
            return { chartStart: startOfDay(now), chartEnd: now, chartDays: 1 };
          }
          const oldestOrderChart = safeOrders.reduce((oldest, order) => {
            const orderDate = order.createdAt && typeof order.createdAt === 'object' && 'seconds' in order.createdAt ? 
              new Date((order.createdAt as any).seconds * 1000 || (order.createdAt as any)._seconds * 1000) : new Date(order.createdAt);
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          const daysDiff = Math.max(1, Math.ceil((now.getTime() - oldestOrderChart.getTime()) / (1000 * 60 * 60 * 24)));
          return { chartStart: startOfDay(oldestOrderChart), chartEnd: now, chartDays: daysDiff };
        default:
          return { chartStart: startOfDay(subDays(now, 29)), chartEnd: now, chartDays: 30 };
      }
    };

    const { chartStart, chartEnd, chartDays } = getDateRangeForChart();
    
    //  GERAR RANGE DE DIAS CORRETO BASEADO NO FILTRO
    let chartDayRange: Date[] = [];
    
    if (selectedFilter === "hoje") {
      chartDayRange = [now]; // Apenas hoje - 24 horas
    } else if (selectedFilter === "ontem") {
      chartDayRange = [startOfDay(subDays(now, 1))]; // Apenas ontem - 24 horas desde meia-noite
    } else if (selectedFilter === "7d") {
      chartDayRange = eachDayOfInterval({
        start: startOfDay(subDays(now, 8)),
        end: endOfDay(subDays(now, 2)) // 7 dias excluindo hoje e ontem
      }); // 7 dias de vendas antigas
    } else if (selectedFilter === "15d") {
      chartDayRange = eachDayOfInterval({
        start: startOfDay(subDays(now, 16)),
        end: endOfDay(subDays(now, 2)) // 15 dias excluindo hoje e ontem
      }); // 15 dias de vendas antigas
    } else if (selectedFilter === "30d") {
      chartDayRange = eachDayOfInterval({
        start: startOfDay(subDays(now, 31)),
        end: endOfDay(subDays(now, 2)) // 30 dias excluindo hoje e ontem
      }); // 30 dias de vendas antigas
    } else if (selectedFilter === "60d") {
      chartDayRange = eachDayOfInterval({
        start: startOfDay(subDays(now, 61)),
        end: endOfDay(subDays(now, 2)) // 60 dias excluindo hoje e ontem
      }); // 60 dias de vendas antigas
    } else if (selectedFilter === "90d") {
      chartDayRange = eachDayOfInterval({
        start: startOfDay(subDays(now, 91)),
        end: endOfDay(subDays(now, 2)) // 90 dias excluindo hoje e ontem
      }); // 90 dias de vendas antigas
    } else { // total
      chartDayRange = eachDayOfInterval({
        start: startOfDay(subDays(now, 364)),
        end: now // Último ano incluindo hoje
      }); // Histórico completo incluindo hoje
    }

    //  PROCESSAR DADOS DIRIOS CORRETOS
    const typeDailyData = chartDayRange.map(day => {
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      
      // Filtrar orders do dia e tipo especfico - USAR PAIDT
      const dayOrders = typeOrders.filter(order => {
        //  USAR PAIDT QUANDO DISPONVEL, SENÃO CREATEDAT
        const orderDate = normalizeTimestamp(order.paidAt) || normalizeTimestamp(order.createdAt) || new Date();
        return orderDate >= dayStart && orderDate <= dayEnd;
      });

      // INCLUIR TODAS AS VENDAS (PAGAS + PENDENTES + PROCESSING) - SINCRONIZAÇÃO REAL
      const paidOrders = dayOrders.filter(order => order.status === 'paid');
      const pendingOrders = dayOrders.filter(order => ['pending', 'processing'].includes(order.status));

      //  TOTAL REAL DE VENDAS (APENAS VENDAS PAGAS)
      const totalPaid = paidOrders.length;
      
      //  CALCULAR VALOR TOTAL PENDENTE (soma dos amounts, no quantidade)
      const totalPendingAmount = pendingOrders.reduce((sum, order) => {
        const amount = order.amount || (order as any).checkoutSnapshot?.pricing?.price || (order as any).financialData?.grossAmount || 0;
        return sum + amount;
      }, 0);
      const totalPending = pendingOrders.length;
      const totalSales = totalPaid;

      const revenue = paidOrders.reduce((sum, order) => sum + order.amount, 0);

      const pendingRevenue = pendingOrders.reduce((sum, order) => {
        const amount = order.amount || (order as any).checkoutSnapshot?.pricing?.price || (order as any).financialData?.grossAmount || 0;
        return sum + amount;
      }, 0);

      return {
        date: selectedFilter === "hoje" ? "Hoje" : 
              selectedFilter === "ontem" ? "Ontem" :
              format(day, 'd/M', { locale: ptBR }),
        sales: Math.min((totalSales || 0) * 2, 20), //  PICO REAL SINCRONIZADO (TODAS AS VENDAS)
        paid: Math.min((totalPaid || 0) * 2, 20), //  PICO REAL SINCRONIZADO (VENDAS PAGAS)  
        pending: Math.min((totalPending || 0) * 2, 10), //  PICO REAL SINCRONIZADO (VENDAS PENDENTES)
        revenue: (revenue / 100) || 0, //  RECEITA PAGA EM REAIS
        pendingRevenue: (pendingRevenue / 100) || 0 //  RECEITA PENDENTE EM REAIS
      };
    });

    //  GERAR DADOS POR HORA APENAS PARA "HOJE" E "ONTEM" - OUTROS FILTROS USAM DADOS DIRIOS COMO PICOS
    let typeHourlyData: any[] = [];
    
    //  SEMPRE MOSTRAR TODOS OS INTERVALOS, MESMO SEM VENDAS (PADRONIZAÇÃO TOTAL)
    console.log(` ${productType.toUpperCase()} - Filtro: ${selectedFilter}, Vendas: ${typeOrders.length} orders`);
    //  REMOVIDO: No retornar arrays vazios nunca - sempre mostrar timeline completo
    
    //  PARA FILTROS MULTI-DIA (7d, 15d, etc.), USAR APENAS DIAS COM VENDAS REAIS
    let daysWithSales: any[] = [];
    if (selectedFilter !== "hoje" && selectedFilter !== "ontem") {
      //  FILTRAR APENAS DIAS QUE TM VENDAS REAIS (no criar dados artificiais)
      daysWithSales = typeDailyData.filter(dayData => 
        (dayData.paid > 0) || (dayData.pending > 0)
      );
    }
    
    // Desconto: GERAR DADOS BASEADOS NOS TIMESTAMPS EXATOS DAS VENDAS REAIS
    typeHourlyData = [];
    
    //  FUNÇÃO PARA CALCULAR PICOS SUAVIZADOS BASEADOS NO VALOR DA VENDA 
    const calculateDynamicPeak = (saleAmount: number, minutesElapsed: number = 0): number => {
      const amountInCents = typeof saleAmount === 'number' ? saleAmount : parseInt(saleAmount);
      const amountInReais = amountInCents / 100;
      
      // Desconto: PICOS MAIS SUAVES E REALISTAS (reduzidos para evitar flutuao)
      let basePeak = 1; // Pico base mnimo
      if (amountInReais >= 5000) basePeak = 8;      // R$ 5K+ = pico alto
      else if (amountInReais >= 1000) basePeak = 5;     // R$ 1K+ = pico médio
      else if (amountInReais >= 500) basePeak = 3;       // R$ 500+ = pico baixo-médio
      else if (amountInReais >= 100) basePeak = 2;       // R$ 100+ = pico baixo
      else basePeak = 1; // Menos de R$ 100 = pico mnimo
      
      // DECAY TEMPORAL MAIS SUAVE: Pico diminui gradualmente
      if (minutesElapsed <= 5) {
        return basePeak; // Pico máximo nos primeiros 5 minutos
      } else if (minutesElapsed <= 60) {
        const decayFactor = 1 - ((minutesElapsed - 5) / 55) * 0.3; // Diminui 30% ao longo de 1 hora
        return Math.max(0, Math.round(basePeak * decayFactor)); // Permite zero para barras começarem do chão
      } else {
        return Math.max(0, Math.round(basePeak * 0.7)); // Permite zero - sem clamp artificial
      }
    };

    //  PARA "HOJE": CRIAR TIMELINE DE HORAS (00:00-23:00)
    //  PARA OUTROS FILTROS: USAR DIAS
    if (selectedFilter === 'hoje') {
      //  CRIAR TIMELINE COMPLETO DO DIA (24 HORAS)
      const startOfTargetDay = startOfDay(now);
      
      //  GERAR 24 INTERVALOS DE 1 HORA (00:00, 01:00, 02:00...)
      const allHourIntervals = [];
      for (let i = 0; i < 24; i++) {
        const intervalTime = new Date(startOfTargetDay.getTime() + (i * 60 * 60 * 1000));
        allHourIntervals.push(intervalTime);
      }
      
      typeHourlyData = allHourIntervals.map(intervalDate => {
        const hour = format(intervalDate, 'HH:mm');
        return {
          time: hour.split(':')[0],
          hour: hour,
          sales: 0,
          paid: 0,
          pending: 0,
          paidRevenue: 0,
          pendingRevenue: 0,
          realTimestamp: intervalDate.getTime(),
          dynamicPeak: 0 //  NOVO: Campo para picos dinmicos
        };
      });
      
      //  MAPEAR VENDAS REAIS PARA OS NOVOS INTERVALOS DE 30 MINUTOS + PICOS DINMICOS
      if (typeOrders.length > 0) {
        //  Processar orders reais com picos baseados no valor
        typeOrders.forEach(order => {
          let orderDate;
          try {
            if (order.paidAt) {
              if (typeof order.paidAt === 'object' && (order.paidAt as any).seconds) {
                orderDate = new Date((order.paidAt as any).seconds * 1000);
              } else {
                orderDate = order.paidAt instanceof Date ? order.paidAt : new Date(order.paidAt);
              }
            } else {
              orderDate = normalizeTimestamp(order.createdAt) || new Date();
            }
          } catch (error) {
            orderDate = normalizeTimestamp(order.createdAt) || new Date();
          }
          
          //  CALCULAR INTERVALO DE HORA (0-23 intervalos no dia)
          const hour = orderDate.getHours();
          const intervalIndex = hour; // 00:00=0, 01:00=1, 02:00=2, etc.
          
          //  VERIFICAR STATUS PAGO/PENDENTE CORRETAMENTE
          const isPaid = ['paid', 'completed'].includes(order.status);
          const isPending = ['pending', 'processing', 'waiting', 'awaiting_payment', 'awaiting', 'authorized'].includes(order.status);
          
          if (intervalIndex >= 0 && intervalIndex < 24) {
            //  CALCULAR MINUTOS DECORRIDOS DESDE A VENDA PARA DECAY TEMPORAL
            const minutesElapsed = Math.floor((now.getTime() - orderDate.getTime()) / (60 * 1000));
            const dynamicPeak = calculateDynamicPeak(order.amount, minutesElapsed);
            
            // APLICAR VALORES REAIS + PICOS DINMICOS (SEM CLAMP - PERMITE ZERO)
            const orderAmount = order.amount || (order as any).checkoutSnapshot?.pricing?.price || (order as any).financialData?.grossAmount || 0;
            typeHourlyData[intervalIndex].sales += dynamicPeak;
            typeHourlyData[intervalIndex].paid += isPaid ? dynamicPeak : 0;
            typeHourlyData[intervalIndex].pending += isPending ? dynamicPeak : 0;
            typeHourlyData[intervalIndex].paidRevenue += isPaid ? orderAmount : 0;
            typeHourlyData[intervalIndex].pendingRevenue += isPending ? orderAmount : 0;
            typeHourlyData[intervalIndex].dynamicPeak = Math.max(typeHourlyData[intervalIndex].dynamicPeak || 0, dynamicPeak);
            
            console.log(` PICO DINMICO: ${order.customer?.name} R$${(order.amount/100).toFixed(0)} Pico: ${dynamicPeak} (${minutesElapsed}min atrs)`);
          }
        });
        
      }
    } else {
      //  PARA OUTROS FILTROS (ONTEM, 7D, 30D, TOTAL): USAR APENAS VENDAS REAIS - SEM ZEROS SINTTICOS
      const allRealSales: any[] = [];
      
      // ADICIONAR VENDAS DIGITAIS REAIS COM HORRIOS REAIS
      typeOrders.forEach(order => {
        let orderDate;
        try {
          orderDate = normalizeTimestamp(order.paidAt) || normalizeTimestamp(order.createdAt) || new Date();
        } catch (error) {
          orderDate = new Date(order.createdAt);
        }
        
        const hour = format(orderDate, 'HH:mm');
        //  PICO BASEADO NO VALOR DA VENDA - PERMITE ZERO PARA BARRAS COMEAREM DO CHO
        const saleAmountReais = (order.amount || 0) / 100;
        const dynamicPeak = Math.min(Math.max(Math.ceil(saleAmountReais / 100), 0), 10); // Pico de 0-10 (zero-based)
        
        //  VERIFICAR STATUS PAGO/PENDENTE CORRETAMENTE
        const isPaid = ['paid', 'completed'].includes(order.status);
        const isPending = ['pending', 'processing', 'waiting', 'awaiting_payment', 'awaiting', 'authorized'].includes(order.status);
        
        //  APENAS ADICIONAR SE FOR PAGO OU PENDENTE
        if (isPaid || isPending) {
          allRealSales.push({
            hour: hour,
            paid: isPaid ? dynamicPeak : 0,
            pending: isPending ? dynamicPeak : 0,
            sales: dynamicPeak,
            paidRevenue: isPaid ? (order.amount || 0) : 0,
            pendingRevenue: isPending ? (order.amount || 0) : 0,
            realTimestamp: orderDate.getTime(),
            customerName: order.customer?.name || 'Cliente',
            originalAmount: order.amount || 0
          });
        }
      });
      
      
      //  ORDENAR POR HORRIO REAL E USAR APENAS OS DADOS REAIS (SEM ZEROS ANTES/DEPOIS)
      typeHourlyData = allRealSales.sort((a, b) => a.realTimestamp - b.realTimestamp);
      
      console.log(` ${productType.toUpperCase()} REAL DATA (filtro: ${selectedFilter}):`, {
        totalVendas: allRealSales.length,
        primeiras3: typeHourlyData.slice(0, 3).map(s => `${s.hour} - R$${(s.originalAmount/100).toFixed(0)}`),
        ultimas3: typeHourlyData.slice(-3).map(s => `${s.hour} - R$${(s.originalAmount/100).toFixed(0)}`)
      });
    }

    //  CALCULAR TOTAIS REAIS DIRETO DO BANCO (SEMPRE EM CENTAVOS)
    let totalRevenue = 0;
    let totalPendingRevenue = 0;
    
    // SOMAR DIRETO DAS ORDERS FILTRADAS POR TIPO E DATA (DADOS REAIS)
    typeOrders.forEach(order => {
      //  PAGO: paid, completed
      if (['paid', 'completed'].includes(order.status)) {
        totalRevenue += order.amount || 0; //  CENTAVOS DO BANCO
      } 
      //  PENDENTE: pending, processing, waiting, awaiting_payment, awaiting, authorized
      else if (['pending', 'processing', 'waiting', 'awaiting_payment', 'awaiting', 'authorized'].includes(order.status)) {
        totalPendingRevenue += order.amount || 0; //  CENTAVOS DO BANCO
      }
      // LOG para status no mapeados
      else if (order.status && !['failed', 'expired', 'cancelled', 'refunded'].includes(order.status)) {
        console.warn(` ${productType.toUpperCase()} - Status no mapeado: ${order.status} para venda ${order.id}`);
      }
    });
    
    
    return { 
      dailyData: typeDailyData, 
      hourlyData: typeHourlyData,
      totalRevenue: totalRevenue, //  TOTAL PARA O CARD "Total Pago"
      totalPendingRevenue: totalPendingRevenue //  TOTAL PARA O CARD "Total Pendente"
    };
  }, [orders, checkouts, checkoutMap, dateFilter]);

  // Desconto: GERAR DADOS PARA CADA TIPO DE PRODUTO - FILTRO GERAL SINCRONIZADO
  const digitalChartData = generateChartDataByType('digital', dateFilter);
  const subscriptionChartData = generateChartDataByType('subscription', dateFilter);
  
  useEffect(() => {
    if (!user) return;
    let retryCount = 0;
    
    const check2FAStatus = async () => {
      try {
        if (isSeller2FASessionValid()) {
          setRequires2FA(false);
          return;
        }
        
        const currentUser = auth.currentUser;
        if (!currentUser) {
          setRequires2FA(false);
          return;
        }
        
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 5000);
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/seller/2fa/status", {
          headers: { "Authorization": `Bearer ${token}` },
          signal: controller.signal
        });
        clearTimeout(fetchTimeout);
        
        if (response.ok) {
          const data = await response.json();
          setRequires2FA(data.requiresVerification && !isSeller2FASessionValid());
        } else {
          if (retryCount < 2) {
            retryCount++;
            setTimeout(check2FAStatus, 2000);
          } else {
            setRequires2FA(false);
          }
        }
      } catch (error) {
        console.error("[2FA] Erro ao verificar status:", error);
        if (retryCount < 2) {
          retryCount++;
          setTimeout(check2FAStatus, 2000);
        } else {
          setRequires2FA(false);
        }
      }
    };
    
    check2FAStatus();
  }, [user]);


  useEffect(() => {
    if (!user) {
      console.log('[Dashboard] Aguardando user...');
      return;
    }
    
    const checkUserType = async () => {
      try {
        console.log(`[Dashboard] Verificando tipo do usuário: ${user.uid.substring(0, 8)}...`);
        const isSeller = await isUserSeller(user.uid);
        console.log(`[Dashboard] Tipo detectado: ${isSeller ? 'SELLER' : 'CUSTOMER'}, tenant: ${tenant?.id?.substring(0, 8) || 'NULL'}`);
        setUserType(isSeller ? "seller" : "customer");
      } catch (error) {
        console.error('[Dashboard] Erro ao verificar tipo:', error);
        setUserType("customer");
      } finally {
        setLoading(false);
      }
    };
    
    checkUserType();
  }, [user]);

  // NOTA: Early returns movidos para depois de TODOS os hooks para evitar erro "Rendered fewer hooks than expected"
  

  
  //  REMOVIDO FILTRO DE DADOS FAKE - APENAS PIX REAIS

  //  CALCULAR MTRICAS BASEADAS NO FILTRO DE DATA SELECIONADO
  const getFilteredMetrics = () => {
    const now = new Date();
    
    let start: Date, end: Date;
    
    switch (dateFilter) {
      case "hoje":
      case "ontem": {
        const range = getBRTDateRange(dateFilter, now);
        start = range.start;
        end = range.end;
        break;
      }
      case "7d":
        //  LTIMOS 7 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 6));
        end = now;
        break;
      case "15d":
        //  LTIMOS 15 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 14));
        end = now;
        break;
      case "30d":
        //  LTIMOS 30 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 29));
        end = now;
        break;
      case "60d":
        //  LTIMOS 60 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 59));
        end = now;
        break;
      case "total":
      default:
        //  TOTAL = DESDE PRIMEIRA VENDA ATAGORA (incluindo hoje)
        if (safeOrders.length === 0) {
          start = startOfDay(now);
          end = now;
        } else {
          const oldestOrder = safeOrders.reduce((oldest, order) => {
            const orderDate = normalizeTimestamp(order.createdAt);
            if (!orderDate) return oldest; // Ignorar timestamps inválidos sem colapsar cronologia
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          start = startOfDay(oldestOrder);
          end = now; // Até agora (inclui hoje)
        }
        break;
    }
    
    //  FILTRAR VENDAS DO PERODO - EXCLUIR VENDAS FSICAS DOS CARDS
    const filteredOrders = safeOrders.filter(order => {
      const orderDate = normalizeTimestamp(order.createdAt);
      if (!orderDate) return false;
      
      //  VERIFICAR SE ESTNO PERODO
      const inPeriod = orderDate >= start && orderDate <= end;
      if (!inPeriod) return false;
      
      return true;
    });

    const totalOrders = filteredOrders.length;
    const paidOrders = filteredOrders.filter(order => order.status === "paid");
    const totalRevenue = paidOrders.reduce((sum, order) => sum + order.amount, 0);
    const conversionRate = totalOrders > 0 ? (paidOrders.length / totalOrders) * 100 : 0;
    
    return { totalOrders, paidOrders, totalRevenue, conversionRate };
  };

  const { totalOrders, paidOrders, totalRevenue, conversionRate } = getFilteredMetrics();
  const activeCheckouts = safeCheckouts.filter(checkout => checkout.active).length;

  //  CALCULAR MTRICAS ADICIONAIS REAIS
  const { totalOrders: filteredTotalOrders, paidOrders: filteredPaidOrders } = getFilteredMetrics();
  
  // PIX pagos no período selecionado
  const pixPaidOrders = filteredPaidOrders.filter(order => order.method === "pix");
  const totalPixPaid = pixPaidOrders.length;
  
  //  REMOVIDO: Clculos de pendentes e boletos - DASHBOARD LIMPO

  //  NOVOS CARDS - VENDAS CARTÃO FILTRADAS POR DATA
  const cardPaidOrders = filteredPaidOrders.filter(order => 
    order.method === "card" || order.method === "credit_card"
  );
  const totalCardPaid = cardPaidOrders.length;
  const totalCardPaidValue = cardPaidOrders.reduce((sum, order) => sum + order.amount, 0);

  //  VENDAS BRASIL vs  VENDAS GLOBAIS (filtradas por data)
  // Recalcular filteredOrders usando a mesma lgica de data
  const getFilteredOrdersForCards = () => {
    const now = new Date();
    
    let start: Date, end: Date;
    
    switch (dateFilter) {
      case "hoje":
      case "ontem": {
        const range = getBRTDateRange(dateFilter, now);
        start = range.start;
        end = range.end;
        break;
      }
      case "7d":
        //  LTIMOS 7 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 6));
        end = now;
        break;
      case "15d":
        //  LTIMOS 15 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 14));
        end = now;
        break;
      case "30d":
        //  LTIMOS 30 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 29));
        end = now;
        break;
      case "60d":
        //  LTIMOS 60 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 59));
        end = now;
        break;
      case "90d":
        //  LTIMOS 90 DIAS INCLUINDO HOJE
        start = startOfDay(subDays(now, 89));
        end = now;
        break;
      case "total":
      default:
        //  TOTAL = DESDE PRIMEIRA VENDA ATAGORA (incluindo hoje)
        if (safeOrders.length === 0) {
          start = startOfDay(now);
          end = now;
        } else {
          const oldestOrder = safeOrders.reduce((oldest, order) => {
            const orderDate = normalizeTimestamp(order.createdAt);
            if (!orderDate) return oldest; // Ignorar timestamps inválidos sem colapsar cronologia
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          start = startOfDay(oldestOrder);
          end = now; // Até agora (inclui hoje)
        }
    }
    
    //  SEMPRE FILTRAR POR DATA + EXCLUIR VENDAS FSICAS (igual aos outros filtros)
    return safeOrders.filter(order => {
      const orderDate = normalizeTimestamp(order.createdAt);
      if (!orderDate) return false;
      
      //  VERIFICAR SE ESTNO PERODO
      const inPeriod = orderDate >= start && orderDate <= end;
      if (!inPeriod) return false;
      
      return true;
    });
  };
  
  const filteredOrdersForCards = getFilteredOrdersForCards();
  
  const salesBrasil = filteredOrdersForCards.filter(order => 
    order.method === "pix" || ((order.method === "card" || order.method === "credit_card") && order.processor !== "stripe")
  ).length;
  
  //  VENDAS GLOBAIS REAIS (Stripe)
  const salesGlobal = filteredOrdersForCards.filter(order => 
    (order.method === "card" || order.method === "credit_card") && order.processor === "stripe"
  ).length;

  // Desconto: FILTRAR ORDERS POR TIPO DE PRODUTO + DATA
  const filteredStats = useMemo(() => {
    // Primeiro filtrar por data (reutilizando lgica existente)
    const filteredByDate = getFilteredOrdersByPeriod();
    
    // Depois filtrar por tipo de produto
    const filteredByType = filteredByDate.filter(order => {
      if (productTypeFilter === "all") return true;
      
      // Detectar tipo do produto baseado no checkout
      const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
      const productType = checkout?.productType || order.checkoutSnapshot?.productType || 'digital';
      
      return productType === productTypeFilter;
    });
    
    // Calcular métricas filtradas
    const paidOrders = filteredByType.filter(o => o.status === 'paid');
    const pendingOrders = filteredByType.filter(o => o.status === 'pending');
    const totalSales = filteredByType.length;
    const totalPaid = paidOrders.length;
    const totalPending = pendingOrders.length;
    const totalRevenue = filteredByType.reduce((sum, o) => sum + o.amount, 0);
    const totalPendingRevenue = pendingOrders.reduce((sum, o) => sum + o.amount, 0);
    const conversionRate = totalSales > 0 ? (totalPaid / totalSales) * 100 : 0;
    
    return {
      totalSales,
      totalPaid,
      totalPending,
      totalRevenue,
      totalPendingRevenue,
      conversionRate,
      filteredOrders: filteredByType
    };
  }, [orders, dateFilter, productTypeFilter, checkouts]);

  const affiliateChartData = useMemo(() => {
    if (!safeAffiliateOrders.length) return [];
    
    const now = new Date();
    let start: Date, end: Date;
    
    switch (dateFilter) {
      case "hoje": start = startOfDay(now); end = now; break;
      case "ontem": start = startOfDay(subDays(now, 1)); end = endOfDay(subDays(now, 1)); break;
      case "7d": start = startOfDay(subDays(now, 6)); end = now; break;
      case "15d": start = startOfDay(subDays(now, 14)); end = now; break;
      case "30d": start = startOfDay(subDays(now, 29)); end = now; break;
      case "60d": start = startOfDay(subDays(now, 59)); end = now; break;
      case "90d": start = startOfDay(subDays(now, 89)); end = now; break;
      case "total": default:
        if (safeAffiliateOrders.length === 0) { start = startOfDay(now); end = now; } 
        else {
          const oldest = safeAffiliateOrders.reduce((o: Date, order: any) => {
            const d = parseAffDate(order);
            return d && d < o ? d : o;
          }, now);
          start = startOfDay(oldest); end = now;
        }
    }
    
    const intervals = (dateFilter === "hoje" || dateFilter === "ontem")
      ? eachHourOfInterval({ start, end })
      : eachDayOfInterval({ start, end });
    
    return intervals.map(interval => {
      const paidInInterval = safeAffiliateOrders.filter((order: any) => {
        const orderDate = parseAffDate(order);
        if (!orderDate) return false;
        const isMatch = (dateFilter === "hoje" || dateFilter === "ontem") ? isSameHour(orderDate, interval) : isSameDay(orderDate, interval);
        return isMatch && isAffApproved(order.status);
      });
      
      const pendingInInterval = safeAffiliateOrders.filter((order: any) => {
        const orderDate = parseAffDate(order);
        if (!orderDate) return false;
        const isMatch = (dateFilter === "hoje" || dateFilter === "ontem") ? isSameHour(orderDate, interval) : isSameDay(orderDate, interval);
        return isMatch && order.status === 'pending';
      });
      
      const label = (dateFilter === "hoje" || dateFilter === "ontem")
        ? format(interval, 'HH:mm', { locale: ptBR })
        : format(interval, 'dd/MM', { locale: ptBR });
      
      return {
        time: label,
        Aprovadas: paidInInterval.reduce((sum: number, o: any) => sum + (getAffCommission(o) || 0) / 100, 0),
        Pendentes: pendingInInterval.reduce((sum: number, o: any) => sum + (getAffCommission(o) || 0) / 100, 0)
      };
    });
  }, [affiliateOrders, dateFilter]);

  // Desconto: DADOS DO GRFICO UNIFICADO COM BARRAS EMPILHADAS
  const unifiedChartData = useMemo(() => {
    if (!safeOrders.length && !safeAffiliateOrders.length) return [];
    
    const now = new Date();
    let start: Date, end: Date;
    
    // Usar mesma lgica de datas
    switch (dateFilter) {
      case "hoje":
        start = startOfDay(now);
        end = now;
        break;
      case "ontem":
        start = startOfDay(subDays(now, 1));
        end = endOfDay(subDays(now, 1));
        break;
      case "7d":
        start = startOfDay(subDays(now, 6));
        end = now;
        break;
      case "15d":
        start = startOfDay(subDays(now, 14));
        end = now;
        break;
      case "30d":
        start = startOfDay(subDays(now, 29));
        end = now;
        break;
      case "60d":
        start = startOfDay(subDays(now, 59));
        end = now;
        break;
      case "90d":
        start = startOfDay(subDays(now, 89));
        end = now;
        break;
      case "total":
      default:
        if (safeOrders.length === 0) {
          start = startOfDay(now);
          end = now;
        } else {
          const oldestOrder = safeOrders.reduce((oldest, order) => {
            const orderDate = normalizeTimestamp(order.createdAt);
            if (!orderDate) return oldest;
            const oldestDate = oldest instanceof Date ? oldest : new Date(oldest);
            return orderDate < oldestDate ? orderDate : oldestDate;
          }, now);
          start = startOfDay(oldestOrder);
          end = now;
        }
    }
    
    // Desconto: GERAR INTERVALOS: HORAS PARA "HOJE" E "ONTEM", DIAS PARA OUTROS PERODOS
    const intervals = (dateFilter === "hoje" || dateFilter === "ontem")
      ? eachHourOfInterval({ start, end })
      : eachDayOfInterval({ start, end });
    
    // Agrupar vendas por intervalo e tipo
    const chartData = intervals.map(interval => {
      //  PEDIDOS PAGOS
      const paidOrders = safeOrders.filter(order => {
        //  FIX: Usar paidAt para vendas pagas, createdAt para pendentes
        const orderDate = resolveOrderTimestamp(order);
        if (!orderDate) return false;
        const isDateMatch = (dateFilter === "hoje" || dateFilter === "ontem") ? isSameHour(orderDate, interval) : isSameDay(orderDate, interval);
        const isPaid = order.status === 'paid';
        
        // Desconto: APLICAR FILTRO DE TIPO DE PRODUTO
        if (!isDateMatch || !isPaid) return false;
        if (productTypeFilter === "all") return true;
        
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        const isSubscription = checkout?.productType === 'subscription' || 
                               order.checkoutSnapshot?.productType === 'subscription' ||
                               checkout?.pricing?.subscriptionPeriod;
        const isDigital = !isSubscription;
        
        if (productTypeFilter === "subscription") return isSubscription;
        if (productTypeFilter === "digital") return isDigital;
        
        return false;
      });
      
      //  PEDIDOS PENDENTES
      const pendingOrders = safeOrders.filter(order => {
        //  FIX: Usar createdAt para pedidos pendentes
        const orderDate = resolveOrderTimestamp(order);
        if (!orderDate) return false;
        const isDateMatch = (dateFilter === "hoje" || dateFilter === "ontem") ? isSameHour(orderDate, interval) : isSameDay(orderDate, interval);
        const isPending = order.status === 'pending';
        
        // Aplicar filtro de tipo de produto
        if (!isDateMatch || !isPending) return false;
        if (productTypeFilter === "all") return true;
        
        const checkout = safeCheckouts.find(c => c.id === order.checkoutId);
        const isSubscription = checkout?.productType === 'subscription' || 
                               order.checkoutSnapshot?.productType === 'subscription' ||
                               checkout?.pricing?.subscriptionPeriod;
        const isDigital = !isSubscription;
        
        if (productTypeFilter === "subscription") return isSubscription;
        if (productTypeFilter === "digital") return isDigital;
        
        return false;
      });
      
      const label = (dateFilter === "hoje" || dateFilter === "ontem") 
        ? format(interval, 'HH:mm', { locale: ptBR })
        : format(interval, 'dd/MM', { locale: ptBR });
      
      let affApproved = 0;
      let affPending = 0;
      if (safeAffiliateOrders.length > 0) {
        safeAffiliateOrders.forEach((ao: any) => {
          const d = parseAffDate(ao);
          if (!d) return;
          const match = (dateFilter === "hoje" || dateFilter === "ontem") ? isSameHour(d, interval) : isSameDay(d, interval);
          if (!match) return;
          const comm = getAffCommission(ao);
          if (isAffApproved(ao.status)) affApproved += comm / 100;
          else if (ao.status === 'pending') affPending += comm / 100;
        });
      }

      return {
        time: label,
        Aprovadas: paidOrders.reduce((sum, o) => sum + (o.amount || 0) / 100, 0) + affApproved,
        Pendentes: pendingOrders.reduce((sum, o) => sum + (o.amount || 0) / 100, 0) + affPending
      };
    });
    
    return chartData;
  }, [orders, dateFilter, productTypeFilter, checkouts, affiliateOrders]);

  const getStatusBadge = (status: Order["status"]) => {
    const variants = {
      pending: { variant: "warning" as const, label: "Pendente" },
      paid: { variant: "default" as const, label: "Pago" },
      cancelled: { variant: "destructive" as const, label: "Cancelado" },
      expired: { variant: "secondary" as const, label: "Expirado" },
      failed: { variant: "destructive" as const, label: "Falhou" },
    };

    const config = variants[status];
    return (
      <Badge variant={config.variant}>
        {config.label}
      </Badge>
    );
  };

  // REMOVIDO: Primeiro return com TooltipProvider (código duplicado)
  // Mantendo apenas o return principal com DashboardLayout

  // ===== NOVOS HELPERS PARA DASHBOARD REDESENHADA =====
  
  // 1. Calcular revenue total e meta para barra de progresso
  const dashboardPaidOrders = useMemo(() => getFilteredOrdersByPeriod().filter(o => o.status === 'paid'), [orders, dateFilter, productTypeFilter, checkouts]);
  const dashboardTotalRevenue = useMemo(() => dashboardPaidOrders.reduce((sum, o) => sum + o.amount, 0), [dashboardPaidOrders]);
  const dashboardRevenueGoal = 10000; // Meta fixa de R$ 10k
  const dashboardRevenueProgress = Math.min((dashboardTotalRevenue / dashboardRevenueGoal) * 100, 100);
  const dashboardRevenueTier = dashboardTotalRevenue >= 10000 ? 'Ouro' : dashboardTotalRevenue >= 4000 ? 'Prata' : 'Bronze';
  
  // 2. Total de vendas e ticket médio
  const dashboardTotalSales = dashboardPaidOrders.length;
  const dashboardAverageTicket = dashboardTotalSales > 0 ? dashboardTotalRevenue / dashboardTotalSales : 0;

  const revenueBreakdown = useMemo(() => {
    const filtered = getFilteredOrdersByPeriod();
    const paidOrders = filtered.filter((o: any) => o.status === 'paid');
    
    const digitalOrders = paidOrders.filter((o: any) => {
      const snap = o.checkoutSnapshot as any;
      const isSub = snap?.pricing?.billingType === 'subscription' || snap?.pricing?.subscriptionPeriod;
      const isUpsellOrder = o.isUpsell || o.isDownsell;
      const isPersonalSale = o.type === 'personal_sale' || o.saleType === 'pix_qrcode';
      return !isSub && !isUpsellOrder && !isPersonalSale;
    });
    const digitalRevenue = digitalOrders.reduce((sum: number, o: any) => sum + (o.amount || 0), 0);
    const digitalCount = digitalOrders.length;
    
    const subOrders = paidOrders.filter((o: any) => {
      const snap = o.checkoutSnapshot as any;
      return snap?.pricing?.billingType === 'subscription' || snap?.pricing?.subscriptionPeriod;
    });
    const subRevenue = subOrders.reduce((sum: number, o: any) => sum + (o.amount || 0), 0);
    const subCount = subOrders.length;
    
    const bumpOrders = paidOrders.filter((o: any) => o.orderBumps && o.orderBumps.length > 0);
    const bumpRevenue = bumpOrders.reduce((sum: number, o: any) => {
      return sum + (o.orderBumps?.reduce((s: number, b: any) => s + (b.price || 0), 0) || 0);
    }, 0);
    const bumpCount = bumpOrders.length;
    
    const upsellOrders = filtered.filter((o: any) => o.isUpsell && o.status === 'paid');
    const upsellRevenue = upsellOrders.reduce((sum: number, o: any) => sum + (o.amount || 0), 0);
    const upsellCount = upsellOrders.length;
    
    const safePersonalSales = Array.isArray((personalSalesData as any)?.data) ? (personalSalesData as any).data : (Array.isArray(personalSalesData) ? personalSalesData : []);
    const paidPersonalSales = safePersonalSales.filter((s: any) => s.status === 'paid');
    const pixQrRevenue = paidPersonalSales.reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
    const pixQrCount = paidPersonalSales.length;
    
    const totalWithdrawn = (balanceSummary as any)?.totals?.BRL?.withdrawn || 0;
    
    const grandTotal = digitalRevenue + subRevenue + bumpRevenue + upsellRevenue + pixQrRevenue;
    
    return {
      digital: { revenue: digitalRevenue, count: digitalCount, pct: grandTotal > 0 ? Math.round((digitalRevenue / grandTotal) * 100) : 0 },
      subscription: { revenue: subRevenue, count: subCount, pct: grandTotal > 0 ? Math.round((subRevenue / grandTotal) * 100) : 0 },
      orderBump: { revenue: bumpRevenue, count: bumpCount, pct: grandTotal > 0 ? Math.round((bumpRevenue / grandTotal) * 100) : 0 },
      upsell: { revenue: upsellRevenue, count: upsellCount, pct: grandTotal > 0 ? Math.round((upsellRevenue / grandTotal) * 100) : 0 },
      pixQr: { revenue: pixQrRevenue, count: pixQrCount, pct: grandTotal > 0 ? Math.round((pixQrRevenue / grandTotal) * 100) : 0 },
      totalWithdrawn,
    };
  }, [orders, dateFilter, productTypeFilter, checkouts, personalSalesData, balanceSummary]);
  
  // 4. Reembolsos
  const dashboardRefundStats = useMemo(() => {
    const refundedOrders = safeOrders.filter(o => (o.status as string) === 'refunded' || (o.status as string) === 'chargeback');
    const estornos = refundedOrders.filter(o => (o.status as string) === 'refunded');
    const chargebacks: typeof orders = []; // Chargeback não existe no tipo atual
    const totalRefundAmount = refundedOrders.reduce((sum, o) => sum + o.amount, 0);
    const refundRate = safeOrders.length > 0 ? (refundedOrders.length / safeOrders.length) * 100 : 0;
    
    return {
      estornosCount: estornos.length,
      estornosAmount: estornos.reduce((sum, o) => sum + o.amount, 0),
      chargebacksCount: chargebacks.length,
      chargebacksAmount: chargebacks.reduce((sum, o) => sum + o.amount, 0),
      refundRate: refundRate.toFixed(1)
    };
  }, [orders]);
  
  // 5. Taxa de aprovação por método de pagamento
  const dashboardApprovalRates = useMemo(() => {
    const cardOrders = dashboardPaidOrders.filter(o => o.method === 'card' || o.method === 'credit_card');
    const pixOrders = dashboardPaidOrders.filter(o => o.method === 'pix');
    const boletoOrders = dashboardPaidOrders.filter(o => o.method === 'boleto' || o.method === 'bank_slip');
    
    const allCardOrders = getFilteredOrdersByPeriod().filter(o => o.method === 'card' || o.method === 'credit_card');
    const allPixOrders = getFilteredOrdersByPeriod().filter(o => o.method === 'pix');
    const allBoletoOrders = getFilteredOrdersByPeriod().filter(o => o.method === 'boleto' || o.method === 'bank_slip');
    
    return {
      card: allCardOrders.length > 0 ? (cardOrders.length / allCardOrders.length) * 100 : 0,
      pix: allPixOrders.length > 0 ? (pixOrders.length / allPixOrders.length) * 100 : 0,
      boleto: allBoletoOrders.length > 0 ? (boletoOrders.length / allBoletoOrders.length) * 100 : 0
    };
  }, [dashboardPaidOrders, orders, dateFilter, productTypeFilter, checkouts]);
  
  
  // 6. Crescimento em vendas (comparar com período anterior)
  const dashboardSalesGrowth = useMemo(() => {
    const now = new Date();
    let currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date;
    
    // Configurar períodos baseado no filtro
    switch (dateFilter) {
      case "hoje":
        currentStart = startOfDay(now);
        currentEnd = now;
        previousStart = startOfDay(subDays(now, 1));
        previousEnd = startOfDay(now);
        break;
      case "ontem":
        currentStart = startOfDay(subDays(now, 1));
        currentEnd = startOfDay(now);
        previousStart = startOfDay(subDays(now, 2));
        previousEnd = startOfDay(subDays(now, 1));
        break;
      case "7d":
        currentStart = startOfDay(subDays(now, 6));
        currentEnd = now;
        previousStart = startOfDay(subDays(now, 13));
        previousEnd = startOfDay(subDays(now, 6));
        break;
      default:
        currentStart = startOfDay(now);
        currentEnd = now;
        previousStart = startOfDay(subDays(now, 1));
        previousEnd = startOfDay(now);
    }
    
    const currentRevenue = safeOrders
      .filter(o => {
        const date = normalizeTimestamp(o.paidAt) || normalizeTimestamp(o.createdAt);
        return date && date >= currentStart && date <= currentEnd && o.status === 'paid';
      })
      .reduce((sum, o) => sum + o.amount, 0);
    
    const previousRevenue = safeOrders
      .filter(o => {
        const date = normalizeTimestamp(o.paidAt) || normalizeTimestamp(o.createdAt);
        return date && date >= previousStart && date <= previousEnd && o.status === 'paid';
      })
      .reduce((sum, o) => sum + o.amount, 0);
    
    const growth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;
    const growthAmount = currentRevenue - previousRevenue;
    
    return {
      current: currentRevenue,
      previous: previousRevenue,
      growth: growth,
      growthAmount: growthAmount,
      growthPercent: growth.toFixed(1)
    };
  }, [orders, dateFilter]);


  // ===== FIM DOS HELPERS =====

  // ===== EARLY RETURNS - DEVEM VIR DEPOIS DE TODOS OS HOOKS =====
  // Se for customer, redirecionar para área de membros
  if (userType === "customer") {
    return <Redirect to="/members" />;
  }

  // 🔐 BLOQUEIO TOTAL 2FA - Não renderiza NADA até verificar
  if (requires2FA && !verified2FA) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Seller2FAVerification
          isOpen={true}
          onVerified={() => { setVerified2FA(true); setRequires2FA(false); console.log('✅ 2FA Seller verificado - sessão salva'); }}
        />
      </div>
    );
  }
  // ===== FIM DOS EARLY RETURNS =====

  // ===== VALORES INSTANTÂNEOS - SEM DELAY =====
  // ✅ CORRIGIDO: Usar saldo REAL do Firebase (já desconta saques) em vez do cálculo local
  const realAvailableBalance = (balanceSummary as any)?.totals?.BRL?.available || 0;
  const affiliateAvailableBalance = (affiliateBalance as any)?.balanceAvailable_BRL || 0;
  const affiliatePendingBalance = (affiliateBalance as any)?.balancePending_BRL || 0;
  const affiliateLifetimeBalance = (affiliateBalance as any)?.lifetimeCommissions_BRL || 0;
  const showAffiliateData = hasApprovedAffiliations || affiliateAvailableBalance > 0 || affiliatePendingBalance > 0 || affiliateLifetimeBalance > 0 || safeAffiliateOrders.length > 0;
  const animatedBalance = realAvailableBalance + affiliateAvailableBalance;

  const affiliatePaidOrders = useMemo(() => {
    if (!showAffiliateData || !safeAffiliateOrders.length) return [];
    const now = new Date();
    let start: Date, end: Date = now;
    switch (dateFilter) {
      case "hoje": { const range = getBRTDateRange("hoje", now); start = range.start; end = range.end; break; }
      case "ontem": { const range = getBRTDateRange("ontem", now); start = range.start; end = range.end; break; }
      case "7d": start = startOfDay(subDays(now, 6)); break;
      case "15d": start = startOfDay(subDays(now, 14)); break;
      case "30d": start = startOfDay(subDays(now, 29)); break;
      case "60d": start = startOfDay(subDays(now, 59)); break;
      case "90d": start = startOfDay(subDays(now, 89)); break;
      case "total": default: start = new Date(0); break;
    }
    return safeAffiliateOrders.filter((o: any) => {
      const d = parseAffDate(o);
      if (!d) return false;
      return d >= start && d <= end && o.status === 'paid';
    });
  }, [affiliateOrders, showAffiliateData, dateFilter]);

  const affiliateCommissionTotal = useMemo(() => affiliatePaidOrders.reduce((sum: number, o: any) => sum + getAffCommission(o), 0), [affiliatePaidOrders]);

  const animatedRevenue = dashboardTotalRevenue + affiliateCommissionTotal;
  const animatedSalesCount = dashboardTotalSales + affiliatePaidOrders.length;
  const animatedApprovalRate = useMemo(() => {
    const allOrders = getFilteredOrdersByPeriod();
    const totalSellerOrders = allOrders.length;
    const affTotal = safeAffiliateOrders.filter((o: any) => {
      const d = parseAffDate(o);
      if (!d) return false;
      const now = new Date();
      let start: Date, end: Date = now;
      switch (dateFilter) {
        case "hoje": { const range = getBRTDateRange("hoje", now); start = range.start; end = range.end; break; }
        case "ontem": { const range = getBRTDateRange("ontem", now); start = range.start; end = range.end; break; }
        case "7d": start = startOfDay(subDays(now, 6)); break;
        case "15d": start = startOfDay(subDays(now, 14)); break;
        case "30d": start = startOfDay(subDays(now, 29)); break;
        case "60d": start = startOfDay(subDays(now, 59)); break;
        case "90d": start = startOfDay(subDays(now, 89)); break;
        case "total": default: start = new Date(0); break;
      }
      return d >= start && d <= end;
    }).length;
    const totalOrders = totalSellerOrders + affTotal;
    if (totalOrders === 0) return 0;
    const paidCount = allOrders.filter(o => o.status === 'paid').length + affiliatePaidOrders.length;
    return Math.round((paidCount / totalOrders) * 100);
  }, [orders, dateFilter, productTypeFilter, checkouts, affiliateOrders, affiliatePaidOrders]);
  const animatedSubscriptions = subscriptionStats?.totalActive || 0;
  const animatedCardApprovalRate = Math.round(dashboardApprovalRates.card);
  const animatedPixApprovalRate = Math.round(dashboardApprovalRates.pix);

  return (
    <DashboardLayout>
      {/* BANNER DE APROVAÇÃO - MOSTRA APENAS QUANDO PENDING/REJECTED */}
      <ApprovalBanner onStatusChange={setSellerApprovalStatus} onVerifyClick={() => setIsVerificationModalOpen(true)} />
      <AccountVerificationModal
        open={isVerificationModalOpen}
        onOpenChange={setIsVerificationModalOpen}
        onComplete={() => window.location.reload()}
      />
      
      <div className="px-3 py-3 md:px-6 md:py-4 space-y-4 bg-transparent min-h-screen">
        {/* BANNERS DO ADMIN - TEMPO REAL */}
        <BannerDisplay position="dashboard_top" />
        
        {/* Dados em tempo real */}
        <>
            {/* TOP ROW: 4 CARDS HORIZONTAIS */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
              
              {/* Card 1: Saldo disponível */}
              <Card className="bg-white dark:bg-transparent border border-gray-100 dark:border-violet-500/20 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-8 h-8 rounded-lg bg-[#2563eb]/10 flex items-center justify-center">
                          <Wallet className="w-4 h-4 text-[#2563eb]" />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setHideRevenueValue(!hideRevenueValue)}
                          className="h-6 w-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg"
                        >
                          {hideRevenueValue ? <EyeOff className="h-3 w-3 text-gray-500 dark:text-gray-400" /> : <Eye className="h-3 w-3 text-gray-500 dark:text-gray-400" />}
                        </Button>
                      </div>
                      <div className="text-xl font-bold text-gray-900 dark:text-white mb-0.5 tracking-tight">
                        {hideRevenueValue ? "R$ *****" : formatBRL(animatedBalance)}
                      </div>
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Saldo disponível</div>
                      {showAffiliateData && affiliateAvailableBalance > 0 && !hideRevenueValue && (
                        <div className="text-[9px] text-gray-400 dark:text-gray-500 mb-1.5">
                          Vendas: {formatBRL(realAvailableBalance)} + Afiliado: {formatBRL(affiliateAvailableBalance)}
                        </div>
                      )}
                      <Button 
                        onClick={() => setLocation('/dashboard/finances')}
                        className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold h-8 rounded-lg text-[11px] shadow-sm hover:shadow transition-all"
                      >
                        Retirar saldo
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: Total de Vendas */}
              <Card className="bg-white dark:bg-transparent border border-gray-100 dark:border-violet-500/20 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-transparent/50 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    </div>
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white mb-0.5 tracking-tight">{formatBRL(animatedRevenue)}</div>
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Total de Vendas</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">
                    {animatedSalesCount} vendas • Ticket: {formatBRL(animatedSalesCount > 0 ? animatedRevenue / animatedSalesCount : 0)}
                  </div>
                </CardContent>
              </Card>

              {/* Card 3: Taxa de Aprovação */}
              <Card className="bg-white dark:bg-transparent border border-gray-100 dark:border-violet-500/20 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-transparent/50 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    </div>
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white mb-0.5 tracking-tight">
                    {animatedApprovalRate}%
                  </div>
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Taxa de Aprovação</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">
                    Cartão: {animatedCardApprovalRate}% • Pix: {animatedPixApprovalRate}%
                  </div>
                </CardContent>
              </Card>

              {/* Card 4: Assinaturas */}
              <Card className="bg-white dark:bg-transparent border border-gray-100 dark:border-violet-500/20 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-transparent/50 flex items-center justify-center">
                      <Users className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    </div>
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white mb-0.5 tracking-tight">{animatedSubscriptions}</div>
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Assinaturas Ativas</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500">
                    MRR: {formatBRL(subscriptionStats?.mrr || 0)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* REVENUE BREAKDOWN BAR */}
            <div className="bg-white dark:bg-violet-950/30 border border-gray-200 dark:border-violet-500/15 rounded-2xl p-3 md:p-4 mb-4 shadow-sm">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-4">
                {/* Vendas Digitais */}
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="relative flex-shrink-0">
                    <svg className="w-10 h-10 md:w-12 md:h-12 transform -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="18" stroke="#e5e7eb" strokeWidth="4" fill="none" />
                      <circle cx="24" cy="24" r="18" stroke="#10B981" strokeWidth="4" fill="none"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18 - (revenueBreakdown.digital.pct / 100) * 2 * Math.PI * 18}
                        strokeLinecap="round" className="transition-all duration-700" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#10B981' }}>Vendas Digitais</div>
                    <div className="text-base font-bold text-gray-900 dark:text-gray-100">{formatBRL(revenueBreakdown.digital.revenue)}</div>
                    <div className="text-[10px] text-gray-500">{revenueBreakdown.digital.count} vendas</div>
                  </div>
                </div>
                {/* Assinaturas */}
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="relative flex-shrink-0">
                    <svg className="w-10 h-10 md:w-12 md:h-12 transform -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="18" stroke="#e5e7eb" strokeWidth="4" fill="none" />
                      <circle cx="24" cy="24" r="18" stroke="#2563eb" strokeWidth="4" fill="none"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18 - (revenueBreakdown.subscription.pct / 100) * 2 * Math.PI * 18}
                        strokeLinecap="round" className="transition-all duration-700" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#2563eb' }}>Assinaturas</div>
                    <div className="text-base font-bold text-gray-900 dark:text-gray-100">{formatBRL(revenueBreakdown.subscription.revenue)}</div>
                    <div className="text-[10px] text-gray-500">{revenueBreakdown.subscription.count} assinaturas</div>
                  </div>
                </div>
                {/* Order Bump */}
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="relative flex-shrink-0">
                    <svg className="w-10 h-10 md:w-12 md:h-12 transform -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="18" stroke="#e5e7eb" strokeWidth="4" fill="none" />
                      <circle cx="24" cy="24" r="18" stroke="#F59E0B" strokeWidth="4" fill="none"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18 - (revenueBreakdown.orderBump.pct / 100) * 2 * Math.PI * 18}
                        strokeLinecap="round" className="transition-all duration-700" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#F59E0B' }}>Order Bump</div>
                    <div className="text-base font-bold text-gray-900 dark:text-gray-100">{formatBRL(revenueBreakdown.orderBump.revenue)}</div>
                    <div className="text-[10px] text-gray-500">{revenueBreakdown.orderBump.count} vendas</div>
                  </div>
                </div>
                {/* Upsell */}
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="relative flex-shrink-0">
                    <svg className="w-10 h-10 md:w-12 md:h-12 transform -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="18" stroke="#e5e7eb" strokeWidth="4" fill="none" />
                      <circle cx="24" cy="24" r="18" stroke="#06B6D4" strokeWidth="4" fill="none"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18 - (revenueBreakdown.upsell.pct / 100) * 2 * Math.PI * 18}
                        strokeLinecap="round" className="transition-all duration-700" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#06B6D4' }}>Upsell</div>
                    <div className="text-base font-bold text-gray-900 dark:text-gray-100">{formatBRL(revenueBreakdown.upsell.revenue)}</div>
                    <div className="text-[10px] text-gray-500">{revenueBreakdown.upsell.count} vendas</div>
                  </div>
                </div>
                {/* PIX QRCode */}
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="relative flex-shrink-0">
                    <svg className="w-10 h-10 md:w-12 md:h-12 transform -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="18" stroke="#e5e7eb" strokeWidth="4" fill="none" />
                      <circle cx="24" cy="24" r="18" stroke="#22C55E" strokeWidth="4" fill="none"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18 - (revenueBreakdown.pixQr.pct / 100) * 2 * Math.PI * 18}
                        strokeLinecap="round" className="transition-all duration-700" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#22C55E' }}>PIX QRCode</div>
                    <div className="text-base font-bold text-gray-900 dark:text-gray-100">{formatBRL(revenueBreakdown.pixQr.revenue)}</div>
                    <div className="text-[10px] text-gray-500">{revenueBreakdown.pixQr.count} depósitos</div>
                  </div>
                </div>
                {/* Total Sacado */}
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="relative flex-shrink-0">
                    <svg className="w-10 h-10 md:w-12 md:h-12 transform -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="18" stroke="#e5e7eb" strokeWidth="4" fill="none" />
                      <circle cx="24" cy="24" r="18" stroke="#3B82F6" strokeWidth="4" fill="none"
                        strokeDasharray={2 * Math.PI * 18}
                        strokeDashoffset={2 * Math.PI * 18}
                        strokeLinecap="round" className="transition-all duration-700" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#3B82F6' }}>Total Sacado</div>
                    <div className="text-base font-bold text-gray-900 dark:text-gray-100">{formatBRL(revenueBreakdown.totalWithdrawn)}</div>
                    <div className="text-[10px] text-gray-500">saques concluídos</div>
                  </div>
                </div>
              </div>
            </div>


            {/* Gráfico de Picos de Vendas - FILTRO GLOBAL */}
            <Card className="bg-white dark:bg-violet-950/30 border border-gray-200 dark:border-violet-500/15 rounded-2xl shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-3 pt-5 border-b border-gray-200 dark:border-violet-500/15">
                <div>
                  <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-violet-600" />
                    Picos de vendas
                  </CardTitle>
                </div>
                <Select value={dateFilter} onValueChange={(value: any) => setDateFilter(value)}>
                  <SelectTrigger className="w-20 md:w-24 h-8 text-xs border-gray-200 dark:border-violet-500/20 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-100 rounded-lg font-semibold">
                    <Clock className="h-3.5 w-3.5 mr-1.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-800 border-violet-500/30">
                    <SelectItem value="hoje">Hoje</SelectItem>
                    <SelectItem value="ontem">Ontem</SelectItem>
                    <SelectItem value="7d">7 dias</SelectItem>
                    <SelectItem value="15d">15 dias</SelectItem>
                    <SelectItem value="30d">30 dias</SelectItem>
                    <SelectItem value="60d">60 dias</SelectItem>
                    <SelectItem value="90d">90 dias</SelectItem>
                    <SelectItem value="total">Total</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="pt-6 pb-4">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={unifiedChartData}>
                    <defs>
                      <linearGradient id="areaGradientPurple" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25}/>
                        <stop offset="50%" stopColor="#2563eb" stopOpacity={0.08}/>
                        <stop offset="100%" stopColor="#ffffff" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="areaGradientBlue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2}/>
                        <stop offset="50%" stopColor="#4f46e5" stopOpacity={0.07}/>
                        <stop offset="100%" stopColor="#ffffff" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#6B7280" strokeOpacity={0.15} />
                    <XAxis 
                      dataKey="time" 
                      stroke="#d1d5db"
                      tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 500 }}
                      tickLine={{ stroke: '#e5e7eb' }}
                      interval={(dateFilter === "hoje" || dateFilter === "ontem") ? 1 : 0}
                      angle={0}
                      axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                    />
                    <YAxis 
                      stroke="#d1d5db" 
                      tick={{ fill: '#6B7280', fontSize: 12, fontWeight: 500 }}
                      tickLine={{ stroke: '#e5e7eb' }}
                      axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                      tickFormatter={(value) => {
                        if (value === 0) return 'R$ 0';
                        if (value >= 1000) return `R$ ${(value / 1000).toFixed(1)}k`;
                        return `R$ ${value.toFixed(0)}`;
                      }}
                    />
                    <RechartsTooltip 
                      contentStyle={{ 
                        backgroundColor: '#ffffff', 
                        border: '1px solid #e5e7eb',
                        borderRadius: '10px',
                        padding: '10px 14px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)'
                      }}
                      labelStyle={{ 
                        color: '#111827', 
                        fontWeight: '700', 
                        marginBottom: '6px',
                        fontSize: '13px'
                      }}
                      itemStyle={{ 
                        color: '#374151', 
                        fontSize: '13px',
                        fontWeight: 600
                      }}
                      formatter={(value: any) => {
                        const numValue = typeof value === 'number' ? value : 0;
                        return `R$ ${numValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                      }}
                      cursor={{ stroke: '#2563eb', strokeWidth: 1, strokeDasharray: '5 5', strokeOpacity: 0.3 }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Aprovadas" 
                      stroke="#2563eb" 
                      strokeWidth={3}
                      fill="url(#areaGradientPurple)"
                      dot={{ fill: '#2563eb', r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                      activeDot={{ r: 6, strokeWidth: 2, stroke: '#2563eb', fill: '#ffffff' }}
                      name="Vendas Aprovadas"
                      isAnimationActive={true}
                      animationDuration={1500}
                      animationEasing="ease-out"
                      animationBegin={600}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
        </>
      </div>
    </DashboardLayout>
  );
}
