import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft,
  Lock,
  CheckCircle2,
  Calendar,
  BookOpen,
  Video,
  FileText,
  Download
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/firebase";

interface MemberAreaContent {
  welcomeMessage: string;
  sections: Array<{
    id: string;
    title: string;
    type: 'text' | 'video' | 'download' | 'link';
    content: string;
    url?: string;
  }>;
}

interface Entitlement {
  id: string;
  productId: string;
  productTitle: string;
  accessStartDate: Date;
  accessEndDate: Date | null;
  billingCycle: string;
  status: string;
}

export default function MemberAreaPage() {
  const [, params] = useRoute("/customer-area/member/:productId");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [content, setContent] = useState<MemberAreaContent | null>(null);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    loadMemberArea();
  }, [params?.productId]);

  const getAuthToken = async (): Promise<string | null> => {
    const user = auth.currentUser;
    if (!user) {
      toast({
        variant: "destructive",
        title: "Sessão expirada",
        description: "Faça login novamente",
      });
      setLocation('/customer-login');
      return null;
    }
    
    return await user.getIdToken();
  };

  const loadMemberArea = async () => {
    if (!params?.productId) return;
    
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;

      // Buscar entitlement do cliente para este produto
      const entitlementsRes = await fetch('/api/customers/me/entitlements', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!entitlementsRes.ok) throw new Error('Erro ao carregar entitlements');
      
      const entitlements = await entitlementsRes.json();
      const productEntitlement = entitlements.find((e: any) => e.productId === params.productId);
      
      if (!productEntitlement) {
        toast({
          variant: "destructive",
          title: "Acesso negado",
          description: "Você não tem acesso a esta área de membros",
        });
        setLocation('/customer-area');
        return;
      }

      setEntitlement(productEntitlement);
      setHasAccess(productEntitlement.status === 'active');

      // Buscar conteúdo da member area
      const contentRes = await fetch(`/api/customers/me/entitlements/${productEntitlement.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (contentRes.ok) {
        const data = await contentRes.json();
        setContent(data.memberAreaContent || {
          welcomeMessage: 'Bem-vindo à sua área de membros!',
          sections: []
        });
      }
    } catch (error) {
      console.error('Erro ao carregar member area:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Não foi possível carregar o conteúdo",
      });
    } finally {
      setLoading(false);
    }
  };

  const getSectionIcon = (type: string) => {
    switch (type) {
      case 'video': return <Video className="h-5 w-5" />;
      case 'download': return <Download className="h-5 w-5" />;
      case 'link': return <FileText className="h-5 w-5" />;
      default: return <BookOpen className="h-5 w-5" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white dark:from-gray-800 dark:to-gray-800 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Carregando área de membros...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasAccess || !entitlement) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-red-50 to-white dark:from-gray-800 dark:to-gray-800 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Lock className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Você não tem permissão para acessar esta área de membros
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => setLocation('/customer-area')}
              className="w-full"
              variant="outline"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar para Área do Cliente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white dark:from-gray-800 dark:to-gray-800 p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setLocation('/customer-area')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
          
          <Badge variant={entitlement.status === 'active' ? 'default' : 'secondary'}>
            {entitlement.status === 'active' ? (
              <>
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Ativo
              </>
            ) : (
              'Inativo'
            )}
          </Badge>
        </div>

        {/* Título da Área de Membros */}
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl">{entitlement.productTitle}</CardTitle>
            <CardDescription className="text-lg">
              {content?.welcomeMessage || 'Bem-vindo à sua área exclusiva de membros'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Acesso desde: {new Date(entitlement.accessStartDate).toLocaleDateString('pt-BR')}
              </div>
              {entitlement.billingCycle && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{entitlement.billingCycle}</Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Conteúdo da Área de Membros */}
        {content && content.sections && content.sections.length > 0 ? (
          <Tabs defaultValue={content.sections[0]?.id || '0'} className="space-y-4">
            <TabsList className="w-full justify-start overflow-x-auto">
              {content.sections.map((section, index) => (
                <TabsTrigger key={section.id} value={section.id} className="gap-2">
                  {getSectionIcon(section.type)}
                  {section.title || `Seção ${index + 1}`}
                </TabsTrigger>
              ))}
            </TabsList>

            {content.sections.map((section) => (
              <TabsContent key={section.id} value={section.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {getSectionIcon(section.type)}
                      {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {section.type === 'text' && (
                      <div className="prose dark:prose-invert max-w-none">
                        <p className="whitespace-pre-wrap">{section.content}</p>
                      </div>
                    )}
                    
                    {section.type === 'video' && section.url && (
                      <div className="aspect-video rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                        <iframe
                          src={section.url}
                          className="w-full h-full"
                          allow="fullscreen"
                          title={section.title}
                        />
                      </div>
                    )}
                    
                    {section.type === 'download' && section.url && (
                      <div className="flex items-center gap-4 p-4 border rounded-lg">
                        <Download className="h-8 w-8 text-violet-500" />
                        <div className="flex-1">
                          <h4 className="font-medium">{section.title}</h4>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{section.content}</p>
                        </div>
                        <Button asChild>
                          <a href={section.url} download target="_blank" rel="noopener noreferrer">
                            Baixar
                          </a>
                        </Button>
                      </div>
                    )}
                    
                    {section.type === 'link' && section.url && (
                      <div className="flex items-center gap-4 p-4 border rounded-lg">
                        <FileText className="h-8 w-8 text-blue-500" />
                        <div className="flex-1">
                          <h4 className="font-medium">{section.title}</h4>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{section.content}</p>
                        </div>
                        <Button asChild variant="outline">
                          <a href={section.url} target="_blank" rel="noopener noreferrer">
                            Acessar
                          </a>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Conteúdo em breve
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                O conteúdo desta área de membros será adicionado em breve
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
