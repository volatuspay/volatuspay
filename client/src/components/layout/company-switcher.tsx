import { useState, useEffect, useRef } from "react";
import {
  Building2, ChevronDown, CheckCircle, Clock, XCircle, Loader2,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

interface Company {
  id: string;
  businessName: string;
  document: string;
  documentType: "cpf" | "cnpj";
  status: "approved" | "pending" | "rejected";
  isMain?: boolean;
}

const STORAGE_KEY = "volatuspay_active_company";

export function useActiveCompany() {
  const [activeCompanyId, setActiveCompanyIdState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) || "main"
  );
  const setActiveCompanyId = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setActiveCompanyIdState(id);
    window.dispatchEvent(new CustomEvent("company-changed", { detail: { id } }));
  };
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.id;
      if (id) setActiveCompanyIdState(id);
    };
    window.addEventListener("company-changed", handler);
    return () => window.removeEventListener("company-changed", handler);
  }, []);
  return { activeCompanyId, setActiveCompanyId };
}

// ─── Main component ───────────────────────────────────────────────────────────
export function CompanySwitcher() {
  const { user } = useAuthStore();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [open, setOpen] = useState(false);
  const { activeCompanyId, setActiveCompanyId } = useActiveCompany();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (user?.uid) loadCompanies(); }, [user?.uid]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadCompanies = async () => {
    try {
      setLoadingCompanies(true);
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return;
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/seller/companies", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setCompanies((await res.json()).companies || []);
    } catch { /* silently ignore */ } finally {
      setLoadingCompanies(false);
    }
  };

  const activeCompany = companies.find(c => c.id === activeCompanyId) || companies[0];
  const displayName = activeCompany?.businessName || "Empresa Principal";

  const formatDoc = (doc: string, type: string) => {
    const d = (doc || "").replace(/\D/g, "");
    if (type === "cnpj" && d.length === 14)
      return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    if (d.length === 11)
      return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    return doc;
  };

  const statusLabel = (status: string) => {
    if (status === "approved") return "Ativa";
    if (status === "pending") return "Pendente";
    return "Recusada";
  };

  return (
    <div className="relative px-3 pb-2" ref={dropdownRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
          "bg-sidebar-accent/40 hover:bg-sidebar-accent border border-sidebar-border/60",
          "text-sidebar-foreground"
        )}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
        <span className="flex-1 text-left truncate text-xs font-medium">{displayName}</span>
        {loadingCompanies
          ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
          : <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        }
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 rounded-lg border border-sidebar-border bg-popover shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Minhas Empresas</p>
            <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
              {companies.length}
            </span>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {companies.length === 0 && loadingCompanies ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : companies.map(company => (
              <button
                key={company.id}
                onClick={() => {
                  if (company.status === "approved") { setActiveCompanyId(company.id); setOpen(false); }
                }}
                disabled={company.status !== "approved"}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent transition-colors",
                  company.id === activeCompanyId && "bg-accent",
                  company.status !== "approved" && "opacity-70 cursor-default"
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs truncate text-foreground">{company.businessName}</p>
                  {company.document && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {formatDoc(company.document, company.documentType)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {company.status === "approved" && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                  {company.status === "pending"  && <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
                  {company.status === "rejected" && <div className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                  <span className={cn("text-[9px] font-medium",
                    company.status === "approved" && "text-green-500",
                    company.status === "pending"  && "text-orange-400",
                    company.status === "rejected" && "text-red-400",
                  )}>
                    {statusLabel(company.status)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
