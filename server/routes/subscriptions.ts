import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { verifyFirebaseToken } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import admin from 'firebase-admin';
import { fetchCheckoutsAndProducts, normalizeOrderForResponse } from '../helpers/order-helpers.js';
import { dispatchSubscriptionCancelledEvent } from '../lib/webhook-dispatcher';

const router = Router();

// 📊 GET /api/subscriptions/stats - Estatísticas de assinaturas
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
router.get('/stats', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Usar tenantId do usuário autenticado (sem query param para segurança)
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const tenantId = user.uid;
    const subscriptions = await storage.getSubscriptionsByTenant(tenantId);
    
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    
    // Calcular início e fim do próximo mês
    const nextMonth = new Date(now);
    nextMonth.setMonth(now.getMonth() + 1);
    const nextMonthStart = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    const nextMonthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0, 23, 59, 59);

    const stats = {
      active: 0,
      expiring: 0,
      expired: 0,
      cancelled: 0,
      revenueGross: 0,
      revenueNet: 0,
      fees: 0,
      nextMonthForecast: 0,
      expectedRenewals: 0,
    };

    subscriptions.forEach(sub => {
      // Contar por status
      if (sub.status === 'active') {
        stats.active++;
        stats.revenueGross += sub.amount || 0;
      } else if (sub.status === 'cancelled') {
        stats.cancelled++;
      } else if (sub.status === 'expired') {
        stats.expired++;
      }

      // Verificar se vence em 3 dias
      if (sub.status === 'active' && sub.nextBillingDate) {
        let nextBilling: Date;
        const nbDate: any = sub.nextBillingDate;
        
        if (nbDate._seconds) {
          nextBilling = new Date(nbDate._seconds * 1000);
        } else if (nbDate.seconds) {
          nextBilling = new Date(nbDate.seconds * 1000);
        } else if (nbDate instanceof Date) {
          nextBilling = nbDate;
        } else if (nbDate.toDate) {
          nextBilling = nbDate.toDate();
        } else {
          nextBilling = new Date(nbDate);
        }

        if (nextBilling <= threeDaysFromNow && nextBilling > now) {
          stats.expiring++;
        }
        
        // 🔮 PREVISIBILIDADE: Calcular receita prevista próximo mês
        if (nextBilling >= nextMonthStart && nextBilling <= nextMonthEnd && sub.autoRenew !== false) {
          stats.nextMonthForecast += sub.amount || 0;
          stats.expectedRenewals++;
        }
      }
    });

    // Calcular taxas (exemplo: 5% de taxa + R$0.40)
    const feePercentage = 0.05;
    const feeFixed = 40; // centavos por transação
    stats.fees = Math.round(stats.revenueGross * feePercentage) + (stats.active * feeFixed);
    stats.revenueNet = stats.revenueGross - stats.fees;
    
    // 💰 CALCULAR MRR (Monthly Recurring Revenue) - Soma de todas assinaturas ativas
    const mrr = stats.revenueGross;

    res.json({
      ...stats,
      mrr, // 💰 MRR = Receita bruta de todas assinaturas ativas
      activeCount: stats.active, // 📊 Número de assinaturas ativas
      totalActive: stats.active, // 📊 Campo usado pelo dashboard
      totalGrossRevenue: stats.revenueGross,
      totalFees: stats.fees
    });
  } catch (error) {
    console.error('❌ Erro ao buscar stats de subscriptions:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// 📋 GET /api/subscriptions - Listar assinaturas com paginação, filtros e métricas
// 🔒 CRITICAL SECURITY: Autenticação obrigatória + ownership verification
// 🚀 SCALABILITY: Paginação cursor-based para suportar 120k+ usuários
router.get('/', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Usar tenantId do usuário autenticado (sem query param para segurança)
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const tenantId = user.uid;
    const { status, limit: queryLimit, cursor } = req.query;

    // 🚀 PAGINAÇÃO: Limitar resultados (default 50, max 9999 para aggregations)
    const limit = Math.min(parseInt(queryLimit as string) || 100, 9999);
    
    console.log(`📋 Buscando subscriptions para tenant: ${tenantId} (status: ${status || 'all'}, limit: ${limit})`);
    
    // 🔍 BUSCAR TODAS AS SUBSCRIPTIONS PARA CALCULAR STATS
    const allSubscriptions = await storage.getSubscriptionsByTenant(tenantId);
    
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    
    // Calcular início e fim do próximo mês
    const nextMonth = new Date(now);
    nextMonth.setMonth(now.getMonth() + 1);
    const nextMonthStart = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    const nextMonthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0, 23, 59, 59);

    // 📊 CALCULAR STATS COMPLETAS
    const stats = {
      active: 0,
      expiring: 0,
      expired: 0,
      cancelled: 0,
      revenueGross: 0,
      revenueNet: 0,
      fees: 0,
      nextMonthForecast: 0,
      expectedRenewals: 0,
    };

    allSubscriptions.forEach(sub => {
      // Contar por status
      if (sub.status === 'active') {
        stats.active++;
        stats.revenueGross += sub.amount || 0;
      } else if (sub.status === 'cancelled') {
        stats.cancelled++;
      } else if (sub.status === 'expired') {
        stats.expired++;
      }

      // Verificar se vence em 3 dias
      if (sub.status === 'active' && sub.nextBillingDate) {
        let nextBilling: Date;
        const nbDate: any = sub.nextBillingDate;
        
        if (nbDate._seconds) {
          nextBilling = new Date(nbDate._seconds * 1000);
        } else if (nbDate.seconds) {
          nextBilling = new Date(nbDate.seconds * 1000);
        } else if (nbDate instanceof Date) {
          nextBilling = nbDate;
        } else if (nbDate.toDate) {
          nextBilling = nbDate.toDate();
        } else {
          nextBilling = new Date(nbDate);
        }

        if (nextBilling <= threeDaysFromNow && nextBilling > now) {
          stats.expiring++;
        }
        
        // 🔮 PREVISIBILIDADE: Calcular receita prevista próximo mês
        if (nextBilling >= nextMonthStart && nextBilling <= nextMonthEnd && sub.autoRenew !== false) {
          stats.nextMonthForecast += sub.amount || 0;
          stats.expectedRenewals++;
        }
      }
    });

    // Calcular taxas (5% + R$0.40)
    const feePercentage = 0.05;
    const feeFixed = 40; // centavos por transação
    stats.fees = Math.round(stats.revenueGross * feePercentage) + (stats.active * feeFixed);
    stats.revenueNet = stats.revenueGross - stats.fees;
    
    // 🔍 FILTRAR SUBSCRIPTIONS POR STATUS
    let filteredSubscriptions = [...allSubscriptions];
    
    // Se status não for passado, retornar todas (modo 'all')
    if (!status || status === 'all') {
      // Não filtrar, retornar todas
    } else if (status === 'expiring') {
      filteredSubscriptions = allSubscriptions.filter(sub => {
        if (sub.status !== 'active' || !sub.nextBillingDate) return false;
        
        let nextBilling: Date;
        const nbDate: any = sub.nextBillingDate;
        
        if (nbDate._seconds) {
          nextBilling = new Date(nbDate._seconds * 1000);
        } else if (nbDate.seconds) {
          nextBilling = new Date(nbDate.seconds * 1000);
        } else if (nbDate instanceof Date) {
          nextBilling = nbDate;
        } else if (nbDate.toDate) {
          nextBilling = nbDate.toDate();
        } else {
          nextBilling = new Date(nbDate);
        }
        
        return nextBilling <= threeDaysFromNow && nextBilling > now;
      });
    } else {
      // Filtrar por status específico (active, expired, cancelled)
      filteredSubscriptions = allSubscriptions.filter(sub => sub.status === status);
    }
    
    console.log(`📋 ✅ ${filteredSubscriptions.length} subscriptions encontradas (status: ${status || 'all'})`);

    // ⚡ BATCH FETCH: Usar helper compartilhado (4-tier fallback garantido)
    const firebaseStorage = storage as any;
    
    // Criar snapshot fake compatível com fetchCheckoutsAndProducts
    const fakeSnapshot = {
      docs: filteredSubscriptions.map(sub => ({
        data: () => sub,
        id: sub.id
      }))
    };
    
    const { checkoutsMap, productsMap } = await fetchCheckoutsAndProducts(fakeSnapshot, firebaseStorage);
    
    // 📅 NORMALIZAR DATAS E ADICIONAR DADOS DE PRODUTO: Converter Firestore timestamps + adicionar productName
    const normalizedSubscriptions = filteredSubscriptions.map(sub => {
      const checkoutData = checkoutsMap.get(sub.checkoutId);
      const productId = checkoutData?.productId || sub.productId || sub.checkoutId;
      const productData = productId ? productsMap.get(productId) : null;
      
      const normalized: any = { ...sub };
      
      // 🎯 ADICIONAR DADOS DE PRODUTO (mesma lógica de orders)
      normalized.productId = productId;
      normalized.productName = productData?.name || productData?.title || checkoutData?.productName || sub.productName || 'Assinatura';
      normalized.offerId = checkoutData?.id || sub.checkoutId;
      normalized.offerName = checkoutData?.title || 'Oferta Padrão';
      
      // Converter nextBillingDate
      if (normalized.nextBillingDate) {
        const nbDate = normalized.nextBillingDate;
        if (nbDate._seconds) {
          normalized.nextBillingDate = new Date(nbDate._seconds * 1000).toISOString();
        } else if (nbDate.seconds) {
          normalized.nextBillingDate = new Date(nbDate.seconds * 1000).toISOString();
        } else if (nbDate.toDate) {
          normalized.nextBillingDate = nbDate.toDate().toISOString();
        } else if (nbDate instanceof Date) {
          normalized.nextBillingDate = nbDate.toISOString();
        }
      }
      
      // Converter createdAt
      if (normalized.createdAt) {
        const cDate = normalized.createdAt;
        if (cDate._seconds) {
          normalized.createdAt = new Date(cDate._seconds * 1000).toISOString();
        } else if (cDate.seconds) {
          normalized.createdAt = new Date(cDate.seconds * 1000).toISOString();
        } else if (cDate.toDate) {
          normalized.createdAt = cDate.toDate().toISOString();
        } else if (cDate instanceof Date) {
          normalized.createdAt = cDate.toISOString();
        }
      }
      
      return normalized;
    });
    
    // Ordenar por próxima cobrança (DEPOIS da normalização)
    normalizedSubscriptions.sort((a, b) => {
      const aDate = a.nextBillingDate ? new Date(a.nextBillingDate).getTime() : 0;
      const bDate = b.nextBillingDate ? new Date(b.nextBillingDate).getTime() : 0;
      return aDate - bDate;
    });

    // 🚀 RESPONSE COM STATS E SUBSCRIPTIONS
    res.json({
      subscriptions: normalizedSubscriptions,
      stats,
      total: normalizedSubscriptions.length,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar subscriptions:', error);
    res.status(500).json({ error: 'Erro ao buscar assinaturas' });
  }
});

// 🚫 POST /api/subscriptions/:id/cancel - Cancelar assinatura
// 🔒 CRITICAL SECURITY: Autenticação obrigatória (seller pode cancelar suas próprias subscriptions)
router.post('/:id/cancel', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'ID da subscription é obrigatório' });
    }
    
    // 🔐 SECURITY: Verificar ownership da subscription
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    // Buscar subscription para verificar ownership
    const subscription = await storage.getSubscription(id);
    if (!subscription) {
      return res.status(404).json({ error: 'Assinatura não encontrada' });
    }
    
    const isAdmin = user.customClaims?.admin === true;
    const isOwnTenant = user.uid === subscription.tenantId;
    
    if (!isAdmin && !isOwnTenant) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando cancelar subscription ${id} do tenant ${subscription.tenantId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode cancelar suas próprias assinaturas' });
    }

    console.log(`🚫 Cancelando subscription: ${id}`);
    const cancelledSubscription = await storage.cancelSubscription(id);

    // 📣 Disparar webhook subscription.cancelled
    dispatchSubscriptionCancelledEvent(subscription.tenantId, {
      id: cancelledSubscription.id,
      subscriptionId: cancelledSubscription.id,
      customerId: (cancelledSubscription as any).customerId || (cancelledSubscription as any).userId || '',
      customerEmail: (cancelledSubscription as any).customerEmail || '',
      productId: (cancelledSubscription as any).productId || '',
      planName: (cancelledSubscription as any).productName || (cancelledSubscription as any).planName || '',
      amount: (cancelledSubscription as any).amount || 0,
      period: (cancelledSubscription as any).period || (cancelledSubscription as any).billingCycle || '',
      reason: 'Cancelado pelo vendedor',
      cancelledAt: new Date().toISOString(),
      accessEndDate: null,
      cancelledVia: 'dashboard',
    }).catch((e: any) => console.warn('[WEBHOOK] Erro ao disparar subscription.cancelled (seller):', e?.message));
    
    res.json({
      success: true,
      subscription: cancelledSubscription,
      message: 'Assinatura cancelada com sucesso. O cliente perdeu acesso imediatamente.'
    });
  } catch (error) {
    console.error('❌ Erro ao cancelar subscription:', error);
    res.status(500).json({ error: 'Erro ao cancelar assinatura' });
  }
});

