import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { resolveImageUrl } from "@/lib/image-url";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { LogoThemed } from "@/components/ui/logo-themed";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGlobalConfigStore } from "@/stores/global-config";
import { useImagePreloader } from "@/hooks/use-image-preloader";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { signUp } from "@/lib/auth";
import { markSellerRegistrationPending, clearSellerRegistrationPending } from "@/lib/registration-state";
import { auth } from "@/lib/firebase";

interface Banner {
  id: string;
  imageUrl: string;
}

const sellerRegisterSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("Email inválido"),
  confirmEmail: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
  confirmPassword: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
  acceptedTerms: z.boolean().refine((val) => val === true, "Você deve aceitar os termos"),
}).refine((data) => data.email === data.confirmEmail, {
  message: "Os emails não coincidem",
  path: ["confirmEmail"],
}).refine((data) => data.password === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

type SellerRegisterForm = z.infer<typeof sellerRegisterSchema>;

export default function SellerRegisterNew() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { config } = useGlobalConfigStore();

  const params = new URLSearchParams(window.location.search);
  const accountType = params.get("type") === "creator" ? "creator" : "vendedor";
  const isCreator = accountType === "creator";

  const { data: banners = [] } = useQuery<Banner[]>({
    queryKey: ['banners', 'active', 'register_page'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/banners/active?position=register_page');
        if (!response.ok) return [];
        const data = await response.json();
        return data || [];
      } catch (err) {
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const banner = banners && banners.length > 0 ? banners[0] : null;
  const isBannerLoaded = useImagePreloader(banner?.imageUrl);

  const form = useForm<SellerRegisterForm>({
    resolver: zodResolver(sellerRegisterSchema),
    defaultValues: {
      name: "",
      email: "",
      confirmEmail: "",
      password: "",
      confirmPassword: "",
      acceptedTerms: false,
    },
  });

  const onSubmit = async (data: SellerRegisterForm) => {
    setIsSubmitting(true);
    // Flag ANTES do signUp: o onAuthStateChanged dispara dentro do createUserWithEmailAndPassword,
    // ANTES de devolver controle para cá. Sem o flag, o listener roda sem saber que é seller.
    markSellerRegistrationPending();
    try {
      // 🔍 VERIFICAR DISPONIBILIDADE DO EMAIL (e limpar contas órfãs) ANTES de criar no Firebase Auth
      const emailCheckRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, type: 'seller' }),
      });
      const emailCheckData = await emailCheckRes.json().catch(() => ({ available: false }));
      if (!emailCheckData.available) {
        throw Object.assign(new Error('Este email já possui uma conta. Tente fazer login ou use outro email.'), { code: 'auth/email-already-in-use' });
      }

      const user = await signUp({
        email: data.email,
        password: data.password,
      });

      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Erro de autenticação ao criar seller");
      let createRes: Response;
      try {
        createRes = await fetch('/api/sellers/autocreate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ name: data.name, accountType }),
        });
      } catch (networkErr) {
        // Falha de rede após criar Firebase Auth → deletar usuário órfão
        await auth.currentUser?.delete().catch(() => {});
        throw new Error("Erro de conexão ao criar conta. Tente novamente.");
      }
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        // Falha no servidor após criar Firebase Auth → deletar usuário órfão
        await auth.currentUser?.delete().catch(() => {});
        throw new Error(err.error || "Erro ao criar conta no servidor");
      }

      setSubmitted(true);

      toast({
        title: "Conta criada com sucesso!",
        description: "Redirecionando para o dashboard...",
      });

      setTimeout(() => {
        navigate("/dashboard");
      }, 1500);
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const code = error.code?.toLowerCase() || "";
      
      let errorTitle = "Erro no cadastro";
      let errorMessage = error.message || "Erro ao criar conta";
      
      if (msg.includes('email já') || msg.includes('already in use') || code.includes('email-already-in-use')) {
        errorTitle = "Email já cadastrado";
        errorMessage = "Este email já possui uma conta. Tente fazer login.";
      } else if (code.includes('weak-password')) {
        errorTitle = "Senha muito fraca";
        errorMessage = "Use uma senha com pelo menos 6 caracteres.";
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      clearSellerRegistrationPending();
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#050505" }}>
        <div className="max-w-md w-full rounded-2xl p-10 text-center" style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ background: "rgba(155,48,255,0.15)", border: "1px solid rgba(155,48,255,0.3)" }}>
            <CheckCircle className="w-8 h-8" style={{ color: "#2563eb" }} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Conta Criada!</h2>
          <p style={{ color: "rgba(255,255,255,0.5)" }}>Sua conta foi criada com sucesso. Redirecionando para o dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#050505" }}>
      <header className="sticky top-0 z-50 backdrop-blur-sm" style={{ background: "rgba(5,5,5,0.9)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <LogoThemed type="site" variant="dark" className="h-10 sm:h-12 w-auto" fallbackText={config?.gatewayName || "VolatusPay"} />
            <Link href="/">
              <Button variant="ghost" className="text-white/50 hover:text-white hover:bg-white/5 border border-white/10 text-sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-12 items-start">
            {banner && isBannerLoaded && (
              <div className="hidden lg:block sticky top-24">
                <img src={resolveImageUrl(banner.imageUrl) || ''} alt="Register Banner" loading="eager" className="w-full h-auto object-contain" style={{ maxHeight: '700px' }} />
              </div>
            )}

            <div className={banner ? "" : "lg:col-span-2 max-w-xl mx-auto w-full"}>
              <div className="rounded-2xl overflow-hidden" style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }}>
                <div className="px-8 pt-8 pb-4 text-center">
                  <div className="flex justify-center mb-5">
                    <LogoThemed type="site" variant="dark" className="h-10 w-auto" fallbackText={config?.gatewayName || "VolatusPay"} />
                  </div>
                  <h2 className="text-2xl font-bold text-white">Criar Conta Vendedor</h2>
                  <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Preencha seus dados para começar</p>
                </div>
                <div className="px-8 pb-8">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 text-sm">Nome Completo *</FormLabel>
                            <FormControl>
                              <Input placeholder="Seu nome completo" data-testid="input-name" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 text-sm">E-mail *</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="seuemail@exemplo.com" data-testid="input-email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="confirmEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 text-sm">Confirmar E-mail *</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="Repita seu e-mail" data-testid="input-confirm-email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 text-sm">Senha *</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="Mínimo 6 caracteres" data-testid="input-password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 text-sm">Repetir Senha *</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="Repita sua senha" data-testid="input-confirm-password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="acceptedTerms"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-2 space-y-0 p-4 rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                data-testid="checkbox-accept-terms"
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel className="text-sm text-white/80">
                                Aceito os termos de uso, política de privacidade e coleta de dados técnicos *
                              </FormLabel>
                              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                                Ao aceitar, você concorda com nossos termos e condições e política de privacidade.
                              </p>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button
                        type="submit"
                        className="w-full text-white font-semibold"
                        style={{ background: "#2563eb" }}
                        disabled={isSubmitting}
                        data-testid="button-register-submit"
                      >
                        {isSubmitting ? "Criando conta..." : "Criar conta Vendedor"}
                      </Button>

                      <p className="text-sm text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
                        Já tem uma conta?{" "}
                        <Link href="/auth/login">
                          <span className="font-semibold cursor-pointer" style={{ color: "#2563eb" }}>Entrar</span>
                        </Link>
                      </p>
                    </form>
                  </Form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
