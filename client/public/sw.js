// Firebase Messaging SDK (necessário para getToken() funcionar no iOS PWA)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAnOf55q80gavAmqARCCjbkJK5XWeuAU48',
  authDomain: 'volatuspay-pj.firebaseapp.com',
  databaseURL: 'https://volatuspay-pj-default-rtdb.firebaseio.com',
  projectId: 'volatuspay-pj',
  storageBucket: 'volatuspay-pj.firebasestorage.app',
  messagingSenderId: '240096195703',
  appId: '1:240096195703:web:ff2a6e5a48395b65098272',
  measurementId: 'G-87XMKKW0S7'
});

const messaging = firebase.messaging();

const CACHE_NAME = 'magnora-pay-sw-v6';
const BASE_URL = '';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.mode === 'navigate' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.includes('hot-update') ||
    url.pathname.includes('__vite')
  ) {
    return;
  }

  if (
    url.pathname === '/favicon.png' ||
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/logos/')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});

// ── Helper: envia CC_PLAY_SALE_SOUND para todas as janelas abertas ──────────
function notifyOpenWindows(data) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(openClients) {
    openClients.forEach(function(client) {
      client.postMessage({ type: 'CC_PLAY_SALE_SOUND', data: data });
    });
  });
}

// ── Mensagens em background via Firebase Messaging SDK ───────────────────────
messaging.onBackgroundMessage(function(payload) {
  const notif = payload.notification || {};
  const data  = payload.data || {};

  const title    = notif.title || data.title || '💰 Venda Aprovada!';
  const body     = notif.body  || data.body  || 'Nova venda realizada!';
  const rawIcon  = notif.icon  || data.icon  || '';
  const icon     = rawIcon.startsWith('http') ? rawIcon : (BASE_URL + '/favicon.png');
  const clickUrl = data.click_action || (BASE_URL + '/dashboard/sales');
  const absUrl   = clickUrl.startsWith('http') ? clickUrl : (BASE_URL + clickUrl);

  const soundData = {
    orderId:     data.orderId,
    amount:      data.amount,
    productName: data.productName,
    title:       title,
    body:        body,
  };

  // Notifica janelas abertas para tocar o som (foreground)
  notifyOpenWindows(soundData);

  const options = {
    body,
    icon,
    badge:           BASE_URL + '/favicon.png',
    tag:             data.tag || data.orderId || notif.tag || 'sale-notification',
    data: {
      url:         absUrl,
      orderId:     data.orderId,
      amount:      data.amount,
      productName: data.productName,
      soundData:   JSON.stringify(soundData),
    },
    actions:         [{ action: 'open', title: 'Ver Detalhes' }],
    vibrate:         [200, 100, 200],
    requireInteraction: true,
    silent:          false,
  };

  return self.registration.showNotification(title, options);
});

// ── Toque na notificação ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  let soundData = {};
  try { soundData = JSON.parse(notifData.soundData || '{}'); } catch {}

  const baseUrl  = notifData.url || (BASE_URL + '/dashboard/sales');
  // Adiciona ?cc_sound=1 para que initPushSoundBoot toque o som ao abrir
  const sep      = baseUrl.indexOf('?') >= 0 ? '&' : '?';
  const urlToOpen = baseUrl + sep + 'cc_sound=1';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (var i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          // Janela já aberta: manda o som via postMessage e foca
          client.postMessage({ type: 'CC_PLAY_SALE_SOUND', data: soundData });
          return client.focus();
        }
      }
      // Sem janela aberta: abre nova com o param de som na URL
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
