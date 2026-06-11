import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, ArrowLeft, KeyRound, Eye, EyeOff } from "lucide-react";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useLocation } from "wouter";
import { LogoThemed } from "@/components/ui/logo-themed";
import { useGlobalConfigStore } from "@/stores/global-config";

export default function MembersAuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { config } = useGlobalConfigStore();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!loginEmail || !loginPassword) {
      toast({
        variant: "destructive",
        title: "Campos obrigatórios",
        description: "Preencha email e senha para continuar",
      });
      return;
    }

    setLoginLoading(true);

    try {
      const response = await fetch('/api/members/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Erro ao fazer login');
      }

      const userCredential = await signInWithCustomToken(auth, data.token);

      toast({
        title: "Login realizado!",
        description: "Bem-vindo de volta à área de membros.",
      });

      try {
        const token = await userCredential.user.getIdToken();
        const typeRes = await fetch(`/api/user-type/${userCredential.user.uid}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (typeRes.ok) {
          const typeData = await typeRes.json();
          if (typeData.type === 'seller' || typeData.type === 'admin') {
            setTimeout(() => setLocation('/dashboard'), 800);
            return;
          }
        }
      } catch {
        // se falhar a verificação, segue para members-dashboard
      }

      setTimeout(() => {
        setLocation('/members-dashboard');
      }, 800);

    } catch (error: any) {
      console.error('Erro no login:', error);

      let errorTitle = "Erro ao entrar";
      let errorMessage = "Não foi possível fazer login. Tente novamente.";

      const msg = error.message?.toLowerCase() || "";

      if (msg.includes('senha') || msg.includes('password') || msg.includes('incorret') || msg.includes('wrong')) {
        errorTitle = "Senha incorreta";
        errorMessage = "A senha informada está incorreta. Verifique e tente novamente.";
      } else if (msg.includes('nao encontrad') || msg.includes('não encontrad') || msg.includes('not found') || msg.includes('usuario')) {
        errorTitle = "Conta não encontrada";
        errorMessage = "Não encontramos uma conta com este email. Sua conta é criada automaticamente ao realizar uma compra.";
      } else if (msg.includes('email') && msg.includes('invalid')) {
        errorTitle = "Email inválido";
        errorMessage = "O formato do email não é válido. Verifique e tente novamente.";
      } else if (msg.includes('muitas') || msg.includes('tentativas') || msg.includes('too many')) {
        errorTitle = "Muitas tentativas";
        errorMessage = "Aguarde alguns minutos antes de tentar novamente.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        variant: "destructive",
        title: errorTitle,
        description: errorMessage,
      });
    } finally {
      setLoginLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!forgotEmail) {
      toast({
        variant: "destructive",
        title: "Email obrigatório",
        description: "Digite seu email para receber a nova senha",
      });
      return;
    }

    setForgotLoading(true);

    try {
      const response = await fetch('/api/members/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });

      if (!response.ok) {
        throw new Error('Erro ao processar recuperação de senha');
      }

      setForgotSent(true);
      toast({
        title: "Email enviado!",
        description: "Se houver uma conta com esse email, uma nova senha será enviada em instantes.",
      });
    } catch (error: any) {
      console.error('Erro ao recuperar senha:', error);
      toast({
        variant: "destructive",
        title: "Erro ao enviar email",
        description: "Não foi possível processar sua solicitação. Tente novamente.",
      });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#ffffff" }}
    >
      {/* Header com voltar */}
      <div className="p-5">
        <button
          type="button"
          onClick={() => showForgot ? setShowForgot(false) : setLocation('/')}
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: "rgba(15,23,42,0.5)" }}
          data-testid="button-back-home"
        >
          <ArrowLeft size={15} />
          {showForgot ? "Voltar ao login" : "Voltar para início"}
        </button>
      </div>

      {/* Formulário centralizado */}
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <LogoThemed
              type="site"
              variant="light"
              className="h-14 w-auto"
              fallbackText={config?.gatewayName || "VolatusPay"}
            />
          </div>

          {!showForgot ? (
            <>
              {/* Heading */}
              <div className="mb-8 text-center">
                <h2
                  className="text-3xl font-extrabold tracking-tight"
                  style={{ color: "#0f172a" }}
                >
                  Área de Membros
                </h2>
                <p className="mt-2 text-sm" style={{ color: "rgba(15,23,42,0.5)" }}>
                  Acesse seus conteúdos exclusivos
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleLogin} className="space-y-5">
                {/* Email */}
                <div className="space-y-1.5">
                  <Label
                    htmlFor="login-email"
                    className="text-sm font-medium"
                    style={{ color: "rgba(15,23,42,0.75)" }}
                  >
                    Email
                  </Label>
                  <div className="relative">
                    <Mail
                      size={16}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: "rgba(15,23,42,0.35)" }}
                    />
                    <input
                      id="login-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      autoComplete="email"
                      autoCorrect="off"
                      autoCapitalize="off"
                      required
                      data-testid="input-member-email"
                      className="w-full h-12 pl-10 pr-4 rounded-xl text-sm outline-none transition-all"
                      style={{
                        background: "rgba(0,0,0,0.04)",
                        border: "1px solid rgba(0,0,0,0.12)",
                        color: "#0f172a",
                      }}
                      onFocus={(e) => (e.currentTarget.style.border = "1px solid rgba(37,99,235,0.6)")}
                      onBlur={(e) => (e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)")}
                    />
                  </div>
                </div>

                {/* Senha */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="login-password"
                      className="text-sm font-medium"
                      style={{ color: "rgba(15,23,42,0.75)" }}
                    >
                      Senha
                    </Label>
                    <button
                      type="button"
                      onClick={() => { setForgotEmail(loginEmail); setShowForgot(true); setForgotSent(false); }}
                      className="text-xs transition-colors hover:underline"
                      style={{ color: "#2563eb" }}
                      data-testid="button-forgot-password"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <div className="relative">
                    <Lock
                      size={16}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: "rgba(15,23,42,0.35)" }}
                    />
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Senha enviada por email"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      data-testid="input-member-password"
                      className="w-full h-12 pl-10 pr-12 rounded-xl text-sm outline-none transition-all"
                      style={{
                        background: "rgba(0,0,0,0.04)",
                        border: "1px solid rgba(0,0,0,0.12)",
                        color: "#0f172a",
                      }}
                      onFocus={(e) => (e.currentTarget.style.border = "1px solid rgba(37,99,235,0.6)")}
                      onBlur={(e) => (e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5"
                      style={{ color: "rgba(15,23,42,0.4)" }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Botão Entrar */}
                <button
                  type="submit"
                  disabled={loginLoading}
                  data-testid="button-member-login"
                  className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] mt-2"
                  style={{
                    background: "#2563eb",
                    color: "#ffffff",
                    cursor: loginLoading ? "not-allowed" : "pointer",
                    boxShadow: loginLoading ? "none" : "0 4px 20px rgba(37,99,235,0.35)",
                  }}
                >
                  {loginLoading ? "Entrando..." : "Entrar"}
                </button>
              </form>

              {/* Info sobre conta automática */}
              <div
                className="mt-6 p-4 rounded-xl text-center text-xs leading-relaxed"
                style={{
                  background: "rgba(37,99,235,0.06)",
                  border: "1px solid rgba(37,99,235,0.12)",
                  color: "rgba(15,23,42,0.6)",
                }}
              >
                Sua conta é criada automaticamente ao realizar uma compra. A senha provisória é enviada para seu email.
              </div>
            </>
          ) : (
            <>
              {/* Heading recuperação */}
              <div className="mb-8 text-center">
                <div
                  className="mx-auto mb-4 h-12 w-12 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(37,99,235,0.1)" }}
                >
                  <KeyRound size={22} style={{ color: "#2563eb" }} />
                </div>
                <h2
                  className="text-3xl font-extrabold tracking-tight"
                  style={{ color: "#0f172a" }}
                >
                  Recuperar Senha
                </h2>
                <p className="mt-2 text-sm" style={{ color: "rgba(15,23,42,0.5)" }}>
                  Enviaremos uma nova senha para seu email
                </p>
              </div>

              {forgotSent ? (
                <div className="text-center space-y-5">
                  <div
                    className="mx-auto h-14 w-14 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(37,99,235,0.1)" }}
                  >
                    <Mail size={24} style={{ color: "#2563eb" }} />
                  </div>
                  <div>
                    <p className="font-semibold text-lg" style={{ color: "#0f172a" }}>Email enviado!</p>
                    <p className="text-sm mt-1" style={{ color: "rgba(15,23,42,0.55)" }}>
                      Verifique sua caixa de entrada em{" "}
                      <span style={{ color: "#2563eb" }}>{forgotEmail}</span>.
                      Se houver uma conta com este email, uma nova senha provisória será enviada em instantes.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowForgot(false)}
                    data-testid="button-back-to-login"
                    className="w-full h-12 rounded-xl font-bold text-sm transition-all duration-200 active:scale-[0.98]"
                    style={{ background: "#2563eb", color: "#ffffff", boxShadow: "0 4px 20px rgba(37,99,235,0.35)" }}
                  >
                    Voltar ao login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="forgot-email"
                      className="text-sm font-medium"
                      style={{ color: "rgba(15,23,42,0.75)" }}
                    >
                      Email da sua conta
                    </Label>
                    <div className="relative">
                      <Mail
                        size={16}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        style={{ color: "rgba(15,23,42,0.35)" }}
                      />
                      <input
                        id="forgot-email"
                        type="email"
                        placeholder="seu@email.com"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        required
                        data-testid="input-forgot-email"
                        className="w-full h-12 pl-10 pr-4 rounded-xl text-sm outline-none transition-all"
                        style={{
                          background: "rgba(0,0,0,0.04)",
                          border: "1px solid rgba(0,0,0,0.12)",
                          color: "#0f172a",
                        }}
                        onFocus={(e) => (e.currentTarget.style.border = "1px solid rgba(37,99,235,0.6)")}
                        onBlur={(e) => (e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)")}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={forgotLoading}
                    data-testid="button-send-reset"
                    className="w-full h-12 rounded-xl font-bold text-sm transition-all duration-200 active:scale-[0.98]"
                    style={{
                      background: "#2563eb",
                      color: "#ffffff",
                      cursor: forgotLoading ? "not-allowed" : "pointer",
                      boxShadow: forgotLoading ? "none" : "0 4px 20px rgba(37,99,235,0.35)",
                    }}
                  >
                    {forgotLoading ? "Enviando..." : "Enviar nova senha"}
                  </button>
                </form>
              )}
            </>
          )}

          {/* Termos */}
          <p className="text-center text-xs mt-8" style={{ color: "rgba(15,23,42,0.4)" }}>
            Ao acessar, você concorda com nossos{" "}
            <a href="/legal/terms" style={{ color: "#2563eb" }} className="hover:underline">
              Termos de Uso
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
