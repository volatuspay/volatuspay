import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Eye, Edit, Ban, UnlockKeyhole, Building, Phone, Mail, MapPin, Search, Percent, DollarSign, Shield, CheckCircle, XCircle, AlertTriangle, ChevronLeft, ChevronRight, User, FileText, UserCheck, ExternalLink, Monitor, DoorOpen, CreditCard, Smartphone, Receipt, Globe } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import type { Seller } from "@shared/schema";

// Interface estendida para sellers com campos administrativos
interface ExtendedSeller extends Seller {
  // PIX EfiBank
  customPixFixedFee?: number; // Taxa fixa PIX
  customPixPercentFee?: number; // Taxa % PIX
  customPixWithdrawalDays?: number; // Prazo saque PIX (D+)
  // Cartão EfiBank
  customCardFixedFee?: number; // Taxa fixa Cartão
  customCardPercentFee?: number; // Taxa % Cartão
  customCardWithdrawalDays?: number; // Prazo saque Cartão EfiBank (D+)
  // Taxas Parceladas EfiBank
  customInstallment1x?: number; // Taxa vista 1x (%)
  customInstallment2to6x?: number; // Taxa 2x a 6x (%)
  customInstallment7to9x?: number; // Taxa 7x a 9x (%)
  customInstallment10to12x?: number; // Taxa 10x a 12x (%)
  // Stripe Global
  customStripeFixedFee?: number; // Taxa fixa Stripe
  customStripePercentFee?: number; // Taxa % Stripe
  customStripeWithdrawalDays?: number; // Prazo saque Stripe (D+)
  // Taxas Parceladas Stripe
  customStripeInstallment1x?: number; // Taxa vista 1x Stripe (%)
  customStripeInstallment2to6x?: number; // Taxa 2x a 6x Stripe (%)
  customStripeInstallment7to9x?: number; // Taxa 7x a 9x Stripe (%)
  customStripeInstallment10to12x?: number; // Taxa 10x a 12x Stripe (%)
  isBlocked?: boolean;
  blockedReason?: string;
  blockedAt?: Date;
  cnpj?: string;
  // FOTOS E DADOS REAIS DO FIREBASE
  profilePhoto?: string;
  photoURL?: string;
  fullName?: string;
}
import { db, auth } from "@/lib/firebase";
import type { Firestore } from "firebase/firestore";
import type { Auth } from "firebase/auth";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, setDoc, serverTimestamp, deleteField } from "firebase/firestore";
import { ADMIN_CONFIG } from "@shared/app-config";

