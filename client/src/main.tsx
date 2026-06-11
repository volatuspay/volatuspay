import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// CACHE BUSTING - FORÇA ATUALIZAÇÃO EM PRODUÇÃO v2
console.log('VolatusPay Frontend v2 - Build:', new Date().toISOString());

// Detecta quando um chunk lazy-loaded falha (hash mudou após novo deploy)
// e recarrega a página para buscar o HTML atualizado com os hashes novos
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

// Safety net: captura erros de import dinâmico não tratados
window.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message || '';
  if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('Importing a module script failed')) {
    event.preventDefault();
    window.location.reload();
  }
});

// SDK EFIBANK CARREGADO SOB DEMANDA NOS COMPONENTES - SEM DUPLICAÇÃO

// CACHE BUSTING SIMPLIFICADO (apenas para debug quando necessário)
if (typeof window !== 'undefined' && window.location.search.includes('_debug_cache=1')) {
  const lastReload = localStorage.getItem('lastCacheReload');
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  if (!lastReload || parseInt(lastReload) < oneHourAgo) {
    localStorage.setItem('lastCacheReload', Date.now().toString());
  }
}

createRoot(document.getElementById("root")!).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
        // Força verificação de atualização do SW — essencial no iOS PWA
        registration.update().catch(() => {});

        // Quando um novo SW está aguardando, ativa imediatamente
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && registration.active) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}
