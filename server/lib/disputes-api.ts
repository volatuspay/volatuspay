/**
 * 🔴 DISPUTES API - Consulta de MEDs/Disputas/Chargebacks
 * Unifica consulta de disputas de todos os gateways: Stripe, EfíBank, Woovi
 */

import admin from 'firebase-admin';
import { getStripeKeys, getPaymentConfig } from './payment-config.js';
import { getWooviRefunds } from './woovi-api.js';
import { listEfiBankPixWithRefunds, listEfiBankMedInfracoes, EfiBankPix, EfiBankInfracao } from './efibank-refunds-api.js';

// Tipos para disputas unificadas
export interface UnifiedDispute {
  id: string;
  gateway: 'stripe' | 'efibank' | 'woovi';
  type: 'dispute' | 'chargeback' | 'refund' | 'med';
  status: string;
  amount: number; // em centavos
  currency: string;
  reason?: string;
  orderId?: string;
  paymentIntentId?: string;
  customerEmail?: string;
  customerName?: string;
  createdAt: Date;
  updatedAt?: Date;
  dueDate?: Date; // prazo para responder
  rawData: any;
}

export interface DisputesResponse {
  disputes: UnifiedDispute[];
  hasMore: boolean;
  totalCount?: number;
  scannedAt: Date;
}

// ============================================================
// 🔵 STRIPE DISPUTES
// ============================================================

interface StripeDispute {
  id: string;
  amount: number;
  charge: string;
  payment_intent: string;
  reason: string;
  status: 'warning_needs_response' | 'warning_under_review' | 'warning_closed' | 'needs_response' | 'under_review' | 'charge_refunded' | 'won' | 'lost';
  currency: string;
  created: number;
  evidence_details?: {
    due_by: number;
  };
  metadata?: Record<string, string>;
}

/**
 * Consultar disputas do Stripe
 */
export async function getStripeDisputes(
  db: admin.firestore.Firestore,
  options?: {
    limit?: number;
    startingAfter?: string;
    status?: string;
  }
): Promise<UnifiedDispute[]> {
  try {
    const stripeKeys = await getStripeKeys(db);
    
    if (!stripeKeys.secretKey) {
      console.log('⚠️ Stripe não configurado - pulando consulta de disputas');
      return [];
    }

    console.log('🔵 Consultando disputas do Stripe...');

    // Construir URL com parâmetros
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.startingAfter) params.append('starting_after', options.startingAfter);
    if (options?.status) params.append('status', options.status);

    const url = `https://api.stripe.com/v1/disputes${params.toString() ? '?' + params.toString() : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${stripeKeys.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erro ao consultar disputas Stripe:', {
        status: response.status,
        error: errorText
      });
      return [];
    }

    const data = await response.json() as { data?: StripeDispute[] };
    const disputes: StripeDispute[] = data.data || [];

    console.log(`✅ Stripe: ${disputes.length} disputas encontradas`);

    // Converter para formato unificado
    return disputes.map(d => ({
      id: d.id,
      gateway: 'stripe' as const,
      type: 'dispute' as const,
      status: d.status,
      amount: d.amount,
      currency: d.currency.toUpperCase(),
      reason: d.reason,
      paymentIntentId: d.payment_intent,
      orderId: d.metadata?.orderId,
      createdAt: new Date(d.created * 1000),
      dueDate: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : undefined,
      rawData: d,
    }));
  } catch (error) {
    console.error('❌ Exceção ao consultar disputas Stripe:', error);
    return [];
  }
}

/**
 * Consultar detalhes de uma disputa específica do Stripe
 */
export async function getStripeDisputeById(
  db: admin.firestore.Firestore,
  disputeId: string
): Promise<UnifiedDispute | null> {
  try {
    const stripeKeys = await getStripeKeys(db);
    
    if (!stripeKeys.secretKey) {
      console.log('⚠️ Stripe não configurado');
      return null;
    }

    const response = await fetch(`https://api.stripe.com/v1/disputes/${disputeId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${stripeKeys.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      console.error('❌ Disputa não encontrada:', disputeId);
      return null;
    }

    const d = await response.json() as StripeDispute;

    return {
      id: d.id,
      gateway: 'stripe',
      type: 'dispute',
      status: d.status,
      amount: d.amount,
      currency: d.currency.toUpperCase(),
      reason: d.reason,
      paymentIntentId: d.payment_intent,
      orderId: d.metadata?.orderId,
      createdAt: new Date(d.created * 1000),
      dueDate: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : undefined,
      rawData: d,
    };
  } catch (error) {
    console.error('❌ Erro ao buscar disputa Stripe:', error);
    return null;
  }
}

