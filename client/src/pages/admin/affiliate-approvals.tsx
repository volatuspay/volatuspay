import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Search, RefreshCw, Eye, ExternalLink, ImageOff, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Affiliate {
  id: string;
  sellerId: string;
  businessName: string;
  document: string;
  documentType: "cpf" | "cnpj";
  status: "pending" | "approved" | "rejected" | "blocked";
  email?: string;
  whatsapp?: string;
  birthDate?: string;
  personalDocumentType?: string;
  personalDocumentNumber?: string;
  docs?: {
    front?: string;
    back?: string;
    selfie?: string;
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
  { value: "approved", label: "Aprovados" },
  { value: "rejected", label: "Recusados" },
  { value: "blocked", label: "Bloqueados" },
  { value: "all", label: "Todos" },
];

const statusBadge = (status: string) => {
  if (status === "approved") return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs font-medium">Aprovado</Badge>;
  if (status === "pending") return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-xs font-medium">Pendente</Badge>;
  if (status === "blocked") return <Badge className="bg-gray-500/15 text-gray-500 border-gray-500/30 text-xs font-medium">Bloqueado</Badge>;
  return <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-xs font-medium">Recusado</Badge>;
};

const statusDot = (status: string) => {
  if (status === "approved") return "bg-emerald-500";
  if (status === "pending") return "bg-yellow-500";
  if (status === "blocked") return "bg-gray-400";
  return "bg-red-500";
};

const formatDoc = (doc: string) => {
  const d = (doc || "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
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
        <img src={url} alt={label} onError={() => setError(true)} className="w-full aspect-[4/3] object-cover" />
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
          <p className="text-[10px] text-white font-medium">{label}</p>
        </div>
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(false)}>
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button className="absolute -top-10 right-0 text-white text-sm hover:text-white/70" onClick={() => setLightbox(false)}>Fechar</button>
            <img src={url} alt={label} className="w-full rounded-lg" />
            <a href={url} target="_blank" rel="noopener noreferrer" className="absolute -bottom-10 right-0 text-white text-xs flex items-center gap-1 hover:text-white/70">
              <ExternalLink className="h-3 w-3" /> Abrir original
            </a>
          </div>
        </div>
      )}
    </>
  );
}

