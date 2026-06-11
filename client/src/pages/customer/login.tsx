import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Mail, ShoppingBag, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import { auth } from "@/lib/firebase";
import { sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";

export default function CustomerLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Verificar se está retornando de um magic link
  useEffect(() => {
    const checkMagicLink = async () => {
      if (isSignInWithEmailLink(auth, window.location.href)) {
        setVerifying(true);
        let emailForSignIn = window.localStorage.getItem('emailForSignIn');
        
        if (!emailForSignIn) {
          emailForSignIn = window.prompt('Por favor, confirme seu email para continuar:');
        }

        if (emailForSignIn) {
          try {
            await signInWithEmailLink(auth, emailForSignIn, window.location.href);
            window.localStorage.removeItem('emailForSignIn');
            
            toast({
              title: "Login realizado com sucesso!",
              description: "Bem-vindo à sua área de cliente.",
            });
            
            setLocation('/customer-area');
          } catch (error: any) {
            console.error('Erro ao fazer login:', error);
            
            let errorTitle = "Erro ao acessar";
            let errorMessage = "Não foi possível verificar seu acesso. Tente novamente.";
            
            const msg = error.message?.toLowerCase() || "";
            const code = error.code?.toLowerCase() || "";
            
            if (code.includes('expired') || msg.includes('expirad')) {
              errorTitle = "Link expirado";
              errorMessage = "Este link de acesso expirou. Solicite um novo link.";
            } else if (code.includes('invalid') || msg.includes('inválid')) {
              errorTitle = "Link inválido";
              errorMessage = "Este link de acesso não é válido. Solicite um novo link.";
            } else if (msg.includes('email') && msg.includes('diferente')) {
              errorTitle = "Email diferente";
              errorMessage = "O email informado é diferente do usado para criar o link.";
            }
            
            toast({
              variant: "destructive",
              title: errorTitle,
              description: errorMessage,
            });
            setVerifying(false);
          }
        } else {
          setVerifying(false);
        }
      }
    };

    checkMagicLink();
  }, []);

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast({
        variant: "destructive",
        title: "Email obrigatório",
        description: "Digite seu email de compra para continuar",
      });
      return;
    }

    setLoading(true);

    try {
      const actionCodeSettings = {
        url: window.location.origin + '/customer-login',
        handleCodeInApp: true,
      };

      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', email);

      setLinkSent(true);
      toast({
        title: "Link de acesso enviado!",
        description: `Verifique sua caixa de entrada em ${email}`,
      });

    } catch (error: any) {
      console.error('Erro ao enviar link:', error);
      
      let errorMessage = "Não foi possível enviar o link de acesso.";
      if (error.code === 'auth/invalid-email') {
        errorMessage = "Email inválido. Verifique e tente novamente.";
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
      }
      
      toast({
        variant: "destructive",
        title: "Erro ao enviar link",
        description: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  // Tela de verificação do magic link
  if (verifying) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto" />
            <h3 className="text-lg font-semibold">Verificando seu acesso...</h3>
            <p className="text-sm text-muted-foreground">
              Aguarde enquanto validamos seu link de acesso
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4">
      {/* Botão Voltar */}
      <div className="w-full max-w-md mb-4">
        <Button
          variant="ghost"
          onClick={() => setLocation('/')}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
      </div>

      {/* Card de Login */}
      <Card className="w-full max-w-md shadow-2xl border-2">
        <CardHeader className="text-center space-y-2 pb-4">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-2">
            {linkSent ? (
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            ) : (
              <ShoppingBag className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            {linkSent ? "Link Enviado!" : "Área do Cliente"}
          </CardTitle>
          <CardDescription className="text-base">
            {linkSent 
              ? "Verifique sua caixa de entrada e clique no link para acessar"
              : "Acesse seus produtos, área de membros e histórico de compras"}
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          {linkSent ? (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <p className="text-sm font-medium">📧 Email enviado para:</p>
                <p className="text-sm text-muted-foreground break-all">{email}</p>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  ✅ Clique no link recebido para fazer login automaticamente
                </p>
                <p className="text-xs text-muted-foreground">
                  O link é válido por 1 hora e pode ser usado apenas uma vez
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLinkSent(false)}
              >
                Enviar para outro email
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSendMagicLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email de Compra
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Use o email que você utilizou na compra
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? "Enviando link..." : "Enviar Link de Acesso"}
              </Button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-xs text-center text-muted-foreground">
              Autenticação segura via link mágico.
              <br />
              Sem senha necessária.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Informações Adicionais */}
      {!linkSent && (
        <div className="w-full max-w-md mt-6 space-y-3">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex gap-3">
                <div className="text-primary text-xl">🔐</div>
                <div className="flex-1">
                  <h4 className="font-semibold text-sm mb-1">Como funciona?</h4>
                  <p className="text-xs text-muted-foreground">
                    Digite seu email e receba um link seguro para acessar seus produtos,
                    área de membros e histórico de transações sem precisar de senha.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
