/**
 * VolatusPay — LGPD Compliance Engine
 * Lei Geral de Proteção de Dados Pessoais — Lei 13.709/2018
 *
 * Adaptado do VolatusShield (Fase 33) para gateway de pagamento.
 *
 * 1. Gestão de Consentimento    — registra, revoga e audita bases legais (Art. 7)
 * 2. Direitos do Titular        — acesso, retificação, eliminação, portabilidade (Art. 18)
 * 3. ROPA                       — Registro de Atividades de Tratamento (Art. 37)
 * 4. Notificação de Incidentes  — 72h para ANPD (Art. 48)
 * 5. LGPD Advisor               — análise de compliance por IA (assíncrono)
 */

import OpenAI from "openai";

/* ─── Tipos principais ──────────────────────────────────────────── */

export type LegalBasis =
  | "consent"             // Art. 7, I — consentimento expresso
  | "contract"            // Art. 7, V — execução de contrato
  | "legal_obligation"    // Art. 7, II — obrigação legal
  | "legitimate_interest" // Art. 7, IX — interesse legítimo
  | "vital_interest"      // Art. 7, III — proteção da vida
  | "public_task";        // Art. 7, VI — políticas públicas

export type DataSubjectRightType =
  | "access"            // Art. 18, I — confirmação e acesso
  | "correction"        // Art. 18, III — retificação
  | "deletion"          // Art. 18, IV/VI — eliminação
  | "portability"       // Art. 18, V — portabilidade
  | "restriction"       // Art. 18, II — bloqueio/anonimização
  | "objection"         // Art. 18, IX — oposição ao tratamento
  | "withdraw_consent"; // Art. 18, VIII — revogação de consentimento

export type RequestStatus =
  | "pending"    // recebida, aguardando processamento
  | "in_review"  // em análise (prazo: 15 dias úteis, Art. 18 §3)
  | "completed"  // concluída
  | "denied"     // negada com justificativa legal
  | "expired";   // prazo vencido sem resposta (violação)

export interface ConsentRecord {
  id: string;
  tenantId: string;
  userId?: string;
  ip: string;
  purpose: string;
  legalBasis: LegalBasis;
  granted: boolean;
  grantedAt: string;
  revokedAt?: string;
  expiresAt?: string;
  dataCategories: string[];
  collectionMethod: string;
}

export interface DataSubjectRequest {
  id: string;
  type: DataSubjectRightType;
  tenantId: string;
  userEmail: string;
  userName?: string;
  ip: string;
  requestedAt: string;
  deadline: string;        // 15 dias úteis LGPD
  status: RequestStatus;
  completedAt?: string;
  denialReason?: string;
  data?: Record<string, unknown>;
  notes: string[];
}

export interface BreachNotification {
  id: string;
  detectedAt: string;
  anpdDeadline: string;    // 72 horas após detecção (Art. 48)
  reportedToAnpd: boolean;
  reportedAt?: string;
  dataCategories: string[];
  estimatedAffected: number;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  rootCause?: string;
  remediationSteps: string[];
  status: "open" | "reported" | "resolved";
}

export interface ProcessingActivity {
  id: string;
  name: string;
  controller: string;
  purpose: string;
  legalBasis: LegalBasis;
  dataCategories: string[];
  dataSubjects: string[];
  retentionPeriod: string;
  thirdParties: string[];
  internationalTransfers: boolean;
  securityMeasures: string[];
  riskLevel: "low" | "medium" | "high";
}

/* ─── ROPA — Atividades de Tratamento do VolatusPay (Art. 37) ─── */

