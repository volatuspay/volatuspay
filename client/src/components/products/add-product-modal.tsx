import { useState } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Book, ExternalLink, RefreshCw, Check } from "lucide-react";
import { createProduct } from "@/lib/firestore";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { InsertProduct } from "@shared/schema";

type ProductType = "digital" | "subscription" | null;

interface AddProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddProductModal({ open, onOpenChange }: AddProductModalProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [productType, setProductType] = useState<ProductType>(null);
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [salesPageUrl, setSalesPageUrl] = useState("");
  const [language, setLanguage] = useState("portuguese");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const productTypes = [
    {
      id: "digital",
      title: "Digitais",
      description: "E-books, cursos, serviços digitais e mais",
      icon: Book,
      accent: "#2563eb",
      accentBg: "bg-[#2563eb]",
      ringColor: "ring-[#2563eb]",
      badgeBg: "bg-[#2563eb]/10",
      badgeText: "text-[#2563eb]",
    },
    {
      id: "subscription",
      title: "Assinaturas",
      description: "Planos recorrentes, mensalidades e mais",
      icon: RefreshCw,
      accent: "#2563eb",
      accentBg: "bg-violet-700",
      ringColor: "ring-violet-500",
      badgeBg: "bg-violet-500/10",
      badgeText: "text-violet-600 dark:text-violet-400",
    },
  ];

  const handleSubmit = async () => {
    if (!productType || !productName.trim() || !salesPageUrl.trim() || !acceptedTerms) {
      toast({
        title: "Erro",
        description: "Preencha todos os campos obrigatórios (incluindo URL da página de vendas)",
        variant: "destructive",
      });
      return;
    }

    try {
      new URL(salesPageUrl);
    } catch {
      toast({
        title: "URL inválida",
        description: "Digite uma URL válida para a página de vendas (ex: https://seusite.com)",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Usuário não autenticado");

      const tenantId = user.uid;

      const productData: InsertProduct = {
        tenantId,
        title: productName,
        description: description || undefined,
        productType: productType as "digital" | "subscription",
        salesPageUrl: salesPageUrl.trim(),
        active: true,
        hasAccess: true,
        notifyExpirationDays: [],
        deletionRequest: { status: "none" },
        affiliateConfig: {
          enabled: false,
          autoApprove: false,
          extendCommission: false,
          shareData: false,
          marketplaceEnabled: false,
          commissions: {
            single: 10,
            recurring: 0,
            type: "todas" as const,
          },
          preference: "ultimo" as const,
          cookieDuration: 30,
          selectedOffers: [],
          support: { name: "", email: "", phone: "" },
          salesPage: salesPageUrl.trim(),
        },
      };

      const newProduct = await createProduct(productData);
      queryClient.invalidateQueries({ queryKey: ["products"] });

      toast({
        title: "Produto criado!",
        description: "Produto salvo com sucesso no banco de dados",
      });

      onOpenChange(false);
      navigate(`/dashboard/product-detail/${newProduct.id}`);
    } catch (error: any) {
      toast({
        title: "Erro ao criar produto",
        description: error.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const isFormValid = acceptedTerms && productName.trim() && salesPageUrl.trim() && productType;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] max-h-[92vh] overflow-hidden flex flex-col p-0 bg-white dark:bg-[#0f1117] border border-gray-200 dark:border-white/8 shadow-2xl rounded-2xl gap-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-white/6 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-[17px] font-semibold text-gray-900 dark:text-white tracking-tight">
                Novo produto
              </DialogTitle>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
                Preencha os campos abaixo para criar um novo produto
              </p>
            </div>
            <a
              href="#"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12px] font-medium text-[#2563eb] hover:text-[#2563eb] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ver tutorial
            </a>
          </div>
        </DialogHeader>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-7">

          {/* ── Seção 1 — Tipo de produto ── */}
          <section>
            <SectionLabel step="1" label="Tipo de produto" />
            <div className="grid grid-cols-2 gap-3 mt-3">
              {productTypes.map((type) => {
                const Icon = type.icon;
                const selected = productType === type.id;
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setProductType(type.id as ProductType)}
                    className={`relative flex items-start gap-3.5 p-4 rounded-xl border-2 text-left transition-all duration-150 ${
                      selected
                        ? `border-transparent ${type.accentBg} shadow-lg`
                        : "border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/[0.03] hover:border-gray-300 dark:hover:border-white/15 hover:bg-white dark:hover:bg-white/[0.05]"
                    }`}
                  >
                    {/* icon */}
                    <span className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${selected ? "bg-white/20" : type.badgeBg}`}>
                      <Icon className={`h-4 w-4 ${selected ? "text-white" : type.badgeText}`} />
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold leading-tight ${selected ? "text-white" : "text-gray-900 dark:text-white"}`}>
                        {type.title}
                      </p>
                      <p className={`text-[12px] mt-0.5 leading-snug ${selected ? "text-white/80" : "text-gray-500 dark:text-gray-400"}`}>
                        {type.description}
                      </p>
                    </div>

                    {selected && (
                      <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Seção 2 — Informações externas ── */}
          <section>
            <SectionLabel step="2" label="Informações externas" sub="Serão disponibilizadas para os compradores" />

            <div className="mt-4 space-y-4">
              {/* Nome */}
              <FieldGroup
                id="productName"
                label="Nome do produto"
                counter={`${productName.length}/60`}
              >
                <Input
                  id="productName"
                  placeholder="Digite um nome"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value.slice(0, 60))}
                  maxLength={60}
                  className="h-9 text-[13px] bg-white dark:bg-white/[0.04] border-gray-200 dark:border-white/8 focus-visible:ring-1 focus-visible:ring-[#2563eb]/60 focus-visible:border-[#2563eb]/60 transition-all"
                />
              </FieldGroup>

              {/* Descrição */}
              <FieldGroup
                id="description"
                label="Descrição breve"
                counter={`${description.length}/200`}
              >
                <Textarea
                  id="description"
                  placeholder="Descreva seu produto em poucas palavras"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                  maxLength={200}
                  rows={3}
                  className="text-[13px] bg-white dark:bg-white/[0.04] border-gray-200 dark:border-white/8 focus-visible:ring-1 focus-visible:ring-[#2563eb]/60 focus-visible:border-[#2563eb]/60 transition-all resize-none"
                />
              </FieldGroup>

              {/* Categoria */}
              <FieldGroup id="category" label="Categoria">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-9 text-[13px] bg-white dark:bg-white/[0.04] border-gray-200 dark:border-white/8 focus:ring-1 focus:ring-[#2563eb]/60 focus:border-[#2563eb]/60">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="marketing">Marketing Digital</SelectItem>
                    <SelectItem value="design">Design</SelectItem>
                    <SelectItem value="programming">Programação</SelectItem>
                    <SelectItem value="business">Negócios</SelectItem>
                    <SelectItem value="health">Saúde e Bem-estar</SelectItem>
                    <SelectItem value="education">Educação</SelectItem>
                  </SelectContent>
                </Select>
              </FieldGroup>

              {/* URL da Página de Vendas */}
              <FieldGroup
                id="salesPageUrl"
                label={<>URL da Página de Vendas <span className="text-red-500 ml-0.5">*</span></>}
                hint="Link oficial onde os afiliados direcionarão o tráfego"
              >
                <div className="relative">
                  <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    id="salesPageUrl"
                    type="url"
                    placeholder="https://seusite.com/produto"
                    value={salesPageUrl}
                    onChange={(e) => setSalesPageUrl(e.target.value)}
                    className="h-9 pl-9 text-[13px] bg-white dark:bg-white/[0.04] border-gray-200 dark:border-white/8 focus-visible:ring-1 focus-visible:ring-[#2563eb]/60 focus-visible:border-[#2563eb]/60 transition-all"
                    required
                  />
                </div>
              </FieldGroup>
            </div>
          </section>

          {/* ── Termos ── */}
          <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-dashed border-gray-300 dark:border-white/10 bg-gray-50/60 dark:bg-white/[0.02]">
            <Checkbox
              id="terms"
              checked={acceptedTerms}
              onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
              className="mt-0.5 shrink-0"
            />
            <Label
              htmlFor="terms"
              className="text-[12.5px] text-gray-600 dark:text-gray-400 cursor-pointer leading-relaxed"
            >
              Estou ciente que o meu produto será avaliado de acordo com as{" "}
              <a
                href="#"
                className="text-[#2563eb] hover:underline font-medium"
                target="_blank"
                rel="noopener noreferrer"
              >
                Regras da Plataforma
              </a>
              .
            </Label>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/6 flex items-center justify-between shrink-0 bg-gray-50/60 dark:bg-white/[0.02]">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
            className="text-[13px] h-9 px-4 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isFormValid || isCreating}
            className="h-9 px-5 text-[13px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] text-white disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-all"
          >
            {isCreating ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Criando...
              </span>
            ) : (
              "Cadastrar produto"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Helpers de layout ──────────────────────────────────── */

function SectionLabel({
  step,
  label,
  sub,
}: {
  step: string;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2563eb]/12 text-[10px] font-bold text-[#2563eb] shrink-0 mt-0.5">
        {step}
      </span>
      <div>
        <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{label}</p>
        {sub && <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function FieldGroup({
  id,
  label,
  hint,
  counter,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: string;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-[12.5px] font-medium text-gray-700 dark:text-gray-300">
          {label}
        </Label>
        {counter && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{counter}</span>
        )}
      </div>
      {children}
      {hint && (
        <p className="text-[11.5px] text-gray-400 dark:text-gray-500">{hint}</p>
      )}
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] font-medium text-gray-700 dark:text-gray-300">{label}</p>
      <div className="h-9 flex items-center px-3 rounded-lg border border-gray-200 dark:border-white/8 bg-gray-100 dark:bg-white/[0.04] text-[13px] text-gray-600 dark:text-gray-400">
        {value}
      </div>
    </div>
  );
}
