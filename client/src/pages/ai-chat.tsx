import { useState, useRef, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import {
  Bot,
  Send,
  Sparkles,
  TrendingUp,
  Clock,
  ShoppingCart,
  DollarSign,
  Zap,
  RotateCcw,
  ChevronRight,
  Lightbulb,
  Target,
  BarChart3,
  Users,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface InsightCard {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
}

const SUGGESTIONS = [
  "Qual é meu produto mais vendido este mês?",
  "Em quais horários tenho mais vendas?",
  "Como posso aumentar minha taxa de conversão?",
  "Analise meu ticket médio e dê dicas",
  "Quais clientes têm maior LTV?",
  "Como está minha receita comparada ao mês passado?",
];

const INSIGHT_TIPS = [
  {
    icon: <Clock className="h-4 w-4" />,
    title: "Melhor horário para lançar",
    desc: "Programe seus emails e anúncios para 9h–11h e 19h–21h, janelas de maior conversão.",
    color: "blue",
  },
  {
    icon: <Target className="h-4 w-4" />,
    title: "Order Bumps aumentam ticket",
    desc: "Produtos complementares no checkout aumentam o ticket médio em até 30%.",
    color: "green",
  },
  {
    icon: <Users className="h-4 w-4" />,
    title: "Recupere abandonos",
    desc: "75% dos visitantes abandonam sem comprar. Configure o Exit Intent para capturá-los.",
    color: "orange",
  },
  {
    icon: <Zap className="h-4 w-4" />,
    title: "PIX converte mais",
    desc: "Checkouts com PIX como método principal convertem 2x mais no Brasil.",
    color: "purple",
  },
];

const colorMap: Record<string, string> = {
  blue: "bg-blue-50 border-blue-200 text-blue-600",
  green: "bg-green-50 border-green-200 text-green-600",
  orange: "bg-orange-50 border-orange-200 text-orange-600",
  purple: "bg-purple-50 border-purple-200 text-purple-600",
};

const colorIconMap: Record<string, string> = {
  blue: "bg-blue-100 text-blue-600",
  green: "bg-green-100 text-green-600",
  orange: "bg-orange-100 text-orange-600",
  purple: "bg-purple-100 text-purple-600",
};

export default function AIChatPage() {
  const { user } = useAuthStore();
  const { tenantId } = useTenantStore();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Olá! Sou o **Volatus AI**, seu analista de crescimento pessoal. Tenho acesso aos seus dados de vendas, produtos e clientes para te dar insights acionáveis.\n\nPode me perguntar sobre seus melhores horários de venda, produtos com maior ticket, clientes recorrentes, tendências de receita e muito mais. Como posso te ajudar hoje?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    loadInsights();
  }, [tenantId]);

  const loadInsights = async () => {
    setInsightsLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch("/api/ai/insights", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setInsights(data.insights || []);
      }
    } catch {
      // backend not ready yet — use placeholder
    } finally {
      setInsightsLoading(false);
    }
  };

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsStreaming(true);

      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
      ]);

      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
          },
          body: JSON.stringify({
            message: trimmed,
            history: messages.slice(-10).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(res.status === 503 ? "backend_pending" : "Erro ao conectar com a IA");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.replace("data:", "").trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.content) {
                accumulated += parsed.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: accumulated } : m
                  )
                );
              }
            } catch {}
          }
        }
      } catch (err: any) {
        const isPending =
          err?.message === "backend_pending" || err?.message?.includes("fetch");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: isPending
                    ? "⚙️ **Backend em configuração.** O Volatus AI estará disponível assim que a chave de API for ativada. Todos os outros recursos do painel funcionam normalmente."
                    : `❌ Erro: ${err?.message || "Falha na conexão"}`,
                }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        inputRef.current?.focus();
      }
    },
    [isStreaming, messages]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const formatContent = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br/>");
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-gray-50 dark:bg-gray-950">
        {/* ===== LEFT — CHAT ===== */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            <img src="/favicon.png" alt="Volatus AI" className="w-10 h-10 object-contain flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 dark:text-white text-sm">
                  Volatus AI
                </span>
                <Badge className="bg-blue-50 text-blue-600 border-blue-200 text-[10px] px-1.5 py-0 font-medium">
                  Growth
                </Badge>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                Análise de vendas, produtos, clientes e crescimento
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-gray-600 h-8 w-8"
              onClick={() => {
                setMessages([
                  {
                    id: "welcome-new",
                    role: "assistant",
                    content:
                      "Conversa reiniciada! Como posso te ajudar com sua análise de crescimento?",
                    timestamp: new Date(),
                  },
                ]);
              }}
              title="Nova conversa"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                {msg.role === "assistant" && (
                  <img src="/favicon.png" alt="AI" className="w-8 h-8 object-contain flex-shrink-0 mt-0.5" />
                )}
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#2563eb] text-white rounded-tr-sm"
                      : "bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-tl-sm"
                  }`}
                >
                  {msg.content === "" && isStreaming ? (
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  ) : (
                    <span
                      dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }}
                    />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-6 pb-5 pt-3 border-t border-gray-100 dark:border-gray-800">
            <form onSubmit={handleSubmit} className="flex gap-3 items-end">
              <div className="flex-1 relative">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Pergunte sobre suas vendas, produtos, clientes..."
                  disabled={isStreaming}
                  className="pr-4 py-3 text-sm rounded-xl border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:bg-gray-800 dark:text-white"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                />
              </div>
              <Button
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white rounded-xl px-4 py-3 h-auto transition-all shadow-sm disabled:opacity-40"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        </div>

        {/* ===== RIGHT — INSIGHTS ===== */}
        <div className="w-80 min-w-[300px] flex-shrink-0 flex flex-col overflow-y-auto bg-gray-50 dark:bg-gray-950">
          {/* Insights header */}
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-10">
            <span className="font-semibold text-sm text-gray-900 dark:text-white">Insights do seu negócio</span>
            <p className="text-xs text-gray-500 mt-0.5">Dados cruzados em tempo real</p>
          </div>

          <div className="flex-1 px-4 py-4">
            <div className="space-y-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="w-full text-left text-xs px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:border-blue-200 hover:text-blue-600 text-gray-600 dark:text-gray-400 transition-all flex items-center gap-2"
                >
                  <Lightbulb className="h-3 w-3 flex-shrink-0 text-gray-400" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
