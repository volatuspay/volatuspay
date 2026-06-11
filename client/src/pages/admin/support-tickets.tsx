import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Ticket, MessageSquare, Clock, User, Calendar, Search, Send,
  RefreshCw, Eye, CheckCircle2, AlertCircle, Trash2, ChevronRight, Inbox
} from "lucide-react";
import { SupportTicket, SupportMessage } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useCustomDialog } from "@/hooks/use-custom-dialog";

const parseFirestoreDate = (date: any): Date => {
  if (!date) return new Date();
  if (date._seconds) return new Date(date._seconds * 1000);
  if (date.seconds) return new Date(date.seconds * 1000);
  if (typeof date === "string") return new Date(date);
  if (date instanceof Date) return date;
  return new Date(date);
};

const CATEGORY_LABELS: Record<string, string> = {
  produto: "Produtos", financeiro: "Financeiro", afiliado: "Afiliados",
  taxas: "Taxas", technical: "Técnico", geral: "Geral",
};

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  open:     { label: "Aberto",     dot: "bg-red-500",     badge: "bg-red-50 text-red-700 border-red-200" },
  answered: { label: "Respondido", dot: "bg-amber-400",   badge: "bg-amber-50 text-amber-700 border-amber-200" },
  resolved: { label: "Resolvido",  dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed:   { label: "Fechado",    dot: "bg-gray-400",    badge: "bg-gray-50 text-gray-600 border-gray-200" },
};

interface TicketWithMessages extends SupportTicket {
  messages?: SupportMessage[];
}

