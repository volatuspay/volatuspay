/**
 * VolatusPay — QFUB Routes (Quantum File Upload Bypass Detection)
 * Detecta 40+ técnicas de bypass em uploads: polyglot, double ext,
 * MIME spoof, null byte, path traversal, zip bomb etc.
 */

import { Router, type Request, type Response } from "express";
import {
  analyzeUpload,
  analyzeBatch,
  getStats,
  getDetections,
  getDetectionById,
  getAuditLog,
  getTechniqueCatalog,
  getTechniqueDetail,
  selfTest,
  type QFUBUploadEvent,
  type SeverityLevel,
} from "../security/qfub.js";

const router = Router();

/** POST /api/qfub/analyze — analisa um upload */
router.post("/api/qfub/analyze", (req: Request, res: Response) => {
  const body = req.body as Partial<QFUBUploadEvent>;
  if (!body.filename || !body.declared_mime || body.file_size_bytes === undefined || !body.source_ip) {
    res.status(400).json({
      error: "Campos obrigatórios: filename, declared_mime, file_size_bytes, source_ip",
    });
    return;
  }
  const result = analyzeUpload(body as QFUBUploadEvent);
  res.json({ ok: true, result });
});

/** POST /api/qfub/analyze/batch — lote de uploads */
router.post("/api/qfub/analyze/batch", (req: Request, res: Response) => {
  const { events } = req.body as { events: QFUBUploadEvent[] };
  if (!Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: "Campo 'events' deve ser array não vazio" });
    return;
  }
  if (events.length > 200) {
    res.status(400).json({ error: "Máximo 200 eventos por batch" });
    return;
  }
  const results    = analyzeBatch(events);
  const blocked    = results.filter(r => r.block).length;
  const quarantined = results.filter(r => r.quarantine).length;
  const critical   = results.filter(r => r.severity === "CRÍTICO").length;
  res.json({ ok: true, total: results.length, blocked, quarantined, critical, results });
});

/** GET /api/qfub/detections — lista detecções */
router.get("/api/qfub/detections", (req: Request, res: Response) => {
  const limit    = Math.min(parseInt(req.query["limit"] as string) || 50, 500);
  const severity = req.query["severity"] as SeverityLevel | undefined;
  const detections = getDetections(limit, severity);
  res.json({ ok: true, total: detections.length, detections });
});

/** GET /api/qfub/detection/:upload_id */
router.get("/api/qfub/detection/:upload_id", (req: Request, res: Response) => {
  const item = getDetectionById(req.params["upload_id"]!);
  if (!item) { res.status(404).json({ error: "Upload não encontrado" }); return; }
  res.json({ ok: true, detection: item });
});

/** GET /api/qfub/techniques — catálogo de técnicas de bypass */
router.get("/api/qfub/techniques", (_req: Request, res: Response) => {
  const catalog = getTechniqueCatalog();
  res.json({ ok: true, total: catalog.length, techniques: catalog });
});

/** GET /api/qfub/technique/:name */
router.get("/api/qfub/technique/:name", (req: Request, res: Response) => {
  const detail = getTechniqueDetail(req.params["name"]!.toUpperCase());
  if (!detail) { res.status(404).json({ error: "Técnica não encontrada" }); return; }
  res.json({ ok: true, technique: detail });
});

/** GET /api/qfub/stats */
router.get("/api/qfub/stats", (_req: Request, res: Response) => {
  res.json({ ok: true, stats: getStats() });
});

/** GET /api/qfub/audit */
router.get("/api/qfub/audit", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query["limit"] as string) || 200, 1000);
  res.json({ ok: true, audit: getAuditLog(limit) });
});

/** GET /api/qfub/self-test */
router.get("/api/qfub/self-test", (_req: Request, res: Response) => {
  const result = selfTest();
  res.status(result.ok ? 200 : 500).json({ ok: result.ok, self_test: result });
});

/** GET /api/qfub/health */
router.get("/api/qfub/health", (_req: Request, res: Response) => {
  const stats = getStats();
  res.json({
    ok:     true,
    module: "qfub",
    stats,
    techniques: getTechniqueCatalog().length,
  });
});

export default router;
