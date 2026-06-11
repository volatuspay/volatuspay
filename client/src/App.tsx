import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/theme-context";
import "./lib/i18n"; // Inicializar i18n globalmente
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { CustomDialogProvider } from "@/hooks/use-custom-dialog";
import { useState, useEffect } from "react";
import * as React from "react";
import { AdminRoute } from "@/components/admin/admin-route";
import { useToast } from "@/hooks/use-toast";
import { useBannersPrefetch } from "@/hooks/use-banner-prefetch";
import { initBrowserSession } from "@/lib/browser-session";
import { initPushSoundBoot } from "@/lib/push-notifications";
import { AntiInspectOverlay } from "@/components/anti-inspect-overlay";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";

initBrowserSession();
initPushSoundBoot();

function AuthLoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "#ffffff" }} data-testid="loading-auth">
      <img src="/favicon.png?v=2" alt="VolatusPay" style={{ height: "48px", width: "48px", objectFit: "contain" }} />
      <div className="animate-spin w-6 h-6 border-2 border-t-transparent rounded-full" style={{ borderColor: "#2563eb", borderTopColor: "transparent" }} />
    </div>
  );
}

// ERROR BOUNDARY - PREVENIR TELA BRANCA
function isChunkLoadError(error: Error): boolean {
  const msg = error?.message || error?.toString() || '';
  return (
    msg.includes('Loading chunk') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('ChunkLoadError') ||
    error?.name === 'ChunkLoadError'
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    console.error('[ErrorBoundary] Erro capturado:', error);
    // Se for erro de chunk desatualizado (após deploy), recarrega automaticamente
    if (isChunkLoadError(error)) {
      const reloadKey = 'cc_chunk_reload_at';
      const lastReload = Number(sessionStorage.getItem(reloadKey) || '0');
      const now = Date.now();
      if (now - lastReload > 10000) {
        sessionStorage.setItem(reloadKey, String(now));
        window.location.reload();
        return { hasError: false, error: null };
      }
    }
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Detalhes:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: "#050505" }}>
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-6xl"></div>
            <h1 className="text-2xl font-bold text-white">Algo deu errado</h1>
            <p className="text-gray-400">
              Estamos com um problema técnico. Por favor, recarregue a página.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 text-black rounded-lg transition font-semibold"
              style={{ background: "#72FC2D" }}
            >
              Recarregar Página
            </button>
            {this.state.error && (
              <details className="text-left text-xs text-gray-500 mt-4">
                <summary className="cursor-pointer">Detalhes técnicos</summary>
                <pre className="mt-2 p-2 bg-gray-900 rounded overflow-auto text-gray-400">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Componentes de layout e auth (usados inline - precisam ser síncronos)
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { PublicPageWrapper } from "@/components/layout/public-page-wrapper";
import DashboardLayout from "@/components/layout/dashboard-layout";

// Lazy loading com auto-reload em erro de chunk (chunks desatualizados após deploy)
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    factory().catch((err) => {
      if (isChunkLoadError(err)) {
        const reloadKey = 'cc_chunk_reload_at';
        const lastReload = Number(sessionStorage.getItem(reloadKey) || '0');
        const now = Date.now();
        if (now - lastReload > 10000) {
          sessionStorage.setItem(reloadKey, String(now));
          window.location.reload();
          return new Promise<never>(() => {});
        }
      }
      throw err;
    })
  );
}