export const ROPA: ProcessingActivity[] = [
  {
    id: "ropa-001",
    name: "Cadastro e Autenticação de Vendedores",
    controller: process.env["COMPANY_LEGAL_NAME"] ?? "VolatusPay",
    purpose: "Criação e gestão de contas de vendedores; verificação de identidade; controle de sessão e autenticação",
    legalBasis: "contract",
    dataCategories: ["nome completo", "e-mail", "CPF/CNPJ", "senha (hash bcrypt)", "telefone", "endereço"],
    dataSubjects: ["vendedores pessoa física", "vendedores pessoa jurídica e representantes legais"],
    retentionPeriod: "Duração do contrato + 5 anos (prazo prescricional Art. 206 CC)",
    thirdParties: [],
    internationalTransfers: false,
    securityMeasures: ["hash bcrypt", "Firebase Auth JWT", "2FA TOTP", "TLS 1.3", "HSTS"],
    riskLevel: "medium",
  },
  {
    id: "ropa-002",
    name: "Processamento de Pagamentos PIX",
    controller: process.env["COMPANY_LEGAL_NAME"] ?? "VolatusPay",
    purpose: "Geração de cobranças PIX, recebimento, conciliação e repasse de valores a vendedores",
    legalBasis: "contract",
    dataCategories: ["chave PIX", "nome do pagador", "CPF/CNPJ do pagador", "valor", "txid"],
    dataSubjects: ["compradores", "vendedores"],
    retentionPeriod: "7 anos (obrigação fiscal Lei 9.430/96 + Bacen)",
    thirdParties: ["EfiBank (intermediador financeiro — BR)", "Woovi (alternativa PIX — BR)", "ONZ Finance (alternativa PIX — BR)"],
    internationalTransfers: false,
    securityMeasures: ["TLS 1.3", "assinatura de webhook", "controle de acesso por tenant", "logs de auditoria imutáveis"],
    riskLevel: "high",
  },
  {
    id: "ropa-003",
    name: "Processamento de Pagamentos via Cartão",
    controller: "Adyen N.V. / Stripe Inc. (processadores independentes PCI-DSS)",
    purpose: "Autorização, captura e liquidação de pagamentos com cartão de crédito e débito",
    legalBasis: "contract",
    dataCategories: ["dados de cartão processados exclusivamente pela Adyen/Stripe", "e-mail de faturamento", "histórico de transações"],
    dataSubjects: ["compradores com pagamento por cartão"],
    retentionPeriod: "7 anos (obrigação fiscal)",
    thirdParties: ["Adyen N.V. (Países Baixos) — PCI-DSS nível 1", "Stripe Inc. (EUA) — PCI-DSS nível 1"],
    internationalTransfers: true,
    securityMeasures: ["VolatusPay não armazena dados de cartão", "tokenização via Adyen/Stripe", "PCI-DSS"],
    riskLevel: "medium",
  },
  {
    id: "ropa-004",
    name: "Processamento de Boleto Bancário",
    controller: process.env["COMPANY_LEGAL_NAME"] ?? "VolatusPay",
    purpose: "Geração, emissão e conciliação de boletos bancários para pagamento de compras",
    legalBasis: "contract",
    dataCategories: ["nome do sacado", "CPF/CNPJ do sacado", "endereço", "valor", "vencimento"],
    dataSubjects: ["compradores via boleto"],
    retentionPeriod: "7 anos (obrigação fiscal)",
    thirdParties: ["EfiBank (emissor de boleto — BR)"],
    internationalTransfers: false,
    securityMeasures: ["TLS 1.3", "autenticação por chave API", "logs de auditoria"],
    riskLevel: "medium",
  },
  {
    id: "ropa-005",
    name: "Upload e Validação de Documentos (RG/CNH)",
    controller: process.env["COMPANY_LEGAL_NAME"] ?? "VolatusPay",
    purpose: "Verificação de identidade de vendedores conforme exigência regulatória; prevenção a fraudes; KYC",
    legalBasis: "legal_obligation",
    dataCategories: ["imagem do RG ou CNH", "número do documento", "data de nascimento", "foto do titular"],
    dataSubjects: ["vendedores em processo de aprovação"],
    retentionPeriod: "Duração do cadastro + 5 anos (prazo prescricional)",
    thirdParties: ["Bunny.net CDN (armazenamento de arquivos — UE/EUA)"],
    internationalTransfers: true,
    securityMeasures: ["validação de magic bytes", "controle de acesso por tenant", "link temporário com expiração", "TLS 1.3"],
    riskLevel: "high",
  },
  {
    id: "ropa-006",
    name: "Monitoramento de Segurança e Antifraude",
    controller: process.env["COMPANY_LEGAL_NAME"] ?? "VolatusPay",
    purpose: "Proteção contra fraudes, ataques, chargeback e comportamento malicioso na plataforma",
    legalBasis: "legitimate_interest",
    dataCategories: ["endereços IP", "user-agents", "padrões de comportamento", "device fingerprint", "timestamps"],
    dataSubjects: ["visitantes", "compradores", "vendedores", "possíveis atacantes"],
    retentionPeriod: "90 dias para logs de segurança; IPs bloqueados por até 2 anos",
    thirdParties: [],
    internationalTransfers: false,
    securityMeasures: ["anonimização parcial de IPs", "acesso restrito a logs de segurança", "criptografia em repouso"],
    riskLevel: "low",
  },
  {
    id: "ropa-007",
    name: "Webhooks e Notificações de Pagamento",
    controller: process.env["COMPANY_LEGAL_NAME"] ?? "VolatusPay",
    purpose: "Notificação de eventos de pagamento (aprovado, recusado, estornado) aos vendedores via webhook",
    legalBasis: "contract",
    dataCategories: ["status do pagamento", "valor", "e-mail do comprador (parcial)", "ID do pedido"],
    dataSubjects: ["vendedores destinatários do webhook"],
    retentionPeriod: "30 dias (logs de entrega de webhook)",
    thirdParties: [],
    internationalTransfers: false,
    securityMeasures: ["assinatura HMAC-SHA256 dos payloads", "TLS mútuo", "retry com backoff"],
    riskLevel: "low",
  },
  {
    id: "ropa-008",
    name: "Registros de Auditoria e Compliance",
    controller: process.env["COMPANY_LEGAL_NAME"] ?? "VolatusPay",
    purpose: "Rastreabilidade de operações sensíveis, investigação de incidentes, atendimento a requisições legais e regulatórias",
    legalBasis: "legal_obligation",
    dataCategories: ["logs de acesso", "IP", "timestamp", "ação realizada", "resultado", "user-agent"],
    dataSubjects: ["administradores", "vendedores autenticados"],
    retentionPeriod: "5 anos (prazo legal geral + Art. 206 CC)",
    thirdParties: [],
    internationalTransfers: false,
    securityMeasures: ["logs imutáveis no Firebase Firestore", "acesso somente leitura para auditoria"],
    riskLevel: "low",
  },
];

