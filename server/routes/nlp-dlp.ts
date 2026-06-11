/**
 * VolatusPay — NLP DLP Routes (Data Loss Prevention)
 *
 * Detecta e redige CPF, CNPJ, RG, cartão, PIX key, JWT, chaves PEM,
 * dados de saúde, credenciais — em respostas de API e logs.
 *
 * Todos os endpoints requerem autenticação admin.
 * Zero dado sai do servidor — processamento 100% local.
 */

import { Router, type Request, type Response } from "express";
import { verifyFirebaseToken, requireAdmin } from "../security/firebase-auth.js";
import type { AuthenticatedRequest } from "../security/firebase-auth.js";
import {
  scanDLP,
  redactPayload,
  getDLPHistory,
  getDLPScanById,
  getDLPStats,
  getDLPPolicies,
} from "../security/nlp-dlp.js";

const router = Router();

const MAX_SIZE = 256 * 1024; // 256 KB por payload
const BATCH_MAX = 20;

function extractText(body: Record<string, unknown>): string | null {
  const text = body["text"] ?? body["content"] ?? body["payload"] ?? body["data"];
  if (typeof text === "string" && text.trim().length > 0 && text.length <= MAX_SIZE) return text;
  if (typeof text === "object" && text !== null) {
    const s = JSON.stringify(text);
    return s.length <= MAX_SIZE ? s : null;
  }
  return null;
}

/** Scan de payload — detecta PII/PCI/credenciais */
router.post(
  "/api/nlp-dlp/scan",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const text = extractText(req.body as Record<string, unknown>);
    if (!text) {
      res.status(400).json({ error: "Campo 'text' obrigatório (máx 256 KB)" });
      return;
    }
    const source = typeof (req.body as any).source === "string"
      ? (req.body as any).source as string
      : "api";
    try {
      const result = scanDLP(text, { source });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "Erro no NLP DLP scanner", detail: String(e) });
    }
  }
);

/** Scan em lote — até 20 payloads */
router.post(
  "/api/nlp-dlp/scan/batch",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    if (!Array.isArray(body["payloads"])) {
      res.status(400).json({ error: "'payloads' deve ser um array" });
      return;
    }
    const payloads = (body["payloads"] as unknown[]).slice(0, BATCH_MAX);
    try {
      const results = payloads.map((p, i) => {
        const text = typeof p === "string" ? p : JSON.stringify(p);
        if (text.length > MAX_SIZE) return { error: `Payload ${i} excede 256 KB` };
        return scanDLP(text, { source: `batch-${i}` });
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ results, total: results.length });
    } catch (e) {
      res.status(500).json({ error: "Erro no batch scan", detail: String(e) });
    }
  }
);

/** Redação — substitui PII detectado sem armazenar histórico */
router.post(
  "/api/nlp-dlp/redact",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const text = extractText(req.body as Record<string, unknown>);
    if (!text) {
      res.status(400).json({ error: "Campo 'text' obrigatório (máx 256 KB)" });
      return;
    }
    try {
      const result = redactPayload(text);
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "Erro na redação", detail: String(e) });
    }
  }
);

/** Métricas de DLP */
router.get(
  "/api/nlp-dlp/stats",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getDLPStats());
  }
);

/** Políticas de detecção ativas */
router.get(
  "/api/nlp-dlp/policies",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (_req: Request, res: Response) => {
    const policies = getDLPPolicies();
    res.setHeader("Cache-Control", "no-store");
    res.json({ policies, total: policies.length });
  }
);

/** Histórico de scans */
router.get(
  "/api/nlp-dlp/history",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const limit = Math.min(100, parseInt(req.query["limit"] as string) || 20);
    const full  = req.query["full"] === "1";
    const hist  = getDLPHistory(limit).map(s => full ? s : {
      scanId:       s.scanId,
      ts:           s.ts,
      source:       s.source,
      chars:        s.chars,
      lines:        s.lines,
      summary:      s.summary,
      quantumScore: s.quantum.score,
      quantumLevel: s.quantum.level,
      clean:        s.clean,
      durationMs:   s.durationMs,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ history: hist, total: hist.length });
  }
);

/** Resultado de scan por ID */
router.get(
  "/api/nlp-dlp/scan/:id",
  verifyFirebaseToken as any,
  requireAdmin as any,
  (req: Request, res: Response) => {
    const result = getDLPScanById(req.params["id"]!);
    if (!result) {
      res.status(404).json({ error: "Scan não encontrado" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  }
);

/** Health check */
router.get("/api/nlp-dlp/health", (_req: Request, res: Response) => {
  const stats = getDLPStats();
  res.json({
    ok:          true,
    module:      "nlp-dlp",
    version:     stats.version,
    totalScans:  stats.totalScans,
    entities: [
      "cpf", "cnpj", "rg", "card_number", "pix_key",
      "jwt_token", "api_key", "private_key", "email",
      "phone_br", "iban", "health_keyword", "biometric",
    ],
  });
});

export default router;
