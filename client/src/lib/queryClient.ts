import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { getBrowserId } from "@/lib/browser-session";

// ── Auth token cache ──────────────────────────────────────────────────────────
// Singleton: aguarda auth apenas uma vez (evita N listeners em N requests)
let _authReadyPromise: Promise<void> | null = null;
let _tokenCache: { token: string; expiry: number } | null = null;

function waitForAuthReady(): Promise<void> {
  if (_authReadyPromise) return _authReadyPromise;
  _authReadyPromise = new Promise(resolve => {
    if (auth.currentUser !== null) { resolve(); return; }
    const unsub = auth.onAuthStateChanged(() => { unsub(); resolve(); });
  });
  return _authReadyPromise;
}

// Limpa o cache de token ao fazer logout
auth.onAuthStateChanged(user => {
  if (!user) { _tokenCache = null; _authReadyPromise = null; }
});

async function getAuthToken(): Promise<string | null> {
  try {
    if (!auth.currentUser) await waitForAuthReady();
    const user = auth.currentUser;
    if (!user) return null;
    const now = Date.now();
    if (_tokenCache && now < _tokenCache.expiry) return _tokenCache.token;
    const token = await user.getIdToken();
    _tokenCache = { token, expiry: now + 50 * 60 * 1000 };
    return token;
  } catch {
    return null;
  }
}

// FUNÇÃO AUXILIAR: CRIAR HEADERS COM AUTENTICAÇÃO E BROWSER ID
export async function getAuthHeaders(additionalHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers = { ...additionalHeaders };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Browser-Id'] = getBrowserId();
  }
  
  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    let errorCode = '';
    try {
      const contentType = res.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const errorData = await res.json();
        errorCode = errorData.code || '';
        errorMessage = errorData.message || errorData.error || errorData.details?.message || errorMessage;
        
        // 🔐 BROWSER SESSION CONFLICT - Auto logout
        if (errorCode === 'BROWSER_SESSION_CONFLICT') {
          console.log('🚫 Sessão inválida detectada - fazendo logout...');
          auth.signOut();
          window.location.href = '/login';
          throw new Error('Você fez login em outro navegador. Faça login novamente.');
        }
      } else {
        const text = await res.text();
        if (text && text.includes('unauthorized')) {
          errorMessage = 'Erro de autenticação - Verifique suas credenciais';
        } else if (text) {
          errorMessage = text;
        }
      }
    } catch (error: any) {
      if (error.message?.includes('outro navegador')) {
        throw error;
      }
    }
    throw new Error(errorMessage);
  }
}

export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<Response> {
  // OBTER HEADERS COM AUTENTICAÇÃO
  const baseHeaders: Record<string, string> = {};
  if (data) {
    baseHeaders["Content-Type"] = "application/json";
  }
  const headers = await getAuthHeaders(baseHeaders);
  
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      const headers = await getAuthHeaders();
      
      const res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
        // Aumentar timeout e melhorar configuração para Replit
        signal: AbortSignal.timeout(15000), // 15 segundos - otimizado para performance  
        headers
      });

      // 🔐 CRITICAL: Verificar BROWSER_SESSION_CONFLICT mesmo com returnNull
      if (res.status === 401) {
        try {
          const contentType = res.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            const errorData = await res.json();
            
            // Auto-logout se for conflito de sessão
            if (errorData.code === 'BROWSER_SESSION_CONFLICT') {
              console.log('🚫 Sessão inválida detectada - fazendo logout...');
              auth.signOut();
              window.location.href = '/login';
              throw new Error('Você fez login em outro navegador. Faça login novamente.');
            }
          }
        } catch (error: any) {
          if (error.message?.includes('outro navegador')) {
            throw error;
          }
        }
        
        // Se não for conflito, retornar null ou throw dependendo do comportamento
        if (unauthorizedBehavior === "returnNull") {
          return null;
        }
      }

      await throwIfResNotOk(res);
      
      // Verificar se a resposta é JSON vlido
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Resposta no é JSON: ${text}`);
      }
      
      return await res.json();
    } catch (error: any) {
      // Tratamento otimizado de erros
      if (error?.name === 'AbortError') {
        throw new Error('Timeout de rede');
      }
      if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
        throw new Error('Erro de conexo');
      }
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      retry: (failureCount, error: any) => {
        if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError') || error?.name === 'AbortError') {
          return failureCount < 1;
        }
        return false;
      },
      retryDelay: () => 200,
    },
    mutations: {
      retry: (failureCount, error: any) => {
        if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
          return failureCount < 2;
        }
        if (error?.name === 'AbortError' || error?.message?.includes('timeout')) {
          return failureCount < 1;
        }
        return false;
      },
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 5000),
    },
  },
});