/* ─── Armazenamento em memória (persiste durante o processo) ────── */

const consentStore = new Map<string, ConsentRecord>();
const requestStore = new Map<string, DataSubjectRequest>();
const breachStore  = new Map<string, BreachNotification>();

/* ─── Utilitários ────────────────────────────────────────────────── */

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Calcula prazo de 15 dias úteis (exclui fins de semana) */
function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

/* ─── API pública do engine ──────────────────────────────────────── */

/** Registra consentimento do titular (Art. 7, I) */
export function recordConsent(params: {
  tenantId: string;
  userId?: string;
  ip: string;
  purpose: string;
  legalBasis: LegalBasis;
  dataCategories: string[];
  collectionMethod: string;
  expiresInDays?: number;
}): ConsentRecord {
  const id  = generateId("cns");
  const now = new Date().toISOString();
  const record: ConsentRecord = {
    id,
    tenantId:         params.tenantId,
    userId:           params.userId,
    ip:               params.ip,
    purpose:          params.purpose,
    legalBasis:       params.legalBasis,
    granted:          true,
    grantedAt:        now,
    expiresAt:        params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 86_400_000).toISOString()
      : undefined,
    dataCategories:   params.dataCategories,
    collectionMethod: params.collectionMethod,
  };
  consentStore.set(id, record);
  return record;
}

