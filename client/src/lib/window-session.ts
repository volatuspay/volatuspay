// SISTEMA DE CONTROLE DE NAVEGADORES COM FIRESTORE
// PERMITE: Mltiplas ABAS no mesmo NAVEGADOR (Chrome com 10 abas = OK)
// BLOQUEIA: Mltiplos NAVEGADORES (Chrome + Firefox = BLOQUEIA)
// SALVA ETERNAMENTE NO FIRESTORE para sincronizao cross-browser

import { doc, setDoc, onSnapshot, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

let windowSessionId: string | null = null;
let browserSessionId: string | null = null;
let currentUserId: string | null = null;
let storageListener: ((e: StorageEvent) => void) | null = null;
let firestoreUnsubscribe: (() => void) | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null; // Handle do intervalo
let isInitialized = false;
let lastUpdateTimestamp: number = 0;

// FALLBACK DE MEMÓRIA para quando localStorage/sessionStorage não funcionam (iOS Safari private mode)
const memoryStorage: { [key: string]: string } = {};

// CACHE dos wrappers para evitar testes repetidos
let cachedLocalStorage: any = null;
let cachedSessionStorage: any = null;

// WRAPPER SEGURO para localStorage (funciona em TODOS os celulares)
function safeLocalStorage() {
  if (cachedLocalStorage) return cachedLocalStorage;
  
  try {
    // Testar diretamente no window.localStorage (sem recursão!)
    const test = window.localStorage;
    test.setItem('__test__', '1');
    test.removeItem('__test__');
    cachedLocalStorage = test;
    return test;
  } catch (e) {
    // localStorage bloqueado (iOS Safari private mode) - usar fallback de memória
    cachedLocalStorage = {
      getItem: (key: string) => memoryStorage[key] || null,
      setItem: (key: string, value: string) => { memoryStorage[key] = value; },
      removeItem: (key: string) => { delete memoryStorage[key]; }
    };
    return cachedLocalStorage;
  }
}

// WRAPPER SEGURO para sessionStorage (funciona em TODOS os celulares)
function safeSessionStorage() {
  if (cachedSessionStorage) return cachedSessionStorage;
  
  try {
    // Testar diretamente no window.sessionStorage (sem recursão!)
    const test = window.sessionStorage;
    test.setItem('__test__', '1');
    test.removeItem('__test__');
    cachedSessionStorage = test;
    return test;
  } catch (e) {
    // sessionStorage bloqueado (iOS Safari private mode) - usar fallback de memória
    cachedSessionStorage = {
      getItem: (key: string) => memoryStorage[`session_${key}`] || null,
      setItem: (key: string, value: string) => { memoryStorage[`session_${key}`] = value; },
      removeItem: (key: string) => { delete memoryStorage[`session_${key}`]; }
    };
    return cachedSessionStorage;
  }
}

/**
 * Gera um ID nico para esta aba especfica
 * Cada aba tem seu prprio windowId (sessionStorage)
 */
function generateWindowId(): string {
  return `window_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Gera ou obtém o ID do NAVEGADOR (no da aba)
 * Este ID é compartilhado entre TODAS as abas do mesmo navegador (localStorage)
 * Diferencia Chrome de Firefox, mas no aba1 de aba2 no mesmo Chrome
 */
function getOrCreateBrowserId(): string {
  const storage = safeLocalStorage();
  let browserId = storage.getItem('browserSessionId');
  
  if (!browserId) {
    browserId = `browser_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    storage.setItem('browserSessionId', browserId);
    console.log('Novo navegador registrado:', browserId.substring(0, 25));
  } else {
    console.log('Navegador existente:', browserId.substring(0, 25));
  }
  
  return browserId;
}

/**
 * Obtém ou cria o ID da aba atual
 * sessionStorage é nico por aba (diferente do localStorage)
 */
function getOrCreateWindowId(): string {
  const storage = safeSessionStorage();
  let windowId = storage.getItem('windowSessionId');
  
  if (!windowId) {
    windowId = generateWindowId();
    storage.setItem('windowSessionId', windowId);
    console.log('Nova aba criada:', windowId.substring(0, 20));
  } else {
    console.log('Aba existente:', windowId.substring(0, 20));
  }
  
  return windowId;
}

/**
 * Registra esta janela como ativa NO FIRESTORE
 * SALVAMENTO ETERNO para sincronizao cross-browser
 */
