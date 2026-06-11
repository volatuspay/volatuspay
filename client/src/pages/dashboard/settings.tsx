import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useSearch } from "wouter";
const TeamPage = lazy(() => import("@/pages/dashboard/team"));
const IntegrationsPage = lazy(() => import("@/pages/dashboard/integrations"));
import {
  ShieldCheck,
  ShieldOff,
  KeyRound,
  QrCode,
  CheckCircle2,
  Loader2,
  Monitor,
  Smartphone,
  Tablet,
  MapPin,
  Globe,
  LogOut,
  Copy,
  Check,
  RefreshCw,
  User,
  Building2,
  CreditCard,
  FileText,
  Camera,
  AlertCircle,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { getBrowserId } from "@/lib/browser-session";
import { sendPasswordResetEmail } from "firebase/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import AccountVerificationModal from "@/components/seller/account-verification-modal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SellerProfile {
  name?: string;
  email?: string;
  phone?: string;
  businessName?: string;
  document?: string;
  documentType?: string;
  createdAt?: string;
  lastLoginAt?: string;
  status?: string;
  isApproved?: boolean;
  profilePhoto?: string;
  photoURL?: string;
  financialSettings?: {
    customFees?: {
      pix?: { percentFee?: number; fixedFee?: number };
      cardBR?: { percentFee?: number; fixedFee?: number };
    };
    withdrawalDelayDays?: { pix?: number };
  };
  documentsUrls?: {
    documentFront?: string;
    documentBack?: string;
    selfieWithDocument?: string;
    cnpjCard?: string;
    facialVerification?: string;
  };
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  legalName?: string;
  businessNiche?: string;
}

interface SessionItem {
  sessionId: string;
  ip: string;
  browser: string;
  os: string;
  device: string;
  locationLabel: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(input: any): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "string" || typeof input === "number") {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === "object") {
    const secs = input._seconds ?? input.seconds;
    if (typeof secs === "number") return new Date(secs * 1000);
    if (typeof input.toDate === "function") {
      try { const d = input.toDate(); return d instanceof Date && !isNaN(d.getTime()) ? d : null; } catch { return null; }
    }
  }
  return null;
}

function timeAgo(input?: any): string {
  const date = toDate(input);
  if (!date) return "-";
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "Agora mesmo";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function formatDate(input?: any): string {
  const date = toDate(input);
  if (!date) return "-";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function maskDocument(doc?: string): string {
  if (!doc) return "-";
  if (doc.replace(/\D/g, "").length === 11) {
    return doc.replace(/(\d{3})\d{3}\d{3}(\d{2})/, "$1.***.***-$2");
  }
  return doc.replace(/(\d{2})\d{5}\d{3}(\d{4})/, "$1.***.***/$2-**");
}

function DeviceIcon({ device }: { device: string }) {
  if (device === "Mobile") return <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (device === "Tablet") return <Tablet className="h-4 w-4 text-muted-foreground shrink-0" />;
  return <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />;
}

// ─── ReadOnly Field ──────────────────────────────────────────────────────────

function formatFieldValue(value: any): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    // Endereço estruturado { street, number, complement, neighborhood, city, state, zipCode }
    const v = value as Record<string, any>;
    if (v.street || v.city || v.neighborhood) {
      const parts: string[] = [];
      if (v.street) parts.push(String(v.street));
      if (v.number) parts.push(String(v.number));
      if (v.complement) parts.push(String(v.complement));
      if (v.neighborhood) parts.push(String(v.neighborhood));
      if (v.city && v.state) parts.push(`${v.city} - ${v.state}`);
      else if (v.city) parts.push(String(v.city));
      else if (v.state) parts.push(String(v.state));
      if (v.zipCode) parts.push(`CEP ${v.zipCode}`);
      return parts.filter(Boolean).join(", ");
    }
    try { return JSON.stringify(value); } catch { return ""; }
  }
  return String(value);
}

