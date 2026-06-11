import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

// SISTEMA DE OFUSCAÇÃO DE CHAVES - Proteção adicional contra inspeo
const decodeConfig = (encoded: string): string => {
  if (!encoded) return '';
  
  // DETECÇÃO INTELIGENTE: Se jé uma chave Firebase válida, no decodificar
  if (
    encoded.startsWith('AIza') ||           // API Key
    encoded.startsWith('1:') ||             // App ID
    encoded.startsWith('G-') ||             // Measurement ID
    encoded.includes('.firebaseapp.com') || // Auth Domain
    encoded.includes('.firebaseio.com') ||  // Database URL
    /^\d+$/.test(encoded)                   // Numeric values (messagingSenderId)
  ) {
    return encoded; // Retornar chave válida sem decodificação
  }
  
  // VALIDAÇÃO RIGOROSA BASE64: Sdecodificar se for Base64 vlido
  const base64Pattern = /^[A-Za-z0-9+/=]+$/;
  if (!base64Pattern.test(encoded) || encoded.length % 4 !== 0) {
    return encoded; // No é Base64 vlido, retornar original
  }
  
  try {
    // Decodificação Base64 para chaves ofuscadas
    return atob(encoded);
  } catch {
    // Fallback: retornar valor original se no for Base64
    return encoded;
  }
};

// FIREBASE CONFIG — loaded exclusively from environment variables (white-label)
const firebaseConfig = {
  apiKey: decodeConfig(import.meta.env.VITE_FIREBASE_API_KEY || ''),
  authDomain: decodeConfig(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || ''),
  databaseURL: decodeConfig(import.meta.env.VITE_FIREBASE_DATABASE_URL || ''),
  projectId: decodeConfig(import.meta.env.VITE_FIREBASE_PROJECT_ID || ''),
  storageBucket: decodeConfig(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || ''),
  messagingSenderId: decodeConfig(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''),
  appId: decodeConfig(import.meta.env.VITE_FIREBASE_APP_ID || ''),
  measurementId: decodeConfig(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '')
};

// Initialize Firebase (com proteção contra duplicate app durante HMR)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);

// LOGIN ETERNO: Persiste sessão no dispositivo (localStorage) para que push funcione sempre
// browserLocalPersistence = Sessão válida indefinidamente no dispositivo (iOS/Android PWA)
setPersistence(auth, browserLocalPersistence)
  .then(() => {
    console.log('Sessão configurada: LOCAL (persistente no dispositivo)');
  })
  .catch((error) => {
    console.error('Erro ao configurar persistência de sessão:', error);
  });

const db = getFirestore(app);
const rtdb = getDatabase(app); // REALTIME DATABASE PARA DADOS REAIS
const firebaseStorage = getStorage(app);
const functions = getFunctions(app);

// SINGLE SESSION SYSTEM - 1 LOGIN POR VEZ (usando Firestore sellers doc)
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';

let currentSessionId: string | null = null;
let sessionUnsubscribe: (() => void) | null = null;

export const setupSingleSession = async (userId: string) => {
  if (!userId) {
    console.log('Single session: userId vazio, abortando');
    return;
  }
  
  console.log('INICIANDO Single Session para:', userId.substring(0, 10));
  
  try {
    // Gerar ID nico para esta sesso
    const newSessionId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    currentSessionId = newSessionId;
    console.log('SessionID gerado:', newSessionId.substring(0, 15));
    
    // Usar documento sellers (que jtem permisso de escrita)
    const sellerRef = doc(db, 'sellers', userId);
    console.log('Referncia doc sellers criada:', userId.substring(0, 10));
    
    // VERIFICAR SE DOCUMENTO EXISTE ANTES DE ATUALIZAR
    const sellerDoc = await getDoc(sellerRef).catch(() => null);
    
    if (!sellerDoc || !sellerDoc.exists()) {
      console.log('Single session: Documento seller no existe - pulando (usuário no é seller)');
      return; // NÃO tentar atualizar se no for seller
    }
    
    // Atualizar apenas campo activeSession no doc do seller
    const sessionData = {
      activeSession: {
        sessionId: newSessionId,
        timestamp: serverTimestamp(),
        userAgent: navigator.userAgent.substring(0, 100),
        lastSeen: serverTimestamp()
      }
    };
    
    console.log('Tentando atualizar activeSession no Firestore...');
    await setDoc(sellerRef, sessionData, { merge: true }).then(() => {
      console.log('activeSession atualizado com sucesso!');
    }).catch(err => {
      console.warn('Erro ao atualizar activeSession:', err.code, err.message);
      // Se sem permisso, no bloqueia login
      console.log('Single session: Erro ao atualizar (ignorado)');
      return; // SAIR se houver erro
    });
    
    // Monitorar mudanas - se outra sesso logar, deslogar esta
    if (sessionUnsubscribe) {
      console.log('Cancelando listener anterior...');
      sessionUnsubscribe();
    }
    
    console.log('Configurando listener para mudanas de sesso...');
    sessionUnsubscribe = onSnapshot(sellerRef, (snapshot) => {
      const data = snapshot.data();
      console.log('Listener disparou - activeSession:', data?.activeSession?.sessionId?.substring(0, 15));
      
      if (data?.activeSession && data.activeSession.sessionId !== currentSessionId) {
        console.warn('SESSÃO INVALIDADA - Outro login detectado!');
        console.warn('   Sesso atual:', currentSessionId?.substring(0, 15));
        console.warn('   Nova sesso:', data.activeSession.sessionId?.substring(0, 15));
        
        // Mostrar mensagem antes de deslogar
        const event = new CustomEvent('session-invalidated', {
          detail: { reason: 'outro-login' }
        });
        window.dispatchEvent(event);
        
        // Deslogar após 2 segundos
        setTimeout(async () => {
          console.log('Deslogando sesso antiga...');
          if (sessionUnsubscribe) {
            sessionUnsubscribe();
            sessionUnsubscribe = null;
          }
          await signOut(auth);
        }, 2000);
      }
    }, (err) => {
      console.warn('Erro no listener single session:', err.code, err.message);
      // FIX: Remover listener quando herro de permisso (evita erro 400 do Firestore)
      if (sessionUnsubscribe) {
        sessionUnsubscribe();
        sessionUnsubscribe = null;
      }
    });
    
    console.log('Single session configurada com sucesso!', newSessionId.substring(0, 15));
  } catch (error: any) {
    console.error('Erro crtico em setupSingleSession:', error.message || error);
  }
};

export const cleanupSession = () => {
  if (sessionUnsubscribe) {
    sessionUnsubscribe();
    sessionUnsubscribe = null;
  }
  currentSessionId = null;
};

export { auth, db, rtdb, firebaseStorage as storage, functions };

export default app;
