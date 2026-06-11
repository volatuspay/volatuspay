import { useState } from "react";
import { MessageCircle, Send, History, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { apiRequest } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";

const createTicketSchema = z.object({
  subject: z.string().min(1, "Assunto é obrigatório"),
  category: z.enum(["produto", "financeiro", "afiliado", "taxas", "technical", "geral"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  description: z.string().min(10, "Descrição deve ter pelo menos 10 caracteres"),
});

type CreateTicketForm = z.infer<typeof createTicketSchema>;

const CATEGORY_OPTIONS = [
  { value: "produto",    label: "Produtos"   },
  { value: "financeiro", label: "Financeiro" },
  { value: "afiliado",   label: "Afiliados"  },
  { value: "taxas",      label: "Taxas"      },
  { value: "technical",  label: "Técnico"    },
  { value: "geral",      label: "Geral"      },
];

const PRIORITY_OPTIONS = [
  { value: "low",    label: "Baixa",   color: "text-gray-600" },
  { value: "normal", label: "Normal",  color: "text-blue-600" },
  { value: "high",   label: "Alta",    color: "text-orange-600" },
  { value: "urgent", label: "Urgente", color: "text-red-600" },
];

function SupportFloatButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const isMobile = useIsMobile();

  const form = useForm<CreateTicketForm>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { subject: "", category: "geral", priority: "normal", description: "" },
  });

  if (!user || !tenant) return null;

  const onSubmit = async (data: CreateTicketForm) => {
    setIsSubmitting(true);
    try {
      const ticketData = {
        tenantId: tenant.id,
        sellerId: user.uid,
        sellerName: user.displayName || user.email || "Seller",
        sellerEmail: user.email || "",
        category: data.category,
        priority: data.priority,
        subject: data.subject,
        description: data.description,
      };

      const result = await apiRequest("/api/support/tickets", "POST", ticketData);
      const responseData = await result.json();

      if (responseData.success || responseData.ticketId) {
        toast({
          title: "Ticket criado!",
          description: `Ticket ${responseData.ticketId.slice(-8)} aberto. Nossa equipe responderá em breve.`,
        });
        form.reset();
        setIsOpen(false);
      } else {
        throw new Error(responseData.error || responseData.message || "Erro ao criar ticket");
      }
    } catch (error: any) {
      const errorMessage = error?.message || "";
      if (errorMessage.includes("Limite") || errorMessage.includes("2 tickets") || errorMessage.includes("429")) {
        toast({
          title: "Limite de tickets atingido",
          description: "Você já possui 2 tickets abertos. Finalize um deles antes de abrir outro.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erro ao criar ticket",
          description: errorMessage || "Não foi possível criar o ticket. Tente novamente.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <div className={`fixed ${isMobile ? "bottom-24" : "bottom-6"} right-6 z-50`}>
        <button
          onClick={() => setIsOpen(true)}
          data-testid="support-float-button"
          className="group h-14 w-14 rounded-full bg-violet-600 hover:bg-violet-700 shadow-lg hover:shadow-violet-200 dark:hover:shadow-violet-900/50 transition-all duration-200 flex items-center justify-center ring-0 hover:scale-105 active:scale-95"
        >
          <MessageCircle className="h-6 w-6 text-white" />
        </button>
      </div>

      {/* Create Ticket Modal */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <DialogTitle className="text-base font-semibold text-gray-900 dark:text-white">
                  Abrir ticket de suporte
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-500 mt-0.5">
                  Descreva seu problema e nossa equipe responde em até 24h
                </DialogDescription>
              </div>
              <Link href="/my-tickets">
                <button
                  onClick={() => setIsOpen(false)}
                  data-testid="view-my-tickets-button"
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-violet-600 transition-colors font-medium"
                >
                  <History className="h-3.5 w-3.5" />
                  Meus tickets
                </button>
              </Link>
            </div>
          </div>

          {/* Form */}
          <div className="px-6 py-5">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Subject */}
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                        Assunto
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ex: Problema com checkout de pagamento"
                          className="rounded-xl border-gray-200 dark:border-gray-700 text-sm h-10"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Category + Priority side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          Categoria
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="rounded-xl border-gray-200 dark:border-gray-700 h-10 text-sm">
                              <SelectValue placeholder="Selecionar" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="rounded-xl">
                            {CATEGORY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value} className="rounded-lg">
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          Prioridade
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="rounded-xl border-gray-200 dark:border-gray-700 h-10 text-sm">
                              <SelectValue placeholder="Selecionar" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="rounded-xl">
                            {PRIORITY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value} className="rounded-lg">
                                <span className={`font-medium ${option.color}`}>{option.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Description */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                        Descrição
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Descreva detalhadamente seu problema ou dúvida..."
                          className="min-h-[100px] resize-none rounded-xl border-gray-200 dark:border-gray-700 text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsOpen(false)}
                    className="flex-1 rounded-xl h-10 border-gray-200 text-gray-700 hover:bg-gray-50"
                    disabled={isSubmitting}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 rounded-xl h-10 bg-violet-600 hover:bg-violet-700 gap-2"
                  >
                    {isSubmitting ? (
                      <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {isSubmitting ? "Enviando..." : "Criar Ticket"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>

          {/* Footer note */}
          <div className="mx-6 mb-5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 px-4 py-3 text-center">
            <p className="text-xs text-gray-500">
              Resposta em até <span className="font-medium text-gray-700 dark:text-gray-300">24 horas</span>
              {" · "}
              <span className="text-amber-600 font-medium">Limite: 2 tickets abertos</span>
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SupportFloatButton;
