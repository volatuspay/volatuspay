import { useEffect, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export function useEnsureSeller() {
  const hasRun = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || hasRun.current) return;
      
      hasRun.current = true;

      try {
        console.log('🔄 Tentando garantir seller profile...');
        
        const idToken = await user.getIdToken();
        
        const response = await fetch('/api/sellers/autocreate', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ accountType: 'seller' }),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('❌ Erro ao garantir seller profile:', data.error);
          return;
        }

        console.log('✅ Seller profile garantido:', data.message);
      } catch (err: any) {
        console.error('❌ Erro fatal ao garantir seller profile:', err);
      }
    });

    return () => unsubscribe();
  }, []);
}