// ============================================================
// 🟢 WOOVI (PIX) MEDs/DEVOLUÇÕES
// ============================================================

/**
 * Escanear MEDs do Woovi em pedidos recentes
 */
export async function scanWooviMeds(
  db: admin.firestore.Firestore,
  options?: {
    days?: number;
    limit?: number;
  }
): Promise<UnifiedDispute[]> {
  try {
    const config = await getPaymentConfig(db);
    
    if (!config?.woovi?.enabled) {
      console.log('⚠️ Woovi não configurado - pulando scan de MEDs');
      return [];
    }

    console.log('🟢 Escaneando MEDs do Woovi...');
    
    const days = options?.days || 30;
    const limit = options?.limit || 100;

    // Buscar pedidos PIX pagos recentes
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const ordersSnapshot = await db
      .collection('orders')
      .where('method', '==', 'pix')
      .where('status', '==', 'paid')
      .orderBy('paidAt', 'desc')
      .limit(limit)
      .get();

    const medsFound: UnifiedDispute[] = [];

    for (const doc of ordersSnapshot.docs) {
      const order = doc.data();
      
      try {
        const refundsResponse = await getWooviRefunds(doc.id);
        const refunds = refundsResponse?.refunds || [];

        for (const refund of refunds) {
          medsFound.push({
            id: `woovi_${doc.id}_${refund.correlationID}`,
            gateway: 'woovi',
            type: refund.type === 'MED' ? 'med' : 'refund',
            status: refund.status,
            amount: refund.value,
            currency: 'BRL',
            reason: refund.comment,
            orderId: doc.id,
            customerEmail: order.customer?.email,
            customerName: order.customer?.name,
            createdAt: new Date(refund.createdAt),
            updatedAt: refund.completedAt ? new Date(refund.completedAt) : undefined,
            rawData: { order, refund },
          });
        }

        // Pequeno delay para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Erro ao verificar MED para ${doc.id}:`, error);
      }
    }

    console.log(`✅ Woovi: ${medsFound.length} MEDs/devoluções encontrados`);
    return medsFound;
  } catch (error) {
    console.error('❌ Exceção ao escanear MEDs Woovi:', error);
    return [];
  }
}

// ============================================================
// 🟡 EFIBANK (GERENCIANET) DEVOLUÇÕES
// ============================================================

/**
 * Consultar devoluções do EfíBank via API real PIX
 * Usa o endpoint /v2/pix para listar PIX recebidos com devoluções
 */