function Field({ label, value, copyable, mono }: {
  label: string; value?: any; copyable?: boolean; mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const displayValue = formatFieldValue(value);

  const handleCopy = () => {
    if (!displayValue) return;
    navigator.clipboard.writeText(displayValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <div className="flex items-center gap-2">
        <div className={`flex-1 px-3 py-2 rounded-md bg-muted/40 border border-border text-sm min-h-[36px] flex items-center ${mono ? "font-mono text-xs" : ""}`}>
          {displayValue || <span className="text-muted-foreground">-</span>}
        </div>
        {copyable && displayValue && (
          <button
            onClick={handleCopy}
            className="shrink-0 p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Copiar"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, description }: {
  icon: React.ElementType; title: string; description: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground pl-6">{description}</p>
    </div>
  );
}

// ─── Doc Thumbnail ────────────────────────────────────────────────────────────

function DocCard({ label, url }: { label: string; url?: string }) {
  const isPdf = url ? (url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('%2fpdf') || url.toLowerCase().includes('/pdf/')) : false;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block">
          {isPdf ? (
            <div className="relative h-24 rounded-md border overflow-hidden bg-muted/30 hover:border-primary transition-colors group flex flex-col items-center justify-center gap-2">
              <FileText className="h-8 w-8 text-emerald-500" />
              <span className="text-xs font-bold text-emerald-400">PDF</span>
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-xs font-medium">Abrir PDF</span>
              </div>
            </div>
          ) : (
            <div className="relative h-24 rounded-md border overflow-hidden bg-muted/30 hover:border-primary transition-colors group">
              <img src={url} alt={label} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="h-5 w-5 text-white" />
              </div>
            </div>
          )}
        </a>
      ) : (
        <div className="h-24 rounded-md border bg-muted/20 flex flex-col items-center justify-center gap-1 text-muted-foreground">
          <FileText className="h-5 w-5" />
          <span className="text-[10px]">Não enviado</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuthStore();
  const { toast } = useToast();

  const [profile, setProfile] = useState<SellerProfile>({});
  const [profileLoading, setProfileLoading] = useState(true);

  // 2FA
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [enrollStep, setEnrollStep] = useState<"idle" | "qr" | "done">("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [otpCode, setOtpCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  // KYC Verification Modal
  const [showVerifModal, setShowVerifModal] = useState(false);

  // Password
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  // ── Load profile ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token || cancelled) return;

      // Fetch full seller data
      const res = await fetch(`/api/sellers/${user.uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);

      if (res?.ok && !cancelled) {
        const data = await res.json();
        setProfile(data);
      }
      if (!cancelled) setProfileLoading(false);

      // TOTP status
      const totpRes = await fetch("/api/seller/totp/status", {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (totpRes?.ok && !cancelled) {
        const d = await totpRes.json();
        setMfaEnrolled(d.enabled === true);
      }
    })();

    loadSessions();

    return () => { cancelled = true; };
  }, [user]);

  // ── Sessions ──────────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    setSessionsLoading(true);
    try {
      const browserId = getBrowserId();
      const res = await fetch("/api/seller/sessions", {
        headers: { Authorization: `Bearer ${token}`, "x-browser-id": browserId },
      });
      if (res.ok) {
        const data = await res.json();
        const raw: SessionItem[] = data.sessions || [];

        // Deduplicar no cliente por ip+browser+os - manter a mais recente de cada combinação
        const seen = new Map<string, SessionItem>();
        for (const s of raw) {
          const key = `${s.ip}|${s.browser}|${s.os}`;
          const existing = seen.get(key);
          if (!existing) {
            seen.set(key, s);
          } else {
            // Preferir isCurrent; senão pegar a mais recente
            if (s.isCurrent && !existing.isCurrent) {
              seen.set(key, s);
            } else if (!s.isCurrent && !existing.isCurrent) {
              const sTime = new Date(s.lastActiveAt).getTime();
              const eTime = new Date(existing.lastActiveAt).getTime();
              if (sTime > eTime) seen.set(key, s);
            }
          }
        }

        setSessions(Array.from(seen.values()));
      }
    } catch {}
    finally { setSessionsLoading(false); }
  }, []);

  async function handleRevokeSession(sessionId: string) {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    setRevokingId(sessionId);
    try {
      const browserId = getBrowserId();
      const res = await fetch(`/api/seller/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "x-browser-id": browserId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
      toast({ title: "Sessão encerrada", description: "Dispositivo desconectado." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setRevokingId(null); }
  }

  async function handleRevokeAllOther() {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    setRevokingAll(true);
    try {
      const browserId = getBrowserId();
      const res = await fetch("/api/seller/sessions", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "x-browser-id": browserId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessions(prev => prev.filter(s => s.isCurrent));
      toast({ title: `${data.count} sessão(ões) encerrada(s)` });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setRevokingAll(false); }
  }

  // ── 2FA ──────────────────────────────────────────────────────────────────

  async function handleStart2FA() {
    setMfaLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Não autenticado");
      const res = await fetch("/api/seller/totp/setup", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQrDataUrl(data.qrCodeDataUrl);
      setBackupCodes(data.backupCodes || []);
      setOtpCode("");
      setEnrollStep("qr");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setMfaLoading(false); }
  }

  async function handleVerifyOtp() {
    if (otpCode.length !== 6) {
      toast({ title: "Código inválido", description: "Digite os 6 dígitos.", variant: "destructive" });
      return;
    }
    setMfaLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Não autenticado");
      const res = await fetch("/api/seller/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Código incorreto");
      setMfaEnrolled(true);
      setEnrollStep("done");
      setOtpCode("");
      toast({ title: "2FA ativado!", description: "Autenticação de dois fatores ativada." });
    } catch (err: any) {
      toast({ title: "Código incorreto", description: err.message, variant: "destructive" });
    } finally { setMfaLoading(false); }
  }

  async function handleDisable2FA() {
    if (disableCode.length !== 6) {
      toast({ title: "Código necessário", description: "Digite o código do autenticador.", variant: "destructive" });
      return;
    }
    setMfaLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Não autenticado");
      const res = await fetch("/api/seller/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMfaEnrolled(false);
      setEnrollStep("idle");
      setDisableCode("");
      toast({ title: "2FA desativado" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setMfaLoading(false); }
  }

  // ── Password reset ────────────────────────────────────────────────────────

  async function handleResetPassword() {
    const currentUser = auth.currentUser;
    if (!currentUser?.email) return;
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      setResetSent(true);
      toast({ title: "E-mail enviado!", description: `Link enviado para ${currentUser.email}` });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setResetLoading(false); }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const uid = user?.uid || "";
  const avatarSrc =
    profile.profilePhoto ||
    profile.photoURL ||
    profile.documentsUrls?.selfieWithDocument ||
    user?.photoURL ||
    undefined;

  const getInitials = (email?: string) =>
    email ? email.substring(0, 2).toUpperCase() : "US";

  const pixFee = profile.financialSettings?.customFees?.pix;
  const cardFee = profile.financialSettings?.customFees?.cardBR;
  const withdrawDays = profile.financialSettings?.withdrawalDelayDays?.pix;

  const kycSent = !!(
    profile.documentsUrls?.documentFront ||
    profile.documentsUrls?.documentBack ||
    profile.documentsUrls?.selfieWithDocument
  );

  const googleConnected = !!user?.providerData?.find((p: any) => p?.providerId === "google.com");

  const statusLabel: Record<string, string> = {
    pending: "Em análise",
    approved: "Aprovado",
    rejected: "Rejeitado",
  };
  const statusColor: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    approved: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const search = useSearch();
  const [activeTab, setActiveTab] = useState<"conta" | "auth" | "kyc" | "seguranca" | "empresa" | "equipe" | "integracoes">("conta");

  useEffect(() => {
    const params = new URLSearchParams(search);
    const tab = params.get("tab");
    if (tab === "auth" || tab === "kyc" || tab === "seguranca" || tab === "empresa") {
      setActiveTab(tab);
    } else {
      setActiveTab("conta");
    }
  }, [search]);

  const TABS = [
    { key: "conta",        label: "Conta",         icon: User,       href: undefined },
    { key: "auth",         label: "Autenticação",   icon: ShieldCheck,href: undefined },
    { key: "kyc",          label: "KYC",            icon: FileText,   href: undefined },
    { key: "seguranca",    label: "Segurança",      icon: KeyRound,   href: undefined },
    { key: "empresa",      label: "Empresa",        icon: Building2,  href: undefined },
    { key: "equipe",       label: "Equipe",         icon: Users,      href: undefined },
    { key: "integracoes",  label: "Integrações",    icon: Zap,        href: undefined },
  ];

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="px-3 md:px-6 py-4 md:py-6 space-y-5 min-h-screen bg-background">

        {/* ══ PROFILE HEADER ══════════════════════════════════════════════ */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-0.5">Configurações</p>
            <h1 className="text-2xl font-bold text-foreground">Minha conta</h1>
          </div>
        </div>

        {/* ══ PROFILE CARD ════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-border bg-card px-5 py-4 flex items-center gap-4">
          <div className="relative group shrink-0">
            <Avatar className="h-14 w-14 border-2 border-border">
              <AvatarImage src={avatarSrc} />
              <AvatarFallback className="text-base bg-muted font-semibold">
                {getInitials(user?.email)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
              <Camera className="h-4 w-4 text-white" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{profile.name || user?.email}</p>
            <p className="text-xs text-muted-foreground truncate">{profile.email || user?.email}</p>
          </div>
          {profile.status && (
            <Badge className={`text-[10px] px-2 py-0.5 border font-normal shrink-0 ${statusColor[profile.status] || statusColor.pending}`}>
              {statusLabel[profile.status] || profile.status}
            </Badge>
          )}
        </div>

        {/* ══ TABS ════════════════════════════════════════════════════════ */}
        <div className="flex gap-1 border-b border-border overflow-x-auto no-scrollbar">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* ══ TAB: CONTA ══════════════════════════════════════════════════ */}
        {activeTab === "conta" && (
          <div className="rounded-xl border border-border bg-card px-5 py-5 space-y-5">
            {profileLoading ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Nome" value={profile.name} />
                  <Field label="E-mail" value={profile.email || user?.email || undefined} />
                  <Field label="Criado em" value={formatDate(profile.createdAt)} />
                  <Field label="Último login" value={timeAgo(profile.lastLoginAt)} />
                  <Field label="ID da conta" value={uid} copyable mono />
                  <Field label="Função" value={profile.isApproved ? "Vendedor" : "Vendedor (pendente)"} />
                </div>
                <Separator />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Taxas</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Taxa PIX (%)" value={pixFee?.percentFee !== undefined ? `${pixFee.percentFee.toFixed(2)}%` : "-"} />
                  <Field label="Taxa fixa" value={pixFee?.fixedFee !== undefined ? `R$ ${pixFee.fixedFee.toFixed(2)}` : "-"} />
                  <Field label="Taxa de saque" value={cardFee?.percentFee !== undefined ? `R$ ${cardFee.percentFee.toFixed(2)}` : "-"} />
                  {withdrawDays !== undefined && (
                    <Field label="Prazo de saque" value={`${withdrawDays} dias úteis`} />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ TAB: AUTENTICAÇÃO ═══════════════════════════════════════════ */}
        {activeTab === "auth" && (
          <div className="rounded-xl border border-border bg-card px-5 py-5 space-y-3">

            {/* Google row */}
            <div className="flex items-center gap-4 p-3 rounded-lg border bg-card">
              <div className="h-9 w-9 rounded-full bg-white flex items-center justify-center shrink-0 border">
                <svg viewBox="0 0 24 24" className="h-4 w-4">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Login social</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <Badge variant="outline" className={`text-[10px] shrink-0 ${googleConnected ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-muted-foreground"}`}>
                {googleConnected ? "Conectado" : "Não conectado"}
              </Badge>
            </div>

            {/* MFA row */}
            <div className="flex items-center gap-4 p-3 rounded-lg border bg-card">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                <ShieldCheck className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Autenticação multifator (MFA)</p>
                  <Badge className={`text-[10px] px-1.5 py-0 ${mfaEnrolled ? "bg-blue-500/20 text-blue-400 border-blue-500/30 border" : "bg-muted text-muted-foreground"}`}>
                    {mfaEnrolled ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Autenticação de dois fatores</p>
              </div>
              <Badge variant="outline" className={`text-[10px] shrink-0 ${mfaEnrolled ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-muted-foreground"}`}>
                {mfaEnrolled ? "Conectado" : "Desconectado"}
              </Badge>
            </div>

            {/* 2FA QR setup */}
            {enrollStep === "qr" && (
              <div className="rounded-lg border p-4 space-y-4 bg-card">
                <p className="text-sm font-medium">
                  1. Abra o <strong>Google Authenticator</strong> ou <strong>Authy</strong> e escaneie o QR Code:
                </p>
                {qrDataUrl && (
                  <div className="flex justify-center">
                    <img src={qrDataUrl} alt="QR Code 2FA" className="rounded border w-[200px] h-[200px]" />
                  </div>
                )}
                <p className="text-sm font-medium">2. Digite o código de 6 dígitos:</p>
                <Input
                  type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                  value={otpCode} autoFocus
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                  className="text-center text-xl tracking-widest font-mono w-36"
                />
                <div className="flex gap-2">
                  <Button onClick={handleVerifyOtp} size="sm" disabled={mfaLoading || otpCode.length !== 6}>
                    {mfaLoading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    <QrCode className="mr-2 h-3.5 w-3.5" />
                    Verificar e Ativar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setEnrollStep("idle"); setOtpCode(""); }}>
                    Cancelar
                  </Button>
                </div>
                {backupCodes.length > 0 && (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-yellow-500">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <p className="text-xs font-semibold">Salve seus códigos de backup - exibidos apenas uma vez:</p>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {backupCodes.map((c) => (
                        <code key={c} className="text-[10px] font-mono bg-muted px-1.5 py-1 rounded text-center">{c}</code>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {enrollStep === "done" && (
              <div className="flex items-center gap-2 text-green-500 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                2FA configurado com sucesso!
              </div>
            )}

            {/* Actions */}
            {enrollStep === "idle" && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!mfaEnrolled ? (
                  <Button size="sm" variant="outline" onClick={handleStart2FA} disabled={mfaLoading}>
                    {mfaLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-2 h-3.5 w-3.5" />}
                    Ativar 2FA
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      type="text" inputMode="numeric" maxLength={6} placeholder="Código do app"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={(e) => e.key === "Enter" && handleDisable2FA()}
                      className="text-center font-mono w-36 h-8 text-sm"
                    />
                    <Button
                      size="sm" variant="outline"
                      onClick={handleDisable2FA}
                      disabled={mfaLoading || disableCode.length !== 6}
                      className="text-destructive border-destructive hover:bg-destructive/10 h-8"
                    >
                      {mfaLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="mr-2 h-3.5 w-3.5" />}
                      Desativar 2FA
                    </Button>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Compatível com Google Authenticator, Authy e outros apps TOTP.
            </p>
          </div>
        )}

        {/* ══ TAB: KYC ════════════════════════════════════════════════════ */}
        {activeTab === "kyc" && (
          <div className="rounded-xl border border-border bg-card px-5 py-5 space-y-6">
            {!kycSent && (
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Documentos ainda não enviados. Verifique sua conta para liberar saques.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Telefone" value={profile.phone} />
              <Field label="Nome legal" value={profile.legalName || profile.name} />
              <Field label="CEP" value={profile.zipCode} />
              <Field label="CPF / CNPJ" value={maskDocument(profile.document)} />
              <Field label="Endereço" value={profile.address} />
              <Field label="Cidade" value={profile.city} />
            </div>
            <Separator />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Documentos enviados</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <DocCard label="RG / CNH (frente)" url={profile.documentsUrls?.documentFront} />
              <DocCard label="RG / CNH (verso)" url={profile.documentsUrls?.documentBack} />
              <DocCard label="Selfie com doc." url={profile.documentsUrls?.selfieWithDocument} />
              <DocCard label="CNPJ / Contrato" url={profile.documentsUrls?.cnpjCard} />
            </div>
            {!kycSent && (
              <Button variant="outline" size="sm" onClick={() => setShowVerifModal(true)}>
                <FileText className="mr-2 h-3.5 w-3.5" />
                Verificar conta
              </Button>
            )}
          </div>
        )}

        {/* ══ TAB: SEGURANÇA ══════════════════════════════════════════════ */}
        {activeTab === "seguranca" && (
          <div className="rounded-xl border border-border bg-card px-5 py-5 space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Redefinir senha</p>
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Enviar link de redefinição</p>
                  <p className="text-xs text-muted-foreground">Para <strong>{user?.email}</strong></p>
                </div>
                {resetSent ? (
                  <div className="flex items-center gap-1 text-green-500 text-xs font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Enviado!
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={handleResetPassword} disabled={resetLoading} className="h-8">
                    {resetLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sessões ativas</p>
                <div className="flex items-center gap-2">
                  <button onClick={loadSessions} disabled={sessionsLoading} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
                    <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? "animate-spin" : ""}`} />
                  </button>
                  {sessions.filter(s => !s.isCurrent).length > 0 && (
                    <Button variant="outline" size="sm" onClick={handleRevokeAllOther} disabled={revokingAll}
                      className="h-7 text-[11px] text-destructive border-destructive hover:bg-destructive/10 px-2">
                      {revokingAll && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Encerrar outras
                    </Button>
                  )}
                </div>
              </div>
              {sessionsLoading && sessions.length === 0 ? (
                <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando sessões...
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Nenhuma sessão registrada.</p>
              ) : (
                <div className="space-y-2">
                  {sessions.map(session => (
                    <div key={session.sessionId}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${session.isCurrent ? "border-blue-500/40 bg-blue-500/5" : "bg-muted/20"}`}>
                      <DeviceIcon device={session.device} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{session.isCurrent ? "Sessão atual" : `${session.browser} · ${session.os}`}</p>
                          {session.isCurrent && (
                            <Badge className="text-[9px] h-4 px-1.5 bg-blue-600 hover:bg-blue-600 text-white">Ativo agora</Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Monitor className="h-3 w-3" />{session.ip}</span>
                          {session.locationLabel && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{session.locationLabel}</span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Globe className="h-3 w-3" />
                            {session.isCurrent ? `${session.browser} · ${session.os}` : timeAgo(session.lastActiveAt)}
                          </span>
                        </div>
                      </div>
                      {!session.isCurrent && (
                        <Button variant="ghost" size="sm" onClick={() => handleRevokeSession(session.sessionId)}
                          disabled={revokingId === session.sessionId}
                          className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2">
                          {revokingId === session.sessionId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ TAB: EMPRESA ════════════════════════════════════════════════ */}
        {activeTab === "empresa" && (
          <div className="rounded-xl border border-border bg-card px-5 py-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nome da empresa" value={profile.businessName} />
              <Field label="Nicho" value={profile.businessNiche} />
              <Field label="Tipo de documento" value={profile.documentType} />
            </div>
          </div>
        )}

        {/* ══ TAB: EQUIPE ══════════════════════════════════════════════════ */}
        {activeTab === "equipe" && (
          <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>}>
            <TeamPage />
          </Suspense>
        )}

        {/* ══ TAB: INTEGRAÇÕES ═════════════════════════════════════════════ */}
        {activeTab === "integracoes" && (
          <Suspense fallback={<div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>}>
            <IntegrationsPage inline />
          </Suspense>
        )}

      </div>

      <AccountVerificationModal
        open={showVerifModal}
        onOpenChange={setShowVerifModal}
        onComplete={() => {
          setShowVerifModal(false);
          // Recarregar perfil para refletir documentos enviados
          if (user) {
            auth.currentUser?.getIdToken().then(token => {
              fetch(`/api/sellers/${user.uid}`, {
                headers: { Authorization: `Bearer ${token}` },
              }).then(r => r.ok ? r.json() : null).then(data => {
                if (data) setProfile(data);
              }).catch(() => {});
            });
          }
        }}
      />

    </DashboardLayout>
  );
}
