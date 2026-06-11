import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import DocumentUpload from "@/components/seller/document-upload";
import FacialVerification from "@/components/seller/facial-verification";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { formatCPF, formatCNPJ, formatPhone, formatCEP, unformat, validateCPF, validateCNPJ } from "@/lib/input-masks";
import { ArrowLeft, ChevronRight } from "lucide-react";

interface AccountVerificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

const FACIAL_VERIFICATION_ENABLED = true;

export default function AccountVerificationModal({ open, onOpenChange, onComplete }: AccountVerificationModalProps) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingType, setIsFetchingType] = useState(false);
  const [sellerAccountType, setSellerAccountType] = useState<null | "seller" | "affiliate">(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    documentType: "" as "" | "cpf" | "cnpj",
    name: "",
    email: "",
    phone: "",
    birthDate: "",
    personalDocumentType: "rg" as "rg" | "cnh" | "cpf",
    personalDocumentNumber: "",
    businessName: "",
    document: "",
    addressStreet: "",
    addressNumber: "",
    addressComplement: "",
    addressNeighborhood: "",
    addressCity: "",
    addressState: "",
    addressZipCode: "",
    businessNiche: "",
    productType: "",
    productsDescription: "",
    businessWebsite: "",
    cepLoading: false,
    documentFront: "",
    documentBack: "",
    selfieWithDocument: "",
    facialVerification: "",
    cnpjCard: "",
    contratoSocial: "",
  });

  const effectiveType: "seller" | "affiliate" | null = sellerAccountType
    ?? (formData.documentType === "cpf" ? "affiliate" : formData.documentType === "cnpj" ? "seller" : null);
  const isPJ = effectiveType === "seller";
  const isAffiliate = effectiveType === "affiliate";

  const stepsConfig = isAffiliate
    ? { total: 3, labels: ["Dados Pessoais", "Documentos", "Verificação Facial"] }
    : FACIAL_VERIFICATION_ENABLED
    ? { total: 4, labels: ["Dados Pessoais", "Empresa", "Documentos", "Verificação Facial"] }
    : { total: 3, labels: ["Dados Pessoais", "Empresa", "Documentos"] };

  const totalSteps = stepsConfig.total;
  const progress = (step / totalSteps) * 100;

  useEffect(() => {
    if (open) {
      const user = auth.currentUser;
      if (user) {
        setFormData(prev => ({ ...prev, email: user.email || "", name: user.displayName || prev.name }));

        const fetchSellerData = async () => {
          setIsFetchingType(true);
          try {
            const token = await user.getIdToken();
            const response = await fetch(`/api/sellers/${user.uid}`, {
              headers: { "Authorization": `Bearer ${token}` },
            });
            if (response.ok) {
              const seller = await response.json();
              setFormData(prev => ({
                ...prev,
                name: seller.name || prev.name,
                email: seller.email || prev.email,
                phone: seller.phone || prev.phone,
              }));
              const rawType = seller.accountType as string;
              const mapped: "seller" | "affiliate" | null =
                rawType === "affiliate" ? "affiliate" :
                (rawType === "seller" || rawType === "vendedor" || rawType === "creator") ? "seller" :
                null;
              if (mapped) {
                setSellerAccountType(mapped);
                setFormData(prev => ({ ...prev, documentType: mapped === "seller" ? "cnpj" : "cpf" }));
              }
            }
          } catch (err) {
            console.error("Erro ao buscar dados do seller:", err);
          } finally {
            setIsFetchingType(false);
          }
        };
        fetchSellerData();
      }
    } else {
      setStep(1);
      setSellerAccountType(null);
      setIsFetchingType(false);
      setFormData({
        documentType: "" as "" | "cpf" | "cnpj",
        name: "", email: "", phone: "", birthDate: "",
        personalDocumentType: "rg" as "rg" | "cnh" | "cpf",
        personalDocumentNumber: "", businessName: "", document: "",
        addressStreet: "", addressNumber: "", addressComplement: "",
        addressNeighborhood: "", addressCity: "", addressState: "", addressZipCode: "",
        businessNiche: "", productType: "", productsDescription: "", businessWebsite: "",
        cepLoading: false,
        documentFront: "", documentBack: "", selfieWithDocument: "",
        facialVerification: "", cnpjCard: "", contratoSocial: "",
      });
    }
  }, [open]);

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const fetchAddressByCep = async (cep: string) => {
    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length !== 8) return;
    setFormData(prev => ({ ...prev, cepLoading: true }));
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      if (res.ok) {
        const data = await res.json();
        if (!data.erro) {
          setFormData(prev => ({
            ...prev,
            addressStreet: data.logradouro || prev.addressStreet,
            addressNeighborhood: data.bairro || prev.addressNeighborhood,
            addressCity: data.localidade || prev.addressCity,
            addressState: data.uf || prev.addressState,
            cepLoading: false,
          }));
          return;
        }
      }
    } catch (err) {
      console.error("Erro ao buscar CEP:", err);
    }
    setFormData(prev => ({ ...prev, cepLoading: false }));
  };

  const validateStep = (): boolean => {
    if (step === 1) {
      if (!sellerAccountType && !formData.documentType) {
        toast({ title: "Selecione o tipo de cadastro", variant: "destructive" }); return false;
      }
      if (!formData.name.trim()) { toast({ title: "Nome é obrigatório", variant: "destructive" }); return false; }
      if (!formData.phone.trim()) { toast({ title: "Telefone é obrigatório", variant: "destructive" }); return false; }
      if (!formData.birthDate.trim()) { toast({ title: "Data de nascimento é obrigatória", variant: "destructive" }); return false; }
      if (!formData.personalDocumentNumber.trim()) { toast({ title: "Número do documento é obrigatório", variant: "destructive" }); return false; }
      if (isAffiliate) {
        const cpfDigits = formData.document.replace(/\D/g, "");
        if (cpfDigits.length !== 11) { toast({ title: "CPF incompleto", description: "O CPF deve ter 11 dígitos.", variant: "destructive" }); return false; }
        if (!validateCPF(cpfDigits)) { toast({ title: "CPF inválido", description: "Verifique os dígitos e tente novamente.", variant: "destructive" }); return false; }
      }
    }

    if (step === 2) {
      if (isAffiliate) {
        if (!formData.documentFront) { toast({ title: "Frente do documento é obrigatória", variant: "destructive" }); return false; }
        if (!formData.documentBack) { toast({ title: "Verso do documento é obrigatório", variant: "destructive" }); return false; }
        if (!formData.selfieWithDocument) { toast({ title: "Selfie com documento é obrigatória", variant: "destructive" }); return false; }
      } else {
        if (!formData.businessName.trim()) { toast({ title: "Nome do negócio é obrigatório", variant: "destructive" }); return false; }
        if (!formData.document.trim()) { toast({ title: formData.documentType === "cnpj" ? "CNPJ é obrigatório" : "CPF é obrigatório", variant: "destructive" }); return false; }
        const docDigits = formData.document.replace(/\D/g, "");
        if (formData.documentType === "cpf") {
          if (docDigits.length !== 11) { toast({ title: "CPF incompleto", variant: "destructive" }); return false; }
          if (!validateCPF(docDigits)) { toast({ title: "CPF inválido", variant: "destructive" }); return false; }
        }
        if (formData.documentType === "cnpj") {
          if (docDigits.length !== 14) { toast({ title: "CNPJ incompleto", variant: "destructive" }); return false; }
          if (!validateCNPJ(docDigits)) { toast({ title: "CNPJ inválido", variant: "destructive" }); return false; }
        }
        if (!formData.addressStreet.trim() || !formData.addressNumber.trim() || !formData.addressNeighborhood.trim() || !formData.addressCity.trim() || !formData.addressState.trim() || !formData.addressZipCode.trim()) {
          toast({ title: "Preencha o endereço completo", variant: "destructive" }); return false;
        }
      }
    }

    if (step === 3) {
      if (isAffiliate) {
        if (!formData.facialVerification) { toast({ title: "Verificação facial é obrigatória", variant: "destructive" }); return false; }
      } else {
        if (!formData.documentFront) { toast({ title: "Frente do documento é obrigatória", variant: "destructive" }); return false; }
        if (!formData.documentBack) { toast({ title: "Verso do documento é obrigatório", variant: "destructive" }); return false; }
        if (!formData.selfieWithDocument) { toast({ title: "Selfie com documento é obrigatória", variant: "destructive" }); return false; }
        if ((formData.documentType === "cnpj" || isPJ) && !formData.cnpjCard) {
          toast({ title: "Cartão CNPJ é obrigatório", variant: "destructive" }); return false;
        }
        if ((formData.documentType === "cnpj" || isPJ) && !formData.contratoSocial) {
          toast({ title: "Contrato Social é obrigatório", variant: "destructive" }); return false;
        }
      }
    }

    if (step === 4 && FACIAL_VERIFICATION_ENABLED && !isAffiliate) {
      if (!formData.facialVerification) { toast({ title: "Verificação facial é obrigatória", variant: "destructive" }); return false; }
    }

    return true;
  };

  const nextStep = () => { if (validateStep()) setStep(step + 1); };
  const prevStep = () => { if (step > 1) setStep(step - 1); };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setIsSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Usuário não autenticado");
      const token = await user.getIdToken();
      const response = await fetch(`/api/sellers/${user.uid}/verify`, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: unformat(formData.phone),
          birthDate: formData.birthDate,
          documentType: formData.documentType,
          document: unformat(formData.document),
          personalDocumentType: formData.personalDocumentType,
          personalDocumentNumber: formData.personalDocumentNumber,
          companyName: formData.businessName,
          address: {
            street: formData.addressStreet,
            number: formData.addressNumber,
            complement: formData.addressComplement,
            neighborhood: formData.addressNeighborhood,
            city: formData.addressCity,
            state: formData.addressState,
            zipCode: unformat(formData.addressZipCode),
          },
          documentsUrls: {
            documentFront: formData.documentFront,
            documentBack: formData.documentBack,
            selfieWithDocument: formData.selfieWithDocument,
            cnpjCard: (formData.documentType === "cnpj" || isPJ) ? formData.cnpjCard : "",
            contratoSocial: (formData.documentType === "cnpj" || isPJ) ? formData.contratoSocial : "",
            facialVerification: formData.facialVerification,
          },
          profileComplete: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Erro ao verificar conta" }));
        throw new Error(error.message || "Erro ao verificar conta");
      }

      toast({ title: "Verificação enviada!", description: "Seus documentos serão analisados em até 5 horas úteis." });
      onOpenChange(false);
      setStep(1);
      onComplete?.();
    } catch (error: any) {
      toast({ title: "Erro na verificação", description: error.message || "Ocorreu um erro. Tente novamente.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const sellerDataForUpload = { businessName: formData.businessName, document: formData.document, email: formData.email };
  const isLastStep = step === totalSteps;

  /* ─── Input / Label base classes ─────────────────────── */
  const inputCls = "bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 mt-1 focus-visible:ring-blue-500 focus-visible:border-blue-500";
  const inputDisabledCls = "bg-gray-50 border-gray-200 text-gray-400 mt-1";
  const labelCls = "text-gray-700 text-sm font-medium";
  const sectionHeadCls = "text-sm font-semibold text-gray-900";
  const btnPrimary = "bg-gray-900 hover:bg-gray-800 text-white";
  const btnOutline = "border-gray-200 bg-white text-gray-600 hover:bg-gray-50";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border border-gray-200 text-gray-900 max-w-2xl shadow-xl p-0 overflow-hidden max-h-[90vh] flex flex-col">

        {/* ── Cabeçalho ── */}
        <div className="px-7 pt-6 pb-4 border-b border-gray-100 shrink-0">
          <DialogTitle className="text-base font-semibold text-gray-900">Verificação de Conta</DialogTitle>
          <DialogDescription className="text-sm text-gray-500 mt-0.5">
            {isAffiliate ? "Conta Afiliado — CPF" : isPJ ? "Conta Vendedor — CNPJ" : "Verificação de identidade"}
          </DialogDescription>

          {/* Steps numerados — sem ícones */}
          <div className="mt-4 flex items-center gap-0">
            {stepsConfig.labels.map((label, i) => {
              const done = i + 1 < step;
              const active = i + 1 === step;
              return (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
                      done ? "bg-gray-900 text-white" :
                      active ? "bg-gray-900 text-white ring-2 ring-gray-900 ring-offset-2" :
                      "bg-gray-100 text-gray-400"
                    }`}>
                      {done ? "✓" : i + 1}
                    </div>
                    <span className={`text-xs hidden sm:inline ${active ? "font-semibold text-gray-900" : done ? "text-gray-500" : "text-gray-400"}`}>{label}</span>
                  </div>
                  {i < stepsConfig.labels.length - 1 && (
                    <div className={`h-px flex-1 mx-2 ${i + 1 < step ? "bg-gray-900" : "bg-gray-200"}`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 h-1 bg-gradient-to-r from-[#2563eb] to-[#1d4ed8] rounded-full" style={{ width: `${progress}%` }} />
        </div>

        {/* ── Loading tipo de conta ── */}
        {isFetchingType && (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-400 shrink-0">
            <div className="h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Carregando dados da conta...
          </div>
        )}

        {/* ── Conteúdo dos steps (scrollável) ── */}
        <div className="px-7 py-6 overflow-y-auto flex-1">

        {/* ══ STEP 1 — Dados Pessoais ══ */}
        {step === 1 && (
          <div className="space-y-4 pt-1">
            {!sellerAccountType && (
              <div>
                <Label className={`${labelCls} mb-2 block`}>Tipo de Cadastro *</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => updateField("documentType", "cpf")}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      formData.documentType === "cpf"
                        ? "border-gray-900 bg-white"
                        : "border-gray-200 bg-white hover:border-gray-400"
                    }`}
                    data-testid="select-type-cpf"
                  >
                    <div className="text-center">
                      <div className="text-sm font-semibold text-gray-900">Pessoa Física</div>
                      <div className="text-xs text-gray-500 mt-0.5">CPF</div>
                    </div>
                  </div>
                  <div
                    onClick={() => updateField("documentType", "cnpj")}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      formData.documentType === "cnpj"
                        ? "border-gray-900 bg-white"
                        : "border-gray-200 bg-white hover:border-gray-400"
                    }`}
                    data-testid="select-type-cnpj"
                  >
                    <div className="text-center">
                      <div className="text-sm font-semibold text-gray-900">Pessoa Jurídica</div>
                      <div className="text-xs text-gray-500 mt-0.5">CNPJ</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label className={labelCls}>Nome Completo *</Label>
              <Input value={formData.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Seu nome completo" className={inputCls} data-testid="input-verify-name" />
            </div>

            <div>
              <Label className={labelCls}>E-mail</Label>
              <Input value={formData.email} disabled className={inputDisabledCls} data-testid="input-verify-email" />
              <p className="text-xs text-gray-400 mt-1">E-mail da sua conta (não editável)</p>
            </div>

            <div>
              <Label className={labelCls}>Telefone WhatsApp *</Label>
              <Input value={formatPhone(formData.phone)} onChange={(e) => updateField("phone", e.target.value)} placeholder="(00) 00000-0000" className={inputCls} data-testid="input-verify-phone" />
            </div>

            <div>
              <Label className={labelCls}>Data de Nascimento *</Label>
              <Input type="date" value={formData.birthDate} onChange={(e) => updateField("birthDate", e.target.value)} className={inputCls} data-testid="input-verify-birthdate" />
            </div>

            <div>
              <Label className={labelCls}>Tipo de Documento Pessoal *</Label>
              <Select value={formData.personalDocumentType} onValueChange={(v) => updateField("personalDocumentType", v)}>
                <SelectTrigger className={`${inputCls} w-full`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200 text-gray-900">
                  <SelectItem value="rg">RG</SelectItem>
                  <SelectItem value="cnh">CNH</SelectItem>
                  <SelectItem value="cpf">CPF</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className={labelCls}>Número do Documento *</Label>
              <Input value={formData.personalDocumentNumber} onChange={(e) => updateField("personalDocumentNumber", e.target.value)} placeholder="Número do RG/CNH/CPF" className={inputCls} data-testid="input-verify-doc-number" />
            </div>

            {isAffiliate && (
              <div>
                <Label className={labelCls}>CPF *</Label>
                <Input
                  value={formatCPF(formData.document)}
                  onChange={(e) => updateField("document", unformat(e.target.value))}
                  placeholder="000.000.000-00"
                  className={inputCls}
                  data-testid="input-verify-cpf"
                />
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button onClick={nextStep} className={btnPrimary}>
                Continuar <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ══ STEP 2 — Documentos (Afiliado) ══ */}
        {step === 2 && isAffiliate && (
          <div className="space-y-4 pt-1">
            <p className={sectionHeadCls}>Documentos de Identidade</p>

            <DocumentUpload title="Frente do Documento" description="Foto da frente do RG ou CNH — JPG ou PNG" value={formData.documentFront} onUpload={(url: string) => updateField("documentFront", url)} sellerData={sellerDataForUpload} acceptImagesOnly />
            <DocumentUpload title="Verso do Documento" description="Foto do verso do RG ou CNH — JPG ou PNG" value={formData.documentBack} onUpload={(url: string) => updateField("documentBack", url)} sellerData={sellerDataForUpload} acceptImagesOnly />
            <DocumentUpload title="Selfie com Documento" description="Foto sua segurando o documento ao lado do rosto — JPG ou PNG" value={formData.selfieWithDocument} onUpload={(url: string) => updateField("selfieWithDocument", url)} sellerData={sellerDataForUpload} acceptImagesOnly />

            <div className="flex gap-2 justify-between pt-1">
              <Button variant="outline" onClick={prevStep} className={btnOutline}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
              <Button onClick={nextStep} className={btnPrimary}>Continuar <ChevronRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* ══ STEP 2 — Empresa + Endereço (PJ) ══ */}
        {step === 2 && !isAffiliate && (
          <div className="space-y-4 pt-1">
            <div>
              <Label className={labelCls}>Nome do Negócio / Razão Social *</Label>
              <Input value={formData.businessName} onChange={(e) => updateField("businessName", e.target.value)} placeholder="Nome da sua empresa" className={inputCls} data-testid="input-verify-business-name" />
            </div>

            <div>
              <Label className={labelCls}>{(formData.documentType === "cnpj" || isPJ) ? "CNPJ *" : "CPF *"}</Label>
              <Input
                value={(formData.documentType === "cnpj" || isPJ) ? formatCNPJ(formData.document) : formatCPF(formData.document)}
                onChange={(e) => updateField("document", unformat(e.target.value))}
                placeholder={(formData.documentType === "cnpj" || isPJ) ? "00.000.000/0001-00" : "000.000.000-00"}
                className={inputCls}
                data-testid="input-verify-document"
              />
            </div>

            <div className="pt-1 border-t border-gray-100">
              <p className={`${sectionHeadCls} mb-3`}>Endereço da Empresa</p>
            </div>

            <div>
              <Label className={labelCls}>CEP *</Label>
              <div className="relative">
                <Input
                  value={formatCEP(formData.addressZipCode)}
                  onChange={(e) => {
                    const raw = unformat(e.target.value);
                    updateField("addressZipCode", raw);
                    if (raw.length === 8) fetchAddressByCep(raw);
                  }}
                  placeholder="00000-000"
                  className={inputCls}
                  data-testid="input-verify-cep"
                />
                {formData.cepLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className={labelCls}>Rua *</Label>
                <Input value={formData.addressStreet} onChange={(e) => updateField("addressStreet", e.target.value)} placeholder="Rua das Flores" className={inputCls} />
              </div>
              <div>
                <Label className={labelCls}>Nº *</Label>
                <Input value={formData.addressNumber} onChange={(e) => updateField("addressNumber", e.target.value)} placeholder="123" className={inputCls} />
              </div>
            </div>

            <div>
              <Label className={labelCls}>Complemento</Label>
              <Input value={formData.addressComplement} onChange={(e) => updateField("addressComplement", e.target.value)} placeholder="Sala 101" className={inputCls} />
            </div>

            <div>
              <Label className={labelCls}>Bairro *</Label>
              <Input value={formData.addressNeighborhood} onChange={(e) => updateField("addressNeighborhood", e.target.value)} placeholder="Centro" className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className={labelCls}>Cidade *</Label>
                <Input value={formData.addressCity} onChange={(e) => updateField("addressCity", e.target.value)} placeholder="São Paulo" className={inputCls} />
              </div>
              <div>
                <Label className={labelCls}>Estado *</Label>
                <Input value={formData.addressState} onChange={(e) => updateField("addressState", e.target.value)} placeholder="SP" maxLength={2} className={inputCls} />
              </div>
            </div>

            <div className="flex gap-2 justify-between pt-1">
              <Button variant="outline" onClick={prevStep} className={btnOutline}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
              <Button onClick={nextStep} className={btnPrimary}>Continuar <ChevronRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* ══ STEP 3 — Verificação Facial (Afiliado) ══ */}
        {step === 3 && isAffiliate && (
          <div className="space-y-4 pt-1">
            <p className={sectionHeadCls}>Verificação Facial em Vídeo</p>
            <FacialVerification
              value={formData.facialVerification}
              onVerification={(url: string) => updateField("facialVerification", url)}
              sellerData={{ name: formData.name, document: formData.document, email: formData.email }}
            />
            <div className="flex gap-2 justify-between pt-1">
              <Button variant="outline" onClick={prevStep} className={btnOutline}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting} className={btnPrimary} data-testid="button-submit-verification">
                {isSubmitting ? "Enviando..." : "Enviar Verificação"}
              </Button>
            </div>
          </div>
        )}

        {/* ══ STEP 3 — Documentos (PJ) ══ */}
        {step === 3 && !isAffiliate && (
          <div className="space-y-4 pt-1">
            <p className={sectionHeadCls}>Documentos Obrigatórios</p>

            <DocumentUpload title="Frente do Documento (RG/CNH)" description="Foto da frente do documento pessoal — JPG ou PNG" value={formData.documentFront} onUpload={(url: string) => updateField("documentFront", url)} sellerData={sellerDataForUpload} acceptImagesOnly />
            <DocumentUpload title="Verso do Documento (RG/CNH)" description="Foto do verso do documento pessoal — JPG ou PNG" value={formData.documentBack} onUpload={(url: string) => updateField("documentBack", url)} sellerData={sellerDataForUpload} acceptImagesOnly />
            <DocumentUpload title="Selfie com Documento" description="Foto sua segurando o documento ao lado do rosto — JPG ou PNG" value={formData.selfieWithDocument} onUpload={(url: string) => updateField("selfieWithDocument", url)} sellerData={sellerDataForUpload} acceptImagesOnly />

            {(formData.documentType === "cnpj" || isPJ) && (
              <DocumentUpload title="Cartão CNPJ (PDF)" description="Cartão CNPJ da empresa em formato PDF" value={formData.cnpjCard} onUpload={(url: string) => updateField("cnpjCard", url)} sellerData={sellerDataForUpload} acceptPdfOnly />
            )}

            {(formData.documentType === "cnpj" || isPJ) && (
              <DocumentUpload title="Contrato Social (PDF)" description="Contrato Social ou Requerimento de Empresário em PDF" value={formData.contratoSocial} onUpload={(url: string) => updateField("contratoSocial", url)} sellerData={sellerDataForUpload} acceptPdfOnly />
            )}

            <div className="flex gap-2 justify-between pt-1">
              <Button variant="outline" onClick={prevStep} className={btnOutline}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
              {FACIAL_VERIFICATION_ENABLED ? (
                <Button onClick={nextStep} className={btnPrimary}>Continuar <ChevronRight className="h-4 w-4 ml-1" /></Button>
              ) : (
                <Button onClick={handleSubmit} disabled={isSubmitting} className={btnPrimary} data-testid="button-submit-verification">
                  {isSubmitting ? "Enviando..." : "Enviar Verificação"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ══ STEP 4 — Verificação Facial (PJ) ══ */}
        {step === 4 && FACIAL_VERIFICATION_ENABLED && !isAffiliate && (
          <div className="space-y-4 pt-1">
            <p className={sectionHeadCls}>Verificação Facial em Vídeo</p>
            <FacialVerification
              value={formData.facialVerification}
              onVerification={(url: string) => updateField("facialVerification", url)}
              sellerData={{ name: formData.name, document: formData.document, email: formData.email }}
            />
            <div className="flex gap-2 justify-between pt-1">
              <Button variant="outline" onClick={prevStep} className={btnOutline}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting} className={btnPrimary} data-testid="button-submit-verification">
                {isSubmitting ? "Enviando..." : "Enviar Verificação"}
              </Button>
            </div>
          </div>
        )}
        </div>{/* fim scroll */}
      </DialogContent>
    </Dialog>
  );
}
