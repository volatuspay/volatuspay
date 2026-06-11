/**
 * VolatusPay — Rotas LGPD (Lei 13.709/2018)
 *
 * Endpoints públicos (sem auth): documentos legais, requisições de titulares
 * Endpoints admin: ROPA, incidentes, stats, advisor IA
 *
 * Art. 18 LGPD — o exercício de direitos deve ser FACILITADO.
 * Não exigimos login para registrar requisições de direitos do titular.
 */

import { Router } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import type { AuthenticatedRequest } from "../security/firebase-auth.js";
import {
  recordConsent,
  revokeConsent,
  createDataSubjectRequest,
  updateRequestStatus,
  recordBreach,
  markBreachReported,
  getLgpdStats,
  getConsentRecord,
  getRequest,
  getBreaches,
  consultLgpdAdvisor,
  ROPA,
  type LegalBasis,
  type DataSubjectRightType,
} from "../security/lgpd-engine.js";
import {
  PRIVACY_POLICY,
  TERMS_OF_USE,
  DPA,
  COOKIE_POLICY,
  POLICY_VERSION,
  DPO_EMAIL,
} from "../security/lgpd-documents.js";

const router = Router();

/** Extrai IP real do cliente respeitando proxies */
function getClientIp(req: any): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown"
  );
}

/* ══════════════════════════════════════════════════
   DOCUMENTOS LEGAIS — públicos, sem autenticação
   (transparência LGPD Art. 9 — acesso facilitado)
══════════════════════════════════════════════════ */

router.get("/api/lgpd/privacy-policy", (_req, res) => {
  res.json({
    version:   PRIVACY_POLICY.version,
    updatedAt: PRIVACY_POLICY.updatedAt,
    title:     PRIVACY_POLICY.title,
    content:   PRIVACY_POLICY.content,
    dpoEmail:  DPO_EMAIL,
  });
});

router.get("/api/lgpd/terms", (_req, res) => {
  res.json({
    version:   TERMS_OF_USE.version,
    updatedAt: TERMS_OF_USE.updatedAt,
    title:     TERMS_OF_USE.title,
    content:   TERMS_OF_USE.content,
  });
});

router.get("/api/lgpd/dpa", (_req, res) => {
  res.json({
    version:   DPA.version,
    updatedAt: DPA.updatedAt,
    title:     DPA.title,
    content:   DPA.content,
  });
});

router.get("/api/lgpd/cookies", (_req, res) => {
  res.json({
    version:   COOKIE_POLICY.version,
    updatedAt: COOKIE_POLICY.updatedAt,
    title:     COOKIE_POLICY.title,
    content:   COOKIE_POLICY.content,
  });
});

/** Resumo dos documentos disponíveis */
router.get("/api/lgpd/documents", (_req, res) => {
  res.json({
    policyVersion: POLICY_VERSION,
    dpoEmail:      DPO_EMAIL,
    documents: [
      { id: "privacy-policy", title: "Política de Privacidade",                url: "/api/lgpd/privacy-policy" },
      { id: "terms",          title: "Termos de Uso",                           url: "/api/lgpd/terms" },
      { id: "dpa",            title: "Acordo de Processamento de Dados (DPA)", url: "/api/lgpd/dpa" },
      { id: "cookies",        title: "Política de Cookies",                    url: "/api/lgpd/cookies" },
    ],
  });
});

/* ══════════════════════════════════════════════════
   CONSENTIMENTO — Art. 7, I LGPD
══════════════════════════════════════════════════ */

router.post("/api/lgpd/consent", (req, res) => {
  const {
    tenantId, userId, purpose, legalBasis,
    dataCategories, collectionMethod, expiresInDays,
  } = req.body as {
    tenantId: string;
    userId?: string;
    purpose: string;
    legalBasis: LegalBasis;
    dataCategories: string[];
    collectionMethod?: string;
    expiresInDays?: number;
  };

  if (!tenantId || !purpose || !legalBasis || !dataCategories?.length) {
    res.status(400).json({ error: "Campos obrigatórios: tenantId, purpose, legalBasis, dataCategories" });
    return;
  }

  const ip     = getClientIp(req);
  const record = recordConsent({
    tenantId, userId, ip, purpose, legalBasis,
    dataCategories, collectionMethod: collectionMethod ?? "api", expiresInDays,
  });
  res.status(201).json({ success: true, consentId: record.id, grantedAt: record.grantedAt });
});

