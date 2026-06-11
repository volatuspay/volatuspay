import { useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, TrendingUp, Clock, DollarSign, Star } from "lucide-react";
import type { Checkout } from "@shared/schema";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";

// Schema simplificado - dados vm do usuário logado
type AffiliateSignupData = {
  name: string;
  email: string;
  document: string;
  phone: string;
  pixKey?: string;
};

export default function AffiliateSignup() {
  const [, params] = useRoute("/affiliate/:slug");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [justRegistered, setJustRegistered] = useState(false);
  const { user } = useAuthStore();

  const slug = params?.slug;

  const isSeller = !!user;

  const { data: checkout, isLoading: loadingCheckout } = useQuery<Checkout>({
    queryKey: ["/api/showcase/checkout", slug],
    queryFn: async () => {
      const response = await fetch(`/api/showcase/checkout/${slug}`);
      if (!response.ok) {
        throw new Error(`Produto não encontrado: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!slug,
  });

  // Verificar se usuário já é afiliado deste produto
  const { data: affiliationsData, isLoading: loadingAffiliations } = useQuery({
    queryKey: ['/api/affiliations'],
    enabled: !!user,
    staleTime: 30000,
  });

  const existingAffiliation = (affiliationsData as any)?.affiliations?.find(
    (a: any) => a.productId === (checkout as any)?.id || a.productId === (checkout as any)?.syncedProductId
  );
  const isRegistered = justRegistered || !!existingAffiliation;

  // Dados automáticos do usuário logado
  const getUserData = (): AffiliateSignupData => {
    return {
      name: user?.displayName || user?.email?.split('@')[0] || "Usuário",
      email: user?.email || "",
      document: "", // Serpreenchido posteriormente pelo usuário
      phone: "", // Serpreenchido posteriormente pelo usuário  
      pixKey: user?.email || "", // Usar email como PIX padrão
    };
  };

  // Mutation para registrar afiliado automaticamente
  const registerAffiliateMutation = useMutation({
    mutationFn: async () => {
      if (!auth?.currentUser) {
        throw new Error('Vocprecisa estar logado para se tornar um afiliado.');
      }
      
      const userData = getUserData();
      const token = await auth.currentUser.getIdToken();
      
      const response = await fetch("/api/affiliate/register", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          ...userData,
          checkoutId: checkout?.id || '',
          sellerId: (checkout as any)?.seller?.uid || checkout?.tenantId || '',
          isExistingSeller: isSeller, // Indicar que é seller existente
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erro ao se cadastrar como afiliado");
      }

      return response.json();
    },
    onSuccess: (data) => {
      setJustRegistered(true);
      queryClient.invalidateQueries({ queryKey: ['/api/affiliations'] });
      const isAutoApproved = data.affiliate?.status === 'approved' || data.affiliate?.status === 'active';
      toast({
        title: isAutoApproved ? "Cadastro aprovado automaticamente!" : "Cadastro realizado!",
        description: isAutoApproved 
          ? "Você agora é um afiliado deste produto. Comece a divulgar e ganhar comissões!"
          : "Seu cadastro foi enviado para análise. Aguarde a aprovação do vendedor.",
      });
    },
    onError: (error: Error) => {
      let errorTitle = "Erro no cadastro";
      let errorMessage = error.message || "Não foi possível completar o cadastro. Tente novamente.";
      
      const msg = error.message?.toLowerCase() || "";
      
      if (msg.includes('já') || msg.includes('already') || msg.includes('existe')) {
        errorTitle = "Já é afiliado";
        errorMessage = "Você já é afiliado deste produto.";
      } else if (msg.includes('logado') || msg.includes('logged') || msg.includes('autenticação')) {
        errorTitle = "Login necessário";
        errorMessage = "Faça login para se tornar afiliado deste produto.";
      } else if (msg.includes('produto') && msg.includes('não encontrad')) {
        errorTitle = "Produto não encontrado";
        errorMessage = "Este produto não está mais disponível para afiliação.";
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleAffiliateSignup = () => {
    if (!user) {
      toast({
        title: " Login necessário",
        description: "Vocprecisa estar logado para se tornar um afiliado.",
        variant: "destructive",
      });
      return;
    }
    registerAffiliateMutation.mutate();
  };

  if (!slug) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-muted/30 dark:to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-bold text-muted-foreground mb-2">Produto não encontrado</h2>
            <p className="text-muted-foreground mb-4">O link de afiliação estinválido ou o produto no existe.</p>
            <Button asChild>
              <Link href="/showcase">Ver produtos disponíveis</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadingCheckout || (user && loadingAffiliations)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-muted/30 dark:to-muted/30 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 dark:border-blue-500 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando informações do produto...</p>
        </div>
      </div>
    );
  }

  if (!checkout) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-muted/30 dark:to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-bold text-muted-foreground mb-2">Produto não encontrado</h2>
            <p className="text-muted-foreground mb-4">Este produto no existe ou não está disponível para afiliação.</p>
            <Button asChild>
              <Link href="/showcase">Ver produtos disponíveis</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!checkout.affiliate?.enabled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-muted/30 dark:to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-bold text-muted-foreground mb-2">Afiliao não disponível</h2>
            <p className="text-muted-foreground mb-4">Este produto não está disponível para afiliação no momento.</p>
            <Button asChild>
              <Link href="/showcase">Ver outros produtos</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isRegistered) {
    const isPending = existingAffiliation?.status === 'pending';
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Star className="w-8 h-8 text-emerald-700" />
            </div>
            <h2 className="text-2xl font-bold text-muted-foreground mb-4">
              {justRegistered ? "Parabéns! Você é um afiliado!" : "Você já é afiliado deste produto!"}
            </h2>
            <p className="text-muted-foreground mb-6">
              {isPending
                ? "Sua solicitação está aguardando aprovação do vendedor."
                : <>Você pode começar a divulgar <strong>{checkout?.title || 'este produto'}</strong> e ganhar comissões em cada venda.</>
              }
            </p>
            
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-blue-500 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-muted-foreground dark:text-emerald-100 mb-2">Seu Link de Afiliado</h3>
              <code className="bg-white dark:bg-gray-700 px-3 py-2 rounded border text-sm break-all">
                {`${window.location.origin}/checkout/${checkout?.id || 'ID'}?aff=${user?.uid || 'UID'}`}
              </code>
              <p className="text-xs text-muted-foreground dark:text-blue-300 mt-2">
                Este é seu link real usando seu UID do Firebase Auth para rastreamento preciso
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <DollarSign className="w-6 h-6 text-emerald-700 mx-auto mb-2" />
                <p className="font-semibold">{checkout.affiliate?.commissionPercent || 10}%</p>
                <p className="text-xs text-muted-foreground">Comisso</p>
              </div>
              <div className="text-center">
                <Clock className="w-6 h-6 text-emerald-700 dark:text-blue-300 mx-auto mb-2" />
                <p className="font-semibold">{checkout.affiliate?.paymentDelay || 30} dias</p>
                <p className="text-xs text-muted-foreground">Prazo liberao</p>
              </div>
              <div className="text-center">
                <TrendingUp className="w-6 h-6 text-emerald-700 mx-auto mb-2" />
                <p className="font-semibold">R$ {((checkout.affiliate?.minPayout || 5000) / 100).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Mnimo saque</p>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              <Button asChild>
                <Link href="/showcase">Ver outros produtos</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/checkout/${checkout?.id || '#'}`}>Ver produto</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-muted/30 dark:to-muted/30">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center mb-6">
          <Button variant="ghost" size="sm" asChild className="mr-4">
            <Link href="/showcase">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Torne-se um Afiliado</h1>
            <p className="text-muted-foreground">Divulgue produtos e ganhe comissões</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Informações do Produto */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="w-5 h-5 text-emerald-700" />
                {checkout?.title || 'Produto'}
              </CardTitle>
              <CardDescription>{checkout?.subtitle || ''}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Valor do produto:</span>
                <span className="text-xl font-bold text-muted-foreground">
                  R$ {((checkout?.pricing?.amount || 0) / 100).toFixed(2)}
                </span>
              </div>
              
              <Separator />
              
              <div className="space-y-3">
                <h4 className="font-semibold text-muted-foreground">Benefícios como Afiliado</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-emerald-50 rounded-lg">
                    <DollarSign className="w-6 h-6 text-emerald-700 mx-auto mb-1" />
                    <p className="font-bold text-muted-foreground">{checkout.affiliate?.commissionPercent || 10}%</p>
                    <p className="text-xs text-muted-foreground">Comisso por venda</p>
                  </div>
                  
                  <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                    <TrendingUp className="w-6 h-6 text-emerald-700 dark:text-blue-300 mx-auto mb-1" />
                    <p className="font-bold text-muted-foreground dark:text-emerald-200">
                      R$ {(((checkout?.pricing?.amount || 0) * ((checkout.affiliate?.commissionPercent || 10) / 100)) / 100).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">Ganho por venda</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="text-center p-2 bg-gray-50 rounded">
                    <Clock className="w-5 h-5 text-gray-600 mx-auto mb-1" />
                    <p className="text-sm font-medium">{checkout.affiliate?.paymentDelay || 30} dias</p>
                    <p className="text-xs text-muted-foreground">Prazo liberao</p>
                  </div>
                  
                  <div className="text-center p-2 bg-gray-50 rounded">
                    <Users className="w-5 h-5 text-gray-600 mx-auto mb-1" />
                    <p className="text-sm font-medium">R$ {((checkout.affiliate?.minPayout || 5000) / 100).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Mn. saque</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Afiliao Automática */}
          <Card>
            <CardHeader>
              <CardTitle>Tornar-se Afiliado</CardTitle>
              <CardDescription>
                {user ? 
                  `Ol${user.displayName || user.email}! Clique abaixo para se tornar um afiliado deste produto.` :
                  "Vocprecisa estar logado para se tornar um afiliado."
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {user ? (
                <div className="space-y-4">
                  <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-blue-500 rounded-lg p-4">
                    <h4 className="font-semibold text-muted-foreground dark:text-emerald-100 mb-2">Aprovados Seus dados:</h4>
                    <div className="text-sm text-muted-foreground dark:text-blue-200 space-y-1">
                      <p><strong>Nome:</strong> {user.displayName || user.email?.split('@')[0] || "Usuário"}</p>
                      <p><strong>Email:</strong> {user.email}</p>
                      <p><strong>ID do Usuário:</strong> <code className="text-xs bg-emerald-100 dark:bg-emerald-500 px-1 rounded">{user.uid}</code></p>
                      <p className="text-muted-foreground dark:text-blue-300 text-xs mt-2">
                        {isSeller ? 
                          "Desconto: Como seller, vocseraprovado automaticamente!" :
                          checkout.affiliate?.autoApprove !== false ?
                            "Sua solicitação será aceita automaticamente!" :
                            "Sua solicitação será enviada para o produtor aceitar em poucos minutos."
                        }
                      </p>
                    </div>
                  </div>

                  <Button 
                    onClick={handleAffiliateSignup}
                    className="w-full bg-emerald-500 hover:bg-emerald-500" 
                    disabled={registerAffiliateMutation.isPending}
                    data-testid="button-affiliate-signup"
                  >
                    {registerAffiliateMutation.isPending ? "Processando..." : "Quero ser Afiliado!"}
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4"></div>
                  <p className="text-muted-foreground mb-4">Vocprecisa estar logado para se tornar um afiliado.</p>
                  <Button asChild>
                    <Link href="/auth/login">Fazer Login</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}