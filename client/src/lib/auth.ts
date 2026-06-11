import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  User as FirebaseUser
} from "firebase/auth";
import { auth, db } from "./firebase";
import { collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { getBrowserId } from "./browser-session";

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface RegisterData extends AuthCredentials {
  name: string;
  acceptTerms: boolean;
}

export const signIn = async ({ email, password }: AuthCredentials): Promise<FirebaseUser> => {
  // Security: User process completed
  
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    console.log('Login realizado:', result.user.uid);
    
    const browserId = getBrowserId();
    console.log('📱 Browser ID:', browserId.substring(0, 8) + '...');
    
    result.user.getIdToken().then(token => {
      fetch('/api/auth/update-browser-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Browser-Id': browserId
        },
        body: JSON.stringify({ browserId })
      }).catch(() => {});
    }).catch(() => {});
    
    return result.user;
  } catch (error: any) {
    console.error('Erro no login:', error);
    
    // TRATAR ERROS ESPECFICOS DO FIREBASE
    if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota exceeded')) {
      throw new Error('Serviço temporariamente indisponível. Tente novamente em alguns minutos.');
    }
    
    if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password') {
      throw new Error('Email ou senha incorretos.');
    }
    
    if (error?.code === 'auth/user-not-found') {
      throw new Error('Usuário não encontrado.');
    }
    
    if (error?.code === 'auth/too-many-requests') {
      throw new Error('Muitas tentativas de login. Tente novamente mais tarde.');
    }
    
    // ERRO GENRICO MAIS AMIGVEL
    throw new Error('Erro no login. Verifique suas credenciais e tente novamente.');
  }
};

export const signUp = async ({ email, password }: AuthCredentials): Promise<FirebaseUser> => {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  console.log("Usuário criado no Firebase Auth:", result.user.uid);
  return result.user;
};

export const signOut = async (): Promise<void> => {
  await firebaseSignOut(auth);
};

export const getCurrentUser = (): FirebaseUser | null => {
  return auth.currentUser;
};

export const resetPassword = async (email: string): Promise<void> => {
  const continueUrl = `${window.location.origin}/login`;
  await sendPasswordResetEmail(auth, email, {
    url: continueUrl,
    handleCodeInApp: false,
  });
};