export async function getEfiBankRefunds(
  db: admin.firestore.Firestore,
  options?: {
    days?: number;
    limit?: number;
  }
): Promise<UnifiedDispute[]> {
  try {
    const config = await getPaymentConfig(db);
    
    if (!config?.efibank?.enabled) {
      console.log('⚠️ EfíBank não configurado - pulando consulta de devoluções');
      return [];
    }

    console.log('🟡 Consultando devoluções do EfíBank via API PIX...');
    
    const days = options?.days || 30;
    const limit = options?.limit || 100;

    const refundsFound: UnifiedDispute[] = [];

    // 1. CONSULTA INFRAÇÕES MED (endpoint /v2/gn/infracoes) - PRIORITÁRIO
    try {
      console.log('🔍 Consultando infrações MED via /v2/gn/infracoes...');
      const infracoesResult = await listEfiBankMedInfracoes(db, { days, limit });
      
      if (infracoesResult.success && infracoesResult.infracoes.length > 0) {
        console.log(`⚠️ API EfiBank Infrações: ${infracoesResult.infracoes.length} MEDs encontrados!`);
        
        for (const infracao of infracoesResult.infracoes) {
          // EfíBank API Infrações retorna valor em centavos - NÃO multiplicar por 100
          const valorCentavos = typeof infracao.valor === 'string' 
            ? Math.round(parseFloat(infracao.valor)) 
            : Math.round(infracao.valor);
          
          refundsFound.push({
            id: `efibank_med_${infracao.idInfracao}`,
            gateway: 'efibank',
            type: 'med',
            status: infracao.status,
            amount: valorCentavos,
            currency: 'BRL',
            reason: infracao.razao || `MED - ${infracao.tipoSituacao || 'Fraude'}`,
            orderId: infracao.endToEndId,
            customerName: infracao.origem?.nome,
            createdAt: new Date(infracao.dataTransacao),
            dueDate: infracao.dadosAnalise?.prazoFinalizacao ? new Date(infracao.dadosAnalise.prazoFinalizacao) : undefined,
            rawData: infracao,
          });
        }
      } else if (infracoesResult.error) {
        console.warn(`⚠️ API EfiBank Infrações: ${infracoesResult.error}`);
      }
    } catch (infracoesError: any) {
      console.warn(`⚠️ Falha na consulta de infrações MED: ${infracoesError.message}`);
    }

    // 2. CONSULTA API REAL: Listar PIX com devoluções da API EfiBank
    try {
      const apiResult = await listEfiBankPixWithRefunds(db, { days, limit });
      
      if (apiResult.success && apiResult.pix.length > 0) {
        console.log(`🔍 API EfiBank: ${apiResult.pix.length} PIX com devoluções encontrados`);
        
        for (const pix of apiResult.pix) {
          for (const refund of pix.devolucoes || []) {
            const isMed = refund.natureza === 'MED_FRAUDE' || refund.natureza === 'MED_OPERACIONAL';
            const existingId = `efibank_${pix.endToEndId}_${refund.rtrId}`;
            const alreadyExists = refundsFound.some(r => r.id === existingId);
            
            if (!alreadyExists) {
              // EfíBank API devoluções retorna valor em centavos - NÃO multiplicar por 100
              const valorCentavos = typeof refund.valor === 'string' 
                ? Math.round(parseFloat(refund.valor)) 
                : Math.round(refund.valor);
              
              refundsFound.push({
                id: existingId,
                gateway: 'efibank',
                type: isMed ? 'med' : 'refund',
                status: refund.status,
                amount: valorCentavos,
                currency: 'BRL',
                reason: refund.motivo || (isMed ? `MED: ${refund.natureza}` : 'Devolução PIX'),
                orderId: pix.txid,
                customerName: pix.pagador?.nome,
                createdAt: new Date(refund.horario.solicitacao),
                updatedAt: refund.horario.liquidacao ? new Date(refund.horario.liquidacao) : undefined,
                rawData: { pix, refund },
              });
            }
          }
        }
      } else if (apiResult.error) {
        console.warn(`⚠️ API EfiBank: ${apiResult.error}`);
      }
    } catch (apiError: any) {
      console.warn(`⚠️ Falha na consulta API EfiBank: ${apiError.message}`);
    }

    // 2. FALLBACK: Buscar devoluções registradas no Firestore (dados históricos)
    try {
      const ordersSnapshot = await db
        .collection('orders')
        .where('method', '==', 'pix')
        .where('gateway', '==', 'efibank')
        .where('status', 'in', ['paid', 'refunded', 'partially_refunded'])
        .orderBy('paidAt', 'desc')
        .limit(limit)
        .get();

      for (const doc of ordersSnapshot.docs) {
        const order = doc.data();
        
        // Verificar se o pedido tem campo de devolução e não está duplicado
        if (order.refundedAt || order.refundAmount) {
          const existingId = `efibank_refund_${doc.id}`;
          const alreadyExists = refundsFound.some(r => r.id === existingId || r.orderId === doc.id);
          
          if (!alreadyExists) {
            refundsFound.push({
              id: existingId,
              gateway: 'efibank',
              type: 'refund',
              status: order.status === 'refunded' ? 'completed' : 'partial',
              amount: order.refundAmount || order.amount,
              currency: 'BRL',
              reason: order.refundReason || 'Devolução solicitada',
              orderId: doc.id,
              customerEmail: order.customer?.email,
              customerName: order.customer?.name,
              createdAt: order.refundedAt?.toDate?.() || new Date(),
              rawData: order,
            });
          }
        }
      }
    } catch (firestoreError: any) {
      console.warn(`⚠️ Fallback Firestore: ${firestoreError.message}`);
    }

    console.log(`✅ EfíBank: ${refundsFound.length} devoluções/MEDs encontrados`);
    return refundsFound;
  } catch (error) {
    console.error('❌ Exceção ao consultar devoluções EfíBank:', error);
    return [];
  }
}

