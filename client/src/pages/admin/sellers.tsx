import { useState, useEffect } from "react";
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp, getDoc, orderBy, limit, startAfter, getDocs } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { createTenant } from "@/lib/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Check, X, FileText, Clock, Shield, CheckCircle, XCircle, AlertTriangle, Search, User, UserCheck, ExternalLink, Monitor, Info, Trash2, DoorOpen, CreditCard, Smartphone, Receipt, Building, MapPin, Globe, Video } from "lucide-react";
import { formatDeviceFingerprintForAdmin, type DeviceFingerprint } from "@/lib/device-fingerprint";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { apiRequest } from "@/lib/queryClient";
import type { Seller } from "@shared/schema";
import { useCustomDialog } from "@/hooks/use-custom-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Interface estendida para incluir fotos e dados extras
interface ExtendedSeller extends Seller {
  profilePhoto?: string;
  photoURL?: string;
  fullName?: string;
}

export default function AdminSellers() {
  const [allSellers, setAllSellers] = useState<ExtendedSeller[]>([]);
  const [uniqueSellers, setUniqueSellers] = useState<ExtendedSeller[]>([]);
  const [filteredSellers, setFilteredSellers] = useState<ExtendedSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeller, setSelectedSeller] = useState<Seller | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [searchEmail, setSearchEmail] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const sellersPerPage = 10;
  const [isCleaningOrphans, setIsCleaningOrphans] = useState(false);
  const [sellerAcquirers, setSellerAcquirers] = useState<{[sellerId: string]: {pix?: string, boleto?: string, creditCardBR?: string, creditCardGlobal?: string, creditCard?: string}}>({});
  const [savingAcquirers, setSavingAcquirers] = useState<string | null>(null);
  const { toast } = useToast();
  const { showConfirm } = useCustomDialog();
  const [lightboxImg, setLightboxImg] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    console.log("Admin buscando TODOS os sellers nicos para gerenciamento via API...");
    
    const loadSellers = async () => {
      try {
        // AGUARDAR USURIO AUTENTICADO (no-null) COM TIMEOUT
        const user = await new Promise<any>((resolve, reject) => {
          let timeoutId: NodeJS.Timeout;
          const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
              // USURIO ENCONTRADO - resolver e limpar
              clearTimeout(timeoutId);
              unsubscribe();
              resolve(user);
            }
            // Se user é null, continuar aguardando (no desconectar)
          });
          
          // TIMEOUT APS 10 SEGUNDOS
          timeoutId = setTimeout(() => {
            unsubscribe();
            reject(new Error('Timeout aguardando autenticação'));
          }, 10000);
        });
        
        console.log('Usuário autenticado:', user.email, '- UID:', user.uid);
        
        // USAR GLOBAL FETCH WRAPPER (apiRequest) COM AUTHORIZATION AUTOMTICO
        const response = await apiRequest('/api/admin/sellers', 'GET');
        
        // VALIDAR RESPOSTA ANTES DE PROCESSAR
        if (!response.ok) {
          throw new Error(`API retornou erro ${response.status}: ${await response.text()}`);
        }
        
        const sellersData = await response.json();
        
        // VALIDAR ESTRUTURA DA RESPOSTA
        if (!sellersData.success) {
          throw new Error('API não retornou sucesso');
        }
        
        const processedSellers: Seller[] = [];
        
        // API RETORNA FORMATO: { success: true, sellers: [...], total: number }
        const allSellersArray = sellersData.sellers || [];
        
        if (!Array.isArray(allSellersArray)) {
          console.error('API não retornou array de sellers:', sellersData);
          throw new Error('Formato de resposta inválido');
        }
        
        allSellersArray.forEach((data: any) => {
          processedSellers.push({
            id: data.id,
            firebaseDocId: data.id, //  BACKUP DO DOC ID REAL
            ...data,
            // NÃO CRIAR DATAS FAKE - usar as reais do Firebase
            createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
            updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
            approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
            rejectedAt: data.rejectedAt ? new Date(data.rejectedAt) : undefined,
          } as any);
        });
        
        console.log(`Admin encontrou via API: ${processedSellers.length} sellers nicos`);
        console.log(' DADOS DOS SELLERS CARREGADOS:', processedSellers.map(s => ({
          id: s.id,
          email: s.email,
          status: s.status,
          businessName: s.businessName
        })));
        setAllSellers(processedSellers);
        
        // Carregar configurações de adquirentes dos sellers
        const initialAcquirers: {[key: string]: {pix?: string, boleto?: string, creditCardBR?: string, creditCardGlobal?: string, creditCard?: string}} = {};
        processedSellers.forEach((seller: any) => {
          if (seller.acquirers) {
            initialAcquirers[seller.id] = {
              pix: seller.acquirers.pix || undefined,
              boleto: seller.acquirers.boleto || undefined,
              creditCardBR: seller.acquirers.creditCardBR || undefined,
              creditCardGlobal: seller.acquirers.creditCardGlobal || undefined,
              // BACKWARD COMPATIBILITY: Manter creditCard antigo
              creditCard: seller.acquirers.creditCard || undefined,
            };
          }
        });
        setSellerAcquirers(initialAcquirers);
        console.log('Adquirentes carregados:', initialAcquirers);
        
        setLoading(false);
        
      } catch (error) {
        console.error('Erro ao carregar sellers via API:', error);
        setLoading(false);
      }
    };

    loadSellers();
  }, []);

  // REMOVER DUPLICATAS GLOBALMENTE: CADA EMAIL APARECE APENAS 1 VEZ NO SISTEMA
  useEffect(() => {
    // FILTRAR SELLERS INVÁLIDOS (sem email real ou nome real)
    const validSellers = allSellers.filter(seller => {
      const hasValidEmail = seller.email && seller.email.toLowerCase() !== 'n/a' && seller.email.includes('@');
      const hasValidName = seller.businessName && seller.businessName.toLowerCase() !== 'nome não informado';
      return hasValidEmail || hasValidName;
    });
    
    // PRIMEIRO: Remover duplicatas de TODOS os sellers (não por aba)
    const uniqueByEmail = new Map<string, Seller>();
    
    validSellers.forEach(seller => {
      const existingSeller = uniqueByEmail.get(seller.email);
      
      if (!existingSeller) {
        uniqueByEmail.set(seller.email, seller);
      } else {
        const existingDate = existingSeller.updatedAt || existingSeller.createdAt;
        const currentDate = seller.updatedAt || seller.createdAt;
        
        if (currentDate > existingDate) {
          uniqueByEmail.set(seller.email, seller);
          console.log(`Email ${seller.email}: atualizando para registro mais recente (${seller.status})`);
        }
      }
    });
    
    const uniqueSellersArray = Array.from(uniqueByEmail.values());
    console.log(`Removidas duplicatas: ${allSellers.length} → ${uniqueSellersArray.length} sellers válidos`);
    
    // Salvar sellers nicos no state para usar nos contadores
    setUniqueSellers(uniqueSellersArray);
    
    // SEGUNDO: Mostrar SOMENTE SELLERS PENDENTES QUE COMPLETARAM VERIFICAÇÃO (profileComplete === true)
    let filtered = uniqueSellersArray.filter(s => (!s.status || s.status === 'pending') && (s as any).profileComplete === true);
    
    console.log(`GERENCIAR SELLERS - Total sellers nicos: ${uniqueSellersArray.length}`);
    console.log(`GERENCIAR SELLERS - Aprovados: ${uniqueSellersArray.filter(s => s.status === 'approved').length}, Pendentes: ${uniqueSellersArray.filter(s => s.status === 'pending' || !s.status).length}, Rejeitados: ${uniqueSellersArray.filter(s => s.status === 'rejected').length}`);
    
    // TERCEIRO: Filtro por busca de email/empresa
    if (searchEmail.trim()) {
      filtered = filtered.filter(seller => 
        seller.email.toLowerCase().includes(searchEmail.toLowerCase()) ||
        seller.businessName?.toLowerCase().includes(searchEmail.toLowerCase())
      );
    }
    
    console.log(`Admin Sellers: ${filtered.length} sellers após filtros`);
    
    setFilteredSellers(filtered);
    setCurrentPage(1);
  }, [allSellers, searchEmail]);

  const handleApprove = async (sellerId: string) => {
    setProcessing(sellerId);
    try {
      console.log("Admin aprovando seller:", sellerId);
      
      // ENCONTRAR O SELLER REAL NA LISTA PARA PEGAR O DOC ID
      const seller = allSellers.find(s => s.id === sellerId || (s as any).userId === sellerId);
      const realDocId = (seller as any)?.firebaseDocId || seller?.id || sellerId;
      
      console.log("Usando Doc ID real:", realDocId);
      
      // OBTER TOKEN DE AUTENTICAÇÃO DO USURIO LOGADO
      const user = auth.currentUser;
      if (!user) {
        toast({
          title: " Acesso negado",
          description: "necessário estar logado como admin para realizar esta operao",
          variant: "destructive",
        });
        return;
      }
      
      const idToken = await user.getIdToken();
      
      // USAR API DO BACKEND EM VEZ DE FIREBASE DIRETO
      const response = await fetch(`/api/admin/sellers/${realDocId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: 'approve'
        })
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      console.log("Seller aprovado via API:", result);

      toast({
        title: " Seller aprovado!",
        description: "Vendedor foi aprovado e pode começar a vender",
      });
      
      // ATUALIZAR LISTA SEM RELOAD (PERFORMANCE)
      setTimeout(async () => {
        const response = await apiRequest('/api/admin/sellers', 'GET');
        if (response.ok) {
          const sellersData = await response.json();
          const processedSellers: Seller[] = [];
          const allSellersArray = sellersData.sellers || [];
          allSellersArray.forEach((data: any) => {
            processedSellers.push({
              id: data.id,
              firebaseDocId: data.id,
              ...data,
              createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
              updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
              approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
            });
          });
          setAllSellers(processedSellers);
        }
      }, 500);
      
    } catch (error) {
      console.error("Erro ao aprovar seller:", error);
      toast({
        title: " Erro ao aprovar",
        description: error instanceof Error ? error.message : "Erro temporrio - tente novamente.",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (sellerId: string, reason: string) => {
    if (!reason.trim()) return;
    
    setProcessing(sellerId);
    try {
      console.log("Admin rejeitando seller:", sellerId, "Motivo:", reason);
      
      // ENCONTRAR O SELLER REAL NA LISTA PARA PEGAR O DOC ID
      const seller = allSellers.find(s => s.id === sellerId || (s as any).userId === sellerId);
      const realDocId = (seller as any)?.firebaseDocId || seller?.id || sellerId;
      
      console.log("Rejeio usando Doc ID real:", realDocId);
      
      // OBTER TOKEN DE AUTENTICAÇÃO DO USURIO LOGADO
      const user = auth.currentUser;
      if (!user) {
        toast({
          title: " Acesso negado",
          description: "necessário estar logado como admin para realizar esta operao",
          variant: "destructive",
        });
        return;
      }
      
      const idToken = await user.getIdToken();
      
      // USAR API DO BACKEND EM VEZ DE FIREBASE DIRETO
      const response = await fetch(`/api/admin/sellers/${realDocId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: 'reject',
          rejectionReason: reason
        })
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      console.log("Seller rejeitado via API:", result);

      toast({
        title: " Seller rejeitado!",
        description: "Vendedor foi rejeitado com sucesso",
      });
      setRejectionReason("");
      
      // ATUALIZAR LISTA SEM RELOAD (PERFORMANCE)
      setTimeout(async () => {
        const response = await apiRequest('/api/admin/sellers', 'GET');
        if (response.ok) {
          const sellersData = await response.json();
          const processedSellers: Seller[] = [];
          const allSellersArray = sellersData.sellers || [];
          allSellersArray.forEach((data: any) => {
            processedSellers.push({
              id: data.id,
              firebaseDocId: data.id,
              ...data,
              createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
              updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
              approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
            });
          });
          setAllSellers(processedSellers);
        }
      }, 500);
      
    } catch (error) {
      console.error("Erro ao rejeitar seller:", error);
      toast({
        title: " Erro ao rejeitar",
        description: error instanceof Error ? error.message : "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const handleSaveAcquirers = async (sellerId: string) => {
    setSavingAcquirers(sellerId);
    try {
      const user = auth.currentUser;
      if (!user) {
        toast({
          title: "Erro",
          description: "Vocprecisa estar logado",
          variant: "destructive",
        });
        return;
      }

      const idToken = await user.getIdToken();
      const acquirers = sellerAcquirers[sellerId] || {};

      console.log(`Salvando adquirentes para seller ${sellerId}:`, acquirers);

      const response = await fetch(`/api/admin/seller-acquirers/${sellerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ acquirers }),
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      console.log("Adquirentes salvos:", result);

      toast({
        title: "Adquirentes Salvos!",
        description: "As configurações de pagamento foram atualizadas para este seller",
      });

    } catch (error) {
      console.error("Erro ao salvar adquirentes:", error);
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setSavingAcquirers(null);
    }
  };

  const handleImpersonate = async (sellerId: string, sellerEmail: string) => {
    setProcessing(sellerId);
    try {
      // Pegar o usuário atual para enviar o adminUserId
      const user = await new Promise<any>((resolve) => {
        auth.onAuthStateChanged(resolve);
      });

      if (!user) {
        toast({
          title: "Acesso Negado",
          description: "Vocprecisa estar logado.",
          variant: "destructive",
        });
        setProcessing(null);
        return;
      }

      console.log('Iniciando impersonation para seller:', sellerEmail);

      // Pegar o token de autenticação
      const idToken = await user.getIdToken();

      const response = await fetch('/api/admin/impersonate-seller', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ 
          sellerId: sellerId,
          adminUserId: user.uid
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Token de impersonation gerado:', data);

        // Abrir URL em nova aba automaticamente
        const impersonateUrl = data.url;
        console.log(' ABRINDO URL EM NOVA ABA:', impersonateUrl);
        
        window.open(impersonateUrl, '_blank');
        
        toast({
          title: "Nova Aba Aberta!",
          description: `Você foi logado como ${sellerEmail} em uma nova aba`,
          variant: "default",
          duration: 5000,
        });
      } else {
        const error = await response.json();
        toast({
          title: "Erro ao gerar acesso",
          description: error.message || "Erro inesperado",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Erro ao impersonar seller:", error);
      toast({
        title: "Erro de conexo",
        description: "Erro ao conectar com o servidor",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const handleCleanupOrphans = async () => {
    const confirmed = await showConfirm('ATENÇÃO: Esta ação irdeletar PERMANENTEMENTE todos os sellers que no existem mais no Firebase Auth e todos os seus dados relacionados (orders, products, checkouts, etc.).\n\nDeseja continuar?', 'Confirmar limpeza', 'warning');
    if (!confirmed) {
      return;
    }
    
    setIsCleaningOrphans(true);
    try {
      console.log('Iniciando limpeza profunda de sellers rfos...');
      
      const user = auth.currentUser;
      if (!user) {
        toast({
          title: " Acesso negado",
          description: "necessário estar logado como admin",
          variant: "destructive",
        });
        return;
      }
      
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/admin/cleanup-orphan-sellers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${await response.text()}`);
      }
      
      const result = await response.json();
      console.log('Limpeza concluída:', result);
      
      toast({
        title: " Limpeza concluída!",
        description: `${result.summary.orphansDeleted} sellers rfos removidos com sucesso. Total: ${result.summary.totalDocumentsDeleted} documentos deletados.`,
      });
      
      // ATUALIZAR LISTA SEM RELOAD (PERFORMANCE)
      setTimeout(async () => {
        const response = await apiRequest('/api/admin/sellers', 'GET');
        if (response.ok) {
          const sellersData = await response.json();
          const processedSellers: Seller[] = [];
          const allSellersArray = sellersData.sellers || [];
          allSellersArray.forEach((data: any) => {
            processedSellers.push({
              id: data.id,
              firebaseDocId: data.id,
              ...data,
              createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
              updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
              approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
            });
          });
          setAllSellers(processedSellers);
        }
      }, 500);
      
    } catch (error) {
      console.error('Erro na limpeza:', error);
      toast({
        title: " Erro na limpeza",
        description: "Erro ao executar limpeza profunda. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsCleaningOrphans(false);
    }
  };

  // FIX: Corrigir sellers com approved inconsistente
  const [isFixingApproval, setIsFixingApproval] = useState(false);
  
  const handleFixApprovalStatus = async () => {
    setIsFixingApproval(true);
    
    try {
      const user = auth.currentUser;
      if (!user) {
        toast({
          title: "Erro",
          description: "necessário estar logado como admin",
          variant: "destructive",
        });
        return;
      }
      
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/admin/fix-sellers-approval-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${await response.text()}`);
      }
      
      const result = await response.json();
      console.log('Fix concludo:', result);
      
      toast({
        title: "Correo concluída!",
        description: `Total: ${result.stats.total} sellers | Corretos: ${result.stats.alreadyCorrect} | Corrigidos: ${result.stats.fixed} | Erros: ${result.stats.errors}`,
      });
      
      // ATUALIZAR LISTA
      setTimeout(async () => {
        const response = await apiRequest('/api/admin/sellers', 'GET');
        if (response.ok) {
          const sellersData = await response.json();
          const processedSellers: Seller[] = [];
          const allSellersArray = sellersData.sellers || [];
          allSellersArray.forEach((data: any) => {
            processedSellers.push({
              id: data.id,
              firebaseDocId: data.id,
              ...data,
              createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
              updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
              approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
            });
          });
          setAllSellers(processedSellers);
        }
      }, 500);
      
    } catch (error) {
      console.error('Erro no fix:', error);
      toast({
        title: "Erro no fix",
        description: "Erro ao executar correo. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsFixingApproval(false);
    }
  };

  const renderSellersList = () => {
    if (loading) {
      return (
        <div className="grid grid-cols-1 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-emerald-50 rounded-full"></div>
                  <div className="space-y-2 flex-1">
                    <div className="h-5 bg-emerald-50 rounded w-3/4"></div>
                    <div className="h-4 bg-emerald-50 rounded w-1/2"></div>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      );
    }

    if (filteredSellers.length === 0) {
      return (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <User className="mx-auto h-12 w-12 text-emerald-700" />
              <h3 className="mt-4 text-lg font-medium">Nenhum seller encontrado</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {searchEmail ? `Nenhum seller encontrado com "${searchEmail}"` : "Nenhum seller nesta categoria"}
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    const startIndex = (currentPage - 1) * sellersPerPage;
    const currentSellers = filteredSellers.slice(startIndex, startIndex + sellersPerPage);

    return (
      <div className="space-y-6">
        {currentSellers.map((seller) => (
          <Card key={seller.id} className="hover:shadow-lg transition-all">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="w-16 h-16">
                    <AvatarImage 
                      src={seller.documentsUrls?.selfieWithDocument || seller.profilePhoto || seller.photoURL || seller.documentsUrls?.documentFront} 
                      alt={seller.businessName || seller.email}
                    />
                    <AvatarFallback>
                      <User className="w-8 h-8" />
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-semibold">{seller.businessName}</h3>
                      <Badge variant={
                        seller.status === "approved" ? "default" :
                        seller.status === "rejected" ? "destructive" : "secondary"
                      }>
                        {seller.status === "approved" ? "Aprovado" :
                         seller.status === "rejected" ? "Rejeitado" : "Pendente"}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>Email: {seller.email}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>{seller.phone}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>{seller.document}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>{seller.createdAt ? seller.createdAt.toLocaleDateString('pt-BR') : 'Data não disponível'}</span>
                      </div>
                    </div>
                    
                    {/* IDS REAIS DO FIREBASE */}
                    <div className="mt-3 p-3 bg-brand-subtle rounded-lg border">
                      <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                        IDs NICOS REAIS (Firebase)
                      </h4>
                      <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                        <div className="flex justify-between">
                          <span className="text-brand-muted-foreground">Seller ID:</span>
                          <span className="text-muted-foreground font-bold">{seller.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-brand-muted-foreground">User ID:</span>
                          <span className="text-muted-foreground font-bold">{(seller as any).userId || 'N/A'}</span>
                        </div>
                        {(seller as any).tenantId && (
                          <div className="flex justify-between">
                            <span className="text-brand-muted-foreground">Tenant ID:</span>
                            <span className="text-muted-foreground font-bold">{(seller as any).tenantId}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* DADOS TCNICOS DO DISPOSITIVO */}
                    {((seller as any).deviceFingerprint || (seller as any).registrationIP) && (
                      <div className="mt-3 p-3 bg-white rounded border border-brand-muted">
                        <h4 className="text-xs font-semibold text-foreground mb-2">
                          DADOS TCNICOS DE CADASTRO
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          {(seller as any).registrationIP && (
                            <div className="flex items-start gap-1">
                              <span className="text-brand-muted-foreground font-medium">IP:</span>
                              <span className="text-foreground font-mono">{(seller as any).registrationIP}</span>
                            </div>
                          )}
                          {(seller as any).deviceFingerprint?.os && (
                            <div className="flex items-start gap-1">
                              <span className="text-brand-muted-foreground font-medium">SO:</span>
                              <span className="text-foreground">{(seller as any).deviceFingerprint.os}</span>
                            </div>
                          )}
                          {(seller as any).deviceFingerprint?.browser && (
                            <div className="flex items-start gap-1">
                              <span className="text-brand-muted-foreground font-medium">Browser:</span>
                              <span className="text-foreground">{(seller as any).deviceFingerprint.browser} {(seller as any).deviceFingerprint.browserVersion}</span>
                            </div>
                          )}
                          {(seller as any).deviceFingerprint?.gpu && (
                            <div className="flex items-start gap-1 col-span-2">
                              <span className="text-brand-muted-foreground font-medium">GPU:</span>
                              <span className="text-foreground break-all">{(seller as any).deviceFingerprint.gpu}</span>
                            </div>
                          )}
                          {(seller as any).deviceFingerprint?.deviceMemory && (
                            <div className="flex items-start gap-1">
                              <span className="text-brand-muted-foreground font-medium">RAM:</span>
                              <span className="text-foreground">{(seller as any).deviceFingerprint.deviceMemory} GB</span>
                            </div>
                          )}
                          {(seller as any).deviceFingerprint?.cpuCores && (
                            <div className="flex items-start gap-1">
                              <span className="text-brand-muted-foreground font-medium">CPU:</span>
                              <span className="text-foreground">{(seller as any).deviceFingerprint.cpuCores} cores</span>
                            </div>
                          )}
                          {(seller as any).deviceFingerprint?.screenResolution && (
                            <div className="flex items-start gap-1">
                              <span className="text-brand-muted-foreground font-medium">Tela:</span>
                              <span className="text-foreground">{(seller as any).deviceFingerprint.screenResolution}</span>
                            </div>
                          )}
                          {(seller as any).deviceFingerprint?.timezone && (
                            <div className="flex items-start gap-1">
                              <span className="text-brand-muted-foreground font-medium">Zona:</span>
                              <span className="text-foreground">{(seller as any).deviceFingerprint.timezone}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* AÇES SIMPLES */}
                <div className="flex items-center gap-2 flex-wrap">
                  
                  {/* CONFIGURAR ADQUIRENTES (PIX, BOLETO, CARTÃO) - SOMENTE PARA SELLERS APROVADOS */}
                  {seller.status === 'approved' && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          variant="default" 
                          size="lg" 
                          className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
                          data-testid={`button-configure-acquirers-${seller.id}`}
                        >
                          CONFIGURAR ADQUIRENTES
                        </Button>
                      </DialogTrigger>
                    <DialogContent className="max-w-4xl !bg-black border border-gray-800 text-white">
                      <DialogHeader>
                        <DialogTitle className="text-xl text-white">
                          Configurar Adquirentes de Pagamento
                        </DialogTitle>
                        <DialogDescription className="text-gray-500">
                          Defina qual adquirente processar os pagamentos de <strong className="text-white">{seller.businessName}</strong>. As configurações são salvas permanentemente no seller.
                        </DialogDescription>
                      </DialogHeader>
                      
                      <div className="space-y-4 mt-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* PIX */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <Label className="text-sm font-medium text-emerald-400 mb-2 block">PIX</Label>
                            <Select
                              value={sellerAcquirers[seller.id]?.pix || 'default'}
                              onValueChange={(value) => {
                                setSellerAcquirers(prev => ({
                                  ...prev,
                                  [seller.id]: { ...prev[seller.id], pix: value === 'default' ? undefined : value }
                                }));
                              }}
                            >
                              <SelectTrigger className="w-full bg-black border-gray-700 text-white" data-testid={`select-pix-${seller.id}`}>
                                <SelectValue placeholder="Selecionar" />
                              </SelectTrigger>
                              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                                <SelectItem value="default">Usar Padrão Global</SelectItem>
                                <SelectItem value="efibank">EfíBank (Gerencianet)</SelectItem>
                                <SelectItem value="onz">ONZ Finance</SelectItem>
                                <SelectItem value="woovi">Woovi (OpenPix)</SelectItem>
                                <SelectItem value="pagarme">Pagar.me</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* BOLETO */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <Label className="text-sm font-medium text-emerald-400 mb-2 block">Boleto</Label>
                            <Select
                              value={sellerAcquirers[seller.id]?.boleto || 'default'}
                              onValueChange={(value) => {
                                setSellerAcquirers(prev => ({
                                  ...prev,
                                  [seller.id]: { ...prev[seller.id], boleto: value === 'default' ? undefined : value }
                                }));
                              }}
                            >
                              <SelectTrigger className="w-full bg-black border-gray-700 text-white" data-testid={`select-boleto-${seller.id}`}>
                                <SelectValue placeholder="Selecionar" />
                              </SelectTrigger>
                              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                                <SelectItem value="default">Usar Padrão Global</SelectItem>
                                <SelectItem value="efibank">EfíBank (Gerencianet)</SelectItem>
                                <SelectItem value="pagarme">Pagar.me</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* CARTÃO BR */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <Label className="text-sm font-medium text-emerald-400 mb-2 block">Cartão BR</Label>
                            <Select
                              value={sellerAcquirers[seller.id]?.creditCardBR || 'default'}
                              onValueChange={(value) => {
                                setSellerAcquirers(prev => ({
                                  ...prev,
                                  [seller.id]: { ...prev[seller.id], creditCardBR: value === 'default' ? undefined : value }
                                }));
                              }}
                            >
                              <SelectTrigger className="w-full bg-black border-gray-700 text-white" data-testid={`select-creditcard-${seller.id}`}>
                                <SelectValue placeholder="Selecionar" />
                              </SelectTrigger>
                              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                                <SelectItem value="default">Usar Padrão Global</SelectItem>
                                <SelectItem value="efibank">EfíBank (Gerencianet)</SelectItem>
                                <SelectItem value="pagarme">Pagar.me</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* BOTÃO SALVAR */}
                        <div className="flex justify-end pt-4 border-t border-gray-800">
                          <Button
                            onClick={() => handleSaveAcquirers(seller.id)}
                            disabled={savingAcquirers === seller.id}
                            className="bg-emerald-600 text-white"
                            data-testid={`button-save-acquirers-${seller.id}`}
                          >
                            {savingAcquirers === seller.id ? (
                              <>Salvando...</>
                            ) : (
                              <>Salvar Configurações</>
                            )}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                  )}
                  
                  {/* Ver Documentos */}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Documentos
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto !bg-black border border-gray-800 text-white">
                      <DialogHeader>
                        <DialogTitle className="text-white flex items-center gap-2">
                          <User className="w-5 h-5 text-emerald-500" />
                          Dados Completos do Seller
                        </DialogTitle>
                        <DialogDescription className="text-gray-500">
                          Todas as informações reais coletadas no cadastro - dados pessoais, empresa e documentos
                        </DialogDescription>
                      </DialogHeader>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        
                        {/* COLUNA 1: DADOS PESSOAIS */}
                        <div className="space-y-4">
                          
                          {/* INFORMAÇES PESSOAIS */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <User className="w-4 h-4" />
                              DADOS PESSOAIS
                            </h3>
                            <div className="space-y-3">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Nome Completo</Label>
                                <p className="mt-1 font-medium text-white">{seller.name || 'No informado'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Email</Label>
                                <p className="mt-1 font-medium text-gray-300">{seller.email}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Telefone/WhatsApp</Label>
                                <p className="mt-1 font-medium text-white">{seller.phone || 'No informado'}</p>
                              </div>
                              
                              {/* IDS NICOS REAIS DO FIREBASE */}
                              <div className="border-t border-gray-700 pt-3 mt-3">
                                <Label className="text-xs font-medium text-gray-400">IDs nicos (Firebase Real)</Label>
                                <div className="mt-2 space-y-2 font-mono text-xs">
                                  <div className="bg-black/40 p-2 rounded border border-gray-700">
                                    <span className="text-gray-400">Seller ID:</span>
                                    <span className="ml-2 text-emerald-400 font-bold">{seller.id}</span>
                                  </div>
                                  <div className="bg-black/40 p-2 rounded border border-gray-700">
                                    <span className="text-gray-400">User ID:</span>
                                    <span className="ml-2 text-emerald-400 font-bold">{(seller as any).userId || 'N/A'}</span>
                                  </div>
                                  {(seller as any).tenantId && (
                                    <div className="bg-black/40 p-2 rounded border border-gray-700">
                                      <span className="text-gray-400">Tenant ID:</span>
                                      <span className="ml-2 text-emerald-400 font-bold">{(seller as any).tenantId}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Data de Nascimento</Label>
                                <p className="mt-1 font-medium text-white">{seller.birthDate || 'No informado'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Tipo Documento Pessoal</Label>
                                <p className="mt-1 font-medium text-white uppercase">{seller.personalDocumentType || 'No informado'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Nmero Documento Pessoal</Label>
                                <p className="mt-1 font-medium text-white">{seller.personalDocumentNumber || 'No informado'}</p>
                              </div>
                            </div>
                          </div>

                          {/* DADOS DA EMPRESA */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <Building className="w-4 h-4" />
                              DADOS DA EMPRESA
                            </h3>
                            <div className="space-y-3">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Nome da Empresa</Label>
                                <p className="mt-1 font-medium text-white">{seller.businessName || 'No informado'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">CNPJ</Label>
                                <p className="mt-1 font-medium text-white">{seller.document || 'No informado'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Nicho do Negócio</Label>
                                <p className="mt-1 font-medium text-white">{seller.businessNiche || 'No informado'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Tipo de Produto</Label>
                                <p className="mt-1 font-medium text-white">
                                  {seller.productType === 'digital' ? 'Digital' : 'No informado'}
                                </p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Descrição dos Produtos</Label>
                                <p className="mt-1 text-sm bg-black/40 text-gray-300 p-2 rounded border border-gray-700">
                                  {seller.productsDescription || 'No informado'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* STATUS E CONTROLE */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <Shield className="w-4 h-4" />
                              STATUS DA CONTA
                            </h3>
                            <div className="space-y-3">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Status Atual</Label>
                                <div className="mt-1">
                                  <p className={`mt-1 font-medium ${seller.status === "approved" ? "text-blue-400" : seller.status === "rejected" ? "text-red-400" : "text-yellow-400"}`}>
                                    {seller.status === "approved" ? "Aprovado" :
                                     seller.status === "rejected" ? "Rejeitado" : "Pendente"}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Data de Cadastroo</Label>
                                <p className="mt-1 font-medium text-white">{seller.createdAt ? `${seller.createdAt.toLocaleDateString('pt-BR')} s ${seller.createdAt.toLocaleTimeString('pt-BR')}` : 'Data não disponível'}</p>
                              </div>
                              {seller.approvedAt && (
                                <div>
                                  <Label className="text-xs font-medium text-gray-400">Data de Aprovação</Label>
                                  <p className="mt-1 font-medium text-blue-400">{seller.approvedAt ? `${seller.approvedAt.toLocaleDateString('pt-BR')} s ${seller.approvedAt.toLocaleTimeString('pt-BR')}` : 'No aprovado'}</p>
                                </div>
                              )}
                              {seller.rejectedAt && (
                                <div>
                                  <Label className="text-xs font-medium text-gray-400">Data de Rejeio</Label>
                                  <p className="mt-1 font-medium text-red-400">{seller.rejectedAt ? `${seller.rejectedAt.toLocaleDateString('pt-BR')} s ${seller.rejectedAt.toLocaleTimeString('pt-BR')}` : 'No rejeitado'}</p>
                                </div>
                              )}
                              {seller.rejectionReason && (
                                <div>
                                  <Label className="text-xs font-medium text-gray-400">Motivo da Rejeio</Label>
                                  <p className="mt-1 text-sm bg-red-900/50 text-red-300 p-2 rounded border border-red-500/30">
                                    {seller.rejectionReason}
                                  </p>
                                </div>
                              )}
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Termos Aceitos</Label>
                                <p className={`mt-1 font-medium ${seller.acceptedTerms ? 'text-blue-400' : 'text-red-400'}`}>
                                  {seller.acceptedTerms ? 'Sim' : 'No'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* ENDEREÇO COMPLETO DA EMPRESA */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <MapPin className="w-4 h-4" />
                              ENDEREÇO DA EMPRESA
                            </h3>
                            <div className="space-y-3">
                              {seller.address ? (
                                <>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <Label className="text-xs font-medium text-gray-400">Rua</Label>
                                      <p className="mt-1 font-medium text-white">{seller.address.street || 'No informado'}</p>
                                    </div>
                                    <div>
                                      <Label className="text-xs font-medium text-gray-400">Nmero</Label>
                                      <p className="mt-1 font-medium text-white">{seller.address.number || 'No informado'}</p>
                                    </div>
                                  </div>
                                  
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <Label className="text-xs font-medium text-gray-400">Complemento</Label>
                                      <p className="mt-1 font-medium text-white">{seller.address.complement || 'No informado'}</p>
                                    </div>
                                    <div>
                                      <Label className="text-xs font-medium text-gray-400">Bairro</Label>
                                      <p className="mt-1 font-medium text-white">{seller.address.neighborhood || 'No informado'}</p>
                                    </div>
                                  </div>
                                  
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div>
                                      <Label className="text-xs font-medium text-gray-400">Cidade</Label>
                                      <p className="mt-1 font-medium text-white">{seller.address.city || 'No informado'}</p>
                                    </div>
                                    <div>
                                      <Label className="text-xs font-medium text-gray-400">Estado</Label>
                                      <p className="mt-1 font-medium text-white">{seller.address.state || 'No informado'}</p>
                                    </div>
                                    <div>
                                      <Label className="text-xs font-medium text-gray-400">CEP</Label>
                                      <p className="mt-1 font-medium text-white">{seller.address.zipCode || 'No informado'}</p>
                                    </div>
                                  </div>
                                  
                                  {/* ENDEREÇO COMPLETO FORMATADO */}
                                  <div className="mt-4 p-3 bg-black/40 border border-gray-700 rounded-lg">
                                    <Label className="text-xs font-medium text-gray-400">Endereço Completo</Label>
                                    <p className="mt-1 text-sm font-medium text-gray-300">
                                      {seller.address.street} {seller.address.number}
                                      {seller.address.complement && `, ${seller.address.complement}`}
                                      <br />
                                      {seller.address.neighborhood} - {seller.address.city}/{seller.address.state}
                                      <br />
                                      CEP: {seller.address.zipCode}
                                    </p>
                                  </div>
                                </>
                              ) : (
                                <div className="text-center py-4">
                                  <p className="text-sm text-gray-400">Endereço no informado</p>
                                </div>
                              )}
                            </div>
                          </div>

                        </div>

                        {/* COLUNA 2: DOCUMENTOS E INFORMAÇES EXTRAS */}
                        <div className="space-y-4">
                          
                          {/* DOCUMENTOS ENVIADOS */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              DOCUMENTOS ENVIADOS
                            </h3>
                            <div className="space-y-3">
                              {seller.documentsUrls ? (
                                <>
                                  {/* FOTOS / IMAGENS - thumbnails clicáveis */}
                                  {[
                                    { label: "Frente do Documento", url: seller.documentsUrls.documentFront },
                                    { label: "Verso do Documento",  url: seller.documentsUrls.documentBack },
                                    { label: "Selfie com Documento", url: seller.documentsUrls.selfieWithDocument },
                                  ].map(({ label, url }) => url ? (
                                    <div key={label} className="p-2 bg-black/40 rounded border border-gray-700">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm text-gray-300">{label}</span>
                                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 underline">
                                          Abrir
                                        </a>
                                      </div>
                                      <img
                                        src={url}
                                        alt={label}
                                        className="w-full rounded-lg object-cover cursor-zoom-in border border-gray-700 max-h-40"
                                        style={{ objectFit: "cover" }}
                                        onClick={() => setLightboxImg({ url, label })}
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                      />
                                    </div>
                                  ) : null)}

                                  {/* CARTÃO CNPJ (PDF) - só exibe se tiver */}
                                  {seller.documentsUrls.cnpjCard && (
                                    <div className="flex items-center justify-between p-2 bg-black/40 rounded border border-gray-700">
                                      <span className="text-sm text-gray-300">Cartão CNPJ (PDF)</span>
                                      <Button variant="outline" size="sm" className="border-gray-600 text-emerald-400" asChild>
                                        <a href={seller.documentsUrls.cnpjCard} target="_blank" rel="noopener">
                                          Ver PDF
                                        </a>
                                      </Button>
                                    </div>
                                  )}
                                  
                                  {/* VÍDEO DE VERIFICAÇÃO FACIAL */}
                                  {((seller as any).facialVerification || seller.documentsUrls?.facialVerification) && (
                                    <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-700">
                                      <div className="flex items-center justify-between gap-2 mb-3">
                                        <span className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                                          <Video className="w-5 h-5 text-emerald-400" />
                                          Verificação Facial (Vídeo KYC)
                                        </span>
                                        <div className="flex gap-2">
                                          <Button variant="outline" size="sm" className="border-gray-600 text-emerald-400" asChild>
                                            <a href={(seller as any).facialVerification || seller.documentsUrls?.facialVerification} target="_blank" rel="noopener noreferrer" data-testid={`link-facial-video-${seller.id}`} download>
                                              Baixar
                                            </a>
                                          </Button>
                                          <Button variant="outline" size="sm" className="border-gray-600 text-emerald-400" asChild>
                                            <a href={(seller as any).facialVerification || seller.documentsUrls?.facialVerification} target="_blank" rel="noopener noreferrer">
                                              Abrir
                                            </a>
                                          </Button>
                                        </div>
                                      </div>
                                      <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
                                        <video
                                          src={(seller as any).facialVerification || seller.documentsUrls?.facialVerification}
                                          className="w-full h-full object-contain"
                                          controls
                                          playsInline
                                          preload="auto"
                                          crossOrigin="anonymous"
                                          data-testid={`video-facial-${seller.id}`}
                                          style={{ backgroundColor: '#1a1a2e' }}
                                          onLoadStart={(e) => {
                                            console.log('Video loading started:', (seller as any).facialVerification || seller.documentsUrls?.facialVerification);
                                          }}
                                          onCanPlay={(e) => {
                                            console.log('Video can play');
                                          }}
                                          onError={(e) => {
                                            console.error('Erro ao carregar vídeo facial:', e);
                                            const target = e.target as HTMLVideoElement;
                                            target.style.display = 'none';
                                            const parent = target.parentElement;
                                            if (parent && !parent.querySelector('.video-error')) {
                                              const errorDiv = document.createElement('div');
                                              errorDiv.className = 'video-error flex flex-col items-center justify-center h-full text-center p-4 bg-gray-900';
                                              errorDiv.innerHTML = `
                                                <div class="text-emerald-400 mb-3">
                                                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                                                </div>
                                                <p class="text-gray-300 text-sm mb-3">O vídeo não pôde ser reproduzido diretamente</p>
                                                <a href="${(seller as any).facialVerification || seller.documentsUrls?.facialVerification}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                                                  Abrir em Nova Aba
                                                </a>
                                              `;
                                              parent.appendChild(errorDiv);
                                            }
                                          }}
                                        />
                                      </div>
                                      <p className="text-xs text-gray-400 mt-2 text-center">
                                        Clique no play para reproduzir ou abra em nova aba para ver em tela cheia
                                      </p>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="text-center py-6 bg-gray-900 rounded-lg border border-gray-700">
                                  <FileText className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                                  <p className="text-sm text-gray-400">Nenhum documento enviado</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* VÍDEO DE VERIFICAÇÃO FACIAL (fallback quando não há documentsUrls) */}
                          {!seller.documentsUrls && (seller as any).facialVerification && (
                            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                              <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                                <Video className="w-5 h-5" />
                                VERIFICAÇÃO FACIAL (KYC)
                              </h3>
                              <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
                                <div className="flex items-center justify-between gap-2 mb-3">
                                  <span className="text-sm font-semibold text-emerald-300">Vídeo de Verificação</span>
                                  <div className="flex gap-2">
                                    <Button variant="outline" size="sm" className="border-gray-600 text-emerald-400" asChild>
                                      <a href={(seller as any).facialVerification} target="_blank" rel="noopener noreferrer" data-testid={`link-facial-video-fallback-${seller.id}`} download>
                                        Baixar
                                      </a>
                                    </Button>
                                    <Button variant="outline" size="sm" className="border-gray-600 text-emerald-400" asChild>
                                      <a href={(seller as any).facialVerification} target="_blank" rel="noopener noreferrer">
                                        Abrir
                                      </a>
                                    </Button>
                                  </div>
                                </div>
                                <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
                                  <video
                                    src={(seller as any).facialVerification}
                                    className="w-full h-full object-contain"
                                    controls
                                    playsInline
                                    preload="auto"
                                    crossOrigin="anonymous"
                                    data-testid={`video-facial-fallback-${seller.id}`}
                                    style={{ backgroundColor: '#1a1a2e' }}
                                    onLoadStart={(e) => {
                                      console.log('Fallback video loading started:', (seller as any).facialVerification);
                                    }}
                                    onCanPlay={(e) => {
                                      console.log('Fallback video can play');
                                    }}
                                    onError={(e) => {
                                      console.error('Erro ao carregar vídeo facial:', e);
                                      const target = e.target as HTMLVideoElement;
                                      target.style.display = 'none';
                                      const parent = target.parentElement;
                                      if (parent && !parent.querySelector('.video-error')) {
                                        const errorDiv = document.createElement('div');
                                        errorDiv.className = 'video-error flex flex-col items-center justify-center h-full text-center p-4 bg-gray-900';
                                        errorDiv.innerHTML = `
                                          <div class="text-emerald-400 mb-3">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                                          </div>
                                          <p class="text-gray-300 text-sm mb-3">O vídeo não pôde ser reproduzido diretamente</p>
                                          <a href="${(seller as any).facialVerification}" target="_blank" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                                            Abrir em Nova Aba
                                          </a>
                                        `;
                                        parent.appendChild(errorDiv);
                                      }
                                    }}
                                  />
                                </div>
                                <p className="text-xs text-gray-400 mt-2 text-center">
                                  Clique no play para reproduzir ou abra em nova aba para ver em tela cheia
                                </p>
                              </div>
                            </div>
                          )}

                          {/* ENDEREÇO (se disponível) - Removido pois já existe na coluna 1 */}

                          {/* INFORMAÇES EXTRAS */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              INFORMAÇES ADICIONAIS
                            </h3>
                            <div className="space-y-2 text-sm">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">ID do Sistema</Label>
                                <p className="mt-1 font-mono text-xs bg-black/40 text-emerald-400 p-2 rounded border border-gray-700">{seller.id}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Última Atualização</Label>
                                <p className="mt-1 font-medium text-white">{seller.updatedAt ? `${seller.updatedAt.toLocaleDateString('pt-BR')} s ${seller.updatedAt.toLocaleTimeString('pt-BR')}` : 'Sem atualização'}</p>
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* Ver Dados Técnicos do Dispositivo */}
                  {(seller as any).deviceFingerprint && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Monitor className="w-4 h-4 mr-2" />
                          Dados Técnicos
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto !bg-black border border-gray-800 text-white">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2 text-white">
                            <Monitor className="w-5 h-5 text-emerald-500" />
                            Dados Técnicos do Dispositivo
                          </DialogTitle>
                          <DialogDescription className="text-gray-500">
                            Informações do dispositivo usado no cadastro para prevenção de fraudes e segurança
                          </DialogDescription>
                        </DialogHeader>
                        
                        <div className="space-y-4">
                          {/* INFORMAÇES GERAIS */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <Globe className="w-4 h-4" />
                              INFORMAÇES DE REDE E SISTEMA
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">IP de Registro</Label>
                                <p className="mt-1 font-mono text-sm text-white">{(seller as any).registrationIP || 'Não disponível'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Sistema Operacional</Label>
                                <p className="mt-1 font-medium text-sm text-white">{(seller as any).deviceFingerprint?.os || 'Não disponível'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Navegador</Label>
                                <p className="mt-1 font-medium text-sm text-white">{(seller as any).deviceFingerprint?.browser} {(seller as any).deviceFingerprint?.browserVersion}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Plataforma</Label>
                                <p className="mt-1 font-medium text-sm text-white">{(seller as any).deviceFingerprint?.platform || 'Não disponível'}</p>
                              </div>
                            </div>
                          </div>

                          {/* HARDWARE */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <Monitor className="w-4 h-4" />
                              HARDWARE E TELA
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Resoluo da Tela</Label>
                                <p className="mt-1 font-mono text-sm text-white">{(seller as any).deviceFingerprint?.screenResolution || 'Não disponível'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Profundidade de Cor</Label>
                                <p className="mt-1 font-medium text-sm text-white">{(seller as any).deviceFingerprint?.colorDepth}-bit</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">CPU Cores</Label>
                                <p className="mt-1 font-medium text-sm text-white">{(seller as any).deviceFingerprint?.cpuCores || 0} ncleos</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Memria RAM</Label>
                                <p className="mt-1 font-medium text-sm text-white">
                                  {(seller as any).deviceFingerprint?.deviceMemory 
                                    ? `${(seller as any).deviceFingerprint.deviceMemory} GB`
                                    : 'Não disponível'}
                                </p>
                              </div>
                              <div className="md:col-span-2">
                                <Label className="text-xs font-medium text-gray-400">GPU / Placa de Vdeo</Label>
                                <p className="mt-1 font-mono text-sm text-gray-300">
                                  {(seller as any).deviceFingerprint?.gpu || 'No detectada'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* LOCALIZAÇÃO E IDIOMA */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <Globe className="w-4 h-4" />
                              LOCALIZAÇÃO E PREFERNCIAS
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Fusão Horrio</Label>
                                <p className="mt-1 font-medium text-sm text-white">{(seller as any).deviceFingerprint?.timezone || 'Não disponível'}</p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Idioma do Navegador</Label>
                                <p className="mt-1 font-medium text-sm text-white">{(seller as any).deviceFingerprint?.language || 'Não disponível'}</p>
                              </div>
                            </div>
                          </div>

                          {/* CONSENTIMENTO */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                              <Shield className="w-4 h-4" />
                              CONSENTIMENTO E CONFORMIDADE
                            </h3>
                            <div className="space-y-3">
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Consentimento Dado</Label>
                                <p className={`mt-1 font-medium text-sm ${(seller as any).deviceFingerprint?.consentGiven ? 'text-blue-400' : 'text-red-400'}`}>
                                  {(seller as any).deviceFingerprint?.consentGiven 
                                    ? 'Sim - Aceito nos Termos de Uso'
                                    : 'No autorizado'}
                                </p>
                              </div>
                              <div>
                                <Label className="text-xs font-medium text-gray-400">Data do Consentimento</Label>
                                <p className="mt-1 font-medium text-sm text-white">
                                  {(seller as any).deviceFingerprint?.consentDate 
                                    ? new Date((seller as any).deviceFingerprint.consentDate).toLocaleString('pt-BR')
                                    : 'Não disponível'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* AVISO LEGAL */}
                          <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <div className="flex items-start gap-3">
                              <Shield className="h-5 w-5 text-emerald-400 mt-0.5" />
                              <p className="text-xs text-gray-400">
                                <strong className="text-emerald-400">Deciso LGPD/GDPR:</strong> Estes dados foram coletados com consentimento explcito do seller ao aceitar os Termos de Uso. 
                                Uso exclusivo para prevenção de fraudes e segurança da plataforma. Acesso restrito apenas para admin autorizado.
                              </p>
                            </div>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}

                  {/* Aprovar/Rejeitar apenas para pendentes */}
                  {seller.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleApprove(seller.id)}
                        disabled={processing === seller.id}
                        className="bg-emerald-500 hover:bg-emerald-500"
                      >
                        {processing === seller.id ? (
                          <>Aprovando...</>
                        ) : (
                          <>
                            <Check className="w-4 h-4 mr-2" />
                            Aprovar
                          </>
                        )}
                      </Button>

                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                            <X className="w-4 h-4 mr-2" />
                            Reprovar
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="!bg-black border border-gray-800 text-white">
                          <DialogHeader>
                            <DialogTitle className="text-white">Reprovar Seller</DialogTitle>
                            <DialogDescription className="text-gray-500">
                              Informe o motivo da reprovao para {seller.businessName}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <Label htmlFor="rejection-reason" className="text-gray-400">Motivo da Reprovao</Label>
                              <Textarea
                                id="rejection-reason"
                                placeholder="Ex: Documentos ilegveis, informações incorretas, CNPJ inválido..."
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                className="mt-2 bg-gray-900 border-gray-700 text-white placeholder:text-gray-600"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={() => setRejectionReason("")} className="border-gray-700 text-gray-300">
                                Cancelar
                              </Button>
                              <Button 
                                variant="destructive"
                                onClick={() => handleReject(seller.id, rejectionReason)}
                                disabled={!rejectionReason.trim() || processing === seller.id}
                              >
                                {processing === seller.id ? "Reprovando..." : "Confirmar Reprovao"}
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}

                  {/* Botão de Impersonation - para todos os sellers */}
                  {seller.email && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleImpersonate(seller.id, seller.email)}
                      disabled={processing === seller.id}
                      className="bg-gray-900 border-gray-700 text-emerald-400"
                      data-testid={`button-impersonate-${seller.id}`}
                    >
                      {processing === seller.id ? (
                        <>Gerando acesso...</>
                      ) : (
                        <>
                          <DoorOpen className="w-4 h-4 mr-2" />
                          Acessar Conta
                          <ExternalLink className="w-3 h-3 ml-2" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-8 h-8 text-emerald-700" />
              <h1 className="text-3xl font-bold tracking-tight">Aprovar Sellers</h1>
            </div>
            <p className="text-muted-foreground">
              Aprovar, rejeitar e gerenciar sellers por status
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <Clock className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-orange-600">{uniqueSellers.filter(s => !s.status || s.status === "pending").length}</span>
              <span className="text-xs text-orange-500">Pendentes</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-semibold text-emerald-600">{uniqueSellers.filter(s => s.status === "approved").length}</span>
              <span className="text-xs text-emerald-500">Aprovados</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-semibold text-red-600">{uniqueSellers.filter(s => s.status === "rejected").length}</span>
              <span className="text-xs text-red-500">Rejeitados</span>
            </div>
          </div>
        </div>

        {/* BUSCA DE SELLERS */}
        <Card className="border-blue-200 bg-emerald-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Search className="w-5 h-5 text-emerald-700" />
              <div className="flex-1">
                <Label htmlFor="search-email" className="text-sm font-medium text-muted-foreground">
                  Buscar sellers pendentes e rejeitados por email ou empresa
                </Label>
                <Input
                  id="search-email"
                  type="text"
                  placeholder="Digite o email ou nome da empresa..."
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
              {searchEmail && (
                <Button 
                  variant="outline" 
                  onClick={() => setSearchEmail("")}
                  className="text-emerald-700"
                >
                  Limpar
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {searchEmail ? `${filteredSellers.length} sellers encontrados para "${searchEmail}"` : 
               `${filteredSellers.length} sellers pendentes aguardando aprovação`}
            </p>
          </CardContent>
        </Card>

        {/* SELLERS PARA APROVAÇÃO */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-700" />
              Sellers Pendentes
            </h2>
            <Badge variant="outline" className="text-muted-foreground">
              {filteredSellers.length} sellers aguardando aprovação
            </Badge>
          </div>
          {renderSellersList()}
        </div>
      </div>

      {/* LIGHTBOX - visualizar imagem em tela cheia */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxImg(null)}
        >
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-semibold text-sm">{lightboxImg.label}</span>
              <div className="flex gap-2">
                <a
                  href={lightboxImg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded"
                  onClick={(e) => e.stopPropagation()}
                >
                  Abrir original
                </a>
                <button
                  onClick={() => setLightboxImg(null)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded"
                >
                  Fechar
                </button>
              </div>
            </div>
            <img
              src={lightboxImg.url}
              alt={lightboxImg.label}
              className="w-full max-h-[80vh] object-contain rounded-lg border border-gray-700"
            />
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}