/** Revoga consentimento (Art. 18, VIII — deve ser tão fácil quanto conceder) */
export function revokeConsent(consentId: string, ip: string): ConsentRecord | null {
  const record = consentStore.get(consentId);
  if (!record) return null;
  record.granted   = false;
  record.revokedAt = new Date().toISOString();
  consentStore.set(consentId, record);
  console.log(`[lgpd] 🔒 Consentimento ${consentId} revogado — IP: ${ip}`);
  return record;
}

/** Registra requisição de direito do titular (Art. 18) */
export function createDataSubjectRequest(params: {
  type: DataSubjectRightType;
  tenantId: string;
  userEmail: string;
  userName?: string;
  ip: string;
  notes?: string;
}): DataSubjectRequest {
  const id       = generateId("dsr");
  const now      = new Date();
  const deadline = addBusinessDays(now, 15); // Art. 18 §3: 15 dias úteis
  const dsr: DataSubjectRequest = {
    id,
    type:        params.type,
    tenantId:    params.tenantId,
    userEmail:   params.userEmail,
    userName:    params.userName,
    ip:          params.ip,
    requestedAt: now.toISOString(),
    deadline:    deadline.toISOString(),
    status:      "pending",
    notes:       params.notes ? [params.notes] : [],
  };
  requestStore.set(id, dsr);
  console.log(`[lgpd] 📋 Requisição ${params.type} registrada — ID: ${id} | prazo: ${deadline.toLocaleDateString("pt-BR")}`);
  return dsr;
}

/** Atualiza status de uma requisição */
export function updateRequestStatus(
  requestId: string,
  status: RequestStatus,
  options?: { data?: Record<string, unknown>; denialReason?: string; note?: string }
): DataSubjectRequest | null {
  const dsr = requestStore.get(requestId);
  if (!dsr) return null;
  dsr.status = status;
  if (status === "completed" || status === "denied") {
    dsr.completedAt = new Date().toISOString();
  }
  if (options?.data)         dsr.data = options.data;
  if (options?.denialReason) dsr.denialReason = options.denialReason;
  if (options?.note)         dsr.notes.push(options.note);
  requestStore.set(requestId, dsr);
  return dsr;
}

/** Registra incidente de segurança com dados pessoais (Art. 48) */
export function recordBreach(params: {
  dataCategories: string[];
  estimatedAffected: number;
  description: string;
  severity: BreachNotification["severity"];
  remediationSteps?: string[];
}): BreachNotification {
  const id           = generateId("brch");
  const detectedAt   = new Date();
  const anpdDeadline = new Date(detectedAt.getTime() + 72 * 3_600_000); // 72h
  const breach: BreachNotification = {
    id,
    detectedAt:        detectedAt.toISOString(),
    anpdDeadline:      anpdDeadline.toISOString(),
    reportedToAnpd:    false,
    dataCategories:    params.dataCategories,
    estimatedAffected: params.estimatedAffected,
    description:       params.description,
    severity:          params.severity,
    remediationSteps:  params.remediationSteps ?? [],
    status:            "open",
  };
  breachStore.set(id, breach);

  console.error(
    `[lgpd] 🚨 INCIDENTE LGPD registrado — ID: ${id} | ` +
    `${params.estimatedAffected} titulares afetados | ` +
    `Prazo ANPD: ${anpdDeadline.toLocaleString("pt-BR")}`
  );

  // Alerta quando prazo 72h vence sem reportar
  const msToDeadline = anpdDeadline.getTime() - Date.now();
  if (msToDeadline > 0) {
    setTimeout(() => {
      const b = breachStore.get(id);
      if (b && !b.reportedToAnpd) {
        console.error(`[lgpd] ⚠️  PRAZO ANPD VENCIDO para incidente ${id} — Notifique IMEDIATAMENTE: https://www.gov.br/anpd`);
      }
    }, msToDeadline);
  }

  return breach;
}