// ============================================================
// 🔴 CONSULTA UNIFICADA DE TODOS OS GATEWAYS
// ============================================================

/**
 * Consultar todas as disputas/MEDs/chargebacks de todos os gateways
 */
export async function getAllDisputes(
  db: admin.firestore.Firestore,
  options?: {
    days?: number;
    limit?: number;
    gateways?: ('stripe' | 'woovi' | 'efibank')[];
  }
): Promise<DisputesResponse> {
  const allDisputes: UnifiedDispute[] = [];
  const gateways = options?.gateways || ['stripe', 'woovi', 'efibank'];

  console.log('🔴 Consultando disputas de todos os gateways...');

  // Consultar gateways em paralelo
  const promises: Promise<UnifiedDispute[]>[] = [];

  if (gateways.includes('stripe')) {
    promises.push(getStripeDisputes(db, { limit: options?.limit || 50 }));
  }

  if (gateways.includes('woovi')) {
    promises.push(scanWooviMeds(db, { days: options?.days || 30, limit: options?.limit || 100 }));
  }

  if (gateways.includes('efibank')) {
    promises.push(getEfiBankRefunds(db, { days: options?.days || 30, limit: options?.limit || 100 }));
  }

  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allDisputes.push(...result.value);
    } else {
      console.error('Erro ao consultar gateway:', result.reason);
    }
  }

  // Ordenar por data de criação (mais recentes primeiro)
  allDisputes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  console.log(`✅ Total de disputas encontradas: ${allDisputes.length}`);

  return {
    disputes: allDisputes,
    hasMore: false,
    totalCount: allDisputes.length,
    scannedAt: new Date(),
  };
}

/**
 * Salvar alerta de disputa no Firestore
 */
export async function saveDisputeAlert(
  db: admin.firestore.Firestore,
  dispute: UnifiedDispute,
  scannedBy?: string
): Promise<string> {
  const alertRef = await db.collection('disputeAlerts').add({
    disputeId: dispute.id,
    gateway: dispute.gateway,
    type: dispute.type,
    status: dispute.status,
    amount: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason,
    orderId: dispute.orderId,
    customerEmail: dispute.customerEmail,
    customerName: dispute.customerName,
    createdAt: dispute.createdAt,
    dueDate: dispute.dueDate,
    alertedAt: admin.firestore.FieldValue.serverTimestamp(),
    scannedBy: scannedBy || 'system',
    notified: false,
    acknowledged: false,
  });

  console.log(`💾 Alerta de disputa salvo: ${alertRef.id}`);
  return alertRef.id;
}

/**
 * Listar alertas de disputas
 */
export async function listDisputeAlerts(
  db: admin.firestore.Firestore,
  options?: {
    limit?: number;
    acknowledged?: boolean;
  }
): Promise<any[]> {
  let query = db.collection('disputeAlerts')
    .orderBy('alertedAt', 'desc');

  if (options?.acknowledged !== undefined) {
    query = query.where('acknowledged', '==', options.acknowledged) as any;
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  } else {
    query = query.limit(50);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    alertedAt: doc.data().alertedAt?.toDate?.() || null,
    createdAt: doc.data().createdAt?.toDate?.() || null,
    dueDate: doc.data().dueDate?.toDate?.() || null,
  }));
}

/**
 * Marcar alerta como reconhecido
 */
export async function acknowledgeDisputeAlert(
  db: admin.firestore.Firestore,
  alertId: string,
  acknowledgedBy: string
): Promise<void> {
  await db.collection('disputeAlerts').doc(alertId).update({
    acknowledged: true,
    acknowledgedAt: admin.firestore.FieldValue.serverTimestamp(),
    acknowledgedBy,
  });
  console.log(`✅ Alerta ${alertId} reconhecido por ${acknowledgedBy}`);
}
