import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { sellerRegisterFormSchema, type SellerRegisterForm } from "@shared/schema";
import { createSeller } from "@/lib/firestore";
import { getDeviceFingerprint } from "@/lib/device-fingerprint";
// IMPORTAÇES ESTTICAS PARA COMPATIBILIDADE CROSS-BROWSER
import { signInWithEmailAndPassword, type Auth } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, User, Building, Sparkles, CheckCircle, ArrowRight, ArrowLeft, ChevronRight, ChevronLeft } from "lucide-react";

import DocumentUpload from "@/components/seller/document-upload";

export default function SellerRegister() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const { toast } = useToast();

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
      address: {
        street: "",
        number: "",
        complement: "",
        neighborhood: "",
        city: "",
        state: "",
        zipCode: "",
      },
      personalDocumentType: "rg",
      personalDocumentNumber: "",
      businessNiche: "",
      productType: "digital",
      productsDescription: "",
      acceptedTerms: false,
      documentsUrls: {
        documentFront: "",
        documentBack: "", 
        selfieWithDocument: "",
        cnpjCard: "",
      },
    },
  });

  // Validar primeira etapa antes de avanar
  const validateStep1 = () => {
    const step1Fields = [
      'name', 'email', 'password', 'confirmPassword', 
      'phone', 'birthDate', 'personalDocumentType', 'personalDocumentNumber'
    ];
    
    const hasErrors = step1Fields.some(field => {
      const value = form.getValues(field as keyof SellerRegisterForm);
      return !value || (typeof value === 'string' && value.trim() === '');
    });
    
    if (hasErrors) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha todos os campos da primeira etapa.",
        variant: "destructive"
      });
      return false;
    }
    
    const emailErrors = form.formState.errors.email || form.formState.errors.confirmEmail || form.formState.errors.confirmPassword;
    if (emailErrors) {
      toast({
        title: "Erro nos dados",
        description: "Verifique os campos com erro na primeira etapa.",
        variant: "destructive"
      });
      return false;
    }
    
    return true;
  };

  const nextStep = async () => {
    if (currentStep === 1) {
      // VALIDAÇÃO ROBUSTA CROSS-BROWSER - fora sync de autofill
      const isValid = await form.trigger([
        'documentType', 'name', 'email', 'confirmEmail', 'password', 'confirmPassword',
        'phone', 'birthDate', 'personalDocumentType', 'personalDocumentNumber'
      ]);
      
      if (!isValid) {
        toast({
          title: "Campos obrigatórios",
          description: "Preencha todos os campos corretamente para continuar.",
          variant: "destructive"
        });
        return;
      }
      
      setCurrentStep(2);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const onSubmit = async (data: SellerRegisterForm) => {
    setIsSubmitting(true);

    try {
      // VALIDAÇÃO CONDICIONAL: Cartão CNPJ obrigatório apenas para CNPJ
      if (data.documentType === "cnpj" && !data.documentsUrls?.cnpjCard) {
        toast({
          title: "Documento obrigatório",
          description: "O Cartão CNPJ é obrigatório para cadastro com CNPJ.",
          variant: "destructive"
        });
        setIsSubmitting(false);
        return;
      }

      // COLETAR DADOS TCNICOS DO DISPOSITIVO (se aceitar termos)
      let deviceFingerprint = null;
      if (data.acceptedTerms) {
        try {
          deviceFingerprint = await getDeviceFingerprint(true);
          console.log('Device fingerprint coletado:', deviceFingerprint);
        } catch (error) {
          console.warn('Erro ao coletar fingerprint:', error);
          // Continua mesmo se falhar a coleta
        }
      }
      
      // NORMALIZAR DADOS PARA COMPATIBILIDADE CROSS-BROWSER
      const payload = {
        ...data,
        // Remove mscaras para envio consistente
        document: data.document.replace(/\D/g, ''),
        personalDocumentNumber: data.personalDocumentNumber.replace(/\W/g, ''),
        phone: data.phone.replace(/\D/g, ''),
        // Manter formato de data DD/MM/YYYY que o servidor jaceita
        birthDate: data.birthDate,
        // Normalizar endereço removendo formatao
        address: data.address ? {
          ...data.address,
          zipCode: data.address.zipCode.replace(/\D/g, ''), // Remove hfen do CEP
          state: data.address.state.toUpperCase(), // Normalizar estado para maisculo
        } : undefined,
        // Adicionar fingerprint do dispositivo
        deviceFingerprint
      };
      
      // DEBUG: LOG DETALHADO DO PAYLOAD
      console.log('DEBUG CADASTRO - PAYLOAD ENVIADO:', {
        deviceFingerprintPresent: !!payload.deviceFingerprint,
        consentGiven: payload.deviceFingerprint?.consentGiven,
        acceptedTerms: payload.acceptedTerms,
        fingerprintKeys: payload.deviceFingerprint ? Object.keys(payload.deviceFingerprint).slice(0, 15) : [],
        payloadSize: JSON.stringify(payload).length
      });
      
      // 1CRIAR SELLER VIA API DO SERVIDOR
      console.log('Enviando requisio para /api/sellers/register...');
      console.log('Payload size:', JSON.stringify(payload).length, 'bytes');
      
      const response = await fetch('/api/sellers/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      console.log('Resposta recebida:',{
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        ok: response.ok
      });

      if (!response.ok) {
        // VERIFICAR SE A RESPOSTA JSON ANTES DE TENTAR PARSEAR
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const error = await response.json();
          throw new Error(error.message || 'Erro ao criar seller');
        } else {
          // Se no for JSON, pegar o texto da resposta
          const errorText = await response.text();
          console.error('Resposta no-JSON do servidor:', errorText.substring(0, 200));
          throw new Error(`Erro no servidor (${response.status}): Resposta inválida`);
        }
      }

      const result = await response.json();
      console.log('Seller criado com sucesso:', result);

      setSubmitted(true);
      
      // FACEBOOK PIXEL - EVENTO CADASTRO VENDEDOR APENAS
      if (typeof window !== 'undefined' && (window as any).fbq) {
        (window as any).fbq('track', 'Lead', {
          content_name: 'Cadastro Vendedor',
          content_category: 'seller_registration',
          value: 1,
          currency: 'BRL'
        });
        console.log('Facebook Pixel: Evento Lead enviado para cadastro de vendedor');
      }
      
      toast({
        title: "Conta criada com sucesso!",
        description: "Sua conta foi criada e estem análise. Redirecionando para o dashboard...",
      });
      
      // 2FAZER LOGIN AUTOMTICO APS CRIAÇÃO (ESTTICO PARA CROSS-BROWSER)
      setTimeout(async () => {
        try {
          // IMPORTAÇES ESTTICAS - compatvel com todos os navegadores
          if (auth) {
            await signInWithEmailAndPassword(auth as Auth, data.email, data.password);
            console.log("Login automático realizado com sucesso!");
            
            // Redirecionar para dashboard
            window.location.href = '/dashboard';
          } else {
            throw new Error('Firebase no inicializado');
          }
        } catch (loginError: any) {
          console.error("Erro no login automático:", loginError);
          // FALLBACK DIRETO PARA LOGIN EM CASO DE ERRO
          toast({
            title: "Cadastro realizado com sucesso!",
            description: "Redirecionando para login...",
          });
          // Redirect imediato para evitar confuso em navegadores antigos
          window.location.href = '/auth/login';
        }
      }, 2000);
      
    } catch (error: any) {
      console.error("ERRO DETALHADO:", error);
      console.error("ERRO MESSAGE:", error?.message);
      console.error("ERRO RESPONSE:", error?.response);
      
      let errorMessage = "Ocorreu um erro ao enviar sua solicitação. Tente novamente.";
      
      // TRATAMENTO ESPECFICO DE ERROS - TODAS AS SITUAÇES
      if (error?.message?.includes('email-already-in-use') || error?.message?.includes('jestá cadastrado')) {
        errorMessage = "EMAIL JEXISTE: Este email jestá cadastrado. Use outro email ou faa login.";
      } else if (error?.message?.includes('CPF/CNPJ jcadastrado') || error?.message?.includes('documento já existe')) {
        errorMessage = "CPF/CNPJ JEXISTE: Este documento jestá cadastrado. Use outro documento.";
      } else if (error?.message?.includes('weak-password')) {
        errorMessage = "SENHA FRACA: Use pelo menos 6 caracteres com letras e nmeros.";
      } else if (error?.message?.includes('invalid-email')) {
        errorMessage = "EMAIL INVLIDO: Verifique o formato (ex: nome@email.com).";
      } else if (error?.message?.includes('network')) {
        errorMessage = "SEM CONEXÃO: Verifique sua internet e tente novamente.";
      } else if (error?.message?.includes('obrigatório') || error?.message?.includes('required')) {
        errorMessage = "CAMPOS OBRIGATRIOS: Preencha todos os campos marcados com *.";
      } else if (error?.message) {
        // Mostrar erro especfico se disponível
        errorMessage = `ERRO: ${error.message}`;
      }
      
      toast({
        title: "Erro no cadastro",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDocument = (value: string, type: "cpf" | "cnpj" | "rg") => {
    const cleanValue = value.replace(/\D/g, "");
    if (type === "cpf") {
      return cleanValue
        .slice(0, 11)
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})/, "$1-$2");
    } else if (type === "rg") {
      return cleanValue
        .slice(0, 9)
        .replace(/(\d{2})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1})/, "$1-$2");
    } else {
      return cleanValue
        .slice(0, 14)
        .replace(/(\d{2})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1/$2")
        .replace(/(\d{4})(\d{1,2})/, "$1-$2");
    }
  };

  const formatPhone = (value: string) => {
    const cleanValue = value.replace(/\D/g, "");
    return cleanValue
      .slice(0, 11)
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d)/, "$1-$2");
  };

  const formatDate = (value: string) => {
    const cleanValue = value.replace(/\D/g, "");
    return cleanValue
      .slice(0, 8)
      .replace(/(\d{2})(\d)/, "$1/$2")
      .replace(/(\d{2})(\d)/, "$1/$2");
  };

  const handleDocumentChange = (value: string) => {
    const docType = form.watch("documentType");
    const formatted = formatDocument(value, docType === "cpf" ? "cpf" : "cnpj");
    form.setValue("document", formatted);
  };

  const handlePersonalDocumentChange = (value: string) => {
    const docType = form.watch("personalDocumentType");
    let formatted = value;
    
    if (docType === "cpf") {
      formatted = formatDocument(value, "cpf");
    } else if (docType === "rg") {
      formatted = formatDocument(value, "rg");
    } else {
      // CNH - apenas nmeros e letras
      formatted = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 11);
    }
    
    form.setValue("personalDocumentNumber", formatted);
  };

  const handlePhoneChange = (value: string) => {
    const formatted = formatPhone(value);
    form.setValue("phone", formatted);
  };

  const handleDateChange = (value: string) => {
    const formatted = formatDate(value);
    form.setValue("birthDate", formatted);
  };

  const formatCEP = (value: string) => {
    return value
      .replace(/\D/g, "")
      .replace(/(\d{5})(\d)/, "$1-$2")
      .substring(0, 9);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-blue-50 to-cyan-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-emerald-200 shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-700" />
            </div>
            <CardTitle className="text-muted-foreground text-2xl">Conta Criada!</CardTitle>
            <CardDescription className="text-lg">
              Sua conta de vendedor foi criada com sucesso.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-200">
              <p className="text-sm text-muted-foreground font-medium">
                Conta criada e estem análise
              </p>
              <p className="text-sm text-muted-foreground">
                Fazendo login automático...
              </p>
              <p className="text-sm text-muted-foreground font-medium">
                Redirecionando para seu dashboard...
              </p>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg border border-yellow-200">
              <p className="text-xs text-muted-foreground">
                <strong>Nota:</strong> Algumas funcionalidades ficam bloqueadas até aprovação (checkout, membros)
              </p>
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              Dúvidas: volatuspay@gmail.com
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-blue-50 to-cyan-50">
      {/* HEADER */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-lg">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">VolatusPay</h1>
                <p className="text-sm text-gray-500">Cadastro de Vendedor</p>
              </div>
            </div>
            
            {/* INDICADOR DE ETAPAS */}
            <div className="hidden md:flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep >= 1 ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  1
                </div>
                <span className={`text-sm ${currentStep >= 1 ? 'text-emerald-700 font-medium' : 'text-gray-500'}`}>
                  Dados Pessoais
                </span>
              </div>
              
              <ChevronRight className="w-4 h-4 text-gray-400" />
              
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep >= 2 ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  2
                </div>
                <span className={`text-sm ${currentStep >= 2 ? 'text-emerald-700 font-medium' : 'text-gray-500'}`}>
                  Dados Empresariais
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CONTEDO PRINCIPAL */}
      <div className="max-w-4xl mx-auto p-4 py-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-emerald-700 bg-clip-text text-transparent mb-2">
            {currentStep === 1 ? "Dados Pessoais" : "Dados Empresariais"}
          </h2>
          <p className="text-gray-600">
            {currentStep === 1 
              ? "Preencha suas informações pessoais"
              : "Informações da sua empresa e documentação"
            }
          </p>
        </div>

        <Form {...form}>
          <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            
            {/* SLIDE 1: DADOS PESSOAIS */}
            {currentStep === 1 && (
              <Card className="border-emerald-200 shadow-lg animate-in slide-in-from-left-5 duration-300">
                <CardHeader className="bg-gradient-to-r from-emerald-50 to-blue-50">
                  <CardTitle className="flex items-center gap-2 text-muted-foreground">
                    <User className="w-5 h-5" />
                    Dados Pessoais
                  </CardTitle>
                  <CardDescription>
                    Informações pessoais para sua conta de vendedor
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 p-6">
                  
                  {/* TIPO DE CADASTRO: CPF OU CNPJ */}
                  <div className="bg-gradient-to-r from-emerald-50 to-blue-50 p-4 rounded-lg border border-emerald-200">
                    <FormField
                      control={form.control}
                      name="documentType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">Tipo de Cadastro *</FormLabel>
                          <p className="text-xs text-gray-500 mb-3">
                            Escolha como deseja se cadastrar como vendedor
                          </p>
                          <div className="grid grid-cols-2 gap-4">
                            <div
                              onClick={() => field.onChange("cpf")}
                              className={`cursor-pointer p-4 rounded-lg border-2 transition-all ${
                                field.value === "cpf"
                                  ? "border-emerald-500 bg-emerald-50 shadow-md"
                                  : "border-gray-200 bg-white hover:border-emerald-300"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <User className={`w-6 h-6 ${field.value === "cpf" ? "text-emerald-600" : "text-gray-400"}`} />
                                <div>
                                  <p className={`font-semibold ${field.value === "cpf" ? "text-emerald-700" : "text-gray-700"}`}>
                                    Pessoa Física
                                  </p>
                                  <p className="text-xs text-gray-500">Cadastro com CPF</p>
                                </div>
                              </div>
                            </div>
                            <div
                              onClick={() => field.onChange("cnpj")}
                              className={`cursor-pointer p-4 rounded-lg border-2 transition-all ${
                                field.value === "cnpj"
                                  ? "border-emerald-500 bg-emerald-50 shadow-md"
                                  : "border-gray-200 bg-white hover:border-emerald-300"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <Building className={`w-6 h-6 ${field.value === "cnpj" ? "text-emerald-600" : "text-gray-400"}`} />
                                <div>
                                  <p className={`font-semibold ${field.value === "cnpj" ? "text-emerald-700" : "text-gray-700"}`}>
                                    Pessoa Jurídica
                                  </p>
                                  <p className="text-xs text-gray-500">Cadastro com CNPJ</p>
                                </div>
                              </div>
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* NOME COMPLETO */}
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold text-gray-700">Nome Completo *</FormLabel>
                        <FormControl>
                          <Input placeholder="Seu nome completo" {...field} data-testid="input-name" maxLength={200} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* EMAIL E CONFIRMAÇÃO */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">Email *</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="seu@email.com" {...field} data-testid="input-email" maxLength={200} />
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
                          <FormLabel className="text-sm font-semibold text-gray-700">Confirmar Email *</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="seu@email.com" {...field} data-testid="input-confirm-email" maxLength={200} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* SENHA E CONFIRMAÇÃO */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">Senha *</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="" {...field} data-testid="input-password" maxLength={200} />
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
                          <FormLabel className="text-sm font-semibold text-gray-700">Confirmar Senha *</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="" {...field} data-testid="input-confirm-password" maxLength={200} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* TELEFONE E DATA */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">Telefone/WhatsApp *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="(11) 99999-9999"
                              {...field}
                              onChange={(e) => handlePhoneChange(e.target.value)}
                              data-testid="input-phone"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="birthDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">Data de Nascimento *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="DD/MM/AAAA"
                              {...field}
                              onChange={(e) => handleDateChange(e.target.value)}
                              data-testid="input-birth-date"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* DOCUMENTO PESSOAL */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="personalDocumentType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">Tipo de Documento *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-personal-document-type">
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="rg">RG</SelectItem>
                              <SelectItem value="cpf">CPF</SelectItem>
                              <SelectItem value="cnh">CNH</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="personalDocumentNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">Nmero do Documento *</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder={
                                form.watch("personalDocumentType") === "cpf" ? "123.456.789-00" :
                                form.watch("personalDocumentType") === "rg" ? "12.345.678-9" :
                                "12345678900" // CNH
                              }
                              {...field} 
                              onChange={(e) => handlePersonalDocumentChange(e.target.value)}
                              data-testid="input-personal-document-number" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* BOTÃO PRÓXIMO */}
                  <div className="flex justify-end pt-4">
                    <Button
                      type="button"
                      onClick={nextStep}
                      className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-muted hover:to-muted text-white font-semibold shadow-lg hover:shadow-xl transition-all"
                    >
                      Próxima Etapa
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>


                </CardContent>
              </Card>
            )}

            {/* SLIDE 2: DADOS EMPRESARIAIS */}
            {currentStep === 2 && (
              <Card className="border-blue-200 shadow-lg animate-in slide-in-from-right-5 duration-300">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50">
                  <CardTitle className="flex items-center gap-2 text-muted-foreground">
                    <Building className="w-5 h-5" />
                    Dados Empresariais
                  </CardTitle>
                  <CardDescription>
                    Informações do seu negócio e documentação
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 p-6">

                  {/* NOME DO NEGCIO */}
                  <FormField
                    control={form.control}
                    name="businessName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold text-gray-700">Nome do Negócio *</FormLabel>
                        <FormControl>
                          <Input placeholder="Minha Empresa Ltda" {...field} data-testid="input-business-name" maxLength={200} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* CPF OU CNPJ - CONDICIONAL */}
                  {form.watch("documentType") === "cnpj" && (
                    <FormField
                      control={form.control}
                      name="document"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">CNPJ da Empresa *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="00.000.000/0000-00"
                              {...field}
                              onChange={(e) => handleDocumentChange(e.target.value)}
                              data-testid="input-document"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {form.watch("documentType") === "cpf" && (
                    <FormField
                      control={form.control}
                      name="document"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-gray-700">CPF do Responsável *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="000.000.000-00"
                              {...field}
                              onChange={(e) => handleDocumentChange(e.target.value)}
                              data-testid="input-document"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* SEÇÃO DE ENDEREÇO */}
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
                      <Building className="w-4 h-4 text-gray-600" />
                      Endereço da Empresa
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* RUA */}
                      <FormField
                        control={form.control}
                        name="address.street"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">Rua *</FormLabel>
                            <FormControl>
                              <Input placeholder="Rua das Flores" {...field} data-testid="input-address-street" maxLength={200} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* NMERO */}
                      <FormField
                        control={form.control}
                        name="address.number"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">Nmero *</FormLabel>
                            <FormControl>
                              <Input placeholder="123" {...field} data-testid="input-address-number" maxLength={200} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* COMPLEMENTO */}
                      <FormField
                        control={form.control}
                        name="address.complement"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">Complemento</FormLabel>
                            <FormControl>
                              <Input placeholder="Sala 101, Andar 2" {...field} data-testid="input-address-complement" maxLength={200} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* BAIRRO */}
                      <FormField
                        control={form.control}
                        name="address.neighborhood"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">Bairro *</FormLabel>
                            <FormControl>
                              <Input placeholder="Centro" {...field} data-testid="input-address-neighborhood" maxLength={200} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* CIDADE */}
                      <FormField
                        control={form.control}
                        name="address.city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">Cidade *</FormLabel>
                            <FormControl>
                              <Input placeholder="São Paulo" {...field} data-testid="input-address-city" maxLength={200} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* ESTADO */}
                      <FormField
                        control={form.control}
                        name="address.state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">Estado *</FormLabel>
                            <FormControl>
                              <Input placeholder="SP" maxLength={2} {...field} data-testid="input-address-state" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* CEP */}
                      <FormField
                        control={form.control}
                        name="address.zipCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">CEP *</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="00000-000" 
                                value={field.value}
                                onChange={(e) => {
                                  const formatted = formatCEP(e.target.value);
                                  field.onChange(formatted);
                                }}
                                data-testid="input-address-zipcode" 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* NICHO DO NEGCIO */}
                  <FormField
                    control={form.control}
                    name="businessNiche"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold text-gray-700">Nicho do Negócio *</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Cursos online, E-books, Consultoria" {...field} data-testid="input-business-niche" maxLength={200} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* TIPO DE PRODUTO */}
                  <FormField
                    control={form.control}
                    name="productType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold text-gray-700">Tipo de Produto *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-product-type">
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="digital">Produtos Digitais</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* DESCRIÇÃO DOS PRODUTOS */}
                  <FormField
                    control={form.control}
                    name="productsDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold text-gray-700">Descrição dos Produtos *</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Descreva os produtos que vocpretende vender..."
                            className="min-h-[100px]"
                            {...field}
                            data-testid="textarea-products-description"
                            maxLength={200}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* SEÇÃO DE DOCUMENTOS - ATIVO COM PLANO PAGO! */}
                  <div className="border-t pt-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                      <Upload className="w-4 h-4" />
                      Documentos (OBRIGATRIOS)
                    </h3>
                    
                    <Alert className="mb-4 border-emerald-200 bg-emerald-50">
                      <FileText className="h-4 w-4 text-emerald-700" />
                      <AlertDescription className="text-muted-foreground">
                        <strong> Upload de documentos ATIVO!</strong> Anexe fotos reais dos documentos para validao da conta.
                      </AlertDescription>
                    </Alert>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* CARD 1: FRENTE DO DOCUMENTO */}
                      <DocumentUpload
                        title="Frente do Documento"
                        description={`Frente do ${form.watch("personalDocumentType")?.toUpperCase()} - JPG ou PNG`}
                        value={form.watch("documentsUrls.documentFront") || ""}
                        onUpload={(url) => form.setValue("documentsUrls.documentFront", url)}
                        sellerData={{
                          businessName: form.watch('businessName'),
                          document: form.watch('document'),
                          email: form.watch('email')
                        }}
                        acceptImagesOnly
                      />

                      {/* CARD 2: VERSO DO DOCUMENTO */}
                      <DocumentUpload
                        title="Verso do Documento"
                        description={`Verso do ${form.watch("personalDocumentType")?.toUpperCase()} - JPG ou PNG`}
                        value={form.watch("documentsUrls.documentBack") || ""}
                        onUpload={(url) => form.setValue("documentsUrls.documentBack", url)}
                        sellerData={{
                          businessName: form.watch('businessName'),
                          document: form.watch('document'),
                          email: form.watch('email')
                        }}
                        acceptImagesOnly
                      />

                      {/* CARD 3: SELFIE COM DOCUMENTO */}
                      <DocumentUpload
                        title="Selfie com Documento"
                        description="Foto sua segurando o documento ao lado do rosto - JPG ou PNG"
                        value={form.watch("documentsUrls.selfieWithDocument") || ""}
                        onUpload={(url) => form.setValue("documentsUrls.selfieWithDocument", url)}
                        sellerData={{
                          businessName: form.watch('businessName'),
                          document: form.watch('document'),
                          email: form.watch('email')
                        }}
                        acceptImagesOnly
                      />

                      {/* CARD 4: CARTÃO CNPJ - APENAS PARA CNPJ */}
                      {form.watch("documentType") === "cnpj" && (
                        <DocumentUpload
                          title="Cartão CNPJ (PDF)"
                          description="Cartão CNPJ da empresa - somente PDF"
                          value={form.watch("documentsUrls.cnpjCard") || ""}
                          onUpload={(url) => form.setValue("documentsUrls.cnpjCard", url)}
                          sellerData={{
                            businessName: form.watch('businessName'),
                            document: form.watch('document'),
                            email: form.watch('email')
                          }}
                          acceptPdfOnly
                        />
                      )}
                    </div>
                  </div>


                  {/* ACEITAR TERMOS */}
                  <div className="border-t pt-6">
                    <FormField
                      control={form.control}
                      name="acceptedTerms"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-accept-terms"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="text-sm font-medium">
                              Aceito os termos de uso, política de privacidade e coleta de dados técnicos *
                            </FormLabel>
                            <p className="text-xs text-gray-500">
                              Ao aceitar, você concorda com nossos <a href="/legal/terms" target="_blank" className="text-emerald-600 hover:underline">termos e condições</a>, <a href="/legal/privacy" target="_blank" className="text-emerald-600 hover:underline">política de privacidade</a> e autoriza a <a href="/legal/dados-tecnicos" target="_blank" className="text-emerald-600 hover:underline">coleta de dados técnicos</a> para prevenção de fraudes e segurança da plataforma.
                            </p>
                            <FormMessage />
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* BOTES DE NAVEGAÇÃO */}
                  <div className="flex justify-between pt-4">
                    <Button
                      type="button"
                      onClick={prevStep}
                      variant="outline"
                      className="px-8 py-3 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      <ArrowLeft className="w-5 h-5 mr-2" />
                      Voltar
                    </Button>

                    <Button
                      type="submit"
                      size="lg"
                      disabled={isSubmitting}
                      className="px-12 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-muted hover:to-muted text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all"
                      data-testid="button-submit"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                          Enviando...
                        </>
                      ) : (
                        <>
                          Solicitar Aprovação
                          <ArrowRight className="w-5 h-5 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>

                </CardContent>
              </Card>
            )}

          </form>
        </Form>
      </div>
    </div>
  );
}