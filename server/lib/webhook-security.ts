import { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import crypto from 'crypto';

/**
 * 🛡️ WEBHOOK SECURITY MIDDLEWARE - PROTEÇÃO UNIFICADA
 * 
 * Sistema de segurança para TODOS os webhooks de pagamento
 * Garante: HMAC, Idempotência, Transações, Fee Snapshot, Ownership
 */

// 🔐 Interface para dados de webhook validado
export interface ValidatedWebhookData {
  orderId?: string;
  subscriptionId?: string;
  tenantId: string;
  event: string;
  data: any;
  idempotencyKey: string;
}

// 🔐 Cache de idempotência em memória (previne processamento duplicado)
const processedWebhooks = new Map<string, { timestamp: number; response: any }>();

// 🧹 Limpeza automática de cache (manter últimas 24h)
setInterval(() => {
  const now = Date.now();
  const expiration = 24 * 60 * 60 * 1000; // 24 horas
  
  for (const [key, value] of processedWebhooks.entries()) {
    if (now - value.timestamp > expiration) {
      processedWebhooks.delete(key);
    }
  }
}, 60 * 60 * 1000); // Limpar a cada hora

/**
 * 🔐 Validar HMAC do webhook
 */
export function validateWebhookHMAC(
  providedHmac: string,
  secret: string,
  payload: any
): boolean {
  if (!providedHmac || !secret) {
    return false;
  }
  
  // Criar HMAC do payload
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expectedHmac = hmac.digest('hex');
  
  // Comparação constant-time para prevenir timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(providedHmac),
    Buffer.from(expectedHmac)
  );
}

/**
 * 🔐 Verificar idempotência - previne processamento duplicado
 */
export async function checkIdempotency(
  idempotencyKey: string
): Promise<{ isDuplicate: boolean; previousResponse?: any }> {
  // Verificar cache em memória
  const cached = processedWebhooks.get(idempotencyKey);
  if (cached) {
    console.log(`⚠️ IDEMPOTÊNCIA: Webhook duplicado detectado - ${idempotencyKey}`);
    return { isDuplicate: true, previousResponse: cached.response };
  }
  
  // Verificar no Firestore (para webhooks que sobrevivem restart)
  const firebaseStorage = storage as any;
  if (firebaseStorage.db) {
    const webhookDoc = await firebaseStorage.db
      .collection('webhook_processed')
      .doc(idempotencyKey)
      .get();
    
    if (webhookDoc.exists) {
      const data = webhookDoc.data();
      console.log(`⚠️ IDEMPOTÊNCIA: Webhook duplicado encontrado no Firestore - ${idempotencyKey}`);
      return { isDuplicate: true, previousResponse: data.response };
    }
  }
  
  return { isDuplicate: false };
}

/**
 * 🔐 Marcar webhook como processado (idempotência)
 */
export async function markWebhookProcessed(
  idempotencyKey: string,
  response: any
): Promise<void> {
  // Salvar em cache
  processedWebhooks.set(idempotencyKey, {
    timestamp: Date.now(),
    response
  });
  
  // Salvar no Firestore (persistência)
  const firebaseStorage = storage as any;
  if (firebaseStorage.db) {
    await firebaseStorage.db
      .collection('webhook_processed')
      .doc(idempotencyKey)
      .set({
        response,
        processedAt: new Date(),
        ttl: Date.now() + (24 * 60 * 60 * 1000) // 24h
      });
  }
}

/**
 * 🔐 Verificar ownership de ordem (previne cross-tenant attacks)
 */
export async function verifyOrderOwnership(
  orderId: string,
  expectedTenantId: string
): Promise<{ valid: boolean; order?: any; error?: string }> {
  const firebaseStorage = storage as any;
  if (!firebaseStorage.db) {
    return { valid: false, error: 'Firebase não conectado' };
  }
  
  // 🐘 Neon-first: busca order no Neon antes de ir ao Firebase
  try {
    const { neonReadOrder } = await import('./neon-reads.js');
    const neonOrder = await neonReadOrder(orderId);
    if (neonOrder) {
      const actualOwner = neonOrder.tenantId;
      if (actualOwner && actualOwner !== expectedTenantId) {
        console.error('🚨 CROSS-TENANT ATTACK DETECTADO (Neon)', { orderId, expectedTenantId, actualOwner });
        return { valid: false, error: 'Cross-tenant attack detectado' };
      }
      if (actualOwner) return { valid: true, order: neonOrder };
    }
  } catch {}

  // Firebase fallback
  const orderDoc = await firebaseStorage.db.collection('orders').doc(orderId).get();
  
  if (!orderDoc.exists) {
    return { valid: false, error: 'Ordem não encontrada' };
  }
  
  const orderData = orderDoc.data();
  
  const actualOwner = orderData.tenantId || orderData.ownerId;
  if (actualOwner !== expectedTenantId) {
    console.error('🚨 CROSS-TENANT ATTACK DETECTADO', {
      orderId,
      expectedTenantId,
      actualOwner
    });
    return { valid: false, error: 'Cross-tenant attack detectado' };
  }
  
  return { valid: true, order: orderData };
}

/**
 * 🔐 Verificar ownership de assinatura
 */
