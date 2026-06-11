import { useState, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
// Firebase functions replaced by REST API calls
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import AdminChatModal from "@/components/support/admin-chat-modal";
import ToastContainer from "@/components/ui/toast-container";
import { useCustomToast } from "@/hooks/use-custom-toast";
import { MessageSquare, AlertCircle, CheckCircle, Clock, User, Star, Calendar, Search, Trash2, Eye } from "lucide-react";
import { ADMIN_CONFIG } from "@shared/app-config";
import { SupportTicket } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

// Desconto: TIPOS EXPANDIDOS PARA UI
interface TicketWithPriority extends SupportTicket {
  priorityColor: string;
  categoryColor: string;
  timeAgo: string;
}

// ESTATSTICAS DO SUPORTE
interface SupportStats {
  totalTickets: number;
  openTickets: number;
  answeredTickets: number;
  closedTickets: number;
  emAtendimentoTickets: number;
  avgResponseTime: string;
  todayTickets: number;
}

export default function AdminSupport() {
  const queryClient = useQueryClient();
  const { toasts, removeToast, success, error, warning, info } = useCustomToast();
  
  const [stats, setStats] = useState<SupportStats>({
    totalTickets: 0,
    openTickets: 0,
    answeredTickets: 0,
    closedTickets: 0,
    avgResponseTime: "0h",
    todayTickets: 0,
    emAtendimentoTickets: 0
  });
  const [tickets, setTickets] = useState<TicketWithPriority[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketWithPriority | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'answered' | 'closed' | 'resolved'>('all');
  const [isClearing, setIsClearing] = useState(false);
  const [acceptingTicket, setAcceptingTicket] = useState<string | null>(null);
  
  // ESTADOS PARA CONFIRMAÇES CUSTOMIZADAS
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // CARREGAR TICKETS VIA API BACKEND AUTENTICADO
  const { data: backendData, isLoading: isLoadingBackend, error: backendError } = useQuery({
    queryKey: ['/api/support/tickets'],
    enabled: true // Sempre tentar executar - a autenticação é verificada no queryClient
  });

  useEffect(() => {
    console.log("useEffect executado - Estado atual:", {
      isLoadingBackend,
      hasBackendData: !!backendData,
      backendError: !!backendError,
      ticketsLength: tickets.length
    });

    // Desconto: PRIORIZAR DADOS DO BACKEND API 
    if (!isLoadingBackend && backendData) {
      console.log("SUCESSO: Dados do backend recebidos:", backendData);
      
      // VERIFICAR ESTRUTURA DA RESPOSTA DA API: { tickets: [...], total: 6 }
      const responseData = backendData as any;
      const ticketsArray = Array.isArray(responseData) ? responseData : 
                          (responseData?.tickets && Array.isArray(responseData.tickets) ? responseData.tickets : []);
      console.log("Processando", ticketsArray.length, "tickets do backend", {
        isArray: Array.isArray(responseData),
        hasTickets: !!responseData?.tickets,
        ticketsLength: responseData?.tickets?.length || 0
      });
      
      if (ticketsArray.length > 0) {
        // ADICIONAR PROPRIEDADES DE UI (DADOS DO BACKEND)
        const ticketsWithUI: TicketWithPriority[] = ticketsArray.map((ticket: any) => {
          // Converter strings de data para objetos Date
          const lastMessageAt = new Date(ticket.lastMessageAt || Date.now());
          const timeDiff = Date.now() - lastMessageAt.getTime();
          const hoursAgo = Math.floor(timeDiff / (1000 * 60 * 60));
          const minutesAgo = Math.floor(timeDiff / (1000 * 60));
          
          let timeAgo = "agora";
          if (hoursAgo > 0) {
            timeAgo = `${hoursAgo}h atrs`;
          } else if (minutesAgo > 0) {
            timeAgo = `${minutesAgo}min atrs`;
          }
          
          const priorityColor = ticket.priority === 'high' || ticket.priority === 'urgent' 
            ? "bg-red-100 text-red-700" 
            : "bg-yellow-100 text-yellow-700";
            
          const getCategoryColor = (category: string) => {
            switch (category) {
              case 'produto': return "bg-emerald-100 text-emerald-700";
              case 'financeiro': return "bg-blue-100 text-blue-700";
              case 'afiliado': return "bg-emerald-100 text-emerald-700";
              case 'taxas': return "bg-orange-100 text-orange-700";
              case 'technical': return "bg-red-100 text-red-700";
              default: return "bg-brand-subtle text-foreground";
            }
          };
          
          return {
            ...ticket,
            lastMessageAt, // Garantir que seja objeto Date
            createdAt: new Date(ticket.createdAt || Date.now()),
            priorityColor,
            categoryColor: getCategoryColor(ticket.category),
            timeAgo
          };
        });
        
        console.log("Desconto: APLICANDO TICKETS NO ESTADO:", ticketsWithUI.length);
        setTickets(ticketsWithUI);
        
        // CALCULAR ESTATSTICAS REAIS
        const today = new Date();
        const todayTickets = ticketsArray.filter((t: any) => {
          const ticketDate = new Date(t.createdAt);
          return ticketDate.toDateString() === today.toDateString();
        }).length;
        
        const newStats = {
          totalTickets: ticketsArray.length,
          openTickets: ticketsArray.filter((t: any) => t.status === 'open').length,
          answeredTickets: ticketsArray.filter((t: any) => t.status === 'answered').length,
          emAtendimentoTickets: ticketsArray.filter((t: any) => t.status === 'answered').length,
          closedTickets: ticketsArray.filter((t: any) => t.status === 'closed').length,
          avgResponseTime: "N/A",
          todayTickets
        };
        
        console.log("APLICANDO STATS NO ESTADO:", newStats);
        setStats(newStats);
      }
      
      setLoading(false);
      return;
    }

    // LOADING STATE
    if (isLoadingBackend) {
      console.log("Backend ainda carregando...");
      setLoading(true);
      return;
    }

    // ERRO NO BACKEND
    if (backendError) {
      console.error("Erro no backend, sistema funcionarem modo limitado:", backendError);
      setLoading(false);
      return;
    }

  }, [backendData, isLoadingBackend, backendError]);

  // LIMPAR TODOS OS TICKETS (VIA API)
  const handleClearAllTickets = () => {
    setShowClearAllConfirm(true);
  };

  const confirmClearAllTickets = async () => {
    setShowClearAllConfirm(false);
    setIsClearing(true);
    try {
      console.log("Iniciando limpeza de todos os tickets...");
      
      // Deletar todos os tickets individualmente via API
      const deletePromises = tickets.map(ticket => 
        apiRequest(`/api/support/tickets/${encodeURIComponent(ticket.id)}`, 'DELETE')
      );
      
      await Promise.all(deletePromises);
      
      console.log("Todos os tickets foram deletados com sucesso!");
      success('Limpeza concluída!', 'Todos os tickets foram deletados com sucesso.');
      
      // Atualizar lista local e cache
      setTickets([]);
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
    } catch (err) {
      console.error("Erro ao limpar tickets:", err);
      error('Erro na limpeza', 'Ocorreu um erro ao deletar os tickets. Tente novamente.');
    } finally {
      setIsClearing(false);
    }
  };

  // DELETAR TICKET INDIVIDUAL
  const handleDeleteTicket = (ticketId: string) => {
    setShowDeleteConfirm(ticketId);
  };

  const confirmDeleteTicket = async (ticketId: string) => {
    setShowDeleteConfirm(null);
    
    try {
      console.log("Deletando ticket:", ticketId);
      
      // Usar API REST para deletar ticket
      await apiRequest(`/api/support/tickets/${encodeURIComponent(ticketId)}`, 'DELETE');
      
      console.log("Ticket deletado com sucesso!");
      success('Ticket deletado!', 'O ticket e suas mensagens foram removidos permanentemente.');
      
      // Atualizar lista local e cache
      setTickets(prev => prev.filter(t => t.id !== ticketId));
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
    } catch (err) {
      console.error("Erro ao deletar ticket:", err);
      error('Erro ao deletar', 'No foi possvel deletar o ticket. Tente novamente.');
    }
  };

  // ACEITAR TICKET E ASSUMIR ATENDIMENTO
  const handleAcceptTicket = async (ticketId: string) => {
    setAcceptingTicket(ticketId);
    
    try {
      console.log("Admin aceitando ticket:", ticketId);
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        error('No autenticado', 'Vocprecisa estar logado para aceitar tickets.');
        return;
      }

      // Chamar API para atualizar status do ticket usando apiRequest (com encoding)
      const encodedTicketId = encodeURIComponent(ticketId);
      const response = await apiRequest(`/api/support/tickets/${encodedTicketId}/accept`, 'PATCH', {});
      const result = await response.json();

      console.log("Ticket aceito com sucesso!");
      success('Ticket aceito!', 'Vocagora estresponsvel por este atendimento.');
      
      // Atualizar estado local imediatamente para responsividade
      setTickets(prev => prev.map(ticket => 
        ticket.id === ticketId 
          ? { 
              ...ticket, 
              status: 'answered' as any,
              assignedAdminId: currentUser.uid,
              assignedAdminName: result.assignedAdmin || currentUser.displayName || currentUser.email || 'Admin'
            }
          : ticket
      ));
      
      // Atualizar query cache para sincronizar dados
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
      }, 1000);
      
    } catch (err) {
      console.error("Erro ao aceitar ticket:", err);
      error('Erro ao aceitar ticket', 'No foi possvel aceitar o ticket. Tente novamente.');
    } finally {
      setAcceptingTicket(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <Badge className="bg-red-100 text-red-700">Aberto</Badge>;
      case 'em_atendimento':
        return <Badge className="bg-blue-100 text-blue-700">Respondido</Badge>;
      case 'resolved':
        return <Badge className="bg-emerald-100 text-emerald-700">Resolvido</Badge>;
      case 'closed':
        return <Badge className="bg-brand-subtle text-foreground">Fechado</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels = {
      produto: "Produtos",
      financeiro: "Financeiro", 
      afiliado: "Afiliados",
      taxas: "Taxas",
      technical: "Técnico",
      geral: "Geral"
    } as const;
    
    return labels[category as keyof typeof labels] || category;
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-64 items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Carregando Central de Atendimento...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6" data-testid="admin-support-page">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Central de Atendimento</h1>
            <p className="text-muted-foreground">
              Gerencie todos os tickets de suporte dos sellers
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-sm">
              {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} ativo{tickets.length !== 1 ? 's' : ''}
            </Badge>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearAllTickets}
              disabled={isClearing || tickets.length === 0}
              data-testid="clear-all-tickets"
            >
              {isClearing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Limpar Todos
            </Button>
          </div>
        </div>

        {/* CARDS DE ESTATSTICAS */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Tickets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalTickets}</div>
              <p className="text-xs text-muted-foreground">
                +{stats.todayTickets} hoje
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tickets Abertos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.openTickets}</div>
              <p className="text-xs text-muted-foreground">
                Aguardando resposta
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Respondidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.answeredTickets}</div>
              <p className="text-xs text-muted-foreground">
                Aguardando cliente
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Em Atendimento</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.emAtendimentoTickets}</div>
              <p className="text-xs text-muted-foreground">
                Sendo atendidos
              </p>
            </CardContent>
          </Card>
        </div>

        {/* FILTROS E BUSCA */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por ttulo, usuário ou descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="search-tickets"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filtrar por status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="open">Abertos</SelectItem>
              <SelectItem value="answered">Respondidos</SelectItem>
              <SelectItem value="resolved">Resolvidos</SelectItem>
              <SelectItem value="closed">Fechados</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/*  LISTA DE TICKETS */}
        <div className="space-y-4">
          {tickets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Nenhum ticket encontrado</h3>
                <p className="text-sm text-muted-foreground text-center">
                  No htickets de suporte ativos no momento. 
                  <br />
                  Os tickets aparecerão aqui quando os usuários solicitarem ajuda.
                </p>
              </CardContent>
            </Card>
          ) : (
            tickets
              .filter(ticket => {
                const matchesSearch = searchTerm === "" || 
                  ticket.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  ticket.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  ticket.sellerName?.toLowerCase().includes(searchTerm.toLowerCase());
                
                const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
                
                return matchesSearch && matchesStatus;
              })
              .map((ticket) => (
                <Card key={ticket.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg truncate">
                            {ticket.subject}
                          </h3>
                          {getStatusBadge(ticket.status)}
                          <Badge variant="outline" className={ticket.categoryColor}>
                            {getCategoryLabel(ticket.category)}
                          </Badge>
                          <Badge variant="secondary" className={ticket.priorityColor}>
                            {ticket.priority === 'high' ? 'Alta' : 
                             ticket.priority === 'urgent' ? 'Urgente' : 'Normal'}
                          </Badge>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                          {ticket.description}
                        </p>
                        
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {ticket.sellerName || ticket.sellerId}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {ticket.timeAgo}
                          </span>
                          {ticket.assignedAdminName && (
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3" />
                              Atendido por: {ticket.assignedAdminName}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        {ticket.status === 'open' && (
                          <Button
                            size="sm"
                            onClick={() => handleAcceptTicket(ticket.id)}
                            disabled={acceptingTicket === ticket.id}
                            data-testid={`accept-ticket-${ticket.id}`}
                          >
                            {acceptingTicket === ticket.id ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            ) : (
                              'Aceitar'
                            )}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedTicket(ticket)}
                          data-testid={`view-ticket-${ticket.id}`}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Ver Chat
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteTicket(ticket.id)}
                          data-testid={`delete-ticket-${ticket.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
          )}
        </div>

        {/* MODAL DE CHAT ADMIN */}
        {selectedTicket && (
          <AdminChatModal
            ticket={selectedTicket}
            isOpen={true}
            onClose={() => setSelectedTicket(null)}
            onStatusUpdate={(ticketId: string, newStatus: string) => {
              // Atualizar estado local
              setTickets(prev => prev.map(ticket => 
                ticket.id === ticketId 
                  ? { ...ticket, status: newStatus as any }
                  : ticket
              ));
              // Invalidar cache para sincronizar
              setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
              }, 1000);
            }}
          />
        )}

        {/* DIALOG DE CONFIRMAÇÃO PARA LIMPAR TODOS OS TICKETS */}
        <AlertDialog open={showClearAllConfirm} onOpenChange={setShowClearAllConfirm}>
          <AlertDialogContent data-testid="confirm-clear-all-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar limpeza de todos os tickets</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>ATENÇÃO:</strong> Tem certeza que deseja deletar <strong>TODOS</strong> os tickets de suporte? 
                Esta ação não pode ser desfeita e removerpermanentemente todos os tickets e suas mensagens.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel 
                onClick={() => setShowClearAllConfirm(false)}
                data-testid="cancel-clear-all"
              >
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmClearAllTickets}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="confirm-clear-all"
              >
                Sim, deletar todos
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* DIALOG DE CONFIRMAÇÃO PARA DELETAR TICKET INDIVIDUAL */}
        <AlertDialog open={!!showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(null)}>
          <AlertDialogContent data-testid="confirm-delete-ticket-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar exclusão do ticket</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja deletar este ticket? Esta ação não pode ser desfeita e 
                removerpermanentemente o ticket e todas as suas mensagens.
                {showDeleteConfirm && (
                  <>
                    <br />
                    <strong>Ticket ID:</strong> {showDeleteConfirm}
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel 
                onClick={() => setShowDeleteConfirm(null)}
                data-testid="cancel-delete-ticket"
              >
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => showDeleteConfirm && confirmDeleteTicket(showDeleteConfirm)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="confirm-delete-ticket"
              >
                Sim, deletar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* NOTIFICAÇES CUSTOMIZADAS */}
        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    </DashboardLayout>
  );
}