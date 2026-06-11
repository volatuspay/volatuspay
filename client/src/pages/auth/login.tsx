import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, User, Lock, UserPlus, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoThemed } from "@/components/ui/logo-themed";
import { useGlobalConfigStore } from "@/stores/global-config";
import { signIn, resetPassword, signOut } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { clearUserTypeCache } from "@/lib/firestore";
const heroImg = "/login-helicopter-bg.png";

const loginSchema = z.object({
  email: z.string().email("Por favor, insira um email válido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
  rememberMe: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;


export default function LoginPage() {
  const { config } = useGlobalConfigStore();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    return () => {
      const saved = localStorage.getItem("zen-ui-theme");
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(saved === "dark" ? "dark" : "light");
    };
  }, []);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const user = await signIn(data);
      toast({ title: "Bem-vindo de volta!", description: "Você fez login com sucesso." });
      clearUserTypeCache();
      setLocation("/auth/route");

      user.getIdToken().then((token) => {
        fetch("/api/auth/check-blocked", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ deviceFingerprint: null }),
        })
          .then(async (response) => {
            if (response.ok) {
              try {
                const blockData = await response.json();
                if (blockData?.blocked === true) {
                  await signOut().catch(() => {});
                  toast({
                    title: "Conta Bloqueada",
                    description: "Seu IP ou conta foi bloqueado. Entre em contato com o suporte.",
                    variant: "destructive",
                    duration: 10000,
                  });
                  window.location.href = "/";
                }
              } catch {}
            }
          })
          .catch(() => {});
      }).catch(() => {});
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      let errorTitle = "Erro ao entrar";
      let errorMessage = "Tente novamente em alguns segundos.";
      if (msg.includes("senha") || msg.includes("password") || msg.includes("incorret") || msg.includes("wrong")) {
        errorTitle = "Senha incorreta";
        errorMessage = "A senha informada está incorreta. Verifique e tente novamente.";
      } else if (msg.includes("não encontrad") || msg.includes("not found") || msg.includes("user-not-found")) {
        errorTitle = "Conta não encontrada";
        errorMessage = "Não existe uma conta com este email. Verifique ou crie uma nova conta.";
      } else if (msg.includes("muitas tentativas") || msg.includes("too-many") || msg.includes("rate limit")) {
        errorTitle = "Muitas tentativas";
        errorMessage = "Você fez muitas tentativas. Aguarde alguns minutos e tente novamente.";
      } else if (msg.includes("credenciais") || msg.includes("credential")) {
        errorTitle = "Dados incorretos";
        errorMessage = "Email ou senha incorretos. Verifique seus dados e tente novamente.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      toast({ title: errorTitle, description: errorMessage, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetEmail.trim() || !resetEmail.includes("@")) {
      toast({ title: "Email inválido", description: "Por favor, digite um email válido.", variant: "destructive" });
      return;
    }
    setResetLoading(true);
    try {
      await resetPassword(resetEmail);
      toast({ title: "Email enviado!", description: `Link enviado para ${resetEmail}. Verifique sua caixa de entrada.` });
      setShowResetPassword(false);
      setResetEmail("");
    } catch (error: any) {
      toast({ title: "Erro ao Redefinir Senha", description: error.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="auth-page-container flex" style={{ background: "#ffffff" }}>
      {/* ── PAINEL ESQUERDO (foto) ── */}
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-end overflow-hidden"
        style={{ background: "#000", minHeight: "100vh" }}
      >
        {/* Hero image */}
        <div className="absolute inset-0">
          <img
            src={heroImg}
            alt="Helicóptero no helipad de arranha-céu"
            className="w-full h-full"
            style={{
              objectFit: "cover",
              objectPosition: "center center",
              filter: "brightness(0.85) saturate(1.1)",
            }}
          />
        </div>

        {/* Dark gradient overlay — escurece topo e ilumina copy abaixo */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.0) 40%, rgba(0,0,0,0.65) 100%)",
          }}
        />

        {/* Blue glow overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 50% 30%, rgba(37,99,235,0.18) 0%, transparent 60%)",
          }}
        />

        {/* Copy text overlay */}
        <div className="relative z-10 p-10 pb-14">
          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight mb-3 drop-shadow-lg">
            <span style={{ color: "#ffffff" }}>Voe alto.</span>
            <br />
            <span style={{ color: "#60a5fa" }}>Escale suas vendas.</span>
          </h1>
          <p className="text-base max-w-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.72)" }}>
            A plataforma que leva seu negócio digital ao próximo nível com tecnologia de alta performance.
          </p>
        </div>
      </div>

      {/* ── PAINEL DIREITO ── */}
      <div
        className="auth-panel-height flex-1 flex flex-col items-center justify-start lg:justify-center px-6 py-10 lg:px-14 overflow-y-auto"
        style={{ background: "#ffffff" }}
      >
        {/* Logo */}
        <div className="mb-8">
          <LogoThemed
            type="site"
            variant="light"
            className="h-14 w-auto"
            fallbackText={config?.gatewayName || "VolatusPay"}
            data-testid="login-page-logo"
          />
        </div>

        <div className="w-full max-w-sm">
          {/* Heading */}
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight" style={{ color: "#0f172a" }}>Bem-vindo de volta!</h2>
            <p className="mt-2 text-sm" style={{ color: "rgba(15,23,42,0.5)" }}>
              Acesse sua conta para gerenciar seu império.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium" style={{ color: "rgba(15,23,42,0.75)" }}>
                Usuário
              </Label>
              <div className="relative">
                <User
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "rgba(15,23,42,0.35)" }}
                />
                <input
                  id="email"
                  type="email"
                  placeholder="exemplo@email.com"
                  autoComplete="email"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="email"
                  enterKeyHint="next"
                  data-testid="input-email"
                  {...form.register("email")}
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
              {form.formState.errors.email && (
                <p className="text-xs text-red-500" data-testid="error-email">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium" style={{ color: "rgba(15,23,42,0.75)" }}>
                Senha
              </Label>
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "rgba(15,23,42,0.35)" }}
                />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  inputMode="text"
                  enterKeyHint="done"
                  data-testid="input-password"
                  {...form.register("password")}
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
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="text-xs text-red-500" data-testid="error-password">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  {...form.register("rememberMe")}
                  data-testid="checkbox-remember-me"
                  className="rounded"
                  style={{ accentColor: "#2563eb", width: 14, height: 14 }}
                />
                <span className="text-xs" style={{ color: "rgba(15,23,42,0.55)" }}>
                  Lembrar meu acesso
                </span>
              </label>
              <button
                type="button"
                onClick={() => setShowResetPassword(true)}
                className="text-xs flex items-center gap-1 transition-colors hover:text-blue-600"
                style={{ color: "rgba(15,23,42,0.5)" }}
                data-testid="button-forgot-password"
              >
                <span style={{ fontSize: 11 }}>⚡</span> Esqueci minha senha
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              data-testid="button-sign-in"
              className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] mt-2"
              style={{
                background: "#2563eb",
                color: "#ffffff",
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: loading ? "none" : "0 4px 20px rgba(37,99,235,0.35)",
              }}
            >
              {loading ? "Entrando..." : (
                <>
                  Entrar <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Área de Membros */}
          <Link href="/areademembros">
            <button
              type="button"
              data-testid="button-members-area"
              className="w-full h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] mt-3"
              style={{
                background: "rgba(37,99,235,0.07)",
                color: "#2563eb",
                border: "1px solid rgba(37,99,235,0.25)",
              }}
            >
              Acessar Área de Membros
            </button>
          </Link>

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.1)" }} />
            <span className="text-xs" style={{ color: "rgba(15,23,42,0.45)" }}>
              Ainda não tem uma conta?
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.1)" }} />
          </div>

          {/* Create account */}
          <Link href="/register">
            <button
              type="button"
              data-testid="button-create-account"
              className="w-full h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98]"
              style={{
                background: "transparent",
                color: "rgba(15,23,42,0.7)",
                border: "1px solid rgba(0,0,0,0.15)",
              }}
            >
              <UserPlus size={16} /> Criar Conta Grátis
            </button>
          </Link>
        </div>
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={showResetPassword} onOpenChange={setShowResetPassword}>
        <DialogContent className="sm:max-w-md" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.1)", color: "#111111" }}>
          <DialogHeader>
            <DialogTitle className="text-gray-900">Redefinir Senha</DialogTitle>
            <DialogDescription style={{ color: "rgba(0,0,0,0.5)" }}>
              Digite seu email para receber um link de redefinição de senha
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email" style={{ color: "rgba(0,0,0,0.75)" }}>Email</Label>
              <input
                id="reset-email"
                type="email"
                placeholder="seu@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                data-testid="input-reset-email"
                className="w-full h-11 px-4 rounded-xl text-sm text-gray-900 placeholder-gray-400 outline-none"
                style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.12)" }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setShowResetPassword(false); setResetEmail(""); }}
                disabled={resetLoading}
                style={{ borderColor: "rgba(0,0,0,0.15)", color: "rgba(0,0,0,0.7)", background: "transparent" }}
              >
                Cancelar
              </Button>
              <button
                className="flex-1 h-10 rounded-lg font-semibold text-sm transition-all"
                onClick={handleResetPassword}
                disabled={resetLoading}
                data-testid="button-send-reset"
                style={{ background: "#2563eb", color: "#ffffff", cursor: resetLoading ? "not-allowed" : "pointer" }}
              >
                {resetLoading ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
