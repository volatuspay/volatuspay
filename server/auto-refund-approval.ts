// 🤖 SISTEMA DE APROVAÇÃO AUTOMÁTICA DE REEMBOLSOS - 7 DIAS
// Executado automaticamente para cumprir a lei brasileira
// 🐘 MIGRADO PARA NEON - Sem Firebase/Firestore

import * as admin from 'firebase-admin';
import { neonQuery } from './lib/neon-db.js';

// 🛡️ FUNÇÃO DE AUTO-BLOQUEIO DE SELLERS (verifica taxa de reembolso)
async function checkSellerAutoBlock(sellerId: string): Promise<{
  refundPercentage: number;
  shouldBlock: boolean;
  reason: string;
}> {
  try {
    const realtimeDb = admin.database();

    // CARREGAR REGRAS DE BLOQUEIO (RTDB - configuração de admin)
    const rulesRef = realtimeDb.ref('system/blockingRules');
    const rulesSnapshot = await rulesRef.once('value');
    const rules = rulesSnapshot.val() || {
      autoBlockEnabled: false,
      lowRiskThreshold: 25,
      mediumRiskThreshold: 50,
      highRiskThreshold: 75,
      urgentRiskThreshold: 90
    };

    // SE BLOQUEIO AUTOMÁTICO DESATIVADO, RETORNA SEM BLOQUEAR
    if (!rules.autoBlockEnabled) {
      return { refundPercentage: 0, shouldBlock: false, reason: 'Bloqueio automático desativado' };
    }

    let totalOrders = 0;
    let totalRefunds = 0;

    await neonQuery(async (sql) => {
      const ordersRows = await sql`SELECT COUNT(*) AS cnt FROM orders WHERE tenant_id = ${sellerId} AND status IN ('paid','approved')`;
      totalOrders = Number(ordersRows[0]?.cnt || 0);

      const refundsRows = await sql`SELECT COUNT(*) AS cnt FROM refunds WHERE tenant_id = ${sellerId} AND status = 'approved'`;
      totalRefunds = Number(refundsRows[0]?.cnt || 0);
    }, `autoRefund:checkBlock:${sellerId}`);

    if (totalOrders === 0) {
      return { refundPercentage: 0, shouldBlock: false, reason: 'Sem pedidos aprovados' };
    }

    const refundPercentage = (totalRefunds / totalOrders) * 100;

    let thresholdExceeded = false;
    let riskCategory = '';

    if (refundPercentage >= rules.urgentRiskThreshold) {
      thresholdExceeded = true; riskCategory = 'URGENTE';
    } else if (refundPercentage >= rules.highRiskThreshold) {
      thresholdExceeded = true; riskCategory = 'ALTO';
    } else if (refundPercentage >= rules.mediumRiskThreshold) {
      thresholdExceeded = true; riskCategory = 'MÉDIO';
    }

    if (!thresholdExceeded) {
      return { refundPercentage, shouldBlock: false, reason: 'Abaixo dos limites configurados' };
    }

    // BLOQUEAR TODOS OS CHECKOUTS DO SELLER via Neon
    await neonQuery(async (sql) => {
      await sql`UPDATE checkouts SET active = false, updated_at = NOW() WHERE tenant_id = ${sellerId} AND active = true`;
    }, `autoRefund:blockCheckouts:${sellerId}`);
    console.log(`🚫 [AUTO-BLOCK] Checkouts bloqueados para seller ${sellerId}`);

    return {
      refundPercentage,
      shouldBlock: true,
      reason: `Limite de ${riskCategory} ultrapassado (${refundPercentage.toFixed(2)}%)`
    };

  } catch (error: any) {
    console.error('❌ Erro ao verificar auto-bloqueio:', error);
    return { refundPercentage: 0, shouldBlock: false, reason: `Erro: ${error.message}` };
  }
}