const Landing = lazyWithRetry(() => import("@/pages/landing"));
const NotFound = lazyWithRetry(() => import("@/pages/not-found"));
const Privacy = lazyWithRetry(() => import("@/pages/legal/privacy"));
const Terms = lazyWithRetry(() => import("@/pages/legal/terms"));
const Refund = lazyWithRetry(() => import("@/pages/legal/refund"));
const Denuncia = lazyWithRetry(() => import("@/pages/legal/denuncia"));
const Chargeback = lazyWithRetry(() => import("@/pages/legal/chargeback"));
const Compliance = lazyWithRetry(() => import("@/pages/legal/compliance"));
const DadosTecnicos = lazyWithRetry(() => import("@/pages/legal/dados-tecnicos"));
const DigitalProducts = lazyWithRetry(() => import("@/pages/products/digital"));
const MembersAreaPage = lazyWithRetry(() => import("@/pages/products/members-area"));
const LoginPage = lazyWithRetry(() => import("@/pages/auth/login"));
const RegisterPage = lazyWithRetry(() => import("@/pages/auth/register"));
const ImpersonatePage = lazyWithRetry(() => import("@/pages/auth/impersonate"));
const Dashboard = lazyWithRetry(() => import("@/pages/dashboard/index"));
const Members = lazyWithRetry(() => import("@/pages/dashboard/members"));
const MyPurchases = lazyWithRetry(() => import("@/pages/dashboard/my-purchases"));
const Settings = lazyWithRetry(() => import("@/pages/dashboard/settings"));
const SellerProfile = lazyWithRetry(() => import("@/pages/dashboard/settings/profile"));
const SellerFees = lazyWithRetry(() => import("@/pages/dashboard/settings/fees"));
const Integrations = lazyWithRetry(() => import("@/pages/dashboard/integrations"));
const AwardsPage = lazyWithRetry(() => import("@/pages/dashboard/awards"));
const PremiationsPage = lazyWithRetry(() => import("@/pages/dashboard/premiations"));
const SalesPage = lazyWithRetry(() => import("@/pages/dashboard/sales"));
const FinancesPage = lazyWithRetry(() => import("@/pages/dashboard/finances"));
const WithdrawalCryptoPage = lazyWithRetry(() => import("@/pages/dashboard/withdrawal-crypto"));
const BankingDataPage = lazyWithRetry(() => import("@/pages/dashboard/banking-data"));
const SubscriptionsPage = lazyWithRetry(() => import("@/pages/dashboard/subscriptions"));
const ProductsListPage = lazyWithRetry(() => import("@/pages/dashboard/products-list"));
const ProductDetailPage = lazyWithRetry(() => import("@/pages/dashboard/product-detail"));
const ShowcasePage = lazyWithRetry(() => import("@/pages/dashboard/showcase"));
const MyAffiliationsPage = lazyWithRetry(() => import("@/pages/dashboard/my-affiliations"));
const CoproductionInvitesPage = lazyWithRetry(() => import("@/pages/dashboard/coproduction-invites"));
const ReportsPage = lazyWithRetry(() => import("@/pages/dashboard/reports"));
const SellerTeamPage = lazyWithRetry(() => import("@/pages/dashboard/team"));
const CheckoutPage = lazyWithRetry(() => import("@/pages/checkout/[slug]"));
const AffiliateInvitePage = lazyWithRetry(() => import("@/pages/affiliate-invite"));
const SellerRegister = lazyWithRetry(() => import("@/pages/seller/register-new"));
const SellerRegisterComplete = lazyWithRetry(() => import("@/pages/seller/register-complete"));
const AdminDashboard = lazyWithRetry(() => import("@/pages/admin/dashboard"));
const AdminSupport = lazyWithRetry(() => import("@/pages/admin/support"));
const AdminSupportTickets = lazyWithRetry(() => import("@/pages/admin/support-tickets"));
const AdminSellers = lazyWithRetry(() => import("@/pages/admin/sellers"));
const AdminManageSellers = lazyWithRetry(() => import("@/pages/admin/manage-sellers"));
const AdminPreRegistro = lazyWithRetry(() => import("@/pages/admin/pre-registro"));
const AdminWithdrawals = lazyWithRetry(() => import("@/pages/admin/withdrawals"));
const AdminRefunds = lazyWithRetry(() => import("@/pages/admin/refunds"));
const AdminDisputes = lazyWithRetry(() => import("@/pages/admin/disputes"));
const AdminSecurity = lazyWithRetry(() => import("@/pages/admin/security"));
const KYCReport = lazyWithRetry(() => import("@/pages/admin/kyc-report"));
const MembersArea = lazyWithRetry(() => import("@/pages/members/[productId]"));
const MyBalance = lazyWithRetry(() => import("@/pages/my-balance"));
const PurchaseHistory = lazyWithRetry(() => import("@/pages/members/purchase-history"));
const AffiliateSignup = lazyWithRetry(() => import("@/pages/affiliate-signup"));
const SejaSocio = lazyWithRetry(() => import("@/pages/seja-socio"));
const WhitelabelPage = lazyWithRetry(() => import("@/pages/whitelabel"));
const PostLoginRouter = lazyWithRetry(() => import("@/pages/post-login-router"));
const AdminRefundWithdrawals = lazyWithRetry(() => import("@/pages/admin/refund-withdrawals"));
const AdminWithdrawalFee = lazyWithRetry(() => import("@/pages/admin/withdrawal-fee"));
const AdminProducts = lazyWithRetry(() => import("@/pages/admin/products"));
const AdminProductsBlocked = lazyWithRetry(() => import("@/pages/admin/products-blocked"));
const AdminProductsRisk = lazyWithRetry(() => import("@/pages/admin/products-risk"));
const AdminBanners = lazyWithRetry(() => import("@/pages/admin/banners"));
const AIChatPage = lazyWithRetry(() => import("@/pages/ai-chat"));
const AdminTransactions = lazyWithRetry(() => import("@/pages/admin/transactions"));
const SellersRiskPage = lazyWithRetry(() => import("@/pages/admin/sellers-risk"));
const CompanyApprovalsPage = lazyWithRetry(() => import("@/pages/admin/company-approvals"));
const AffiliateApprovalsPage = lazyWithRetry(() => import("@/pages/admin/affiliate-approvals"));
const AdminConfigurations = lazyWithRetry(() => import("@/pages/admin/configurations"));
const AdminImpersonate = lazyWithRetry(() => import("@/pages/admin-impersonate"));
const StripeSettingsPage = lazyWithRetry(() => import("@/pages/admin/stripe-settings").then(m => ({ default: m.StripeSettingsPage })));
const PaymentConfigPage = lazyWithRetry(() => import("@/pages/admin/payment-config"));
const AcquirersPage = lazyWithRetry(() => import("@/pages/admin/acquirers"));
const SuccessPage = lazyWithRetry(() => import("@/pages/success"));
const OfferPage = lazyWithRetry(() => import("@/pages/offer"));
const DocsPage = lazyWithRetry(() => import("@/pages/docs"));
const MyTicketsPage = lazyWithRetry(() => import("@/pages/my-tickets"));
const PremiationsAdmin = lazyWithRetry(() => import("@/pages/admin/premiations"));
const AdminTeam = lazyWithRetry(() => import("@/pages/admin/team"));
const AdminRoles = lazyWithRetry(() => import("@/pages/admin/roles"));
const FixOrderPage = lazyWithRetry(() => import("@/pages/admin/fix-order"));
const MembersDashboard = lazyWithRetry(() => import("@/pages/members-dashboard"));
const MembersAuthPage = lazyWithRetry(() => import("@/pages/members-auth"));
const CustomerLoginPage = lazyWithRetry(() => import("@/pages/customer/login"));
const CustomerAreaPage = lazyWithRetry(() => import("@/pages/customer/area"));
const CustomerMemberAreaPage = lazyWithRetry(() => import("@/pages/customer/member-area"));

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, initialized } = useAuthStore();

  if (loading || !initialized) {
    return <AuthLoadingScreen />;
  }

  if (!user) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

