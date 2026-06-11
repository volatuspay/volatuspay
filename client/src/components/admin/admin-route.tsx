import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuthStore } from '@/stores/auth';
import { Admin2FAVerify } from '@/components/admin/admin-2fa-verify';
import { useAdmin2FAStore } from '@/stores/admin-2fa';
import { auth } from '@/lib/firebase';

interface AdminRouteProps {
  children: ReactNode;
}

// 🔒 2FA TEMPORARIAMENTE DESATIVADO — mudar para false para reativar
const ADMIN_2FA_ENABLED = false;

export const AdminRoute = ({ children }: AdminRouteProps) => {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, initialized } = useAuthStore();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const { isVerified, isSessionValid, setVerified } = useAdmin2FAStore();

  useEffect(() => {
    if (!initialized || authLoading) return;

    if (!user) {
      setLocation('/');
      return;
    }

    const verify = async () => {
      try {
        let isAdminClaim = false;
        try {
          const tokenResult = await auth.currentUser?.getIdTokenResult();
          isAdminClaim = tokenResult?.claims?.admin === true || tokenResult?.claims?.superAdmin === true;
        } catch {}

        if (!isAdminClaim) {
          try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
              setLocation('/dashboard');
              return;
            }
            const { getBrowserId } = await import('@/lib/browser-session');
            const browserId = getBrowserId();
            const response = await fetch(`/api/user-type/${user.uid}`, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'X-Browser-Id': browserId
              }
            });
            if (!response.ok) {
              setLocation('/dashboard');
              return;
            }
            const data = await response.json();
            if (data.type !== 'admin') {
              setLocation('/dashboard');
              return;
            }
          } catch {
            setLocation('/dashboard');
            return;
          }
        }

        setIsAdmin(true);

        // 2FA desativado temporariamente
        if (!ADMIN_2FA_ENABLED) {
          setRequires2FA(false);
          return;
        }

        // Se localStorage já tem sessão válida, não precisa checar o servidor
        if (isSessionValid()) {
          setRequires2FA(false);
          return;
        }

        // Consultar servidor para verificar sessão 2FA
        try {
          const token = await auth.currentUser?.getIdToken();
          if (token) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const statusRes = await fetch('/api/admin/2fa/status', {
              headers: { 'Authorization': `Bearer ${token}` },
              signal: controller.signal
            });
            clearTimeout(timeout);
            const status = await statusRes.json();
            if (status.verified) {
              setVerified(true);
              setRequires2FA(false);
            } else if (status.requires2FA && !status.verified) {
              setRequires2FA(true);
            }
          }
        } catch {
          // Timeout ou erro na rede → liberar acesso (fail-open)
        }
      } finally {
        setChecked(true);
      }
    };

    verify();
  }, [user, initialized, authLoading, setLocation, isSessionValid, setVerified]);

  if (!initialized || authLoading || !checked) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
        <span className="ml-2 text-gray-600">Verificando permissões...</span>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  if (requires2FA && !isVerified) {
    return <Admin2FAVerify onVerified={() => setRequires2FA(false)} mode="login" />;
  }

  return (
    <>
      {children}
    </>
  );
};