export default function ManageSellers() {
  const [allSellers, setAllSellers] = useState<ExtendedSeller[]>([]);
  const [filteredSellers, setFilteredSellers] = useState<ExtendedSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeller, setSelectedSeller] = useState<ExtendedSeller | null>(null);
  const [searchEmail, setSearchEmail] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [editingFees, setEditingFees] = useState<{
    id: string;
    // PIX EfiBank
    pixFixedFee: number;
    pixPercentFee: number;
    pixWithdrawalDays: number;
    // Cartão EfiBank  
    cardFixedFee: number;
    cardPercentFee: number;
    cardWithdrawalDays: number;
    // Parcelas EfiBank
    installment1x?: number;
    installment2to6x?: number;
    installment7to9x?: number;
    installment10to12x?: number;
    // Stripe Global
    stripeFixedFee: number;
    stripePercentFee: number;
    stripeWithdrawalDays: number;
    // Parcelas Stripe
    stripeInstallment1x?: number;
    stripeInstallment2to6x?: number;
    stripeInstallment7to9x?: number;
    stripeInstallment10to12x?: number;
  } | null>(null);
  const [blockingReason, setBlockingReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [sellerAcquirers, setSellerAcquirers] = useState<Record<string, { pix?: string; boleto?: string; creditCardBR?: string; creditCardGlobal?: string; creditCard?: string }>>({});
  const [savingAcquirers, setSavingAcquirers] = useState<string | null>(null);
  const sellersPerPage = 10;
  const { toast } = useToast();
  const [lightboxImg, setLightboxImg] = useState<{ url: string; label: string } | null>(null);

  // BUSCAR TODOS OS SELLERS VIA API BACKEND - NICOS POR EMAIL
  useEffect(() => {
    console.log("Admin buscando TODOS os sellers nicos para gerenciamento via API...");
    
    const loadSellers = async () => {
      try {
        console.log('INICIANDO REQUISIÇÃO /api/admin/sellers...');
        const token = await import('@/lib/firebase').then(m => m.auth.currentUser?.getIdToken()) || '';
        console.log('Token obtido:', token ? 'SIM' : 'NÃO');
        
        const response = await fetch('/api/admin/sellers', {
          credentials: 'include',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        console.log('Response status:', response.status, response.statusText);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Erro na resposta:', errorText);
          throw new Error('Erro ao carregar sellers');
        }
        
        const sellersData = await response.json();
        console.log(' DADOS DOS SELLERS CARREGADOS:', sellersData);
        
        const processedSellers: ExtendedSeller[] = [];
        const emailsSet = new Set<string>(); // Para garantir emails nicos
        
        // API RETORNA FORMATO: { success: true, sellers: [...], total: number }
        const allSellersArray = sellersData.sellers || [];
        console.log(' ARRAY DE SELLERS EXTRADO:', allSellersArray);
        
        allSellersArray.forEach((data: any) => {
          const sellerEmail = data.email?.toLowerCase();
          
          // Desconto: APENAS 1 SELLER POR EMAIL - evitar duplicatas
          if (!emailsSet.has(sellerEmail)) {
            emailsSet.add(sellerEmail);
            processedSellers.push({
              id: data.id,
              ...data,
              createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
              updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
              approvedAt: data.approvedAt ? new Date(data.approvedAt) : undefined,
              rejectedAt: data.rejectedAt ? new Date(data.rejectedAt) : undefined,
              customPixFixedFee: data.customPixFixedFee,
              customPixPercentFee: data.customPixPercentFee,
              customCardFixedFee: data.customCardFixedFee,
              customCardPercentFee: data.customCardPercentFee,
              customStripeFixedFee: data.customStripeFixedFee,
              customStripePercentFee: data.customStripePercentFee,
              isBlocked: data.isBlocked || false,
              blockedReason: data.blockedReason,
              blockedAt: data.blockedAt ? new Date(data.blockedAt) : undefined,
            } as any);
          } else {
            console.log("Email duplicado ignorado:", sellerEmail);
          }
        });
        
        console.log(`Admin encontrou via API: ${processedSellers.length} sellers nicos`);
        setAllSellers(processedSellers);

        // Inicializar estado de adquirentes com os valores JÁ SALVOS de cada seller
        const initialAcquirers: Record<string, { pix?: string; boleto?: string; creditCardBR?: string; creditCardGlobal?: string; creditCard?: string }> = {};
        processedSellers.forEach((seller: any) => {
          if (seller.acquirers) {
            initialAcquirers[seller.id] = {
              pix: seller.acquirers.pix || undefined,
              boleto: seller.acquirers.boleto || undefined,
              creditCardBR: seller.acquirers.creditCardBR || undefined,
              creditCardGlobal: seller.acquirers.creditCardGlobal || undefined,
              creditCard: seller.acquirers.creditCard || undefined,
            };
          }
        });
        setSellerAcquirers(initialAcquirers);

        setLoading(false);
        
      } catch (error) {
        console.error('Erro ao carregar sellers via API:', error);
        setLoading(false);
      }
    };

    loadSellers();
  }, []);

  // Desconto: FILTRAR APENAS SELLERS APROVADOS + BUSCA POR EMAIL
  useEffect(() => {
    // FILTRO PRINCIPAL: APENAS SELLERS APROVADOS
    let filtered = allSellers.filter(seller => seller.status === "approved");
    
    console.log(`Desconto: MANAGE SELLERS - Total sellers: ${allSellers.length}, Apenas aprovados: ${filtered.length}`);
    
    // SEGUNDO FILTRO: Busca por email/empresa
    if (searchEmail.trim()) {
      filtered = filtered.filter(seller => 
        seller.email.toLowerCase().includes(searchEmail.toLowerCase()) ||
        seller.businessName?.toLowerCase().includes(searchEmail.toLowerCase())
      );
    }
    
    console.log(`Manage Sellers: ${filtered.length} sellers aprovados (após busca)`);
    
    setFilteredSellers(filtered);
    setCurrentPage(1);
  }, [allSellers, searchEmail]);

  // DEFINIR TAXAS MANUAIS COMPLETAS
  const handleSaveFees = async (sellerId: string, fees: {
    pixFixedFee: number;
    pixPercentFee: number;
    pixWithdrawalDays: number;
    cardFixedFee: number;
    cardPercentFee: number;
    cardWithdrawalDays: number;
    installment1x: number;
    installment2to6x: number;
    installment7to9x: number;
    installment10to12x: number;
    stripeFixedFee: number;
    stripePercentFee: number;
    stripeWithdrawalDays: number;
    stripeInstallment1x: number;
    stripeInstallment2to6x: number;
    stripeInstallment7to9x: number;
    stripeInstallment10to12x: number;
  }) => {
    try {
      console.log("Admin salvando TODAS as taxas e prazos para seller:", sellerId, fees);
      
      const sellerRef = doc(db as Firestore, "sellers", sellerId);
      
      // USAR setDoc com merge: true PARA GARANTIR CRIAÇÃO/ATUALIZAÇÃO
      // Campos zerados/não preenchidos usam deleteField() para remover do Firestore
      // (assim o seller volta ao padrão global sem sobrescrever com 0)
      const fv = (v: number | undefined) => (v !== undefined && v !== 0) ? v : deleteField();
      await setDoc(sellerRef, {
        customPixFixedFee: fv(fees.pixFixedFee),
        customPixPercentFee: fv(fees.pixPercentFee),
        customPixWithdrawalDays: fv(fees.pixWithdrawalDays),
        customCardFixedFee: fv(fees.cardFixedFee),
        customCardPercentFee: fv(fees.cardPercentFee),
        customCardWithdrawalDays: fv(fees.cardWithdrawalDays),
        customInstallment1x: fv(fees.installment1x),
        customInstallment2to6x: fv(fees.installment2to6x),
        customInstallment7to9x: fv(fees.installment7to9x),
        customInstallment10to12x: fv(fees.installment10to12x),
        customStripeFixedFee: fv(fees.stripeFixedFee),
        customStripePercentFee: fv(fees.stripePercentFee),
        customStripeWithdrawalDays: fv(fees.stripeWithdrawalDays),
        customStripeInstallment1x: fv(fees.stripeInstallment1x),
        customStripeInstallment2to6x: fv(fees.stripeInstallment2to6x),
        customStripeInstallment7to9x: fv(fees.stripeInstallment7to9x),
        customStripeInstallment10to12x: fv(fees.stripeInstallment10to12x),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      toast({
        title: " Taxas e prazos salvos eternamente!",
        description: "Todas as configurações personalizadas foram salvas no Firebase.",
      });

      setEditingFees(null);
    } catch (error) {
      console.error("Erro ao salvar taxas:", error);
      toast({
        title: " Erro ao salvar",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    }
  };

  // BLOQUEAR SELLER
  const handleBlockSeller = async (sellerId: string, reason: string) => {
    try {
      console.log("Admin bloqueando seller:", sellerId, "Motivo:", reason);
      
      const sellerRef = doc(db as Firestore, "sellers", sellerId);
      await updateDoc(sellerRef, {
        isBlocked: true,
        blockedReason: reason,
        blockedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast({
        title: " Seller bloqueado!",
        description: "Todas as funcionalidades foram bloqueadas.",
      });

      setBlockingReason("");
    } catch (error) {
      console.error("Erro ao bloquear:", error);
      toast({
        title: " Erro ao bloquear",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    }
  };

  // DESBLOQUEAR SELLER
  const handleUnblockSeller = async (sellerId: string) => {
    try {
      console.log("Admin desbloqueando seller:", sellerId);
      
      const sellerRef = doc(db as Firestore, "sellers", sellerId);
      await updateDoc(sellerRef, {
        isBlocked: false,
        blockedReason: null,
        blockedAt: null,
        updatedAt: serverTimestamp(),
      });

      toast({
        title: " Seller desbloqueado!",
        description: "Funcionalidades restauradas com sucesso.",
      });
    } catch (error) {
      console.error("Erro ao desbloquear:", error);
      toast({
        title: " Erro ao desbloquear",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
      });
    }
  };

  // IMPERSONATION - ACESSAR CONTA DO SELLER
  const handleImpersonate = async (sellerId: string, sellerEmail: string) => {
    console.log('INICIANDO IMPERSONATION:', sellerId, sellerEmail);
    setProcessing(sellerId);
    try {
      // Pegar o usuário atual para enviar o adminUserId
      const user = await new Promise<any>((resolve) => {
        (auth as Auth).onAuthStateChanged(resolve);
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

      console.log('ENVIANDO REQUISIÇÃO PARA API:', {
        url: '/api/admin/impersonate-seller',
        method: 'POST',
        body: { sellerId, adminUserId: user.uid }
      });

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

      console.log('RESPOSTA DA API:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
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
        console.log('ERRO DA API:', error);
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

  // SALVAR CONFIGURAÇES DE ADQUIRENTES DO SELLER
  const handleSaveAcquirers = async (sellerId: string) => {
    setSavingAcquirers(sellerId);
    try {
      const config = sellerAcquirers[sellerId] || {};
      
      const user = auth.currentUser;
      if (!user) {
        toast({
          title: " Acesso negado",
          description: "Vocprecisa estar logado como admin",
          variant: "destructive",
        });
        return;
      }
      
      const idToken = await user.getIdToken();
      
      const response = await fetch(`/api/admin/seller-acquirers/${sellerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          acquirers: {
            pix: config.pix,
            boleto: config.boleto,
            creditCardBR: config.creditCardBR,
            creditCardGlobal: config.creditCardGlobal,
            // BACKWARD COMPATIBILITY: Manter creditCard para sellers antigos
            creditCard: config.creditCard,
          }
        }),
      });

      if (response.ok) {
        toast({
          title: "Adquirentes Configurados!",
          description: "As configurações foram salvas com sucesso no Firebase",
        });
      } else {
        throw new Error('Erro ao salvar');
      }
    } catch (error) {
      console.error('Erro ao salvar adquirentes:', error);
      toast({
        title: "Erro ao Salvar",
        description: "No foi possvel salvar as configurações",
        variant: "destructive",
      });
    } finally {
      setSavingAcquirers(null);
    }
  };

  // PAGINAÇÃO
  const totalPages = Math.ceil(filteredSellers.length / sellersPerPage);
  const startIndex = (currentPage - 1) * sellersPerPage;
  const currentSellers = filteredSellers.slice(startIndex, startIndex + sellersPerPage);

  const getStatusBadge = (seller: ExtendedSeller) => {
    if (seller.isBlocked) {
      return <Badge variant="destructive" className="flex items-center gap-1"><Ban className="w-3 h-3" />Bloqueado</Badge>;
    }
    
    switch (seller.status) {
      case 'approved':
        return <Badge variant="default" className="flex items-center gap-1 bg-brand-subtle0"><CheckCircle className="w-3 h-3" />Aprovado</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="w-3 h-3" />Reprovado</Badge>;
      default:
        return <Badge variant="secondary" className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Pendente</Badge>;
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="text-6xl mb-4 animate-spin"></div>
            <p className="text-xl font-medium">Carregando sellers...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Building className="w-8 h-8 text-brand-muted-foreground" />
              <h1 className="text-3xl font-bold tracking-tight">Gerenciar Sellers</h1>
            </div>
            <p className="text-muted-foreground">
              Gerencie todos os sellers da plataforma - taxas, bloqueios e informações
            </p>
          </div>
          <Badge variant="outline" className="text-brand-muted-foreground border-brand-muted">
            <CheckCircle className="w-4 h-4 mr-1 text-brand-muted-foreground" />
            {filteredSellers.length} sellers encontrados
          </Badge>
        </div>

        {/* FILTROS */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700" />
                <Input
                  placeholder="Buscar por email ou nome da empresa..."
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Badge variant="secondary">
                {filteredSellers.length} resultado{filteredSellers.length !== 1 ? 's' : ''}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* TABELA DE SELLERS */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Seller</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Taxas Customizadas</TableHead>
                  <TableHead>Data Cadastroo</TableHead>
                  <TableHead className="text-right">Aes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentSellers.map((seller) => (
                  <TableRow key={seller.id} className={seller.isBlocked ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage 
                            src={seller.documentsUrls?.selfieWithDocument || seller.profilePhoto || seller.photoURL || seller.documentsUrls?.documentFront} 
                            alt={seller.businessName || seller.email}
                          />
                          <AvatarFallback className="bg-emerald-100 text-muted-foreground">
                            {seller.businessName?.[0]?.toUpperCase() || seller.email[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">{seller.businessName || 'Não informado'}</p>
                          <p className="text-sm text-muted-foreground">{seller.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(seller)}
                    </TableCell>
                    <TableCell>
                      {(seller.customPixFixedFee !== undefined || seller.customPixPercentFee !== undefined ||
                        seller.customCardFixedFee !== undefined || seller.customCardPercentFee !== undefined ||
                        seller.customStripeFixedFee !== undefined || seller.customStripePercentFee !== undefined) ? (
                        <div className="text-sm space-y-1 text-foreground">
                          {(seller.customPixFixedFee !== undefined || seller.customPixPercentFee !== undefined) && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">PIX:</span>
                              <span className="text-foreground">
                                {seller.customPixFixedFee !== undefined && `R$ ${seller.customPixFixedFee.toFixed(2)}`}
                                {seller.customPixFixedFee !== undefined && seller.customPixPercentFee !== undefined && ' + '}
                                {seller.customPixPercentFee !== undefined && `${seller.customPixPercentFee}%`}
                              </span>
                            </div>
                          )}
                          {(seller.customCardFixedFee !== undefined || seller.customCardPercentFee !== undefined) && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Card:</span>
                              <span className="text-foreground">
                                {seller.customCardFixedFee !== undefined && `R$ ${seller.customCardFixedFee.toFixed(2)}`}
                                {seller.customCardFixedFee !== undefined && seller.customCardPercentFee !== undefined && ' + '}
                                {seller.customCardPercentFee !== undefined && `${seller.customCardPercentFee}%`}
                              </span>
                            </div>
                          )}
                          {(seller.customStripeFixedFee !== undefined || seller.customStripePercentFee !== undefined) && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Stripe:</span>
                              <span className="text-foreground">
                                {seller.customStripeFixedFee !== undefined && `R$ ${seller.customStripeFixedFee.toFixed(2)}`}
                                {seller.customStripeFixedFee !== undefined && seller.customStripePercentFee !== undefined && ' + '}
                                {seller.customStripePercentFee !== undefined && `${seller.customStripePercentFee}%`}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <Badge variant="outline">Padrão global</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-foreground">
                        {seller.createdAt ? seller.createdAt.toLocaleDateString('pt-BR') : 'Data não disponível'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        
                        {/* CONFIGURAR ADQUIRENTES (PIX, BOLETO, CARTÃO) - BOTÃO VERMELHO GIGANTE */}
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              variant="default" 
                              size="sm" 
                              className="bg-blue-600 hover:bg-blue-700 text-white"
                              title="Configurar adquirentes (PIX, Boleto, Cartão)"
                            >
                              ADQUIRENTES
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl bg-white border-gray-200 shadow-lg">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
                                <CreditCard className="w-4 h-4 text-gray-400" />
                                Configurar Adquirentes de Pagamento
                              </DialogTitle>
                              <DialogDescription className="text-gray-500 text-sm">
                                Defina qual adquirente processar os pagamentos de <strong className="text-gray-900">{seller.businessName}</strong>. Configurações isoladas neste seller - demais sellers usam padrão global.
                              </DialogDescription>
                            </DialogHeader>
                            
                            <div className="space-y-5 mt-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {/* PIX */}
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                  <div className="flex items-center gap-2 mb-3">
                                    <DollarSign className="w-4 h-4 text-gray-400" />
                                    <Label className="text-sm font-semibold text-gray-900">PIX</Label>
                                  </div>
                                  <Select
                                    value={sellerAcquirers[seller.id]?.pix || 'default'}
                                    onValueChange={(value) => {
                                      setSellerAcquirers(prev => ({
                                        ...prev,
                                        [seller.id]: { ...prev[seller.id], pix: value === 'default' ? undefined : value }
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="w-full bg-white border-gray-200 text-gray-900 text-sm">
                                      <SelectValue placeholder="Selecionar" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border-gray-200">
                                      <SelectItem value="default">Usar Padrão Global</SelectItem>
                                      <SelectItem value="efibank">EfíBank (Gerencianet)</SelectItem>
                                      <SelectItem value="onz">ONZ Finance</SelectItem>
                                      <SelectItem value="woovi">Woovi (OpenPix)</SelectItem>
                                      <SelectItem value="pagarme">Pagar.me</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* BOLETO */}
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                  <div className="flex items-center gap-2 mb-3">
                                    <Receipt className="w-4 h-4 text-gray-400" />
                                    <Label className="text-sm font-semibold text-gray-900">Boleto</Label>
                                  </div>
                                  <Select
                                    value={sellerAcquirers[seller.id]?.boleto || 'default'}
                                    onValueChange={(value) => {
                                      setSellerAcquirers(prev => ({
                                        ...prev,
                                        [seller.id]: { ...prev[seller.id], boleto: value === 'default' ? undefined : value }
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="w-full bg-white border-gray-200 text-gray-900 text-sm">
                                      <SelectValue placeholder="Selecionar" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border-gray-200">
                                      <SelectItem value="default">Usar Padrão Global</SelectItem>
                                      <SelectItem value="efibank">EfíBank (Gerencianet)</SelectItem>
                                      <SelectItem value="pagarme">Pagar.me</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* CARTÃO BR */}
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                  <div className="flex items-center gap-2 mb-3">
                                    <CreditCard className="w-4 h-4 text-gray-400" />
                                    <Label className="text-sm font-semibold text-gray-900">Cartão BR</Label>
                                  </div>
                                  <Select
                                    value={sellerAcquirers[seller.id]?.creditCardBR || 'default'}
                                    onValueChange={(value) => {
                                      setSellerAcquirers(prev => ({
                                        ...prev,
                                        [seller.id]: { ...prev[seller.id], creditCardBR: value === 'default' ? undefined : value }
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="w-full bg-white border-gray-200 text-gray-900 text-sm">
                                      <SelectValue placeholder="Selecionar" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border-gray-200">
                                      <SelectItem value="default">Usar Padrão Global</SelectItem>
                                      <SelectItem value="efibank">EfíBank (Gerencianet)</SelectItem>
                                      <SelectItem value="pagarme">Pagar.me</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {/* INFORMAÇÃO DE ISOLAMENTO */}
                              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                  <Shield className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-900 mb-1">Configuração Isolada por Seller</h4>
                                    <p className="text-xs text-gray-500 leading-relaxed">
                                      Ao selecionar um adquirente específico, <strong className="text-gray-900">apenas este seller</strong> ({seller.businessName}) usará essa configuração. Todos os outros sellers continuarão usando o padrão global. Ideal para taxas negociadas individualmente.
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {/* BOTÃO SALVAR */}
                              <div className="flex justify-end pt-3 border-t border-gray-100">
                                <Button
                                  onClick={() => handleSaveAcquirers(seller.id)}
                                  disabled={savingAcquirers === seller.id}
                                  className="bg-gray-900 hover:bg-gray-800 text-white px-6"
                                >
                                  {savingAcquirers === seller.id ? (
                                    <><Monitor className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
                                  ) : (
                                    <>Salvar Configurações</>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                        
                        {/* LOGIN NA CONTA (IMPERSONATION) */}
                        {seller.status === 'approved' && !seller.isBlocked && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => {
                              console.log('BOTÃO IMPERSONATION - Seller:', seller.email, {
                                status: seller.status,
                                isBlocked: seller.isBlocked,
                                canImpersonate: seller.status === 'approved' && !seller.isBlocked,
                                displayButton: true
                              });
                              handleImpersonate(seller.id, seller.email);
                            }}
                            disabled={processing === seller.id}
                            title="Fazer login na conta do seller"
                          >
                            <DoorOpen className="w-4 h-4" />
                          </Button>
                        )}
                        
                        {/* VER DETALHES */}
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedSeller(seller)}>
                              <Eye className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-gray-900 border-gray-700 text-white">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2 text-white">
                                <Building className="w-5 h-5 text-gray-400" />
                                Dados Completos do Seller
                              </DialogTitle>
                              <DialogDescription className="text-gray-400">
                                Todas as informações reais coletadas no cadastro - dados pessoais, empresa e documentos
                              </DialogDescription>
                            </DialogHeader>
                            {selectedSeller && (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                
                                {/* COLUNA 1: DADOS PESSOAIS */}
                                <div className="space-y-6">
                                  
                                  {/* INFORMAÇES PESSOAIS */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                      <User className="w-4 h-4 text-gray-400" />
                                      DADOS PESSOAIS
                                    </h3>
                                    <div className="space-y-3">
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Nome Completo</Label>
                                        <p className={`mt-1 font-medium ${selectedSeller.name ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.name || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Email</Label>
                                        <p className={`mt-1 font-medium ${selectedSeller.email ? 'text-blue-400' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.email || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Telefone/WhatsApp</Label>
                                        <p className={`mt-1 font-medium ${selectedSeller.phone ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.phone || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Data de Nascimento</Label>
                                        <p className={`mt-1 font-medium ${selectedSeller.birthDate ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.birthDate || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Tipo Documento Pessoal</Label>
                                        <p className={`mt-1 font-medium uppercase ${selectedSeller.personalDocumentType ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.personalDocumentType || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Nmero Documento Pessoal</Label>
                                        <p className={`mt-1 font-medium ${selectedSeller.personalDocumentNumber ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.personalDocumentNumber || 'No informado'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* DADOS DA EMPRESA */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                      <Building className="w-4 h-4 text-gray-400" />
                                      DADOS DA EMPRESA
                                    </h3>
                                    <div className="space-y-3">
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Nome da Empresa</Label>
                                        <p className={`mt-1 font-medium ${selectedSeller.businessName ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.businessName || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">CNPJ</Label>
                                        <p className={`mt-1 font-medium ${(selectedSeller.document || selectedSeller.cnpj) ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.document || selectedSeller.cnpj || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Tipo de Conta</Label>
                                        <div className="mt-1">
                                          {(selectedSeller as any).accountType === 'creator'
                                            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-[#374800] border border-blue-200">✦ Creator</span>
                                            : (selectedSeller as any).accountType === 'vendedor'
                                              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">🏪 Vendedor</span>
                                              : <span className="text-muted-foreground italic text-sm">Não informado</span>
                                          }
                                        </div>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Mercado / Segmento (declarado no cadastro)</Label>
                                        <p className={`mt-1 text-sm p-2 rounded border border-gray-600 ${(selectedSeller as any).marketSegment ? 'bg-gray-700 text-white' : 'bg-transparent text-gray-500 italic'}`}>
                                          {(selectedSeller as any).marketSegment || 'Não informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Nicho do Negócio</Label>
                                        <p className={`mt-1 font-medium ${selectedSeller.businessNiche ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.businessNiche || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Tipo de Produto</Label>
                                        <Badge variant="secondary" className="mt-1">
                                          {selectedSeller.productType === 'digital' ? 'Digital' : 'No informado'}
                                        </Badge>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Descrição dos Produtos</Label>
                                        <p className={`mt-1 text-sm bg-gray-700 p-2 rounded border border-gray-600 ${selectedSeller.productsDescription ? 'text-white' : 'text-gray-500 italic'}`}>
                                          {selectedSeller.productsDescription || 'No informado'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* ENDEREÇO DA EMPRESA */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                      <MapPin className="w-4 h-4 text-gray-400" />
                                      ENDEREÇO DA EMPRESA
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Rua</Label>
                                        <p 
                                          className={`mt-1 font-medium ${selectedSeller.address?.street ? 'text-white' : 'text-gray-500 italic'}`}
                                          data-testid="text-address-street"
                                        >
                                          {selectedSeller.address?.street || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Nmero</Label>
                                        <p 
                                          className={`mt-1 font-medium ${selectedSeller.address?.number ? 'text-white' : 'text-gray-500 italic'}`}
                                          data-testid="text-address-number"
                                        >
                                          {selectedSeller.address?.number || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Complemento</Label>
                                        <p 
                                          className={`mt-1 font-medium ${selectedSeller.address?.complement ? 'text-white' : 'text-gray-500 italic'}`}
                                          data-testid="text-address-complement"
                                        >
                                          {selectedSeller.address?.complement || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Bairro</Label>
                                        <p 
                                          className={`mt-1 font-medium ${selectedSeller.address?.neighborhood ? 'text-white' : 'text-gray-500 italic'}`}
                                          data-testid="text-address-neighborhood"
                                        >
                                          {selectedSeller.address?.neighborhood || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Cidade</Label>
                                        <p 
                                          className={`mt-1 font-medium ${selectedSeller.address?.city ? 'text-white' : 'text-gray-500 italic'}`}
                                          data-testid="text-address-city"
                                        >
                                          {selectedSeller.address?.city || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Estado</Label>
                                        <p 
                                          className={`mt-1 font-medium ${selectedSeller.address?.state ? 'text-white' : 'text-gray-500 italic'}`}
                                          data-testid="text-address-state"
                                        >
                                          {selectedSeller.address?.state || 'No informado'}
                                        </p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">CEP</Label>
                                        <p 
                                          className={`mt-1 font-medium ${selectedSeller.address?.zipCode ? 'text-white' : 'text-gray-500 italic'}`}
                                          data-testid="text-address-zipcode"
                                        >
                                          {selectedSeller.address?.zipCode ? 
                                            selectedSeller.address.zipCode.replace(/(\d{5})(\d{3})/, '$1-$2') : // Formatar CEP para exibio
                                            'No informado'
                                          }
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* STATUS E CONTROLE */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                      <Shield className="w-4 h-4 text-gray-400" />
                                      STATUS DA CONTA
                                    </h3>
                                    <div className="space-y-3">
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Status Atual</Label>
                                        <div className="mt-1">{getStatusBadge(selectedSeller)}</div>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Data de Cadastroo</Label>
                                        <p className="mt-1 font-medium">{selectedSeller.createdAt ? `${selectedSeller.createdAt.toLocaleDateString('pt-BR')} s ${selectedSeller.createdAt.toLocaleTimeString('pt-BR')}` : 'Data não disponível'}</p>
                                      </div>
                                      {selectedSeller.approvedAt && (
                                        <div>
                                          <Label className="text-xs font-medium text-muted-foreground">Data de Aprovação</Label>
                                          <p className="mt-1 font-medium text-gray-300">{selectedSeller.approvedAt ? `${selectedSeller.approvedAt.toLocaleDateString('pt-BR')} s ${selectedSeller.approvedAt.toLocaleTimeString('pt-BR')}` : 'No aprovado'}</p>
                                        </div>
                                      )}
                                      {selectedSeller.rejectedAt && (
                                        <div>
                                          <Label className="text-xs font-medium text-muted-foreground">Data de Rejeio</Label>
                                          <p className="mt-1 font-medium text-gray-300">{selectedSeller.rejectedAt ? `${selectedSeller.rejectedAt.toLocaleDateString('pt-BR')} s ${selectedSeller.rejectedAt.toLocaleTimeString('pt-BR')}` : 'No rejeitado'}</p>
                                        </div>
                                      )}
                                      {selectedSeller.rejectionReason && (
                                        <div>
                                          <Label className="text-xs font-medium text-muted-foreground">Motivo da Rejeio</Label>
                                          <p className="mt-1 text-sm bg-gray-700 text-white p-2 rounded border border-gray-600">
                                            {selectedSeller.rejectionReason}
                                          </p>
                                        </div>
                                      )}
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Termos Aceitos</Label>
                                        <Badge variant={selectedSeller.acceptedTerms ? "default" : "destructive"} className="mt-1">
                                          {selectedSeller.acceptedTerms ? 'Sim' : 'No'}
                                        </Badge>
                                      </div>
                                    </div>
                                  </div>

                                </div>

                                {/* COLUNA 2: DOCUMENTOS E BLOQUEIO */}
                                <div className="space-y-6">
                                  
                                  {/* DOCUMENTOS ENVIADOS */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                      <FileText className="w-4 h-4 text-gray-400" />
                                      DOCUMENTOS ENVIADOS
                                    </h3>
                                    <div className="space-y-3">
                                      {selectedSeller.documentsUrls && Object.keys(selectedSeller.documentsUrls).length > 0 ? (
                                        <>
                                          {/* FOTOS - thumbnails clicáveis */}
                                          {[
                                            { label: "Frente do Documento", url: selectedSeller.documentsUrls.documentFront },
                                            { label: "Verso do Documento",  url: selectedSeller.documentsUrls.documentBack },
                                            { label: "Selfie com Documento", url: selectedSeller.documentsUrls.selfieWithDocument },
                                          ].map(({ label, url }) => url ? (
                                            <div key={label} className="p-2 bg-gray-700 rounded border border-gray-600">
                                              <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm">{label}</span>
                                                <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 underline">
                                                  Abrir
                                                </a>
                                              </div>
                                              <img
                                                src={url}
                                                alt={label}
                                                className="w-full rounded object-cover cursor-zoom-in border max-h-40"
                                                style={{ objectFit: "cover" }}
                                                onClick={() => setLightboxImg({ url, label })}
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                              />
                                            </div>
                                          ) : (
                                            <div key={label} className="flex items-center justify-between p-2 bg-gray-700 rounded border border-gray-600">
                                              <span className="text-sm text-gray-400">{label}</span>
                                              <span className="text-xs text-gray-500">Não informado</span>
                                            </div>
                                          ))}

                                          {/* CARTÃO CNPJ (PDF) */}
                                          {selectedSeller.documentsUrls.cnpjCard ? (
                                            <div className="flex items-center justify-between p-2 bg-gray-700 rounded border border-gray-600">
                                              <span className="text-sm text-gray-200">Cartão CNPJ (PDF)</span>
                                              <Button variant="outline" size="sm" asChild>
                                                <a href={selectedSeller.documentsUrls.cnpjCard} target="_blank" rel="noopener">
                                                  Ver PDF
                                                </a>
                                              </Button>
                                            </div>
                                          ) : (
                                            <div className="flex items-center justify-between p-2 bg-gray-700 rounded border border-gray-600">
                                              <span className="text-sm text-gray-400">Cartão CNPJ (PDF)</span>
                                              <span className="text-xs text-gray-500">Não informado</span>
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <p className="text-sm text-muted-foreground">Nenhum documento enviado</p>
                                      )}
                                    </div>
                                  </div>

                                  {/* TAXAS PERSONALIZADAS */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                      <Percent className="w-4 h-4 text-gray-400" />
                                      TAXAS PERSONALIZADAS
                                    </h3>
                                    <div className="space-y-2">
                                      {(selectedSeller.customPixFixedFee !== undefined || selectedSeller.customPixPercentFee !== undefined ||
                                        selectedSeller.customCardFixedFee !== undefined || selectedSeller.customCardPercentFee !== undefined ||
                                        selectedSeller.customStripeFixedFee !== undefined || selectedSeller.customStripePercentFee !== undefined) ? (
                                        <>
                                          {(selectedSeller.customPixFixedFee !== undefined || selectedSeller.customPixPercentFee !== undefined) && (
                                            <div className="p-2 bg-gray-700 rounded border border-gray-600">
                                              <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">PIX EfiBank:</span>
                                                <span className="text-sm font-medium">
                                                  {selectedSeller.customPixFixedFee !== undefined && `R$ ${selectedSeller.customPixFixedFee.toFixed(2)}`}
                                                  {selectedSeller.customPixFixedFee !== undefined && selectedSeller.customPixPercentFee !== undefined && ' + '}
                                                  {selectedSeller.customPixPercentFee !== undefined && `${selectedSeller.customPixPercentFee}%`}
                                                </span>
                                              </div>
                                            </div>
                                          )}
                                          {(selectedSeller.customCardFixedFee !== undefined || selectedSeller.customCardPercentFee !== undefined) && (
                                            <div className="p-2 bg-gray-700 rounded border border-gray-600">
                                              <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">Cartão EfiBank:</span>
                                                <span className="text-sm font-medium">
                                                  {selectedSeller.customCardFixedFee !== undefined && `R$ ${selectedSeller.customCardFixedFee.toFixed(2)}`}
                                                  {selectedSeller.customCardFixedFee !== undefined && selectedSeller.customCardPercentFee !== undefined && ' + '}
                                                  {selectedSeller.customCardPercentFee !== undefined && `${selectedSeller.customCardPercentFee}%`}
                                                </span>
                                              </div>
                                            </div>
                                          )}
                                          {(selectedSeller.customStripeFixedFee !== undefined || selectedSeller.customStripePercentFee !== undefined) && (
                                            <div className="p-2 bg-gray-700 rounded border border-gray-600">
                                              <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">Stripe Global:</span>
                                                <span className="text-sm font-medium">
                                                  {selectedSeller.customStripeFixedFee !== undefined && `R$ ${selectedSeller.customStripeFixedFee.toFixed(2)}`}
                                                  {selectedSeller.customStripeFixedFee !== undefined && selectedSeller.customStripePercentFee !== undefined && ' + '}
                                                  {selectedSeller.customStripePercentFee !== undefined && `${selectedSeller.customStripePercentFee}%`}
                                                </span>
                                              </div>
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <Badge variant="outline">Usando taxas globais padrão</Badge>
                                      )}
                                    </div>
                                  </div>

                                  {/* DADOS PESSOAIS ADICIONAIS */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-blue-300 mb-3 flex items-center gap-2">
                                      <User className="w-4 h-4 text-blue-400" />
                                      DADOS PESSOAIS
                                    </h3>
                                    <div className="space-y-3">
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Data de Nascimento</Label>
                                        <p className="mt-1 font-medium">{selectedSeller.birthDate || 'No informado'}</p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Tipo de Documento</Label>
                                        <p className="mt-1 font-medium uppercase">{selectedSeller.personalDocumentType || 'No informado'}</p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Nmero do Documento</Label>
                                        <p className="mt-1 font-medium">{selectedSeller.personalDocumentNumber || 'No informado'}</p>
                                      </div>
                                      <div>
                                        <Label className="text-xs font-medium text-muted-foreground">Termos Aceitos</Label>
                                        <div className="mt-1">
                                          <Badge variant={selectedSeller.acceptedTerms ? "default" : "destructive"}>
                                            {selectedSeller.acceptedTerms ? 'Sim' : 'No'}
                                          </Badge>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* DADOS TCNICOS COMPLETOS */}
                                  <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                      <Monitor className="w-4 h-4 text-emerald-400" />
                                      DADOS TCNICOS - RASTREAMENTO COMPLETO
                                    </h3>
                                    <div className="space-y-4">
                                      {/* REDE - IPS SEPARADOS */}
                                      <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
                                        <h4 className="text-xs font-bold text-emerald-400 mb-2">REDE E LOCALIZAÇÃO</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                          {/* IP DE CADASTRO (ORIGINAL) */}
                                          <div className="col-span-2 md:col-span-1">
                                            <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                              IP de Cadastroo (Original)
                                            </Label>
                                            <p className="mt-1 font-mono text-sm font-bold text-emerald-400">
                                              {(selectedSeller as any).registrationIP || 'N/A'}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                              IP usado quando criou a conta
                                            </p>
                                          </div>

                                          {/* LTIMO IP (MAIS RECENTE) */}
                                          <div className="col-span-2 md:col-span-1">
                                            <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                              Último IP (Mais Recente)
                                            </Label>
                                            <p className="mt-1 font-mono text-sm font-bold text-emerald-400">
                                              {(selectedSeller as any).lastLoginIP || (selectedSeller as any).registrationIP || 'N/A'}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                              IP atual - atualiza a cada login
                                            </p>
                                            {/* ALERTA SE IP MUDOU */}
                                            {(selectedSeller as any).lastLoginIP && 
                                             (selectedSeller as any).registrationIP && 
                                             (selectedSeller as any).lastLoginIP !== (selectedSeller as any).registrationIP && (
                                              <Badge variant="outline" className="mt-1 text-xs bg-yellow-50 text-yellow-700 border-yellow-300">
                                                IP Diferente do Cadastroo
                                              </Badge>
                                            )}
                                          </div>

                                          {/* VPS/PROXY DETECTION */}
                                          {((selectedSeller as any).deviceFingerprint?.isVPN || 
                                            (selectedSeller as any).deviceFingerprint?.isProxy || 
                                            (selectedSeller as any).deviceFingerprint?.isTor) && (
                                            <div className="col-span-2">
                                              <div className="bg-red-900/30 border border-red-700 rounded p-2">
                                                <Label className="text-xs font-bold text-red-400 flex items-center gap-1">
                                                  ALERTA DE SEGURANÇA
                                                </Label>
                                                <div className="mt-1 space-y-1">
                                                  {(selectedSeller as any).deviceFingerprint?.isVPN && (
                                                    <Badge variant="destructive" className="text-xs mr-1">VPN Detectada</Badge>
                                                  )}
                                                  {(selectedSeller as any).deviceFingerprint?.isProxy && (
                                                    <Badge variant="destructive" className="text-xs mr-1">Proxy Detectado</Badge>
                                                  )}
                                                  {(selectedSeller as any).deviceFingerprint?.isTor && (
                                                    <Badge variant="destructive" className="text-xs mr-1">Tor Detectado</Badge>
                                                  )}
                                                </div>
                                                <p className="text-xs text-red-600 mt-1">
                                                  Este seller estusando VPS/Proxy/Tor - Alto risco de fraude
                                                </p>
                                              </div>
                                            </div>
                                          )}

                                          {/* IP LOCAL */}
                                          {(selectedSeller as any).deviceFingerprint?.localIP && (
                                            <div>
                                              <Label className="text-xs font-medium text-muted-foreground">IP Local (WebRTC)</Label>
                                              <p className="mt-1 font-mono text-sm">{(selectedSeller as any).deviceFingerprint.localIP}</p>
                                            </div>
                                          )}

                                          {/* ISP */}
                                          {(selectedSeller as any).deviceFingerprint?.isp && (
                                            <div>
                                              <Label className="text-xs font-medium text-muted-foreground">Provedor (ISP)</Label>
                                              <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.isp}</p>
                                            </div>
                                          )}

                                          {/* LOCALIZAÇÃO */}
                                          {(selectedSeller as any).deviceFingerprint?.city && (
                                            <div className="col-span-2">
                                              <Label className="text-xs font-medium text-muted-foreground">Localização Geogrfica</Label>
                                              <p className="mt-1 font-medium text-sm">
                                                {(selectedSeller as any).deviceFingerprint.city}, {(selectedSeller as any).deviceFingerprint.region} - {(selectedSeller as any).deviceFingerprint.country}
                                              </p>
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* SISTEMA */}
                                      {(selectedSeller as any).deviceFingerprint && (
                                        <>
                                          <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
                                            <h4 className="text-xs font-bold text-blue-400 mb-2">SISTEMA OPERACIONAL</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">OS</Label>
                                                <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.os}</p>
                                              </div>
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Plataforma</Label>
                                                <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.platform}</p>
                                              </div>
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Navegador</Label>
                                                <p className="mt-1 font-medium text-sm">
                                                  {(selectedSeller as any).deviceFingerprint.browser} {(selectedSeller as any).deviceFingerprint.browserVersion}
                                                </p>
                                              </div>
                                              {(selectedSeller as any).deviceFingerprint.architecture && (
                                                <div>
                                                  <Label className="text-xs font-medium text-muted-foreground">Arquitetura</Label>
                                                  <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.architecture}</p>
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {/* HARDWARE */}
                                          <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
                                            <h4 className="text-xs font-bold text-emerald-400 mb-2"> HARDWARE</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">CPU</Label>
                                                <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.cpuCores} ncleos</p>
                                              </div>
                                              {(selectedSeller as any).deviceFingerprint.deviceMemory && (
                                                <div>
                                                  <Label className="text-xs font-medium text-muted-foreground">RAM</Label>
                                                  <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.deviceMemory} GB</p>
                                                </div>
                                              )}
                                              {(selectedSeller as any).deviceFingerprint.gpu && (
                                                <div className="col-span-2">
                                                  <Label className="text-xs font-medium text-muted-foreground">Placa de Vdeo</Label>
                                                  <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.gpu}</p>
                                                  {(selectedSeller as any).deviceFingerprint.gpuVendor && (
                                                    <p className="text-xs text-muted-foreground">Fabricante: {(selectedSeller as any).deviceFingerprint.gpuVendor}</p>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {/* TELA */}
                                          <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
                                            <h4 className="text-xs font-bold text-orange-400 mb-2">TELA E DISPLAY</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Resoluo</Label>
                                                <p className="mt-1 font-mono text-sm">{(selectedSeller as any).deviceFingerprint.screenResolution}</p>
                                              </div>
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Orientao</Label>
                                                <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.orientation || 'N/A'}</p>
                                              </div>
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Profundidade de Cor</Label>
                                                <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.colorDepth}-bit</p>
                                              </div>
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Touch Screen</Label>
                                                <Badge variant={( selectedSeller as any).deviceFingerprint.touchScreen ? "default" : "outline"}>
                                                  {(selectedSeller as any).deviceFingerprint.touchScreen ? 'Sim' : 'No'}
                                                </Badge>
                                              </div>
                                            </div>
                                          </div>

                                          {/* CONEXÃO */}
                                          {(selectedSeller as any).deviceFingerprint.connectionType && (
                                            <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
                                              <h4 className="text-xs font-bold text-cyan-400 mb-2"> CONEXÃO</h4>
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                <div>
                                                  <Label className="text-xs font-medium text-muted-foreground">Tipo</Label>
                                                  <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.connectionEffectiveType}</p>
                                                </div>
                                                {(selectedSeller as any).deviceFingerprint.connectionDownlink && (
                                                  <div>
                                                    <Label className="text-xs font-medium text-muted-foreground">Velocidade</Label>
                                                    <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.connectionDownlink} Mbps</p>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          )}

                                          {/* SEGURANÇA */}
                                          <div className="bg-gray-700/50 p-3 rounded border border-red-800/50">
                                            <h4 className="text-xs font-bold text-red-400 mb-2">SEGURANÇA E PRIVACIDADE</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              {(selectedSeller as any).deviceFingerprint.canvas && (
                                                <div className="col-span-2">
                                                  <Label className="text-xs font-medium text-muted-foreground">Canvas Fingerprint (ID nico)</Label>
                                                  <p className="mt-1 font-mono text-xs break-all">{(selectedSeller as any).deviceFingerprint.canvas}</p>
                                                </div>
                                              )}
                                              {(selectedSeller as any).deviceFingerprint.sessionId && (
                                                <div>
                                                  <Label className="text-xs font-medium text-muted-foreground">Session ID</Label>
                                                  <p className="mt-1 font-mono text-xs">{(selectedSeller as any).deviceFingerprint.sessionId}</p>
                                                </div>
                                              )}
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Do Not Track</Label>
                                                <Badge variant={(selectedSeller as any).deviceFingerprint.doNotTrack ? "default" : "outline"}>
                                                  {(selectedSeller as any).deviceFingerprint.doNotTrack ? 'Ativo' : 'Inativo'}
                                                </Badge>
                                              </div>
                                            </div>
                                          </div>

                                          {/* OUTROS */}
                                          <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
                                            <h4 className="text-xs font-bold text-white mb-2">OUTROS DADOS</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Fusão Horrio</Label>
                                                <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.timezone}</p>
                                              </div>
                                              <div>
                                                <Label className="text-xs font-medium text-muted-foreground">Idioma</Label>
                                                <p className="mt-1 font-medium text-sm">{(selectedSeller as any).deviceFingerprint.language}</p>
                                              </div>
                                              {(selectedSeller as any).deviceFingerprint.languages && (
                                                <div className="col-span-2">
                                                  <Label className="text-xs font-medium text-muted-foreground">Idiomas do Browser</Label>
                                                  <p className="mt-1 text-xs">{(selectedSeller as any).deviceFingerprint.languages.join(', ')}</p>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {/* BLOQUEIO (se aplicvel) */}
                                  {selectedSeller.isBlocked && (
                                    <div className="bg-red-900/20 p-4 rounded-lg border border-red-700">
                                      <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                                        <Ban className="w-4 h-4" />
                                        SELLER BLOQUEADO
                                      </h3>
                                      <div className="space-y-2">
                                        <div>
                                          <Label className="text-xs font-medium text-muted-foreground">Motivo do Bloqueio</Label>
                                          <p className="mt-1 text-sm bg-gray-700 p-2 rounded border border-red-800/50 text-gray-300">
                                            {selectedSeller.blockedReason}
                                          </p>
                                        </div>
                                        <div>
                                          <Label className="text-xs font-medium text-muted-foreground">Data do Bloqueio</Label>
                                          <p className="mt-1 font-medium text-muted-foreground">
                                            {selectedSeller.blockedAt ? `${selectedSeller.blockedAt.toLocaleDateString('pt-BR')} s ${selectedSeller.blockedAt.toLocaleTimeString('pt-BR')}` : 'Data não disponível'}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                </div>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>


                        {/* DEFINIR TAXAS */}
                        <Dialog onOpenChange={(open) => {
                          if (open) {
                            setEditingFees({
                              id: seller.id,
                              pixFixedFee: seller.customPixFixedFee ?? 0,
                              pixPercentFee: seller.customPixPercentFee ?? 0,
                              pixWithdrawalDays: seller.customPixWithdrawalDays ?? 0,
                              cardFixedFee: seller.customCardFixedFee ?? 0,
                              cardPercentFee: seller.customCardPercentFee ?? 0,
                              cardWithdrawalDays: seller.customCardWithdrawalDays ?? 0,
                              installment1x: seller.customInstallment1x,
                              installment2to6x: seller.customInstallment2to6x,
                              installment7to9x: seller.customInstallment7to9x,
                              installment10to12x: seller.customInstallment10to12x,
                              stripeFixedFee: seller.customStripeFixedFee ?? 0,
                              stripePercentFee: seller.customStripePercentFee ?? 0,
                              stripeWithdrawalDays: seller.customStripeWithdrawalDays ?? 0,
                              stripeInstallment1x: seller.customStripeInstallment1x,
                              stripeInstallment2to6x: seller.customStripeInstallment2to6x,
                              stripeInstallment7to9x: seller.customStripeInstallment7to9x,
                              stripeInstallment10to12x: seller.customStripeInstallment10to12x,
                            });
                          } else {
                            setEditingFees(null);
                          }
                        }}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-emerald-700 hover:bg-emerald-50">
                              <Percent className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="bg-white text-gray-900 border-gray-200 max-w-sm sm:max-w-md p-0 overflow-hidden shadow-lg">
                            <div className="flex items-center gap-2 px-5 pt-5 pb-3 border-b border-gray-100">
                              <Percent className="h-4 w-4 text-gray-400" />
                              <div className="flex-1 min-w-0">
                                <DialogTitle className="text-gray-900 text-base font-semibold">Taxas Personalizadas</DialogTitle>
                                <DialogDescription className="text-gray-500 text-xs">Taxas exclusivas para este seller</DialogDescription>
                              </div>
                            </div>
                            <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">
                              {/* PIX */}
                              <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <div className="flex items-center gap-2">
                                  <DollarSign className="w-4 h-4 text-gray-400" />
                                  <span className="text-sm font-semibold text-gray-900">PIX</span>
                                  <span className="text-[10px] text-gray-400">Brasil</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label htmlFor="pix-fixed" className="text-xs text-gray-500">Fixa (R$)</Label>
                                    <Input
                                      id="pix-fixed"
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max="50"
                                      value={editingFees?.id === seller.id ? (editingFees.pixFixedFee || '') : (seller.customPixFixedFee || '')}
                                      placeholder="2.49"
                                      className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setEditingFees(prev => prev ? { ...prev, pixFixedFee: value } : prev);
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor="pix-percent" className="text-xs text-gray-500">% Venda</Label>
                                    <Input
                                      id="pix-percent"
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max="10"
                                      value={editingFees?.id === seller.id ? (editingFees.pixPercentFee || '') : (seller.customPixPercentFee || '')}
                                      placeholder="2.0"
                                      className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setEditingFees(prev => prev ? { ...prev, pixPercentFee: value } : prev);
                                      }}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Label htmlFor="pix-withdrawal" className="text-xs text-gray-500">Prazo Saque (dias)</Label>
                                  <Input
                                    id="pix-withdrawal"
                                    type="number"
                                    min="0"
                                    max="30"
                                    value={editingFees?.id === seller.id ? (editingFees.pixWithdrawalDays || '') : (seller.customPixWithdrawalDays || '')}
                                    placeholder="D+1"
                                    className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value) || 0;
                                      setEditingFees(prev => prev ? { ...prev, pixWithdrawalDays: value } : prev);
                                    }}
                                  />
                                  <p className="text-[10px] text-gray-400 mt-1">0=Mesmo dia, 1=D+1</p>
                                </div>
                              </div>

                              {/* CARTÃO BR */}
                              <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <div className="flex items-center gap-2">
                                  <CreditCard className="w-4 h-4 text-gray-400" />
                                  <span className="text-sm font-semibold text-gray-900">Cartão BR</span>
                                  <span className="text-[10px] text-gray-400">Brasil</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label htmlFor="card-fixed" className="text-xs text-gray-500">Fixa (R$)</Label>
                                    <Input
                                      id="card-fixed"
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max="50"
                                      value={editingFees?.id === seller.id ? (editingFees.cardFixedFee || '') : (seller.customCardFixedFee || '')}
                                      placeholder="2.49"
                                      className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setEditingFees(prev => prev ? { ...prev, cardFixedFee: value } : prev);
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor="card-percent" className="text-xs text-gray-500">% Venda</Label>
                                    <Input
                                      id="card-percent"
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max="15"
                                      value={editingFees?.id === seller.id ? (editingFees.cardPercentFee || '') : (seller.customCardPercentFee || '')}
                                      placeholder="5.2"
                                      className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setEditingFees(prev => prev ? { ...prev, cardPercentFee: value } : prev);
                                      }}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Label htmlFor="card-withdrawal" className="text-xs text-gray-500">Prazo Saque (dias)</Label>
                                  <Input
                                    id="card-withdrawal"
                                    type="number"
                                    min="0"
                                    max="30"
                                    value={editingFees?.id === seller.id ? (editingFees.cardWithdrawalDays || '') : (seller.customCardWithdrawalDays || '')}
                                    placeholder="D+1"
                                    className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value) || 0;
                                      setEditingFees(prev => prev ? { ...prev, cardWithdrawalDays: value } : prev);
                                    }}
                                  />
                                  <p className="text-[10px] text-gray-400 mt-1">0=Mesmo dia, 1=D+1</p>
                                </div>
                                
                                {/* TAXAS PARCELADAS */}
                                <div className="space-y-2 pt-2 border-t border-gray-200">
                                  <span className="text-xs text-gray-500">Parcelado (%)</span>
                                  <div className="grid grid-cols-4 gap-1">
                                    <div>
                                      <Label htmlFor="install-1x" className="text-[10px] text-gray-500">1x</Label>
                                      <Input
                                        id="install-1x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.installment1x ?? '') : (seller.customInstallment1x ?? '')}
                                        placeholder="3.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, installment1x: value } : prev);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="install-2to6x" className="text-[10px] text-gray-500">2-6x</Label>
                                      <Input
                                        id="install-2to6x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.installment2to6x ?? '') : (seller.customInstallment2to6x ?? '')}
                                        placeholder="4.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, installment2to6x: value } : prev);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="install-7to9x" className="text-[10px] text-gray-500">7-9x</Label>
                                      <Input
                                        id="install-7to9x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.installment7to9x ?? '') : (seller.customInstallment7to9x ?? '')}
                                        placeholder="5.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, installment7to9x: value } : prev);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="install-10to12x" className="text-[10px] text-gray-500">10-12x</Label>
                                      <Input
                                        id="install-10to12x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.installment10to12x ?? '') : (seller.customInstallment10to12x ?? '')}
                                        placeholder="6.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, installment10to12x: value } : prev);
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* STRIPE GLOBAL */}
                              <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <div className="flex items-center gap-2">
                                  <Globe className="w-4 h-4 text-gray-400" />
                                  <span className="text-sm font-semibold text-gray-900">Stripe</span>
                                  <span className="text-[10px] text-gray-400">Internacional</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label htmlFor="stripe-fixed" className="text-xs text-gray-500">Fixa (R$)</Label>
                                    <Input
                                      id="stripe-fixed"
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max="50"
                                      value={editingFees?.id === seller.id ? (editingFees.stripeFixedFee || '') : (seller.customStripeFixedFee || '')}
                                      placeholder="0.50"
                                      className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setEditingFees(prev => prev ? { ...prev, stripeFixedFee: value } : prev);
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor="stripe-percent" className="text-xs text-gray-500">% Venda</Label>
                                    <Input
                                      id="stripe-percent"
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max="10"
                                      value={editingFees?.id === seller.id ? (editingFees.stripePercentFee || '') : (seller.customStripePercentFee || '')}
                                      placeholder="3.0"
                                      className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setEditingFees(prev => prev ? { ...prev, stripePercentFee: value } : prev);
                                      }}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Label htmlFor="stripe-withdrawal" className="text-xs text-gray-500">Prazo Saque (dias)</Label>
                                  <Input
                                    id="stripe-withdrawal"
                                    type="number"
                                    min="0"
                                    max="30"
                                    value={editingFees?.id === seller.id ? (editingFees.stripeWithdrawalDays || '') : (seller.customStripeWithdrawalDays || '')}
                                    placeholder="D+2"
                                    className="mt-1 bg-white border-gray-200 text-gray-900 h-8 text-xs"
                                    onChange={(e) => {
                                      const value = parseInt(e.target.value) || 0;
                                      setEditingFees(prev => prev ? { ...prev, stripeWithdrawalDays: value } : prev);
                                    }}
                                  />
                                  <p className="text-[10px] text-gray-400 mt-1">0=Mesmo dia, 2=D+2</p>
                                </div>
                                
                                {/* TAXAS PARCELADAS STRIPE */}
                                <div className="space-y-2 pt-2 border-t border-gray-200">
                                  <span className="text-xs text-gray-500">Parcelado (%)</span>
                                  <div className="grid grid-cols-4 gap-1">
                                    <div>
                                      <Label htmlFor="stripe-install-1x" className="text-[10px] text-gray-500">1x</Label>
                                      <Input
                                        id="stripe-install-1x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.stripeInstallment1x ?? '') : (seller.customStripeInstallment1x ?? '')}
                                        placeholder="3.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, stripeInstallment1x: value } : prev);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="stripe-install-2to6x" className="text-[10px] text-gray-500">2-6x</Label>
                                      <Input
                                        id="stripe-install-2to6x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.stripeInstallment2to6x ?? '') : (seller.customStripeInstallment2to6x ?? '')}
                                        placeholder="4.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, stripeInstallment2to6x: value } : prev);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="stripe-install-7to9x" className="text-[10px] text-gray-500">7-9x</Label>
                                      <Input
                                        id="stripe-install-7to9x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.stripeInstallment7to9x ?? '') : (seller.customStripeInstallment7to9x ?? '')}
                                        placeholder="5.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, stripeInstallment7to9x: value } : prev);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="stripe-install-10to12x" className="text-[10px] text-gray-500">10-12x</Label>
                                      <Input
                                        id="stripe-install-10to12x"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="20"
                                        value={editingFees?.id === seller.id ? (editingFees.stripeInstallment10to12x ?? '') : (seller.customStripeInstallment10to12x ?? '')}
                                        placeholder="6.99"
                                        className="mt-1 bg-white border-gray-200 text-gray-900 h-7 text-xs"
                                        onChange={(e) => {
                                          const value = parseFloat(e.target.value) || 0;
                                          setEditingFees(prev => prev ? { ...prev, stripeInstallment10to12x: value } : prev);
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>

                            </div>
                            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                              <Button 
                                size="sm"
                                className="w-full bg-gray-900 hover:bg-gray-800 text-white text-xs" 
                                onClick={() => {
                                  const fees = editingFees?.id === seller.id ? editingFees : null;
                                  if (!fees) return;
                                  handleSaveFees(fees.id, {
                                    ...fees,
                                    installment1x: fees.installment1x ?? 5.2,
                                    installment2to6x: fees.installment2to6x ?? 6.2,
                                    installment7to9x: fees.installment7to9x ?? 8.2,
                                    installment10to12x: fees.installment10to12x ?? 9.2,
                                    stripeInstallment1x: fees.stripeInstallment1x ?? 5.2,
                                    stripeInstallment2to6x: fees.stripeInstallment2to6x ?? 6.2,
                                    stripeInstallment7to9x: fees.stripeInstallment7to9x ?? 7.2,
                                    stripeInstallment10to12x: fees.stripeInstallment10to12x ?? 8.2,
                                  });
                                }}
                              >
                                Salvar Taxas
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>

                        {/* BLOQUEAR/DESBLOQUEAR */}
                        {seller.isBlocked ? (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleUnblockSeller(seller.id)}
                            className="text-emerald-700 hover:text-emerald-700"
                          >
                            <UnlockKeyhole className="w-4 h-4" />
                          </Button>
                        ) : (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-emerald-700">
                                <Ban className="w-4 h-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Bloquear Seller</DialogTitle>
                                <DialogDescription>
                                  Contate via WhatsApp: (11) 97229-3612
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div>
                                  <Label htmlFor="block-reason">Motivo do bloqueio</Label>
                                  <Input
                                    id="block-reason"
                                    value={blockingReason}
                                    onChange={(e) => setBlockingReason(e.target.value)}
                                    placeholder="Descreva o motivo..."
                                  />
                                </div>
                                <Button 
                                  variant="destructive" 
                                  className="w-full"
                                  onClick={() => handleBlockSeller(seller.id, blockingReason)}
                                  disabled={!blockingReason.trim()}
                                >
                                  Bloquear Seller
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* PAGINAÇÃO */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Mostrando {startIndex + 1} a {Math.min(startIndex + sellersPerPage, filteredSellers.length)} de {filteredSellers.length} sellers
            </p>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="w-4 h-4" />
                Anterior
              </Button>
              <div className="flex items-center space-x-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <Button
                    key={page}
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className="w-8"
                  >
                    {page}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Próximo
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
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