/** Marca incidente como reportado à ANPD */
export function markBreachReported(breachId: string): BreachNotification | null {
  const breach = breachStore.get(breachId);
  if (!breach) return null;
  breach.reportedToAnpd = true;
  breach.reportedAt     = new Date().toISOString();
  breach.status         = "reported";
  breachStore.set(breachId, breach);
  return breach;
}

/* ─── Stats para dashboard ──────────────────────────────────────── */

export function getLgpdStats() {
  const requests = [...requestStore.values()];
  const consents = [...consentStore.values()];
  const breaches = [...breachStore.values()];
  const now      = new Date();

  const overdue = requests.filter(
    r => (r.status === "pending" || r.status === "in_review") && new Date(r.deadline) < now
  );

  return {
    totalConsents:      consents.length,
    activeConsents:     consents.filter(c => c.granted && (!c.expiresAt || new Date(c.expiresAt) > now)).length,
    revokedConsents:    consents.filter(c => !c.granted).length,
    totalRequests:      requests.length,
    pendingRequests:    requests.filter(r => r.status === "pending").length,
    inReviewRequests:   requests.filter(r => r.status === "in_review").length,
    completedRequests:  requests.filter(r => r.status === "completed").length,
    overdueRequests:    overdue.length,
    breaches:           breaches.length,
    openBreaches:       breaches.filter(b => b.status === "open").length,
    processingActivities: ROPA.length,
    recentRequests:     requests.slice(-5).map(r => ({
      id:          r.id,
      type:        r.type,
      status:      r.status,
      email:       r.userEmail.replace(/(.{2}).+(@.+)/, "$1***$2"),
      requestedAt: r.requestedAt,
      deadline:    r.deadline,
    })),
  };
}

export function getConsentRecord(id: string): ConsentRecord | undefined {
  return consentStore.get(id);
}

export function getRequest(id: string): DataSubjectRequest | undefined {
  return requestStore.get(id);
}

export function getBreaches(): BreachNotification[] {
  return [...breachStore.values()].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
  );
}

/* ─── LGPD Advisor (assíncrono — usa OPENAI_API_KEY se disponível) ─ */

export async function consultLgpdAdvisor(question: string): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return "Advisor LGPD temporariamente indisponível (OPENAI_API_KEY não configurado). Consulte um advogado especializado em LGPD para orientação legal.";
  }

  const ropaContext = ROPA.map(a =>
    `- ${a.name}: finalidade="${a.purpose}", base="${a.legalBasis}", dados=[${a.dataCategories.slice(0, 3).join(", ")}], retenção="${a.retentionPeriod}"`
  ).join("\n");

  const stats = getLgpdStats();

  try {
    const client = new OpenAI({ apiKey });
    const resp   = await client.chat.completions.create({
      model:      "gpt-4o",
      max_tokens: 800,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Você é um especialista em LGPD (Lei 13.709/2018) do VolatusPay, gateway de pagamento brasileiro. " +
            "Responda sempre baseado na lei e no contexto real do sistema. " +
            "Seja preciso, cite artigos da LGPD quando relevante. Responda em português brasileiro. " +
            "Contexto do sistema — ROPA atual:\n" + ropaContext + "\n\n" +
            `Estado LGPD: ${stats.pendingRequests} requisições pendentes, ${stats.openBreaches} incidentes abertos, ` +
            `${stats.activeConsents} consentimentos ativos.`,
        },
        { role: "user", content: question },
      ],
    });
    return resp.choices[0]?.message?.content ?? "Sem resposta disponível.";
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Advisor temporariamente indisponível: ${msg.slice(0, 100)}`;
  }
}

console.log(`[lgpd] ⚖️  LGPD Compliance Engine carregado — ROPA com ${ROPA.length} atividades de tratamento`);
