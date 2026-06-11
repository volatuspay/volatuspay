import { Request, Response, NextFunction } from 'express';
import { getAdmin } from '../lib/firebase-admin.js';
import { saveDataToBunny } from '../lib/bunny-data-storage.js';

/**
 * 📋 AUDIT LOGGER - TRILHAS SIEM CENTRALIZADAS
 * Sistema de auditoria centralizado para rastreabilidade de incidentes
 */

interface AuditLog {
  id: string;
  timestamp: string;
  requestId: string;
  
  // Request data
  method: string;
  path: string;
  query?: any;
  body?: any;
  
  // User data
  userId?: string;
  userEmail?: string;
  tenantId?: string;
  
  // Network data
  ip: string;
  userAgent?: string;
  origin?: string;
  
  // Response data
  statusCode?: number;
  responseTime?: number;
  
  // Security flags
  isBlocked?: boolean;
  threatLevel?: 'low' | 'medium' | 'high' | 'critical';
  securityFlags?: string[];
}

export function auditLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const requestId = (req as any).requestId || 'unknown';
  
  // Captura dados do request
  const auditData: Partial<AuditLog> = {
    id: `audit_${requestId}`,
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: req.ip || 'unknown',
    userAgent: req.headers['user-agent'],
    origin: req.headers['origin']
  };
  
  // Captura dados do usuário autenticado
  const authReq = req as any;
  if (authReq.user?.uid) {
    auditData.userId = authReq.user.uid;
    auditData.userEmail = authReq.user.email;
  }
  
  // Intercepta resposta
  const originalJson = res.json.bind(res);
  res.json = function(body: any) {
    auditData.statusCode = res.statusCode;
    auditData.responseTime = Date.now() - startTime;
    
    // Salva log de auditoria (async, não bloqueia resposta)
    saveAuditLog(auditData as AuditLog).catch(err => 
      console.error('❌ Erro ao salvar audit log:', err.message || err)
    );
    
    return originalJson(body);
  };
  
  next();
}

async function saveAuditLog(log: AuditLog): Promise<void> {
  try {
    const shouldSave = 
      (log.statusCode && log.statusCode >= 400) ||
      log.path?.includes('/api/admin/') ||
      log.path?.includes('/api/payment/') ||
      log.method !== 'GET';
    
    if (!shouldSave) return;
    
    const cleanLog = Object.fromEntries(
      Object.entries(log).filter(([_, v]) => v !== undefined)
    );
    
    saveDataToBunny('logs/audit', log.id, cleanLog).then(result => {
      if (!result.success) {
        console.warn(`⚠️ Bunny audit log failed (${log.id}): ${result.error}`);
      }
    }).catch(err => {
      console.warn(`⚠️ Bunny audit log error (${log.id}):`, err.message || err);
    });
    
    const admin = getAdmin();
    const db = admin.firestore();
    
    const indexEntry = {
      id: log.id,
      timestamp: log.timestamp,
      method: log.method,
      path: log.path,
      userId: log.userId || null,
      statusCode: log.statusCode || null,
      responseTime: log.responseTime || null,
      ip: log.ip,
      createdAt: new Date().toISOString()
    };
    
    await db.collection('auditLogs').doc(log.id).set(indexEntry);
    
    console.log(`📋 AUDIT LOG SAVED: ${log.method} ${log.path} (${log.statusCode}) - ${log.responseTime}ms`);
  } catch (error: any) {
    console.error('❌ Failed to save audit log:', error.message || error);
  }
}
