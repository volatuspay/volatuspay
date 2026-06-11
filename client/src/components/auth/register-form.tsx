import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { signUp, signIn } from "@/lib/auth";
import { createSeller } from "@/lib/firestore";
import { markSellerRegistrationPending, clearSellerRegistrationPending } from "@/lib/registration-state";
import { useToast } from "@/hooks/use-toast";
import { LogoThemed } from "@/components/ui/logo-themed";

const registerSchema = z.object({
  name: z.string().optional(), // Nome opcional - obrigatório apenas para sellers
  email: z.string().email("Por favor, insira um email vlido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
  confirmPassword: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
  acceptTerms: z.boolean().refine((val) => val === true, {
    message: "Vocdeve aceitar os termos e condies",
  }),
  // CAMPO CPF PARA COMPRADORES
  cpf: z.string().optional(),
  // CAMPOS EMPRESARIAIS PARA VENDEDORES
  companyName: z.string().optional(),
  cnpj: z.string().optional(),
  phone: z.string().optional(),
  businessDescription: z.string().optional()
}).refine((data) => data.password === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

type RegisterFormData = z.infer<typeof registerSchema>;

interface RegisterFormProps {
  type?: "buyer" | "seller";
  compact?: boolean;
  onClose?: () => void;
}

export function RegisterForm({ type = "seller", compact = false, onClose }: RegisterFormProps = {}) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  
  // Schema dinâmico: valida name apenas para sellers
  const dynamicSchema = registerSchema.refine(
    (data) => {
      if (type === "seller" && (!data.name || data.name.trim() === "")) {
        return false;
      }
      return true;
    },
    {
      message: "Nome é obrigatório para vendedores",
      path: ["name"]
    }
  );
  
  const form = useForm<RegisterFormData>({
    resolver: zodResolver(dynamicSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false,
      // VALOR PADRÃO CPF PARA COMPRADORES
      cpf: "",
      // VALORES PADRÃO CAMPOS EMPRESARIAIS
      companyName: "",
      cnpj: "",
      phone: "",
      businessDescription: ""
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setLoading(true);
    // Marcar ANTES de qualquer chamada async para sellers, para o auth listener pegar
    if (type === "seller") {
      markSellerRegistrationPending();
    }
    try {
      // PROTEÇÃO TOTAL: VERIFICAR SE EMAIL ESTDISPONVEL
      // Security: User process completed
      
      const emailCheckResponse = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: data.email,
          type: type === 'buyer' ? 'customer' : 'seller'
        }),
      });
      
      const emailCheckResult = await emailCheckResponse.json().catch(() => ({ available: false }));
      
      if (!emailCheckResponse.ok || !emailCheckResult.available) {
        // Security: User process completed
        throw new Error('Este email jestem uso. Tente fazer login ou use outro email.');
      }
      
      console.log('EMAIL DISPONVEL - Prosseguindo com registro');
      
      // 1CRIAR USURIO NO FIREBASE AUTH - FLEXVEL PARA COMPRADORES
      let user;
      try {
        user = await signUp({
          email: data.email,
          password: data.password,
        });
      } catch (signUpError: any) {
        // SE FOR USURIO E EMAIL JEXISTE, TENTAR FAZER LOGIN
        if (type === "buyer" && signUpError.code === 'auth/email-already-in-use') {
          console.log('USURIO - Email já existe, tentando fazer login...');
          try {
            user = await signIn({
              email: data.email,
              password: data.password,
            });
            console.log('USURIO - Login realizado com sucesso!');
          } catch (signInError: any) {
            // Se não conseguir fazer login, significa que a senha está errada
            throw new Error('Este email jpossui uma conta. Verifique sua senha ou use "Esqueci minha senha".');
          }
        } else {
          // Para sellers ou outros erros, não permitir
          throw signUpError;
        }
      }
      
      // 2SE FOR SELLER, CRIAR REGISTRO NA COLEÇÃO SELLERS  
      if (type === "seller") {
        console.log("Criando seller após registro de usuário...");

        const sellerPayload = {
          userId: user.uid,
          name: data.name!,
          email: data.email,
          companyName: data.companyName || "",
          cnpj: data.cnpj || "",
          phone: data.phone || "",
          businessDescription: data.businessDescription || "",
          status: "pending"
        };

        // Tenta Firestore cliente; se falhar usa API do servidor como fallback
        try {
          await createSeller(sellerPayload);
        } catch (fsErr: any) {
          console.warn("[register-form] Firestore cliente falhou, usando API fallback:", fsErr?.message);
          const { auth: firebaseAuth } = await import("@/lib/firebase");
          const idToken = await firebaseAuth.currentUser?.getIdToken();
          const apiRes = await fetch("/api/sellers/register", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify(sellerPayload),
          });
          if (!apiRes.ok) {
            const errBody = await apiRes.json().catch(() => ({}));
            throw new Error(errBody.error || "Erro ao criar conta de vendedor");
          }
        }
        
        console.log("Seller criado - aguardando aprovação admin");
      }
      
      // SE FOR COMPRADOR, DADOS JFORAM CRIADOS NO FIREBASE AUTH
      if (type === "buyer") {
        console.log("Comprador criado no Firebase Auth - ID:", user.uid);
      }
      
      if (type === "seller") {
        toast({
          title: "Conta de vendedor criada!",
          description: " Agora complete seus dados empresariais para começar a vender.",
        });
        onClose?.();
        // Redirecionar para página completa de registro
        setTimeout(() => {
          window.location.href = "/seller/register";
        }, 1000);
      } else {
        toast({
          title: "Conta criada!",
          description: "Conta criada com sucesso! Agora vocpode acessar suas compras.",
        });
        onClose?.();
      }
    } catch (error: any) {
      console.error("Erro no registro:", error);
      
      // Mensagens de erro amigáveis baseadas no tipo de erro
      let errorTitle = "Erro no cadastro";
      let errorMessage = "Tente novamente com dados diferentes.";
      
      const msg = error.message?.toLowerCase() || "";
      const code = error.code?.toLowerCase() || "";
      
      if (msg.includes('email já') || msg.includes('already in use') || code.includes('email-already-in-use')) {
        errorTitle = "Email já cadastrado";
        errorMessage = "Este email já possui uma conta. Tente fazer login ou use outro email.";
      } else if (msg.includes('senha fraca') || msg.includes('weak-password') || code.includes('weak-password')) {
        errorTitle = "Senha muito fraca";
        errorMessage = "Use uma senha com pelo menos 6 caracteres, incluindo letras e números.";
      } else if (msg.includes('email inválido') || msg.includes('invalid-email') || code.includes('invalid-email')) {
        errorTitle = "Email inválido";
        errorMessage = "O formato do email não é válido. Verifique e tente novamente.";
      } else if (msg.includes('rede') || msg.includes('network') || code.includes('network')) {
        errorTitle = "Erro de conexão";
        errorMessage = "Verifique sua conexão com a internet e tente novamente.";
      } else if (msg.includes('muitas tentativas') || msg.includes('too-many') || code.includes('too-many')) {
        errorTitle = "Muitas tentativas";
        errorMessage = "Aguarde alguns minutos antes de tentar novamente.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      clearSellerRegistrationPending();
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* NOME - Apenas para sellers */}
        {type === "seller" && (
          <div className="space-y-2">
            <Label htmlFor="name">Nome Completo</Label>
            <Input
              id="name"
              type="text"
              placeholder="Digite seu nome completo"
              data-testid="input-name"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive" data-testid="error-name">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
        )}
        
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            placeholder="seu@email.com"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            data-testid="input-email"
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <p className="text-sm text-destructive" data-testid="error-email">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            placeholder="Crie uma senha segura"
            autoComplete="new-password"
            data-testid="input-password"
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="text-sm text-destructive" data-testid="error-password">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Repetir Senha</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Repita sua senha"
            autoComplete="new-password"
            data-testid="input-confirm-password"
            {...form.register("confirmPassword")}
          />
          {form.formState.errors.confirmPassword && (
            <p className="text-sm text-destructive" data-testid="error-confirm-password">
              {form.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <Checkbox
            id="acceptTerms"
            checked={form.watch("acceptTerms")}
            onCheckedChange={(checked) => form.setValue("acceptTerms", !!checked)}
            data-testid="checkbox-accept-terms"
          />
          <Label htmlFor="acceptTerms" className="text-sm">
            Aceito os termos e condies
          </Label>
        </div>
        {form.formState.errors.acceptTerms && (
          <p className="text-sm text-destructive" data-testid="error-accept-terms">
            {form.formState.errors.acceptTerms.message}
          </p>
        )}
        <Button 
          type="submit" 
          className="w-full" 
          disabled={loading}
          data-testid="button-register"
        >
          {loading ? "Criando conta..." : (type === "seller" ? "Criar Conta Vendedor" : "Criar Conta")}
        </Button>
        
        {type === "seller" && (
          <p className="text-xs text-gray-500 text-center">
            Após criar a conta, vocserdirecionado para completar seus dados empresariais
          </p>
        )}
      </form>
    );
  }

  return (
    <Card className="w-full max-w-md bg-white dark:bg-transparent text-black dark:text-white border-gray-200 dark:border-gray-800">
      <CardHeader>
        <CardTitle data-testid="text-register-title" className="text-center text-black dark:text-white">
          <LogoThemed 
            type="site" 
            className="h-8 mx-auto"
            data-testid="logo-register"
          />
        </CardTitle>
        <CardDescription className="text-gray-600 dark:text-gray-400">
          {type === "seller" 
            ? "Comece a aceitar pagamentos com suas páginas de checkout personalizadas"
            : "Crie sua conta para acessar produtos, afiliar a produtos etc"
          }
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          {/* NOME - Apenas para sellers */}
          {type === "seller" && (
            <div className="space-y-2">
              <Label htmlFor="name" className="text-gray-900 dark:text-gray-100">Nome Completo</Label>
              <Input
                id="name"
                type="text"
                placeholder="Digite seu nome completo"
                data-testid="input-name"
                className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive" data-testid="error-name">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="email" className="text-gray-900 dark:text-gray-100">E-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="seu@email.com"
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
              placeholder="Crie uma senha segura"
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
          
          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-gray-900 dark:text-gray-100">Repetir Senha</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Repita sua senha"
              data-testid="input-confirm-password"
              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              {...form.register("confirmPassword")}
            />
            {form.formState.errors.confirmPassword && (
              <p className="text-sm text-destructive" data-testid="error-confirm-password">
                {form.formState.errors.confirmPassword.message}
              </p>
            )}
          </div>
          
          {/* CAMPOS EMPRESARIAIS PARA VENDEDORES - VERSÃO COMPLETA */}
          {type === "seller" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="companyName" className="text-gray-900 dark:text-gray-100">Nome da Empresa</Label>
                <Input
                  id="companyName"
                  type="text"
                  placeholder="Nome da sua empresa"
                  data-testid="input-company-name"
                  className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                  {...form.register("companyName")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cnpj" className="text-gray-900 dark:text-gray-100">CNPJ</Label>
                <Input
                  id="cnpj"
                  type="text"
                  placeholder="00.000.000/0001-00"
                  autoComplete="off"
                  data-testid="input-cnpj"
                  className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                  {...form.register("cnpj")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-gray-900 dark:text-gray-100">WhatsApp/Telefone</Label>
                <Input
                  id="phone"
                  type="text"
                  placeholder="(11) 99999-9999"
                  data-testid="input-phone"
                  className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                  {...form.register("phone")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessDescription" className="text-gray-900 dark:text-gray-100">Descrição do Negócio</Label>
                <Input
                  id="businessDescription"
                  type="text"
                  placeholder="Descreva seu produto/serviço"
                  data-testid="input-business-description"
                  className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                  {...form.register("businessDescription")}
                />
              </div>
            </>
          )}
          
          <div className="flex items-center space-x-2">
            <Checkbox
              id="acceptTerms"
              checked={form.watch("acceptTerms")}
              onCheckedChange={(checked) => form.setValue("acceptTerms", !!checked)}
              data-testid="checkbox-accept-terms"
            />
            <Label htmlFor="acceptTerms" className="text-sm">
              Aceito os termos e condies e política de privacidade
            </Label>
          </div>
          {form.formState.errors.acceptTerms && (
            <p className="text-sm text-destructive" data-testid="error-accept-terms">
              {form.formState.errors.acceptTerms.message}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button 
            type="submit" 
            className="w-full" 
            disabled={loading}
            data-testid="button-register"
          >
            {loading ? "Criando conta..." : "Criar Conta"}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            Jtem uma conta?{" "}
            <Link href="/auth/login">
              <Button variant="link" className="p-0 h-auto font-normal" data-testid="link-login">
                Entrar
              </Button>
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
