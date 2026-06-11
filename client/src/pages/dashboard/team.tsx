import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import {
  SELLER_TEAM_ROLES,
  SELLER_TEAM_ROLE_LABELS,
  SELLER_TEAM_ROLE_DESCRIPTIONS,
  MAX_SELLER_TEAM_MEMBERS,
  type SellerTeamRole,
  type SellerTeamMember,
} from "@shared/seller-roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, RefreshCw, ShieldCheck } from "lucide-react";


async function getToken() {
  return await auth.currentUser?.getIdToken();
}

export default function TeamPage() {
  const { user } = useAuthStore();
  const [members, setMembers] = useState<SellerTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "" as SellerTeamRole | "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/seller/team/members", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        const data = await res.json();
        setError(data.error || "Acesso negado");
        return;
      }
      if (!res.ok) throw new Error("Erro ao carregar membros");
      const data = await res.json();
      setMembers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchMembers();
  }, [user]);

  const handleInvite = async () => {
    setFormError(null);
    if (!form.name.trim() || !form.email.trim() || !form.password.trim() || !form.role) {
      setFormError("Preencha todos os campos");
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/seller/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Erro ao criar membro");
        return;
      }
      setShowModal(false);
      setForm({ name: "", email: "", password: "", role: "" });
      fetchMembers();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (memberId: string) => {
    if (!confirm("Remover este membro da equipe?")) return;
    setDeleting(memberId);
    try {
      const token = await getToken();
      const res = await fetch(`/api/seller/team/${memberId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Erro ao remover membro");
        return;
      }
      fetchMembers();
    } catch {
      alert("Erro ao remover membro");
    } finally {
      setDeleting(null);
    }
  };

  const handleRoleChange = async (memberId: string, role: SellerTeamRole) => {
    try {
      const token = await getToken();
      await fetch(`/api/seller/team/${memberId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      fetchMembers();
    } catch {
      alert("Erro ao alterar cargo");
    }
  };

  const activeMembersCount = members.filter(m => m.active).length;
  const canAdd = activeMembersCount < MAX_SELLER_TEAM_MEMBERS;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Equipe</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gerencie quem acessa sua conta — até {MAX_SELLER_TEAM_MEMBERS} membros
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchMembers} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            onClick={() => setShowModal(true)}
            disabled={!canAdd || loading}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Adicionar membro
          </Button>
        </div>
      </div>

      {/* Aviso de conta não aprovada */}
      {error && error.includes("aprovada") && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <ShieldCheck className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">KYC necessário</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Sua conta precisa ser aprovada antes de criar uma equipe.
            </p>
          </div>
        </div>
      )}

      {/* Contador */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Users className="w-4 h-4" />
        <span>{activeMembersCount} de {MAX_SELLER_TEAM_MEMBERS} membros usados</span>
        <div className="flex gap-1 ml-2">
          {Array.from({ length: MAX_SELLER_TEAM_MEMBERS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-6 rounded-full ${i < activeMembersCount ? "bg-blue-500" : "bg-gray-200"}`}
            />
          ))}
        </div>
      </div>

      {/* Cargos — explicação rápida */}
      <div className="grid grid-cols-3 gap-3">
        {Object.values(SELLER_TEAM_ROLES).map((role) => (
          <div key={role} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="font-medium text-sm text-gray-900">{SELLER_TEAM_ROLE_LABELS[role]}</p>
            <p className="text-xs mt-1 text-gray-500">{SELLER_TEAM_ROLE_DESCRIPTIONS[role]}</p>
          </div>
        ))}
      </div>

      {/* Lista de membros */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : error && !error.includes("aprovada") ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : members.filter(m => m.active).length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center">
          <Users className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Nenhum membro na equipe ainda</p>
          <p className="text-xs text-gray-400 mt-1">Clique em "Adicionar membro" para começar</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members
            .filter(m => m.active)
            .map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-600">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{member.name}</p>
                    <p className="text-xs text-gray-400">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    value={member.role}
                    onValueChange={(v) => handleRoleChange(member.id, v as SellerTeamRole)}
                  >
                    <SelectTrigger className="h-8 text-xs w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(SELLER_TEAM_ROLES).map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">
                          {SELLER_TEAM_ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    disabled={deleting === member.id}
                    onClick={() => handleDelete(member.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Modal: adicionar membro */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar membro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nome completo</Label>
              <Input
                placeholder="João Silva"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email de acesso</Label>
              <Input
                type="email"
                placeholder="joao@email.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Senha provisória</Label>
              <Input
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cargo</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm(f => ({ ...f, role: v as SellerTeamRole }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar cargo" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(SELLER_TEAM_ROLES).map(r => (
                    <SelectItem key={r} value={r}>
                      <div>
                        <span className="font-medium">{SELLER_TEAM_ROLE_LABELS[r]}</span>
                        <span className="text-xs text-gray-500 ml-2">{SELLER_TEAM_ROLE_DESCRIPTIONS[r]}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { setShowModal(false); setFormError(null); }}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={handleInvite} disabled={saving}>
                {saving ? "Criando..." : "Criar membro"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
