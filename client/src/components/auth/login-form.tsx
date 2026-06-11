import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { signIn, resetPassword, signOut } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth";
import { clearUserTypeCache } from "@/lib/firestore";
import { LogoThemed } from "@/components/ui/logo-themed";

const loginSchema = z.object({
  email: z.string().email("Por favor, insira um email vlido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  compact?: boolean;
  onClose?: () => void;
}

export function LoginForm({ compact = false, onClose }: LoginFormProps = {}) {
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setUser } = useAuthStore();
  
  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const user = await signIn(data);
      
      console.log('Login realizado:', user.uid);
      
      toast({
        title: "Bem-vindo de volta!",
        description: "Vocfez login com sucesso.",
      });
      
      onClose?.();
      
      clearUserTypeCache();
      
      console.log('Login concluído - redirecionando...');
      setLocation('/auth/route');

      user.getIdToken().then(token => {
        fetch('/api/auth/check-blocked', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ deviceFingerprint: null })
        }).then(async (response) => {
          if (response.ok) {
            try {
              const blockData = await response.json();
              if (blockData && blockData.blocked === true) {
                await signOut().catch(() => {});
                toast({
                  title: "Conta Bloqueada",
                  description: "Seu IP ou conta foi bloqueado. Entre em contato com o suporte caso acredite que foi um erro!",
                  variant: "destructive",
                  duration: 10000,
                });
                window.location.href = '/';
              }
            } catch {}
          }
        }).catch(() => {});
      }).catch(() => {});
      
    } catch (error: any) {
      console.log('Erro de login capturado:', error.message);
      
      // Mensagens de erro amigáveis baseadas no tipo de erro
      let errorTitle = "Erro ao entrar";
      let errorMessage = "Tente novamente em alguns segundos.";
      
      const msg = error.message?.toLowerCase() || "";
      
      if (msg.includes('senha') || msg.includes('password') || msg.includes('incorret') || msg.includes('wrong')) {
        errorTitle = "Senha incorreta";
        errorMessage = "A senha informada está incorreta. Verifique e tente novamente.";
      } else if (msg.includes('email') && (msg.includes('incorret') || msg.includes('invalid'))) {
        errorTitle = "Email inválido";
        errorMessage = "O email informado não é válido. Verifique e tente novamente.";
      } else if (msg.includes('não encontrad') || msg.includes('not found') || msg.includes('user-not-found')) {
        errorTitle = "Conta não encontrada";
        errorMessage = "Não existe uma conta com este email. Verifique ou crie uma nova conta.";
      } else if (msg.includes('muitas tentativas') || msg.includes('too-many') || msg.includes('rate limit')) {
        errorTitle = "Muitas tentativas";
        errorMessage = "Você fez muitas tentativas. Aguarde alguns minutos e tente novamente.";
      } else if (msg.includes('bloqueado') || msg.includes('blocked')) {
        errorTitle = "Conta bloqueada";
        errorMessage = "Sua conta foi bloqueada. Entre em contato com o suporte.";
      } else if (msg.includes('rede') || msg.includes('network') || msg.includes('conexão')) {
        errorTitle = "Erro de conexão";
        errorMessage = "Verifique sua conexão com a internet e tente novamente.";
      } else if (msg.includes('credenciais') || msg.includes('credential')) {
        errorTitle = "Dados incorretos";
        errorMessage = "Email ou senha incorretos. Verifique seus dados e tente novamente.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetEmail.trim()) {
      toast({
        title: "Email obrigatório",
        description: "Por favor, digite seu email para redefinir a senha.",
        variant: "destructive",
      });
      return;
    }

    if (!resetEmail.includes("@")) {
      toast({
        title: "Email invlido",
        description: "Por favor, digite um email vlido.",
        variant: "destructive",
      });
      return;
    }

    setResetLoading(true);
    try {
      await resetPassword(resetEmail);
      toast({
        title: "Email enviado!",
        description: `Enviamos um link de redefinio de senha para ${resetEmail}. Verifique sua caixa de entrada.`,
      });
      setShowResetPassword(false);
      setResetEmail("");
    } catch (error: any) {
      // LOG MELHORADO: Menos verboso, mais til
      console.error("Reset password error:", error.code || error.message);
      
      let errorMessage = "Erro ao enviar email de redefinio. Tente novamente.";
      
      // MELHORADO: Tratamento mais especfico de erros
      switch (error.code) {
        case "auth/user-not-found":
          errorMessage = "Este email não está cadastrado em nossa plataforma.";
          break;
        case "auth/invalid-email":
          errorMessage = "Email invlido. Verifique o formato e tente novamente.";
          break;
        case "auth/too-many-requests":
          errorMessage = "Por favor, aguarde um momento antes de tentar novamente.";
          break;
        case "auth/network-request-failed":
          errorMessage = "Erro de conexo. Verifique sua internet e tente novamente.";
          break;
        case "auth/unauthorized-continue-uri":
          errorMessage = "Erro de configuração. Tente novamente em alguns instantes.";
          break;
        case "auth/weak-password":
          errorMessage = "Senha muito fraca. Use pelo menos 6 caracteres.";
          break;
        default:
          errorMessage = `Erro ao redefinir senha: ${error.message}`;
          break;
      }
      
      toast({
        title: "Erro ao Redefinir Senha",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setResetLoading(false);
    }
  };

  if (compact) {
    return (
      <>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-gray-900 dark:text-gray-100">E-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="seu@email.com"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              data-testid="input-email"
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive" data-testid="error-email">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-gray-900 dark:text-gray-100">Senha</Label>
            <Input
              id="password"
              type="password"
              placeholder="Digite sua senha"
              autoComplete="new-password"
              data-testid="input-password"
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              {...form.register("password")}
            />
            {form.formState.errors.password && (
              <p className="text-sm text-destructive" data-testid="error-password">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>
          <div className="space-y-3">
            <Button 
              type="submit" 
              className="w-full" 
              disabled={loading}
              data-testid="button-sign-in"
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
            
            <Button
              type="button"
              variant="link"
              className="w-full p-0 h-auto text-sm"
              onClick={() => setShowResetPassword(true)}
              data-testid="button-forgot-password"
            >
              Esqueci minha senha
            </Button>
          </div>
        </form>
        
        {/* Modal de Redefinir Senha */}
        <Dialog open={showResetPassword} onOpenChange={setShowResetPassword}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Redefinir Senha</DialogTitle>
              <DialogDescription>
                Digite seu email para receber um link de redefinio de senha
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="seu@email.com"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  data-testid="input-reset-email"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowResetPassword(false);
                    setResetEmail("");
                  }}
                  disabled={resetLoading}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleResetPassword}
                  disabled={resetLoading}
                  data-testid="button-send-reset"
                >
                  {resetLoading ? "Enviando..." : "Enviar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Card className="w-full max-w-md bg-white dark:bg-transparent text-black dark:text-white border-gray-200 dark:border-gray-800">
      <CardHeader>
        <CardTitle data-testid="text-login-title" className="text-center text-black dark:text-white">
          <LogoThemed 
            type="site" 
            variant="dark"
            className="h-8 mx-auto"
            data-testid="logo-login"
          />
        </CardTitle>
        <CardDescription className="text-gray-600 dark:text-gray-400">
          Digite suas credenciais para acessar seu painel
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-gray-900 dark:text-gray-100">E-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="seu@email.com"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              data-testid="input-email"
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive" data-testid="error-email">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-gray-900 dark:text-gray-100">Senha</Label>
            <Input
              id="password"
              type="password"
              placeholder="Digite sua senha"
              autoComplete="new-password"
              data-testid="input-password"
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              {...form.register("password")}
            />
            {form.formState.errors.password && (
              <p className="text-sm text-destructive" data-testid="error-password">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button 
            type="submit" 
            className="w-full" 
            disabled={loading}
            data-testid="button-sign-in"
          >
            {loading ? "Entrando..." : "Entrar"}
          </Button>
          
          <Button
            type="button"
            variant="link"
            className="p-0 h-auto text-sm"
            onClick={() => setShowResetPassword(true)}
            data-testid="button-forgot-password"
          >
            Esqueci minha senha
          </Button>
          
        </CardFooter>
      </form>
      
      {/* Modal de Redefinir Senha */}
      <Dialog open={showResetPassword} onOpenChange={setShowResetPassword}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-transparent text-black dark:text-white border-gray-200 dark:border-gray-800">
          <DialogHeader>
            <DialogTitle className="text-black dark:text-white">Redefinir Senha</DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              Digite seu email para receber um link de redefinio de senha
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email" className="text-gray-900 dark:text-gray-100">Email</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="seu@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                data-testid="input-reset-email"
                className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowResetPassword(false);
                  setResetEmail("");
                }}
                disabled={resetLoading}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={handleResetPassword}
                disabled={resetLoading}
                data-testid="button-send-reset"
              >
                {resetLoading ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
