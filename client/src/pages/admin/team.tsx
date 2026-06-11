import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Users, Search, Plus, KeyRound, Shield, Briefcase } from "lucide-react";
import { ROLES, ROLE_LABELS, ROLE_COLORS, PERMISSIONS, Role } from "@shared/roles";
import { useUserRole } from "@/hooks/use-user-role";

interface TeamMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export default function TeamPage() {
  const { isCEO, hasPermission, isLoading: roleLoading } = useUserRole();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  const canManageTeam = isCEO || hasPermission(PERMISSIONS.MANAGE_TEAM);

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/admin/team/members"],
    enabled: canManageTeam,
  });

  const createMemberMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password: string; role: Role }) => {
      return apiRequest("/api/admin/team/create-user", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team/members"] });
      setIsCreateDialogOpen(false);
      toast({ title: "Sucesso!", description: "Membro criado com sucesso!" });
    },
    onError: (error: any) => {
      toast({ title: "Erro!", description: error.message || "Erro ao criar membro", variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      return apiRequest(`/api/admin/team/${userId}/change-password`, "PATCH", { password });
    },
    onSuccess: () => {
      setIsPasswordDialogOpen(false);
      setSelectedMember(null);
      toast({ title: "Sucesso!", description: "Senha alterada com sucesso!" });
    },
    onError: (error: any) => {
      toast({ title: "Erro!", description: error.message || "Erro ao alterar senha", variant: "destructive" });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createMemberMutation.mutate({
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      role: formData.get("role") as Role,
    });
  };

  const handlePasswordSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedMember) return;
    const formData = new FormData(e.currentTarget);
    changePasswordMutation.mutate({ userId: selectedMember.userId, password: formData.get("password") as string });
  };

  const filteredMembers = members.filter((member) =>
    member.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    member.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (roleLoading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <p className="text-muted-foreground">Verificando permissões...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canManageTeam) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12">
            <Shield className="w-16 h-16 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Acesso Negado</h2>
            <p className="text-muted-foreground text-center">
              Você não tem permissão para acessar esta página.<br />
              Apenas o CEO Fundador ou administradores com permissão de equipe podem acessar.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Gestão de Equipe
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerencie membros da equipe, cargos e permissões
          </p>
        </div>

        {isCEO && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-member">
                <Plus className="w-4 h-4 mr-2" />
                Novo Membro
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreateSubmit}>
                <DialogHeader>
                  <DialogTitle>Criar Novo Membro</DialogTitle>
                  <DialogDescription>
                    Crie uma nova conta de equipe com cargo e permissões
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome Completo</Label>
                    <Input id="name" name="name" placeholder="João Silva" required data-testid="input-member-name" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" placeholder="joao@exemplo.com" required data-testid="input-member-email" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Senha Inicial</Label>
                    <Input id="password" name="password" type="password" placeholder="********" minLength={6} required data-testid="input-member-password" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">Cargo</Label>
                    <Select name="role" required>
                      <SelectTrigger data-testid="select-member-role">
                        <SelectValue placeholder="Selecione um cargo" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLE_LABELS)
                          .filter(([key]) => key !== ROLES.CEO_FOUNDER)
                          .map(([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={createMemberMutation.isPending} data-testid="button-submit-create">
                    {createMemberMutation.isPending ? "Criando..." : "Criar Membro"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* CARGOS DISPONÍVEIS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Cargos e Permissões
          </CardTitle>
          <CardDescription>Hierarquia de acesso dos membros da equipe</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(ROLE_LABELS)
              .filter(([key]) => key !== ROLES.CEO_FOUNDER)
              .map(([key, label]) => {
                const role = key as Role;
                return (
                  <div key={key} className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/30">
                    <Badge className={`${ROLE_COLORS[role]} w-fit text-xs`}>{label}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {role === ROLES.ADMIN && "Acesso total (exceto equipe)"}
                      {role === ROLES.MANAGER && "Sellers + Financeiro + Produtos"}
                      {role === ROLES.FINANCIAL && "Dashboard + Transações + Saques"}
                      {role === ROLES.DEVELOPER && "Acesso técnico completo"}
                      {role === ROLES.MODERATOR && "Suporte + Sellers + Produtos (leitura)"}
                      {role === ROLES.SUPPORT && "Central de Atendimento apenas"}
                    </p>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buscar Membros</CardTitle>
          <CardDescription>Pesquise por nome ou email</CardDescription>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Pesquisar por email ou nome..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-members"
            />
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Carregando membros...</p>
          </CardContent>
        </Card>
      ) : filteredMembers.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? "Nenhum membro encontrado" : "Nenhum membro cadastrado"}
            </p>
            {!searchQuery && isCEO && (
              <p className="text-xs text-muted-foreground mt-2">
                Clique em "Novo Membro" para adicionar o primeiro membro da equipe.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredMembers.map((member) => (
            <Card key={member.id} data-testid={`card-member-${member.id}`}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold">{member.name}</h3>
                      <Badge className={ROLE_COLORS[member.role]}>
                        {ROLE_LABELS[member.role]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Criado em: {new Date(member.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                    {member.permissions && member.permissions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {member.permissions.slice(0, 5).map((perm) => (
                          <Badge key={perm} variant="outline" className="text-xs">
                            {perm.replace(/_/g, ' ').toLowerCase()}
                          </Badge>
                        ))}
                        {member.permissions.length > 5 && (
                          <Badge variant="outline" className="text-xs">
                            +{member.permissions.length - 5} mais
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {isCEO && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedMember(member);
                          setIsPasswordDialogOpen(true);
                        }}
                        data-testid={`button-change-password-${member.id}`}
                      >
                        <KeyRound className="w-4 h-4 mr-2" />
                        Alterar Senha
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isCEO && (
        <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
          <DialogContent>
            <form onSubmit={handlePasswordSubmit}>
              <DialogHeader>
                <DialogTitle>Alterar Senha</DialogTitle>
                <DialogDescription>
                  Definir nova senha para {selectedMember?.name}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="password-new">Nova Senha</Label>
                  <Input
                    id="password-new"
                    name="password"
                    type="password"
                    placeholder="********"
                    minLength={6}
                    required
                    data-testid="input-new-password"
                  />
                  <p className="text-xs text-muted-foreground">Mínimo de 6 caracteres</p>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setIsPasswordDialogOpen(false); setSelectedMember(null); }}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={changePasswordMutation.isPending} data-testid="button-submit-password">
                  {changePasswordMutation.isPending ? "Alterando..." : "Alterar Senha"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