async function registerWindow(userId: string, windowId: string, browserId: string) {
  const now = Date.now();
  const activeWindow = {
    windowId,
    browserId, // ID do NAVEGADOR (compartilhado entre abas)
    userId,
    timestamp: now,
    lastSeen: now, // usar timestamp local se Firestore falhar
    userAgent: navigator.userAgent.substring(0, 100)
  };
  
  lastUpdateTimestamp = now;
  
  try {
    const sessionRef = doc(db, 'browserSessions', userId);
    await setDoc(sessionRef, { ...activeWindow, lastSeen: serverTimestamp() }, { merge: false });
  } catch (error: any) {
    if (error?.code === 'permission-denied' || error?.code === 'resource-exhausted') {
      console.warn('Firestore indisponível - usando apenas localStorage');
    } else {
      console.warn('Sessão Firestore fallback localStorage:', error?.code || error?.message?.substring(0, 40));
    }
  }
  
  // Sempre manter no localStorage como fallback
  safeLocalStorage().setItem('activeWindow', JSON.stringify(activeWindow));
}

/**
 * Verifica se existe OUTRO NAVEGADOR ativo para este usuário (FIRESTORE)
 * PERMITE: Mltiplas abas no MESMO navegador (browserId igual)
 * BLOQUEIA: OUTRO navegador (browserId diferente)
 */
async function checkForOtherBrowsers(userId: string, currentBrowserId: string): Promise<boolean> {
  try {
    // Tentar localStorage primeiro (rpido)
    const activeWindowData = safeLocalStorage().getItem('activeWindow');
    
    if (activeWindowData) {
      const activeWindow = JSON.parse(activeWindowData);
      
      if (activeWindow.userId === userId && activeWindow.browserId !== currentBrowserId) {
        const timeDiff = Date.now() - activeWindow.timestamp;
        const isStillActive = timeDiff < 10000;
        
        if (isStillActive) {
          console.log('OUTRO NAVEGADOR DETECTADO (localStorage)!');
          return true;
        }
      }
    }
    
    // Também consultar Firestore (source of truth)
    // Nota: onSnapshot cuidarda deteco em tempo real, esta é apenas verificação inicial
    return false;
    
  } catch (error) {
    console.error('Erro ao verificar navegadores ativos:', error);
    return false;
  }
}

/**
 * Mantém o registro do navegador atualizado NO FIRESTORE
 * Retorna handle do interval para cleanup
 */
function keepAlive(userId: string, windowId: string, browserId: string) {
  // Limpar interval antigo se existir (prevenir memory leak)
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  keepAliveInterval = setInterval(async () => {
    if (windowSessionId === windowId && browserSessionId === browserId) {
      await registerWindow(userId, windowId, browserId);
    }
  }, 30000);
}

/**
 * Inicializa o controle de navegadores com FIRESTORE em tempo real
 * PERMITE: Mltiplas ABAS no mesmo navegador
 * BLOQUEIA: Mltiplos NAVEGADORES diferentes
 * SINCRONIZAÇÃO EM TEMPO REAL via onSnapshot
 */