export default function AffiliateApprovals() {
  const { toast } = useToast();
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);

  const loadAffiliates = async (status = statusFilter) => {
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      // Reuse the same company-approvals endpoint, filter client-side to CPF
      const res = await fetch(`/api/admin/company-approvals?status=${status}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao carregar afiliados");
      const data = await res.json();
      // Only CPF accounts (affiliates)
      const all: Affiliate[] = (data.companies || data || []);
      setAffiliates(all.filter((a) => a.documentType === "cpf" || (!a.documentType && !a.document?.includes("/"))))
    } catch (err: any) {
      toast({ title: "Erro ao carregar", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAffiliates(); }, []);

  const handleAction = async (id: string, action: "approve" | "reject" | "block", reason?: string) => {
    setProcessing(id);
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/company-approvals/${id}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || "" }),
      });
      if (!res.ok) throw new Error("Erro ao processar ação");
      toast({ title: action === "approve" ? "Afiliado aprovado!" : action === "reject" ? "Afiliado recusado." : "Afiliado bloqueado." });
      setExpanded(null);
      setRejectionReason("");
      setBlockReason("");
      setConfirmBlock(null);
      await loadAffiliates();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const filtered = affiliates.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (a.sellerName || "").toLowerCase().includes(q) ||
      (a.sellerEmail || "").toLowerCase().includes(q) ||
      (a.document || "").includes(q) ||
      (a.businessName || "").toLowerCase().includes(q)
    );
  });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Aprovar Afiliados</h1>
            <p className="text-muted-foreground text-sm mt-1">Contas CPF aguardando verificação de identidade</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadAffiliates()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, email ou CPF..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2 flex-wrap">
            {STATUS_OPTS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setStatusFilter(opt.value); loadAffiliates(opt.value); }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  statusFilter === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg font-medium">Nenhum afiliado encontrado</p>
            <p className="text-sm mt-1">Tente mudar o filtro de status</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((affiliate) => (
              <div key={affiliate.id} className="rounded-xl border bg-card overflow-hidden">
                {/* Header */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpanded(expanded === affiliate.id ? null : affiliate.id)}
                >
                  <div className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", statusDot(affiliate.status))} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{affiliate.sellerName || affiliate.businessName || "-"}</span>
                      {statusBadge(affiliate.status)}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{affiliate.sellerEmail || affiliate.email || "-"}</span>
                      {affiliate.document && (
                        <span className="text-xs font-mono text-muted-foreground">CPF: {formatDoc(affiliate.document)}</span>
                      )}
                      {affiliate.whatsapp && (
                        <span className="text-xs text-muted-foreground">{formatWhatsapp(affiliate.whatsapp)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground flex-shrink-0">
                    {affiliate.createdAt ? new Date(affiliate.createdAt).toLocaleDateString("pt-BR") : "-"}
                  </div>
                </div>

                {/* Expanded */}
                {expanded === affiliate.id && (
                  <div className="border-t bg-muted/10 p-4 space-y-5">

                    {/* Dados pessoais */}
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Dados Pessoais</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground">Nome</p>
                          <p className="text-sm font-medium">{affiliate.sellerName || affiliate.businessName || <span className="text-muted-foreground">-</span>}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground">CPF</p>
                          <p className="text-sm font-mono">{affiliate.document ? formatDoc(affiliate.document) : <span className="text-muted-foreground">-</span>}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground">Data de Nascimento</p>
                          <p className="text-sm font-medium">
                            {affiliate.birthDate
                              ? new Date(affiliate.birthDate + "T12:00:00").toLocaleDateString("pt-BR")
                              : <span className="text-muted-foreground">-</span>}
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground">WhatsApp</p>
                          <p className="text-sm font-medium">{formatWhatsapp(affiliate.whatsapp) || <span className="text-muted-foreground">-</span>}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground">Tipo Doc. Pessoal</p>
                          <p className="text-sm font-medium uppercase">{affiliate.personalDocumentType || <span className="text-muted-foreground">-</span>}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[10px] text-muted-foreground">Nº Doc. Pessoal</p>
                          <p className="text-sm font-mono">{affiliate.personalDocumentNumber || <span className="text-muted-foreground">-</span>}</p>
                        </div>
                        <div className="space-y-0.5 col-span-2">
                          <p className="text-[10px] text-muted-foreground">E-mail</p>
                          <p className="text-sm break-all">{affiliate.sellerEmail || affiliate.email || <span className="text-muted-foreground">-</span>}</p>
                        </div>
                      </div>
                    </div>

                    {/* Docs */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Documentos enviados</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <DocPhoto url={affiliate.docs?.front} label="Frente RG/CNH" />
                        <DocPhoto url={affiliate.docs?.back} label="Verso RG/CNH" />
                        <DocPhoto url={affiliate.docs?.selfie} label="Selfie c/ Documento" />
                      </div>
                      {affiliate.docs?.facialVerification && (
                        <div className="mt-3">
                          <p className="text-xs text-muted-foreground mb-2">Vídeo de verificação facial:</p>
                          <a href={affiliate.docs.facialVerification} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> Abrir vídeo facial
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Review reason */}
                    {affiliate.reviewReason && (
                      <div className="p-3 rounded-lg bg-muted/50 border">
                        <p className="text-xs text-muted-foreground">Motivo da revisão: <span className="text-foreground">{affiliate.reviewReason}</span></p>
                      </div>
                    )}

                    {/* Actions */}
                    {affiliate.status === "pending" && (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => handleAction(affiliate.id, "approve")}
                            disabled={!!processing}
                          >
                            {processing === affiliate.id ? "..." : "Aprovar Afiliado"}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Motivo da recusa (obrigatório para recusar)</Label>
                          <Textarea
                            placeholder="Ex: CPF não confere com o documento enviado"
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            className="text-sm h-20 resize-none"
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              if (!rejectionReason.trim()) { toast({ title: "Informe o motivo da recusa", variant: "destructive" }); return; }
                              handleAction(affiliate.id, "reject", rejectionReason);
                            }}
                            disabled={!!processing}
                          >
                            Recusar
                          </Button>
                        </div>

                        {confirmBlock !== affiliate.id ? (
                          <Button size="sm" variant="outline" className="border-gray-600 text-gray-400 text-xs" onClick={() => setConfirmBlock(affiliate.id)}>
                            Bloquear conta
                          </Button>
                        ) : (
                          <div className="space-y-2">
                            <Textarea placeholder="Motivo do bloqueio" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="text-sm h-16 resize-none" />
                            <div className="flex gap-2">
                              <Button size="sm" variant="destructive" onClick={() => handleAction(affiliate.id, "block", blockReason)} disabled={!!processing}>Confirmar Bloqueio</Button>
                              <Button size="sm" variant="outline" onClick={() => setConfirmBlock(null)}>Cancelar</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {affiliate.status === "approved" && (
                      <div className="flex gap-2">
                        {confirmBlock !== affiliate.id ? (
                          <Button size="sm" variant="outline" className="border-red-800 text-red-400 text-xs" onClick={() => setConfirmBlock(affiliate.id)}>
                            Bloquear conta aprovada
                          </Button>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            <Textarea placeholder="Motivo do bloqueio" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="text-sm h-16 resize-none w-full" />
                            <Button size="sm" variant="destructive" onClick={() => handleAction(affiliate.id, "block", blockReason)} disabled={!!processing}>Confirmar Bloqueio</Button>
                            <Button size="sm" variant="outline" onClick={() => setConfirmBlock(null)}>Cancelar</Button>
                          </div>
                        )}
                      </div>
                    )}
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
