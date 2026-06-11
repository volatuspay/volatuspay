import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { getInstallations, deleteInstallations } from 'firebase/installations';
import app, { auth } from './firebase';
import { playNotificationSound } from './notification-sound';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
let _messagingListenerActive = false;
let _swSoundListenerActive = false;

if (!VAPID_KEY) {
  console.warn('[PUSH] ⚠️ VITE_FIREBASE_VAPID_KEY nao configurado — notificacoes push desativadas.');
}

/** Detecta iPhone/iPad/iPod */
function isIOSDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

/** Detecta se está rodando como PWA instalada (tela de início) */
function isRunningAsStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  );
}

// Listener de mensagens vindas do Service Worker (background → aba aberta)
// O SW envia CC_PLAY_SALE_SOUND quando recebe uma notificação em background
function initSwSoundListener(): void {
  if (_swSoundListenerActive || !('serviceWorker' in navigator)) return;
  _swSoundListenerActive = true;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if (!event.data || event.data.type !== 'CC_PLAY_SALE_SOUND') return;
    console.log('[PUSH] SW → app: tocando somvenda.mp3 (background)');
    playNotificationSound();
    // Despacha evento para o dashboard mostrar o toast in-app também
    const d = event.data.data || {};
    window.dispatchEvent(new CustomEvent('cc-sale-notification', {
      detail: {
        title: d.title || '💰 Venda Aprovada!',
        body: d.body || '',
        productName: d.productName || '',
        amount: d.amount || '',
        orderId: d.orderId || '',
      }
    }));
  });
  console.log('[PUSH] SW sound listener ativo');
}

/**
 * Inicializa o listener de som do SW e verifica se o app foi aberto
 * via toque em notificação (cc_sound=1 na URL). Se sim, toca somvenda.mp3.
 * Chamar no boot do app (App.tsx), sem depender de login.
 */
export function initPushSoundBoot(): void {
  initSwSoundListener();
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cc_sound') === '1') {
      console.log('[PUSH] cc_sound=1 detectado na URL — tocando somvenda.mp3');
      playNotificationSound();
      // Remove o parâmetro da URL sem recarregar a página
      params.delete('cc_sound');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      window.history.replaceState(null, '', newUrl);
    }
  } catch {}
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.log('[PUSH] Notification API nao suportada');
    return false;
  }

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    console.log('[PUSH] Permissao negada — usuario deve habilitar nas configs do navegador');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    console.log('[PUSH] Permissao resultado:', permission);
    return permission === 'granted';
  } catch (error) {
    console.error('[PUSH] Erro ao pedir permissao:', error);
    return false;
  }
}