// Public Route Component (redirects to dashboard if logged in)
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, initialized } = useAuthStore();

  if (loading || !initialized) {
    return <AuthLoadingScreen />;
  }

  // No redirecionar automaticamente para dashboard - deixar o login form fazer isso baseado no tipo de usuário
  // if (user) {
  //   return <Redirect to="/dashboard" />;
  // }

  return <>{children}</>;
}

function SellerProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, initialized } = useAuthStore();
  const { tenant, loading: tenantLoading, setTenant, setLoading: setTenantLoading } = useTenantStore();
  const [retried, setRetried] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!user || tenantLoading || tenant || retried || retrying) return;
    const { isAdmin } = useAuthStore.getState();
    if (isAdmin) return;

    // Cache local primeiro: se o usuário já foi identificado como seller, não precisamos chamar a API
    let cachedSeller = false;
    try {
      cachedSeller = localStorage.getItem(`cc_is_seller_${user.uid}`) === 'true';
    } catch {}
    if (cachedSeller) {
      let cancelledCache = false;
      (async () => {
        const { createSellerTenant } = await import('@/stores/auth');
        if (!cancelledCache) {
          setTenant(createSellerTenant({ uid: user.uid, email: user.email || '', displayName: user.displayName, photoURL: user.photoURL }));
          setRetried(true);
        }
      })();
      return () => { cancelledCache = true; };
    }

    let cancelled = false;
    setRetrying(true);
    (async () => {
      try {
        const { auth } = await import('@/lib/firebase');
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) { setRetried(true); setRetrying(false); return; }
        let detectedSeller = false;
        try {
          const token = await firebaseUser.getIdToken(false);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const res = await fetch('/api/auth/seller-status', {
              headers: { 'Authorization': `Bearer ${token}` },
              signal: controller.signal
            });
            clearTimeout(timeout);
            if (res.ok) {
              const data = await res.json();
              detectedSeller = data.isSeller === true;
              if (detectedSeller) {
                try { localStorage.setItem(`cc_is_seller_${user.uid}`, 'true'); } catch {}
              }
            }
          } catch (fetchErr: any) {
            clearTimeout(timeout);
            if (fetchErr.name !== 'AbortError') throw fetchErr;
            console.warn('[SellerProtectedRoute] seller-status timeout após 8s');
          }
        } catch (e) {
          console.warn('[SellerProtectedRoute] API seller-status failed:', e);
        }
        if (detectedSeller && !cancelled) {
          const { createSellerTenant } = await import('@/stores/auth');
          setTenant(createSellerTenant({ uid: user.uid, email: user.email || '', displayName: user.displayName, photoURL: user.photoURL }));
        }
      } catch (e) {
        console.warn('[SellerProtectedRoute] Retry seller check failed:', e);
      } finally {
        if (!cancelled) { setRetried(true); setRetrying(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [user, tenantLoading, tenant, retried, retrying]);

  if (loading || !initialized) {
    return <AuthLoadingScreen />;
  }

  if (!user) {
    return <Redirect to="/" />;
  }

  if (!tenant && (tenantLoading || retrying || !retried)) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#050505" }} data-testid="loading-seller-check">
        <div className="animate-spin w-8 h-8 border-4 border-t-transparent rounded-full" style={{ borderColor: "#72FC2D", borderTopColor: "transparent" }} />
      </div>
    );
  }

  const { isAdmin } = useAuthStore.getState();
  if (isAdmin) {
    return <>{children}</>;
  }

  if (!tenant) {
    return <Redirect to="/members-dashboard" />;
  }

  return <>{children}</>;
}


