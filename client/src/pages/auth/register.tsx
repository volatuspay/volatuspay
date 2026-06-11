import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, User, Lock, Mail, Phone, ArrowRight, LogIn, Building2, UserCheck, ArrowLeft } from "lucide-react";
import { Label } from "@/components/ui/label";
import { LogoThemed } from "@/components/ui/logo-themed";
import { useGlobalConfigStore } from "@/stores/global-config";
import { signUp } from "@/lib/auth";
import { createSeller } from "@/lib/firestore";
import { useToast } from "@/hooks/use-toast";

const heroImg = "/login-helicopter-bg.png";

const registerSchema = z
  .object({
    name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
    email: z.string().email("Por favor, insira um email válido"),
    phone: z.string().min(10, "WhatsApp inválido"),
    password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
    confirmPassword: z.string().min(6, "Confirme sua senha"),
    acceptTerms: z.boolean().refine((v) => v === true, { message: "Você deve aceitar os termos" }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;
type AccountType = "seller" | "affiliate" | null;

export default function RegisterPage() {
  const { config } = useGlobalConfigStore();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>(null);
  const { toast } = useToast();

  useEffect(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    return () => {
      const saved = localStorage.getItem("zen-ui-theme");
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(saved === "dark" ? "dark" : "light");
    };
  }, []);

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", phone: "", password: "", confirmPassword: "", acceptTerms: false },
  });

  const formatPhone = (value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 11);
    return clean.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
  };

  const inputStyle = {
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.12)",
    color: "#0f172a",
  };

  const onFocusBorder = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.border = "1px solid rgba(37,99,235,0.6)";
  };
  const onBlurBorder = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.border = "1px solid rgba(0,0,0,0.12)";
  };

  const onSubmit = async (data: RegisterFormData) => {
    setLoading(true);
    let signUpCompleted = false;
    try {
      const emailCheckResponse = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, type: "seller" }),
      });
      const emailCheck = await emailCheckResponse.json().catch(() => ({ available: false }));
      if (!emailCheckResponse.ok || !emailCheck.available) {
        throw new Error("Este email já está em uso. Tente fazer login ou use outro email.");
      }

      const user = await signUp({ email: data.email, password: data.password });
      signUpCompleted = true;

      const sellerPayload = {
        userId: user.uid,
        name: data.name,
        email: data.email,
        phone: data.phone.replace(/\D/g, ""),
        companyName: "",
        cnpj: "",
        businessDescription: "",
        status: "pending",
        accountType: accountType || "seller",
      };

      try {
        await createSeller(sellerPayload);
      } catch (fsErr: any) {
        console.warn("[register] Firestore cliente falhou, usando autocreate:", fsErr?.message);
        const { auth: firebaseAuth } = await import("@/lib/firebase");
        const idToken = await firebaseAuth.currentUser?.getIdToken();
        if (!idToken) throw new Error("Erro de autenticação");
        const apiRes = await fetch("/api/sellers/autocreate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            name: data.name,
            phone: data.phone.replace(/\D/g, ""),
            accountType: accountType || "seller",
          }),
        });
        if (!apiRes.ok) {
          const errBody = await apiRes.json().catch(() => ({}));
          throw new Error(errBody.error || "Erro ao criar conta");
        }
      }

      toast({ title: "Conta criada!", description: "Redirecionando para o painel..." });
      setTimeout(() => { window.location.href = "/dashboard"; }, 1500);
    } catch (error: any) {
      if (signUpCompleted) {
        try {
          const { auth: firebaseAuth } = await import("@/lib/firebase");
          await firebaseAuth.signOut();
        } catch (_) {}
      }

      let msg = "Tente novamente.";
      const m = error.message?.toLowerCase() || "";
      if (m.includes("email") && (m.includes("uso") || m.includes("already"))) {
        msg = "Este email já está cadastrado. Tente fazer login.";
      } else if (error.message) {
        msg = error.message;
      }
      toast({ title: "Erro no cadastro", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const leftPanelText = accountType === "affiliate"
    ? { title: "Afilie-se agora", subtitle: "sem limites.", desc: "Indique produtos, ganhe comissões e acompanhe tudo em tempo real." }
    : accountType === "seller"
    ? { title: "Venda com sua", subtitle: "empresa.", desc: "Crie produtos, gere links de pagamento e cresça com tecnologia de ponta." }
    : { title: "Comece agora", subtitle: "sem limites.", desc: "Crie sua conta e comece a operar com tecnologia de alta performance ao seu lado." };

  return (
    <div className="auth-page-container flex" style={{ background: "#ffffff" }}>
      {/* ── PAINEL ESQUERDO (foto) ── */}
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-end overflow-hidden"
        style={{ background: "#000", minHeight: "100vh" }}
      >
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
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.0) 40%, rgba(0,0,0,0.65) 100%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 50% 30%, rgba(37,99,235,0.18) 0%, transparent 60%)",
          }}
        />
        <div className="relative z-10 p-10 pb-14">
          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight mb-3 drop-shadow-lg">
            <span style={{ color: "#ffffff" }}>Voe alto.</span>
            <br />
            <span style={{ color: "#60a5fa" }}>Escale suas vendas.</span>
          </h1>
          <p className="text-base max-w-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.72)" }}>
            {leftPanelText.desc}
          </p>
        </div>
      </div>

      {/* ── PAINEL DIREITO ── */}
      <div
        className="auth-panel-height flex-1 flex flex-col items-center justify-start lg:justify-center px-6 py-10 lg:px-14 overflow-y-auto"
        style={{ background: "#ffffff" }}
      >
        <div className="mb-7">
          <LogoThemed
            type="site"
            variant="light"
            className="h-14 w-auto"
            fallbackText={config?.gatewayName || "VolatusPay"}
            data-testid="register-page-logo"
          />
        </div>

        <div className="w-full max-w-sm">

          {/* ── SELEÇÃO DE TIPO DE CONTA ── */}
          {!accountType ? (
            <>
              <div className="mb-7 text-center">
                <h2 className="text-3xl font-extrabold tracking-tight" style={{ color: "#0f172a" }}>Crie sua conta</h2>
                <p className="mt-2 text-sm" style={{ color: "rgba(15,23,42,0.5)" }}>
                  Rápido, grátis e sem complicação. Escolha seu tipo de conta:
                </p>
              </div>

              <div className="space-y-3 mb-6">
                {/* Card Vendedor PJ */}
                <button
                  type="button"
                  onClick={() => setAccountType("seller")}
                  className="w-full text-left rounded-2xl p-5 transition-all duration-200 group hover:shadow-md active:scale-[0.99]"
                  style={{ border: "1.5px solid rgba(0,0,0,0.10)", background: "#ffffff" }}
                  data-testid="select-account-seller"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base font-bold" style={{ color: "#0f172a" }}>Conta Vendedor PJ</span>
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(0,0,0,0.06)", color: "rgba(15,23,42,0.6)" }}
                        >
                          CNPJ
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: "rgba(15,23,42,0.55)" }}>
                        Crie e venda produtos digitais. Verificação de empresa obrigatória (CNPJ).
                      </p>
                    </div>
                    <ArrowRight size={15} className="mt-1 opacity-25 group-hover:opacity-60 transition-opacity flex-shrink-0" style={{ color: "#0f172a" }} />
                  </div>
                </button>

                {/* Card Afiliado */}
                <button
                  type="button"
                  onClick={() => setAccountType("affiliate")}
                  className="w-full text-left rounded-2xl p-5 transition-all duration-200 group hover:shadow-md active:scale-[0.99]"
                  style={{ border: "1.5px solid rgba(0,0,0,0.10)", background: "#f8f9fa" }}
                  data-testid="select-account-affiliate"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base font-bold" style={{ color: "#0f172a" }}>Conta Afiliado</span>
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(0,0,0,0.06)", color: "rgba(15,23,42,0.6)" }}
                        >
                          CPF
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: "rgba(15,23,42,0.55)" }}>
                        Indique produtos e ganhe comissões. Não cria produtos, apenas afilia.
                      </p>
                    </div>
                    <ArrowRight size={15} className="mt-1 opacity-25 group-hover:opacity-60 transition-opacity flex-shrink-0" style={{ color: "#0f172a" }} />
                  </div>
                </button>
              </div>

              {/* Divider */}
              <div className="my-5 flex items-center gap-4">
                <div className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.1)" }} />
                <span className="text-xs" style={{ color: "rgba(15,23,42,0.45)" }}>
                  Já tem uma conta?
                </span>
                <div className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.1)" }} />
              </div>

              <Link href="/login">
                <button
                  type="button"
                  className="w-full h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98]"
                  style={{
                    background: "transparent",
                    color: "rgba(15,23,42,0.7)",
                    border: "1px solid rgba(0,0,0,0.15)",
                  }}
                >
                  <LogIn size={16} /> Entrar na Conta
                </button>
              </Link>
            </>
          ) : (
            <>
              {/* ── FORMULÁRIO (após selecionar tipo) ── */}
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => setAccountType(null)}
                  className="flex items-center gap-1.5 text-xs mb-4 transition-opacity hover:opacity-70"
                  style={{ color: "rgba(15,23,42,0.4)" }}
                >
                  <ArrowLeft size={12} /> Trocar tipo de conta
                </button>
                <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: "#0f172a" }}>
                  {accountType === "seller" ? "Cadastro de Empresa" : "Cadastro de Afiliado"}
                </h2>
                <p className="mt-1 text-sm" style={{ color: "rgba(15,23,42,0.5)" }}>
                  {accountType === "seller"
                    ? "Preencha seus dados. A verificação de CNPJ será feita no próximo passo."
                    : "Preencha seus dados para começar a afiliar produtos."}
                </p>
              </div>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Nome */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium" style={{ color: "rgba(15,23,42,0.75)" }}>
                    Nome Completo
                  </Label>
                  <div className="relative">
                    <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(15,23,42,0.35)" }} />
                    <input
                      type="text"
                      placeholder="Seu nome completo"
                      autoComplete="name"
                      inputMode="text"
                      enterKeyHint="next"
                      {...form.register("name")}
                      className="w-full h-12 pl-10 pr-4 rounded-xl text-sm placeholder-gray-400 outline-none transition-all"
                      style={inputStyle}
                      onFocus={onFocusBorder}
                      onBlur={onBlurBorder}
                    />
                  </div>
                  {form.formState.errors.name && (
                    <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium" style={{ color: "rgba(15,23,42,0.75)" }}>
                    Email
                  </Label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(15,23,42,0.35)" }} />
                    <input
                      type="email"
                      placeholder="exemplo@email.com"
                      autoComplete="email"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      inputMode="email"
                      enterKeyHint="next"
                      {...form.register("email")}
                      className="w-full h-12 pl-10 pr-4 rounded-xl text-sm placeholder-gray-400 outline-none transition-all"
                      style={inputStyle}
                      onFocus={onFocusBorder}
                      onBlur={onBlurBorder}
                    />
                  </div>
                  {form.formState.errors.email && (
                    <p className="text-xs text-red-500">{form.formState.errors.email.message}</p>
                  )}
                </div>

                {/* WhatsApp */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium" style={{ color: "rgba(15,23,42,0.75)" }}>
                    WhatsApp
                  </Label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(15,23,42,0.35)" }} />
                    <input
                      type="text"
                      placeholder="(11) 99999-9999"
                      inputMode="tel"
                      enterKeyHint="next"
                      autoComplete="tel"
                      {...form.register("phone")}
                      onChange={(e) => form.setValue("phone", formatPhone(e.target.value))}
                      className="w-full h-12 pl-10 pr-4 rounded-xl text-sm placeholder-gray-400 outline-none transition-all"
                      style={inputStyle}
                      onFocus={onFocusBorder}
                      onBlur={onBlurBorder}
                    />
                  </div>
                  {form.formState.errors.phone && (
                    <p className="text-xs text-red-500">{form.formState.errors.phone.message}</p>
                  )}
                </div>

                {/* Senha */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium" style={{ color: "rgba(15,23,42,0.75)" }}>
                    Senha
                  </Label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(15,23,42,0.35)" }} />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      inputMode="text"
                      enterKeyHint="next"
                      {...form.register("password")}
                      className="w-full h-12 pl-10 pr-12 rounded-xl text-sm placeholder-gray-400 outline-none transition-all"
                      style={inputStyle}
                      onFocus={onFocusBorder}
                      onBlur={onBlurBorder}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5" style={{ color: "rgba(15,23,42,0.4)" }}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-xs text-red-500">{form.formState.errors.password.message}</p>
                  )}
                </div>

                {/* Confirmar Senha */}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium" style={{ color: "rgba(15,23,42,0.75)" }}>
                    Confirmar Senha
                  </Label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(15,23,42,0.35)" }} />
                    <input
                      type={showConfirm ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      inputMode="text"
                      enterKeyHint="done"
                      {...form.register("confirmPassword")}
                      className="w-full h-12 pl-10 pr-12 rounded-xl text-sm placeholder-gray-400 outline-none transition-all"
                      style={inputStyle}
                      onFocus={onFocusBorder}
                      onBlur={onBlurBorder}
                    />
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5" style={{ color: "rgba(15,23,42,0.4)" }}>
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {form.formState.errors.confirmPassword && (
                    <p className="text-xs text-red-500">{form.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                {/* Termos */}
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    {...form.register("acceptTerms")}
                    className="rounded mt-0.5"
                    style={{ accentColor: "#2563eb", width: 14, height: 14 }}
                  />
                  <span className="text-xs leading-relaxed" style={{ color: "rgba(15,23,42,0.55)" }}>
                    Aceito os{" "}
                    <a href="/legal/terms" className="underline" style={{ color: "#2563eb" }}>
                      Termos de Uso
                    </a>{" "}
                    e a{" "}
                    <a href="/legal/privacy" className="underline" style={{ color: "#2563eb" }}>
                      Política de Privacidade
                    </a>
                  </span>
                </label>
                {form.formState.errors.acceptTerms && (
                  <p className="text-xs text-red-500">{form.formState.errors.acceptTerms.message}</p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] mt-2"
                  style={{
                    background: accountType === "affiliate" ? "#059669" : "#2563eb",
                    color: "#ffffff",
                    cursor: loading ? "not-allowed" : "pointer",
                    boxShadow: loading ? "none" : accountType === "affiliate" ? "0 4px 20px rgba(5,150,105,0.35)" : "0 4px 20px rgba(37,99,235,0.35)",
                  }}
                >
                  {loading ? "Criando conta..." : (<>Criar Conta Grátis <ArrowRight size={16} /></>)}
                </button>
              </form>

              {/* Divider */}
              <div className="my-6 flex items-center gap-4">
                <div className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.1)" }} />
                <span className="text-xs" style={{ color: "rgba(15,23,42,0.45)" }}>
                  Já tem uma conta?
                </span>
                <div className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.1)" }} />
              </div>

              <Link href="/login">
                <button
                  type="button"
                  className="w-full h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98]"
                  style={{
                    background: "transparent",
                    color: "rgba(15,23,42,0.7)",
                    border: "1px solid rgba(0,0,0,0.15)",
                  }}
                >
                  <LogIn size={16} /> Entrar na Conta
                </button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
