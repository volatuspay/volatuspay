import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Search, RefreshCw, Eye, ExternalLink, ImageOff, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Company {
  id: string;
  sellerId: string;
  businessName: string;
  document: string;
  documentType: "cpf" | "cnpj";
  status: "pending" | "approved" | "rejected" | "blocked";
  email?: string;
  whatsapp?: string;
  cep?: string;
  address?: string;
  city?: string;
  state?: string;
  birthDate?: string;
  personalDocumentType?: string;
  personalDocumentNumber?: string;
  docs?: {
    front?: string;
    back?: string;
    selfie?: string;
    cnpjCard?: string;
    contrato?: string;
    facialVerification?: string;
  };
  sellerEmail?: string;
  sellerName?: string;
  createdAt?: string;
  reviewedAt?: string;
  reviewReason?: string;
}

const STATUS_OPTS = [
  { value: "pending", label: "Pendentes" },
  { value: "approved", label: "Aprovadas" },
  { value: "rejected", label: "Recusadas" },
  { value: "blocked", label: "Bloqueadas" },
  { value: "all", label: "Todas" },
];

const statusBadge = (status: string) => {
  if (status === "approved") return <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-xs font-medium">Aprovada</Badge>;
  if (status === "pending") return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-xs font-medium">Pendente</Badge>;
  if (status === "blocked") return <Badge className="bg-gray-500/15 text-gray-500 border-gray-500/30 text-xs font-medium">Bloqueada</Badge>;
  return <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-xs font-medium">Recusada</Badge>;
};

const statusDot = (status: string) => {
  if (status === "approved") return "bg-blue-500";
  if (status === "pending") return "bg-yellow-500";
  if (status === "blocked") return "bg-gray-400";
  return "bg-red-500";
};

const formatDoc = (doc: string, type: string) => {
  const d = (doc || "").replace(/\D/g, "");
  if (type === "cnpj" && d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11)
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return doc;
};

const formatWhatsapp = (w?: string) => {
  if (!w) return null;
  const d = w.replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return w;
};

function DocPhoto({ url, label }: { url?: string | null; label: string }) {
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  if (!url) return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center aspect-[4/3] gap-2">
      <ImageOff className="h-6 w-6 text-muted-foreground/40" />
      <p className="text-[10px] text-muted-foreground/60">{label}</p>
      <p className="text-[10px] text-muted-foreground/40">Não enviado</p>
    </div>
  );

  if (error) return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center aspect-[4/3] gap-2">
      <AlertCircle className="h-5 w-5 text-muted-foreground/40" />
      <p className="text-[10px] text-muted-foreground/60">{label}</p>
      <p className="text-[10px] text-muted-foreground/40">Erro ao carregar</p>
    </div>
  );

  return (
    <>
      <div className="rounded-lg border border-border overflow-hidden bg-muted/20 group cursor-pointer relative" onClick={() => setLightbox(true)}>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors z-10 flex items-center justify-center">
          <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <img
          src={url}
          alt={label}
          onError={() => setError(true)}
          className="w-full aspect-[4/3] object-cover"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
          <p className="text-[10px] text-white font-medium">{label}</p>
        </div>
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white text-sm hover:text-white/70"
              onClick={() => setLightbox(false)}
            >Fechar</button>
            <img src={url} alt={label} className="w-full rounded-lg" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute -bottom-10 right-0 text-white text-xs flex items-center gap-1 hover:text-white/70"
            >
              <ExternalLink className="h-3 w-3" /> Abrir original
            </a>
          </div>
        </div>
      )}
    </>
  );
}

