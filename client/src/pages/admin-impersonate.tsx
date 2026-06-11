import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertTriangle, Loader2, UserCheck, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

export default function AdminImpersonate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { setUser } = useAuthStore();
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string>('');
  const [sellerInfo, setSellerInfo] = useState<any>(null);

  useEffect(() => {
    // Extrair token da URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
      setStatus('error');
      setError('Token de impersonation no fornecido na URL');
      return;
    }

    // Fazer login com o token
    handleImpersonateLogin(token);
  }, []);

  const handleImpersonateLogin = async (token: string) => {
    try {
      console.log('Fazendo login com token de impersonation...');
      
      const response = await fetch('/api/admin/impersonate-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Login de impersonation autorizado:', data);

        // Desconto: LGICA ROBUSTA DE IMPERSONATION: Determinar UID correto para sellers
        console.log('DADOS SELLER RECEBIDOS:', {
          actualUserId: data.seller.actualUserId,
          uid: data.seller.uid,
          id: data.seller.id,
          email: data.seller.email
        });

        // Prioridade: actualUserId (Firebase Auth) > uid (fallback) > id (ID do banco)
        let correctUid = null;
        let uidSource = '';

        if (data.seller.actualUserId && data.seller.actualUserId.trim() !== '') {
          correctUid = data.seller.actualUserId;
          uidSource = 'actualUserId (Firebase Auth)';
        } else if (data.seller.uid && data.seller.uid.trim() !== '') {
          correctUid = data.seller.uid;
          uidSource = 'uid (fallback)';
        } else if (data.seller.id && data.seller.id.trim() !== '') {
          correctUid = data.seller.id;
          uidSource = 'id (database ID)';
        }

        // Validação crítica: UID deve existir
        if (!correctUid) {
          console.error('ERRO CRÍTICO: Nenhum UID válido encontrado para seller:', data.seller.email);
          setStatus('error');
          setError('Erro interno: Seller não possui identificador válido para autenticação');
          toast({
            title: "Erro de Autenticação",
            description: "Seller não possui identificador válido",
            variant: "destructive",
          });
          return;
        }

        console.log('IMPERSONATION - UID selecionado:', correctUid, 'fonte:', uidSource, 'seller:', data.seller.email);
        
        // Validar e normalizar displayName
        const displayName = data.seller.displayName || data.seller.businessName || data.seller.email.split('@')[0] || 'Usuário';
        
        // Atualizar estado de auth com dados do seller
        setUser({
          uid: correctUid,
          email: data.seller.email,
          displayName: displayName,
          photoURL: null
        });

        // Armazenar informações adicionais sobre o UID usado
        const enhancedSellerInfo = {
          ...data.seller,
          _impersonationInfo: {
            uidUsed: correctUid,
            uidSource: uidSource,
            timestamp: new Date().toISOString()
          }
        };

        setSellerInfo(enhancedSellerInfo);
        setStatus('success');

        toast({
          title: "Acesso Autorizado!",
          description: `Vocagora estacessando a conta de ${data.seller.email}`,
          variant: "default",
        });

        // OTIMIZAÇÃO: Redirecionamento imediato para melhor UX
        setTimeout(() => {
          setLocation('/dashboard');
        }, 500);

      } else {
        const error = await response.json();
        setStatus('error');
        setError(error.message || 'Erro ao fazer login com token');
        
        toast({
          title: "Erro no Acesso",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Erro no login de impersonation:", error);
      setStatus('error');
      setError('Erro de conexo com o servidor');
      
      toast({
        title: "Erro de Conexo",
        description: "No foi possvel conectar com o servidor",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <UserCheck className="w-6 h-6 text-emerald-700" />
            Admin Impersonation
          </CardTitle>
          <CardDescription>
            Processando acesso administrativo conta do seller
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {status === 'loading' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-700" />
              </div>
              <p className="text-gray-600">Verificando token de acesso...</p>
            </div>
          )}

          {status === 'success' && sellerInfo && (
            <div className="space-y-4">
              <Alert className="border-emerald-200 bg-emerald-50">
                <CheckCircle className="w-4 h-4 text-emerald-700" />
                <AlertDescription className="text-muted-foreground">
                  <strong>Acesso autorizado com sucesso!</strong><br />
                  Vocestacessando a conta de: <strong>{sellerInfo.email}</strong>
                </AlertDescription>
              </Alert>

              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium text-gray-800 mb-2">Informações da Conta:</h4>
                <div className="space-y-1 text-sm text-gray-600">
                  <p><strong>Email:</strong> {sellerInfo.email}</p>
                  <p><strong>Empresa:</strong> {sellerInfo.businessName || 'No informado'}</p>
                  <p><strong>Status:</strong> {sellerInfo.status}</p>
                  <p><strong>ID:</strong> {sellerInfo.id}</p>
                  {sellerInfo._impersonationInfo && (
                    <div className="mt-3 pt-3 border-t border-gray-300">
                      <p className="text-xs text-gray-500 font-medium mb-1">Informações de Impersonation:</p>
                      <p className="text-xs text-gray-500">
                        <strong>UID Autenticação:</strong> {sellerInfo._impersonationInfo.uidUsed}
                      </p>
                      <p className="text-xs text-gray-500">
                        <strong>Fonte:</strong> {sellerInfo._impersonationInfo.uidSource}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-center">
                <p className="text-sm text-gray-600 mb-3">
                  Redirecionando para o dashboard...
                </p>
                <Button onClick={() => setLocation('/dashboard')} className="w-full">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Ir para Dashboard Agora
                </Button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  <strong>Erro no acesso:</strong><br />
                  {error}
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Button 
                  variant="outline" 
                  onClick={() => window.close()} 
                  className="w-full"
                >
                  Fechar Esta Guia
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setLocation('/admin/sellers')}
                  className="w-full"
                >
                  Voltar para Admin
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}