export async function checkAndApproveExpiredRefunds() {
  try {
    console.log('🤖 Verificando reembolsos expirados (7 dias)...');

    // 🇧🇷 USAR TIMEZONE DE SÃO PAULO PARA CÁLCULOS BRASILEIROS
    const nowSaoPaulo = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
    const sevenDaysAgo = new Date(nowSaoPaulo);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    console.log('🕐 Data/Hora atual (São Paulo):', new Date(nowSaoPaulo).toLocaleString('pt-BR'));
    console.log('📅 Limite para aprovação automática:', sevenDaysAgo.toLocaleString('pt-BR'));

    // Buscar reembolsos pendentes expirados do Neon
    let pendingRefunds: any[] = [];
    await neonQuery(async (sql) => {
      pendingRefunds = (await sql`SELECT id, tenant_id, seller_id, order_id, amount, refund_amount, customer_id, customer_email, customer_name, product_title, payment_method, gateway, created_at FROM refunds WHERE status = 'pending' AND created_at < ${sevenDaysAgo}`) as any[];
    }, `autoRefund:fetchPending`);

    if (pendingRefunds.length === 0) {
      console.log('✅ Nenhum reembolso expirado encontrado');
      return;
    }

    console.log(`🔄 Encontrados ${pendingRefunds.length} reembolsos para aprovação automática`);

    const nowSPTimestamp = new Date(nowSaoPaulo);
    const debitPromises: Promise<void>[] = [];
    let approvedCount = 0;

    for (const refund of pendingRefunds) {
      const createdAtSP = new Date(refund.created_at.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const daysPassed = Math.floor((nowSPTimestamp.getTime() - createdAtSP.getTime()) / (1000 * 3600 * 24));

      console.log(`⚖️ Auto-aprovando reembolso: ${refund.id}`);
      console.log(`📅 Solicitado em: ${createdAtSP.toLocaleString('pt-BR')} (${daysPassed} dias atrás)`);
      console.log(`⚡ RAZÃO: Seller não respondeu em 7 dias - Lei Brasileira CDC`);

      await neonQuery(async (sql) => {
        await sql`UPDATE refunds SET status = 'approved', seller_response = ${`Aprovado automaticamente após ${daysPassed} dias - Lei Brasileira CDC Art. 49 - Seller não respondeu no prazo`}, processed_at = ${nowSPTimestamp}, updated_at = ${nowSPTimestamp}, auto_approved = true, auto_approved_at = ${nowSPTimestamp}, auto_approved_reason = 'Seller não respondeu em 7 dias (Horário de São Paulo)' WHERE id = ${refund.id}`;
      }, `autoRefund:approve:${refund.id}`);

      approvedCount++;

      debitPromises.push(
        processSellerDebitForRefund(refund.id, refund).catch(debitError => {
          console.error(`❌ Erro ao debitar seller para reembolso ${refund.id}:`, debitError);
        })
      );
    }

    console.log(`✅ ${approvedCount} reembolsos aprovados automaticamente!`);

    if (debitPromises.length > 0) {
      console.log(`💰 Processando ${debitPromises.length} débitos de sellers em paralelo...`);
      await Promise.all(debitPromises);
      console.log(`✅ Todos os débitos processados!`);
    }

    // Verificar auto-bloqueio para sellers afetados
    const affectedSellers = new Set<string>(pendingRefunds.map((r) => r.tenant_id || r.seller_id).filter(Boolean));
    console.log(`🛡️ Verificando auto-bloqueio para ${affectedSellers.size} sellers afetados...`);
    for (const sellerId of Array.from(affectedSellers)) {
      try {
        const autoBlockResult = await checkSellerAutoBlock(sellerId);
        if (autoBlockResult.shouldBlock) {
          console.log(`🚫 [AUTO-BLOCK] Seller ${sellerId} BLOQUEADO automaticamente!`);
          console.log(`   Motivo: ${autoBlockResult.reason}`);
        }
      } catch (autoBlockError) {
        console.warn(`⚠️ Erro ao verificar auto-bloqueio para seller ${sellerId}:`, autoBlockError);
      }
    }

  } catch (error) {
    console.error('❌ Erro na aprovação automática:', error);
  }
}

// 💰 FUNÇÃO PARA PROCESSAR DÉBITO DO SELLER EM REEMBOLSO AUTOMÁTICO
async function processSellerDebitForRefund(refundId: string, refundData: any): Promise<void> {
  try {
    console.log(`💰 Iniciando débito do seller para reembolso ${refundId}`);
    const effectiveTenantId = refundData.tenant_id || refundData.tenantId || refundData.seller_id || refundData.sellerId;

    if (!effectiveTenantId) {
      throw new Error(`Reembolso ${refundId} sem tenantId/sellerId - impossível debitar`);
    }

    const refundAmountCents = refundData.refund_amount || refundData.refundAmount || refundData.amount || 0;
    let resolvedPaymentMethod = refundData.payment_method || refundData.paymentMethod;
    let resolvedGateway = refundData.gateway;

    // Buscar paymentMethod da order se necessário
    if (!resolvedPaymentMethod && refundData.order_id) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT payment_method, acquirer FROM orders WHERE id = ${refundData.order_id} LIMIT 1`;
        if (rows[0]) {
          resolvedPaymentMethod = rows[0].payment_method;
          resolvedGateway = rows[0].acquirer;
        }
      }, `autoRefund:getOrderMethod:${refundData.order_id}`);
    }

    const originalMethod = (resolvedPaymentMethod === 'card' || resolvedPaymentMethod === 'credit_card') ? 'card' : 'pix';

    console.log(`💳 Reembolso de R$ ${(refundAmountCents / 100).toFixed(2)} - Método original: ${originalMethod}`);

    // Buscar prazos de liberação (config via Neon)
    let withdrawalDays = { pix: 1, cardBR: 20, cardGlobal: 7 };
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT config_data FROM payment_config WHERE config_key = 'acquirers-config' LIMIT 1`;
      if (rows[0]) {
        const config = typeof rows[0].config_data === 'string' ? JSON.parse(rows[0].config_data) : rows[0].config_data;
        withdrawalDays = {
          pix: config?.efibank?.withdrawalDays || 1,
          cardBR: config?.efibank?.withdrawalDays || 20,
          cardGlobal: config?.stripe?.withdrawalDays || 7
        };
      }
    }, `autoRefund:getWithdrawalDays`);

    // Calcular saldos disponíveis por tipo
    let availableBalances = { pix: 0, cardBR: 0, cardGlobal: 0 };
    const now = new Date();

    await neonQuery(async (sql) => {
      const orders = (await sql`SELECT payment_method, acquirer, net_amount, paid_at, created_at FROM orders WHERE tenant_id = ${effectiveTenantId} AND status = 'paid'`) as any[];
      orders.forEach((order: any) => {
        const orderType = order.payment_method === 'pix' ? 'pix' :
          order.acquirer === 'stripe' ? 'cardGlobal' : 'cardBR';
        const paidDate = order.paid_at ? new Date(order.paid_at) : new Date(order.created_at);
        const delayDays = withdrawalDays[orderType as keyof typeof withdrawalDays] || 0;
        const releaseDate = new Date(paidDate);
        releaseDate.setDate(releaseDate.getDate() + delayDays);
        if (now >= releaseDate) {
          (availableBalances as Record<string, number>)[orderType] += (order.net_amount || 0);
        }
      });

      const withdrawals = (await sql`SELECT amount, fee, type FROM withdrawals WHERE tenant_id = ${effectiveTenantId} AND status IN ('pending','processing')`) as any[];
      withdrawals.forEach((w: any) => {
        const wType = w.type === 'pix' ? 'pix' : w.type === 'cardGlobal' ? 'cardGlobal' : 'cardBR';
        (availableBalances as Record<string, number>)[wType] -= (w.amount || 0) + (w.fee || 0);
      });
    }, `autoRefund:calcBalances:${effectiveTenantId}`);

    // Determinar fonte do débito
    let primaryBalanceType: string;
    if (originalMethod === 'pix') {
      primaryBalanceType = 'pix';
    } else if (resolvedGateway === 'stripe' || resolvedGateway === 'adyen') {
      primaryBalanceType = 'cardGlobal';
    } else {
      primaryBalanceType = 'cardBR';
    }

    const balancesRecord = availableBalances as Record<string, number>;
    let debitSource = primaryBalanceType;
    let debitMethod = originalMethod;

    if (balancesRecord[primaryBalanceType] < refundAmountCents) {
      const allMethods = ['pix', 'cardBR', 'cardGlobal'];
      for (const method of allMethods) {
        if (method !== primaryBalanceType && balancesRecord[method] >= refundAmountCents) {
          debitSource = method;
          debitMethod = method === 'pix' ? 'pix' : 'card';
          break;
        }
      }
    }

    console.log(`💰 DÉBITO CONFIRMADO: R$ ${(refundAmountCents / 100).toFixed(2)} do saldo ${debitSource} (método: ${debitMethod})`);

    // Buscar dados do seller
    let sellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, name, business_name, withdrawal_balance FROM sellers WHERE id = ${effectiveTenantId} LIMIT 1`;
      if (rows[0]) sellerData = rows[0];
    }, `autoRefund:getSeller:${effectiveTenantId}`);

    if (!sellerData) {
      throw new Error(`Seller não encontrado: ${effectiveTenantId}`);
    }

    const currentSellerBalance = sellerData.withdrawal_balance || 0;
    const newSellerBalance = currentSellerBalance - refundAmountCents;
    const refundBalanceId = `refund_${refundId}`;

    // Idempotência: verificar se já processado
    let alreadyProcessed = false;
    await neonQuery(async (sql) => {
      const rows = (await sql`SELECT id FROM refund_balances WHERE id = ${refundBalanceId} LIMIT 1`) as any[];
      alreadyProcessed = rows.length > 0;
    }, `autoRefund:checkIdempotency:${refundBalanceId}`);

    if (alreadyProcessed) {
      console.log(`⚠️ Débito já processado para reembolso ${refundId} - pulando`);
      return;
    }

    // Buscar product_title e customer_name da order se necessário
    let productTitle = refundData.product_title || refundData.productTitle || '';
    let customerName = refundData.customer_name || refundData.customerName || '';
    if ((!productTitle || !customerName) && refundData.order_id) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT product_title, customer_name FROM orders WHERE id = ${refundData.order_id} LIMIT 1`;
        if (rows[0]) {
          if (!productTitle) productTitle = rows[0].product_title || 'Produto';
          if (!customerName) customerName = rows[0].customer_name || '';
        }
      }, `autoRefund:getOrderDetails:${refundData.order_id}`);
    }

    // Atualizar saldo do seller e criar registros de débito/saldo de reembolso
    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET withdrawal_balance = ${newSellerBalance}, negative_balance = ${newSellerBalance < 0}, negative_balance_amount = ${newSellerBalance < 0 ? Math.abs(newSellerBalance) : 0}, updated_at = NOW() WHERE id = ${effectiveTenantId}`;

      const debitRecordId = `refund_debit_${refundId}_${Date.now()}`;
      await sql`INSERT INTO audit_logs (id, type, tenant_id, refund_id, amount, method, source, auto_approved, previous_balance, new_balance, created_at) VALUES (${debitRecordId}, 'refund_debit', ${effectiveTenantId}, ${refundId}, ${refundAmountCents}, ${debitMethod}, ${debitSource}, true, ${currentSellerBalance}, ${newSellerBalance}, NOW()) ON CONFLICT (id) DO NOTHING`;

      await sql`INSERT INTO refund_balances (id, customer_id, customer_email, customer_name, refund_id, amount, product_title, seller_name, seller_id, status, approved_at, created_at, updated_at) VALUES (${refundBalanceId}, ${refundData.customer_id || refundData.customerId || null}, ${refundData.customer_email || refundData.customerEmail || ''}, ${customerName}, ${refundId}, ${refundAmountCents}, ${productTitle || 'Produto'}, ${sellerData.business_name || sellerData.name || 'Seller'}, ${effectiveTenantId}, 'available', NOW(), NOW(), NOW()) ON CONFLICT (id) DO NOTHING`;
    }, `autoRefund:processDebit:${refundId}`);

    if (newSellerBalance < 0) {
      console.warn(`⚠️ [AUTO-REFUND] Seller ${effectiveTenantId} ficou com saldo NEGATIVO: R$ ${(newSellerBalance / 100).toFixed(2)}`);
    }

    console.log(`✅ Débito automático concluído para reembolso ${refundId}`);
    console.log(`💰 Cliente ${refundData.customer_email || refundData.customerEmail} recebeu R$ ${(refundAmountCents / 100).toFixed(2)} de saldo`);

  } catch (error) {
    console.error(`❌ Erro ao processar débito do seller para reembolso ${refundId}:`, error);
    throw error;
  }
}

// Executar verificação a cada 30 minutos
export function startAutoRefundChecker() {
  console.log('🚀 Iniciando verificador automático de reembolsos...');

  checkAndApproveExpiredRefunds();

  setInterval(() => {
    checkAndApproveExpiredRefunds();
  }, 1800000);

  console.log('✅ Verificador automático ativo! Checando a cada 30 minutos.');
}
