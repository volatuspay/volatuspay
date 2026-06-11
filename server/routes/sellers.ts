import { Router, type Response } from 'express';
import {
  verifyFirebaseToken,
  requireAdmin,
  requireApprovedSeller,
  AuthenticatedRequest
} from '../security/firebase-auth.js';
import { ensureFirebaseReady, getAdmin, getFirestore } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { neonQuery } from '../lib/neon-db.js';
import { storage } from '../storage.js';
import { sendSellerApprovalEmail, sendSellerRejectionEmail, sendEmail, sendNewSellerPendingEmail } from '../lib/email-service.js';
import { syncSellerFeesToRTDB } from '../lib/eternal-sync.js';
import { createSellerFolderStructure } from '../lib/bunny-helper.js';
import { sellerRegisterFormSchema } from '../../shared/schema.js';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

const sellersRouter = Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_AUTH' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  skip: (req) => {
    const ip = req.ip;
    return /^(127\.|10\.|192\.168\.|160\.20\.)/.test(ip) || ip === '::1';
  }
});

const getTenantFromAuth = async (req: any): Promise<string | null> => {
  const TENANT_DEBUG = process.env.TENANT_DEBUG === 'true';
  const requestPath = req.path || 'unknown';
  const requestMethod = req.method || 'unknown';
  
  if (!req.user?.uid) {
    return null;
  }
  
  const uid = req.user.uid;
  
  try {
    const isAdmin = req.user?.isAdmin || req.authUser?.isAdmin;
    if (isAdmin) {
      return uid;
    }
    
    let seller: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, tenant_id, email, status FROM sellers WHERE id = ${uid} LIMIT 1`;
      if (rows[0]) seller = rows[0];
    }, `getTenant:${uid}`);

    if (seller && seller.tenant_id && seller.tenant_id !== uid) {
      if (TENANT_DEBUG) console.log(`🔧 [TENANT] Corrigindo tenantId incorreto para ${uid.substring(0, 8)}...`);
      await neonQuery(async (sql) => {
        await sql`UPDATE sellers SET tenant_id = ${uid}, updated_at = NOW() WHERE id = ${uid}`;
      }, `fixTenant:${uid}`).catch((e: any) => console.error(`❌ Erro ao corrigir tenantId:`, e));
      return uid;
    }
    
    return seller?.tenant_id || uid;
  } catch (error: any) {
    console.error(`❌ Erro crítico em getTenantFromAuth:`, error.message);
    return uid;
  }
};

const sellerRegistrationSecurityMiddleware = (req: any, res: any, next: any) => {
  try {
    const { email, phone, document, personalDocumentNumber, businessName } = req.body;
    
    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.length < 10 || /bot|crawler|spider|test/i.test(userAgent)) {
      console.warn(`❌ SELLER REG BLOCKED: Suspicious user agent from ${req.ip}: ${userAgent}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: User agent suspeito detectado'
      });
    }
    
    if (!email || !phone || !document || !personalDocumentNumber || !businessName) {
      console.warn(`❌ SELLER REG BLOCKED: Missing required fields from ${req.ip}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: Todos os campos obrigatórios devem estar preenchidos'
      });
    }
    
    const fieldLimits = {
      email: 254,
      phone: 20,
      businessName: 100,
      document: 20,
      personalDocumentNumber: 20
    };
    
    for (const [field, limit] of Object.entries(fieldLimits)) {
      const value = req.body[field];
      if (value && value.length > limit) {
        console.warn(`❌ SELLER REG BLOCKED: Field ${field} too long from ${req.ip}: ${value.length} chars`);
        return res.status(400).json({
          success: false,
          message: `SECURITY: Campo ${field} excede o limite permitido`
        });
      }
    }
    
    const maliciousPatterns = [
      /<script|javascript:|on\w+\s*=/i,
      /$\(|jQuery|$\{/i,
      /exec\(|eval\(|Function\(/i,
      /\b(union|select|insert|delete|drop|create|alter)\b/i,
      /<iframe|<object|<embed/i
    ];
    
    for (const [field, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        for (const pattern of maliciousPatterns) {
          if (pattern.test(value)) {
            console.warn(`❌ SELLER REG BLOCKED: Malicious pattern in ${field} from ${req.ip}: ${value}`);
            return res.status(400).json({
              success: false,
              message: 'SECURITY: Conteúdo suspeito detectado nos dados'
            });
          }
        }
      }
    }
    
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailPattern.test(email)) {
      console.warn(`❌ SELLER REG BLOCKED: Invalid email pattern from ${req.ip}: ${email}`);
      return res.status(400).json({
        success: false,
        message: 'SECURITY: Formato de email inválido'
      });
    }
    
    console.log(`✅ SELLER REG SECURITY: Passed all validations from ${req.ip} for ${email}`);
    next();
    
  } catch (error) {
    console.error('❌ SELLER REG SECURITY ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'SECURITY: Erro na validação de segurança'
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 1: PUT /api/admin/sellers/:id - Approve/reject sellers
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.put('/api/admin/sellers/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.params.id;
    const { action, rejectionReason } = req.body;

    console.log(`👑 PUT /api/admin/sellers/${sellerId} - Admin: ${req.authUser?.email} - Ação: ${action}`);

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ 
        error: 'Ação inválida. Use "approve" ou "reject".',
        code: 'INVALID_ACTION'
      });
    }

    if (action === 'reject' && !rejectionReason?.trim()) {
      return res.status(400).json({ 
        error: 'Motivo da rejeição é obrigatório.',
        code: 'MISSING_REJECTION_REASON'
      });
    }

    let sellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, email, business_name, name FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      sellerData = rows[0];
    }, `adminSellerAction:${sellerId}`);

    if (!sellerData) {
      return res.status(404).json({ error: 'Seller não encontrado.', code: 'SELLER_NOT_FOUND' });
    }

    if (action === 'approve') {
      console.log(`✅ Aprovando seller ${sellerData?.email}`);
      await neonQuery(async (sql) => {
        await sql`UPDATE sellers SET status = 'approved', approved_at = NOW(), updated_at = NOW(), is_approved = TRUE, is_blocked = FALSE WHERE id = ${sellerId}`;
        const tenants = await sql`SELECT id FROM tenants WHERE owner_id = ${sellerId} LIMIT 1`;
        if (!tenants[0]) {
          await sql`INSERT INTO tenants (id, owner_id, created_at, updated_at) VALUES (${sellerId}, ${sellerId}, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`;
        }
      }, `approveSeller:${sellerId}`);

      console.log(`✅ Seller ${sellerId} APROVADO por admin ${req.authUser?.email}`);
      try { await storage.clearSellerCache(); } catch {}

      if (sellerData?.email) {
        sendSellerApprovalEmail(sellerData.email, sellerData.business_name || sellerData.name)
          .catch(err => console.error("❌ Erro ao enviar email de aprovação:", err));
      }

      return res.json({ success: true, message: 'Seller aprovado com sucesso!', sellerId, action: 'approved' });
    } else {
      console.log(`❌ Rejeitando seller ${sellerData?.email}`);
      const reason = rejectionReason?.trim() || 'Não especificado';
      await neonQuery(async (sql) => {
        await sql`UPDATE sellers SET status = 'rejected', rejected_at = NOW(), updated_at = NOW(), rejection_reason = ${reason}, is_approved = FALSE WHERE id = ${sellerId}`;
      }, `rejectSeller:${sellerId}`);

      console.log(`❌ Seller ${sellerId} REJEITADO por admin ${req.authUser?.email} - Motivo: ${rejectionReason}`);
      try { await storage.clearSellerCache(); } catch {}

      if (sellerData?.email) {
        sendSellerRejectionEmail(sellerData.email, reason, sellerData.business_name || sellerData.name)
          .catch(err => console.error("❌ Erro ao enviar email de rejeição:", err));
      }

      return res.json({ success: true, message: 'Seller rejeitado.', sellerId, action: 'rejected', reason });
    }

  } catch (error: any) {
    console.error('❌ Erro ao processar ação de seller:', error);
    if (error.message === 'SELLER_NOT_FOUND') return res.status(404).json({ error: 'Seller não encontrado.', code: 'SELLER_NOT_FOUND' });
    return res.status(500).json({ error: 'Erro ao processar ação de seller.', details: error.message, code: 'SERVER_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 2: PUT /api/admin/seller-acquirers/:sellerId - Admin update seller acquirers
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.put('/api/admin/seller-acquirers/:sellerId', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId } = req.params;
    const acquirers = req.body.acquirers || {};

    console.log(`💳 PUT /api/admin/seller-acquirers/${sellerId} - Admin: ${req.authUser?.email}`);
    console.log(`📊 Configurações recebidas:`, acquirers);

    if (!sellerId) {
      return res.status(400).json({ 
        error: 'Seller ID é obrigatório.',
        code: 'MISSING_SELLER_ID'
      });
    }

    const acquirersConfig = {
      pix: acquirers.pix || null,
      boleto: acquirers.boleto || null,
      creditCard: acquirers.creditCard || null,
      creditCardBR: acquirers.creditCardBR || null,
      creditCardGlobal: acquirers.creditCardGlobal || null,
    };

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      await sql`UPDATE sellers SET acquirers = ${JSON.stringify(acquirersConfig)}, updated_at = NOW() WHERE id = ${sellerId}`;
      await sql`UPDATE tenants SET acquirers = ${JSON.stringify(acquirersConfig)}, updated_at = NOW() WHERE owner_id = ${sellerId}`;
    }, `adminAcquirers:${sellerId}`);

    console.log(`✅ Adquirentes configurados para seller ${sellerId}`);
    syncSellerFeesToRTDB(sellerId, { acquirers: acquirersConfig, type: "acquirer-override" }).catch(err => console.error(`⚠️ [ETERNAL-SYNC] Erro async seller acquirers ${sellerId}:`, err?.message));
    return res.json({ success: true, message: 'Configurações de adquirentes salvas com sucesso!', sellerId, acquirers: acquirersConfig });

  } catch (error: any) {
    console.error('❌ Erro ao salvar adquirentes do seller:', error);
    if (error.message === 'SELLER_NOT_FOUND') return res.status(404).json({ error: 'Seller não encontrado.', code: 'SELLER_NOT_FOUND' });
    return res.status(500).json({ error: 'Erro ao salvar configurações de adquirentes.', details: error.message, code: 'SERVER_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 3: GET /api/seller/acquirers - Get seller acquirers
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/seller/acquirers', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;

    if (!sellerId) {
      return res.status(401).json({ 
        error: 'Não autorizado.',
        code: 'UNAUTHORIZED'
      });
    }

    console.log(`💳 GET /api/seller/acquirers - Seller: ${req.authUser?.email}`);

    let acquirersConfig: any = {};
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT acquirers FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      acquirersConfig = rows[0].acquirers || {};
    }, `sellerAcquirers:${sellerId}`);

    console.log(`✅ Configurações atuais:`, acquirersConfig);
    
    return res.json({
      success: true,
      acquirers: {
        pix: acquirersConfig.pix || null,
        boleto: acquirersConfig.boleto || null,
        creditCard: acquirersConfig.creditCard || null,
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar adquirentes:', error);
    return res.status(500).json({
      error: 'Erro ao buscar configurações.',
      details: error.message,
      code: 'SERVER_ERROR'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 4: GET /api/seller/webhook-settings - Get webhook settings
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/seller/webhook-settings', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;
    if (!sellerId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    let webhookUrl: string | null = null;
    let webhookEnabled = false;
    let lastWebhookTest: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT webhook_url, webhook_enabled, last_webhook_test FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (rows[0]) {
        webhookUrl = rows[0].webhook_url || null;
        webhookEnabled = rows[0].webhook_enabled || false;
        lastWebhookTest = rows[0].last_webhook_test || null;
      }
    }, `webhookGet:${sellerId}`);
    res.json({ webhookUrl, webhookEnabled, lastWebhookTest });
  } catch (error: any) {
    console.error('❌ Erro ao buscar webhook settings:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 5: PUT /api/seller/webhook-settings - Update webhook settings
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.put('/api/seller/webhook-settings', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;
    if (!sellerId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { webhookUrl, webhookEnabled } = req.body;

    if (webhookUrl) {
      if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'URL deve começar com http:// ou https://' });
      }
      try {
        new URL(webhookUrl);
      } catch {
        return res.status(400).json({ error: 'URL inválida' });
      }
    }

    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET webhook_url = ${webhookUrl || null}, webhook_enabled = ${webhookEnabled !== false}, webhook_updated_at = NOW(), updated_at = NOW() WHERE id = ${sellerId}`;
    }, `webhookSet:${sellerId}`);

    console.log(`✅ Webhook configurado para seller ${sellerId}: ${webhookUrl || '(removido)'}`);

    res.json({ 
      success: true, 
      message: webhookUrl ? 'Webhook configurado com sucesso!' : 'Webhook removido',
      webhookUrl
    });
  } catch (error: any) {
    console.error('❌ Erro ao salvar webhook settings:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 6: POST /api/seller/webhook-test - Test webhook
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/seller/webhook-test', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;
    if (!sellerId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    let webhookUrl: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT webhook_url FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (!rows[0]) throw new Error('NOT_FOUND');
      webhookUrl = rows[0].webhook_url || null;
    }, `webhookTest:${sellerId}`);

    if (!webhookUrl) {
      return res.status(400).json({ error: 'Configure uma URL de webhook primeiro' });
    }

    const testPayload = {
      event: 'webhook.test',
      tenantId: sellerId,
      data: {
        message: 'Teste do sistema de webhooks VolatusPay',
        testId: `test_${Date.now()}`,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      apiVersion: '2025-11-03'
    };

    console.log(`🧪 Enviando webhook de teste para ${webhookUrl}`);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Volatus-Pay-Event': 'webhook.test',
          'X-Volatus-Pay-Tenant': sellerId,
          'X-Webhook-Source': 'volatuspay.com',
          'User-Agent': 'VolatusPay-Webhook/1.0'
        },
        body: JSON.stringify(testPayload)
      });

      const responseText = await response.text();

      const testResult = { testedAt: new Date(), success: response.ok, statusCode: response.status, response: responseText.substring(0, 200) };
      neonQuery(async (sql) => {
        await sql`UPDATE sellers SET last_webhook_test = ${JSON.stringify(testResult)}, updated_at = NOW() WHERE id = ${sellerId}`;
      }, `webhookTestSave:${sellerId}`).catch(() => {});

      if (response.ok) {
        console.log(`✅ Webhook de teste entregue: ${response.status}`);
        res.json({ success: true, message: 'Webhook de teste enviado com sucesso!', statusCode: response.status, response: responseText.substring(0, 200) });
      } else {
        res.json({ success: false, message: `Servidor retornou status ${response.status}`, statusCode: response.status, response: responseText.substring(0, 200) });
      }
    } catch (fetchError: any) {
      console.error('❌ Erro ao enviar webhook de teste:', fetchError.message);
      const errResult = { testedAt: new Date(), success: false, error: fetchError.message };
      neonQuery(async (sql) => {
        await sql`UPDATE sellers SET last_webhook_test = ${JSON.stringify(errResult)}, updated_at = NOW() WHERE id = ${sellerId}`;
      }, `webhookTestSaveErr:${sellerId}`).catch(() => {});

      res.json({ 
        success: false, 
        message: `Erro ao conectar: ${fetchError.message}`,
        error: fetchError.message
      });
    }
  } catch (error: any) {
    console.error('❌ Erro no teste de webhook:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 7: PUT /api/seller/acquirers - Update seller acquirers
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.put('/api/seller/acquirers', verifyFirebaseToken, requireApprovedSeller, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;
    const { acquirers } = req.body;

    if (!sellerId) {
      return res.status(401).json({ 
        error: 'Não autorizado.',
        code: 'UNAUTHORIZED'
      });
    }

    console.log(`💳 PUT /api/seller/acquirers - Seller: ${req.authUser?.email}`);
    console.log(`📊 Configurações recebidas:`, acquirers);

    const acquirersConfig = {
      pix: acquirers.pix || null,
      boleto: acquirers.boleto || null,
      creditCard: acquirers.creditCard || null,
      creditCardBR: acquirers.creditCardBR || null,
      creditCardGlobal: acquirers.creditCardGlobal || null,
    };

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      await sql`UPDATE sellers SET acquirers = ${JSON.stringify(acquirersConfig)}, updated_at = NOW() WHERE id = ${sellerId}`;
      await sql`UPDATE tenants SET acquirers = ${JSON.stringify(acquirersConfig)}, updated_at = NOW() WHERE owner_id = ${sellerId}`;
    }, `sellerAcquirersSet:${sellerId}`);

    console.log(`✅ Adquirentes configurados para seller ${sellerId}`);
    syncSellerFeesToRTDB(sellerId, { acquirers: acquirersConfig, type: "acquirer-override" }).catch(err => console.error("ETERNAL-SYNC seller:", err?.message));
    return res.json({ success: true, message: 'Configurações de adquirentes salvas com sucesso!', acquirers: acquirersConfig });

  } catch (error: any) {
    console.error('❌ Erro ao salvar adquirentes:', error);
    return res.status(500).json({
      error: 'Erro ao salvar configurações de adquirentes.',
      details: error.message,
      code: 'SERVER_ERROR'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 8: POST /api/seller/apply-acquirers-to-checkouts - Apply acquirers to all checkouts
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/seller/apply-acquirers-to-checkouts', verifyFirebaseToken, requireApprovedSeller, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;

    if (!sellerId) {
      return res.status(401).json({ 
        error: 'Não autorizado.',
        code: 'UNAUTHORIZED'
      });
    }

    console.log(`🔄 POST /api/seller/apply-acquirers-to-checkouts - Seller: ${req.authUser?.email}`);

    let acquirersConfig: any = null;
    let updateCount = 0;

    await neonQuery(async (sql) => {
      const sRows = await sql`SELECT acquirers FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (!sRows[0]) throw new Error('SELLER_NOT_FOUND');
      acquirersConfig = sRows[0].acquirers;
      if (!acquirersConfig) return;

      const checkouts = await sql`SELECT id, market_target FROM checkouts WHERE tenant_id = ${sellerId}`;
      for (const co of checkouts) {
        const marketTarget = co.market_target || 'brasil';
        const checkoutAcquirers: any = {};
        if (marketTarget === 'brasil') {
          if (acquirersConfig.pix) checkoutAcquirers.pix = { enabled: true, acquirer: acquirersConfig.pix };
          if (acquirersConfig.boleto) checkoutAcquirers.boleto = { enabled: true, acquirer: acquirersConfig.boleto };
          if (acquirersConfig.creditCard) checkoutAcquirers.creditCard = { enabled: true, acquirer: acquirersConfig.creditCard };
        } else {
          if (acquirersConfig.creditCard) checkoutAcquirers.creditCard = { enabled: true, acquirer: acquirersConfig.creditCard };
        }
        await sql`UPDATE checkouts SET acquirers = ${JSON.stringify(checkoutAcquirers)}, updated_at = NOW() WHERE id = ${co.id}`;
        updateCount++;
      }
    }, `applyAcquirers:${sellerId}`);

    if (!acquirersConfig) {
      return res.status(400).json({ error: 'Você precisa configurar os adquirentes primeiro.', code: 'NO_ACQUIRERS_CONFIG' });
    }

    console.log(`✅ ${updateCount} checkouts atualizados com sucesso!`);
    return res.json({ success: true, message: `${updateCount} checkouts atualizados com sucesso!`, updated: updateCount, acquirers: acquirersConfig });

  } catch (error: any) {
    console.error('❌ Erro ao aplicar adquirentes nos checkouts:', error);
    return res.status(500).json({
      error: 'Erro ao aplicar configurações nos checkouts.',
      details: error.message,
      code: 'SERVER_ERROR'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE: PUT /api/sellers/:uid/verify - Complete seller verification (KYC)
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.put('/api/sellers/:uid/verify', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { uid } = req.params;
    
    if (req.user?.uid !== uid) {
      return res.status(403).json({ success: false, message: 'Acesso negado' });
    }

    const {
      name, email, phone, birthDate, documentType, document,
      personalDocumentType, personalDocumentNumber,
      companyName, businessDescription, businessNiche, productType,
      businessWebsite, address, documentsUrls
    } = req.body;

    const requiredFields = { name, phone, documentType, document, companyName };
    const missingFields = Object.entries(requiredFields).filter(([_, v]) => !v).map(([k]) => k);
    if (missingFields.length > 0) {
      return res.status(400).json({ success: false, message: `Campos obrigatórios faltando: ${missingFields.join(', ')}` });
    }

    if (!documentsUrls?.documentFront || !documentsUrls?.documentBack || !documentsUrls?.selfieWithDocument) {
      return res.status(400).json({ success: false, message: 'Todos os documentos são obrigatórios' });
    }

    if (documentType === 'cnpj' && !documentsUrls?.cnpjCard) {
      return res.status(400).json({ success: false, message: 'Cartão CNPJ é obrigatório para pessoa jurídica' });
    }

    if (!address?.street || !address?.number || !address?.neighborhood || !address?.city || !address?.state || !address?.zipCode) {
      return res.status(400).json({ success: false, message: 'Endereço completo é obrigatório' });
    }

    let existingEmail = email;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, email, name, business_name FROM sellers WHERE id = ${uid} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      existingEmail = email || rows[0].email;
      await sql`
        UPDATE sellers SET
          profile_complete = TRUE, status = 'pending', verification_submitted_at = NOW(), updated_at = NOW(),
          name = ${name}, email = ${existingEmail}, phone = ${phone},
          birth_date = ${birthDate || ''}, document_type = ${documentType}, document = ${document},
          personal_document_type = ${personalDocumentType || ''}, personal_document_number = ${personalDocumentNumber || ''},
          company_name = ${companyName}, business_name = ${companyName},
          business_description = ${businessDescription || ''}, business_niche = ${businessNiche || ''},
          product_type = ${productType || ''}, business_website = ${businessWebsite || ''},
          address = ${JSON.stringify(address)}, documents_urls = ${JSON.stringify(documentsUrls)}
        WHERE id = ${uid}
      `;
    }, `kycVerify:${uid}`);

    console.log(`✅ Seller ${uid} verificação completada - status: pending`);

    const adminEmailAddr = process.env.ADMIN_EMAIL;
    if (adminEmailAddr) {
      sendNewSellerPendingEmail(adminEmailAddr, {
        name: name || 'Não informado',
        email: existingEmail || 'Não informado',
        businessName: companyName || 'Não informado',
        businessNiche: businessNiche || '',
        document: document || '',
      }).catch(e => console.warn('[KYC-VERIFY] Erro ao notificar admin:', e?.message));
    }

    return res.json({ success: true, message: 'Verificação enviada com sucesso. Aguarde a análise.' });
  } catch (error: any) {
    console.error('❌ Erro na verificação do seller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao processar verificação',
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 9: POST /api/sellers/register - Seller registration
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/sellers/register', authRateLimiter, 
  sellerRegistrationSecurityMiddleware,
  async (req, res) => {
  try {
    console.log('👤 SELLER REGISTER - Processando novo registro de seller...');
    
    console.log('🔍 DEBUG - DADOS RECEBIDOS NO BODY:', {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      birthDate: req.body.birthDate,
      personalDocumentType: req.body.personalDocumentType,
      personalDocumentNumber: req.body.personalDocumentNumber,
      acceptedTerms: req.body.acceptedTerms,
      businessName: req.body.businessName,
      document: req.body.document,
      businessNiche: req.body.businessNiche,
      productType: req.body.productType,
      productsDescription: req.body.productsDescription,
      hasAddress: !!req.body.address,
      hasDocumentsUrls: !!req.body.documentsUrls
    });
    
    const validatedData = sellerRegisterFormSchema.parse(req.body);
    
    console.log('🔍 DEBUG - DADOS APÓS VALIDAÇÃO ZOD:', {
      name: validatedData.name,
      email: validatedData.email,
      phone: validatedData.phone,
      birthDate: validatedData.birthDate,
      personalDocumentType: validatedData.personalDocumentType,
      personalDocumentNumber: validatedData.personalDocumentNumber,
      acceptedTerms: validatedData.acceptedTerms,
      businessName: validatedData.businessName,
      document: validatedData.document,
      businessNiche: validatedData.businessNiche,
      productType: validatedData.productType,
      productsDescription: validatedData.productsDescription
    });
    
    const hashedPassword = await bcrypt.hash(validatedData.password, 10);
    
    const tenantId = `tenant_${Date.now()}_${nanoid(16)}`;
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    
    console.log(`🔍 Verificando se email ${validatedData.email} já está cadastrado...`);
    
    let emailExists = false;
    try {
      await admin.auth().getUserByEmail(validatedData.email);
      emailExists = true;
    } catch (authError: any) {
      if (authError.code !== 'auth/user-not-found') {
        console.error('❌ Erro ao verificar email no Firebase Auth:', authError.message);
      }
    }
    
    if (!emailExists) {
      await neonQuery(async (sql) => {
        const rows = await sql`SELECT id FROM sellers WHERE email = ${validatedData.email} LIMIT 1`;
        if (rows[0]) emailExists = true;
      }, `checkEmailExists:${validatedData.email}`);
    }
    
    if (emailExists) {
      console.warn(`❌ REGISTRO BLOQUEADO: Email ${validatedData.email} já está cadastrado`);
      return res.status(400).json({ success: false, error: 'email-already-exists', message: 'Este email já está cadastrado. Faça login ou use outro email.' });
    }

    // 🔍 VERIFICAR UNICIDADE DE CPF/CNPJ via Neon
    if (validatedData.document) {
      const normalizedDoc = validatedData.document.replace(/\D/g, '');
      if (normalizedDoc.length >= 11) {
        let docExists = false;
        await neonQuery(async (sql) => {
          const rows = await sql`SELECT id FROM sellers WHERE document = ${normalizedDoc} LIMIT 1`;
          if (rows[0]) docExists = true;
        }, `checkDocExists:${normalizedDoc.substring(0, 4)}`);
        if (docExists) {
          console.warn(`❌ REGISTRO BLOQUEADO: CPF/CNPJ ${normalizedDoc.substring(0, 4)}*** já cadastrado`);
          return res.status(400).json({ success: false, error: 'document-already-exists', message: 'Este CPF/CNPJ já está cadastrado. Se já tem uma conta, faça login.' });
        }
      }
    }

    console.log(`✅ Email ${validatedData.email} disponível para cadastro`);
    
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: validatedData.email,
        password: validatedData.password,
        displayName: validatedData.name,
        emailVerified: false
      });
      
      console.log(`🔥 Usuário Firebase Auth criado: ${userRecord.uid} (${validatedData.email || 'N/A'})`);

      // 📧 VERIFICAÇÃO DE EMAIL — envia link de verificação automaticamente (fire & forget)
      admin.auth().generateEmailVerificationLink(validatedData.email).then(link => {
        return sendEmail({
          to: validatedData.email,
          subject: 'Confirme seu email - VolatusPay',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
              <div style="background:#6366f1;padding:28px 32px">
                <h1 style="color:#fff;margin:0;font-size:22px"> VolatusPay</h1>
              </div>
              <div style="padding:32px">
                <h2 style="margin-top:0;color:#1e1b4b">Confirme seu endereço de email</h2>
                <p style="color:#374151">Olá <strong>${validatedData.name || 'vendedor'}</strong>,</p>
                <p style="color:#374151">Clique no botão abaixo para confirmar que este é seu email e ativar sua conta.</p>
                <div style="text-align:center;margin:28px 0">
                  <a href="${link}" style="background:#6366f1;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
                    Confirmar email
                  </a>
                </div>
                <p style="color:#6b7280;font-size:13px">Se você não criou esta conta, ignore este email.</p>
                <p style="color:#6b7280;font-size:12px">Link expira em 24 horas.</p>
              </div>
            </div>
          `
        });
      }).catch(e => console.warn('[EMAIL-VERIF] Falha ao enviar verificação (não crítico):', e?.message));

    } catch (createError: any) {
      if (createError.code === 'auth/email-already-in-use') {
        return res.status(400).json({
          success: false,
          error: 'email-already-exists',
          message: 'Este email já está cadastrado. Faça login ou use outro email.'
        });
      }
      
      throw createError;
    }
    
    const { confirmEmail, confirmPassword, ...sellerData } = validatedData;
    
    const sellerIP = req.headers['x-forwarded-for'] || 
                      req.headers['x-real-ip'] || 
                      req.connection?.remoteAddress || 
                      req.socket?.remoteAddress || 
                      'unknown';
    
    const deviceFingerprint = req.body.deviceFingerprint;
    const hasConsentForDataTracking = deviceFingerprint?.consentGiven === true;
    const consentTermsVersion = "1.0.0";
    const serverConsentTimestamp = new Date();
    
    console.log('🔍 DEBUG CADASTRO - DEVICE FINGERPRINT:', {
      deviceFingerprintRecebido: !!deviceFingerprint,
      consentGivenValue: deviceFingerprint?.consentGiven,
      consentGivenType: typeof deviceFingerprint?.consentGiven,
      hasConsentForDataTracking,
      acceptedTerms: validatedData.acceptedTerms,
      fingerprintKeys: deviceFingerprint ? Object.keys(deviceFingerprint).slice(0, 15) : [],
      userAgent: deviceFingerprint?.userAgent?.substring(0, 50) || 'N/A',
      cpuCores: deviceFingerprint?.cpuCores || 'N/A',
      screenResolution: deviceFingerprint?.screenResolution || 'N/A'
    });
    
    if (deviceFingerprint && !hasConsentForDataTracking) {
      console.warn('⚠️ LGPD VIOLATION PREVENTED: Tentativa de coletar deviceFingerprint sem consentimento explícito');
      delete req.body.deviceFingerprint;
    } else if (hasConsentForDataTracking) {
      console.log(`✅ LGPD CONSENT VERIFIED: Seller ${validatedData.email} autorizou coleta de dados técnicos em ${serverConsentTimestamp.toISOString()} (Versão: ${consentTermsVersion})`);
    }
    
    const newSeller: any = {
      ...sellerData,
      userId: userRecord.uid,
      password: hashedPassword,
      tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
      acceptedTerms: validatedData.acceptedTerms === true,
      termsAcceptedAt: validatedData.acceptedTerms === true ? serverConsentTimestamp : undefined,
      acceptedDataTracking: hasConsentForDataTracking,
      dataTrackingConsentDate: hasConsentForDataTracking ? serverConsentTimestamp : undefined,
      dataTrackingConsentVersion: hasConsentForDataTracking ? consentTermsVersion : undefined,
      deviceFingerprint: hasConsentForDataTracking ? deviceFingerprint : undefined,
      registrationIP: hasConsentForDataTracking ? sellerIP : undefined,
      lastLoginIP: sellerIP,
      lastLoginAt: serverConsentTimestamp,
      lastLoginDevice: req.headers['user-agent']?.includes('Mobile') ? 'Mobile' : 
                      req.headers['user-agent']?.includes('Tablet') ? 'Tablet' : 'Desktop',
    };
    
    console.log('🔍 DEBUG - DADOS QUE SERÃO SALVOS NO FIRESTORE:', {
      name: newSeller.name,
      email: newSeller.email,
      phone: newSeller.phone,
      birthDate: newSeller.birthDate,
      personalDocumentType: newSeller.personalDocumentType,
      personalDocumentNumber: newSeller.personalDocumentNumber,
      acceptedTerms: newSeller.acceptedTerms,
      acceptedDataTracking: newSeller.acceptedDataTracking,
      businessName: newSeller.businessName,
      document: newSeller.document,
      businessNiche: newSeller.businessNiche,
      productType: newSeller.productType,
      productsDescription: newSeller.productsDescription,
      hasAddress: !!newSeller.address,
      hasDocumentsUrls: !!newSeller.documentsUrls,
      tenantId: newSeller.tenantId,
      allFields: Object.keys(newSeller).length
    });
    
    const createdSeller = await storage.createSeller(newSeller);
    
    console.log(`✅ Seller criado com sucesso: ${createdSeller.email || createdSeller.id} (${createdSeller.id})`);

    // 🔔 NOTIFICAR ADMIN: Novo seller aguardando aprovação (fire-and-forget)
    const adminEmailAddr = process.env.ADMIN_EMAIL;
    if (adminEmailAddr) {
      sendNewSellerPendingEmail(adminEmailAddr, {
        name: newSeller.name,
        email: newSeller.email,
        businessName: newSeller.businessName,
        businessNiche: newSeller.businessNiche,
        document: newSeller.document,
      }).then(r => {
        if (r.success) console.log(`📧 [SELLER-REG] Notificação de novo seller enviada ao admin (${adminEmailAddr})`);
        else console.warn(`⚠️ [SELLER-REG] Falha ao notificar admin: ${r.error}`);
      }).catch(e => console.warn('[SELLER-REG] Erro ao notificar admin:', e?.message));
    }
    
    try {
      console.log('📁 Criando estrutura de pastas no Bunny Storage para seller...');
      const folderResult = await createSellerFolderStructure(createdSeller.email);
      if (folderResult.success) {
        console.log(`✅ Estrutura de pastas criada: ${folderResult.folders.length} pastas`);
      } else {
        console.warn('⚠️ Erro ao criar pastas (não crítico):', folderResult.error);
      }
    } catch (folderError) {
      console.warn('⚠️ Erro ao criar estrutura de pastas (não crítico):', folderError);
    }

    
    try {
      console.log('🔑 Gerando token de API para novo seller...');
      
      const crypto = await import('crypto');
      const apiToken = `vp_${crypto.randomBytes(32).toString('hex')}`;
      const apiTokenHash = crypto.createHash('sha256').update(apiToken).digest('hex');
      const { nanoid: nid } = await import('nanoid');
      const apiKeyId = nid();
      
      await neonQuery(async (sql) => {
        await sql`
          INSERT INTO api_keys (id, seller_id, name, permissions, key_hash, last4, active, auto_generated, usage_count, created_at, updated_at)
          VALUES (${apiKeyId}, ${userRecord.uid}, 'Chave Principal (Auto-gerada)',
            ${'["payment.create","payment.read","checkout.read","order.read"]'},
            ${apiTokenHash}, ${apiToken.slice(-4)}, TRUE, TRUE, 0, NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
        `;
        await sql`UPDATE sellers SET initial_api_key = ${apiToken}, initial_api_key_id = ${apiKeyId}, has_api_key = TRUE, updated_at = NOW() WHERE id = ${userRecord.uid}`;
      }, `createApiKey:${userRecord.uid}`);

      console.log(`✅ TOKEN DE API SALVO NO NEON: ${apiKeyId}`);
    } catch (tokenError) {
      console.error('⚠️ Erro ao gerar token de API (não crítico):', tokenError);
    }
    
    res.json({
      success: true,
      message: 'Seller registrado com sucesso!',
      seller: {
        id: createdSeller.id,
        email: createdSeller.email,
        businessName: createdSeller.businessName,
        tenantId: createdSeller.tenantId
      }
    });
    
  } catch (error) {
    console.error('❌ Erro no registro de seller:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 9B: POST /api/sellers/verify-email/resend - Reenviar email de verificação
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/sellers/verify-email/resend', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    const adminSdk = admin.auth();
    const userRecord = await adminSdk.getUser(userId);

    if (userRecord.emailVerified) {
      return res.json({ success: true, message: 'Email já verificado.' });
    }

    if (!userRecord.email) {
      return res.status(400).json({ error: 'Usuário sem email.' });
    }

    const link = await adminSdk.generateEmailVerificationLink(userRecord.email);
    await sendEmail({
      to: userRecord.email,
      subject: 'Confirme seu email - VolatusPay',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#6366f1;padding:28px 32px">
            <h1 style="color:#fff;margin:0;font-size:22px"> VolatusPay</h1>
          </div>
          <div style="padding:32px">
            <h2 style="margin-top:0;color:#1e1b4b">Confirme seu endereço de email</h2>
            <p>Clique no botão abaixo para confirmar sua conta VolatusPay:</p>
            <div style="text-align:center;margin:28px 0">
              <a href="${link}" style="background:#6366f1;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
                Confirmar email
              </a>
            </div>
            <p style="color:#6b7280;font-size:12px">Link expira em 24 horas.</p>
          </div>
        </div>
      `
    });

    return res.json({ success: true, message: 'Email de verificação reenviado.' });
  } catch (error: any) {
    console.error('[EMAIL-VERIF] Erro ao reenviar:', error?.message);
    return res.status(500).json({ error: 'Falha ao reenviar email de verificação.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 10: POST /api/sellers/track-login - Track seller login
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/sellers/track-login', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const { deviceFingerprint } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado'
      });
    }
    
    if (!deviceFingerprint) {
      return res.status(400).json({
        success: false,
        error: 'Device fingerprint é obrigatório'
      });
    }
    
    console.log('🔍 LOGIN TRACKING - Seller:', userId);
    
    let sellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, device_fingerprint FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (rows[0]) sellerData = rows[0];
    }, `trackLogin:${userId}`);
    
    if (!sellerData) {
      console.log('⚠️ [TRACK-LOGIN] Seller não encontrado no Neon (pode ser novo registro):', userId);
      return res.json({ success: true, skipped: true, message: 'Seller ainda sem documento - tracking adiado' });
    }
    const previousDevice = sellerData.device_fingerprint;
    
    const currentIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
                      req.ip || 
                      req.socket.remoteAddress || 
                      'unknown';
    
    interface GeoLocationResponse {
      status?: string;
      message?: string;
      country?: string;
      countryCode?: string;
      region?: string;
      regionName?: string;
      city?: string;
      zip?: string;
      lat?: number;
      lon?: number;
      timezone?: string;
      isp?: string;
      org?: string;
      as?: string;
      query?: string;
    }
    
    let geoData: Record<string, any> = {};
    if (currentIP && currentIP !== 'unknown' && !currentIP.includes('127.0.0.1') && !currentIP.includes('::1')) {
      try {
        console.log(`🌍 Buscando geolocalização para IP: ${currentIP}`);
        const geoResponse = await fetch(`http://ip-api.com/json/${currentIP}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
        const geoJson: GeoLocationResponse = await geoResponse.json();
        
        if (geoJson.status === 'success') {
          geoData = {
            country: geoJson.country,
            countryCode: geoJson.countryCode,
            region: geoJson.regionName,
            city: geoJson.city,
            zip: geoJson.zip,
            lat: geoJson.lat,
            lon: geoJson.lon,
            timezone: geoJson.timezone,
            isp: geoJson.isp,
            org: geoJson.org,
            as: geoJson.as
          };
          console.log(`✅ Geolocalização encontrada: ${geoData.city}, ${geoData.region} - ${geoData.country} (${geoData.isp})`);
        } else {
          console.warn(`⚠️ Geolocalização falhou: ${geoJson.message || 'Unknown error'}`);
        }
      } catch (geoError) {
        console.warn('⚠️ Erro ao buscar geolocalização (não crítico):', geoError);
      }
    }
    
    const deviceHistory = sellerData.deviceHistory || [];
    const now = new Date();
    
    if (previousDevice && deviceHistory.length === 0) {
      deviceHistory.push({
        ...previousDevice,
        firstSeenAt: sellerData.createdAt || now,
        lastSeenAt: now,
        loginCount: 1
      });
    }
    
    const existingDeviceIndex = deviceHistory.findIndex(
      (d: any) => d.canvas === deviceFingerprint.canvas
    );
    
    const deviceChanged = !previousDevice || previousDevice.canvas !== deviceFingerprint.canvas;
    
    if (deviceChanged) {
      console.log('🚨 DISPOSITIVO DIFERENTE DETECTADO!', {
        seller: sellerData.email,
        previousCanvas: previousDevice?.canvas?.substring(0, 20),
        newCanvas: deviceFingerprint.canvas?.substring(0, 20),
        previousIP: sellerData.registrationIP,
        currentIP
      });
    }
    
    if (existingDeviceIndex >= 0) {
      deviceHistory[existingDeviceIndex].lastSeenAt = now;
      deviceHistory[existingDeviceIndex].loginCount = (deviceHistory[existingDeviceIndex].loginCount || 0) + 1;
      deviceHistory[existingDeviceIndex].lastIP = currentIP;
      console.log('✅ Dispositivo conhecido - Login #', deviceHistory[existingDeviceIndex].loginCount);
    } else {
      deviceHistory.push({
        ...deviceFingerprint,
        ip: currentIP,
        firstSeenAt: now,
        lastSeenAt: now,
        loginCount: 1
      });
      console.log('🆕 NOVO DISPOSITIVO adicionado');
    }
    
    const deviceData = { ...deviceFingerprint, ip: currentIP, ...geoData };
    const browserId = req.headers['x-browser-id'] as string;
    
    await neonQuery(async (sql) => {
      await sql`
        UPDATE sellers SET
          device_fingerprint = ${JSON.stringify(deviceData)},
          last_login_ip = ${currentIP},
          last_login_at = NOW(),
          device_history = ${JSON.stringify(deviceHistory)},
          browser_id = ${browserId || null},
          ${!sellerData.registration_ip ? sql`registration_ip = ${currentIP},` : sql``}
          updated_at = NOW()
        WHERE id = ${userId}
      `;
    }, `trackLoginUpdate:${userId}`);
    
    console.log('✅ Dados técnicos atualizados com sucesso no Neon!');
    
    return res.json({
      success: true,
      deviceChanged,
      message: deviceChanged ? 'Novo dispositivo detectado e registrado' : 'Login registrado e dados atualizados'
    });
    
  } catch (error: any) {
    console.error('❌ Erro no tracking de login:', error?.message);
    if (error?.code === 8 || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      return res.json({ success: true, deviceChanged: false, message: 'Tracking adiado - quota Firestore' });
    }
    return res.status(500).json({
      success: false,
      error: 'Erro ao rastrear login',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 11: POST /api/sellers/resubmit - Resubmit seller application
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/sellers/resubmit', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    let sellerDataR: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, status, name, email, business_name, business_niche, document FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      sellerDataR = rows[0];
      if (sellerDataR.status !== 'rejected') throw new Error(`NOT_REJECTED:${sellerDataR.status}`);
      await sql`UPDATE sellers SET status = 'pending', rejection_reason = NULL, rejected_at = NULL, resubmitted_at = NOW(), updated_at = NOW() WHERE id = ${userId}`;
    }, `resubmit:${userId}`);

    console.log(`📤 Seller ${userId} reenviou cadastro para análise`);
    try { await storage.clearSellerCache(); } catch {}

    const adminEmailAddr = process.env.ADMIN_EMAIL;
    if (adminEmailAddr && sellerDataR) {
      sendNewSellerPendingEmail(adminEmailAddr, {
        name: sellerDataR.name || 'Não informado',
        email: sellerDataR.email || 'Não informado',
        businessName: sellerDataR.business_name || 'Não informado',
        businessNiche: sellerDataR.business_niche || '',
        document: sellerDataR.document || '',
      }).catch(e => console.warn('[RESUBMIT] Erro ao notificar admin:', e?.message));
    }

    res.json({ success: true, message: 'Cadastro reenviado para análise!', newStatus: 'pending' });

  } catch (error: any) {
    console.error('❌ Erro ao reenviar cadastro:', error);
    res.status(500).json({ error: 'Erro ao reenviar cadastro', details: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 12: POST /api/sellers/update-device-fingerprint - Update device fingerprint
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/sellers/update-device-fingerprint', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const { deviceFingerprint } = req.body;
    
    if (!deviceFingerprint || !deviceFingerprint.consentGiven) {
      return res.status(400).json({ 
        error: 'Consentimento necessário para coletar dados técnicos' 
      });
    }

    console.log('🔄 Atualizando dados técnicos para seller:', userId);

    const clientIP = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() 
                    || req.headers['x-real-ip']?.toString()
                    || req.socket.remoteAddress?.replace('::ffff:', '')
                    || 'unknown';

    let sellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, device_history, data_tracking_consent_date FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (rows[0]) sellerData = rows[0];
    }, `updateDevice:${userId}`);
    
    if (!sellerData) {
      console.log('⚠️ [UPDATE-DEVICE] Seller não encontrado no Neon:', userId);
      return res.json({ success: true, skipped: true, message: 'Seller ainda sem documento - fingerprint adiado' });
    }

    const deviceHistory = sellerData.device_history || [];
    const now = new Date();
    
    const existingDeviceIndex = deviceHistory.findIndex((d: any) => d.canvas === deviceFingerprint.canvas);
    if (existingDeviceIndex >= 0) {
      deviceHistory[existingDeviceIndex].lastSeenAt = now;
      deviceHistory[existingDeviceIndex].loginCount = (deviceHistory[existingDeviceIndex].loginCount || 0) + 1;
      deviceHistory[existingDeviceIndex].lastIP = clientIP;
    } else {
      deviceHistory.push({ ...deviceFingerprint, ip: clientIP, firstSeenAt: now, lastSeenAt: now, loginCount: 1 });
    }

    await neonQuery(async (sql) => {
      await sql`
        UPDATE sellers SET
          device_fingerprint = ${JSON.stringify({ ...deviceFingerprint, ip: clientIP })},
          registration_ip = ${clientIP}, last_login_ip = ${clientIP}, last_login_at = NOW(),
          accepted_data_tracking = TRUE,
          data_tracking_consent_date = ${sellerData.data_tracking_consent_date || now.toISOString()},
          data_tracking_consent_version = '1.0',
          device_history = ${JSON.stringify(deviceHistory)}, updated_at = NOW()
        WHERE id = ${userId}
      `;
    }, `updateDeviceWrite:${userId}`);

    console.log('✅ Dados técnicos atualizados com sucesso no Neon');
    return res.json({ success: true, message: 'Dados técnicos coletados com sucesso', updated: true });

  } catch (error: any) {
    console.error('❌ Erro ao atualizar dados técnicos:', error?.message);
    return res.status(500).json({ error: 'Erro ao atualizar dados técnicos', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 13: GET /api/admin/sellers-risk - Sellers risk analysis
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/admin/sellers-risk', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🚨 ADMIN: Buscando dados REAIS de sellers de risco...');
    
    const { period, search, risk } = req.query;
    console.log('🔍 Filtros recebidos:', { period, search, risk });
    
    let filteredSellers: any[] = [];
    await neonQuery(async (sql) => {
      const sellers = await sql`SELECT id, name, business_name, email, status, created_at FROM sellers`;
      for (const s of sellers) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const last7 = new Date(now.getTime() - 7*24*60*60*1000);
        const last30 = new Date(now.getTime() - 30*24*60*60*1000);
        const last60 = new Date(now.getTime() - 60*24*60*60*1000);

        const refunds = await sql`SELECT created_at FROM refunds WHERE tenant_id = ${s.id}`;
        const orders = await sql`SELECT id FROM orders WHERE tenant_id = ${s.id} AND status IN ('paid','approved')`;
        const totalOrders = orders.length;
        const totalRefunds = refunds.length;
        const refundPercentage = totalOrders > 0 ? (totalRefunds / totalOrders) * 100 : 0;
        const refundsToday = refunds.filter((r: any) => new Date(r.created_at) >= today).length;
        const refundsYesterday = refunds.filter((r: any) => { const d = new Date(r.created_at); return d >= yesterday && d < today; }).length;
        const refundsLast7Days = refunds.filter((r: any) => new Date(r.created_at) >= last7).length;
        const refundsLast30Days = refunds.filter((r: any) => new Date(r.created_at) >= last30).length;
        const refundsLast60Days = refunds.filter((r: any) => new Date(r.created_at) >= last60).length;

        let riskScore = 0;
        if (refundPercentage > 20) riskScore += 40; else if (refundPercentage > 10) riskScore += 25; else if (refundPercentage > 5) riskScore += 15;
        if (refundsToday > 5) riskScore += 20; else if (refundsToday > 2) riskScore += 10;
        if (refundsLast7Days > 20) riskScore += 15; else if (refundsLast7Days > 10) riskScore += 10;
        if (s.status === 'blocked') riskScore += 25;
        const riskCategory = riskScore >= 60 ? 'critical' : riskScore >= 40 ? 'high' : riskScore >= 20 ? 'medium' : 'low';

        filteredSellers.push({
          sellerId: s.id, sellerName: s.name || s.business_name || 'N/A', sellerEmail: s.email || 'N/A',
          businessName: s.business_name || null, status: s.status || 'unknown',
          riskScore, riskCategory, refundPercentage: Number(refundPercentage.toFixed(2)),
          totalOrders, totalRefunds, refundsToday, refundsYesterday, refundsLast7Days, refundsLast30Days, refundsLast60Days,
          createdAt: s.created_at, lastUpdated: now, isHighRisk: riskScore >= 60, needsReview: riskScore >= 30, isBlocked: s.status === 'blocked'
        });
      }
    }, 'sellersRisk');

    console.log(`✅ SELLERS DE RISCO PROCESSADOS: ${filteredSellers.length}`);

    if (search && typeof search === 'string') {
      const sl = search.toLowerCase();
      filteredSellers = filteredSellers.filter(s => s.sellerName.toLowerCase().includes(sl) || s.sellerEmail.toLowerCase().includes(sl) || s.businessName?.toLowerCase().includes(sl));
    }
    if (risk && typeof risk === 'string' && risk !== 'all') {
      filteredSellers = filteredSellers.filter(s => s.riskCategory === risk);
    }

    res.json({ success: true, sellers: filteredSellers, total: filteredSellers.length, filters: { period, search, risk } });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar sellers de risco:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar sellers de risco'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 14: POST /api/admin/sellers/:tenantId/block - Block seller
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/admin/sellers/:tenantId/block', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const { blockType = 'account' } = req.body;
    const adminEmail = req.authUser?.email || 'unknown';
    const adminUid = req.authUser?.uid || 'unknown';
    
    console.log(`🚫 ADMIN: Bloqueando seller ${tenantId} por ${adminEmail} (tipo: ${blockType})`);

    let checkoutsDisabled = 0;
    let sellerEmail = 'N/A';
    await neonQuery(async (sql) => {
      const sRows = await sql`SELECT id, email FROM sellers WHERE id = ${tenantId} LIMIT 1`;
      if (!sRows[0]) throw new Error('SELLER_NOT_FOUND');
      sellerEmail = sRows[0].email || 'N/A';
      await sql`UPDATE sellers SET status = 'blocked', blocked_at = NOW(), blocked_by = ${adminEmail}, blocked_reason = 'Bloqueio manual pelo admin - risco de fraude', updated_at = NOW() WHERE id = ${tenantId}`;
      const cos = await sql`SELECT id FROM checkouts WHERE tenant_id = ${tenantId}`;
      for (const co of cos) {
        await sql`UPDATE checkouts SET active = FALSE, blocked_at = NOW(), updated_at = NOW() WHERE id = ${co.id}`;
        checkoutsDisabled++;
      }
      await sql`INSERT INTO audit_logs (action, target_type, target_id, target_email, performed_by, performed_by_uid, reason, checkouts_affected, ip_address, user_agent, created_at)
        VALUES ('SELLER_BLOCKED','seller',${tenantId},${sellerEmail},${adminEmail},${adminUid},'Bloqueio manual - monitoramento de risco',${checkoutsDisabled},${String(req.ip || req.headers['x-forwarded-for'] || 'unknown')},${req.headers['user-agent'] || 'unknown'},NOW())
        ON CONFLICT DO NOTHING`;
    }, `blockSeller:${tenantId}`);

    console.log(`✅ Seller ${tenantId} bloqueado. ${checkoutsDisabled} checkouts desativados.`);
    res.json({ success: true, message: 'Seller bloqueado com sucesso', checkoutsDisabled });
    
  } catch (error: any) {
    console.error('❌ Erro ao bloquear seller:', error);
    res.status(500).json({ error: 'Erro ao bloquear seller', code: 'INTERNAL_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 15: POST /api/admin/sellers/:tenantId/unblock - Unblock seller
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/admin/sellers/:tenantId/unblock', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const adminEmail = req.authUser?.email || 'unknown';
    const adminUid = req.authUser?.uid || 'unknown';
    
    console.log(`✅ ADMIN: Desbloqueando seller ${tenantId} por ${adminEmail}`);

    let checkoutsEnabled = 0;
    let sellerEmail2 = 'N/A';
    await neonQuery(async (sql) => {
      const sRows = await sql`SELECT id, email FROM sellers WHERE id = ${tenantId} LIMIT 1`;
      if (!sRows[0]) throw new Error('SELLER_NOT_FOUND');
      sellerEmail2 = sRows[0].email || 'N/A';
      await sql`UPDATE sellers SET status = 'approved', unblocked_at = NOW(), unblocked_by = ${adminEmail}, updated_at = NOW() WHERE id = ${tenantId}`;
      const cos = await sql`SELECT id FROM checkouts WHERE tenant_id = ${tenantId}`;
      for (const co of cos) {
        await sql`UPDATE checkouts SET active = TRUE, blocked_at = NULL, updated_at = NOW() WHERE id = ${co.id}`;
        checkoutsEnabled++;
      }
      await sql`INSERT INTO audit_logs (action, target_type, target_id, target_email, performed_by, performed_by_uid, reason, checkouts_affected, ip_address, user_agent, created_at)
        VALUES ('SELLER_UNBLOCKED','seller',${tenantId},${sellerEmail2},${adminEmail},${adminUid},'Desbloqueio manual - risco resolvido',${checkoutsEnabled},${String(req.ip || req.headers['x-forwarded-for'] || 'unknown')},${req.headers['user-agent'] || 'unknown'},NOW())
        ON CONFLICT DO NOTHING`;
    }, `unblockSeller:${tenantId}`);

    console.log(`✅ Seller ${tenantId} desbloqueado. ${checkoutsEnabled} checkouts reativados.`);
    res.json({ success: true, message: 'Seller desbloqueado com sucesso', checkoutsEnabled });
    
  } catch (error: any) {
    console.error('❌ Erro ao desbloquear seller:', error);
    res.status(500).json({ error: 'Erro ao desbloquear seller', code: 'INTERNAL_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 16: GET /api/admin/sellers/:sellerId/product-quality - Product quality
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/admin/sellers/:sellerId/product-quality', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId } = req.params;
    
    let totalScore = 0;
    let productCount = 0;
    const issues: any[] = [];

    await neonQuery(async (sql) => {
      const checkouts = await sql`SELECT id, image_url, product_image, product_name, name, description, price, category, warranty, warranty_days FROM checkouts WHERE tenant_id = ${sellerId}`;
      for (const product of checkouts) {
        let productScore = 100;
        const productIssues: string[] = [];
        if (!product.image_url && !product.product_image) { productScore -= 25; productIssues.push('Sem foto'); }
        const name = product.product_name || product.name || '';
        if (/^\d+$/.test(name) || name.length < 5) { productScore -= 20; productIssues.push('Nome genérico'); }
        const description = product.description || '';
        if (description.length < 20) { productScore -= 15; productIssues.push('Descrição curta'); }
        if (!product.price || product.price <= 0) { productScore -= 20; productIssues.push('Sem preço'); }
        if (!product.category) { productScore -= 10; productIssues.push('Sem categoria'); }
        if (!product.warranty && !product.warranty_days) { productScore -= 10; productIssues.push('Sem garantia'); }
        totalScore += Math.max(0, productScore);
        productCount++;
        if (productIssues.length > 0) issues.push({ productId: product.id, productName: name || 'Sem nome', score: Math.max(0, productScore), issues: productIssues });
      }
    }, `productQuality:${sellerId}`);
    
    const averageScore = productCount > 0 ? Math.round(totalScore / productCount) : 0;
    
    res.json({
      success: true,
      sellerId,
      averageScore,
      productCount,
      issues: issues.sort((a, b) => a.score - b.score)
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao calcular qualidade:', error);
    res.status(500).json({ error: 'Erro ao calcular qualidade' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 17: PATCH /api/seller/email - Update seller email
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.patch('/api/seller/email', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    const { email } = req.body;
    
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }
    
    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET support_email = ${email}, updated_at = NOW() WHERE id = ${tenantId}`;
    }, `updateEmail:${tenantId}`);

    console.log(`✅ [UPDATE EMAIL] E-mail do seller ${tenantId} atualizado`);
    res.json({ success: true, message: 'E-mail atualizado com sucesso', email });
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar e-mail:', error);
    res.status(500).json({ error: 'Erro ao atualizar e-mail', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 18: PATCH /api/seller/phone - Update seller phone
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.patch('/api/seller/phone', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    const { phone } = req.body;
    
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Telefone inválido' });
    }
    
    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET phone = ${phone}, updated_at = NOW() WHERE id = ${tenantId}`;
    }, `updatePhone:${tenantId}`);

    console.log(`✅ [UPDATE PHONE] Telefone do seller ${tenantId} atualizado`);
    res.json({ success: true, message: 'Telefone atualizado com sucesso', phone });
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar telefone:', error);
    res.status(500).json({ error: 'Erro ao atualizar telefone', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 19: DELETE /api/seller/phone - Delete seller phone
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.delete('/api/seller/phone', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = await getTenantFromAuth(req);
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação inválida' });
    }
    
    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET phone = NULL, updated_at = NOW() WHERE id = ${tenantId}`;
    }, `deletePhone:${tenantId}`);
    
    console.log(`✅ [DELETE PHONE] Telefone do seller ${tenantId} removido`);
    
    res.json({ success: true, message: 'Telefone removido com sucesso' });
    
  } catch (error: any) {
    console.error('❌ Erro ao deletar telefone:', error);
    res.status(500).json({ error: 'Erro ao deletar telefone', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 20: GET /api/admin/sellers/approved - List approved sellers
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/admin/sellers/approved', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('👥 ADMIN: Buscando sellers aprovados com IPs...');
    
    let approvedSellers: any[] = [];
    await neonQuery(async (sql) => {
      approvedSellers = await sql`SELECT id, email, name, business_name, status, approved_at, created_at, device_fingerprint, last_login_ip, registration_ip, device_history, address FROM sellers WHERE status = 'approved'`;
    }, 'adminApprovedSellers');
    
    console.log(`✅ ${approvedSellers.length} sellers aprovados encontrados`);
    
    const formatted = approvedSellers.map((seller: any) => {
      const deviceHistory = seller.device_history || [];
      const registrationIP = seller.registration_ip || (deviceHistory.length > 0 ? deviceHistory[0]?.ip : null);
      const lastLoginIP = seller.last_login_ip || (deviceHistory.length > 0 ? deviceHistory[deviceHistory.length - 1]?.ip : registrationIP);
      return {
        id: seller.id,
        uid: seller.id,
        email: seller.email || 'N/A',
        name: seller.name || seller.business_name || null,
        registrationIP,
        lastLoginIP,
        status: seller.status,
        approvedAt: seller.approved_at,
        createdAt: seller.created_at,
        deviceFingerprint: seller.device_fingerprint || (deviceHistory.length > 0 ? deviceHistory[deviceHistory.length - 1]?.deviceFingerprint : null),
        country: seller.address?.country || (deviceHistory.length > 0 ? deviceHistory[0]?.location?.country : null),
        city: seller.address?.city || (deviceHistory.length > 0 ? deviceHistory[0]?.location?.city : null),
      }});

    res.json(formatted);

  } catch (error: any) {
    console.error('❌ Erro ao buscar sellers aprovados:', error);
    res.status(500).json({
      error: 'Erro ao buscar sellers aprovados',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 21: GET /api/admin/sellers - List all sellers
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/admin/sellers', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('👑 GET /api/admin/sellers - Admin autenticado:', req.user?.uid, req.user?.email);
    
    let sellers: any[] = [];
    await neonQuery(async (sql) => {
      sellers = await sql`SELECT id, email, name, business_name, status, created_at, tenant_id, document, is_approved, facial_verification, documents_urls, profile_photo, photo_url, phone, birth_date, personal_document_type, personal_document_number, company_name, business_niche, product_type, products_description, address, custom_pix_fixed_fee, custom_pix_percent_fee, custom_card_fixed_fee, custom_card_percent_fee, custom_stripe_fixed_fee, custom_stripe_percent_fee, custom_card_withdrawal_days, custom_stripe_withdrawal_days, is_blocked, blocked_reason, blocked_at, approved_at, rejected_at, rejection_reason, device_fingerprint, registration_ip, accepted_data_tracking, data_tracking_consent_date, data_tracking_consent_version, device_history, accepted_terms, terms_accepted_at, profile_complete, verification_submitted_at, acquirer_config, acquirers, document_type FROM sellers ORDER BY created_at DESC`;
    }, 'adminAllSellers');
    
    console.log(`👑 Sellers encontrados no Neon: ${sellers.length}`);
    
    const facialVerificationMap = new Map<string, string>();
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT email, bunny_url FROM facial_verification_logs WHERE bunny_url IS NOT NULL`;
      for (const r of rows) {
        if (r.email) facialVerificationMap.set(r.email.toLowerCase(), r.bunny_url);
      }
    }, 'facialLogs').catch(() => {});

    console.log(`🎥 Vídeos de verificação facial encontrados: ${facialVerificationMap.size}`);
    
    const formattedSellers = sellers.map((seller: any) => {
      const sellerEmail = (seller.email || '').toLowerCase();
      const facialVideoUrl = facialVerificationMap.get(sellerEmail) || seller.facial_verification || null;
      
      return {
      id: seller.id,
      email: seller.email || 'N/A',
      businessName: seller.business_name || seller.company_name || 'Nome não informado',
      status: seller.status || 'pending',
      createdAt: seller.created_at,
      tenantId: seller.tenant_id,
      document: seller.document || null,
      isApproved: seller.status === 'approved',
      facialVerification: facialVideoUrl,
      documentsUrls: seller.documents_urls || null,
      profilePhoto: seller.profile_photo || null,
      photoURL: seller.photo_url || null,
      name: seller.name || null,
      fullName: seller.name || null,
      phone: seller.phone || null,
      birthDate: seller.birth_date || null,
      personalDocumentType: seller.personal_document_type || null,
      personalDocumentNumber: seller.personal_document_number || null,
      cnpj: seller.document || null,
      documentType: seller.document_type || null,
      businessNiche: seller.business_niche || null,
      productType: seller.product_type || null,
      productsDescription: seller.products_description || null,
      address: seller.address || null,
      customPixFixedFee: seller.custom_pix_fixed_fee ?? null,
      customPixPercentFee: seller.custom_pix_percent_fee ?? null,
      customCardFixedFee: seller.custom_card_fixed_fee ?? null,
      customCardPercentFee: seller.custom_card_percent_fee ?? null,
      customStripeFixedFee: seller.custom_stripe_fixed_fee ?? null,
      customStripePercentFee: seller.custom_stripe_percent_fee ?? null,
      customCardWithdrawalDays: seller.custom_card_withdrawal_days ?? null,
      customStripeWithdrawalDays: seller.custom_stripe_withdrawal_days ?? null,
      isBlocked: seller.is_blocked || false,
      blockedReason: seller.blocked_reason || null,
      blockedAt: seller.blocked_at || null,
      approvedAt: seller.approved_at || null,
      rejectedAt: seller.rejected_at || null,
      rejectionReason: seller.rejection_reason || null,
      deviceFingerprint: seller.device_fingerprint ||
                        (seller.device_history && seller.device_history.length > 0
                          ? seller.device_history[seller.device_history.length - 1]?.deviceFingerprint
                          : null),
      registrationIP: seller.registration_ip ||
                     (seller.device_history && seller.device_history.length > 0
                       ? seller.device_history[0]?.ip
                       : null),
      acceptedDataTracking: seller.accepted_data_tracking || false,
      dataTrackingConsentDate: seller.data_tracking_consent_date || null,
      dataTrackingConsentVersion: seller.data_tracking_consent_version || null,
      deviceHistory: seller.device_history || [],
      acceptedTerms: seller.accepted_terms !== false,
      termsAcceptedAt: seller.terms_accepted_at || seller.created_at || null,
      profileComplete: seller.profile_complete || false,
      companyName: seller.company_name || null,
      verificationSubmittedAt: seller.verification_submitted_at || null,
      acquirerConfig: seller.acquirer_config || {},
      acquirers: seller.acquirers || {},
      financialSettings: {},
    }});

    console.log(`✅ Retornando ${formattedSellers.length} sellers formatados para admin`);
    
    res.json({
      success: true,
      sellers: formattedSellers,
      total: formattedSellers.length
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar sellers para admin:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message,
      code: 'GET_SELLERS_ERROR'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 21B: GET /api/admin/pre-registros - Usuários registrados sem docs enviados
// Cruza Firebase Auth com Firestore para encontrar quem registrou mas não enviou docs
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/admin/pre-registros', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📋 GET /api/admin/pre-registros - Admin:', req.user?.email);

    await ensureFirebaseReady();
    const adminSdk = getAdmin();

    // 1. Buscar todos os usuários do Firebase Auth
    let allAuthUsers: any[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const listResult = await adminSdk.auth().listUsers(1000, pageToken);
      allAuthUsers = allAuthUsers.concat(listResult.users);
      pageToken = listResult.pageToken;
    } while (pageToken);

    console.log(`👥 Firebase Auth: ${allAuthUsers.length} usuários totais`);

    // 2. Buscar todos os sellers do Neon para cross-reference
    let sellers: any[] = [];
    await neonQuery(async (sql) => {
      sellers = await sql`SELECT id, name, business_name, phone, status, document, profile_complete FROM sellers`;
    }, 'preRegistrosSellers').catch(() => {});
    const sellerByUid = new Map<string, any>(sellers.map((s: any) => [s.id, s]));

    console.log(`🗃️ Neon sellers: ${sellers.length}`);

    // 3. Filtrar: pré-registros = Auth users que NÃO completaram o perfil
    const preRegistros = allAuthUsers
      .filter(u => {
        const claims = u.customClaims || {};
        if (claims.admin || claims.superAdmin) return false;
        if (!u.email) return false;
        const seller = sellerByUid.get(u.uid);
        return !seller || !seller.profile_complete;
      })
      .map(u => {
        const seller = sellerByUid.get(u.uid);
        return {
          id: u.uid,
          email: u.email || '',
          name: u.displayName || seller?.name || seller?.business_name || '',
          phone: seller?.phone || '',
          createdAt: u.metadata.creationTime || null,
          emailVerified: u.emailVerified || false,
          hasSellerDoc: !!seller,
          profileComplete: false,
          status: seller?.status || 'pre-registro',
          businessName: seller?.business_name || seller?.name || '',
          document: seller?.document || '',
        };
      })
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

    console.log(`📋 Pré-registros encontrados: ${preRegistros.length}`);

    res.json({
      success: true,
      preRegistros,
      total: preRegistros.length,
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar pré-registros:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message,
      code: 'PRE_REGISTROS_ERROR'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 22: GET /api/sellers/:sellerId/public - Public seller info
// ═══════════════════════════════════════════════════════════════════════════════
// ─── GET /api/sellers/:sellerId/products (public products for a seller) ──────
sellersRouter.get('/api/sellers/:sellerId/products', async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId } = req.params;

    let products: any[] = [];
    await neonQuery(async (sql) => {
      products = await sql`
        SELECT id, title, name, description, price, currency, image_url, category, type, active, created_at
        FROM products
        WHERE tenant_id = ${sellerId} AND (deleted = FALSE OR deleted IS NULL) AND active = TRUE
        ORDER BY created_at DESC LIMIT 100
      `;
    }, `sellerPublicProducts:${sellerId}`);

    if (!products.length) {
      let checkoutProducts: any[] = [];
      await neonQuery(async (sql) => {
        checkoutProducts = await sql`
          SELECT id, title, subtitle AS description, logo_url AS image_url, pricing, active, created_at
          FROM checkouts
          WHERE tenant_id = ${sellerId} AND (deleted = FALSE OR deleted IS NULL) AND active = TRUE
          ORDER BY created_at DESC LIMIT 50
        `;
      }, `sellerCheckoutProducts:${sellerId}`);

      const mapped = checkoutProducts.map((c: any) => ({
        id: c.id,
        title: c.title || 'Produto',
        description: c.description || '',
        imageUrl: c.image_url || null,
        price: c.pricing?.amount || 0,
        currency: 'BRL',
        active: c.active,
        createdAt: c.created_at,
      }));
      return res.json({ products: mapped, total: mapped.length, source: 'checkouts' });
    }

    const mapped = products.map((p: any) => ({
      id: p.id,
      title: p.title || p.name || 'Produto',
      description: p.description || '',
      imageUrl: p.image_url || null,
      price: p.price || 0,
      currency: p.currency || 'BRL',
      category: p.category || null,
      type: p.type || null,
      active: p.active,
      createdAt: p.created_at,
    }));

    res.json({ products: mapped, total: mapped.length, source: 'products' });
  } catch (error: any) {
    console.error('❌ GET /api/sellers/:sellerId/products error:', error?.message);
    res.status(500).json({ error: error?.message || 'Erro interno' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
sellersRouter.get('/api/sellers/:sellerId/public', async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId } = req.params;
    
    console.log(`🔍 Buscando dados públicos do seller: ${sellerId}`);
    
    let seller: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, business_name, email, status FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (rows[0]) seller = rows[0];
    }, `publicSeller:${sellerId}`);
    
    if (!seller) {
      console.log(`❌ Seller não encontrado: ${sellerId}`);
      return res.status(404).json({ error: 'Seller não encontrado' });
    }
    
    const publicData = {
      id: seller.id,
      businessName: seller.business_name || 'Vendedor',
      email: seller.email || 'sem-email@example.com',
      status: seller.status
    };
    
    console.log(`✅ Dados públicos do seller: ${publicData.businessName}`);
    res.json(publicData);
    
  } catch (error) {
    console.error('❌ Erro ao buscar dados públicos do seller:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 23: PATCH /api/sellers/:sellerId/display-name - Update display name
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.patch('/api/sellers/:sellerId/display-name', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { sellerId } = req.params;
    const { businessName } = req.body;
    
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const isAdmin = user.customClaims?.admin === true;
    const isOwnProfile = user.uid === sellerId;
    
    if (!isAdmin && !isOwnProfile) {
      console.error(`🚨 IDOR BLOQUEADO: User ${user.uid} tentando atualizar businessName do seller ${sellerId}`);
      return res.status(403).json({ error: 'Acesso negado - você só pode atualizar seu próprio perfil' });
    }
    
    if (!businessName || typeof businessName !== 'string' || !businessName.trim()) {
      return res.status(400).json({ error: 'Nome de exibição é obrigatório' });
    }
    
    await neonQuery(async (sql) => {
      await sql`UPDATE sellers SET business_name = ${businessName.trim()}, updated_at = NOW() WHERE id = ${sellerId}`;
    }, `updateDisplayName:${sellerId}`);

    console.log(`✅ Nome de exibição atualizado para seller ${sellerId}: ${businessName}`);
    res.json({ success: true, businessName: businessName.trim() });
    
  } catch (error) {
    console.error('❌ Erro ao atualizar nome de exibição:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 24: GET /api/sellers/:sellerId - Get seller by id
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/sellers/:sellerId', verifyFirebaseToken, async (req: AuthenticatedRequest, res, next) => {
  try {
    let { sellerId } = req.params;
    const userUid = req.user?.uid;

    // Reserved paths — let specific routes handle them
    if (sellerId === 'banking-data' || sellerId === 'push-token') {
      return next();
    }
    
    if (sellerId === 'me') {
      sellerId = userUid!;
    }
    
    console.log(`🔍 Buscando seller: ${sellerId} (requestor: ${userUid})`);
    
    if (userUid !== sellerId) {
      const isAdmin = req.authUser?.isAdmin;
      
      if (!isAdmin) {
        console.log(`❌ Acesso negado: ${userUid} tentou acessar seller ${sellerId}`);
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }
    
    let sellerData: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      if (rows[0]) sellerData = rows[0];
    }, `getSeller:${sellerId}`);

    if (!sellerData) {
      console.log(`❌ Seller não encontrado: ${sellerId}`);
      return res.status(404).json({ error: 'Seller não encontrado' });
    }
    
    const isAdmin = req.authUser?.isAdmin;
    const isOwnerOrAdmin = userUid === sellerId || isAdmin;
    
    if (isOwnerOrAdmin) {
      const { password, passwordHistory, ...safeSeller } = sellerData as any;
      res.json(safeSeller);
    } else {
      res.json({ id: sellerData.id, businessName: sellerData.businessName, status: sellerData.status });
    }
    
  } catch (error) {
    console.error('❌ Erro ao buscar seller:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 25: GET /api/sellers/by-tenant/:tenantId - Get seller by tenant
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/sellers/by-tenant/:tenantId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId } = req.params;
    const userTenant = await getTenantFromAuth(req);
    
    console.log(`🔍 Buscando seller por tenant: ${tenantId} (requestor: ${userTenant})`);
    
    const isAdmin = req.authUser?.isAdmin;
    
    if (userTenant !== tenantId && !isAdmin) {
      console.log(`❌ Acesso negado: tentou acessar tenant ${tenantId}`);
      return res.status(403).json({ error: 'Acesso negado ao tenant' });
    }
    
    let seller: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT * FROM sellers WHERE id = ${tenantId} LIMIT 1`;
      if (rows[0]) seller = rows[0];
    }, `sellerByTenant:${tenantId}`);
    
    if (!seller) {
      console.log(`❌ Seller não encontrado para tenant: ${tenantId}`);
      return res.status(404).json({ error: 'Seller não encontrado' });
    }
    
    const { password, password_history, ...safeSeller } = seller as any;
    console.log(`✅ Seller encontrado por tenant: ${seller.email || seller.id}`);
    res.json(safeSeller);
    
  } catch (error) {
    console.error('❌ Erro ao buscar seller por tenant:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 26: GET /api/seller/affiliate-sales - Seller's affiliate sales
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/seller/affiliate-sales', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user.uid;

    console.log(`📊 BUSCANDO VENDAS DOS AFILIADOS DO SELLER: ${sellerId}`);

    let commissions: any[] = [];
    await neonQuery(async (sql) => {
      commissions = await sql`SELECT id, net_amount, amount, payment_method, status, affiliate_id, created_at FROM affiliate_commissions WHERE seller_id = ${sellerId}`;
    }, `affiliateSales:${sellerId}`);

    let totalSales = 0;
    let totalCommissionsPaid = 0;
    let totalCommissionsPending = 0;
    let totalByMethod = { pix: 0, credit_card: 0, boleto: 0 };
    let commissionsByMethod = { pix: 0, credit_card: 0, boleto: 0 };
    let salesByAffiliate: Record<string, number> = {};

    commissions.forEach((commission: any) => {
      const netAmount = commission.net_amount || commission.amount || 0;
      const method = commission.payment_method || 'pix';
      totalSales++;
      if (commission.status === 'paid') totalCommissionsPaid += netAmount;
      else if (commission.status === 'pending') totalCommissionsPending += netAmount;
      if (method === 'pix' || method === 'credit_card' || method === 'boleto') {
        totalByMethod[method]++;
        commissionsByMethod[method] += netAmount;
      }
      const affiliateId = commission.affiliate_id || 'unknown';
      salesByAffiliate[affiliateId] = (salesByAffiliate[affiliateId] || 0) + 1;
    });

    const stats = {
      totalSales,
      totalCommissionsPaid,
      totalCommissionsPending,
      totalCommissionsAmount: totalCommissionsPaid + totalCommissionsPending,
      salesByMethod: totalByMethod,
      commissionsByMethod,
      topAffiliates: Object.entries(salesByAffiliate)
        .map(([affiliateId, sales]) => ({ affiliateId, sales }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 5),
      recentCommissions: commissions
        .sort((a: any, b: any) => {
          const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
          const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
          return dateB.getTime() - dateA.getTime();
        })
        .slice(0, 10)
    };

    console.log(`✅ ${totalSales} vendas de afiliados encontradas`);

    res.json(stats);

  } catch (error) {
    console.error('❌ Erro ao buscar vendas de afiliados:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 27: POST /api/seller/cleanup-failed-orders - Cleanup failed orders
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/seller/cleanup-failed-orders', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user.uid;
    console.log(`🧹 SELLER: ${sellerId} limpando vendas falhadas...`);
    
    await ensureFirebaseReady();
    const db = (storage as any).db;
    
    if (!db) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }
    
    const { timePeriod, productType, dryRun = true } = req.body;
    
    if (!['1h', '24h', '7d', 'all'].includes(timePeriod)) {
      return res.status(400).json({ error: 'Período inválido. Use: 1h, 24h, 7d ou all' });
    }
    
    if (!['digital', 'subscription', 'all'].includes(productType)) {
      return res.status(400).json({ error: 'Tipo de produto inválido. Use: digital, subscription ou all' });
    }
    
    console.log(`📊 Filtros: Período=${timePeriod}, Tipo=${productType}, DryRun=${dryRun}`);
    
    let startDate: Date;
    const now = new Date();
    
    switch (timePeriod) {
      case '1h':
        startDate = new Date(now.getTime() - 1 * 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        startDate = new Date(0);
        break;
    }
    
    let orders: any[] = [];
    await neonQuery(async (sql) => {
      orders = productType === 'all'
        ? await sql`SELECT id, status, product_type, amount FROM orders WHERE tenant_id = ${sellerId} AND status = ANY(ARRAY['failed','cancelled','expired']) AND created_at >= ${startDate}`
        : await sql`SELECT id, status, product_type, amount FROM orders WHERE tenant_id = ${sellerId} AND status = ANY(ARRAY['failed','cancelled','expired']) AND product_type = ${productType} AND created_at >= ${startDate}`;
    }, `cleanupFailedOrders:${sellerId}`);

    console.log(`📦 Encontradas ${orders.length} vendas falhadas`);

    if (orders.length === 0) {
      return res.json({ success: true, message: 'Nenhuma venda falhada encontrada', statistics: { found: 0, deleted: 0, timePeriod, productType } });
    }

    const stats = { total: orders.length, byStatus: {} as Record<string, number>, byType: {} as Record<string, number>, totalAmount: 0 };
    for (const o of orders) {
      stats.byStatus[o.status] = (stats.byStatus[o.status] || 0) + 1;
      stats.byType[o.product_type || 'unknown'] = (stats.byType[o.product_type || 'unknown'] || 0) + 1;
      stats.totalAmount += o.amount || 0;
    }

    if (dryRun) {
      return res.json({ success: true, dryRun: true, message: `Preview: ${stats.total} vendas falhadas seriam removidas`, statistics: { found: stats.total, deleted: 0, timePeriod, productType, byStatus: stats.byStatus, byType: stats.byType, totalAmount: stats.totalAmount } });
    }

    let deletedCount = 0;
    await neonQuery(async (sql) => {
      const ids = orders.map((o: any) => o.id);
      const result = await sql`DELETE FROM orders WHERE id = ANY(${ids}) AND tenant_id = ${sellerId}`;
      deletedCount = ids.length;
    }, `deleteFailedOrders:${sellerId}`);

    console.log(`✅ ${deletedCount} vendas falhadas removidas!`);
    res.json({ success: true, message: `${deletedCount} vendas falhadas removidas com sucesso!`, statistics: { found: stats.total, deleted: deletedCount, timePeriod, productType, byStatus: stats.byStatus, byType: stats.byType, totalAmount: stats.totalAmount } });
    
  } catch (error: any) {
    console.error('❌ Erro ao limpar vendas falhadas:', error);
    res.status(500).json({
      error: 'Erro ao limpar vendas falhadas',
      details: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 28: POST /api/sellers/autocreate - Auto-create seller
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.post('/api/sellers/autocreate', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user?.uid || !req.user?.email) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado' });
    }

    let autoDefaultAcquirers = { pix: 'efibank', creditCardBR: 'efibank', creditCardGlobal: 'stripe' };
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT default_acquirers FROM payment_config WHERE id = 'global' LIMIT 1`;
      if (rows[0]?.default_acquirers) {
        const da = rows[0].default_acquirers;
        autoDefaultAcquirers = { pix: da.pix || 'efibank', creditCardBR: da.creditCardBR || da.creditCard || 'efibank', creditCardGlobal: da.creditCardGlobal || 'stripe' };
      }
    }, 'paymentConfigGlobal').catch(() => {});

    const adminEmails = (process.env.ADMIN_EMAIL || '').split(',').map((e: string) => e.trim()).filter(Boolean);
    const isAdminEmail = adminEmails.length > 0 && adminEmails.includes(req.user!.email.toLowerCase());
    const bodyName = req.body?.name || '';
    const bodyPhone = req.body?.phone || '';
    const bodyAccountType = req.body?.accountType || 'seller';
    const { pix: pixAcq, creditCardBR: cardBRAcq, creditCardGlobal: cardGlobalAcq } = autoDefaultAcquirers;

    let result: any = null;
    await neonQuery(async (sql) => {
      const existing = await sql`SELECT id, email, name, status FROM sellers WHERE id = ${req.user!.uid} LIMIT 1`;
      if (existing[0]) {
        result = { success: true, message: 'Seller já existe', seller: existing[0], created: false };
        return;
      }
      const acquirerConfig = {
        pixEnabled: true, pixAcquirer: pixAcq, brazilianCardEnabled: true, brazilianCardAcquirer: cardBRAcq,
        globalCardEnabled: false, globalCardAcquirer: cardGlobalAcq,
        efibank: { enabled: pixAcq === 'efibank' || cardBRAcq === 'efibank' },
        stripe: { enabled: cardGlobalAcq === 'stripe' },
      };
      const newSeller = {
        id: req.user!.uid, email: req.user!.email, name: bodyName || req.user!.email.split('@')[0],
        status: 'pending', profile_complete: false,
        company_name: '', document: '', document_type: '', phone: bodyPhone || null,
        accepted_terms: true, is_approved: isAdminEmail,
        approved_at: isAdminEmail ? new Date() : null, approved_by: isAdminEmail ? 'system-autocreate' : null,
        acquirer_config: JSON.stringify(acquirerConfig),
      };
      await sql`
        INSERT INTO sellers (id, email, name, status, profile_complete, company_name, document, document_type, phone, accepted_terms, is_approved, approved_at, approved_by, acquirer_config, created_at, updated_at)
        VALUES (${newSeller.id}, ${newSeller.email}, ${newSeller.name}, ${newSeller.status}, ${newSeller.profile_complete}, ${newSeller.company_name}, ${newSeller.document}, ${newSeller.document_type}, ${newSeller.phone}, ${newSeller.accepted_terms}, ${newSeller.is_approved}, ${newSeller.approved_at}, ${newSeller.approved_by}, ${newSeller.acquirer_config}, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `;
      result = { success: true, message: isAdminEmail ? 'Seller admin auto-aprovado' : 'Seller criado (aprovação pendente)', seller: newSeller, created: true };
    }, `autocreate:${req.user!.uid}`);

    if (result?.created) {
      console.log(`✅ Seller auto-criado no Neon: ${result.seller.email} (${req.user.uid})`);
      if (!isAdminEmail) {
        const adminEmailAddr = process.env.ADMIN_EMAIL;
        if (adminEmailAddr) {
          sendNewSellerPendingEmail(adminEmailAddr, {
            name: result.seller.name, email: result.seller.email,
            businessName: '', businessNiche: '', document: '',
          }).catch(e => console.warn('[AUTOCREATE] Erro ao notificar admin:', e?.message));
        }
      }
    }
    
    return res.status(result?.created ? 201 : 200).json(result);

  } catch (error: any) {
    console.error('❌ Erro ao auto-criar seller:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 📋 GET /api/seller/refunds - Listar reembolsos do seller autenticado
sellersRouter.get('/api/seller/refunds', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const sellerId = user.uid;
    const { status } = req.query;

    let refunds: any[] = [];
    await neonQuery(async (sql) => {
      const rows = status && status !== 'all'
        ? await sql`SELECT * FROM refunds WHERE (seller_id = ${sellerId} OR tenant_id = ${sellerId}) AND status = ${String(status)} ORDER BY created_at DESC LIMIT 100`
        : await sql`SELECT * FROM refunds WHERE (seller_id = ${sellerId} OR tenant_id = ${sellerId}) ORDER BY created_at DESC LIMIT 100`;
      refunds = rows;
    }, `sellerRefunds:${sellerId}`);

    return res.json(refunds);
  } catch (error: any) {
    console.error('❌ Erro ao listar reembolsos do seller:', error);
    return res.status(500).json({ error: 'Erro ao listar reembolsos' });
  }
});

// ✅ POST /api/seller/refunds/:id/approve - Seller aprova reembolso
sellersRouter.post('/api/seller/refunds/:id/approve', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const sellerId = user.uid;
    const refundId = req.params.id;

    await neonQuery(async (sql) => {
      const refRows = await sql`SELECT id, seller_id, tenant_id, status, refund_amount, amount, payment_method, gateway, order_id, customer_id, customer_email, customer_name, product_title FROM refunds WHERE id = ${refundId} LIMIT 1`;
      if (!refRows[0]) throw new Error('REFUND_NOT_FOUND');
      const refundData = refRows[0];
      if (refundData.seller_id !== sellerId && refundData.tenant_id !== sellerId) throw new Error('ACCESS_DENIED');
      if (refundData.status !== 'pending') throw new Error(`ALREADY_${refundData.status}`);

      const refundAmount = refundData.refund_amount || refundData.amount || 0;
      if (!refundAmount) throw new Error('INVALID_AMOUNT');

      const effectiveSellerId = refundData.seller_id || refundData.tenant_id;
      let resolvedPaymentMethod = refundData.payment_method;
      let resolvedGateway = refundData.gateway;
      if (!resolvedPaymentMethod && refundData.order_id) {
        const oRows = await sql`SELECT method, payment_method, gateway FROM orders WHERE id = ${refundData.order_id} LIMIT 1`;
        if (oRows[0]) { resolvedPaymentMethod = oRows[0].method || oRows[0].payment_method || 'pix'; resolvedGateway = oRows[0].gateway; }
      }
      const isCard = resolvedPaymentMethod === 'card' || resolvedPaymentMethod === 'credit_card';
      const debitSource = isCard ? ((resolvedGateway === 'stripe' || resolvedGateway === 'adyen') ? 'cardGlobal' : 'cardBR') : 'pix';

      const sellerRows = await sql`SELECT id, withdrawal_balance, business_name, name FROM sellers WHERE id = ${effectiveSellerId} LIMIT 1`;
      const sellerBalance = sellerRows[0]?.withdrawal_balance || 0;
      const newBalance = sellerBalance - refundAmount;

      const refundBalanceId = `refund_${refundId}`;
      const existingRb = await sql`SELECT id FROM refund_balances WHERE id = ${refundBalanceId} LIMIT 1`;
      if (!existingRb[0]) {
        await sql`UPDATE refunds SET status = 'approved', approved_at = NOW(), approved_by = ${sellerId}, seller_response = ${req.body.reason || 'Aprovado pelo vendedor'}, updated_at = NOW() WHERE id = ${refundId}`;
        await sql`UPDATE sellers SET withdrawal_balance = ${newBalance}, negative_balance = ${newBalance < 0}, negative_balance_amount = ${newBalance < 0 ? Math.abs(newBalance) : 0}, updated_at = NOW() WHERE id = ${effectiveSellerId}`;
        await sql`INSERT INTO refund_balances (id, customer_id, customer_email, customer_name, refund_id, amount, product_title, seller_name, seller_id, status, approved_at, created_at, updated_at) VALUES (${refundBalanceId},${refundData.customer_id},${refundData.customer_email || ''},${refundData.customer_name || ''},${refundId},${refundAmount},${refundData.product_title || 'Produto'},${sellerRows[0]?.business_name || sellerRows[0]?.name || 'Seller'},${effectiveSellerId},'available',NOW(),NOW(),NOW()) ON CONFLICT (id) DO NOTHING`;
        const debitId = `refund_debit_${refundId}_${Date.now()}`;
        await sql`INSERT INTO refund_debits (id, type, tenant_id, refund_id, amount, method, source, auto_approved, approved_by, previous_balance, new_balance, created_at) VALUES (${debitId},'refund_debit',${effectiveSellerId},${refundId},${refundAmount},${isCard ? 'card' : 'pix'},${debitSource},FALSE,${sellerId},${sellerBalance},${newBalance},NOW()) ON CONFLICT (id) DO NOTHING`;
      }
    }, `approveRefund:${refundId}`);

    console.log(`✅ [SELLER-APPROVE] Seller ${user.email} aprovou reembolso ${refundId}`);

    return res.json({
      success: true,
      message: 'Reembolso aprovado com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao aprovar reembolso (seller):', error);
    return res.status(500).json({ error: 'Erro ao aprovar reembolso' });
  }
});

// ❌ POST /api/seller/refunds/:id/reject - Seller rejeita reembolso
sellersRouter.post('/api/seller/refunds/:id/reject', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const sellerId = user.uid;
    const refundId = req.params.id;
    const { reason } = req.body;

    await neonQuery(async (sql) => {
      const refRows = await sql`SELECT id, seller_id, tenant_id, status, product_id, customer_id, customer_email, order_id FROM refunds WHERE id = ${refundId} LIMIT 1`;
      if (!refRows[0]) throw new Error('REFUND_NOT_FOUND');
      const refundData = refRows[0];
      if (refundData.seller_id !== sellerId && refundData.tenant_id !== sellerId) throw new Error('ACCESS_DENIED');
      if (refundData.status !== 'pending') throw new Error(`ALREADY_${refundData.status}`);

      await sql`UPDATE refunds SET status = 'rejected', rejected_at = NOW(), rejected_by = ${sellerId}, rejected_by_email = ${user.email}, seller_response = ${reason || 'Rejeitado pelo vendedor'}, rejection_reason = ${reason || 'Sem motivo informado'}, updated_at = NOW() WHERE id = ${refundId}`;

      if (refundData.product_id && refundData.customer_id) {
        await sql`UPDATE enrollments SET status = 'active', updated_at = NOW() WHERE product_id = ${refundData.product_id} AND customer_email = ${refundData.customer_email} AND status != 'active'`;
      }
      if (refundData.order_id) {
        await sql`UPDATE orders SET refund_id = NULL, updated_at = NOW() WHERE id = ${refundData.order_id}`;
      }
    }, `rejectRefund:${refundId}`);

    console.log(`❌ [SELLER-REJECT] Seller ${user.email} rejeitou reembolso ${refundId}`);

    return res.json({
      success: true,
      message: 'Reembolso rejeitado com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao rejeitar reembolso (seller):', error);
    return res.status(500).json({ error: 'Erro ao rejeitar reembolso' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE: GET /api/sellers/banking-data - Get seller banking data
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/sellers/banking-data', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    let bankingData: any = {};
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT banking_data FROM sellers WHERE id = ${user.uid} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      bankingData = rows[0].banking_data || {};
    }, `getBankingData:${user.uid}`);
    res.json({ bankingData });
  } catch (error) {
    console.error('❌ Erro ao buscar dados bancários:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE: PUT /api/sellers/banking-data - Save seller banking data
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.put('/api/sellers/banking-data', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const { holderName, holderDocument, bankName, bankCode, agency, accountNumber, accountType, pixKeyType, pixKey } = req.body;

    if (!holderName || typeof holderName !== 'string' || !holderName.trim()) {
      return res.status(400).json({ error: 'Nome do titular é obrigatório' });
    }

    const validPixKeyTypes = ['cpf', 'cnpj', 'email', 'phone', 'random'];
    if (pixKeyType && !validPixKeyTypes.includes(pixKeyType)) {
      return res.status(400).json({ error: 'Tipo de chave PIX inválido' });
    }

    const validAccountTypes = ['corrente', 'poupanca'];
    if (accountType && !validAccountTypes.includes(accountType)) {
      return res.status(400).json({ error: 'Tipo de conta inválido' });
    }

    const bankingData = {
      holderName: (holderName || '').trim(),
      holderDocument: (holderDocument || '').trim(),
      bankName: (bankName || '').trim(),
      bankCode: (bankCode || '').trim(),
      agency: (agency || '').trim(),
      accountNumber: (accountNumber || '').trim(),
      accountType: accountType || 'corrente',
      pixKeyType: pixKeyType || '',
      pixKey: (pixKey || '').trim(),
      updatedAt: new Date().toISOString(),
    };

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id FROM sellers WHERE id = ${user.uid} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      await sql`UPDATE sellers SET banking_data = ${JSON.stringify(bankingData)}, updated_at = NOW() WHERE id = ${user.uid}`;
    }, `saveBankingData:${user.uid}`);

    console.log(`✅ Dados bancários atualizados para seller ${user.uid}`);
    res.json({ success: true, bankingData });
  } catch (error) {
    console.error('❌ Erro ao salvar dados bancários:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

sellersRouter.post('/api/sellers/push-token', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { token } = req.body;

    if (!token || typeof token !== 'string' || token.length < 20 || token.length > 500) {
      return res.status(400).json({ error: 'Token FCM inválido' });
    }

    let pushTokens: string[] = [];
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT push_tokens FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      pushTokens = rows[0].push_tokens || [];
      if (pushTokens.includes(token)) return;
      pushTokens.push(token);
      if (pushTokens.length > 5) pushTokens = pushTokens.slice(-5);
      await sql`UPDATE sellers SET push_tokens = ${JSON.stringify(pushTokens)}, push_token_updated_at = NOW(), updated_at = NOW() WHERE id = ${userId}`;
    }, `addPushToken:${userId}`);

    if (pushTokens.includes(token) && pushTokens.indexOf(token) >= 0) {
      // already existed — check if it was there before or just added; either way OK
    }
    console.log(`Push token registrado para seller ${userId.substring(0, 8)}... (${pushTokens.length} tokens)`);

    return res.json({ success: true, message: 'Token registrado com sucesso' });
  } catch (error: any) {
    console.error('Erro ao salvar push token:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

sellersRouter.delete('/api/sellers/push-token', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token FCM inválido' });
    }

    await neonQuery(async (sql) => {
      const rows = await sql`SELECT push_tokens FROM sellers WHERE id = ${userId} LIMIT 1`;
      if (!rows[0]) throw new Error('SELLER_NOT_FOUND');
      const pushTokens: string[] = (rows[0].push_tokens || []).filter((t: string) => t !== token);
      await sql`UPDATE sellers SET push_tokens = ${JSON.stringify(pushTokens)}, push_token_updated_at = NOW(), updated_at = NOW() WHERE id = ${userId}`;
    }, `removePushToken:${userId}`);

    console.log(`Push token removido para seller ${userId.substring(0, 8)}...`);

    return res.json({ success: true, message: 'Token removido com sucesso' });
  } catch (error: any) {
    console.error('Erro ao remover push token:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/sellers/push-token/status — retorna status do push para o seller atual
sellersRouter.get('/api/sellers/push-token/status', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUser?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    let pushTokens: string[] = [];
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT push_tokens FROM sellers WHERE id = ${userId} LIMIT 1`;
      pushTokens = rows[0]?.push_tokens || [];
    }, `pushTokenStatus:${userId}`);

    return res.json({
      tokenCount: pushTokens.length,
      hasTokens: pushTokens.length > 0,
      tokens: pushTokens.map((t: string) => t.slice(0, 20) + '...'),
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/sellers/push-token/test — dispara notificação de teste para os tokens do seller
sellersRouter.post('/api/sellers/push-token/test', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUser?.uid;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const admin = getAdmin();

    let pushTokens: string[] = [];
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT push_tokens FROM sellers WHERE id = ${userId} LIMIT 1`;
      pushTokens = rows[0]?.push_tokens || [];
    }, `pushTokenTest:${userId}`);

    if (pushTokens.length === 0) {
      return res.status(400).json({
        error: 'Nenhum token push registrado',
        hint: 'Abra o app no iPhone pelo ícone da tela de início e aceite a permissão de notificações.'
      });
    }

    const BASE = 'https://volatuspay.com';
    const message: any = {
      tokens: pushTokens,
      notification: {
        title: '🎉 Venda Aprovada!',
        body: 'João Silva comprou Produto Digital — R$ 97,00',
      },
      webpush: {
        notification: {
          icon: `${BASE}/favicon.png`,
          badge: `${BASE}/favicon.png`,
          tag: 'test-push-' + Date.now(),
          requireInteraction: true,
          vibrate: [200, 100, 200],
          actions: [{ action: 'open', title: 'Ver Detalhes' }],
        },
        fcmOptions: { link: `${BASE}/dashboard/sales` },
      },
      android: {
        priority: 'high',
        notification: { channelId: 'sales', priority: 'max', defaultVibrateTimings: true },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      },
      data: {
        orderId: 'test-' + Date.now(),
        click_action: `${BASE}/dashboard/sales`,
        amount: '9700',
        productName: 'Produto Digital',
        customerName: 'João Silva',
        isTest: 'true',
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[PUSH TEST] Seller ${userId.slice(0, 8)}: ${response.successCount} ok, ${response.failureCount} fail`);

    const results = response.responses.map((r: any, i: number) => ({
      token: pushTokens[i].slice(0, 20) + '...',
      success: r.success,
      error: r.error?.message || null,
    }));

    return res.json({
      success: response.successCount > 0,
      sent: response.successCount,
      failed: response.failureCount,
      results,
    });
  } catch (error: any) {
    console.error('[PUSH TEST] Erro:', error);
    return res.status(500).json({ error: 'Erro ao enviar notificação de teste: ' + error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// 🔐 TOTP 2FA — GOOGLE AUTHENTICATOR
// ══════════════════════════════════════════════════════════════════════

sellersRouter.post('/api/seller/totp/setup', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    const email = req.authUser?.email;
    if (!uid || !email) return res.status(401).json({ error: 'Não autenticado' });

    const { generateTOTPSetup } = await import('../lib/seller-totp.js');
    const setup = await generateTOTPSetup(uid, email);
    return res.json({ success: true, ...setup });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

sellersRouter.post('/api/seller/totp/confirm', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código obrigatório' });

    const { confirmTOTPSetup } = await import('../lib/seller-totp.js');
    const result = await confirmTOTPSetup(uid, code);
    return result.success ? res.json(result) : res.status(400).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

sellersRouter.post('/api/seller/totp/verify', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código obrigatório' });

    const { verifyTOTPCode } = await import('../lib/seller-totp.js');
    const result = await verifyTOTPCode(uid, code);
    return result.success ? res.json(result) : res.status(400).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

sellersRouter.delete('/api/seller/totp', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    const { disableTOTP } = await import('../lib/seller-totp.js');
    const result = await disableTOTP(uid);
    return result.success ? res.json(result) : res.status(400).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

sellersRouter.get('/api/seller/totp/status', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    const { isTOTPEnabled } = await import('../lib/seller-totp.js');
    const enabled = await isTOTPEnabled(uid);
    return res.json({ enabled });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

sellersRouter.post('/api/seller/totp/backup-codes/regenerate', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    const { regenerateTOTPBackupCodes } = await import('../lib/seller-totp.js');
    const result = await regenerateTOTPBackupCodes(uid);
    return result.success ? res.json(result) : res.status(400).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// 🚫 INVALIDAÇÃO DE SESSÕES — CHAMADO APÓS TROCA DE SENHA NO CLIENTE
// ══════════════════════════════════════════════════════════════════════

sellersRouter.post('/api/seller/password-changed', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    const { revokeAllSessions } = await import('../lib/session-revocation.js');
    const result = await revokeAllSessions(uid, 'password_change');

    if (result.success) {
      console.log(`🔐 [SESSION] Sessões revogadas após troca de senha — UID: ${uid.slice(0, 8)}...`);
      return res.json({ success: true, message: 'Todas as sessões foram encerradas. Faça login novamente.' });
    }
    return res.status(500).json({ success: false, error: result.error });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/seller/profile - Retorna name + businessName do seller autenticado
// PUT /api/seller/profile - Atualiza name + businessName do seller autenticado
// ═══════════════════════════════════════════════════════════════════════════════
sellersRouter.get('/api/seller/profile', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    let data: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT name, business_name FROM sellers WHERE id = ${user.uid} LIMIT 1`;
      if (rows[0]) data = rows[0];
    }, `getProfile:${user.uid}`);
    if (!data) return res.status(404).json({ error: 'Seller não encontrado' });
    return res.json({
      name: data.name || '',
      businessName: data.business_name || '',
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

sellersRouter.put('/api/seller/profile', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });

    const { name, businessName } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Nome na vitrine é obrigatório' });
    }

    await neonQuery(async (sql) => {
      if (businessName !== undefined) {
        await sql`UPDATE sellers SET name = ${name.trim()}, business_name = ${businessName.trim()}, updated_at = NOW() WHERE id = ${user.uid}`;
      } else {
        await sql`UPDATE sellers SET name = ${name.trim()}, updated_at = NOW() WHERE id = ${user.uid}`;
      }
    }, `updateProfile:${user.uid}`);

    console.log(`✅ Perfil atualizado para seller ${user.uid}: name="${name.trim()}" businessName="${businessName?.trim()}"`);
    return res.json({ success: true, name: name.trim(), businessName: businessName?.trim() || '' });
  } catch (e: any) {
    console.error('❌ Erro ao atualizar perfil seller:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// SESSÕES DO USUÁRIO
// ─────────────────────────────────────────────────────────────

// GET /api/seller/sessions — lista sessões ativas do seller
sellersRouter.get('/api/seller/sessions', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    const { getSessionsForUser } = await import('../lib/user-sessions.js');
    const currentBrowserId = req.headers['x-browser-id'] as string || '';
    const sessions = await getSessionsForUser(uid);

    const result = sessions.map(s => ({
      ...s,
      isCurrent: s.browserId === currentBrowserId,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
      lastActiveAt: s.lastActiveAt instanceof Date ? s.lastActiveAt.toISOString() : s.lastActiveAt,
    }));

    return res.json({ sessions: result });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /api/seller/sessions/:sessionId — revoga sessão específica
sellersRouter.delete('/api/seller/sessions/:sessionId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    const { sessionId } = req.params;
    const currentBrowserId = req.headers['x-browser-id'] as string || '';
    const { revokeSession } = await import('../lib/user-sessions.js');
    const result = await revokeSession(uid, sessionId, currentBrowserId);

    if (!result.success) return res.status(400).json({ error: result.error });
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /api/seller/sessions — revoga todas as outras sessões
sellersRouter.delete('/api/seller/sessions', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    const currentBrowserId = req.headers['x-browser-id'] as string || '';
    const { revokeAllOtherSessions } = await import('../lib/user-sessions.js');
    const result = await revokeAllOtherSessions(uid, currentBrowserId);

    return res.json({ success: result.success, count: result.count });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default sellersRouter;