function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function Router() {
  return (
    <>
    <ScrollToTop />
    <Switch>
      {/* Landing Page */}
      <Route path="/">
        <Landing />
      </Route>

      {/* Auth Pages - Full Screen */}
      <Route path="/login" component={LoginPage} />
      <Route path="/entrar">
        {() => {
          const search = typeof window !== 'undefined' ? window.location.search : '';
          const redirectTo = new URLSearchParams(search).get('redirect') || '';
          return <Redirect to={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login'} />;
        }}
      </Route>
      <Route path="/register" component={RegisterPage} />
      <Route path="/areademembros" component={MembersAuthPage} />
      <Route path="/members-dashboard" component={MembersDashboard} />
      
      {/* Customer Member Area - Login sem senha para clientes que compraram */}
      <Route path="/customer-login" component={CustomerLoginPage} />
      <Route path="/customer-area" component={CustomerAreaPage} />
      <Route path="/customer-area/member/:productId" component={CustomerMemberAreaPage} />

      {/* Legal Pages */}
      <Route path="/legal/privacy" component={Privacy} />
      <Route path="/legal/terms" component={Terms} />
      <Route path="/legal/refund" component={Refund} />
      <Route path="/legal/denuncia" component={Denuncia} />
      <Route path="/legal/chargeback" component={Chargeback} />
      <Route path="/legal/compliance" component={Compliance} />
      <Route path="/legal/dados-tecnicos" component={DadosTecnicos} />

      {/* Product Pages */}
      <Route path="/products/digital" component={DigitalProducts} />
      <Route path="/products/members-area" component={MembersAreaPage} />
      
      {/* Seja Scio - Oportunidade de sociedade */}
      <Route path="/seja-socio" component={SejaSocio} />
      
      {/* Whitelabel - Solução gateway personalizado */}
      <Route path="/whitelabel" component={WhitelabelPage} />
      
      {/* Showcase/Vitrine - Redireciona para dashboard/showcase */}
      <Route path="/showcase/product/:id" component={ProductDetailPage} />
      <Route path="/showcase">
        <Redirect to="/dashboard/showcase" />
      </Route>
      
      {/* Affiliate Signup - Página para se afiliar a um produto especfico */}
      <Route path="/affiliate/:slug" component={AffiliateSignup} />

      {/* Auth Routes - Redirecionamento para landing com popup */}
      <Route path="/auth/login">
        <PublicPageWrapper>
          <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <LoginForm />
          </div>
        </PublicPageWrapper>
      </Route>
      
      <Route path="/auth/register" component={RegisterPage} />
      
      {/* Impersonation - Login automático via custom token */}
      <Route path="/auth/impersonate" component={ImpersonatePage} />

      <Route path="/seller/register">
        <PublicPageWrapper>
          <SellerRegister />
        </PublicPageWrapper>
      </Route>

      <Route path="/seller/register-complete">
        <PublicPageWrapper>
          <SellerRegisterComplete />
        </PublicPageWrapper>
      </Route>

      {/* Admin Dashboard */}
      <Route path="/admin">
        <Redirect to="/admin/dashboard" />
      </Route>

      <Route path="/admin/dashboard">
        <AdminRoute>
          <AdminDashboard />
        </AdminRoute>
      </Route>

      <Route path="/admin/support">
        <AdminRoute>
          <AdminSupport />
        </AdminRoute>
      </Route>

      <Route path="/admin/support-tickets">
        <AdminRoute>
          <AdminSupportTickets />
        </AdminRoute>
      </Route>

      <Route path="/admin/sellers">
        <AdminRoute>
          <AdminSellers />
        </AdminRoute>
      </Route>

      <Route path="/admin/pre-registro">
        <AdminRoute>
          <AdminPreRegistro />
        </AdminRoute>
      </Route>

      <Route path="/admin/manage-sellers">
        <AdminRoute>
          <AdminManageSellers />
        </AdminRoute>
      </Route>

      <Route path="/admin/sellers-risk">
        <AdminRoute>
          <SellersRiskPage />
        </AdminRoute>
      </Route>

      <Route path="/admin/company-approvals">
        <AdminRoute>
          <CompanyApprovalsPage />
        </AdminRoute>
      </Route>

      <Route path="/admin/affiliate-approvals">
        <AdminRoute>
          <AffiliateApprovalsPage />
        </AdminRoute>
      </Route>

      <Route path="/admin/products">
        <AdminRoute>
          <AdminProducts />
        </AdminRoute>
      </Route>

      <Route path="/admin/products/blocked">
        <AdminRoute>
          <AdminProductsBlocked />
        </AdminRoute>
      </Route>

      <Route path="/admin/products/risk">
        <AdminRoute>
          <AdminProductsRisk />
        </AdminRoute>
      </Route>

      <Route path="/admin/banners">
        <AdminRoute>
          <AdminBanners />
        </AdminRoute>
      </Route>


      <Route path="/admin/transactions">
        <AdminRoute>
          <AdminTransactions />
        </AdminRoute>
      </Route>

      <Route path="/admin/withdrawals">
        <AdminRoute>
          <AdminWithdrawals />
        </AdminRoute>
      </Route>

      <Route path="/admin/refunds">
        <AdminRoute>
          <AdminRefunds />
        </AdminRoute>
      </Route>
      
      <Route path="/admin/disputes">
        <AdminRoute>
          <AdminDisputes />
        </AdminRoute>
      </Route>
      
      <Route path="/admin/refund-withdrawals">
        <AdminRoute>
          <AdminRefundWithdrawals />
        </AdminRoute>
      </Route>

      <Route path="/admin/withdrawal-fee">
        <AdminRoute>
          <AdminWithdrawalFee />
        </AdminRoute>
      </Route>

      <Route path="/admin/acquirers">
        <AdminRoute>
          <AcquirersPage />
        </AdminRoute>
      </Route>

      <Route path="/admin/configurations">
        <AdminRoute>
          <AdminConfigurations />
        </AdminRoute>
      </Route>

      <Route path="/admin/stripe-settings">
        <AdminRoute>
          <StripeSettingsPage />
        </AdminRoute>
      </Route>

      <Route path="/admin/payment-config">
        <Redirect to="/admin/acquirers" />
      </Route>

      <Route path="/admin/security">
        <AdminRoute>
          <DashboardLayout>
            <AdminSecurity />
          </DashboardLayout>
        </AdminRoute>
      </Route>

      <Route path="/admin/kyc-report">
        <AdminRoute>
          <KYCReport />
        </AdminRoute>
      </Route>

      <Route path="/admin/premiations">
        <AdminRoute>
          <DashboardLayout>
            <PremiationsAdmin />
          </DashboardLayout>
        </AdminRoute>
      </Route>

      <Route path="/admin/team">
        <AdminRoute>
          <DashboardLayout>
            <AdminTeam />
          </DashboardLayout>
        </AdminRoute>
      </Route>

      <Route path="/admin/roles">
        <AdminRoute>
          <DashboardLayout>
            <AdminRoles />
          </DashboardLayout>
        </AdminRoute>
      </Route>

      <Route path="/admin/fix-order">
        <AdminRoute>
          <DashboardLayout>
            <FixOrderPage />
          </DashboardLayout>
        </AdminRoute>
      </Route>

      {/* Admin Impersonation - acesso temporrio s contas dos sellers */}
      <Route path="/admin-impersonate" component={AdminImpersonate} />

      {/* Admin Dashboard removido - movido para pasta unused */}

      {/* SELLER DASHBOARD ROUTES - Sellers podem acessar */}
      <Route path="/dashboard">
        <SellerProtectedRoute>
          <Dashboard />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/products-list">
        <SellerProtectedRoute>
          <ProductsListPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/showcase">
        <SellerProtectedRoute>
          <ShowcasePage />
        </SellerProtectedRoute>
      </Route>
      
      <Route path="/dashboard/my-affiliations">
        <SellerProtectedRoute>
          <MyAffiliationsPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/coproduction-invites">
        <SellerProtectedRoute>
          <CoproductionInvitesPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/product-detail/:id">
        <SellerProtectedRoute>
          <ProductDetailPage />
        </SellerProtectedRoute>
      </Route>


      <Route path="/dashboard/sales">
        <SellerProtectedRoute>
          <SalesPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/subscriptions">
        <SellerProtectedRoute>
          <SubscriptionsPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/finances">
        <SellerProtectedRoute>
          <FinancesPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/withdrawal-crypto">
        <SellerProtectedRoute>
          <WithdrawalCryptoPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/banking-data">
        <SellerProtectedRoute>
          <BankingDataPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/premiations">
        <SellerProtectedRoute>
          <PremiationsPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/reports">
        <SellerProtectedRoute>
          <ReportsPage />
        </SellerProtectedRoute>
      </Route>


      <Route path="/dashboard/team">
        <SellerProtectedRoute>
          <DashboardLayout>
            <SellerTeamPage />
          </DashboardLayout>
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/ai-chat">
        <SellerProtectedRoute>
          <AIChatPage />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/members">
        <SellerProtectedRoute>
          <Members />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/my-purchases">
        <SellerProtectedRoute>
          <MyPurchases />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/settings">
        <SellerProtectedRoute>
          <Settings />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/settings/profile">
        <SellerProtectedRoute>
          <SellerProfile />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/settings/fees">
        <SellerProtectedRoute>
          <SellerFees />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/integrations">
        <SellerProtectedRoute>
          <Integrations />
        </SellerProtectedRoute>
      </Route>

      <Route path="/dashboard/awards">
        <SellerProtectedRoute>
          <AwardsPage />
        </SellerProtectedRoute>
      </Route>



      <Route path="/my-tickets">
        <SellerProtectedRoute>
          <MyTicketsPage />
        </SellerProtectedRoute>
      </Route>

      {/* Members Area */}
      <Route path="/members/:productId">
        <ProtectedRoute>
          <MembersArea />
        </ProtectedRoute>
      </Route>

      {/* POST-LOGIN ROUTER - Redirecionamento transparente após login */}
      {/* Sem ProtectedRoute: PostLoginRouter verifica auth.currentUser diretamente (evita race com zustand) */}
      <Route path="/auth/route">
        <PostLoginRouter />
      </Route>

      {/* CUSTOMER ROUTES - Rotas antigas mantidas para retrocompatibilidade */}
      <Route path="/my-balance">
        <ProtectedRoute>
          <MyBalance />
        </ProtectedRoute>
      </Route>

      <Route path="/purchase-history">
        <ProtectedRoute>
          <PurchaseHistory />
        </ProtectedRoute>
      </Route>

      {/* Success Page */}
      <Route path="/success" component={SuccessPage} />
      
      {/* Offer Page - Upsell/Downsell */}
      <Route path="/offer" component={OfferPage} />
      
      {/* API Documentation */}
      <Route path="/docs" component={DocsPage} />



      {/* Public Checkout Routes */}
      <Route path="/checkout/:slug">
        <PublicPageWrapper>
          <CheckoutPage />
        </PublicPageWrapper>
      </Route>

      {/* LEGACY CHECKOUT ROUTES - Compatibilidade com URLs antigas */}
      <Route path="/c/:slug">
        <PublicPageWrapper>
          <CheckoutPage />
        </PublicPageWrapper>
      </Route>

      {/* Página de Convite de Afiliado */}
      <Route path="/convite/:checkoutId">
        <AffiliateInvitePage />
      </Route>

      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
    </>
  );
}

// Componente para aplicar SEO globalmente
function SEOWrapper({ children }: { children: React.ReactNode }) {
  // useSEOConfig(); // 🔥 DESABILITADO - Arquivo não existe
  return <>{children}</>;
}

// Componente para pré-carregar banners crticos
function BannerPrefetchWrapper({ children }: { children: React.ReactNode }) {
  useBannersPrefetch(); // Pré-carrega banners de login/register/dashboard/award
  return <>{children}</>;
}

// ── PWA Login Gate ────────────────────────────────────────────────────────────
// Quando o app está instalado na tela inicial (standalone), exibe apenas
// a tela de login vertical. No navegador normal, nada muda.
function usePWAStandalone() {
  const [isPWA] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      (window.navigator as any).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches
    );
  });
  return isPWA;
}