export async function verifySubscriptionOwnership(
  subscriptionId: string,
  expectedTenantId: string
): Promise<{ valid: boolean; subscription?: any; error?: string }> {
  const firebaseStorage = storage as any;
  if (!firebaseStorage.db) {
    return { valid: false, error: 'Firebase não conectado' };
  }
  
  const subDoc = await firebaseStorage.db
    .collection('subscriptions')
    .doc(subscriptionId)
    .get();
  
  if (!subDoc.exists) {
    return { valid: false, error: 'Assinatura não encontrada' };
  }
  
  const subData = subDoc.data();
  
  const actualSubOwner = subData.tenantId || subData.ownerId;
  if (actualSubOwner !== expectedTenantId) {
    console.error('🚨 CROSS-TENANT ATTACK DETECTADO (Subscription)', {
      subscriptionId,
      expectedTenantId,
      actualOwner: actualSubOwner
    });
    return { valid: false, error: 'Cross-tenant attack detectado' };
  }
  
  return { valid: true, subscription: subData };
}

/**
 * 🛡️ MIDDLEWARE PRINCIPAL - Validação completa de webhook
 */
export async function validateWebhookSecurity(
  req: Request,
  hmacSecret: string,
  requiredFields: string[]
): Promise<{
  valid: boolean;
  error?: string;
  data?: ValidatedWebhookData;
}> {
  try {
    const { event, data } = req.body;
    
    // 1. Validar estrutura básica
    if (!event || !data) {
      return { valid: false, error: 'Payload inválido - event e data são obrigatórios' };
    }
    
    // 2. Validar campos obrigatórios
    for (const field of requiredFields) {
      if (!data[field]) {
        return { valid: false, error: `Campo obrigatório ausente: ${field}` };
      }
    }
    
    // 3. Validar HMAC (se secret fornecido)
    if (hmacSecret) {
      const providedHmac = req.headers['x-webhook-signature'] as string;
      
      if (!providedHmac) {
        return { valid: false, error: 'HMAC ausente - webhook não autorizado' };
      }
      
      const isValidHmac = validateWebhookHMAC(providedHmac, hmacSecret, req.body);
      
      if (!isValidHmac) {
        console.error('🚨 HMAC INVÁLIDO - Possível webhook forjado', {
          event,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        });
        return { valid: false, error: 'HMAC inválido - webhook rejeitado' };
      }
    }
    
    // 4. Gerar chave de idempotência DETERMINÍSTICA (hash de valores estáveis)
    // CRITICAL: Usar provider event ID ou hash de campos estáveis
    const providerId = req.headers['x-webhook-id'] || 
                      req.headers['x-event-id'] || 
                      data.eventId || 
                      data.webhookId;
    
    // Se provider não envia ID único, criar hash determinístico do payload
    const stablePayload = JSON.stringify({
      event,
      orderId: data.orderId,
      subscriptionId: data.subscriptionId,
      tenantId: data.tenantId,
      // Adicionar outros campos críticos que identificam unicamente o evento
      barcode: data.barcode || data.boleto?.barcode,
      reason: data.reason
    });
    
    const idempotencyKey = providerId 
      ? `webhook_provider_${providerId}`
      : `webhook_hash_${crypto.createHash('sha256').update(stablePayload).digest('hex')}`;
    
    // 5. Verificar idempotência
    const { isDuplicate, previousResponse } = await checkIdempotency(idempotencyKey);
    
    if (isDuplicate) {
      return {
        valid: false,
        error: 'Webhook duplicado - já processado anteriormente',
        data: { previousResponse } as any
      };
    }
    
    return {
      valid: true,
      data: {
        orderId: data.orderId,
        subscriptionId: data.subscriptionId,
        tenantId: data.tenantId,
        event,
        data,
        idempotencyKey
      }
    };
    
  } catch (error) {
    console.error('❌ Erro na validação de webhook:', error);
    return { valid: false, error: 'Erro interno na validação' };
  }
}

/**
 * 💰 CRITICAL: Calcular valores financeiros usando APENAS Firestore
 * ✅ REFATORADO: Usa calculateDynamicFees() de server/index.ts
 * ⚠️ IMPORTANTE: amount DEVE estar em centavos (cents)
 * 
 * @param amountInCents - Valor total em centavos (ex: 10000 = R$100.00)
 * @param method - Método de pagamento
 * @param gateway - Gateway (default: 'efibank')
 * @param installments - Parcelas (default: 1)
 */
export async function calculateFinancialSnapshot(
  amountInCents: number,
  method: 'pix' | 'credit_card_br' | 'credit_card_global' | 'boleto',
  gateway: string = 'efibank',
  installments: number = 1,
  sellerId?: string
): Promise<{
  totalAmount: number;
  gatewayFee: number;
  platformFee: number;
  netAmount: number;
  releaseDate: Date;
  feeSnapshot: {
    gatewayFeePercent: number;
    gatewayFeeFixed: number;
    platformFeePercent: number;
    releaseDays: number;
  };
}> {
  const { calculateDynamicFees } = await import('../index.js');
  
  let paymentMethod = 'pix';
  if (method === 'credit_card_br' || method === 'credit_card_global') {
    paymentMethod = 'card';
  } else if (method === 'boleto') {
    paymentMethod = 'boleto';
  }
  
  const fees = await calculateDynamicFees(amountInCents, paymentMethod, installments, gateway, sellerId);
  
  const releaseDate = new Date();
  releaseDate.setDate(releaseDate.getDate() + fees.releaseDays);
  
  return {
    totalAmount: amountInCents,
    gatewayFee: fees.gatewayFee,
    platformFee: fees.platformFee,
    netAmount: fees.netAmount,
    releaseDate,
    feeSnapshot: {
      gatewayFeePercent: fees.gatewayFeePercent,
      gatewayFeeFixed: fees.gatewayFee - Math.round(amountInCents * (fees.gatewayFeePercent / 100)),
      platformFeePercent: fees.platformFeePercent,
      releaseDays: fees.releaseDays
    }
  };
}
