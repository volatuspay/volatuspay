import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Mail, Calendar, Badge as BadgeIcon, Eye, Trash2, Phone, ArrowLeft, UserPlus } from "lucide-react";
import { auth } from "@/lib/firebase"; //  IMPORT FIREBASE AUTH
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/ui/empty-state";
import { ApprovalBanner } from "@/components/seller/approval-banner";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useTenantStore } from "@/stores/tenant";
import { useState } from "react";
import { Link } from "wouter";
import type { Member, Product } from "@shared/schema";
import { useCustomDialog } from "@/hooks/use-custom-dialog";

export default function MembersPage() {
  const { showConfirm } = useCustomDialog();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sellerApprovalStatus, setSellerApprovalStatus] = useState<'pending' | 'approved' | 'rejected' | 'not_seller'>('approved');
  const [showAllMembers, setShowAllMembers] = useState(false);
  
  //  ESTADOS PARA ADICIONAR ALUNO
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [studentEmail, setStudentEmail] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentPhone, setStudentPhone] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string>(""); // Produto selecionado dinmico
  
  const { tenant } = useTenantStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: members = [], isLoading } = useQuery<(Member & { 
    accesses: any[] 
  })[]>({
    queryKey: ["/api/members"],
    enabled: !!tenant?.id,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/members/stats"],
    enabled: !!tenant?.id,
  });

  //  BUSCAR PRODUTOS DO TENANT PARA SELEÇÃO
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    enabled: !!tenant?.id,
  });


  //  FUNÇÃO PREMIUM: ADICIONAR ALUNO MANUAL AO PRODUTO SELECIONADO
  const handleAddStudent = async () => {
    if (!studentEmail || !studentName || !selectedProductId) {
      toast({
        title: " Dados obrigatórios", 
        description: "Email, nome e produto são obrigatórios",
        variant: "destructive",
      });
      return;
    }

    try {
      console.log(" PREMIUM: Adicionando aluno manual:", { studentEmail, studentName, studentPhone, selectedProductId });
      
      //  OBTER TOKEN DE AUTENTICAÇÃO FIREBASE
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('Token de autenticação não encontrado');
      }

      const response = await fetch('/api/premium/add-student', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` //  TOKEN SEGURO
        },
        body: JSON.stringify({
          email: studentEmail.toLowerCase().trim(),
          name: studentName.trim(),
          phone: studentPhone.trim(),
          productId: selectedProductId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao adicionar aluno');
      }

      toast({
        title: " Aluno adicionado com sucesso!",
        description: `${studentName} agora tem acesso ao produto e pode v-lo em "Minhas Compras"`,
      });

      // Limpar formulrio e fechar modal
      setStudentEmail("");
      setStudentName("");
      setStudentPhone("");
      setSelectedProductId("");
      setAddStudentOpen(false);
      
      // Atualizar lista de membros
      queryClient.invalidateQueries({ queryKey: ["/api/members"] });

    } catch (error: any) {
      console.error(" Erro ao adicionar aluno:", error);
      
      // Tratar especificamente erro de email no cadastrado
      if (error.message?.includes('Email no cadastrado') || error.message?.includes('não está cadastrado')) {
        toast({
          title: " Email no cadastrado na VolatusPay",
          description: ` "${studentEmail}" não encontrado!

Envie o link para a pessoa se cadastrar:
https://volatuspay.com

Pode se cadastrar fazendo uma compra ou criando conta de vendedor.

 Semails jcadastrados podem ser adicionados!`,
          variant: "destructive",
          duration: 10000, // 10 segundos para dar tempo de ler e copiar o link
        });
      } else {
        toast({
          title: " Erro ao adicionar aluno",
          description: error.message || "Verifique se o email está cadastrado na VolatusPay",
          variant: "destructive",
        });
      }
    }
  };

  const filteredMembers = members.filter(member => {
    const matchesSearch = member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         member.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (statusFilter === "all") return matchesSearch;
    
    const hasActiveAccess = member.accesses.some(access => access.active);
    if (statusFilter === "active") return matchesSearch && hasActiveAccess;
    if (statusFilter === "inactive") return matchesSearch && !hasActiveAccess;
    
    return matchesSearch;
  });

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="h-screen flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" aria-label="Carregando"/>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* BANNER DE APROVAÇÃO */}
      <ApprovalBanner onStatusChange={setSellerApprovalStatus} />
      
      <div className="px-3 md:px-4 space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => window.history.back()}
            className="text-[#2563eb] hover:text-[#2563eb] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-xl md:text-3xl font-bold zen-gradient bg-clip-text text-transparent">
              Membros
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Gerencie todos os membros e seus acessos
            </p>
          </div>
        </div>
      </div>

      {stats && typeof stats === 'object' && (
        <div className="grid gap-3 md:gap-4 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Membros</CardTitle>
              <Users className="h-4 w-4 text-[#2563eb]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats as any)?.totalMembers || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Membros Ativos</CardTitle>
              <BadgeIcon className="h-4 w-4 text-[#2563eb]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">{(stats as any)?.activeMembers || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Novos Este Ms</CardTitle>
              <Calendar className="h-4 w-4 text-[#2563eb]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">{(stats as any)?.newThisMonth || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Taxa de Atividade</CardTitle>
              <BadgeIcon className="h-4 w-4 text-[#2563eb]" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">
                {(stats as any)?.totalMembers > 0 
                  ? `${Math.round(((stats as any)?.activeMembers / (stats as any)?.totalMembers) * 100)}%`
                  : "0%"
                }
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center">
        <Input
          placeholder="Buscar por nome ou email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full sm:max-w-sm"
          data-testid="input-search-members"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-member-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
        
        <div className="flex flex-col sm:flex-row gap-2 sm:ml-auto">
          <Button
            variant="outline"
            onClick={() => setShowAllMembers(!showAllMembers)}
            className="flex items-center gap-2 w-full sm:w-auto"
            data-testid="button-list-all-members"
          >
            <Eye className="h-4 w-4" />
            {showAllMembers ? "Ocultar Lista" : "Listar Todos"}
          </Button>
          <Dialog open={addStudentOpen} onOpenChange={setAddStudentOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="bg-gradient-to-r from-lime-50 to-blue-50 border-blue-200 hover:from-lime-100 hover:to-blue-100 text-[#2563eb] hover:text-[#2563eb] w-full sm:w-auto"
                data-testid="button-add-student"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Adicionar Aluno
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Aluno Manual</DialogTitle>
                <DialogDescription>
                  Adicione um aluno manualmente a um produto especfico. O email deve estar cadastrado na VolatusPay.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="product-select">Produto *</Label>
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger data-testid="select-product">
                      <SelectValue placeholder="Selecione um produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.filter(p => p.hasAccess).map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.title} ({product.productType})
                        </SelectItem>
                      ))}
                      {products.filter(p => p.hasAccess).length === 0 && (
                        <SelectItem value="no-products" disabled>
                          Nenhum produto com área de membros encontrado
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-brand-muted-foreground">Apenas produtos com área de membros habilitada</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="student-email">Email do Aluno *</Label>
                  <Input
                    id="student-email"
                    type="email"
                    placeholder="aluno@exemplo.com"
                    value={studentEmail}
                    onChange={(e) => setStudentEmail(e.target.value)}
                    data-testid="input-student-email"
                  />
                  <p className="text-sm text-muted-foreground"><strong>Importante:</strong> Deve ser um email jcadastrado na VolatusPay</p>
                  <p className="text-xs text-brand-muted-foreground">Se não estiver cadastrado, envie o link: https://volatuspay.com</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="student-name">Nome Completo *</Label>
                  <Input
                    id="student-name"
                    placeholder="Nome do Aluno"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    data-testid="input-student-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="student-phone">Telefone</Label>
                  <Input
                    id="student-phone"
                    placeholder="(11) 99999-9999"
                    value={studentPhone}
                    onChange={(e) => setStudentPhone(e.target.value)}
                    data-testid="input-student-phone"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-4">
                  <Button variant="outline" onClick={() => setAddStudentOpen(false)}>
                    Cancelar
                  </Button>
                  <Button 
                    onClick={() => handleAddStudent()}
                    disabled={!studentEmail || !studentName || !selectedProductId}
                    className="bg-gradient-to-r from-[#2563eb] to-[#2563eb] hover:from-muted hover:to-muted"
                    data-testid="button-confirm-add-student"
                  >
                    Adicionar Aluno
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* All Members Cards View */}
      {showAllMembers && filteredMembers.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Lista Completa de Alunos
            </CardTitle>
            <CardDescription>
              {filteredMembers.length} aluno(s) encontrado(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredMembers.map((member) => {
                const activeAccesses = member.accesses.filter(access => access.active);
                const hasActiveAccess = activeAccesses.length > 0;
                
                return (
                  <Card key={member.id} className="border border-brand-muted hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <Users className="h-5 w-5 text-[#2563eb]" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-sm">{member.name}</h3>
                            <Badge 
                              variant={hasActiveAccess ? "default" : "secondary"}
                              className={`text-xs ${hasActiveAccess ? "bg-blue-100 text-[#2563eb]" : ""}`}
                            >
                              {hasActiveAccess ? "Ativo" : "Inativo"}
                            </Badge>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            const confirmed = await showConfirm(`Tem certeza que deseja remover ${member.name}?`, 'Confirmar remoo');
                            if (confirmed) {
                              console.log('Remover aluno:', member.id);
                              // TODO: Implementar remoo do aluno
                            }
                          }}
                          data-testid={`button-remove-student-${member.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Mail className="h-3 w-3" />
                          <span className="truncate">{member.email}</span>
                        </div>
                        
                        {(member as any).phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-3 w-3" />
                            <span>{(member as any).phone}</span>
                          </div>
                        )}
                        
                        <div className="text-xs">
                          Cadastrado em {new Date(member.createdAt).toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                      
                      {activeAccesses.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs font-medium mb-1">Produtos:</div>
                          <div className="flex flex-wrap gap-1">
                            {activeAccesses.map((access) => (
                              <Badge 
                                key={access.id} 
                                variant="outline"
                                className="text-xs"
                              >
                                {access.product.title}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members Table */}
      {filteredMembers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum membro encontrado"
          description={members.length === 0 
            ? "Os membros aparecerão aqui quando realizarem compras" 
            : "Tente ajustar os filtros de busca"
          }
        />
      ) : (
        <Card className={showAllMembers ? "hidden" : ""}>
          <CardHeader>
            <CardTitle>Membros</CardTitle>
            <CardDescription>
              {filteredMembers.length} membro(s) encontrado(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membro</TableHead>
                  <TableHead>Produtos Acessados</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data de Cadastro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((member) => {
                  const activeAccesses = member.accesses.filter(access => access.active);
                  const hasActiveAccess = activeAccesses.length > 0;
                  
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                            <Users className="h-4 w-4 text-[#2563eb]" />
                          </div>
                          <div>
                            <div className="font-medium">{member.name}</div>
                            <div className="text-sm text-muted-foreground flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {member.email}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {activeAccesses.length > 0 ? (
                            activeAccesses.map((access) => (
                              <Badge 
                                key={access.id} 
                                variant="outline"
                                className="text-xs"
                              >
                                {access.product.title}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm">Nenhum acesso ativo</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={hasActiveAccess ? "default" : "secondary"}
                          className={hasActiveAccess ? "bg-blue-100 text-[#2563eb]" : ""}
                        >
                          {hasActiveAccess ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(member.createdAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </DashboardLayout>
  );
}