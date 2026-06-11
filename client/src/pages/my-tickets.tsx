import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  Package, DollarSign, Users, CreditCard, Settings, HelpCircle,
  Send, ChevronRight, Inbox
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SupportTicket, SupportMessage } from "@shared/schema";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import DashboardLayout from "@/components/layout/dashboard-layout";

const parseFirestoreDate = (date: any): Date => {
  if (!date) return new Date();
  if (date._seconds) return new Date(date._seconds * 1000);
  if (date.seconds) return new Date(date.seconds * 1000);
  if (typeof date === "string") return new Date(date);
  if (date instanceof Date) return date;
  return new Date(date);
};

const STATUS_CONFIG: Record<string, { label: string; dot: string; ring: string }> = {
  open:     { label: "Aberto",     dot: "bg-blue-500",  ring: "ring-blue-100" },
  answered: { label: "Respondido", dot: "bg-amber-400", ring: "ring-amber-100" },
  resolved: { label: "Resolvido",  dot: "bg-emerald-500", ring: "ring-emerald-100" },
  closed:   { label: "Fechado",    dot: "bg-gray-400",  ring: "ring-gray-100" },
};

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  produto:    { label: "Produto",    icon: <Package className="h-3 w-3" /> },
  financeiro: { label: "Financeiro", icon: <DollarSign className="h-3 w-3" /> },
  afiliado:   { label: "Afiliado",   icon: <Users className="h-3 w-3" /> },
  taxas:      { label: "Taxas",      icon: <CreditCard className="h-3 w-3" /> },
  technical:  { label: "Técnico",    icon: <Settings className="h-3 w-3" /> },
  geral:      { label: "Geral",      icon: <HelpCircle className="h-3 w-3" /> },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  urgent: { label: "Urgente", color: "text-red-600 bg-red-50 border-red-200" },
  high:   { label: "Alta",    color: "text-orange-600 bg-orange-50 border-orange-200" },
  normal: { label: "Normal",  color: "text-blue-600 bg-blue-50 border-blue-200" },
  low:    { label: "Baixa",   color: "text-gray-500 bg-gray-50 border-gray-200" },
};