// ⚙️ POST /api/subscriptions/save-regua — Salvar config da régua de comunicação do seller
router.post('/save-regua', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const { reguaConfig } = req.body as { reguaConfig: Record<string, boolean> };
    if (!reguaConfig || typeof reguaConfig !== 'object') {
      return res.status(400).json({ error: 'reguaConfig inválido' });
    }

    const allowed = ['dias7', 'dias3', 'dia1antes', 'vencimento', 'dia1depois', 'dia2depois', 'dia3depois'];
    const sanitized: Record<string, boolean> = {};
    for (const k of allowed) {
      if (typeof reguaConfig[k] === 'boolean') sanitized[k] = reguaConfig[k];
    }

    const db = admin.firestore();
    await db.collection('sellers').doc(user.uid).update({
      reguaConfig: sanitized,
      reguaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`⚙️ [RÉGUA] Config salva para seller ${user.uid}:`, sanitized);
    return res.json({ success: true, reguaConfig: sanitized });
  } catch (error: any) {
    console.error('❌ Erro ao salvar régua config:', error);
    return res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
});

// 📧 POST /api/subscriptions/test-email — Enviar email de teste da régua para o seller logado
router.post('/test-email', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const { trigger, email, name } = req.body as { trigger: string; email?: string; name?: string };
    const validTriggers = ['dias7', 'dias3', 'dia1antes', 'vencimento', 'dia1depois', 'dia2depois', 'dia3depois'];
    if (!trigger || !validTriggers.includes(trigger)) {
      return res.status(400).json({ error: `trigger inválido. Use: ${validTriggers.join(', ')}` });
    }

    const targetEmail = email || user.email || '';
    if (!targetEmail) return res.status(400).json({ error: 'Email não encontrado' });
    const customerName = name || user.displayName || 'Vendedor';
    const productName = 'Produto Exemplo (Teste da Régua)';
    const renewUrl = `${process.env.APP_BASE_URL || 'https://volatuspay.com'}/checkout/demo`;
    const valor = 'R$ 97,00';

    const { sendSubscriptionExpiringEmail, sendSubscriptionReactivationEmail, sendSubscriptionExpiredEmail } = await import('../lib/email-service.js');

    let result;
    if (trigger === 'dias7') {
      result = await sendSubscriptionExpiringEmail({ customerEmail: targetEmail, customerName, productName, daysLeft: 7, expiresAt: new Date(Date.now() + 7 * 86400000).toLocaleDateString('pt-BR'), valor, renewUrl });
    } else if (trigger === 'dias3') {
      result = await sendSubscriptionExpiringEmail({ customerEmail: targetEmail, customerName, productName, daysLeft: 3, expiresAt: new Date(Date.now() + 3 * 86400000).toLocaleDateString('pt-BR'), valor, renewUrl });
    } else if (trigger === 'dia1antes') {
      result = await sendSubscriptionExpiringEmail({ customerEmail: targetEmail, customerName, productName, daysLeft: 1, expiresAt: new Date(Date.now() + 86400000).toLocaleDateString('pt-BR'), valor, renewUrl });
    } else if (trigger === 'vencimento') {
      result = await sendSubscriptionExpiredEmail({ customerEmail: targetEmail, customerName, productName, renewUrl });
    } else if (trigger === 'dia1depois') {
      result = await sendSubscriptionReactivationEmail({ customerEmail: targetEmail, customerName, productName, renewUrl, daysAfter: 1, valor });
    } else if (trigger === 'dia2depois') {
      result = await sendSubscriptionReactivationEmail({ customerEmail: targetEmail, customerName, productName, renewUrl, daysAfter: 2, valor });
    } else {
      result = await sendSubscriptionReactivationEmail({ customerEmail: targetEmail, customerName, productName, renewUrl, daysAfter: 3, valor });
    }

    if (result.success) {
      console.log(`📧 [RÉGUA TEST] ${trigger} → ${targetEmail} ✅`);
      return res.json({ success: true, message: `Email de teste (${trigger}) enviado para ${targetEmail}` });
    } else {
      return res.status(500).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error('❌ Erro ao enviar email de teste:', error);
    return res.status(500).json({ error: 'Erro ao enviar email de teste' });
  }
});

// 🔄 POST /api/subscriptions/run-cron — Disparo manual do cron (admin only)
router.post('/run-cron', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    const isAdmin = user.customClaims?.admin === true;
    if (!isAdmin) return res.status(403).json({ error: 'Apenas admins podem disparar o cron manualmente' });

    console.log(`🔄 [CRON MANUAL] Disparado por admin ${user.uid}`);
    const count = await storage.processExpiredSubscriptions();
    return res.json({ success: true, message: `Cron executado. ${count} assinaturas processadas.` });
  } catch (error: any) {
    console.error('❌ Erro ao executar cron manual:', error);
    return res.status(500).json({ error: 'Erro ao executar cron' });
  }
});

export default router;
