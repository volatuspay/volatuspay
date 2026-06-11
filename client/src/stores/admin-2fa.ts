import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ⏰ TEMPO DE VALIDADE DO 2FA (em minutos)
const SESSION_TIMEOUT_MINUTES = 60; // 1 hora para login geral
const ACQUIRERS_TIMEOUT_MINUTES = 30; // 30 min para área sensível (adquirentes)

interface Admin2FAState {
  isVerified: boolean;
  isAcquirersVerified: boolean;
  lastVerifiedAt: number | null; // timestamp em ms
  lastAcquirersVerifiedAt: number | null;
  isLoading: boolean;
  setVerified: (verified: boolean) => void;
  setAcquirersVerified: (verified: boolean) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
  // Helpers para verificar se ainda é válido
  isSessionValid: () => boolean;
  isAcquirersSessionValid: () => boolean;
}

export const useAdmin2FAStore = create<Admin2FAState>()(
  persist(
    (set, get) => ({
      isVerified: false,
      isAcquirersVerified: false,
      lastVerifiedAt: null,
      lastAcquirersVerifiedAt: null,
      isLoading: false,
      
      setVerified: (verified) => set({ 
        isVerified: verified, 
        lastVerifiedAt: verified ? Date.now() : null 
      }),
      
      setAcquirersVerified: (verified) => set({ 
        isAcquirersVerified: verified,
        lastAcquirersVerifiedAt: verified ? Date.now() : null
      }),
      
      setLoading: (loading) => set({ isLoading: loading }),
      
      reset: () => set({ 
        isVerified: false, 
        isAcquirersVerified: false,
        lastVerifiedAt: null,
        lastAcquirersVerifiedAt: null,
        isLoading: false
      }),
      
      // ✅ Verifica se sessão 2FA geral ainda é válida
      isSessionValid: () => {
        const { isVerified, lastVerifiedAt } = get();
        if (!isVerified || !lastVerifiedAt) return false;
        const elapsed = (Date.now() - lastVerifiedAt) / 1000 / 60; // em minutos
        return elapsed < SESSION_TIMEOUT_MINUTES;
      },
      
      // ✅ Verifica se sessão 2FA de adquirentes ainda é válida
      isAcquirersSessionValid: () => {
        const { isAcquirersVerified, lastAcquirersVerifiedAt } = get();
        if (!isAcquirersVerified || !lastAcquirersVerifiedAt) return false;
        const elapsed = (Date.now() - lastAcquirersVerifiedAt) / 1000 / 60;
        return elapsed < ACQUIRERS_TIMEOUT_MINUTES;
      },
    }),
    {
      name: 'admin-2fa-session', // nome da chave no localStorage
      partialize: (state) => ({
        isVerified: state.isVerified,
        isAcquirersVerified: state.isAcquirersVerified,
        lastVerifiedAt: state.lastVerifiedAt,
        lastAcquirersVerifiedAt: state.lastAcquirersVerifiedAt,
      }),
    }
  )
);
