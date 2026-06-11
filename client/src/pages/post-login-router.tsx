import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { auth } from "@/lib/firebase";
import { getBrowserId } from "@/lib/browser-session";

export default function PostLoginRouter() {
  const hasRoutedRef = useRef(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (hasRoutedRef.current) return;
    hasRoutedRef.current = true;

    const routeUser = async () => {
      try {
        let firebaseUser = auth.currentUser;
        if (!firebaseUser) {
          await new Promise(resolve => setTimeout(resolve, 500));
          firebaseUser = auth.currentUser;
        }

        if (!firebaseUser) {
          setLocation('/');
          return;
        }

        try {
          const tokenResult = await firebaseUser.getIdTokenResult();
          const isAdminClaim = tokenResult.claims?.admin === true || tokenResult.claims?.superAdmin === true;
          if (isAdminClaim) {
            setLocation('/admin/dashboard');
            return;
          }
        } catch {}

        try {
          if (localStorage.getItem(`cc_is_seller_${firebaseUser.uid}`) === 'true') {
            console.log('[PostLoginRouter] Cache local: SELLER - redirect imediato');
            setLocation('/dashboard');
            return;
          }
        } catch {}

        const token = await firebaseUser.getIdToken();
        const browserId = getBrowserId();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        let result: any = null;
        try {
          const response = await fetch(`/api/user-type/${firebaseUser.uid}`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Browser-Id': browserId
            },
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (response.ok) {
            result = await response.json();
          }
        } catch (e) {
          clearTimeout(timeout);
          console.warn('[PostLoginRouter] user-type API falhou/timeout:', e);
        }

        if (result) {
          if (result.type === 'seller') {
            try { localStorage.setItem(`cc_is_seller_${firebaseUser.uid}`, 'true'); } catch {}
            setLocation('/dashboard');
          } else if (result.type === 'admin') {
            setLocation('/admin/dashboard');
          } else {
            setLocation('/members-dashboard');
          }
          return;
        }

        let isSeller = false;
        try {
          const ctrl2 = new AbortController();
          const t2 = setTimeout(() => ctrl2.abort(), 5000);
          const sellerRes = await fetch('/api/auth/seller-status', {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: ctrl2.signal
          });
          clearTimeout(t2);
          if (sellerRes.ok) {
            const sd = await sellerRes.json();
            isSeller = sd.isSeller === true;
            if (isSeller) {
              try { localStorage.setItem(`cc_is_seller_${firebaseUser.uid}`, 'true'); } catch {}
            }
          }
        } catch (e) {
          console.warn('[PostLoginRouter] seller-status API falhou/timeout:', e);
        }

        setLocation(isSeller ? '/dashboard' : '/members-dashboard');
      } catch (error) {
        console.error('[PostLoginRouter] Erro geral:', error);
        try {
          const uid = auth.currentUser?.uid;
          if (uid && localStorage.getItem(`cc_is_seller_${uid}`) === 'true') {
            setLocation('/dashboard');
            return;
          }
        } catch {}
        setLocation('/members-dashboard');
      }
    };

    routeUser();
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-lg font-medium text-foreground">Carregando dashboard...</p>
      </div>
    </div>
  );
}
