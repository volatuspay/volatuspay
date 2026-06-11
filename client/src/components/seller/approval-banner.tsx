import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Shield, CheckCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";

export interface Seller {
  id: string;
  email: string;
  name: string;
  phone: string;
  cpf?: string;
  cnpj?: string;
  company?: string;
  status: 'pending' | 'approved' | 'rejected';
  profileComplete?: boolean;
  rejectionReason?: string;
  createdAt?: string;
  approvedAt?: string;
}

interface ApprovalBannerProps {
  seller?: Seller;
  showFullCard?: boolean;
  onStatusChange?: (status: 'pending' | 'approved' | 'rejected' | 'not_seller') => void;
  onVerifyClick?: () => void;
}

export function ApprovalBanner({ seller: propSeller, showFullCard = false, onStatusChange, onVerifyClick }: ApprovalBannerProps) {
  const [user, setUser] = useState<User | null>(null);
  const [currentSeller, setCurrentSeller] = useState<Seller | null>(propSeller || null);
  const [loading, setLoading] = useState(!propSeller);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    if (propSeller || !user) {
      setCurrentSeller(propSeller || null);
      setLoading(false);
      return;
    }

    console.log("ApprovalBanner buscando dados do seller para user:", user.uid);

    const fetchSellerData = async () => {
      try {
        const { isUserSeller } = await import('@/lib/firestore');
        const isSeller = await isUserSeller(user.uid);
        
        if (!isSeller || cancelled) {
          if (!cancelled) {
            setCurrentSeller(null);
            setLoading(false);
            if (onStatusChange) onStatusChange('not_seller');
          }
          return;
        }
        
        const token = await user.getIdToken();
        const response = await fetch(`/api/sellers/${user.uid}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (cancelled) return;

        if (response.ok) {
          const sellerData = await response.json() as Seller;
          
          console.log(" ApprovalBanner encontrou seller:", sellerData.id, "Status:", sellerData.status);
          setCurrentSeller(sellerData);
          
          if (onStatusChange) onStatusChange(sellerData.status);

          pollIntervalId = setInterval(async () => {
            if (cancelled) return;
            try {
              const pollToken = await user.getIdToken();
              const pollResponse = await fetch(`/api/sellers/${user.uid}`, {
                headers: {
                  'Authorization': `Bearer ${pollToken}`,
                  'Content-Type': 'application/json'
                }
              });
              if (cancelled) return;
              if (pollResponse.ok) {
                const updatedSeller = await pollResponse.json() as Seller;
                if (updatedSeller.status !== sellerData.status) {
                  console.log(" ApprovalBanner status atualizado:", updatedSeller.status);
                  setCurrentSeller(updatedSeller);
                  if (onStatusChange) onStatusChange(updatedSeller.status);
                }
              }
            } catch (error) {
              console.error("Erro no polling do seller:", error);
            }
          }, 10000);
        } else {
          setCurrentSeller(null);
          if (onStatusChange) onStatusChange('not_seller');
        }
      } catch (error) {
        console.error("Erro ao buscar dados do seller:", error);
        if (!cancelled) setCurrentSeller(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSellerData();

    return () => {
      cancelled = true;
      if (pollIntervalId) clearInterval(pollIntervalId);
    };
  }, [user, propSeller, onStatusChange]);

  if (loading) return null;
  if (!currentSeller) return null;

  const sellerStatus = currentSeller?.status || 
    (currentSeller?.approvedAt ? 'approved' : 'pending');

  if (sellerStatus === 'approved') return null;

  if (sellerStatus === 'rejected') {
    return (
      <div className="mx-4 sm:mx-6 mb-4">
        <div className="flex items-center gap-3 p-3 bg-red-950/50 border border-red-800/50 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-300">
              Conta Rejeitada
            </p>
            {currentSeller?.rejectionReason && (
              <p className="text-xs text-red-400/80 mt-0.5 truncate">
                Motivo: {currentSeller.rejectionReason}
              </p>
            )}
          </div>
          <Button
            size="sm"
            onClick={onVerifyClick}
            className="bg-red-600 hover:bg-red-700 text-white flex-shrink-0"
            data-testid="button-reverify-account"
          >
            <Shield className="h-4 w-4 mr-1" />
            Reverificar
          </Button>
        </div>
      </div>
    );
  }

  const needsVerification = !currentSeller?.profileComplete;

  if (needsVerification) {
    return (
      <div className="mx-4 sm:mx-6 mb-4">
        <div className="flex items-center gap-3 p-3 bg-red-600 border border-red-700 rounded-lg">
          <Shield className="h-5 w-5 text-white flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">
              Verifique sua conta para desbloquear seus produtos
            </p>
            <p className="text-xs text-white/70 mt-0.5">
              Complete a verificação para criar e gerenciar seus produtos
            </p>
          </div>
          <Button
            size="sm"
            onClick={onVerifyClick}
            className="bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0"
            data-testid="button-verify-account"
          >
            <Shield className="h-4 w-4 mr-1" />
            Verificar Conta
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