export default function MyTicketsPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const { data: ticketsData, isLoading: loadingTickets } = useQuery({
    queryKey: ["/api/support/tickets/my-tickets"],
    enabled: !!user,
  });
  const tickets = (ticketsData as any)?.tickets || [];

  const { data: messagesData, isLoading: loadingMessages } = useQuery({
    queryKey: ["/api/support/tickets", selectedTicket?.id, "messages"],
    queryFn: async () => {
      if (!selectedTicket?.id) return { messages: [] };
      const res = await apiRequest(`/api/support/tickets/${selectedTicket.id}/messages`, "GET");
      return res.json();
    },
    enabled: !!selectedTicket?.id,
    refetchInterval: selectedTicket?.id ? 3000 : false,
    refetchOnWindowFocus: false,
  });
  const messages = (messagesData as any)?.messages || [];

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData: any) => {
      return apiRequest(`/api/support/tickets/${selectedTicket?.id}/messages`, "POST", messageData);
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/support/tickets", selectedTicket?.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets/my-tickets"] });
      setNewMessage("");
    },
    onError: (error: any) => {
      const msg = error?.message || "";
      if (msg.includes("flood") || msg.includes("rápido")) {
        toast({ variant: "destructive", title: "Anti-flood ativado!", description: "Aguarde alguns segundos antes de enviar outra mensagem." });
        return;
      }
      toast({ variant: "destructive", title: "Erro ao enviar", description: "Não foi possível enviar a mensagem. Tente novamente." });
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      return apiRequest(`/api/support/tickets/${ticketId}/read`, "POST", { senderType: "seller" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets/my-tickets"] });
    },
    onError: (error) => console.error("Erro ao marcar como lido:", error),
  });

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket || !user) return;
    sendMessageMutation.mutate({ content: newMessage.trim(), senderType: "seller", messageType: "text" });
  };

  useEffect(() => {
    if (messages.length > 0) setTimeout(scrollToBottom, 100);
  }, [messages, scrollToBottom]);

  const openTicketDialog = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    if (ticket.unreadBySeller > 0) markAsReadMutation.mutate(ticket.id);
  };

  if (loadingTickets) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
            <span className="text-sm text-gray-500">Carregando tickets...</span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Meus Tickets</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Acompanhe suas solicitações de suporte
          </p>
        </div>

        {tickets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 py-16 flex flex-col items-center justify-center text-center px-6">
            <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <Inbox className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Nenhum ticket ainda</h3>
            <p className="text-sm text-gray-500 max-w-xs">
              Use o botão de suporte no canto da tela para abrir seu primeiro ticket.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
              </span>
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {tickets.map((ticket: SupportTicket) => {
                const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
                const category = CATEGORY_CONFIG[ticket.category];
                const priority = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.normal;
                return (
                  <li
                    key={ticket.id}
                    className="group flex items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                    onClick={() => openTicketDialog(ticket)}
                  >
                    {/* Status dot */}
                    <div className="flex-shrink-0 flex items-center justify-center">
                      <span className={`h-2.5 w-2.5 rounded-full ${status.dot} ring-2 ${status.ring}`} />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {ticket.subject}
                        </span>
                        {ticket.unreadBySeller > 0 && (
                          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                            {ticket.unreadBySeller} nova{ticket.unreadBySeller > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-gray-400 font-mono">#{ticket.id.slice(-8)}</span>
                        <span className="text-xs text-gray-400">
                          {format(parseFirestoreDate(ticket.createdAt), "dd/MM/yyyy · HH:mm", { locale: ptBR })}
                        </span>
                        {category && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            {category.icon}
                            {category.label}
                          </span>
                        )}
                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${priority.color}`}>
                          {priority.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {ticket.totalMessages || 1} mensagem{(ticket.totalMessages || 1) > 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    {/* Status label + arrow */}
                    <div className="flex-shrink-0 flex items-center gap-3">
                      <span className="hidden sm:inline text-xs text-gray-500">{status.label}</span>
                      <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Ticket Chat Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl w-full h-[85vh] sm:h-[80vh] flex flex-col p-0 gap-0 rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 border-b border-gray-100 dark:border-gray-800 px-5 py-4">
            <DialogHeader className="space-y-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {selectedTicket && (
                      <span className={`h-2 w-2 rounded-full ${STATUS_CONFIG[selectedTicket.status]?.dot || "bg-blue-500"} flex-shrink-0`} />
                    )}
                    <DialogTitle className="text-base font-semibold text-gray-900 dark:text-white truncate leading-tight">
                      {selectedTicket?.subject}
                    </DialogTitle>
                  </div>
                  {selectedTicket && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400 font-mono">#{selectedTicket.id.slice(-8)}</span>
                      <span className="text-xs text-gray-400">
                        {format(parseFirestoreDate(selectedTicket.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        {CATEGORY_CONFIG[selectedTicket.category]?.label}
                      </span>
                      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${PRIORITY_CONFIG[selectedTicket.priority]?.color || ""}`}>
                        {PRIORITY_CONFIG[selectedTicket.priority]?.label}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <DialogDescription className="sr-only">
                Acompanhe as mensagens e responda seu ticket de suporte
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900/50 px-5 py-4 space-y-3">
            {loadingMessages ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <MessageCircle className="h-8 w-8 text-gray-300 mb-2" />
                <span className="text-sm text-gray-400">Nenhuma mensagem ainda</span>
              </div>
            ) : (
              <>
                {messages.map((message: SupportMessage) => {
                  const isSeller = message.senderType === "seller";
                  return (
                    <div key={message.id} className={`flex ${isSeller ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] sm:max-w-[70%] ${isSeller ? "items-end" : "items-start"} flex flex-col gap-1`}>
                        <span className="text-xs text-gray-400 px-1">
                          {isSeller ? "Você" : "Suporte"} · {format(parseFirestoreDate(message.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                        <div
                          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                            isSeller
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
                placeholder="Escreva sua mensagem..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 min-h-[44px] max-h-[120px] resize-none rounded-xl border-gray-200 dark:border-gray-700 text-sm"
                rows={1}
                data-testid="textarea-new-message"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || sendMessageMutation.isPending}
                size="icon"
                className="h-11 w-11 rounded-xl bg-violet-600 hover:bg-violet-700 flex-shrink-0"
                data-testid="button-send-message"
              >
                {sendMessageMutation.isPending ? (
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
    </DashboardLayout>
  );
}
