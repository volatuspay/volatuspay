import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, setupSingleSession, cleanupSession } from '@/lib/firebase';
import type { User, Tenant } from '@shared/schema';
import { isSellerRegistrationPending } from '@/lib/registration-state';


import { useTenantStore } from '@/stores/tenant';
import { maskUID, maskEmail } from '@/lib/user-display';
import { setupWindowSession, cleanupWindowSession } from '@/lib/window-session';

// Helper para criar tenant virtual para sellers
export function createSellerTenant(user: User): Tenant {
  return {
    id: user.uid,
    name: user.displayName || user.email?.split('@')[0] || 'Meu Negócio',
    ownerId: user.uid,
    isTestMode: false,
    testMode: false,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  initialized: boolean;
  setUser: (user: User | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  subscribeWithSelector((set, get) => ({
    user: null,
    isAdmin: false,
    loading: true,
    initialized: false,
    setUser: (user) => set({ user }),
    setIsAdmin: (isAdmin) => set({ isAdmin }),
    setLoading: (loading) => set({ loading }),
    setInitialized: (initialized) => set({ initialized }),
  }))
);

if (auth.currentUser) {
  const cu = auth.currentUser;
  useAuthStore.getState().setUser({
    uid: cu.uid,
    email: cu.email!,
    displayName: cu.displayName,
    photoURL: cu.photoURL,
  });
}

// Guarda de sessão: impede que tracking de dispositivo seja chamado mais de uma vez
// por sessão do navegador (evita cascata de chamadas em token refresh)
const _deviceTrackingDone = new Set<string>();

onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
  const { setUser, setIsAdmin, setLoading, setInitialized, loading, initialized } = useAuthStore.getState();
  const { setTenant, setLoading: setTenantLoading, tenant: currentTenant } = useTenantStore.getState();
  
  try {
    if (firebaseUser) {
      const user: User = {
        uid: firebaseUser.uid,
        email: firebaseUser.email!,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
      };
      
      // Armazenar UID globalmente para verificaes de segurana
      (window as any).__FIREBASE_USER_UID__ = user.uid;
      
      // Indicador de sessão para proteção server-side do painel admin
      document.cookie = 'vp_auth=1; path=/; SameSite=Strict; max-age=86400';
      
      // SINGLE SESSION DESABILITADO - Permitir mltiplos dispositivos na mesma rede
      // setupSingleSession(user.uid).catch(err => {
      //   console.warn('Erro ao configurar single session:', err);
      // });
      
      // WINDOW SESSION DESABILITADO - Permitir mltiplas abas e dispositivos
      // Usuário pediu para permitir:
      // Mltiplas abas no mesmo navegador
      // Mltiplos dispositivos (PC + celular) no mesmo IP (mesma casa/rede)
      // setupWindowSession(user.uid, async () => {
      //   console.log('Outra janela detectada - fazendo logout automático');
      //   try {
      //     await auth.signOut();
      //     window.location.href = '/';
      //   } catch (error) {
      //     console.error('Erro ao fazer logout:', error);
      //     window.location.href = '/';
      //   }
      // }).catch(err => {
      //   console.warn('Erro ao configurar window session:', err);
      // });
      
      // Security: User authentication completed
      setUser(user);

      // ⚡ SKIP: se o tenant já está carregado para este usuário (re-disparo por refresh de token),
      // não refaz toda a verificação — evita flash de spinner e redirect acidental
      const tenantAlreadyLoaded = currentTenant && (currentTenant.id === user.uid || currentTenant.ownerId === user.uid);
      if (tenantAlreadyLoaded && initialized) {
        setLoading(false);
        setInitialized(true);
        return;
      }

      // ⚡ Verificar admin via Custom Claims do token (não expõe emails)
      let isAdminUser = false;
      try {
        const tokenResult = await firebaseUser.getIdTokenResult();
        isAdminUser = tokenResult.claims?.admin === true || tokenResult.claims?.superAdmin === true;
      } catch {}
      setIsAdmin(isAdminUser);
      
      // CARREGAR TENANT AUTOMATICAMENTE
      console.log('Carregando tenant para usuário:', maskUID(user.uid));
      setTenantLoading(true);
      
      try {
        // ⚡ ADMIN SHORTCUT: Não fazer queries desnecessárias para admin
        if (isAdminUser) {
          console.log(`ADMIN DETECTADO via token claims: ${maskEmail(user.email || '')} - pulando verificação seller`);
          setTenant(null);
          setTenantLoading(false);
          setLoading(false);
          setInitialized(true);
          return; // Admin não precisa de tenant
        }
        
        let isSeller = false;

        // PRIORIDADE 1: Registro em andamento — evita race condition com o Firestore
        if (isSellerRegistrationPending()) {
          console.log('Registro seller em andamento: pulando API check, tratando como seller');
          isSeller = true;
          try { localStorage.setItem(`cc_is_seller_${user.uid}`, 'true'); } catch {}
        }

        // PRIORIDADE 2: Cache local
        if (!isSeller) {
          try {
            if (localStorage.getItem(`cc_is_seller_${user.uid}`) === 'true') {
              console.log('Cache local encontrado: SELLER (skip API)');
              isSeller = true;
            }
          } catch {}
        }

        // PRIORIDADE 3: Consulta API (apenas se não vier do cache nem do registro)
        if (!isSeller) {
          try {
            const idToken = await firebaseUser.getIdToken();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const sellerRes = await fetch('/api/auth/seller-status', {
              headers: { 'Authorization': `Bearer ${idToken}` },
              signal: controller.signal
            });
            clearTimeout(timeout);
            if (sellerRes.ok) {
              const sellerData = await sellerRes.json();
              isSeller = sellerData.isSeller === true;
              if (isSeller) {
                try { localStorage.setItem(`cc_is_seller_${user.uid}`, 'true'); } catch {}
              }
            }
          } catch (sellerCheckError) {
            console.warn('Erro/timeout ao verificar seller status via API:', sellerCheckError);
          }
        }
        console.log(`Verificação seller: ${maskUID(user.uid)} ${isSeller ? 'SELLER' : 'NÃO SELLER'}`);
        
        // PRIORIDADE 4: Verificar se é membro de time de algum seller
        if (!isSeller) {
          try {
            const idToken = await firebaseUser.getIdToken();
            const controller4 = new AbortController();
            const timeout4 = setTimeout(() => controller4.abort(), 5000);
            const teamRes = await fetch('/api/seller/team/my-seller', {
              headers: { 'Authorization': `Bearer ${idToken}` },
              signal: controller4.signal,
            });
            clearTimeout(timeout4);
            if (teamRes.ok) {
              const teamData = await teamRes.json();
              if (teamData.isMember && teamData.sellerUid) {
                const { useSellerTeamStore } = await import('@/stores/seller-team');
                useSellerTeamStore.getState().setTeamContext({
                  sellerOwnerUid: teamData.sellerUid,
                  teamRole: teamData.role,
                  memberName: teamData.name || '',
                });
                useSellerTeamStore.getState().setChecked(true);
                // Carrega tenant do dono — queries usam o UID do seller owner
                const ownerTenant = createSellerTenant({
                  uid: teamData.sellerUid,
                  email: teamData.name || 'membro',
                  displayName: teamData.name || null,
                  photoURL: null,
                });
                setTenant(ownerTenant);
                setTenantLoading(false);
                setLoading(false);
                setInitialized(true);
                console.log('MEMBRO DE TIME DETECTADO - tenant do seller carregado');
                return; // Sair — não precisa de device tracking nem tenant do próprio usuário
              }
            }
          } catch (teamErr) {
            console.warn('Erro ao verificar team membership (não crítico):', teamErr);
          }
        }

        if (isSeller) {
          // Para sellers: usar UID como tenantId diretamente
          const sellerTenant = createSellerTenant(user);
          console.log(`SELLER TENANT CARREGADO AUTOMATICAMENTE: ${maskUID(sellerTenant.id)}`);
          setTenant(sellerTenant);
          
          // RASTREAMENTO AUTOMTICO DE DISPOSITIVO (LOGIN TRACKING)
          // Guarda: executa apenas UMA vez por sessão por usuário (evita cascata em token refresh)
          if (_deviceTrackingDone.has(user.uid)) {
            console.log('Device tracking já executado nesta sessão - ignorando re-disparo');
          } else {
          _deviceTrackingDone.add(user.uid);
          (async () => {
            try {
              console.log('Coletando device fingerprint para tracking...');
              const { getDeviceFingerprint } = await import('@/lib/device-fingerprint');
              const deviceFingerprint = await getDeviceFingerprint(true);
              
              console.log('Enviando device fingerprint para backend...');
              const idToken = await firebaseUser.getIdToken();
              const { getBrowserId } = await import('@/lib/browser-session');
              const browserId = getBrowserId();
              
              const response = await fetch('/api/sellers/track-login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${idToken}`,
                  'X-Browser-Id': browserId
                },
                body: JSON.stringify({ deviceFingerprint })
              });
              
              const result = await response.json();
              
              if (result.success && result.deviceChanged) {
                console.log('NOVO DISPOSITIVO DETECTADO - Histrico atualizado');
              } else {
                console.log('Device tracking concludo - Mesmo dispositivo');
              }

              // COLETA RETROATIVA DE DADOS TCNICOS (para sellers antigos sem dados)
              try {
                console.log('Verificando se precisa atualizar dados técnicos...');
                const updateResponse = await fetch('/api/sellers/update-device-fingerprint', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                    'X-Browser-Id': browserId
                  },
                  body: JSON.stringify({ deviceFingerprint })
                });

                const updateResult = await updateResponse.json();
                
                if (updateResult.success && updateResult.updated) {
                  console.log('DADOS TCNICOS COLETADOS RETROATIVAMENTE com sucesso!');
                } else if (updateResult.alreadyExists) {
                  console.log('Dados técnicos já existem');
                } else {
                  console.log('Resposta inesperada:', updateResult);
                }
              } catch (updateError) {
                console.warn('Erro ao atualizar dados técnicos (no crtico):', updateError);
                // No bloqueia o login se a atualização falhar
              }

            } catch (trackingError) {
              console.warn('Erro no tracking de dispositivo (no crtico):', trackingError);
              // No bloqueia o login se o tracking falhar
            }
          })();
          } // fim guarda _deviceTrackingDone
        } else {
          // Para no-sellers: buscar tenant via API (fix permission-denied)
          try {
            const idToken = await firebaseUser.getIdToken();
            const response = await fetch('/api/tenants/me', {
              headers: {
                'Authorization': `Bearer ${idToken}`
              }
            });
            
            if (response.ok) {
              const userTenant = await response.json();
              console.log(`Tenant encontrado: ${userTenant ? maskUID(userTenant.id) : 'NENHUM'}`);
              
              if (userTenant) {
                console.log(`TENANT CARREGADO AUTOMATICAMENTE: ${maskUID(userTenant.id)}`);
                setTenant(userTenant);
              } else {
                console.log("NÃO SELLER - sem tenant ok");
                setTenant(null);
              }
            } else if (response.status === 401) {
              console.warn('Não autenticado ao buscar tenant (401)');
              setTenant(null);
            } else if (response.status >= 500) {
              console.error(`Erro de servidor ${response.status} ao buscar tenant - sistema temporariamente indisponível`);
              // Em erro de servidor, permitir login mas sem tenant
              setTenant(null);
            } else {
              console.warn(`Erro ${response.status} ao buscar tenant, continuando sem tenant`);
              setTenant(null);
            }
          } catch (apiError) {
            console.warn('Erro ao buscar tenant via API:', apiError);
            setTenant(null);
          }
        }
      } catch (tenantError) {
        console.error('Erro ao carregar tenant:', tenantError);
        setTenant(null);
      } finally {
        setTenantLoading(false);
      }
    } else {
      console.log('Auth listener: usuário deslogado');
      
      // Limpar indicador de sessão
      document.cookie = 'vp_auth=; path=/; SameSite=Strict; max-age=0';
      
      // Limpar single session
      cleanupSession();
      
      // Limpar window session
      cleanupWindowSession();
      
      // Limpar UID global
      delete (window as any).__FIREBASE_USER_UID__;
      
      setUser(null);
      setTenant(null); // Limpar tenant quando usuário faz logout
    }
    
    setLoading(false);
    setInitialized(true);
  } catch (error) {
    console.error('Erro no auth listener:', error);
    // Resolver loading mesmo com erro, mas NÃO deslogar se o firebaseUser ainda existe
    setLoading(false);
    setInitialized(true);
    setTenantLoading(false);
    // Só limpa user/tenant se o Firebase realmente não tem usuário autenticado
    if (!firebaseUser) {
      setUser(null);
      setTenant(null);
    }
  }
});

setTimeout(() => {
  const { loading, initialized } = useAuthStore.getState();
  
  if (loading || !initialized) {
    console.warn('TIMEOUT: Resolvendo estado de auth após 5s');
    useAuthStore.getState().setLoading(false);
    useAuthStore.getState().setInitialized(true);
  }
}, 5000);