export default function AdminSupportTickets() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedTicket, setSelectedTicket] = useState<TicketWithMessages | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showTicketDialog, setShowTicketDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesPollingRef = useRef<NodeJS.Timeout | null>(null);
  const ticketsPollingRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();
  const { showConfirm } = useCustomDialog();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadTickets = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await apiRequest("/api/support/tickets", "GET");
      const data = await response.json();
      setTickets(data.tickets || []);
    } catch (error) {
      if (!silent) {
        toast({ title: "Erro ao carregar tickets", description: "Não foi possível carregar os tickets.", variant: "destructive" });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadTicketMessages = useCallback(async (ticketId: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const response = await apiRequest(`/api/support/tickets/${ticketId}/messages`, "GET");
      const data = await response.json();
      const newMessages = data.messages || [];
      setTicketMessages(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(newMessages)) {
          setTimeout(scrollToBottom, 100);
          return newMessages;
        }
        return prev;
      });
      setSelectedTicket(prev => prev ? { ...prev, messages: newMessages } : null);
    } catch (error) {
      if (!silent) {
        toast({ title: "Erro ao carregar mensagens", description: "Não foi possível carregar as mensagens.", variant: "destructive" });
      }
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [scrollToBottom, toast]);

  const sendAdminMessage = async () => {
    if (!newMessage.trim() || !selectedTicket || sending) return;
    const messageContent = newMessage.trim();
    setNewMessage("");
    setSending(true);
    try {
      await apiRequest(`/api/support/tickets/${selectedTicket.id}/messages`, "POST", { content: messageContent, messageType: "text" });
      await loadTicketMessages(selectedTicket.id, false);
      loadTickets(true);
      toast({ title: "Mensagem enviada!", description: "Resposta enviada com sucesso." });
    } catch (error: any) {
      setNewMessage(messageContent);
      const msg = error?.message || "";
      if (msg.includes("flood") || msg.includes("rápido")) {
        toast({ title: "Anti-flood ativado!", description: "Aguarde antes de enviar outra mensagem.", variant: "destructive" });
      } else {
        toast({ title: "Erro ao enviar", description: "Não foi possível enviar a mensagem.", variant: "destructive" });
      }
    } finally {
      setSending(false);
    }
  };

  const openTicket = async (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setShowTicketDialog(true);
    await loadTicketMessages(ticket.id, false);
    if (ticket.unreadByAdmin > 0) markAsRead(ticket.id);
    if (messagesPollingRef.current) clearInterval(messagesPollingRef.current);
    messagesPollingRef.current = setInterval(() => loadTicketMessages(ticket.id, true), 2000);
  };

  const closeTicketDialog = () => {
    if (messagesPollingRef.current) { clearInterval(messagesPollingRef.current); messagesPollingRef.current = null; }
    setShowTicketDialog(false);
    setSelectedTicket(null);
    setTicketMessages([]);
    setNewMessage("");
  };

  const markAsRead = async (ticketId: string) => {
    try {
      await apiRequest(`/api/support/tickets/${ticketId}/read`, "POST", { senderType: "admin" });
      loadTickets(true);
    } catch (error) { console.error("Erro ao marcar como lido:", error); }
  };

  const deleteTicket = async (ticketId: string) => {
    const confirmed = await showConfirm("ATENÇÃO: Esta ação é IRREVERSÍVEL!\n\nVocê tem certeza que deseja deletar este ticket PERMANENTEMENTE?\n\nTodos os dados do ticket e mensagens serão perdidos para sempre.", "Confirmar exclusão", "error");
    if (!confirmed) return;
    setDeleting(true);
    try {
      if (messagesPollingRef.current) { clearInterval(messagesPollingRef.current); messagesPollingRef.current = null; }
      await apiRequest(`/api/support/tickets/${ticketId}`, "DELETE");
      toast({ title: "Ticket deletado!", description: "Ticket e mensagens removidos permanentemente." });
      closeTicketDialog();
      await loadTickets();
    } catch (error) {
      toast({ title: "Erro ao deletar ticket", description: "Não foi possível deletar o ticket.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const filteredTickets = tickets.filter(ticket => {
    const matchesSearch =
      ticket.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.sellerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.sellerEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: tickets.length,
    open: tickets.filter(t => t.status === "open").length,
    answered: tickets.filter(t => t.status === "answered").length,
    unread: tickets.filter(t => t.unreadByAdmin > 0).length,
  };

  useEffect(() => {
    loadTickets();
    ticketsPollingRef.current = setInterval(() => loadTickets(true), 5000);
    return () => {
      if (messagesPollingRef.current) clearInterval(messagesPollingRef.current);
      if (ticketsPollingRef.current) clearInterval(ticketsPollingRef.current);
    };
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">Tickets de Suporte</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Gerencie e responda tickets dos sellers</p>
        </div>
        <Button
          onClick={() => loadTickets()}
          disabled={loading}
          variant="outline"
          size="sm"
          className="gap-2 rounded-xl h-9 border-gray-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total",       value: stats.total,    icon: <Ticket className="h-5 w-5 text-gray-400" />,          color: "text-gray-900" },
          { label: "Abertos",     value: stats.open,     icon: <AlertCircle className="h-5 w-5 text-red-400" />,       color: "text-red-600" },
          { label: "Respondidos", value: stats.answered, icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,  color: "text-emerald-600" },
          { label: "Não lidos",   value: stats.unread,   icon: <MessageSquare className="h-5 w-5 text-amber-400" />,   color: "text-amber-600" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-5 py-4 flex items-center gap-4 shadow-sm">
            <div className="h-10 w-10 rounded-xl bg-gray-50 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
              {icon}
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">{label}</p>
              <p className={`text-2xl font-bold ${color} dark:text-white leading-none mt-0.5`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por assunto, seller ou ticket ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 rounded-xl border-gray-200 dark:border-gray-700 h-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="all">Todos os status</option>
          <option value="open">Abertos</option>
          <option value="answered">Respondidos</option>
          <option value="closed">Fechados</option>
          <option value="resolved">Resolvidos</option>
        </select>
      </div>

      {/* Tickets list */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {filteredTickets.length} ticket{filteredTickets.length !== 1 ? "s" : ""}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <div className="h-6 w-6 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
            <span className="text-sm text-gray-500">Carregando tickets...</span>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
              <Inbox className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Nenhum ticket encontrado</p>
            <p className="text-xs text-gray-400 mt-1">
              {searchTerm || statusFilter !== "all" ? "Tente ajustar os filtros" : "Ainda não há tickets de suporte"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredTickets.map((ticket) => {
              const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
              return (
                <li
                  key={ticket.id}
                  className="group flex items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  onClick={() => openTicket(ticket)}
                >
                  {/* Status dot */}
                  <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${status.dot}`} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{ticket.subject}</span>
                      {ticket.unreadByAdmin > 0 && (
                        <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                          {ticket.unreadByAdmin} nova{ticket.unreadByAdmin > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {ticket.sellerName}
                      </span>
                      <span className="hidden sm:inline text-gray-300">·</span>
                      <span className="hidden sm:inline">{ticket.sellerEmail}</span>
                      <span className="text-gray-300">·</span>
                      <span className="font-mono">#{ticket.id.slice(-8)}</span>
                      <span className="text-gray-300">·</span>
                      <span>{parseFirestoreDate(ticket.createdAt).toLocaleDateString("pt-BR")}</span>
                      <span className="text-gray-300">·</span>
                      <span>{ticket.totalMessages} msg</span>
                      <span className="text-gray-300">·</span>
                      <span>{CATEGORY_LABELS[ticket.category as keyof typeof CATEGORY_LABELS] || ticket.category}</span>
                    </div>
                  </div>

                  {/* Status + arrow */}
                  <div className="flex-shrink-0 flex items-center gap-3">
                    <span className={`hidden sm:inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${status.badge}`}>
                      {status.label}
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Ticket Dialog */}
      <Dialog open={showTicketDialog} onOpenChange={setShowTicketDialog}>
        <DialogContent className="sm:max-w-2xl h-[85vh] sm:h-[80vh] flex flex-col p-0 gap-0 rounded-2xl overflow-hidden">
          {/* Dialog Header */}
          <div className="flex-shrink-0 border-b border-gray-100 dark:border-gray-800 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {selectedTicket && (
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${STATUS_CONFIG[selectedTicket.status]?.dot || "bg-blue-500"}`} />
                  )}
                  <DialogTitle className="text-base font-semibold text-gray-900 dark:text-white truncate leading-tight">
                    {selectedTicket?.subject}
                  </DialogTitle>
                </div>
                {selectedTicket && (
                  <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400">
                    <span className="font-mono">#{selectedTicket.id.slice(-8)}</span>
                    <span>·</span>
                    <span>{selectedTicket.sellerName} ({selectedTicket.sellerEmail})</span>
                    <span>·</span>
                    <span>{parseFirestoreDate(selectedTicket.createdAt).toLocaleString("pt-BR")}</span>
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectedTicket && deleteTicket(selectedTicket.id)}
                disabled={deleting}
                data-testid="delete-ticket-button"
                className="flex-shrink-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl h-8 px-3 gap-1.5 text-xs"
              >
                {deleting ? (
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Deletar
              </Button>
            </div>
            <DialogDescription className="sr-only">
              Visualize e responda as mensagens deste ticket de suporte
            </DialogDescription>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900/50 px-5 py-4 space-y-3">
            {loadingMessages ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
              </div>
            ) : ticketMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <MessageSquare className="h-8 w-8 text-gray-300 mb-2" />
                <span className="text-sm text-gray-400">Nenhuma mensagem ainda</span>
              </div>
            ) : (
              <>
                {ticketMessages.map((message) => {
                  const isAdmin = message.senderType === "admin";
                  return (
                    <div key={message.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] sm:max-w-[70%] flex flex-col gap-1 ${isAdmin ? "items-end" : "items-start"}`}>
                        <span className="text-xs text-gray-400 px-1">
                          {isAdmin ? "Suporte VolatusPay" : (message.senderName || "Seller")}
                          {" · "}
                          {parseFirestoreDate(message.createdAt).toLocaleString("pt-BR")}
                        </span>
                        <div
                          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                            isAdmin
                              ? "bg-violet-600 text-white rounded-tr-sm"
                              : "bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 shadow-sm rounded-tl-sm"
                          }`}
                        >
                          {message.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Digite sua resposta..."
                className="flex-1 min-h-[44px] max-h-[120px] resize-none rounded-xl border-gray-200 dark:border-gray-700 text-sm"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAdminMessage(); }
                }}
              />
              <Button
                onClick={sendAdminMessage}
                disabled={!newMessage.trim() || sending}
                size="icon"
                className="h-11 w-11 rounded-xl bg-violet-600 hover:bg-violet-700 flex-shrink-0"
              >
                {sending ? (
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">Enter para enviar · Shift+Enter para nova linha</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
