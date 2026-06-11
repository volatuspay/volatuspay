import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import DocumentUpload from "@/components/seller/document-upload";
import { sellerRegisterFormSchema, type SellerRegisterForm } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth";
import { 
  User, 
  Building, 
  FileText, 
  Camera, 
  Shield, 
  CheckCircle, 
  ArrowLeft,
  Store,
  Package 
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function SellerRegisterComplete() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const passwordRef = useRef<string>(""); // 🔐 Guardar senha ANTES do Zod processar
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { setUser } = useAuthStore();

  const form = useForm<SellerRegisterForm>({
    resolver: zodResolver(sellerRegisterFormSchema),
    defaultValues: {
      name: "",
      email: "",
      confirmEmail: "",
      password: "",
      confirmPassword: "",
      phone: "",
      birthDate: "",
      businessName: "",
      documentType: "cnpj",
      document: "",
      personalDocumentType: "rg",
      personalDocumentNumber: "",
      documentsUrls: {
        documentFront: "",
        documentBack: "",
        selfieWithDocument: "",
        cnpjCard: "",
      },
      businessNiche: "",
      productType: "digital",
      productsDescription: "",
      acceptedTerms: false,
    },
  });

  const totalSteps = 4;
  const progress = (currentStep / totalSteps) * 100;

  const onSubmit = async (data: SellerRegisterForm) => {
    // Validar se todos os documentos foram enviados
    const { documentsUrls } = data;
    if (!documentsUrls.documentFront || !documentsUrls.documentBack || 
        !documentsUrls.selfieWithDocument || !documentsUrls.cnpjCard) {
      toast({
        title: "Documentos obrigatórios",
        description: "Por favor, envie todos os documentos solicitados",
        variant: "destructive",
      });
      setCurrentStep(3); // Voltar para a etapa de documentos
      return;
    }

    // 🔐 USAR SENHA DA REF (capturada no onChange ANTES do Zod processar)
    const userPassword = passwordRef.current;
    if (!userPassword || userPassword.length < 6) {
      toast({
        title: "Erro de validação",
        description: "Senha inválida. Mínimo 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/sellers/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        // PROTEGER CONTRA "UNAUTHORIZED" BUG
        const errorText = await response.text();
        if (!errorText || errorText.trim() === 'unauthorized' || errorText.includes('unauthorized')) {
          throw new Error('Erro de autenticação - Problema no cadastro de vendedor');
        }
        
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          throw new Error(`Erro no servidor: ${errorText.substring(0, 100)}`);
        }
        throw new Error(error.message || 'Erro ao criar conta');
      }

      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const resultText = await response.text();
      if (!resultText || resultText.trim() === 'unauthorized' || resultText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Resposta inválida do cadastro');
      }
      
      let result;
      try {
        result = JSON.parse(resultText);
      } catch (parseError) {
        console.error('Register JSON parse error:', resultText.substring(0, 100));
        throw new Error('Resposta inválida do servidor de cadastro');
      }
      
      setSubmitted(true);
      toast({
        title: "Cadastro enviado com sucesso!",
        description: "Fazendo login automático...",
      });

      // LOGIN AUTOMÁTICO COM FIREBASE AUTH
      console.log('🔐 LOGIN AUTOMÁTICO - Autenticando seller após cadastro...');
      console.log('📧 Email:', data.email);
      console.log('🏢 Empresa:', data.businessName);
      
      try {
        // 1️⃣ Fazer login com Firebase Authentication usando senha salva
        if (!userPassword) {
          throw new Error('Senha não disponível para login automático');
        }
        
        await signInWithEmailAndPassword(auth, data.email, userPassword);
        console.log('✅ Login automático bem-sucedido!');
        
        // 2️⃣ Aguardar 1 segundo para garantir que o Firebase Auth esteja pronto
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 3️⃣ Redirecionar para post-login (router inteligente detecta seller e manda para /dashboard)
        console.log('🚀 Redirecionando para post-login...');
        setLocation('/post-login');
      } catch (loginError: any) {
        console.error('❌ Erro no login automático:', loginError);
        toast({
          title: "Cadastro criado, mas erro no login",
          description: "Por favor, faça login manualmente na página inicial",
          variant: "destructive",
        });
        
        // Redirecionar para login manual após 3 segundos
        setTimeout(() => {
          setLocation('/login');
        }, 3000);
      }
    } catch (error: any) {
      console.error("Erro ao criar seller:", error);
      toast({
        title: "Erro no cadastro",
        description: error.message || "Ocorreu um erro ao enviar sua solicitação. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const formatCNPJ = (value: string) => {
    const cleanValue = value.replace(/\D/g, "");
    return cleanValue
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})/, "$1-$2");
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-8 w-8 text-emerald-700" />
            </div>
            <CardTitle className="text-muted-foreground">Cadastro Enviado!</CardTitle>
            <CardDescription>
              Sua solicitação de vendedor foi enviada com sucesso
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-emerald-50 p-4 rounded-lg text-left">
              <h4 className="font-medium text-muted-foreground mb-2">Prximos passos:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Nossa equipe analisarseus documentos</li>
                <li>Você receberá uma resposta em até 24 horas</li>
                <li>Check seu email regularmente</li>
                <li>Em caso de dúvidas: {import.meta.env.VITE_SUPPORT_EMAIL || 'entre em contato com o suporte'}</li>
              </ul>
            </div>
            <Link href="/">
              <Button className="w-full">
                Voltar ao início
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/">
            <Button variant="ghost" className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Cadastro de Vendedor
          </h1>
          <p className="text-gray-600">
            Complete seu cadastro para começar a vender na plataforma
          </p>
        </div>

        {/* Progress */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Etapa {currentStep} de {totalSteps}</span>
              <span>{Math.round(progress)}% concludo</span>
            </div>
            <Progress value={progress} className="w-full" />
          </CardContent>
        </Card>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          {/* Etapa 1: Dados Pessoais */}
          {currentStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Dados Pessoais
                </CardTitle>
                <CardDescription>
                  Informe seus dados pessoais para começar
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome Completo *</Label>
                  <Input
                    id="name"
                    placeholder="Seu nome completo"
                    data-testid="input-name"
                    {...form.register("name")}
                  />
                  {form.formState.errors.name && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    data-testid="input-email"
                    {...form.register("email")}
                  />
                  {form.formState.errors.email && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmEmail">Confirmar Email *</Label>
                  <Input
                    id="confirmEmail"
                    type="email"
                    placeholder="Repita o email"
                    data-testid="input-confirm-email"
                    {...form.register("confirmEmail")}
                  />
                  {form.formState.errors.confirmEmail && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.confirmEmail.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone/WhatsApp *</Label>
                    <Input
                      id="phone"
                      placeholder="(00) 00000-0000"
                      data-testid="input-phone"
                      {...form.register("phone")}
                    />
                    {form.formState.errors.phone && (
                      <p className="text-sm text-muted-foreground">{form.formState.errors.phone.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="birthDate">Data de Nascimento *</Label>
                    <Input
                      id="birthDate"
                      type="date"
                      data-testid="input-birth-date"
                      {...form.register("birthDate")}
                    />
                    {form.formState.errors.birthDate && (
                      <p className="text-sm text-muted-foreground">{form.formState.errors.birthDate.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="password">Senha *</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Mnimo 6 caracteres"
                      data-testid="input-password"
                      {...form.register("password", {
                        onChange: (e) => {
                          passwordRef.current = e.target.value;
                        }
                      })}
                    />
                    {form.formState.errors.password && (
                      <p className="text-sm text-muted-foreground">{form.formState.errors.password.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirmar Senha *</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Repita a senha"
                      data-testid="input-confirm-password"
                      {...form.register("confirmPassword")}
                    />
                    {form.formState.errors.confirmPassword && (
                      <p className="text-sm text-muted-foreground">{form.formState.errors.confirmPassword.message}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Etapa 2: Dados da Empresa */}
          {currentStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5" />
                  Dados da Empresa
                </CardTitle>
                <CardDescription>
                  Informações sobre sua empresa
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="businessName">Nome da Empresa *</Label>
                  <Input
                    id="businessName"
                    placeholder="Razo social da sua empresa"
                    data-testid="input-business-name"
                    {...form.register("businessName")}
                  />
                  {form.formState.errors.businessName && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.businessName.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="document">CNPJ da Empresa *</Label>
                  <Input
                    id="document"
                    placeholder="00.000.000/0000-00"
                    value={formatCNPJ(form.watch("document"))}
                    onChange={(e) => form.setValue("document", e.target.value.replace(/\D/g, ""))}
                    data-testid="input-cnpj"
                  />
                  {form.formState.errors.document && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.document.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="personalDocumentType">Tipo do Documento Pessoal *</Label>
                  <Select
                    value={form.watch("personalDocumentType")}
                    onValueChange={(value) => form.setValue("personalDocumentType", value as "rg" | "cpf" | "cnh")}
                  >
                    <SelectTrigger data-testid="select-document-type">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rg">RG - Registro Geral</SelectItem>
                      <SelectItem value="cpf">CPF - Cadastro de Pessoa Fsica</SelectItem>
                      <SelectItem value="cnh">CNH - Carteira de Motorista</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.personalDocumentType && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.personalDocumentType.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="personalDocumentNumber">Nmero do Documento Pessoal *</Label>
                  <Input
                    id="personalDocumentNumber"
                    placeholder="Digite o nmero do seu RG/CPF/CNH"
                    data-testid="input-personal-document-number"
                    {...form.register("personalDocumentNumber")}
                  />
                  {form.formState.errors.personalDocumentNumber && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.personalDocumentNumber.message}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Etapa 3: Documentos */}
          {currentStep === 3 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Documentos Obrigatórios
                </CardTitle>
                <CardDescription>
                  Envie todos os documentos para análise
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <DocumentUpload
                  title="Frente do Documento"
                  description={`Foto da frente do seu ${form.watch("personalDocumentType") === "rg" ? "RG" : form.watch("personalDocumentType") === "cpf" ? "CPF" : "CNH"} - JPG ou PNG`}
                  value={form.watch("documentsUrls.documentFront")}
                  onUpload={(url) => form.setValue("documentsUrls.documentFront", url)}
                  sellerData={{
                    businessName: form.watch("businessName"),
                    document: form.watch("document"),
                    email: form.watch("email")
                  }}
                  acceptImagesOnly
                />

                <DocumentUpload
                  title="Verso do Documento"
                  description={`Foto do verso do seu ${form.watch("personalDocumentType") === "rg" ? "RG" : form.watch("personalDocumentType") === "cpf" ? "CPF" : "CNH"} - JPG ou PNG`}
                  value={form.watch("documentsUrls.documentBack")}
                  onUpload={(url) => form.setValue("documentsUrls.documentBack", url)}
                  sellerData={{
                    businessName: form.watch("businessName"),
                    document: form.watch("document"),
                    email: form.watch("email")
                  }}
                  acceptImagesOnly
                />

                <DocumentUpload
                  title="Selfie com Documento"
                  description="Foto sua segurando o documento ao lado do rosto - JPG ou PNG"
                  value={form.watch("documentsUrls.selfieWithDocument")}
                  onUpload={(url) => form.setValue("documentsUrls.selfieWithDocument", url)}
                  sellerData={{
                    businessName: form.watch("businessName"),
                    document: form.watch("document"),
                    email: form.watch("email")
                  }}
                  acceptImagesOnly
                />

                <DocumentUpload
                  title="Cartão CNPJ (PDF)"
                  description="Arquivo PDF do cartão CNPJ da empresa - somente PDF"
                  value={form.watch("documentsUrls.cnpjCard")}
                  onUpload={(url) => form.setValue("documentsUrls.cnpjCard", url)}
                  sellerData={{
                    businessName: form.watch("businessName"),
                    document: form.watch("document"),
                    email: form.watch("email")
                  }}
                  acceptPdfOnly
                />
              </CardContent>
            </Card>
          )}

          {/* Etapa 4: Dados do Negócio */}
          {currentStep === 4 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5" />
                  Informações do Negócio
                </CardTitle>
                <CardDescription>
                  Conte-nos sobre seus produtos e negócio
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="businessNiche">Nicho do Negócio *</Label>
                  <Input
                    id="businessNiche"
                    placeholder="Ex: Educao, Sade, Tecnologia, etc."
                    data-testid="input-business-niche"
                    {...form.register("businessNiche")}
                  />
                  {form.formState.errors.businessNiche && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.businessNiche.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="productType">Tipo de Produto *</Label>
                  <Select
                    value={form.watch("productType")}
                    onValueChange={(value) => form.setValue("productType", value as "digital" | "subscription")}
                  >
                    <SelectTrigger data-testid="select-product-type">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="digital">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          Digital (Cursos, E-books, Software)
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.productType && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.productType.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="productsDescription">Descrição dos Produtos *</Label>
                  <Textarea
                    id="productsDescription"
                    placeholder="Descreva detalhadamente os produtos que vocvende..."
                    rows={4}
                    data-testid="textarea-products-description"
                    {...form.register("productsDescription")}
                  />
                  {form.formState.errors.productsDescription && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.productsDescription.message}</p>
                  )}
                </div>

                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="acceptedTerms"
                      checked={form.watch("acceptedTerms")}
                      onCheckedChange={(checked) => form.setValue("acceptedTerms", !!checked)}
                      data-testid="checkbox-accept-terms"
                    />
                    <div className="space-y-1">
                      <Label htmlFor="acceptedTerms" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Aceito os termos de uso e política de privacidade *
                      </Label>
                      <p className="text-xs text-gray-500">
                        Ao marcar esta opo, você concorda com nossos termos e condições
                      </p>
                    </div>
                  </div>
                  {form.formState.errors.acceptedTerms && (
                    <p className="text-sm text-muted-foreground">{form.formState.errors.acceptedTerms.message}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={prevStep}
              disabled={currentStep === 1}
              data-testid="button-prev-step"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Anterior
            </Button>

            {currentStep < totalSteps ? (
              <Button
                type="button"
                onClick={nextStep}
                data-testid="button-next-step"
              >
                Próximo
                <ArrowLeft className="h-4 w-4 ml-2 rotate-180" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="button-submit-seller"
              >
                {isSubmitting ? "Enviando..." : "Enviar Cadastro"}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}