router.delete("/api/lgpd/consent/:id", (req, res) => {
  const ip     = getClientIp(req);
  const record = revokeConsent(req.params["id"]!, ip);
  if (!record) {
    res.status(404).json({ error: "Consentimento não encontrado" });
    return;
  }
  res.json({
    success:   true,
    revokedAt: record.revokedAt,
    message:   "Consentimento revogado. O tratamento com base neste consentimento foi encerrado.",
  });
});

router.get("/api/lgpd/consent/:id", (req, res) => {
  const record = getConsentRecord(req.params["id"]!);
  if (!record) {
    res.status(404).json({ error: "Registro de consentimento não encontrado" });
    return;
  }
  res.json(record);
});

/* ══════════════════════════════════════════════════
   DIREITOS DO TITULAR — Art. 18 LGPD
   Não exige login — o titular pode não ter conta ativa.
   Prazo de resposta: 15 dias úteis (Art. 18, §3)
══════════════════════════════════════════════════ */

const VALID_REQUEST_TYPES: DataSubjectRightType[] = [
  "access", "correction", "deletion", "portability",
  "restriction", "objection", "withdraw_consent",
];

router.post("/api/lgpd/request", (req, res) => {
  const { type, tenantId, userEmail, userName, notes } = req.body as {
    type: DataSubjectRightType;
    tenantId: string;
    userEmail: string;
    userName?: string;
    notes?: string;
  };

  if (!type || !tenantId || !userEmail) {
    res.status(400).json({ error: "Campos obrigatórios: type, tenantId, userEmail" });
    return;
  }
  if (!VALID_REQUEST_TYPES.includes(type)) {
    res.status(400).json({
      error: `Tipo inválido. Tipos aceitos: ${VALID_REQUEST_TYPES.join(", ")}`,
    });
    return;
  }
  if (!userEmail.includes("@")) {
    res.status(400).json({ error: "E-mail inválido" });
    return;
  }

  const ip  = getClientIp(req);
  const dsr = createDataSubjectRequest({ type, tenantId, userEmail, userName, ip, notes });

  const typeLabels: Record<DataSubjectRightType, string> = {
    access:           "Acesso aos dados",
    correction:       "Retificação",
    deletion:         "Eliminação",
    portability:      "Portabilidade",
    restriction:      "Limitação do tratamento",
    objection:        "Oposição ao tratamento",
    withdraw_consent: "Revogação de consentimento",
  };

  res.status(201).json({
    success:     true,
    requestId:   dsr.id,
    type:        typeLabels[type],
    requestedAt: dsr.requestedAt,
    deadline:    dsr.deadline,
    status:      dsr.status,
    message:
      `Sua requisição de ${typeLabels[type]} foi registrada. ` +
      `Responderemos em até 15 dias úteis conforme o Art. 18, §3 da LGPD. ` +
      `Guarde seu ID de requisição: ${dsr.id}`,
    dpoEmail: DPO_EMAIL,
  });
});

/** Consulta pública de status da requisição pelo ID */
router.get("/api/lgpd/request/:id", (req, res) => {
  const dsr = getRequest(req.params["id"]!);
  if (!dsr) {
    res.status(404).json({ error: "Requisição não encontrada. Verifique o ID informado." });
    return;
  }
  const maskedEmail = dsr.userEmail.replace(/(.{2}).+(@.+)/, "$1***$2");
  res.json({
    id:          dsr.id,
    type:        dsr.type,
    status:      dsr.status,
    requestedAt: dsr.requestedAt,
    deadline:    dsr.deadline,
    completedAt: dsr.completedAt,
    email:       maskedEmail,
    message:
      dsr.status === "completed"
        ? "Sua requisição foi concluída. Verifique o e-mail cadastrado para os detalhes."
        : dsr.status === "denied"
        ? `Requisição negada: ${dsr.denialReason ?? "motivo não especificado"}`
        : `Requisição em andamento. Prazo: ${new Date(dsr.deadline).toLocaleDateString("pt-BR")}`,
  });
});

/* ══════════════════════════════════════════════════
   ADMIN — Requer Firebase Auth + perfil admin
══════════════════════════════════════════════════ */

/** ROPA — Registro de Atividades de Tratamento (Art. 37) */
router.get(
  "/api/lgpd/ropa",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    res.json({ activities: ROPA, count: ROPA.length });
  }
);

