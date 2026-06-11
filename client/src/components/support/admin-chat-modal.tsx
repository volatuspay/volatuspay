import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Send, 
  Clock, 
  User, 
  MessageSquare, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  Archive
} from "lucide-react";
import { SupportTicket, SupportMessage, InsertSupportMessage } from "@shared/schema";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";

interface AdminChatModalProps {
  ticket: SupportTicket | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusUpdate: (ticketId: string, newStatus: string) => void;
}

interface MessageWithSender extends SupportMessage {
  senderName: string;
  isAdmin: boolean;
}

const parseFirestoreDate = (date: any): Date => {
  if (!date) return new Date();
  if (date._seconds) return new Date(date._seconds * 1000);
  if (date.seconds) return new Date(date.seconds * 1000);
  if (typeof date === 'string') return new Date(date);
  if (date instanceof Date) return date;
  return new Date(date);
};

function AdminChatModal({ ticket, isOpen, onClose, onStatusUpdate }: AdminChatModalProps) {
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { toast } = useToast();


  const { data: messagesData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['/api/support/tickets', ticket?.id, 'messages'],
    queryFn: async () => {
      if (!ticket?.id) return { messages: [] };
      const res = await apiRequest(`/api/support/tickets/${ticket.id}/messages`, 'GET');
      return res.json();
    },
    enabled: !!ticket?.id && isOpen,
    refetchInterval: isOpen ? 3000 : false,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const messages: MessageWithSender[] = (messagesData as any)?.messages?.map((msg: any) => ({
    ...msg,
    senderName: msg.senderType === 'admin' ? 'Admin VolatusPay' : ticket?.sellerName,
    isAdmin: msg.senderType === 'admin'
  })) || [];

  // MARCAR MENSAGENS COMO LIDAS QUANDO ADMIN ABRE MODAL
  const markAsReadMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      return apiRequest(`/api/support/tickets/${ticketId}/read`, 'POST', {
        senderType: 'admin'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
    }
  });

  // MARCAR COMO LIDA QUANDO ABRE MODAL (otimizado para evitar loops)
  useEffect(() => {
    if (ticket && isOpen && messages.length > 0 && !markAsReadMutation.isPending) {
      const hasUnreadMessages = messages.some(msg => 
        msg.senderType === 'seller' && !msg.readByAdmin
      );
      
      if (hasUnreadMessages) {
        console.log(`Marcando ${messages.length} mensagens como lidas pelo admin no ticket ${ticket.id}`);
        markAsReadMutation.mutate(ticket.id);
      }
    }
  }, [ticket?.id, isOpen, messages.length]); // Incluir messages.length para reagir a novas mensagens

  // AUTO SCROLL PARA LTIMA MENSAGEM
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ENVIAR MENSAGEM VIA REST API  
  const sendMessageMutation = useMutation({
    mutationFn: async (messageData: any) => {
      return apiRequest(`/api/support/tickets/${ticket?.id || ''}/messages`, 'POST', messageData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets', ticket?.id, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
      
      setNewMessage("");
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    },
    onError: (error: any) => {
      console.error("Erro ao enviar mensagem admin:", error);
      
      const msg = error?.message || '';
      if (msg.includes('flood') || msg.includes('rápido')) {
        toast({
          title: "Anti-flood ativado!",
          description: "Aguarde alguns segundos antes de enviar outra mensagem.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erro ao enviar",
          description: "Não foi possível enviar a mensagem. Tente novamente.",
          variant: "destructive",
        });
      }
    }
  });

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !ticket || sendMessageMutation.isPending || !user) return;

    console.log("Admin enviando mensagem via REST API:", newMessage);
    
    const messageData = {
      senderId: user.uid, // Usar UID real do admin autenticado
      senderType: "admin",
      senderName: user.displayName || user.email || "Admin VolatusPay",
      content: newMessage.trim(),
      messageType: "text"
    };
    
    sendMessageMutation.mutate(messageData);
  };

  // CORES POR STATUS
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'open':
        return { 
          label: 'Aberto', 
          color: 'bg-red-100 text-red-700 border-red-200',
          icon: AlertCircle 
        };
      case 'answered':
        return { 
          label: 'Respondido', 
          color: 'bg-blue-100 text-blue-700 border-blue-200',
          icon: MessageSquare 
        };
      case 'closed':
        return { 
          label: 'Fechado', 
          color: 'bg-gray-100 text-gray-700 border-gray-200',
          icon: XCircle 
        };
      case 'resolved':
        return { 
          label: 'Resolvido', 
          color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
          icon: CheckCircle 
        };
      default:
        return { 
          label: status, 
          color: 'bg-gray-100 text-gray-700',
          icon: MessageSquare 
        };
    }
  };

  // CORES POR CATEGORIA
  const getCategoryConfig = (category: string) => {
    switch (category) {
      case 'produto':
        return { label: 'Produtos', color: 'bg-emerald-100 text-emerald-700' };
      case 'financeiro':
        return { label: 'Financeiro', color: 'bg-blue-100 text-blue-700' };
      case 'afiliado':
        return { label: 'Afiliados', color: 'bg-emerald-100 text-emerald-700' };
      case 'taxas':
        return { label: 'Taxas', color: 'bg-orange-100 text-orange-700' };
      case 'technical':
        return { label: 'Técnico', color: 'bg-red-100 text-red-700' };
      case 'geral':
        return { label: 'Geral', color: 'bg-gray-100 text-gray-700' };
      default:
        return { label: category, color: 'bg-gray-100 text-gray-700' };
    }
  };

  if (!ticket) return null;

  const statusConfig = getStatusConfig(ticket.status);
  const categoryConfig = getCategoryConfig(ticket.category);
  const StatusIcon = statusConfig.icon;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col" data-testid="admin-chat-modal">
        {/*  HEADER DO TICKET */}
        <DialogHeader className="border-b pb-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <DialogTitle className="text-xl">{ticket.subject}</DialogTitle>
              <DialogDescription className="sr-only">
                Chat de suporte entre admin e {ticket.sellerName} - Ticket ID: {ticket.id}
              </DialogDescription>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={statusConfig.color}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {statusConfig.label}
                </Badge>
                <Badge variant="outline" className={categoryConfig.color}>
                  {categoryConfig.label}
                </Badge>
                <Badge className={ticket.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}>
                  {ticket.priority === 'high' ? 'Alta' : ticket.priority === 'urgent' ? 'Urgente' : 'Normal'}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {ticket.sellerName} ({ticket.sellerEmail})
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Criado h{Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / (1000 * 60 * 60))}h
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const newStatus = ticket.status === 'closed' ? 'open' : 'closed';
                  try {
                    await apiRequest(`/api/support/tickets/${ticket.id}/status`, 'PATCH', { status: newStatus });
                    onStatusUpdate(ticket.id, newStatus);
                    // Invalidao otimizada
                    queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
                  } catch (error) {
                    console.error("Erro ao atualizar status:", error);
                  }
                }}
                data-testid="toggle-ticket-status"
              >
                {ticket.status === 'closed' ? (
                  <>
                    <AlertCircle className="w-4 h-4 mr-1" />
                    Reabrir
                  </>
                ) : (
                  <>
                    <Archive className="w-4 h-4 mr-1" />
                    Fechar
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0">
          {/* MENSAGENS */}
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4 py-4" data-testid="chat-messages">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full mr-3" />
                  <span className="text-sm text-muted-foreground">Carregando mensagens...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p>Nenhuma mensagem encontrada</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className={`flex ${message.isAdmin ? 'justify-end' : 'justify-start'}`}>
                    <Card className={`max-w-[80%] ${message.isAdmin ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900' : 'bg-white dark:bg-transparent'}`}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${message.isAdmin ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                          <span className="text-sm font-medium">{message.senderName}</span>
                          <span className="text-xs text-muted-foreground">
                            {parseFirestoreDate(message.createdAt).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      </CardContent>
                    </Card>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* NOVA MENSAGEM */}
          <div className="border-t pt-4 mt-4 space-y-3">
          <Textarea
            placeholder="Digite sua resposta para o seller..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            className="min-h-[80px]"
            disabled={ticket.status === 'closed'}
            data-testid="message-input"
            maxLength={200}
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              Pressione Ctrl+Enter para enviar
            </span>
            <Button 
              onClick={handleSendMessage} 
              disabled={!newMessage.trim() || sendMessageMutation.isPending || ticket.status === 'closed'}
              data-testid="send-message"
            >
              {sendMessageMutation.isPending ? (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Enviar
            </Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AdminChatModal;