export async function setupWindowSession(userId: string, onOtherWindowDetected: () => void) {
  if (isInitialized) {
    console.log('Sesso já inicializada, ignorando');
    return;
  }
  
  isInitialized = true;
  
  // ARMAZENAR userId para usar no cleanup
  currentUserId = userId;
  
  console.log('Iniciando controle de navegadores com Firestore para:', userId.substring(0, 10));
  
  // OBTER ID DO NAVEGADOR (compartilhado entre todas as abas)
  browserSessionId = getOrCreateBrowserId();
  
  // OBTER ID DA ABA (nico para esta aba especfica)
  windowSessionId = getOrCreateWindowId();
  
  // Verificação inicial
  const hasConflict = await checkForOtherBrowsers(userId, browserSessionId!);
  if (hasConflict) {
    console.warn('Outro NAVEGADOR detectado - encerrando sesso');
    onOtherWindowDetected();
    return;
  }
  
  // Registrar com browserId + windowId NO FIRESTORE
  await registerWindow(userId, windowSessionId, browserSessionId);
  
  // Manter registro atualizado
  keepAlive(userId, windowSessionId, browserSessionId);
  
  // FIRESTORE LISTENER: Detecta mudanas em TEMPO REAL (COM FALLBACK)
  try {
    const sessionRef = doc(db, 'browserSessions', userId);
    firestoreUnsubscribe = onSnapshot(sessionRef, (snapshot) => {
      if (!snapshot.exists()) return;
      
      const sessionData = snapshot.data();
      
      // Ignorar eventos do mesmo navegador (keep-alive ou outras abas)
      if (sessionData.browserId === browserSessionId) {
        return; // MESMA BROWSER = PERMITIR
      }
      
      // browserId diferente = NAVEGADOR DIFERENTE (bloqueia)
      if (sessionData.browserId !== browserSessionId) {
        console.warn('FIRESTORE: NAVEGADOR DIFERENTE DETECTADO!');
        console.log('   Navegador atual:', browserSessionId?.substring(0, 25));
        console.log('   Navegador novo:', sessionData.browserId?.substring(0, 25));
        onOtherWindowDetected();
      }
    }, (error: any) => {
      if (error?.code === 'permission-denied') {
        console.warn('Firestore listener permission-denied - usando apenas localStorage');
      } else {
        console.error('Erro no Firestore listener:', error);
      }
    });
  } catch (error: any) {
    if (error?.code === 'permission-denied') {
      console.warn('Firestore setup permission-denied - modo localStorage ativo');
    } else {
      console.error('Erro ao configurar listener:', error);
    }
  }
  
  // Fallback: Também manter localStorage listener
  storageListener = (e: StorageEvent) => {
    if (e.key === 'activeWindow' && e.newValue) {
      try {
        const newWindow = JSON.parse(e.newValue);
        
        if (newWindow.browserId === browserSessionId) {
          return;
        }
        
        if (newWindow.userId === userId && newWindow.browserId !== browserSessionId) {
          console.warn('localStorage: NAVEGADOR DIFERENTE DETECTADO');
          onOtherWindowDetected();
        }
      } catch (error) {
        console.error('Erro ao processar storage event:', error);
      }
    }
  };
  
  window.addEventListener('storage', storageListener);
  
  window.addEventListener('beforeunload', () => {
    cleanupWindowSession(); // userId jestem currentUserId
  });
  
  console.log('Controle de navegadores ativado com Firestore');
  console.log('BrowserID:', browserSessionId?.substring(0, 25));
  console.log('WindowID (aba):', windowSessionId.substring(0, 20));
  console.log('UserID:', userId.substring(0, 10));
}

/**
 * Limpa o controle de navegadores (localStorage + Firestore)
 * USA currentUserId armazenado internamente
 */
export async function cleanupWindowSession() {
  console.log('Limpando controle de navegadores');
  
  // LIMPAR INTERVAL (prevenir memory leak)
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('KeepAlive interval removido');
  }
  
  // Desinscrever do Firestore listener
  if (firestoreUnsubscribe) {
    firestoreUnsubscribe();
    firestoreUnsubscribe = null;
    console.log('Firestore listener removido');
  }
  
  if (storageListener) {
    window.removeEventListener('storage', storageListener);
    storageListener = null;
  }
  
  // FIRESTORE: Limpar sesso usando currentUserId armazenado
  if (currentUserId && browserSessionId && windowSessionId) {
    try {
      const sessionRef = doc(db, 'browserSessions', currentUserId);
      await deleteDoc(sessionRef);
      console.log('Sesso removida do Firestore');
    } catch (error) {
      console.error('Erro ao limpar Firestore:', error);
    }
    
    // Limpar localStorage
    const activeWindowData = safeLocalStorage().getItem('activeWindow');
    if (activeWindowData) {
      try {
        const activeWindow = JSON.parse(activeWindowData);
        
        if (activeWindow.browserId === browserSessionId && 
            activeWindow.windowId === windowSessionId) {
          safeLocalStorage().removeItem('activeWindow');
          console.log('Registro do localStorage removido');
        }
      } catch (error) {
        console.error('Erro ao limpar localStorage:', error);
      }
    }
  }
  
  // Limpar variveis
  windowSessionId = null;
  browserSessionId = null;
  currentUserId = null;
  isInitialized = false;
}

/**
 * Verifica se o controle de janelas estativo
 */
export function isWindowSessionActive(): boolean {
  return isInitialized && windowSessionId !== null;
}
