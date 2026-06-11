import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Rocket, Wallet, Webhook, Copy, CheckCircle, Shield, Zap,
  BookOpen, Package, RefreshCw, Users, ChevronDown, ChevronRight,
  AlertCircle, Code2, Globe, Lock
} from "lucide-react";

const BASE_URL = "https://volatuspay.com";
const API_VERSION = "2026-05-31";

interface Subsection { id: string; title: string }
interface MenuSection { id: string; title: string; icon: React.ElementType; subsections: Subsection[] }

const MENU: MenuSection[] = [
  {
    id: "inicio", title: "Visão Geral", icon: Rocket,
    subsections: [
      { id: "introducao", title: "Introdução" },
      { id: "passo-a-passo", title: "Passo a Passo" },
      { id: "autenticacao", title: "Autenticação" },
    ]
  },
  {
    id: "pagamentos", title: "Pagamentos", icon: Wallet,
    subsections: [
      { id: "criar-pagamento", title: "Criar Pagamento" },
      { id: "consultar-vendas", title: "Listar Vendas" },
      { id: "consultar-pedido", title: "Consultar Pedido" },
      { id: "status-pagamento", title: "Status de Pagamento" },
      { id: "reembolso", title: "Reembolsos" },
    ]
  },
  {
    id: "assinaturas", title: "Assinaturas", icon: RefreshCw,
    subsections: [
      { id: "assinatura-criar", title: "Criar Assinatura" },
      { id: "assinatura-listar", title: "Listar Assinaturas" },
      { id: "assinatura-cancelar", title: "Cancelar Assinatura" },
      { id: "assinatura-ciclos", title: "Ciclos e Renovação" },
    ]
  },
  {
    id: "produtos", title: "Produtos", icon: Package,
    subsections: [
      { id: "crud-produtos", title: "Gerenciar Produtos" },
      { id: "crud-ofertas", title: "Ofertas / Planos" },
      { id: "crud-cupons", title: "Cupons de Desconto" },
    ]
  },
  {
    id: "afiliados", title: "Afiliados", icon: Users,
    subsections: [
      { id: "afiliados-visao", title: "Visão Geral" },
      { id: "afiliados-listar", title: "Listar Afiliados" },
      { id: "afiliados-comissoes", title: "Comissões" },
    ]
  },
  {
    id: "webhooks", title: "Webhooks", icon: Webhook,
    subsections: [
      { id: "webhook-configurar", title: "Configurar" },
      { id: "webhook-formato", title: "Formato e Eventos" },
      { id: "webhook-seguranca", title: "Segurança e Validação" },
      { id: "webhook-retry", title: "Reenvios e Garantias" },
    ]
  },
  {
    id: "referencia", title: "Referência", icon: BookOpen,
    subsections: [
      { id: "ids-recursos", title: "IDs e Recursos" },
      { id: "erros", title: "Códigos de Erro" },
      { id: "rate-limits", title: "Limites de Uso" },
    ]
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET:    "bg-blue-50 text-blue-700 border border-blue-200",
  POST:   "bg-emerald-50 text-emerald-700 border border-emerald-200",
  PUT:    "bg-yellow-50 text-yellow-700 border border-yellow-200",
  PATCH:  "bg-orange-50 text-orange-700 border border-orange-200",
  DELETE: "bg-red-50 text-red-700 border border-red-200",
};

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("inicio");
  const [activeSubsection, setActiveSubsection] = useState("introducao");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ inicio: true });
  const [copiedId, setCopiedId] = useState("");
  const [codeTab, setCodeTab] = useState<Record<string, string>>({});

  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#0d0f14";
    return () => { document.body.style.backgroundColor = prev; };
  }, []);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(""), 2000);
  };

  const navigate = (sectionId: string, subId: string) => {
    setActiveSection(sectionId);
    setActiveSubsection(subId);
    setOpenSections(prev => ({ ...prev, [sectionId]: true }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const isCurrentlyOpen = !!prev[id];
      // fecha tudo e abre só o clicado (ou fecha se já estava aberto)
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach(k => { next[k] = false; });
      next[id] = !isCurrentlyOpen;
      return next;
    });
  };

  // ─── Sub-components ────────────────────────────────────────────────────────

  const CodeBlock = ({ id, code, lang = "JSON", tabs }: {
    id: string; code?: string; lang?: string;
    tabs?: { label: string; lang: string; code: string }[];
  }) => {
    const activeTab = codeTab[id] ?? (tabs?.[0]?.label ?? "");
    const displayCode = tabs ? (tabs.find(t => t.label === activeTab)?.code ?? tabs[0].code) : (code ?? "");
    const displayLang = tabs ? (tabs.find(t => t.label === activeTab)?.lang ?? lang) : lang;
    return (
      <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between bg-gray-900 px-4 py-2.5">
          <div className="flex items-center gap-2">
            {tabs ? (
              tabs.map(t => (
                <button
                  key={t.label}
                  onClick={() => setCodeTab(prev => ({ ...prev, [id]: t.label }))}
                  className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                    activeTab === t.label ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
                  }`}
                >{t.label}</button>
              ))
            ) : (
              <span className="text-xs text-gray-400 font-mono">{displayLang}</span>
            )}
          </div>
          <button
            onClick={() => copy(displayCode, id)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            {copiedId === id
              ? <><CheckCircle className="w-3.5 h-3.5 text-blue-400" /><span className="text-blue-400">Copiado</span></>
              : <><Copy className="w-3.5 h-3.5" /><span>Copiar</span></>
            }
          </button>
        </div>
        <pre className="bg-gray-950 text-gray-100 p-5 text-xs leading-relaxed overflow-x-auto whitespace-pre font-mono">{displayCode}</pre>
      </div>
    );
  };

  const Endpoint = ({ method, path, description, children, auth = true }: {
    method: string; path: string; description: string;
    children?: React.ReactNode; auth?: boolean;
  }) => (
    <div className="border border-white/[0.08] rounded-xl bg-[#111827] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded ${METHOD_COLORS[method]}`}>{method}</span>
          <code className="text-sm font-semibold text-gray-100 font-mono">{path}</code>
          {!auth && <span className="text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-700/50 px-2 py-0.5 rounded-full">Público</span>}
          {auth && <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-700/50 px-2 py-0.5 rounded-full flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Auth</span>}
        </div>
        <p className="text-sm text-gray-400">{description}</p>
      </div>
      {children && <div className="p-5 space-y-4">{children}</div>}
    </div>
  );

  const Note = ({ type = "info", children }: { type?: "info" | "warning" | "danger"; children: React.ReactNode }) => {
    const styles = {
      info:    "bg-blue-950/50 border-blue-700/40 text-blue-300",
      warning: "bg-amber-950/50 border-amber-700/40 text-amber-300",
      danger:  "bg-red-950/50 border-red-700/40 text-red-300",
    };
    return (
      <div className={`flex items-start gap-3 border rounded-lg p-4 text-sm ${styles[type]}`}>
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>{children}</div>
      </div>
    );
  };

  const FieldTable = ({ rows }: { rows: { field: string; type: string; required?: boolean; desc: string }[] }) => (
    <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full text-sm">
        <thead className="bg-[#1a1f2e]">
          <tr>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-400 text-xs uppercase tracking-wide">Campo</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-400 text-xs uppercase tracking-wide">Tipo</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-400 text-xs uppercase tracking-wide">Descrição</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.field} className={i % 2 === 0 ? "bg-[#111827]" : "bg-[#0d1117]"}>
              <td className="py-2.5 px-4">
                <code className="text-xs font-mono text-gray-200 bg-white/[0.06] px-2 py-0.5 rounded">{r.field}</code>
                {r.required && <span className="ml-1.5 text-red-400 text-xs">*</span>}
              </td>
              <td className="py-2.5 px-4 text-gray-500 text-xs font-mono">{r.type}</td>
              <td className="py-2.5 px-4 text-gray-400 text-xs">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const EventTable = ({ rows }: { rows: { ev: string; desc: string; prod: string }[] }) => (
    <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full text-sm">
        <thead className="bg-[#1a1f2e]">
          <tr>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-400 text-xs uppercase tracking-wide">Evento</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-400 text-xs uppercase tracking-wide">Descrição</th>
            <th className="text-left py-2.5 px-4 font-semibold text-gray-400 text-xs uppercase tracking-wide">Produto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.ev} className={i % 2 === 0 ? "bg-[#111827]" : "bg-[#0d1117]"}>
              <td className="py-2.5 px-4"><code className="text-xs font-mono bg-white/[0.06] text-gray-200 px-2 py-0.5 rounded">{r.ev}</code></td>
              <td className="py-2.5 px-4 text-gray-400 text-xs">{r.desc}</td>
              <td className="py-2.5 px-4 text-xs text-gray-500 font-mono">{r.prod}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ─── Sections ──────────────────────────────────────────────────────────────

  const renderContent = () => {
    switch (activeSubsection) {

      // ── Introdução ─────────────────────────────────────────────────────────
      case "introducao": return (
        <div className="space-y-8">
          <div>
            <div className="mb-3">
              <h1 className="text-2xl font-bold text-gray-900">API VolatusPay</h1>
              <p className="text-sm text-gray-500">Versão {API_VERSION}</p>
            </div>
            <p className="text-gray-600 leading-relaxed">
              Gateway de pagamento híbrido e agnóstico. Uma única API para PIX, cartões, boleto e assinaturas
              recorrentes com roteamento inteligente entre processadores (EfiBank, Stripe).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: "Multi-gateway", desc: "PIX, cartão BR e internacional, boleto - tudo numa API" },
              { title: "Assinaturas", desc: "Billing recorrente com renovação automática e webhooks" },
              { title: "Segurança", desc: "HMAC-SHA256 em todos os webhooks, HTTPS obrigatório" },
            ].map(f => (
              <div key={f.title} className="border border-gray-200 rounded-xl p-4 bg-white">
                <h3 className="font-semibold text-gray-900 text-sm mb-1">{f.title}</h3>
                <p className="text-xs text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Base URL</h3>
            <CodeBlock id="base-url" lang="HTTPS" code={`${BASE_URL}/api/v1`} />
            <p className="text-xs text-gray-500 mt-3">
              Todas as requisições são via HTTPS. A versão da API é incluída como campo{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">apiVersion</code> em todos os webhooks.
              Campos novos podem ser adicionados sem mudança de versão - ignore campos desconhecidos.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Fluxo de Integração</h3>
            <div className="space-y-3">
              {[
                { n: "1", t: "Criar conta Seller", d: `Acesse ${BASE_URL}/register e crie sua conta. Após aprovação, você terá acesso ao dashboard e à API.` },
                { n: "2", t: "Autenticar", d: "Faça login via Firebase Auth e obtenha o Bearer token para as chamadas de API." },
                { n: "3", t: "Criar produto + oferta", d: "Crie seu produto via API ou dashboard. Cada produto gera um checkout acessível via slug único." },
                { n: "4", t: "Configurar Webhook", d: "Registre sua URL de webhook para receber notificações de pagamentos, assinaturas e eventos." },
                { n: "5", t: "Receber e processar eventos", d: "Valide a assinatura HMAC e processe os eventos de forma idempotente usando o orderId." },
              ].map(s => (
                <div key={s.n} className="flex items-start gap-4">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center">{s.n}</span>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{s.t}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

      // ── Passo a Passo ──────────────────────────────────────────────────────
      case "passo-a-passo": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Quickstart</h2>
            <p className="text-gray-600">Do zero ao primeiro pagamento em 10 minutos.</p>
          </div>

          <div className="space-y-4">
            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Passo 1</span>
                <h3 className="font-semibold text-gray-900">Criar conta de Seller</h3>
              </div>
              <div className="p-5">
                <p className="text-sm text-gray-600 mb-3">
                  Acesse <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">{BASE_URL}/register</code> e crie sua conta.
                  Após aprovação do admin, você terá acesso ao dashboard e à API.
                </p>
                <Note type="info">
                  Contas são aprovadas manualmente. O prazo médio é de 1 dia útil.
                </Note>
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Passo 2</span>
                <h3 className="font-semibold text-gray-900">Autenticar e obter token</h3>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-600 mb-2">A VolatusPay usa dois sistemas de auth dependendo do contexto:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <div className="text-xs font-bold text-gray-700 mb-1">Dashboard / Seller API <code className="bg-gray-200 px-1 rounded">/api/...</code></div>
                    <p className="text-xs text-gray-600">Autenticação via <strong>Firebase Bearer token</strong>. Use para gerenciar produtos, consultar vendas, configurar webhooks.</p>
                  </div>
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <div className="text-xs font-bold text-gray-700 mb-1">API Externa / Server-to-server <code className="bg-gray-200 px-1 rounded">/api/v1/...</code></div>
                    <p className="text-xs text-gray-600">Autenticação via <strong>X-API-Key</strong>. Use para criar pagamentos de backend (sem checkout). Chave gerada no painel em Integrações → API.</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">Para a Dashboard API, use o SDK do Firebase:</p>
                <CodeBlock id="qs-auth" tabs={[
                  { label: "JavaScript", lang: "JavaScript", code: `import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const auth = getAuth();
const { user } = await signInWithEmailAndPassword(auth, "email@voce.com", "sua_senha");

// Token JWT - expira em 1h (Firebase renova automaticamente)
const token = await user.getIdToken();

// Usando nas requisições da Dashboard API:
const res = await fetch("${BASE_URL}/api/orders?tenantId=" + user.uid, {
  headers: { "Authorization": "Bearer " + token }
});` },
                  { label: "cURL", lang: "cURL", code: `# 1. Autenticar via Firebase REST API
curl -X POST \\
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=FIREBASE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"email@voce.com","password":"sua_senha","returnSecureToken":true}'

# A resposta inclui "idToken" - use como Bearer token na Dashboard API
# Para a API externa (/api/v1/), use X-API-Key em vez de Bearer` },
                ]} />
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Passo 3</span>
                <h3 className="font-semibold text-gray-900">Criar primeiro produto</h3>
              </div>
              <div className="p-5">
                <CodeBlock id="qs-product" lang="cURL" code={`curl -X POST "${BASE_URL}/api/products" \\
  -H "Authorization: Bearer SEU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Meu Curso Online",
    "price": 9900,
    "productType": "digital"
  }'`} />
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Passo 4</span>
                <h3 className="font-semibold text-gray-900">Configurar webhook</h3>
              </div>
              <div className="p-5">
                <CodeBlock id="qs-webhook" lang="cURL" code={`curl -X PUT "${BASE_URL}/api/seller/webhook-settings" \\
  -H "Authorization: Bearer SEU_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "webhookUrl": "https://seusite.com/webhook/volatuspay",
    "events": ["payment.pix.paid", "payment.card.approved", "subscription.renewed"]
  }'`} />
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Passo 5</span>
                <h3 className="font-semibold text-gray-900">Receber e validar webhooks</h3>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-600">Exemplo mínimo de handler de webhook:</p>
                <CodeBlock id="qs-handler" tabs={[
                  { label: "Node.js", lang: "JavaScript", code: `const express = require("express");
const crypto = require("crypto");
const app = express();

app.post("/webhook/volatuspay",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["x-zen-signature"];
    const secret = process.env.VOLATUSPAY_WEBHOOK_SECRET;

    const expected = "sha256=" + crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).send("Assinatura inválida");
    }

    const event = JSON.parse(req.body.toString());

    switch (event.event) {
      case "payment.pix.paid":
        // liberar acesso ao produto
        break;
      case "subscription.renewed":
        // renovar acesso
        break;
    }

    res.status(200).send("OK");
  }
);` },
                  { label: "Python", lang: "Python", code: `import hmac, hashlib, json
from flask import Flask, request, abort

app = Flask(__name__)
WEBHOOK_SECRET = "seu_webhook_secret"

@app.route("/webhook/volatuspay", methods=["POST"])
def webhook():
    sig = request.headers.get("X-Zen-Signature", "")
    body = request.get_data()

    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode(),
        body,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(sig, expected):
        abort(401, "Assinatura inválida")

    event = json.loads(body)

    if event["event"] == "payment.pix.paid":
        order_id = event["data"]["orderId"]
        # liberar acesso...

    return "OK", 200` },
                  { label: "PHP", lang: "PHP", code: `<?php
$payload = file_get_contents("php://input");
$sig     = $_SERVER["HTTP_X_ZEN_SIGNATURE"] ?? "";
$secret  = getenv("VOLATUSPAY_WEBHOOK_SECRET");

$expected = "sha256=" . hash_hmac("sha256", $payload, $secret);

if (!hash_equals($expected, $sig)) {
    http_response_code(401);
    exit("Assinatura inválida");
}

$event = json_decode($payload, true);

if ($event["event"] === "payment.pix.paid") {
    $orderId = $event["data"]["orderId"];
    // liberar acesso ao produto
}

http_response_code(200);
echo "OK";` },
                ]} />
              </div>
            </div>
          </div>
        </div>
      );

      // ── Autenticação ───────────────────────────────────────────────────────
      case "autenticacao": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Autenticação</h2>
            <p className="text-gray-600">Todas as rotas protegidas exigem o token Firebase no header Authorization.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Header obrigatório</h3>
            <CodeBlock id="auth-header" lang="HTTP" code={`Authorization: Bearer <firebase_id_token>
Content-Type: application/json`} />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-gray-900">Endpoints públicos (sem auth)</h3>
            <p className="text-xs text-gray-500">Esses endpoints não exigem autenticação - podem ser chamados diretamente do frontend do comprador.</p>
            <div className="space-y-2">
              {[
                { m: "POST", p: "/api/payment/create-session", d: "Criar sessão de pagamento" },
                { m: "GET",  p: "/api/orders/:orderId/status", d: "Polling de status do PIX" },
                { m: "GET",  p: "/api/checkout/:slug", d: "Dados públicos do checkout" },
                { m: "GET",  p: "/api/showcase/checkouts", d: "Vitrine pública de produtos" },
              ].map(r => (
                <div key={r.p} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0">
                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${METHOD_COLORS[r.m]}`}>{r.m}</span>
                  <code className="text-gray-800 text-xs font-mono">{r.p}</code>
                  <span className="text-gray-500 text-xs">{r.d}</span>
                </div>
              ))}
            </div>
          </div>

          <Note type="warning">
            <strong>Tokens expiram em 1 hora.</strong> Use o SDK do Firebase - ele renova automaticamente.
            Nunca armazene o token em cookies sem HttpOnly ou em localStorage em produção.
          </Note>
        </div>
      );

      // ── Criar Pagamento ────────────────────────────────────────────────────
      case "criar-pagamento": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Criar Pagamento</h2>
            <p className="text-gray-600">Dois endpoints disponíveis dependendo do contexto de integração.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-mono">POST</span>
                <code className="text-xs font-mono text-gray-800">/api/v1/payments</code>
              </div>
              <p className="text-xs text-gray-700 font-semibold mb-1">Integração server-to-server</p>
              <p className="text-xs text-gray-500">Autenticado via <strong>API Key</strong>. Não requer checkoutId. PIX direto pelo adquirente configurado do seller.</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-mono">POST</span>
                <code className="text-xs font-mono text-gray-800">/api/payment/create-session</code>
              </div>
              <p className="text-xs text-gray-700 font-semibold mb-1">Frontend / checkout page</p>
              <p className="text-xs text-gray-500">Público (sem auth). Requer checkoutId. Suporta PIX, cartão e boleto com cupons, afiliados e order bumps.</p>
            </div>
          </div>

          <Endpoint method="POST" path="/api/v1/payments" description="Cria uma cobrança PIX diretamente pelo adquirente configurado do seller. Autenticado via API Key." auth={true}>
            <div className="space-y-1 mb-2">
              <p className="text-xs font-semibold text-gray-700">Campos da requisição</p>
            </div>
            <FieldTable rows={[
              { field: "method", type: "string", required: true, desc: "pix (único método suportado na API direta)" },
              { field: "amount", type: "number", required: true, desc: "Valor em centavos inteiro (ex: 9900 = R$ 99,00)" },
              { field: "customer.name", type: "string", required: true, desc: "Nome completo do pagador" },
              { field: "customer.document", type: "string", required: true, desc: "CPF (11 dígitos) ou CNPJ (14 dígitos), com ou sem máscara" },
              { field: "customer.email", type: "string", required: false, desc: "E-mail do pagador" },
              { field: "customer.phone", type: "string", required: false, desc: "Telefone do pagador" },
              { field: "description", type: "string", required: false, desc: "Descrição da cobrança (até 100 caracteres)" },
              { field: "externalRef", type: "string", required: false, desc: "Referência própria do seller para o pedido" },
            ]} />

            <CodeBlock id="api-pay-req" tabs={[
              { label: "PIX", lang: "cURL", code: `curl -X POST "${BASE_URL}/api/v1/payments" \\
  -H "X-API-Key: vp_live_sua_chave_aqui" \\
  -H "Content-Type: application/json" \\
  -d '{
    "method": "pix",
    "amount": 9900,
    "customer": {
      "name": "João Silva",
      "email": "joao@email.com",
      "phone": "11999998888",
      "document": "12345678900"
    },
    "description": "Pedido #1234",
    "externalRef": "order-1234"
  }'` },
              { label: "Node.js", lang: "JavaScript", code: `const res = await fetch("${BASE_URL}/api/v1/payments", {
  method: "POST",
  headers: {
    "X-API-Key": "vp_live_sua_chave_aqui",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    method: "pix",
    amount: 9900,
    customer: {
      name: "João Silva",
      email: "joao@email.com",
      document: "12345678900"
    },
    description: "Pedido #1234",
    externalRef: "order-1234"
  })
});
const data = await res.json();
console.log(data.orderId, data.qrCode);` },
            ]} />

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Resposta (201)</p>
              <CodeBlock id="api-pay-resp" tabs={[
                { label: "PIX criado", lang: "JSON", code: `{
  "success": true,
  "orderId": "api_1708300000000_x7kM2p",
  "method": "pix",
  "status": "pending",
  "qrCode": "00020126580014br.gov.bcb.pix...",
  "qrCodeImage": "https://api.qrserver.com/v1/create-qr-code/?data=...",
  "expiresAt": "2026-02-19T10:30:00Z",
  "amount": 9900,
  "amountFormatted": "R$ 99,00"
}` },
                { label: "Erro adquirente", lang: "JSON", code: `{
  "error": "Erro ao processar pagamento",
  "code": "PAYMENT_ERROR",
  "message": "Adquirente PIX não configurado ou não habilitado"
}` },
              ]} />
            </div>
          </Endpoint>

          <Endpoint method="GET" path="/api/v1/payments/:orderId" description="Consulta o status de um pagamento criado via API direta." auth={true}>
            <CodeBlock id="api-pay-status" lang="cURL" code={`curl "${BASE_URL}/api/v1/payments/api_1708300000000_x7kM2p" \\
  -H "X-API-Key: vp_live_sua_chave_aqui"`} />
            <CodeBlock id="api-pay-status-resp" lang="JSON" code={`{
  "success": true,
  "data": {
    "orderId": "api_1708300000000_x7kM2p",
    "status": "paid",
    "method": "pix",
    "amount": 9900,
    "amountFormatted": "R$ 99,00",
    "acquirer": "efibank",
    "externalRef": "order-1234",
    "paidAt": "2026-02-18T10:31:00Z",
    "createdAt": "2026-02-18T10:30:00Z",
    "customerName": "João Silva",
    "customerEmail": "joao@email.com"
  }
}`} />
          </Endpoint>

          <Note type="warning">
            <strong>Adquirentes suportados na API direta:</strong> efibank, onzfinance, woovi, pagarme, stripe.
            EfiBank requer certificado mTLS e só opera via checkout page (<code className="bg-yellow-100 px-1 rounded text-xs">POST /api/payment/create-session</code>).
            Configure o adquirente do seller no painel admin antes de usar este endpoint.
          </Note>

          <hr className="border-gray-200" />

          <Endpoint method="POST" path="/api/payment/create-session" description="Inicia uma sessão de pagamento pelo checkout page. Público - chamado pelo frontend do comprador." auth={false}>
            <div className="space-y-1 mb-2">
              <p className="text-xs font-semibold text-gray-700">Campos da requisição</p>
            </div>
            <FieldTable rows={[
              { field: "checkoutId", type: "string", required: true, desc: "ID do checkout/oferta" },
              { field: "method", type: "string", required: true, desc: "pix | card | cardBr | cardGlobal | boleto" },
              { field: "amount", type: "number", required: true, desc: "Valor em centavos (ex: 9900 = R$ 99,00)" },
              { field: "customer", type: "object", required: true, desc: "name, email, phone, document (CPF)" },
              { field: "cardData", type: "object", required: false, desc: "Dados do cartão (apenas method=card). Ver campos abaixo." },
              { field: "installments", type: "number", required: false, desc: "Número de parcelas (padrão: 1)" },
              { field: "couponCode", type: "string", required: false, desc: "Código do cupom de desconto" },
              { field: "affiliateCode", type: "string", required: false, desc: "Código do afiliado para atribuição de comissão" },
            ]} />

            <CodeBlock id="pay-pix" tabs={[
              { label: "PIX", lang: "JSON", code: `{
  "checkoutId": "FBlJzE7Sguflt7XT",
  "method": "pix",
  "amount": 9900,
  "customer": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999998888",
    "document": "12345678900"
  }
}` },
              { label: "Cartão", lang: "JSON", code: `{
  "checkoutId": "FBlJzE7Sguflt7XT",
  "method": "card",
  "amount": 14900,
  "installments": 3,
  "customer": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999998888",
    "document": "12345678900"
  },
  "cardData": {
    "number": "4111111111111111",
    "holderName": "JOAO SILVA",
    "expMonth": "12",
    "expYear": "2028",
    "cvv": "123"
  }
}` },
              { label: "Boleto", lang: "JSON", code: `{
  "checkoutId": "FBlJzE7Sguflt7XT",
  "method": "boleto",
  "amount": 9900,
  "customer": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999998888",
    "document": "12345678900"
  }
}` },
            ]} />

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Respostas</p>
              <CodeBlock id="pay-resp" tabs={[
                { label: "PIX (201)", lang: "JSON", code: `{
  "success": true,
  "orderId": "order_1708300000000_x7kM2p",
  "method": "pix",
  "status": "pending",
  "qrCode": "00020126...",
  "qrCodeImage": "data:image/png;base64,...",
  "expiresAt": "2026-02-19T10:30:00Z",
  "amount": 9900,
  "amountFormatted": "R$ 99,00"
}` },
                { label: "Cartão (201)", lang: "JSON", code: `{
  "success": true,
  "orderId": "order_1708300000000_y8nQ3r",
  "method": "card",
  "status": "approved",
  "amount": 14900,
  "amountFormatted": "R$ 149,00",
  "installments": 3
}` },
                { label: "Boleto (201)", lang: "JSON", code: `{
  "success": true,
  "orderId": "order_boleto_1708300000000_k9pR4s",
  "method": "boleto",
  "status": "pending",
  "barcode": "34191.09008 00001.230000 00000.000000 1 00000000009900",
  "barcodeLink": "https://boleto.link/...",
  "expiresAt": "2026-02-22T23:59:59Z",
  "amount": 9900,
  "amountFormatted": "R$ 99,00"
}` },
              ]} />
            </div>
          </Endpoint>

          <Note type="info">
            <strong>Valores em centavos.</strong> Todos os campos de valor monetário são inteiros em centavos.
            R$ 99,00 → <code className="bg-blue-100 px-1 rounded text-xs">9900</code>
          </Note>
        </div>
      );

      // ── Listar Vendas ──────────────────────────────────────────────────────
      case "consultar-vendas": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Listar Vendas</h2>
            <p className="text-gray-600">Liste todas as vendas do seu tenant com filtros.</p>
          </div>

          <Endpoint method="GET" path="/api/orders" description="Retorna as vendas do seller autenticado. O campo tenantId filtra automaticamente pelo UID do token.">
            <CodeBlock id="orders-req" lang="cURL" code={`curl "${BASE_URL}/api/orders?tenantId=SEU_TENANT_ID&status=paid&limit=50" \\
  -H "Authorization: Bearer SEU_TOKEN"`} />
            <FieldTable rows={[
              { field: "tenantId", type: "string", required: true, desc: "UID do seller (deve ser igual ao do token)" },
              { field: "status", type: "string", required: false, desc: "Filtro: paid | pending | cancelled | failed" },
              { field: "limit", type: "number", required: false, desc: "Máximo de registros por página (padrão: 100)" },
              { field: "startAfter", type: "string", required: false, desc: "ID do último pedido para paginação" },
            ]} />
            <CodeBlock id="orders-resp" lang="JSON" code={`{
  "success": true,
  "orders": [
    {
      "id": "order_1708300000000_x7kM2p",
      "status": "paid",
      "amount": 9900,
      "method": "pix",
      "customer": {
        "name": "João Silva",
        "email": "joao@email.com",
        "document": "***.***.***-00"
      },
      "productName": "Curso de Marketing",
      "checkoutId": "FBlJzE7Sguflt7XT",
      "isAffiliateSale": false,
      "affiliateId": null,
      "createdAt": "2026-02-18T10:30:00Z",
      "paidAt": "2026-02-18T10:31:00Z"
    }
  ],
  "total": 1,
  "nextPage": null
}`} />
          </Endpoint>
        </div>
      );

      // ── Consultar Pedido ───────────────────────────────────────────────────
      case "consultar-pedido": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Consultar Pedido</h2>
            <p className="text-gray-600">Consulte um pedido específico ou faça polling do status PIX.</p>
          </div>

          <Endpoint method="GET" path="/api/orders/:orderId" description="Retorna todos os dados de um pedido. Requer auth.">
            <CodeBlock id="order-get" lang="JSON" code={`{
  "id": "order_1708300000000_x7kM2p",
  "status": "paid",
  "amount": 9900,
  "method": "pix",
  "customer": { "name": "João Silva", "email": "joao@email.com" },
  "productName": "Curso de Marketing",
  "checkoutId": "FBlJzE7Sguflt7XT",
  "tenantId": "seller_uid",
  "createdAt": "2026-02-18T10:30:00Z",
  "paidAt": "2026-02-18T10:31:00Z"
}`} />
          </Endpoint>

          <Endpoint method="GET" path="/api/orders/:orderId/status" description="Polling de status - endpoint público, ideal para o frontend do comprador aguardar confirmação PIX." auth={false}>
            <CodeBlock id="order-status" tabs={[
              { label: "Aguardando", lang: "JSON", code: `{ "status": "pending", "orderId": "order_...", "method": "pix" }` },
              { label: "Pago", lang: "JSON", code: `{ "status": "paid", "orderId": "order_...", "method": "pix", "paidAt": "2026-02-18T10:31:00Z" }` },
              { label: "Expirado", lang: "JSON", code: `{ "status": "expired", "orderId": "order_...", "method": "pix" }` },
            ]} />
            <Note type="info">
              Faça polling a cada 3–5 segundos enquanto o comprador aguarda. Pare quando status ≠ <code className="text-xs bg-blue-100 px-1 rounded">pending</code>.
            </Note>
          </Endpoint>
        </div>
      );

      // ── Status de Pagamento ────────────────────────────────────────────────
      case "status-pagamento": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Status de Pagamento</h2>
            <p className="text-gray-600">Todos os status possíveis para pedidos e assinaturas.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 text-sm">Pedidos (orders)</h3>
            </div>
            <div className="p-5">
              <div className="space-y-2">
                {[
                  { s: "paid",      color: "bg-blue-100 text-blue-700",  d: "Pagamento aprovado e confirmado" },
                  { s: "pending",   color: "bg-yellow-100 text-yellow-700", d: "Aguardando confirmação (PIX/boleto)" },
                  { s: "expired",   color: "bg-gray-100 text-gray-600",    d: "PIX ou boleto expirou sem pagamento" },
                  { s: "cancelled", color: "bg-gray-100 text-gray-600",    d: "Venda cancelada" },
                  { s: "failed",    color: "bg-red-100 text-red-700",      d: "Falha no processamento" },
                  { s: "refunded",  color: "bg-purple-100 text-purple-700",d: "Reembolso processado" },
                  { s: "chargeback",color: "bg-red-100 text-red-700",      d: "Contestação no banco" },
                ].map(r => (
                  <div key={r.s} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full ${r.color}`}>{r.s}</span>
                    <span className="text-sm text-gray-600">{r.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 text-sm">Assinaturas (subscriptions)</h3>
            </div>
            <div className="p-5">
              <div className="space-y-2">
                {[
                  { s: "active",    color: "bg-blue-100 text-blue-700",  d: "Assinatura ativa, acesso liberado" },
                  { s: "overdue",   color: "bg-orange-100 text-orange-700", d: "Cobrança pendente, acesso ainda ativo" },
                  { s: "cancelled", color: "bg-gray-100 text-gray-600",    d: "Cancelada, acesso encerrado na data de corte" },
                  { s: "expired",   color: "bg-gray-100 text-gray-600",    d: "Período expirou sem renovação" },
                  { s: "trialing",  color: "bg-blue-100 text-blue-700",    d: "Em período de trial gratuito" },
                ].map(r => (
                  <div key={r.s} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full ${r.color}`}>{r.s}</span>
                    <span className="text-sm text-gray-600">{r.d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );

      // ── Reembolsos ─────────────────────────────────────────────────────────
      case "reembolso": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Reembolsos</h2>
            <p className="text-gray-600">Solicite reembolso total de uma venda aprovada.</p>
          </div>

          <Endpoint method="POST" path="/api/refunds" description="Solicita reembolso de um pedido. Requer auth do comprador (customer) dono da compra.">
            <CodeBlock id="refund-req" lang="JSON" code={`{
  "orderId": "order_1708300000000_x7kM2p",
  "productId": "product_1708300000000_aBcDeFgH",
  "customerId": "CUSTOMER_UID",
  "reason": "Solicitação do cliente"
}`} />
            <CodeBlock id="refund-resp" lang="JSON" code={`{
  "success": true,
  "refundId": "refund_1708300000000_abc123xyz",
  "orderId": "order_1708300000000_x7kM2p",
  "status": "pending",
  "createdAt": "2026-02-19T14:00:00Z"
}`} />
          </Endpoint>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">Campos obrigatórios</h3>
            <FieldTable rows={[
              { field: "orderId", type: "string", required: true, desc: "ID do pedido a ser reembolsado" },
              { field: "productId", type: "string", required: true, desc: "ID do produto da compra" },
              { field: "customerId", type: "string", required: true, desc: "UID do comprador - deve bater com o token" },
              { field: "reason", type: "string", required: false, desc: "Motivo do reembolso (texto livre)" },
            ]} />
          </div>

          <Note type="warning">
            <strong>Auth:</strong> Esta rota usa autenticação do <em>comprador</em> (token Firebase do customer), não do seller.
            O <code className="bg-amber-100 px-1 rounded text-xs">customerId</code> deve ser igual ao UID do token enviado.
            Para reembolsos via painel admin, use o painel de gestão.
          </Note>

          <Note type="info">
            <strong>Prazos:</strong> PIX e cartão - até 7 dias úteis. Boleto - até 5 dias úteis após compensação.
            Chargebacks não são processados por esta rota - são gerenciados diretamente pelo gateway.
          </Note>
        </div>
      );

      // ── Assinatura: Criar ──────────────────────────────────────────────────
      case "assinatura-criar": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Criar Assinatura</h2>
            <p className="text-gray-600">Assinaturas são criadas automaticamente pelo checkout quando o comprador paga um produto com <code className="bg-gray-100 px-1 rounded text-xs">productType: subscription</code>.</p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="font-semibold text-blue-900 mb-2">Como assinaturas são criadas</div>
            <p className="text-sm text-blue-800">
              As assinaturas são criadas <strong>automaticamente pelo fluxo de checkout</strong> - quando o comprador paga um produto do tipo <code className="bg-blue-100 px-1 rounded text-xs">subscription</code>, a assinatura é gerada e o evento <code className="bg-blue-100 px-1 rounded text-xs">subscription.created</code> é disparado via webhook.
            </p>
            <p className="text-sm text-blue-800 mt-2">
              Não existe rota de criação manual de assinaturas via API. Para gerenciar assinaturas existentes, use as rotas de listagem e cancelamento abaixo.
            </p>
          </div>
        </div>
      );

      // ── Assinatura: Listar ─────────────────────────────────────────────────
      case "assinatura-listar": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Listar Assinaturas</h2>
            <p className="text-gray-600">Liste e filtre as assinaturas do seu tenant.</p>
          </div>

          <Endpoint method="GET" path="/api/subscriptions" description="Retorna as assinaturas do seller autenticado.">
            <CodeBlock id="sub-list-req" lang="cURL" code={`curl "${BASE_URL}/api/subscriptions?status=active&limit=50" \\
  -H "Authorization: Bearer SEU_TOKEN"`} />
            <FieldTable rows={[
              { field: "status", type: "string", required: false, desc: "Filtro: active | overdue | cancelled | expired | trialing" },
              { field: "productId", type: "string", required: false, desc: "Filtrar por produto" },
              { field: "limit", type: "number", required: false, desc: "Máximo por página (padrão: 100)" },
            ]} />
            <CodeBlock id="sub-list-resp" lang="JSON" code={`{
  "success": true,
  "subscriptions": [
    {
      "id": "sub_aBcDeFgHiJkLmNoPqRsT",
      "status": "active",
      "customerId": "CUSTOMER_UID",
      "customerEmail": "joao@email.com",
      "productName": "Curso Mensal",
      "planName": "Plano Básico",
      "period": "monthly",
      "amount": 4900,
      "nextBillingDate": "2026-03-01T00:00:00Z",
      "createdAt": "2026-02-01T00:00:00Z"
    }
  ],
  "total": 1
}`} />
          </Endpoint>

        </div>
      );

      // ── Assinatura: Cancelar ───────────────────────────────────────────────
      case "assinatura-cancelar": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Cancelar Assinatura</h2>
            <p className="text-gray-600">Cancele uma assinatura imediatamente ou ao final do período vigente.</p>
          </div>

          <Endpoint method="POST" path="/api/subscriptions/:subscriptionId/cancel" description="Cancela a assinatura. Por padrão, o acesso é mantido até o fim do período já pago.">
            <CodeBlock id="sub-cancel-req" lang="JSON" code={`{
  "reason": "Solicitação do cliente",
  "cancelImmediately": false
}`} />
            <CodeBlock id="sub-cancel-resp" lang="JSON" code={`{
  "success": true,
  "subscriptionId": "sub_aBcDeFgHiJkLmNoPqRsT",
  "status": "cancelled",
  "accessEndDate": "2026-03-01T00:00:00Z",
  "cancelledAt": "2026-02-19T14:00:00Z"
}`} />
          </Endpoint>

          <Note type="info">
            Quando cancelado, é disparado o evento <code className="text-xs bg-blue-100 px-1 rounded">subscription.cancelled</code> via webhook
            com o campo <code className="text-xs bg-blue-100 px-1 rounded">data.accessEndDate</code> indicando quando o acesso expira.
          </Note>
        </div>
      );

      // ── Assinatura: Ciclos ─────────────────────────────────────────────────
      case "assinatura-ciclos": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Ciclos e Renovação</h2>
            <p className="text-gray-600">Como funciona o billing recorrente na VolatusPay.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900">Períodos disponíveis</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-gray-700 uppercase">Período</th>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-gray-700 uppercase">Valor em subscriptionPeriod</th>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-gray-700 uppercase">Renovação</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { p: "Semanal", v: "weekly", r: "Todo 7 dias" },
                    { p: "Mensal", v: "monthly", r: "Todo dia do mês da adesão" },
                    { p: "Trimestral", v: "quarterly", r: "A cada 3 meses" },
                    { p: "Semestral", v: "semiannual", r: "A cada 6 meses" },
                    { p: "Anual", v: "annual", r: "Todo ano" },
                  ].map((r, i) => (
                    <tr key={r.v} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="py-2 px-4 text-gray-900">{r.p}</td>
                      <td className="py-2 px-4"><code className="bg-gray-100 text-xs px-2 py-0.5 rounded font-mono">{r.v}</code></td>
                      <td className="py-2 px-4 text-gray-500 text-xs">{r.r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-gray-900">Fluxo de renovação automática</h3>
            <div className="space-y-3">
              {[
                { n: "D-3", t: "Aviso de cobrança", d: "Webhook subscription.billing_upcoming (opcional - configure no dashboard)" },
                { n: "D-0", t: "Tentativa de cobrança", d: "Sistema debita automaticamente o cartão cadastrado" },
                { n: "Falha", t: "Status overdue", d: "Webhook subscription.payment_failed - acesso mantido por 3 dias por padrão" },
                { n: "+3d", t: "Re-tentativa", d: "2ª tentativa automática de cobrança" },
                { n: "Expirado", t: "Acesso revogado", d: "Webhook subscription.cancelled - acesso encerrado" },
              ].map(s => (
                <div key={s.n} className="flex items-start gap-4">
                  <span className="flex-shrink-0 text-xs font-mono bg-gray-100 text-gray-700 px-2 py-1 rounded min-w-[48px] text-center">{s.n}</span>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{s.t}</p>
                    <p className="text-xs text-gray-500">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

      // ── Produtos ───────────────────────────────────────────────────────────
      case "crud-produtos": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Gerenciar Produtos</h2>
            <p className="text-gray-600">CRUD de produtos. Limite: 15 produtos por seller. Preço mínimo: R$ 5,00.</p>
          </div>

          <Endpoint method="POST" path="/api/products" description="Cria um novo produto. Requer seller aprovado.">
            <CodeBlock id="prod-create" lang="JSON" code={`{
  "title": "Curso de Marketing Digital",
  "description": "Do zero ao avançado",
  "price": 9900,
  "productType": "digital",
  "imageUrl": "https://exemplo.com/imagem.jpg",
  "membersAreaEnabled": true
}`} />
            <FieldTable rows={[
              { field: "title", type: "string", required: true, desc: "Nome do produto (máx. 200 chars)" },
              { field: "description", type: "string", required: false, desc: "Descrição completa" },
              { field: "price", type: "number", required: true, desc: "Preço em centavos (min. 500 = R$ 5,00)" },
              { field: "productType", type: "string", required: true, desc: "digital | subscription" },
              { field: "imageUrl", type: "string", required: false, desc: "URL da imagem de capa" },
              { field: "membersAreaEnabled", type: "boolean", required: false, desc: "Ativa área de membros automática" },
            ]} />
          </Endpoint>

          <Endpoint method="PATCH" path="/api/products/:id" description="Atualiza campos de um produto. Envie apenas o que deseja alterar.">
            <CodeBlock id="prod-patch" lang="JSON" code={`{ "title": "Curso 2.0", "price": 14900 }`} />
          </Endpoint>

          <Endpoint method="DELETE" path="/api/products/:id" description="Soft-delete - dados preservados. Checkout inativado.">
            <CodeBlock id="prod-del" lang="JSON" code={`{ "success": true, "message": "Produto deletado com sucesso" }`} />
          </Endpoint>
        </div>
      );

      // ── Ofertas ────────────────────────────────────────────────────────────
      case "crud-ofertas": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Ofertas / Planos</h2>
            <p className="text-gray-600">Cada produto pode ter até 7 ofertas (variações, planos). Cada uma tem slug, preço e métodos de pagamento próprios.</p>
          </div>

          <Endpoint method="GET" path="/api/products/:productId/offers" description="Lista todas as ofertas ativas de um produto." auth={false}>
            <CodeBlock id="offers-list" lang="JSON" code={`{
  "success": true,
  "offers": [
    {
      "id": "offer_7kM2pQr9sT4x",
      "slug": "plano-basico",
      "title": "Plano Básico",
      "price": 4900,
      "subscriptionPeriod": "monthly",
      "paymentMethods": { "pix": true, "card": true, "boleto": false },
      "installments": { "enabled": true, "maxInstallments": 12, "interestFree": 3 }
    }
  ]
}`} />
          </Endpoint>

          <Endpoint method="POST" path="/api/products/:productId/offers" description="Cria uma nova oferta. Preço mínimo R$ 5,00.">
            <CodeBlock id="offers-create" lang="JSON" code={`{
  "slug": "plano-anual",
  "title": "Plano Anual",
  "price": 29900,
  "subscriptionPeriod": "annual",
  "paymentMethods": { "pix": true, "card": true, "cardBr": true, "cardGlobal": true, "boleto": false },
  "installments": { "enabled": true, "maxInstallments": 12, "minInstallmentValue": 500, "interestFree": 3 }
}`} />
          </Endpoint>

          <Endpoint method="PATCH" path="/api/products/:productId/offers/:offerId" description="Atualiza uma oferta.">
            <CodeBlock id="offers-patch" lang="JSON" code={`{ "title": "Plano Anual Plus", "price": 39900 }`} />
          </Endpoint>

          <Endpoint method="DELETE" path="/api/products/:productId/offers/:offerId" description="Arquiva uma oferta (soft-delete). Histórico de vendas preservado.">
            <CodeBlock id="offers-del" lang="JSON" code={`{ "success": true, "message": "Oferta arquivada", "offerId": "offer_7kM2pQr9sT4x" }`} />
          </Endpoint>
        </div>
      );

      // ── Cupons ─────────────────────────────────────────────────────────────
      case "crud-cupons": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Cupons de Desconto</h2>
            <p className="text-gray-600">Crie e gerencie cupons por produto. Aplicados pelo comprador no checkout.</p>
          </div>

          <Endpoint method="GET" path="/api/products/:productId/coupons" description="Lista cupons do produto.">
            <CodeBlock id="coupons-list" lang="JSON" code={`{
  "success": true,
  "coupons": [{
    "id": "coupon_abc123",
    "code": "DESCONTO20",
    "discountType": "percentage",
    "discountValue": 20,
    "maxUses": 100,
    "usedCount": 15,
    "active": true,
    "expiresAt": "2026-12-31T23:59:59Z"
  }]
}`} />
          </Endpoint>

          <Endpoint method="POST" path="/api/products/:productId/coupons" description="Cria um novo cupom.">
            <CodeBlock id="coupons-create" tabs={[
              { label: "Percentual", lang: "JSON", code: `{ "code": "VERAO30", "discountType": "percentage", "discountValue": 30, "maxUses": 50, "expiresAt": "2026-06-30T23:59:59Z" }` },
              { label: "Valor fixo", lang: "JSON", code: `{ "code": "MENOS10", "discountType": "fixed", "discountValue": 1000, "maxUses": 200 }` },
            ]} />
            <FieldTable rows={[
              { field: "code", type: "string", required: true, desc: "Código do cupom (letras e números, sem espaços)" },
              { field: "discountType", type: "string", required: true, desc: "percentage | fixed" },
              { field: "discountValue", type: "number", required: true, desc: "Percentual (0–100) ou valor fixo em centavos" },
              { field: "maxUses", type: "number", required: false, desc: "Limite de usos (null = ilimitado)" },
              { field: "expiresAt", type: "ISO 8601", required: false, desc: "Data de expiração (null = sem expiração)" },
            ]} />
          </Endpoint>

          <Endpoint method="DELETE" path="/api/products/:productId/coupons/:couponId" description="Remove um cupom.">
            <CodeBlock id="coupons-del" lang="JSON" code={`{ "success": true, "message": "Cupom removido" }`} />
          </Endpoint>
        </div>
      );

      // ── Afiliados: Visão ───────────────────────────────────────────────────
      case "afiliados-visao": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Sistema de Afiliados</h2>
            <p className="text-gray-600">
              Permita que outros usuários divulguem seus produtos e ganhem comissão por cada venda realizada
              através do link deles.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { t: "Vínculo por convite", d: "Seller convida afiliados específicos via dashboard ou API (coleção affiliations)" },
              { t: "Vínculo público", d: "Afiliados se cadastram pelo link público do produto (coleção affiliates)" },
              { t: "Comissão configurável", d: "% global por produto ou comissão individual por afiliado" },
              { t: "Rastreamento por clique", d: "Cada link tem parâmetro affiliateCode - atribuição por último clique" },
            ].map(f => (
              <div key={f.t} className="border border-gray-200 rounded-xl p-4 bg-white">
                <h4 className="font-semibold text-gray-900 text-sm mb-1">{f.t}</h4>
                <p className="text-xs text-gray-500">{f.d}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Link de afiliado</h3>
            <CodeBlock id="aff-link" lang="URL" code={`${BASE_URL}/checkout/SEU_PRODUTO_SLUG?affiliateCode=CODIGO_AFILIADO`} />
            <p className="text-xs text-gray-500 mt-2">
              Quando um comprador acessa via este link e finaliza a compra, a comissão é atribuída automaticamente ao afiliado.
            </p>
          </div>
        </div>
      );

      // ── Afiliados: Listar ──────────────────────────────────────────────────
      case "afiliados-listar": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Listar Afiliados</h2>
            <p className="text-gray-600">Consulte afiliados e suas estatísticas por produto.</p>
          </div>

          <Endpoint method="GET" path="/api/products/:productId/affiliates" description="Lista todos os afiliados de um produto (aprovados, pendentes, rejeitados).">
            <CodeBlock id="aff-list" lang="JSON" code={`{
  "success": true,
  "affiliates": [
    {
      "id": "aff_abc123",
      "affiliateId": "AFFILIATE_UID",
      "affiliateName": "Maria Souza",
      "affiliateEmail": "maria@email.com",
      "status": "approved",
      "customCommission": 20,
      "salesCount": 15,
      "totalEarned": 148500,
      "affiliateCode": "MARIA_CODE",
      "affiliateLink": "${BASE_URL}/checkout/meu-produto?affiliateCode=MARIA_CODE",
      "approvedAt": "2026-01-15T10:00:00Z"
    }
  ]
}`} />
          </Endpoint>

          <Endpoint method="PATCH" path="/api/affiliations/:id/approve" description="Aprova um afiliado pendente.">
            <CodeBlock id="aff-approve" lang="JSON" code={`{ "success": true, "status": "approved" }`} />
          </Endpoint>

          <Endpoint method="PATCH" path="/api/affiliations/:id/reject" description="Rejeita um afiliado pendente.">
            <CodeBlock id="aff-reject" lang="JSON" code={`{ "success": true, "status": "rejected" }`} />
          </Endpoint>

          <Endpoint method="POST" path="/api/affiliate/batch/approve" description="Aprova todos os afiliados pendentes de um produto em lote.">
            <CodeBlock id="aff-batch-approve" lang="JSON" code={`{ "checkoutId": "FBlJzE7Sguflt7XT" }`} />
          </Endpoint>
        </div>
      );

      // ── Afiliados: Comissões ───────────────────────────────────────────────
      case "afiliados-comissoes": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Comissões de Afiliados</h2>
            <p className="text-gray-600">Defina comissões globais por produto ou individualmente por afiliado.</p>
          </div>

          <Endpoint method="PATCH" path="/api/affiliations/:id/commission" description="Atualiza a comissão individual de um afiliado aprovado.">
            <CodeBlock id="aff-comm" lang="JSON" code={`{
  "customCommission": 25
}

// Resposta:
{
  "success": true,
  "affiliateId": "aff_abc123",
  "customCommission": 25
}`} />
          </Endpoint>

          <Endpoint method="POST" path="/api/affiliate/batch/update-commission" description="Atualiza a comissão de todos os afiliados aprovados de um produto.">
            <CodeBlock id="aff-batch-comm" lang="JSON" code={`{
  "checkoutId": "FBlJzE7Sguflt7XT",
  "customCommission": 20
}`} />
          </Endpoint>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Evento de comissão (webhook)</h3>
            <p className="text-sm text-gray-600 mb-3">Quando uma venda de afiliado é aprovada, o evento <code className="bg-gray-100 px-1 rounded text-xs">payment.pix.paid</code> inclui:</p>
            <CodeBlock id="aff-webhook-ev" lang="JSON" code={`{
  "event": "payment.pix.paid",
  "data": {
    "orderId": "order_...",
    "isAffiliateSale": true,
    "affiliateId": "AFFILIATE_UID",
    "affiliateCommission": 20,
    "affiliateEarned": 1980,
    "amount": 9900
  }
}`} />
          </div>
        </div>
      );


      // ── Webhook: Configurar ────────────────────────────────────────────────
      case "webhook-configurar": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Configurar Webhook</h2>
            <p className="text-gray-600">Registre sua URL para receber notificações em tempo real de pagamentos e eventos.</p>
          </div>

          <Endpoint method="PUT" path="/api/seller/webhook-settings" description="Registra ou atualiza a URL de webhook do seller.">
            <CodeBlock id="wh-config-req" lang="JSON" code={`{
  "webhookUrl": "https://seusite.com/webhook/volatuspay",
  "events": [
    "payment.pix.paid",
    "payment.card.approved",
    "payment.boleto.paid",
    "subscription.created",
    "subscription.renewed",
    "subscription.cancelled",
    "subscription.payment_failed",
    "access.granted",
    "cart.abandoned"
  ]
}`} />
            <CodeBlock id="wh-config-resp" lang="JSON" code={`{
  "success": true,
  "webhookUrl": "https://seusite.com/webhook/volatuspay",
  "events": ["payment.pix.paid", "..."],
  "updatedAt": "2026-02-19T10:00:00Z"
}`} />
          </Endpoint>

          <Endpoint method="POST" path="/api/seller/webhook-test" description="Envia um evento de teste para validar a integração.">
            <CodeBlock id="wh-test-req" lang="JSON" code={`{ "event": "payment.pix.paid" }`} />
          </Endpoint>

          <Note type="warning">
            Sua URL deve estar acessível via HTTPS. Retorne HTTP 200 em até 10 segundos.
            Respostas fora desse prazo são tratadas como falha e acionam o mecanismo de reenvio.
          </Note>
        </div>
      );

      // ── Webhook: Formato ───────────────────────────────────────────────────
      case "webhook-formato": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Formato dos Webhooks</h2>
            <p className="text-gray-600">Todos os webhooks seguem a mesma estrutura de envelope.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Estrutura do envelope</h3>
            <CodeBlock id="wh-envelope" lang="JSON" code={`{
  "event": "payment.pix.paid",
  "tenantId": "30oeliRh2fUqkS5msSiwGMdEnvJ2",
  "timestamp": "2026-02-18T10:31:00.000Z",
  "apiVersion": "${API_VERSION}",
  "data": { /* payload específico do evento */ }
}`} />
          </div>

          <div className="space-y-4">
            {[
              { title: "payment.pix.paid - PIX confirmado", code: `{
  "event": "payment.pix.paid",
  "tenantId": "30oeliRh2fUqkS5msSiwGMdEnvJ2",
  "data": {
    "orderId": "order_1708300000000_x7kM2p",
    "txid": "E20018183202202011...PIX_TXID",
    "amount": 9900,
    "amountFormatted": "R$ 99,00",
    "paidAt": "2026-02-18T10:31:00.000Z",
    "customer": { "name": "João Silva", "email": "joao@email.com", "document": "***.***.***-00" },
    "product": { "id": "product_...", "name": "Curso de Marketing", "type": "digital" },
    "offer": { "id": "offer_...", "name": "Plano Básico", "code": "plano-basico" },
    "isAffiliateSale": false,
    "processor": "efibank"
  },
  "timestamp": "2026-02-18T10:31:00.000Z",
  "apiVersion": "${API_VERSION}"
}` },
              { title: "subscription.renewed - Assinatura renovada", code: `{
  "event": "subscription.renewed",
  "tenantId": "30oeliRh2fUqkS5msSiwGMdEnvJ2",
  "data": {
    "subscriptionId": "sub_aBcDeFgHiJkLmNoPqRsT",
    "orderId": "order_1708300000000_renewal",
    "amount": 4900,
    "planName": "Plano Mensal",
    "period": "monthly",
    "nextBillingDate": "2026-04-01T00:00:00.000Z",
    "accessEndDate": "2026-04-01T00:00:00.000Z",
    "customer": { "name": "João Silva", "email": "joao@email.com" }
  },
  "timestamp": "2026-03-01T10:00:00.000Z",
  "apiVersion": "${API_VERSION}"
}` },
              { title: "access.granted - Acesso liberado", code: `{
  "event": "access.granted",
  "tenantId": "30oeliRh2fUqkS5msSiwGMdEnvJ2",
  "data": {
    "orderId": "order_1708300000000_x7kM2p",
    "customerId": "CUSTOMER_UID",
    "productId": "product_1708300000000_aBcDeFgH",
    "accessUrl": "${BASE_URL}/members/product_...",
    "grantedAt": "2026-02-18T10:31:00.000Z"
  },
  "timestamp": "2026-02-18T10:31:00.000Z",
  "apiVersion": "${API_VERSION}"
}` },
            ].map(e => (
              <div key={e.title} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <code className="text-xs font-mono text-gray-700 font-semibold">{e.title}</code>
                </div>
                <div className="p-5">
                  <CodeBlock id={`ev-${e.title.split(" ")[0]}`} lang="JSON" code={e.code} />
                </div>
              </div>
            ))}
          </div>

          <EventTable rows={[
            { ev: "payment.pix.created",            desc: "QR Code PIX gerado",                              prod: "todos" },
            { ev: "payment.pix.paid",               desc: "PIX confirmado pelo Banco Central",                prod: "todos" },
            { ev: "payment.pix.expired",            desc: "PIX expirou sem pagamento",                        prod: "todos" },
            { ev: "payment.card.approved",          desc: "Cartão BR (EfiBank) ou Global (Stripe) aprovado",  prod: "todos" },
            { ev: "payment.declined",               desc: "Cartão recusado pelo gateway",                     prod: "todos" },
            { ev: "payment.boleto.created",         desc: "Boleto gerado",                                    prod: "todos" },
            { ev: "payment.boleto.paid",            desc: "Boleto compensado",                                prod: "todos" },
            { ev: "payment.boleto.expired",         desc: "Boleto venceu sem pagamento",                      prod: "todos" },
            { ev: "payment.refunded",               desc: "Reembolso processado",                             prod: "todos" },
            { ev: "payment.chargeback",             desc: "Contestação aberta no banco",                      prod: "todos" },
            { ev: "subscription.created",           desc: "Nova assinatura iniciada",                         prod: "subscription" },
            { ev: "subscription.renewed",           desc: "Assinatura renovada com sucesso",                  prod: "subscription" },
            { ev: "subscription.billing_upcoming",  desc: "Aviso de cobrança D-3 (configure no dashboard)",   prod: "subscription" },
            { ev: "subscription.payment_failed",    desc: "Falha na cobrança recorrente",                     prod: "subscription" },
            { ev: "subscription.overdue",           desc: "Assinatura em atraso",                             prod: "subscription" },
            { ev: "subscription.cancelled",         desc: "Assinatura cancelada",                             prod: "subscription" },
            { ev: "access.granted",                 desc: "Acesso ao produto liberado",                       prod: "digital" },
            { ev: "access.revoked",                 desc: "Acesso revogado",                                  prod: "digital" },
            { ev: "cart.abandoned",                 desc: "Carrinho abandonado pelo comprador",               prod: "todos" },
          ]} />
        </div>
      );

      // ── Webhook: Segurança ─────────────────────────────────────────────────
      case "webhook-seguranca": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Segurança e Validação</h2>
            <p className="text-gray-600">Valide a assinatura HMAC-SHA256 em todos os webhooks para garantir autenticidade.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-2">Headers enviados em cada webhook</h3>
            <CodeBlock id="wh-headers" lang="HTTP" code={`X-Zen-Signature: sha256=a1b2c3d4e5f6...  /* HMAC-SHA256 do body */
X-Webhook-Timestamp: 1708300000             /* Unix timestamp da requisição */
X-Zen-Event: payment.pix.paid              /* Nome do evento */
Content-Type: application/json`} />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900">Validação por linguagem</h3>
            <CodeBlock id="wh-validate" tabs={[
              { label: "Node.js", lang: "JavaScript", code: `const crypto = require("crypto");

function validateWebhook(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody) // body bruto (Buffer), nunca JSON.parse
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected)
  );
}

// Express handler
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig    = req.headers["x-zen-signature"];
  const secret = process.env.VOLATUSPAY_WEBHOOK_SECRET;

  if (!validateWebhook(req.body, sig, secret)) {
    return res.status(401).send("Assinatura inválida");
  }

  const event = JSON.parse(req.body.toString());
  // processar event.event ...
  res.status(200).send("OK");
});` },
              { label: "Python", lang: "Python", code: `import hmac, hashlib

def validate_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

# Flask example
from flask import Flask, request, abort
app = Flask(__name__)

@app.route("/webhook", methods=["POST"])
def webhook():
    sig    = request.headers.get("X-Zen-Signature", "")
    secret = os.environ["VOLATUSPAY_WEBHOOK_SECRET"]

    if not validate_webhook(request.get_data(), sig, secret):
        abort(401)

    event = request.get_json()
    print(event["event"])
    return "OK", 200` },
              { label: "PHP", lang: "PHP", code: `<?php
function validateWebhook(string $rawBody, string $signature, string $secret): bool {
    $expected = "sha256=" . hash_hmac("sha256", $rawBody, $secret);
    return hash_equals($expected, $signature);
}

$payload   = file_get_contents("php://input");
$signature = $_SERVER["HTTP_X_ZEN_SIGNATURE"] ?? "";
$secret    = getenv("VOLATUSPAY_WEBHOOK_SECRET");

if (!validateWebhook($payload, $signature, $secret)) {
    http_response_code(401);
    exit("Assinatura inválida");
}

$event = json_decode($payload, true);
// processar $event["event"] ...
http_response_code(200);
echo "OK";` },
            ]} />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-gray-900">Boas práticas</h3>
            <div className="space-y-2.5">
              {[
                { icon: Shield, t: "Valide sempre a assinatura HMAC antes de processar qualquer evento" },
                { icon: Shield, t: "Use o body bruto (raw bytes) para calcular o HMAC - nunca o JSON parseado" },
                { icon: Shield, t: "Retorne 200 imediatamente e processe de forma assíncrona em background" },
                { icon: Shield, t: "Implemente idempotência usando o orderId como chave única" },
                { icon: Shield, t: "Use HTTPS (TLS 1.2+) na sua URL de webhook" },
                { icon: Shield, t: "Armazene o webhook secret em variável de ambiente, nunca no código" },
              ].map((b, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <b.icon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                  <span className="text-gray-600">{b.t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

      // ── Webhook: Retry ─────────────────────────────────────────────────────
      case "webhook-retry": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Reenvios e Garantias</h2>
            <p className="text-gray-600">A VolatusPay garante entrega dos webhooks com política de reenvio automático.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900">Política de reenvio (retry)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-gray-700 uppercase">Tentativa</th>
                    <th className="text-left py-2 px-4 text-xs font-semibold text-gray-700 uppercase">Atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { t: "1ª (inicial)", d: "Imediato" },
                    { t: "2ª reenvio", d: "5 minutos" },
                    { t: "3ª reenvio", d: "30 minutos" },
                    { t: "4ª reenvio", d: "2 horas" },
                    { t: "5ª reenvio", d: "6 horas" },
                    { t: "6ª reenvio", d: "24 horas - última tentativa" },
                  ].map((r, i) => (
                    <tr key={r.t} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="py-2 px-4 text-gray-700">{r.t}</td>
                      <td className="py-2 px-4 text-gray-500">{r.d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-gray-900">Considerado sucesso</h3>
            <p className="text-sm text-gray-600">Qualquer resposta HTTP <code className="bg-gray-100 px-1 rounded text-xs">2xx</code> dentro de 10 segundos.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-gray-900">Considerado falha (aciona retry)</h3>
            <div className="space-y-2 text-sm text-gray-600">
              {[
                "Resposta com status 4xx ou 5xx",
                "Timeout após 10 segundos",
                "Conexão recusada / servidor inacessível",
                "SSL/TLS inválido",
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </div>

          <Note type="warning">
            <strong>Idempotência é essencial.</strong> Como os reenvios podem repetir o mesmo evento, use o <code className="bg-amber-100 px-1 rounded text-xs">orderId</code> como chave única para evitar processar o mesmo pagamento duas vezes.
          </Note>
        </div>
      );

      // ── IDs e Recursos ─────────────────────────────────────────────────────
      case "ids-recursos": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">IDs e Recursos</h2>
            <p className="text-gray-600">Todos os IDs são únicos, imutáveis e prefixados por tipo de recurso.</p>
          </div>
          <FieldTable rows={[
            { field: "product_{timestamp}_{random}", type: "Produto", desc: "Ex: product_1708300000000_aBcDeFgH" },
            { field: "order_{timestamp}_{random}", type: "Pedido (checkout)", desc: "Ex: order_1708300000000_x7kM2p" },
            { field: "order_boleto_{timestamp}_{random}", type: "Boleto", desc: "Ex: order_boleto_1708300000000_k9pR4s" },
            { field: "refund_{timestamp}_{random}", type: "Reembolso", desc: "Ex: refund_1708300000000_abc123xyz" },
            { field: "sub_{nanoid}", type: "Assinatura", desc: "Ex: sub_aBcDeFgHiJkLmNoPqRsT" },
            { field: "offer_{nanoid}", type: "Oferta", desc: "Ex: offer_7kM2pQr9sT4x" },
            { field: "coupon_{nanoid}", type: "Cupom", desc: "Ex: coupon_abc123" },
            { field: "Firebase UID", type: "Seller/Tenant", desc: "Ex: 30oeliRh2fUqkS5msSiwGMdEnvJ2" },
            { field: "Firestore ID", type: "Checkout", desc: "Ex: FBlJzE7Sguflt7XT (ID da oferta no Firestore)" },
          ]} />
        </div>
      );

      // ── Erros ──────────────────────────────────────────────────────────────
      case "erros": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Códigos de Erro</h2>
            <p className="text-gray-600">Todos os erros retornam JSON com campo <code className="bg-gray-100 px-1 rounded text-xs">error</code> e, quando aplicável, <code className="bg-gray-100 px-1 rounded text-xs">code</code>.</p>
          </div>

          <CodeBlock id="error-format" lang="JSON" code={`{
  "error": "Descrição legível do erro",
  "code": "ERROR_CODE"
}`} />

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-700 uppercase">HTTP</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-700 uppercase">Situação</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-700 uppercase">Ação recomendada</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { h: "400", s: "Parâmetros inválidos ou faltando", a: "Verifique os campos obrigatórios" },
                  { h: "401", s: "Token inválido ou expirado", a: "Renove o token Firebase e tente novamente" },
                  { h: "403", s: "Acesso negado ao recurso", a: "Verifique se o tenantId bate com o token" },
                  { h: "404", s: "Recurso não encontrado", a: "Verifique o ID do recurso" },
                  { h: "409", s: "Conflito (ex: slug já existe)", a: "Use um slug diferente" },
                  { h: "422", s: "Validação de negócio falhou", a: "Leia o campo error para detalhes" },
                  { h: "429", s: "Rate limit atingido", a: "Aguarde antes de tentar novamente" },
                  { h: "500", s: "Erro interno do servidor", a: "Tente novamente ou contate o suporte" },
                ].map((r, i) => (
                  <tr key={r.h} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="py-2.5 px-4"><code className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.h}</code></td>
                    <td className="py-2.5 px-4 text-gray-600 text-xs">{r.s}</td>
                    <td className="py-2.5 px-4 text-gray-500 text-xs">{r.a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );

      // ── Rate Limits ────────────────────────────────────────────────────────
      case "rate-limits": return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Limites de Uso</h2>
            <p className="text-gray-600">Limites por seller para garantir estabilidade da plataforma.</p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-700 uppercase">Recurso</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-700 uppercase">Limite</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { r: "Requisições de API geral", l: "300 / minuto por seller" },
                  { r: "Criar pagamentos", l: "60 / minuto" },
                  { r: "Polling de status (GET /orders/:id/status)", l: "Sem limite (endpoint público)" },
                  { r: "Produtos por seller", l: "Máx. 15 produtos ativos" },
                  { r: "Ofertas por produto", l: "Máx. 7 ofertas por produto" },
                  { r: "Cupons por produto", l: "Sem limite oficial" },
                ].map((r, i) => (
                  <tr key={r.r} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="py-2.5 px-4 text-gray-900 text-xs">{r.r}</td>
                    <td className="py-2.5 px-4 text-gray-600 text-xs">{r.l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-2">Quando o limite é atingido</h3>
            <p className="text-xs text-gray-500">
              A API retorna <code className="bg-gray-100 px-1 rounded text-xs">HTTP 429</code> com corpo:
            </p>
            <CodeBlock id="rl-429" lang="JSON" code={`{ "error": "Rate limit exceeded. Try again later." }`} />
            <p className="text-xs text-gray-500 mt-2">
              Implemente <em>exponential backoff</em> e reenvie a requisição após alguns segundos.
            </p>
          </div>
        </div>
      );

      default: return (
        <div className="text-center py-20 text-gray-400">
          <BookOpen className="w-8 h-8 mx-auto mb-2" />
          <p>Seção não encontrada</p>
        </div>
      );
    }
  };

  // ─── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0d0f14] flex flex-col">
      <style>{`
        .docs-content h1,.docs-content h2,.docs-content h3,.docs-content h4 { color: #f1f5f9; }
        .docs-content p { color: #9ca3af; }
        .docs-content .bg-white { background-color: #0f1117 !important; }
        .docs-content .bg-gray-50 { background-color: #13161e !important; }
        .docs-content .border-gray-200 { border-color: rgba(255,255,255,0.08) !important; }
        .docs-content .border-gray-100 { border-color: rgba(255,255,255,0.05) !important; }
        .docs-content .text-gray-900 { color: #f1f5f9 !important; }
        .docs-content .text-gray-700 { color: #d1d5db !important; }
        .docs-content .text-gray-600 { color: #9ca3af !important; }
        .docs-content .text-gray-500 { color: #6b7280 !important; }
        .docs-content .text-gray-400 { color: #6b7280 !important; }
        .docs-content .bg-gray-100 { background-color: rgba(255,255,255,0.07) !important; }
        .docs-content .bg-gray-200 { background-color: rgba(255,255,255,0.1) !important; }
        .docs-content code { color: #e2e8f0 !important; }
        .docs-content .bg-blue-50 { background-color: #0c1524 !important; }
        .docs-content .bg-blue-100 { background-color: #172554 !important; }
        .docs-content .text-blue-700 { color: #93c5fd !important; }
        .docs-content .text-blue-800 { color: #93c5fd !important; }
        .docs-content .border-blue-200 { border-color: #1e3a8a !important; }
        .docs-content .bg-emerald-50 { background-color: #071d12 !important; }
        .docs-content .text-emerald-700 { color: #6ee7b7 !important; }
        .docs-content .text-gray-800 { color: #e5e7eb !important; }
        .docs-content .bg-yellow-50,.docs-content .bg-yellow-100 { background-color: #1c1400 !important; }
        .docs-content .text-yellow-700 { color: #fde047 !important; }
        .docs-content .bg-orange-50,.docs-content .bg-orange-100 { background-color: #1f0f00 !important; }
        .docs-content .text-orange-700 { color: #fb923c !important; }
        .docs-content .bg-red-50,.docs-content .bg-red-100 { background-color: #1c0000 !important; }
        .docs-content .text-red-700 { color: #fca5a5 !important; }
        .docs-content .text-red-500 { color: #f87171 !important; }
        .docs-content thead th { color: #9ca3af !important; }
        .docs-content tr.bg-white { background-color: #111827 !important; }
        .docs-content tr.bg-gray-50 { background-color: #0d1117 !important; }
        .docs-content .divide-gray-200>*+* { border-color: rgba(255,255,255,0.06) !important; }
        .docs-content .shadow-sm { box-shadow: none !important; }
      `}</style>
      {/* Top nav */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/logo-volatuspay.png"
            alt="VolatusPay"
            style={{ height: 32, width: "auto", objectFit: "contain" }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-500">Documentação da API</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs font-mono">{API_VERSION}</Badge>
          <a
            href={`${BASE_URL}/register`}
            className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            Criar conta
          </a>
        </div>
      </header>

      <div className="flex flex-1 max-w-screen-xl mx-auto w-full">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto border-r border-white/[0.07] bg-[#0d0f14] py-6 px-4">
          <nav className="space-y-1">
            {MENU.map(section => {
              const isOpen = !!openSections[section.id];
              const isActive = activeSection === section.id;
              return (
                <div key={section.id}>
                  <button
                    onClick={() => {
                      const isCurrentlyOpen = !!openSections[section.id];
                      if (isCurrentlyOpen) {
                        toggleSection(section.id);
                      } else {
                        toggleSection(section.id);
                        if (section.subsections.length > 0) {
                          setActiveSection(section.id);
                          setActiveSubsection(section.subsections[0].id);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }
                      }
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive ? "bg-white/[0.07] text-white" : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
                    }`}
                  >
                    <span>{section.title}</span>
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  {isOpen && (
                    <div className="mt-1 ml-6 space-y-0.5">
                      {section.subsections.map(sub => (
                        <button
                          key={sub.id}
                          onClick={() => navigate(section.id, sub.id)}
                          className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors ${
                            activeSubsection === sub.id
                              ? "bg-white text-gray-900 font-semibold"
                              : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]"
                          }`}
                        >
                          {sub.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="docs-content flex-1 min-w-0 px-8 py-10 max-w-3xl">
          {renderContent()}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.07] bg-[#0d0f14] py-6 px-8 text-center">
        <p className="text-xs text-gray-600">
          VolatusPay · <a href={BASE_URL} className="hover:text-gray-400">{BASE_URL}</a> · API {API_VERSION}
        </p>
      </footer>
    </div>
  );
}
