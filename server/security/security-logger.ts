import { getFirestore, ensureFirebaseReady } from '../lib/firebase-admin.js';
import { saveDataToBunny, saveDataBatchToBunny } from '../lib/bunny-data-storage.js';

/**
 * 📝 SECURITY LOGGER - Salva logs de segurança no Firebase em tempo real
 * 
 * Este módulo garante que TODAS as ameaças detectadas sejam salvas permanentemente
 * no Firebase Firestore para auditoria e análise em tempo real.
 */

export interface SecurityLogData {
  // Informações básicas
  timestamp?: string;
  ip?: string;
  sourceIp?: string;
  endpoint: string;
  method?: string;
  userAgent?: string;
  
  // Classificação da ameaça
  threatCategory: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  
  // Ação tomada
  action: 'block' | 'allow' | 'log' | 'monitor';
  blocked?: boolean;
  
  // Detalhes da detecção
  detectionLayer?: string;
  detectionMethod?: string;
  riskScore?: number;
  confidence?: number;
  
  // Análise de IA (opcional)
  aiAnalysis?: boolean;
  aiScore?: number;
  aiConfidence?: number;
  confidenceScore?: number;
  aiReasoning?: string;
  
  // Performance
  processingTime?: number;
  responseTime?: number;
  
  // Evidências
  evidence?: {
    patterns?: string[];
    indicators?: string[];
    payload?: string;
    headers?: Record<string, string>;
    query?: string;
    body?: string;
  };
  
  // Metadados adicionais
  country?: string;
  city?: string;
  deviceFingerprint?: string;
  sessionId?: string;
  requestId?: string;
  
  // Outros campos opcionais para compatibilidade
  [key: string]: any;
}

/**
 * 💾 SALVAR LOG DE SEGURANÇA NO FIREBASE
 * 
 * Salva automaticamente com timestamp e ID único
 */
// 📊 MONITORAMENTO DE SAÚDE DO FIREBASE
let firebaseHealthy = true;
let lastFirebaseError: Date | null = null;
let consecutiveErrors = 0;
let isCheckingHealth = false;

export function getFirebaseHealth() {
  return {
    healthy: firebaseHealthy,
    lastError: lastFirebaseError,
    consecutiveErrors,
    status: firebaseHealthy ? 'operational' : 'degraded'
  };
}

// 🔍 HEALTH CHECK PERIÓDICO DO FIREBASE
async function checkFirebaseHealth() {
  if (isCheckingHealth) return;
  isCheckingHealth = true;
  
  try {
    await ensureFirebaseReady();
    const db = getFirestore();
    await db.doc('__health/ping').get();
    
    if (consecutiveErrors > 0) {
      console.log(`✅ Firebase operacional (recuperado após ${consecutiveErrors} erros)`);
      consecutiveErrors = 0;
    }
    firebaseHealthy = true;
  } catch (error) {
    consecutiveErrors++;
    lastFirebaseError = new Date();
    
    if (consecutiveErrors >= 3) {
      firebaseHealthy = false;
      console.error(`🚨 Firebase degradado: ${consecutiveErrors} erros consecutivos`);
    }
  } finally {
    isCheckingHealth = false;
  }
}

// Iniciar health check periódico (30 segundos)
console.log('🔍 Iniciando Firebase Health Check periódico (a cada 30s)...');
checkFirebaseHealth();
setInterval(checkFirebaseHealth, 30000);

