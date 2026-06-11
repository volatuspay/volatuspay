import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const SESSION_TIMEOUT_MINUTES = 60;

interface Seller2FAState {
  isVerified: boolean;
  lastVerifiedAt: number | null;
  setVerified: (verified: boolean) => void;
  reset: () => void;
  isSessionValid: () => boolean;
}

export const useSeller2FAStore = create<Seller2FAState>()(
  persist(
    (set, get) => ({
      isVerified: false,
      lastVerifiedAt: null,
      
      setVerified: (verified) => set({ 
        isVerified: verified, 
        lastVerifiedAt: verified ? Date.now() : null 
      }),
      
      reset: () => set({ 
        isVerified: false, 
        lastVerifiedAt: null,
      }),
      
      isSessionValid: () => {
        const { isVerified, lastVerifiedAt } = get();
        if (!isVerified || !lastVerifiedAt) return false;
        const elapsed = (Date.now() - lastVerifiedAt) / 1000 / 60;
        return elapsed < SESSION_TIMEOUT_MINUTES;
      },
    }),
    {
      name: 'seller-2fa-session',
      partialize: (state) => ({
        isVerified: state.isVerified,
        lastVerifiedAt: state.lastVerifiedAt,
      }),
    }
  )
);