export async function registerPushToken(userId: string): Promise<string | null> {
  try {
    const messaging = getMessaging(app);

    // Limpa instalação Firebase anterior (resolve erro 403 PERMISSION_DENIED de cache corrompido)
    try {
      const installations = getInstallations(app);
      await deleteInstallations(installations);
      console.log('[PUSH] Instalação anterior removida — iniciando nova...');
    } catch (delErr: any) {
      // Ignora erro de deleção — pode não existir instalação prévia
      console.warn('[PUSH] deleteInstallations ignorado:', delErr?.code || delErr?.message);
    }

    // sw.js agora contém Firebase Messaging SDK — passar o SW ativo ao getToken()
    // evita que o Firebase auto-registre firebase-messaging-sw.js em paralelo
    let swReg: ServiceWorkerRegistration | undefined;
    try {
      swReg = await navigator.serviceWorker.ready;
      console.log('[PUSH] SW ativo encontrado, escopo:', swReg.scope);
    } catch (err) {
      console.error('[PUSH] navigator.serviceWorker.ready falhou:', err);
    }

    let currentToken: string | null = null;
    let lastTokenErr: string = '';

    // Tentativa 1: com o SW ativo (melhor compatibilidade iOS/Android)
    if (swReg) {
      try {
        currentToken = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: swReg,
        });
        console.log('[PUSH] getToken() com SW explícito: sucesso');
      } catch (err1: any) {
        lastTokenErr = err1?.message || err1?.code || String(err1);
        console.warn('[PUSH] getToken() com SW falhou:', lastTokenErr);
      }
    }

    // Tentativa 2: sem serviceWorkerRegistration (Firebase detecta firebase-messaging-sw.js)
    if (!currentToken) {
      try {
        currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
        console.log('[PUSH] getToken() sem SW explícito: sucesso');
      } catch (err2: any) {
        const msg = err2?.message || err2?.code || String(err2);
        console.error('[PUSH] getToken() sem SW também falhou:', msg);

        // Detecta o erro 403 do Firebase Installations e mostra mensagem amigável
        const is403 = msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('installations/request-failed');
        if (is403) {
          throw new Error('Serviço de notificações temporariamente indisponível. Aguarde alguns segundos e tente novamente.');
        }

        throw new Error(`FCM getToken falhou: ${msg}${lastTokenErr ? ` | SW: ${lastTokenErr}` : ''}`);
      }
    }

    if (!currentToken) {
      throw new Error('FCM retornou token vazio — verifique VAPID key e configuração do projeto Firebase');
    }

    console.log('[PUSH] Token FCM obtido:', currentToken.slice(0, 20) + '...');

    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      console.warn('[PUSH] Sem auth token para salvar push token');
      return null;
    }

    const response = await fetch('/api/sellers/push-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ token: currentToken }),
    });

    if (!response.ok) {
      console.error('[PUSH] Falha ao salvar token:', await response.text());
      return null;
    }

    console.log('[PUSH] Token FCM salvo com sucesso — userId:', userId.slice(0, 8));

    // Listener de mensagens do SW → aba aberta (background sound) — singleton
    initSwSoundListener();

    // Listener de mensagens foreground — singleton (evita duplicatas se registerPushToken chamado várias vezes)
    if (!_messagingListenerActive) {
      _messagingListenerActive = true;
      onMessage(messaging, (payload) => {
        console.log('[PUSH] Mensagem foreground recebida:', payload);

        playNotificationSound();

        // Despacha evento para o dashboard mostrar toast in-app com nome e valor
        const saleData = {
          title: payload.notification?.title || payload.data?.title || '💰 Venda Aprovada!',
          body: payload.notification?.body || payload.data?.body || 'Nova venda realizada!',
          productName: payload.data?.productName || '',
          amount: payload.data?.amount || '',
          orderId: payload.data?.orderId || '',
        };
        window.dispatchEvent(new CustomEvent('cc-sale-notification', { detail: saleData }));

        if (Notification.permission === 'granted') {
          const BASE_URL = window.location.origin;
          const title = payload.notification?.title || payload.data?.title || '💰 Venda Aprovada!';
          const body = payload.notification?.body || payload.data?.body || 'Nova venda realizada!';
          const icon = `${BASE_URL}/favicon.png`;
          const clickUrl = payload.data?.click_action || `${BASE_URL}/dashboard/sales`;
          const absUrl = clickUrl.startsWith('/') ? `${BASE_URL}${clickUrl}` : clickUrl;
          const orderId = payload.data?.orderId || `sale-${Date.now()}`;

          // iOS PWA requer showNotification via Service Worker — new Notification() não funciona no iOS
          navigator.serviceWorker.ready.then((reg) => {
            reg.showNotification(title, {
              body,
              icon,
              badge: `${BASE_URL}/favicon.png`,
              tag: orderId,
              requireInteraction: true,
              silent: false,
              vibrate: [200, 100, 200],
              data: { url: absUrl, orderId, amount: payload.data?.amount, productName: payload.data?.productName },
              actions: [{ action: 'open', title: 'Ver Detalhes' }],
            } as any);
          }).catch(() => {
            // Fallback para browsers sem SW (desktop Chrome/Firefox)
            try {
              const notif = new Notification(title, {
                body,
                icon,
                badge: `${BASE_URL}/favicon.png`,
                tag: orderId,
                requireInteraction: true,
                data: { url: absUrl },
              } as any);
              notif.onclick = () => { window.focus(); window.location.href = absUrl; notif.close(); };
            } catch {}
          });
        }
      });
    }

    return currentToken;
  } catch (error: any) {
    console.error('[PUSH] Erro em registerPushToken:', error?.message || error);
    // Re-lança para que initPushNotifications mostre o erro real ao usuário
    throw error;
  }
}

