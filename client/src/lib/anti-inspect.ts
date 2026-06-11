/**
 * 🛡️ SISTEMA ANTI-INSPEÇÃO — VolatusPay
 * Detecta DevTools REAIS abertos (não só atalhos)
 * Só ativa fora de localhost/dev
 */

type TriggerCallback = () => void;

const IS_DEV =
  import.meta.env.DEV ||
  window.location.hostname === 'localhost' ||
  window.location.hostname.includes('replit.dev');

// ─── DETECÇÃO REAL #1: DIFERENÇA DE TAMANHO DA JANELA ─────────────────────────
// Funciona quando DevTools está dockado (lateral ou inferior)
function isDevToolsOpenBySize(): boolean {
  const threshold = 160;
  return (
    window.outerWidth - window.innerWidth > threshold ||
    window.outerHeight - window.innerHeight > threshold
  );
}

// ─── DETECÇÃO REAL #2: toString trick (Chrome / Edge) ─────────────────────────
// Quando DevTools está aberto o getter de `id` de um Image é chamado ao logar
let toStringDetected = false;
function setupToStringTrick(): void {
  if (toStringDetected) return;
  const element = new Image();
  Object.defineProperty(element, 'id', {
    get() {
      toStringDetected = true;
      return '';
    },
    configurable: true,
  });
  // Silencia o log no console visível — apenas dispara o getter internamente
  const noop = () => {};
  const orig = console.log;
  console.log = noop;
  try {
    console.log('%c', element);
  } finally {
    console.log = orig;
  }
}

// ─── DETECÇÃO REAL #3: resize ao dockar/descockar DevTools ────────────────────
// Quando o usuário abre DevTools pelo menu ou pelo botão da barra do browser,
// o resize é disparado antes de qualquer teclado.
function handleResize(): void {
  if (isDevToolsOpenBySize()) triggerGlobal();
}

// ─── DETECÇÃO REAL #4: console.clear detectado ───────────────────────────────
// DevTools injeta um console.clear quando aberto pela primeira vez
function setupConsoleClearTrap(onTrigger: TriggerCallback): () => void {
  const origClear = console.clear;
  console.clear = function () {
    origClear.apply(console);
    onTrigger();
  };
  return () => {
    console.clear = origClear;
  };
}

// ─── ESTADO GLOBAL ─────────────────────────────────────────────────────────────
let triggerGlobal: () => void = () => {};
let pollingInterval: ReturnType<typeof setInterval> | null = null;

// ─── INICIALIZAÇÃO ─────────────────────────────────────────────────────────────
export function initAntiInspect(onTrigger: TriggerCallback): () => void {
  if (IS_DEV) return () => {};

  let triggered = false;

  function trigger() {
    if (triggered) return;
    triggered = true;
    onTrigger();
  }

  triggerGlobal = trigger;

  // 1. Bloquear atalhos de teclado (previne a rota fácil)
  function handleKeyDown(e: KeyboardEvent) {
    // F12
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Ctrl+Shift+I / J / C
    if (
      e.ctrlKey &&
      e.shiftKey &&
      ['i', 'I', 'j', 'J', 'c', 'C'].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Ctrl+U (ver fonte)
    if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // 2. Bloquear clique-direito
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  // 3. Polling contínuo (500ms) — detecta abertura pelo menu do browser
  pollingInterval = setInterval(() => {
    if (isDevToolsOpenBySize()) trigger();

    // Checar toString trick acumulado
    setupToStringTrick();
    if (toStringDetected) trigger();
  }, 500);

  // 4. Detectar via resize (DevTools dockando/desdockando)
  window.addEventListener('resize', handleResize, { passive: true });

  // 5. Console.clear trap (DevTools limpa console ao abrir)
  const restoreConsoleClear = setupConsoleClearTrap(trigger);

  // 6. Checar imediatamente (já estava aberto antes de carregar)
  setTimeout(() => {
    if (isDevToolsOpenBySize()) trigger();
    setupToStringTrick();
    if (toStringDetected) trigger();
  }, 300);

  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('contextmenu', handleContextMenu, true);

  return () => {
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('contextmenu', handleContextMenu, true);
    window.removeEventListener('resize', handleResize);
    restoreConsoleClear();
    if (pollingInterval) clearInterval(pollingInterval);
  };
}
