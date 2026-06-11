/**
 * 🔐 SISTEMA DE AUDITORIA DE PAGAMENTOS - ZEN PAGAMENTOS
 * Logs detalhados de todas as transições de status de pagamento
 * para detecção de fraude e compliance
 */

import { saveDataToBunny } from '../lib/bunny-data-storage.js';

export interface PaymentAuditLog {
  orderId: string;
  previousStatus: string;
  newStatus: string;
  changeReason: 'webhook_confirmed' | 'admin_manual' | 'system_timeout' | 'api_verification' | 'suspicious_activity';
  source: 'efibank_webhook' | 'stripe_webhook' | 'admin_panel' | 'system_auto' | 'api_call';
  timestamp: Date;
  ip: string;
  userAgent?: string;
  webhookId?: string;
  txid?: string;
  amount?: number;
  paymentMethod?: string;
  additionalData?: any;
}

/**
 * 🔍 AUDIT LOG: Registra mudança de status de pedido COM PERSISTÊNCIA NO FIRESTORE
 */
export async function logPaymentStatusChange(auditData: PaymentAuditLog): Promise<void> {
  const logEntry = {
    ...auditData,
    timestamp: new Date(),
    severity: auditData.newStatus === 'paid' ? 'CRITICAL' : 'INFO',
    systemId: 'VOLATUS_PAY_AUDIT',
    eventId: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
  };

  // 🚨 LOG CRÍTICO: Transições para PAID são sempre auditadas
  if (auditData.newStatus === 'paid') {
    console.log('🔐 PAYMENT AUDIT - CRITICAL: Status changed to PAID', logEntry);
    
    // 🛡️ VALIDAÇÕES DE SEGURANÇA ADICIONAIS
    if (auditData.source === 'api_call' && !auditData.webhookId) {
      console.error('🚨 SECURITY ALERT: PIX marcado como PAID sem webhook ID', logEntry);
    }
    
    if (auditData.changeReason === 'system_timeout') {
      console.error('🚨 SECURITY ALERT: Pagamento auto-aprovado por timeout - INVESTIGAR', logEntry);
    }
  }

  // Log normal para outras transições
  console.log('🔍 PAYMENT AUDIT:', logEntry);

  // 💾 PRIMARY: Persistir dados COMPLETOS no Bunny CDN (fire-and-forget)
  saveDataToBunny('logs/payment-audit', logEntry.eventId, logEntry).then(result => {
    if (result.success) {
      console.log('✅ Log de auditoria persistido no Bunny CDN:', logEntry.eventId);
    } else {
      console.warn('⚠️ Falha ao persistir log no Bunny CDN (non-blocking):', result.error);
    }
  }).catch(err => {
    console.warn('⚠️ Erro inesperado ao salvar no Bunny CDN (non-blocking):', err);
  });

  // 💾 SECONDARY: Índice LIGHTWEIGHT no Firestore para queries do dashboard
  try {
    const admin = await import('firebase-admin');
    if (admin.apps.length === 0) {
      console.log('⚠️ Firebase não inicializado - índice de auditoria será apenas no console');
      return;
    }

    const db = admin.firestore();
    await db.collection('payment-audit-logs').doc(logEntry.eventId).set({
      eventId: logEntry.eventId,
      orderId: logEntry.orderId,
      previousStatus: logEntry.previousStatus,
      newStatus: logEntry.newStatus,
      changeReason: logEntry.changeReason,
      source: logEntry.source,
      timestamp: admin.firestore.Timestamp.fromDate(logEntry.timestamp),
      severity: logEntry.severity,
      amount: logEntry.amount || null,
      paymentMethod: logEntry.paymentMethod || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Índice de auditoria persistido no Firestore:', logEntry.eventId);
    
  } catch (error) {
    console.error('❌ Erro ao persistir índice de auditoria no Firestore:', error);
  }
}

/**
 * 🛡️ VALIDAÇÃO: Verificar se transição de status é permitida
 */
export function isStatusTransitionAllowed(
  currentStatus: string, 
  newStatus: string,
  source: PaymentAuditLog['source']
): boolean {
  
  // 🔒 REGRA CRÍTICA: Apenas webhooks e admins podem marcar como PAID
  if (newStatus === 'paid') {
    const allowedSources = ['efibank_webhook', 'stripe_webhook', 'admin_panel'];
    if (!allowedSources.includes(source)) {
      console.error('🚨 SECURITY VIOLATION: Tentativa não autorizada de marcar como PAID', {
        currentStatus,
        newStatus,
        source,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  // Estados válidos de transição
  const validTransitions: Record<string, string[]> = {
    'pending': ['paid', 'cancelled', 'expired'],
    'paid': ['refunded', 'chargeback'], // PIX paid raramente muda
    'cancelled': [], // Final state
    'expired': ['paid'], // Pode ser pago mesmo expirado
    'refunded': ['chargeback'], // Pode ter chargeback
    'chargeback': [] // Final state
  };

  const allowedNext = validTransitions[currentStatus] || [];
  return allowedNext.includes(newStatus);
}

/**
 * 🔍 DETECTAR ATIVIDADE SUSPEITA: Múltiplas mudanças rápidas
 */
const recentChanges = new Map<string, Date[]>();

export function detectSuspiciousActivity(orderId: string): boolean {
  const now = new Date();
  const recent = recentChanges.get(orderId) || [];
  
  // Remover mudanças antigas (>5 minutos)
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const recentChanges5min = recent.filter(date => date > fiveMinutesAgo);
  
  // Adicionar mudança atual
  recentChanges5min.push(now);
  recentChanges.set(orderId, recentChanges5min);
  
  // 🚨 ALERTA: Mais de 3 mudanças em 5 minutos é suspeito
  if (recentChanges5min.length > 3) {
    console.error('🚨 SUSPICIOUS ACTIVITY: Múltiplas mudanças de status rápidas', {
      orderId,
      changeCount: recentChanges5min.length,
      timespan: '5_minutes',
      timestamps: recentChanges5min
    });
    return true;
  }
  
  return false;
}

/**
 * 🔐 WRAPPER SEGURO: Mudança de status com auditoria automática
 */
export async function auditedStatusChange(
  orderId: string,
  currentStatus: string,
  newStatus: string,
  source: PaymentAuditLog['source'],
  changeReason: PaymentAuditLog['changeReason'],
  metadata: Partial<PaymentAuditLog> = {}
): Promise<boolean> {
  
  // 1. Verificar se transição é permitida
  if (!isStatusTransitionAllowed(currentStatus, newStatus, source)) {
    await logPaymentStatusChange({
      orderId,
      previousStatus: currentStatus,
      newStatus,
      changeReason: 'suspicious_activity',
      source,
      timestamp: new Date(),
      ip: metadata.ip || 'unknown',
      ...metadata
    });
    return false;
  }
  
  // 2. Detectar atividade suspeita
  const isSuspicious = detectSuspiciousActivity(orderId);
  if (isSuspicious && source !== 'admin_panel') {
    console.error('🚨 BLOCKING: Atividade suspeita detectada, bloqueando mudança automática');
    return false;
  }
  
  // 3. Log da mudança aprovada
  await logPaymentStatusChange({
    orderId,
    previousStatus: currentStatus,
    newStatus,
    changeReason,
    source,
    timestamp: new Date(),
    ip: metadata.ip || 'unknown',
    ...metadata
  });
  
  return true;
}