function PWALoginScreen() {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: "#050505" }}
    >
      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <img
          src="/logo-volatuspay.png"
          alt="VolatusPay"
          style={{ height: "40px", width: "auto", objectFit: "contain" }}
          onError={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            el.style.display = "none";
            const next = el.nextElementSibling as HTMLElement | null;
            if (next) next.style.display = "block";
          }}
        />
        <span
          className="font-bold text-2xl text-white"
          style={{ display: "none" }}
        >
          VolatusPay
        </span>
      </div>

      {/* Formulário de login reutilizado */}
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}

function PWALoginGate({ children }: { children: React.ReactNode }) {
  const isPWA = usePWAStandalone();
  const { user, loading, initialized } = useAuthStore();

  // Fora do modo standalone → comportamento normal do navegador
  if (!isPWA) return <>{children}</>;

  // Aguarda inicialização do auth
  if (loading || !initialized) return <AuthLoadingScreen />;

  // PWA + sem sessão → tela de login limpa
  if (!user) return <PWALoginScreen />;

  // PWA + logado → app normal
  return <>{children}</>;
}

function App() {
  const { toast } = useToast();

  // 🔐 AUTO-LOGOUT POR INATIVIDADE (30 MIN)
  const { user } = useAuthStore();
  useIdleTimeout(!!user);

  // LISTENER PARA SESSÃO INVALIDADA (1 LOGIN POR VEZ)
  React.useEffect(() => {
    const handleSessionInvalidated = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.warn('Sesso invalidada:', customEvent.detail);
      
      toast({
        title: " Vocfoi deslogado",
        description: "Outra pessoa acessou sua conta de outro dispositivo ou navegador.",
        variant: "destructive",
        duration: 5000,
      });
    };
    
    window.addEventListener('session-invalidated', handleSessionInvalidated);
    
    return () => {
      window.removeEventListener('session-invalidated', handleSessionInvalidated);
    };
  }, [toast]);

  return (
    <ErrorBoundary>
      <AntiInspectOverlay />
      <QueryClientProvider client={queryClient}>
        <BannerPrefetchWrapper>
          <ThemeProvider defaultTheme="dark" storageKey="zen-theme">
            <TooltipProvider>
              <CustomDialogProvider>
                <SEOWrapper>
                  <Toaster />
                  <React.Suspense fallback={<AuthLoadingScreen />}>
                    <PWALoginGate>
                      <Router />
                    </PWALoginGate>
                  </React.Suspense>
                </SEOWrapper>
              </CustomDialogProvider>
            </TooltipProvider>
          </ThemeProvider>
        </BannerPrefetchWrapper>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