export async function saveSecurityLog(logData: SecurityLogData): Promise<void> {
  try {
    const db = getFirestore();
    
    // Gerar ID único
    const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Garantir timestamp
    const timestamp = logData.timestamp || new Date().toISOString();
    
    // Normalizar campos de IP
    const ip = logData.ip || logData.sourceIp || 'unknown';
    
    // Criar documento de log
    const securityLog = {
      id: logId,
      timestamp,
      ip,
      sourceIp: ip,
      endpoint: logData.endpoint,
      method: logData.method || 'GET',
      userAgent: logData.userAgent || 'unknown',
      
      threatCategory: logData.threatCategory,
      category: logData.threatCategory, // Alias para compatibilidade
      severity: logData.severity,
      
      action: logData.action,
      blocked: logData.blocked || logData.action === 'block',
      
      detectionLayer: logData.detectionLayer || 'unknown',
      detectionMethod: logData.detectionMethod,
      riskScore: logData.riskScore || 0,
      confidence: logData.confidence || logData.confidenceScore || 0,
      
      aiAnalysis: logData.aiAnalysis || false,
      aiScore: logData.aiScore,
      aiConfidence: logData.aiConfidence || logData.confidenceScore,
      confidenceScore: logData.confidenceScore || logData.confidence,
      aiReasoning: logData.aiReasoning,
      
      processingTime: logData.processingTime || 0,
      responseTime: logData.responseTime || 0,
      
      evidence: logData.evidence || {},
      
      country: logData.country,
      city: logData.city,
      deviceFingerprint: logData.deviceFingerprint,
      sessionId: logData.sessionId,
      requestId: logData.requestId,
      
      // Campos adicionais
      ...Object.keys(logData).reduce((acc, key) => {
        if (!['timestamp', 'ip', 'sourceIp', 'endpoint', 'method', 'userAgent',
              'threatCategory', 'category', 'severity', 'action', 'blocked',
              'detectionLayer', 'detectionMethod', 'riskScore', 'confidence',
              'aiAnalysis', 'aiScore', 'aiConfidence', 'confidenceScore', 'aiReasoning',
              'processingTime', 'responseTime', 'evidence', 'country', 'city',
              'deviceFingerprint', 'sessionId', 'requestId'].includes(key)) {
          acc[key] = logData[key];
        }
        return acc;
      }, {} as Record<string, any>)
    };
    
    saveDataToBunny('logs/security', logId, securityLog).then(result => {
      if (!result.success) {
        console.warn(`⚠️ Bunny CDN falhou para log ${logId}: ${result.error}`);
      }
    }).catch(err => {
      console.warn(`⚠️ Bunny CDN erro inesperado para log ${logId}:`, err);
    });

    const firestoreIndex = {
      id: logId,
      timestamp,
      ip,
      severity: securityLog.severity,
      threatCategory: securityLog.threatCategory,
      action: securityLog.action,
      blocked: securityLog.blocked,
      endpoint: securityLog.endpoint,
    };

    await db.collection('securityLogs').doc(logId).set(firestoreIndex);
    
    if (consecutiveErrors > 0) {
      console.log(`✅ Firebase recuperado após ${consecutiveErrors} erros consecutivos`);
      consecutiveErrors = 0;
    }
    firebaseHealthy = true;
    
    // Log no console para debug
    if (logData.severity === 'critical' || logData.severity === 'high') {
      console.log(`🚨 SECURITY LOG SAVED: ${logData.threatCategory} from ${ip} - ${logData.action.toUpperCase()}`);
    }
    
  } catch (error) {
    // ⚠️ NÃO deixar falha de log quebrar a aplicação
    consecutiveErrors++;
    lastFirebaseError = new Date();
    
    // Marcar Firebase como unhealthy após 3 erros consecutivos
    if (consecutiveErrors >= 3) {
      firebaseHealthy = false;
      console.error(`🚨 FIREBASE DEGRADADO: ${consecutiveErrors} erros consecutivos ao salvar logs`);
    }
    
    console.error(`❌ Erro ao salvar log de segurança no Firebase (${consecutiveErrors}/${3}):`, error);
  }
}

/**
 * 📊 SALVAR LOG EM BATCH (para performance)
 * 
 * Útil quando há múltiplas ameaças detectadas simultaneamente
 */
export async function saveSecurityLogsBatch(logs: SecurityLogData[]): Promise<void> {
  try {
    const db = getFirestore();
    const batch = db.batch();
    
    const bunnyItems: Array<{ category: 'logs/security'; id: string; data: any }> = [];
    
    logs.forEach(logData => {
      const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = logData.timestamp || new Date().toISOString();
      const ip = logData.ip || logData.sourceIp || 'unknown';
      
      const fullLog = {
        id: logId,
        timestamp,
        ip,
        sourceIp: ip,
        ...logData
      };
      
      bunnyItems.push({ category: 'logs/security', id: logId, data: fullLog });

      const firestoreIndex = {
        id: logId,
        timestamp,
        ip,
        severity: logData.severity,
        threatCategory: logData.threatCategory,
        action: logData.action,
        blocked: logData.blocked || logData.action === 'block',
        endpoint: logData.endpoint,
      };
      
      const docRef = db.collection('securityLogs').doc(logId);
      batch.set(docRef, firestoreIndex);
    });
    
    saveDataBatchToBunny(bunnyItems).then(result => {
      if (result.errors > 0) {
        console.warn(`⚠️ Bunny CDN batch: ${result.saved} salvos, ${result.errors} erros`);
      }
    }).catch(err => {
      console.warn('⚠️ Bunny CDN batch erro inesperado:', err);
    });

    await batch.commit();
    console.log(`📊 ${logs.length} security logs saved in batch`);
    
  } catch (error) {
    console.error('❌ Erro ao salvar logs em batch no Firebase:', error);
  }
}

/**
 * 🔍 BUSCAR LOGS RECENTES
 * 
 * Útil para debugging e monitoramento
 */
export async function getRecentSecurityLogs(
  limit: number = 100,
  severityFilter?: string
): Promise<SecurityLogData[]> {
  try {
    const db = getFirestore();
    let query = db.collection('securityLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit);
    
    if (severityFilter) {
      query = query.where('severity', '==', severityFilter) as any;
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.data() as SecurityLogData);
    
  } catch (error) {
    console.error('❌ Erro ao buscar logs recentes:', error);
    return [];
  }
}

/**
 * 🚨 SALVAR LOG CRÍTICO (com notificação)
 * 
 * Para ameaças de severidade crítica que precisam de atenção imediata
 */
export async function saveCriticalSecurityLog(logData: SecurityLogData): Promise<void> {
  logData.severity = 'critical';
  await saveSecurityLog(logData);
  
  // TODO: Adicionar notificação para admin (email, SMS, etc)
  console.log(`🚨🚨🚨 CRITICAL THREAT DETECTED: ${logData.threatCategory} from ${logData.ip || logData.sourceIp}`);
}