export default function CompanyApprovals() {
  const { toast } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);

  const loadCompanies = async (status = statusFilter) => {
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/company-approvals?status=${status}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // Aprovar Conta PJ - mostra apenas CNPJ
      const all: Company[] = data.companies || [];
      setCompanies(all.filter((c) => c.documentType === "cnpj" || (c.document || "").replace(/\D/g, "").length === 14));
    } catch (e: any) {
      toast({ title: "Erro ao carregar", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCompanies(statusFilter); }, [statusFilter]);

  const handleDecision = async (id: string, status: "approved" | "rejected" | "blocked", reason?: string) => {
    setProcessing(id);
    try {
      const user = auth.currentUser;
      const token = await user!.getIdToken();
      const res = await fetch(`/api/admin/company-approvals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, reason: reason || rejectionReason }),
      });
      if (!res.ok) throw new Error(await res.text());
      const msgs: Record<string, string> = {
        approved: "Empresa aprovada! O seller já pode usá-la.",
        rejected: "Empresa recusada.",
        blocked: "Empresa bloqueada com sucesso.",
      };
      toast({ title: msgs[status] });
      setExpanded(null);
      setRejectionReason("");
      setBlockReason("");
      setConfirmBlock(null);
      loadCompanies();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const filtered = companies.filter(c =>
    !search ||
    c.businessName?.toLowerCase().includes(search.toLowerCase()) ||
    c.sellerEmail?.toLowerCase().includes(search.toLowerCase()) ||
    c.sellerName?.toLowerCase().includes(search.toLowerCase()) ||
    c.document?.includes(search.replace(/\D/g, "")) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase())
  );

  const pendingCount = companies.filter(c => c.status === "pending").length;
  const hasAnyDoc = (c: Company) => c.docs && Object.values(c.docs).some(Boolean);

  return (
    <DashboardLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Aprovar Conta PJ</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Contas CNPJ (Vendedor PJ) aguardando verificação de empresa
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-sm px-3 py-1.5 font-semibold">
                {pendingCount} pendente{pendingCount !== 1 ? "s" : ""}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => loadCompanies()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="flex gap-1 bg-muted rounded-lg p-1 flex-wrap">
            {STATUS_OPTS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  statusFilter === opt.value
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por empresa, seller, e-mail, cidade, documento..."
              className="pl-9 text-sm"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground font-semibold text-lg">Nenhuma empresa encontrada</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {statusFilter === "pending" ? "Não há empresas aguardando aprovação." : "Nenhum resultado para este filtro."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{filtered.length} empresa{filtered.length !== 1 ? "s" : ""} encontrada{filtered.length !== 1 ? "s" : ""}</p>
            {filtered.map(company => (
              <div key={company.id} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                <button
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/20 transition-colors"
                  onClick={() => setExpanded(expanded === company.id ? null : company.id)}
                >
                  <div className="relative h-11 w-11 rounded-full bg-muted flex items-center justify-center shrink-0 text-base font-bold text-muted-foreground">
                    {company.businessName?.[0]?.toUpperCase() || "E"}
                    <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background", statusDot(company.status))} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{company.businessName}</p>
                      {statusBadge(company.status)}
                      {hasAnyDoc(company) && (
                        <span className="text-[10px] bg-blue-500/10 text-blue-600 border border-blue-500/20 rounded px-1.5 py-0.5 font-medium">
                          Docs enviados
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span>{company.documentType?.toUpperCase()}: {formatDoc(company.document, company.documentType)}</span>
                      <span>{company.sellerName || "-"} · {company.sellerEmail || company.sellerId}</span>
                      {company.city && company.state && (
                        <span>{company.city}/{company.state}</span>
                      )}
                      {company.createdAt && (
                        <span>{new Date(company.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      )}
                    </div>
                  </div>
                  <span className={cn("text-muted-foreground text-xs transition-transform shrink-0", expanded === company.id && "rotate-180")}>▾</span>
                </button>

                {expanded === company.id && (
                  <div className="border-t border-border">
                    <div className="p-5 space-y-5">

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-lg bg-muted/40 p-3 space-y-0.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Razão Social</p>
                          <p className="text-sm font-semibold">{company.businessName || "-"}</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-3 space-y-0.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Documento</p>
                          <p className="text-sm font-semibold">{company.documentType?.toUpperCase()}</p>
                          <p className="text-xs text-muted-foreground font-mono">{formatDoc(company.document, company.documentType)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-3 space-y-0.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">E-mail da Empresa</p>
                          <p className="text-sm font-medium break-all">{company.email || <span className="text-muted-foreground">Não informado</span>}</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-3 space-y-0.5">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">WhatsApp</p>
                          <p className="text-sm font-medium">{formatWhatsapp(company.whatsapp) || <span className="text-muted-foreground">Não informado</span>}</p>
                        </div>
                      </div>

                      {/* Dados pessoais do titular */}
                      <div className="rounded-lg bg-muted/30 border border-border/50 p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Dados Pessoais do Titular</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground">Data de Nascimento</p>
                            <p className="text-sm font-medium">
                              {company.birthDate
                                ? new Date(company.birthDate + "T12:00:00").toLocaleDateString("pt-BR")
                                : <span className="text-muted-foreground">-</span>}
                            </p>
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground">Tipo Doc. Pessoal</p>
                            <p className="text-sm font-medium uppercase">{company.personalDocumentType || <span className="text-muted-foreground">-</span>}</p>
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-muted-foreground">Nº Doc. Pessoal</p>
                            <p className="text-sm font-medium font-mono">{company.personalDocumentNumber || <span className="text-muted-foreground">-</span>}</p>
                          </div>
                        </div>
                      </div>

                      {(company.address || company.cep || company.city) && (
                        <div className="rounded-lg bg-muted/40 p-3">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">Endereço</p>
                          <p className="text-sm">
                            {[company.address, company.city, company.state].filter(Boolean).join(", ")}
                            {company.cep && <span className="text-muted-foreground ml-2">CEP: {company.cep}</span>}
                          </p>
                        </div>
                      )}

                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Conta do Seller</p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-semibold">{company.sellerName || "-"}</span>
                          <span className="text-xs text-muted-foreground">{company.sellerEmail || "-"}</span>
                          <span className="text-xs font-mono text-muted-foreground/60">{company.sellerId}</span>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold mb-3">Documentos Enviados</p>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                          <DocPhoto url={company.docs?.front} label="Documento - Frente" />
                          <DocPhoto url={company.docs?.back} label="Documento - Verso" />
                          <DocPhoto url={company.docs?.selfie} label="Selfie com Documento" />
                          <DocPhoto url={company.docs?.cnpjCard} label="Cartão CNPJ" />
                          <DocPhoto url={company.docs?.contrato} label="Contrato Social" />
                        </div>
                        {company.docs?.facialVerification && (
                          <div className="mt-3">
                            <p className="text-xs text-muted-foreground mb-1">Vídeo de verificação facial:</p>
                            <a href={company.docs.facialVerification} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline flex items-center gap-1">
                              <ExternalLink className="h-3 w-3" /> Abrir vídeo facial
                            </a>
                          </div>
                        )}
                      </div>

                      {company.reviewedAt && (
                        <div className="text-xs text-muted-foreground">
                          Revisada em {new Date(company.reviewedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}

                      {(company.status === "rejected" || company.status === "blocked") && company.reviewReason && (
                        <div className={cn("rounded-lg border p-3", company.status === "blocked" ? "border-gray-500/30 bg-gray-500/5" : "border-red-500/30 bg-red-500/5")}>
                          <p className={cn("text-xs font-semibold mb-1", company.status === "blocked" ? "text-gray-500" : "text-red-500")}>
                            {company.status === "blocked" ? "Motivo do bloqueio" : "Motivo da recusa"}
                          </p>
                          <p className="text-sm text-muted-foreground">{company.reviewReason}</p>
                        </div>
                      )}

                      {company.status === "pending" && (
                        <div className="space-y-3 pt-1">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                              Motivo da recusa (obrigatório ao recusar, opcional ao bloquear)
                            </label>
                            <Textarea
                              value={rejectionReason}
                              onChange={e => setRejectionReason(e.target.value)}
                              placeholder="Ex: Documentação incompleta, CNPJ inválido, selfie ilegível..."
                              className="text-sm resize-none"
                              rows={2}
                            />
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              onClick={() => handleDecision(company.id, "approved")}
                              disabled={!!processing}
                              className="flex-1 bg-blue-600 hover:bg-green-700 text-white min-w-[120px]"
                              size="sm"
                            >
                              {processing === company.id ? <RefreshCw className="h-4 w-4 animate-spin mr-1.5" /> : null}
                              Aprovar
                            </Button>
                            <Button
                              onClick={() => handleDecision(company.id, "rejected")}
                              disabled={!!processing}
                              variant="destructive"
                              className="flex-1 min-w-[120px]"
                              size="sm"
                            >
                              Recusar
                            </Button>
                            <Button
                              onClick={() => setConfirmBlock(company.id)}
                              disabled={!!processing}
                              variant="outline"
                              className="border-gray-400 text-gray-500 hover:bg-gray-500/10 min-w-[120px]"
                              size="sm"
                            >
                              Bloquear
                            </Button>
                          </div>
                        </div>
                      )}

                      {company.status === "approved" && (
                        <div className="flex gap-2 pt-1 flex-wrap">
                          <Button
                            onClick={() => setConfirmBlock(company.id)}
                            disabled={!!processing}
                            variant="outline"
                            className="border-gray-400 text-gray-500 hover:bg-gray-500/10"
                            size="sm"
                          >
                            Bloquear Empresa
                          </Button>
                        </div>
                      )}

                      {company.status === "rejected" && (
                        <div className="flex gap-2 pt-1 flex-wrap">
                          <Button
                            onClick={() => handleDecision(company.id, "approved")}
                            disabled={!!processing}
                            className="bg-blue-600 hover:bg-green-700 text-white"
                            size="sm"
                          >
                            Reativar (Aprovar)
                          </Button>
                          <Button
                            onClick={() => setConfirmBlock(company.id)}
                            disabled={!!processing}
                            variant="outline"
                            className="border-gray-400 text-gray-500 hover:bg-gray-500/10"
                            size="sm"
                          >
                            Bloquear
                          </Button>
                        </div>
                      )}

                      {company.status === "blocked" && (
                        <div className="flex gap-2 pt-1 flex-wrap">
                          <Button
                            onClick={() => handleDecision(company.id, "approved")}
                            disabled={!!processing}
                            className="bg-blue-600 hover:bg-green-700 text-white"
                            size="sm"
                          >
                            Desbloquear (Aprovar)
                          </Button>
                        </div>
                      )}

                      {confirmBlock === company.id && (
                        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4 space-y-3">
                          <p className="text-sm font-semibold text-orange-600">
                            Confirmar bloqueio de "{company.businessName}"
                          </p>
                          <p className="text-xs text-muted-foreground">
                            A empresa ficará bloqueada e o seller não poderá usá-la. Você pode desbloquear depois.
                          </p>
                          <Textarea
                            value={blockReason}
                            onChange={e => setBlockReason(e.target.value)}
                            placeholder="Motivo do bloqueio (opcional)..."
                            className="text-sm resize-none"
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleDecision(company.id, "blocked", blockReason)}
                              disabled={!!processing}
                              className="bg-orange-600 hover:bg-orange-700 text-white"
                              size="sm"
                            >
                              Confirmar Bloqueio
                            </Button>
                            <Button
                              onClick={() => { setConfirmBlock(null); setBlockReason(""); }}
                              variant="ghost"
                              size="sm"
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