export async function removePushToken(): Promise<void> {
  try {
    const messaging = getMessaging(app);
    const swReg = await navigator.serviceWorker.ready.catch(() => undefined);

    let currentToken: string | null = null;
    try {
      currentToken = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swReg,
      });
    } catch (tokenErr: any) {
      // Se não consegue obter token para remover, limpa a instalação local e sai
      console.warn('[PUSH] removePushToken — getToken falhou (ignorado):', tokenErr?.code || tokenErr?.message);
      try { await deleteInstallations(getInstallations(app)); } catch {}
      return;
    }

    if (!currentToken) return;

    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;

    await fetch('/api/sellers/push-token', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ token: currentToken }),
    });

    console.log('[PUSH] Token removido');
  } catch (error) {
    console.error('[PUSH] Erro ao remover token:', error);
  }
}

export type PushInitResult =
  | { success: true; token: string }
  | { success: false; reason: 'no_vapid_key' | 'not_supported' | 'permission_denied' | 'token_failed' | 'error'; message?: string };

/**
 * Inicializa push COM pedido de permissão ao usuário.
 * Chamar apenas quando o usuário clica em "Registrar Este Dispositivo".
 * Retorna resultado detalhado para o UI mostrar mensagem correta.
 */
export async function initPushNotifications(userId: string): Promise<PushInitResult> {
  if (!VAPID_KEY) {
    console.warn('[PUSH] Skipping — VAPID key nao configurada');
    return { success: false, reason: 'no_vapid_key', message: 'VAPID key não configurada' };
  }

  // iOS Safari no browser (não está como PWA) não suporta Push API
  // Deve estar em standalone (adicionado à Tela de Início) para funcionar
  if (isIOSDevice() && !isRunningAsStandalone()) {
    console.log('[PUSH] iOS browser detectado — notificações requerem PWA standalone');
    return {
      success: false,
      reason: 'not_supported',
      message: 'No iPhone/iPad, abra este app pela Tela de Início (não pelo Safari). Toque em Compartilhar → Adicionar à Tela de Início.',
    };
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[PUSH] Push nao suportado neste navegador/dispositivo');
    return {
      success: false,
      reason: 'not_supported',
      message: 'Notificações push não são suportadas neste navegador. Tente pelo Chrome (Android) ou adicione à Tela de Início (iPhone).',
    };
  }

  try {
    const granted = await requestNotificationPermission();
    if (!granted) {
      console.log('[PUSH] Permissao nao concedida');
      const denied = 'Notification' in window && Notification.permission === 'denied';
      return {
        success: false,
        reason: 'permission_denied',
        message: denied
          ? 'Permissão bloqueada — habilite notificações nas configurações do navegador'
          : 'Permissão não concedida',
      };
    }

    const token = await registerPushToken(userId);
    if (!token) {
      return { success: false, reason: 'token_failed', message: 'Não foi possível obter o token FCM' };
    }

    console.log('[PUSH] Notificacoes push inicializadas com sucesso');
    return { success: true, token };
  } catch (error: any) {
    console.error('[PUSH] Erro ao inicializar push:', error);
    return { success: false, reason: 'error', message: error?.message || 'Erro desconhecido' };
  }
}

/**
 * Inicializa push SEM pedir permissão — silencioso.
 * Usar no auto-init do dashboard: só registra se o usuário já concedeu permissão.
 * Nunca mostra diálogo de permissão automaticamente.
 */
export async function initPushNotificationsQuietly(userId: string): Promise<void> {
  if (!VAPID_KEY) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // Só registra se permissão já foi concedida — sem pedir ao usuário
  if (Notification.permission !== 'granted') {
    console.log('[PUSH] Auto-init silencioso — permissao ainda nao concedida, aguardando usuario registrar.');
    return;
  }

  try {
    const token = await registerPushToken(userId);
    if (token) {
      console.log('[PUSH] Auto-init silencioso: token atualizado com sucesso');
    }
  } catch (error) {
    console.error('[PUSH] Erro no auto-init silencioso:', error);
  }
}