/** Dashboard de compliance LGPD */
router.get(
  "/api/lgpd/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    res.json(getLgpdStats());
  }
);

/** Lista requisições de titulares (admin) */
router.get(
  "/api/lgpd/requests",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: AuthenticatedRequest, res) => {
    const stats = getLgpdStats();
    res.json(stats.recentRequests);
  }
);

/** Atualiza status de uma requisição (admin) */
router.patch(
  "/api/lgpd/request/:id",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: any, res) => {
    const { status, data, denialReason, note } = req.body;
    const updated = updateRequestStatus(req.params["id"]!, status, { data, denialReason, note });
    if (!updated) {
      res.status(404).json({ error: "Requisição não encontrada" });
      return;
    }
    res.json({ success: true, request: updated });
  }
);

/** Registra incidente de segurança com dados pessoais (Art. 48) */
router.post(
  "/api/lgpd/breach",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: any, res) => {
    const { dataCategories, estimatedAffected, description, severity, remediationSteps } = req.body;
    if (!dataCategories?.length || !description || !severity) {
      res.status(400).json({ error: "Campos obrigatórios: dataCategories, description, severity" });
      return;
    }
    const breach = recordBreach({
      dataCategories,
      estimatedAffected: estimatedAffected ?? 0,
      description,
      severity,
      remediationSteps,
    });
    res.status(201).json({
      success:           true,
      breachId:          breach.id,
      detectedAt:        breach.detectedAt,
      anpdDeadline:      breach.anpdDeadline,
      anpdDeadlineLocal: new Date(breach.anpdDeadline).toLocaleString("pt-BR"),
      warning:
        "⚠️ ATENÇÃO: Notifique a ANPD em https://www.gov.br/anpd em até 72 horas! " +
        `Prazo: ${new Date(breach.anpdDeadline).toLocaleString("pt-BR")}`,
    });
  }
);

/** Marca incidente como reportado à ANPD */
router.post(
  "/api/lgpd/breach/:id/reported",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: any, res) => {
    const breach = markBreachReported(req.params["id"]!);
    if (!breach) {
      res.status(404).json({ error: "Incidente não encontrado" });
      return;
    }
    res.json({ success: true, reportedAt: breach.reportedAt, status: breach.status });
  }
);

/** Lista incidentes registrados */
router.get(
  "/api/lgpd/breaches",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: any, res) => {
    res.json({ breaches: getBreaches() });
  }
);

/** LGPD Advisor — responde perguntas de compliance via IA */
router.post(
  "/api/lgpd/advisor",
  verifyFirebaseToken as any,
  requireAdmin as any,
  async (req: any, res) => {
    const { question } = req.body as { question: string };
    if (!question?.trim()) {
      res.status(400).json({ error: "Campo obrigatório: question" });
      return;
    }
    if (question.length > 2000) {
      res.status(400).json({ error: "Pergunta muito longa (máx 2000 caracteres)" });
      return;
    }
    try {
      const answer = await consultLgpdAdvisor(question);
      res.json({
        answer,
        disclaimer: "Esta análise é informativa e não constitui assessoria jurídica. Consulte um advogado especializado para decisões legais.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg.slice(0, 200) });
    }
  }
);

/** Self-test */
router.get("/api/lgpd/health", (_req, res) => {
  res.json({
    ok:     true,
    module: "lgpd",
    endpoints: [
      "GET  /api/lgpd/documents",
      "GET  /api/lgpd/privacy-policy",
      "GET  /api/lgpd/terms",
      "GET  /api/lgpd/dpa",
      "GET  /api/lgpd/cookies",
      "POST /api/lgpd/consent",
      "DELETE /api/lgpd/consent/:id",
      "GET  /api/lgpd/consent/:id",
      "POST /api/lgpd/request",
      "GET  /api/lgpd/request/:id",
      "GET  /api/lgpd/ropa        [admin]",
      "GET  /api/lgpd/stats       [admin]",
      "GET  /api/lgpd/requests    [admin]",
      "PATCH /api/lgpd/request/:id [admin]",
      "POST /api/lgpd/breach      [admin]",
      "POST /api/lgpd/breach/:id/reported [admin]",
      "GET  /api/lgpd/breaches    [admin]",
      "POST /api/lgpd/advisor     [admin]",
    ],
  });
});

export default router;
