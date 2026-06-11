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
const BASE_URL = '';

// ── Helper: envia CC_PLAY_SALE_SOUND para todas as janelas abertas ──────────
function notifyOpenWindows(data) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(openClients) {
    openClients.forEach(function(client) {
      client.postMessage({ type: 'CC_PLAY_SALE_SOUND', data: data });
    });
  });
}

messaging.onBackgroundMessage(function(payload) {
  var notif = payload.notification || {};
  var data  = payload.data || {};

  var title = notif.title || data.title || '💰 Venda Aprovada!';
  var body  = notif.body  || data.body  || 'Nova venda realizada!';
  var icon  = notif.icon  || data.icon  || (BASE_URL + '/favicon.png');
  if (!icon.startsWith('http')) icon = BASE_URL + '/favicon.png';

  var clickUrl = (data.click_action) || (BASE_URL + '/dashboard/sales');
  var absUrl   = clickUrl.startsWith('http') ? clickUrl : (BASE_URL + clickUrl);

  var soundData = {
    orderId:     data.orderId,
    amount:      data.amount,
    productName: data.productName,
    title:       title,
    body:        body
  };

  // Notifica janelas abertas para tocar o som imediatamente (foreground)
  notifyOpenWindows(soundData);

  var options = {
    body:    body,
    icon:    icon,
    badge:   BASE_URL + '/favicon.png',
    tag:     data.orderId || ('sale-' + Date.now()),
    requireInteraction: true,
    silent:  false,
    vibrate: [300, 100, 300, 100, 300],
    data: {
      url:         absUrl,
      orderId:     data.orderId,
      amount:      data.amount,
      productName: data.productName,
      soundData:   JSON.stringify(soundData)
    },
    actions: [
      { action: 'open', title: 'Ver Detalhes' }
    ]
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var notifData = event.notification.data || {};
  var soundData = {};
  try { soundData = JSON.parse(notifData.soundData || '{}'); } catch(e) {}

  var baseUrl = notifData.url || (BASE_URL + '/dashboard/sales');
  if (baseUrl.startsWith('/')) baseUrl = BASE_URL + baseUrl;

  // ?cc_sound=1 — initPushSoundBoot no app toca o som ao detectar este param
  var sep        = baseUrl.indexOf('?') >= 0 ? '&' : '?';
  var urlToOpen  = baseUrl + sep + 'cc_sound=1';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if ('focus' in client) {
          // Janela já aberta: postMessage toca o som e foca
          client.postMessage({ type: 'CC_PLAY_SALE_SOUND', data: soundData });
          return client.focus();
        }
      }
      // Sem janela: abre com ?cc_sound=1 para tocar ao carregar
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
