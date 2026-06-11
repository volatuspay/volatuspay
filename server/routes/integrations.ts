import { Router, type Request, type Response } from 'express';
import {
  verifyFirebaseToken,
  AuthenticatedRequest
} from '../security/firebase-auth.js';
import { ensureFirebaseReady, getAdmin, getFirestore } from '../lib/firebase-admin.js';
import { getUTMifyConfig, saveUTMifyConfig, sendOrderToUTMify } from '../lib/utmify-service.js';

const integrationsRouter = Router();

// 🔗 INTEGRAÇÕES - WEBHOOKS PERSONALIZADOS (REAL - FIREBASE)
integrationsRouter.post('/api/integrations/webhooks', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { url, events, secret } = req.body;
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    if (!url || !events || events.length === 0) {
      return res.status(400).json({ error: 'URL e eventos são obrigatórios' });
    }
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    // 🔑 GERAR SECRET AUTOMÁTICO SE NÃO FORNECIDO
    const crypto = await import('crypto');
    const webhookSecret = secret || `whsec_${crypto.randomBytes(32).toString('hex')}`;
    
    // Criar webhook no Firebase
    const webhookRef = db.collection('webhooks').doc();
    const webhookData = {
      id: webhookRef.id,
      sellerUid,
      url,
      events,
      secret: webhookSecret,
      active: true,
      createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      lastTrigger: null,
      successCount: 0,
      failureCount: 0
    };
    
    await webhookRef.set(webhookData);
    
    console.log(`✅ Webhook criado ETERNAMENTE: ${webhookRef.id} para seller ${sellerUid}`);
    console.log(`🔑 Secret ${secret ? 'fornecido pelo usuário' : 'gerado automaticamente'}`);
    
    res.json({
      success: true,
      secret: webhookSecret,
      webhook: {
        id: webhookRef.id,
        url,
        events,
        active: true,
        createdAt: new Date(),
        sellerUid
      }
    });
    
  } catch (error) {
    console.error('❌ Erro ao criar webhook:', error);
    res.status(500).json({ error: 'Erro ao criar webhook' });
  }
});

integrationsRouter.get('/api/integrations/webhooks', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    
    const webhooksSnapshot = await db.collection('webhooks')
      .where('sellerUid', '==', sellerUid)
      .limit(50)
      .get();
    
    const webhooks: any[] = [];
    webhooksSnapshot.forEach((doc: any) => {
      const data = doc.data();
      webhooks.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        lastTrigger: data.lastTrigger?.toDate?.() || data.lastTrigger
      });
    });
    
    webhooks.sort((a, b) => {
      const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return dateB - dateA;
    });
    
    console.log(`✅ ${webhooks.length} webhooks encontrados para seller ${sellerUid}`);
    
    res.json({ webhooks });
    
  } catch (error) {
    console.error('❌ Erro ao buscar webhooks:', error);
    res.status(500).json({ error: 'Erro ao buscar webhooks' });
  }
});

integrationsRouter.delete('/api/integrations/webhooks/:webhookId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { webhookId } = req.params;
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const webhookRef = db.collection('webhooks').doc(webhookId);
    const webhookDoc = await webhookRef.get();
    
    if (!webhookDoc.exists) {
      return res.status(404).json({ error: 'Webhook não encontrado' });
    }
    
    const webhookData = webhookDoc.data();
    if (webhookData?.sellerUid !== sellerUid) {
      return res.status(403).json({ error: 'Sem permissão para deletar este webhook' });
    }
    
    await webhookRef.delete();
    
    console.log(`✅ Webhook deletado: ${webhookId}`);
    
    res.json({ success: true, message: 'Webhook deletado com sucesso' });
    
  } catch (error) {
    console.error('❌ Erro ao deletar webhook:', error);
    res.status(500).json({ error: 'Erro ao deletar webhook' });
  }
});

// 🧪 WEBHOOK TEST - Enviar evento de teste
integrationsRouter.post('/api/integrations/webhooks/:webhookId/test', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { webhookId } = req.params;
    const { eventType } = req.body;
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const webhookRef = db.collection('webhooks').doc(webhookId);
    const webhookDoc = await webhookRef.get();
    
    if (!webhookDoc.exists) {
      return res.status(404).json({ error: 'Webhook não encontrado' });
    }
    
    const webhookData = webhookDoc.data();
    if (webhookData?.sellerUid !== sellerUid) {
      return res.status(403).json({ error: 'Sem permissão para testar este webhook' });
    }
    
    const resolvedEvent = eventType || 'payment.pix.paid';
    const testPayload = {
      event: resolvedEvent,
      tenantId: sellerUid,
      isTest: true,
      timestamp: new Date().toISOString(),
      apiVersion: '2025-11-03',
      data: {
        orderId: 'test_' + Date.now(),
        status: 'paid',
        amount: 9900,
        amountFormatted: 'R$ 99,00',
        currency: 'BRL',
        customer: {
          name: 'Cliente Teste',
          email: 'teste@exemplo.com',
          phone: '5511999999999',
          cpf: '000.000.000-00',
          document: '000.000.000-00'
        },
        product: {
          name: 'Produto Teste',
          id: 'prod_test',
          checkoutId: 'checkout_test',
          type: 'digital'
        },
        paymentMethod: 'pix',
        processor: 'efibank'
      }
    };
    
    const startTime = Date.now();
    let success = false;
    let statusCode = 0;
    let errorMessage = '';
    
    try {
      const payloadStr = JSON.stringify(testPayload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Zen-Event': resolvedEvent,
        'X-Zen-Tenant': sellerUid,
        'X-Webhook-Source': 'volatuspay.com',
        'User-Agent': 'VolatusPay-Webhook/1.0',
        'X-Webhook-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Webhook-Test': 'true'
      };
      
      if (webhookData.secret) {
        const crypto = await import('crypto');
        const signature = crypto.createHmac('sha256', webhookData.secret)
          .update(payloadStr)
          .digest('hex');
        headers['X-Zen-Signature'] = `sha256=${signature}`;
      }
      
      const response = await fetch(webhookData.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: AbortSignal.timeout(10000)
      });
      
      statusCode = response.status;
      success = response.ok;
      
    } catch (fetchError: any) {
      errorMessage = fetchError.message || 'Erro de conexão';
      statusCode = 0;
    }
    
    const responseTime = Date.now() - startTime;
    console.log(`🧪 Webhook teste: ${webhookData.url} - ${success ? 'OK' : 'FALHA'} (${statusCode}) em ${responseTime}ms`);
    
    res.json({ success, statusCode, responseTime, error: errorMessage || undefined, event: eventType || 'order.paid' });
    
  } catch (error: any) {
    console.error('❌ Erro ao testar webhook:', error);
    res.status(500).json({ error: 'Erro ao testar webhook' });
  }
});

// 🔑 INTEGRAÇÕES - CHAVES API (REAL - FIREBASE)
integrationsRouter.post('/api/integrations/api-keys', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body || {};
    const { name, permissions } = body;
    const sellerUid = req.user?.uid;

    console.log(`[API-KEYS POST] body keys=${Object.keys(body).join(',') || '(empty)'} name="${name}" permissions=${JSON.stringify(permissions)} uid=${sellerUid}`);
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    if (!name && (!permissions || permissions.length === 0)) {
      return res.status(400).json({ error: 'Nome e permissões são obrigatórios' });
    }
    if (!name) {
      return res.status(400).json({ error: 'Nome da integração é obrigatório' });
    }
    if (!permissions || permissions.length === 0) {
      return res.status(400).json({ error: 'Selecione ao menos uma permissão' });
    }
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const crypto = await import('crypto');
    const apiKey = `vp_${crypto.randomBytes(32).toString('hex')}`;
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    const apiKeyRef = db.collection('apiKeys').doc();
    const apiKeyData = {
      id: apiKeyRef.id,
      sellerId: sellerUid,
      sellerUid,
      name,
      permissions,
      keyHash: apiKeyHash,
      last4: apiKey.slice(-4),
      active: true,
      createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      lastUsed: null,
      usageCount: 0
    };
    
    await apiKeyRef.set(apiKeyData);

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-payment.js').then(({ neonWriteApiKey }) => {
      neonWriteApiKey({
        id: apiKeyRef.id,
        sellerId: sellerUid,
        name,
        permissions,
        keyHash: apiKeyHash,
        last4: apiKey.slice(-4),
        active: true,
        autoGenerated: false,
        usageCount: 0,
      });
    }).catch(() => {});

    console.log(`✅ API Key criada com sucesso para seller ${sellerUid}`);
    
    res.json({
      success: true,
      apiKey: apiKey,
      apiKeyId: apiKeyRef.id,
      name,
      permissions,
      message: '⚠️ GUARDE ESTA CHAVE EM LOCAL SEGURO! Ela não será exibida novamente.'
    });
    
  } catch (error) {
    console.error('❌ Erro ao criar API key:', error);
    res.status(500).json({ error: 'Erro ao criar chave API' });
  }
});

integrationsRouter.get('/api/integrations/api-keys', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    
    const apiKeysSnapshot = await db.collection('apiKeys')
      .where('sellerUid', '==', sellerUid)
      .get();
    
    const apiKeys: any[] = [];
    apiKeysSnapshot.forEach((doc: any) => {
      const data = doc.data();
      apiKeys.push({
        id: doc.id,
        name: data.name,
        permissions: data.permissions,
        last4: data.last4,
        active: data.active,
        usageCount: data.usageCount || 0,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        lastUsed: data.lastUsed?.toDate?.() || data.lastUsed
      });
    });
    
    apiKeys.sort((a, b) => {
      const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return dateB - dateA;
    });
    
    console.log(`✅ ${apiKeys.length} API keys encontradas para seller ${sellerUid}`);
    
    res.json({ apiKeys });
    
  } catch (error) {
    console.error('❌ Erro ao buscar API keys:', error);
    res.status(500).json({ error: 'Erro ao buscar chaves API' });
  }
});

integrationsRouter.delete('/api/integrations/api-keys/:apiKeyId', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { apiKeyId } = req.params;
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();
    
    const apiKeyRef = db.collection('apiKeys').doc(apiKeyId);
    const apiKeyDoc = await apiKeyRef.get();
    
    if (!apiKeyDoc.exists) {
      return res.status(404).json({ error: 'Chave API não encontrada' });
    }
    
    const apiKeyData = apiKeyDoc.data();
    if (apiKeyData?.sellerUid !== sellerUid) {
      return res.status(403).json({ error: 'Sem permissão para deletar esta chave API' });
    }
    
    await apiKeyRef.delete();

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-payment.js').then(({ neonDeleteApiKey }) => {
      neonDeleteApiKey(apiKeyId);
    }).catch(() => {});

    console.log(`✅ API Key revogada: ${apiKeyId}`);
    
    res.json({ success: true, message: 'Chave API revogada com sucesso' });
    
  } catch (error) {
    console.error('❌ Erro ao revogar API key:', error);
    res.status(500).json({ error: 'Erro ao revogar chave API' });
  }
});

// 💳 INTEGRAÇÕES - CONFIGURAÇÃO DE ADQUIRENTES (SELLER SELF-SERVICE)
integrationsRouter.get('/api/integrations/acquirer-config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    
    const sellerDoc = await db.collection('sellers').doc(sellerUid).get();
    
    if (!sellerDoc.exists) {
      return res.status(404).json({ error: 'Seller não encontrado' });
    }
    
    const sellerData = sellerDoc.data();
    const acquirerConfig = sellerData?.acquirerConfig || {};
    
    const maskKey = (key: string | undefined) => {
      if (!key || key.length < 8) return '';
      return `****${key.slice(-4)}`;
    };
    
    const maskedConfig = {
      stripe: acquirerConfig.stripe ? {
        enabled: acquirerConfig.stripe.enabled || false,
        environment: acquirerConfig.stripe.environment || 'test',
        publicKey: maskKey(acquirerConfig.stripe.publicKey),
        secretKey: maskKey(acquirerConfig.stripe.secretKey),
        webhookSecret: maskKey(acquirerConfig.stripe.webhookSecret),
        last4PublicKey: acquirerConfig.stripe.publicKey?.slice(-4) || '',
        last4SecretKey: acquirerConfig.stripe.secretKey?.slice(-4) || '',
        configured: !!(acquirerConfig.stripe.publicKey && acquirerConfig.stripe.secretKey)
      } : null,
      efibank: acquirerConfig.efibank ? {
        enabled: acquirerConfig.efibank.enabled || false,
        environment: acquirerConfig.efibank.environment || 'sandbox',
        clientId: maskKey(acquirerConfig.efibank.clientId),
        clientSecret: maskKey(acquirerConfig.efibank.clientSecret),
        pixKey: acquirerConfig.efibank.pixKey || '',
        last4ClientId: acquirerConfig.efibank.clientId?.slice(-4) || '',
        last4ClientSecret: acquirerConfig.efibank.clientSecret?.slice(-4) || '',
        configured: !!(acquirerConfig.efibank.clientId && acquirerConfig.efibank.clientSecret)
      } : null,
      adyen: acquirerConfig.adyen ? {
        enabled: acquirerConfig.adyen.enabled || false,
        environment: acquirerConfig.adyen.environment || 'test',
        apiKey: maskKey(acquirerConfig.adyen.apiKey),
        merchantAccount: acquirerConfig.adyen.merchantAccount || '',
        clientKey: maskKey(acquirerConfig.adyen.clientKey),
        last4ApiKey: acquirerConfig.adyen.apiKey?.slice(-4) || '',
        configured: !!(acquirerConfig.adyen.apiKey && acquirerConfig.adyen.merchantAccount)
      } : null
    };
    
    console.log(`✅ Configurações de adquirentes retornadas para seller ${sellerUid}`);
    
    res.json({ config: maskedConfig });
    
  } catch (error) {
    console.error('❌ Erro ao buscar configurações de adquirentes:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

integrationsRouter.post('/api/integrations/acquirer-config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    
    if (!sellerUid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    const { acquirer, config } = req.body;
    
    if (!acquirer || !config) {
      return res.status(400).json({ error: 'Adquirente e configuração são obrigatórios' });
    }
    
    if (!['stripe', 'efibank', 'adyen'].includes(acquirer)) {
      return res.status(400).json({ error: 'Adquirente inválido' });
    }
    
    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    const { encryptSensitiveData } = await import('../security/key-encryption.js');
    
    const sellerRef = db.collection('sellers').doc(sellerUid);
    const sellerDoc = await sellerRef.get();
    
    if (!sellerDoc.exists) {
      return res.status(404).json({ error: 'Seller não encontrado' });
    }
    
    const sellerData = sellerDoc.data();
    const currentAcquirerConfig = sellerData?.acquirerConfig || {};
    
    let updatedConfig: any = {};
    
    if (acquirer === 'stripe') {
      updatedConfig = {
        enabled: config.enabled || false,
        environment: config.environment || 'test',
        publicKey: config.publicKey && !config.publicKey.startsWith('****') 
          ? encryptSensitiveData(config.publicKey) 
          : currentAcquirerConfig.stripe?.publicKey || '',
        secretKey: config.secretKey && !config.secretKey.startsWith('****')
          ? encryptSensitiveData(config.secretKey)
          : currentAcquirerConfig.stripe?.secretKey || '',
        webhookSecret: config.webhookSecret && !config.webhookSecret.startsWith('****')
          ? encryptSensitiveData(config.webhookSecret)
          : currentAcquirerConfig.stripe?.webhookSecret || ''
      };
    } else if (acquirer === 'efibank') {
      updatedConfig = {
        enabled: config.enabled || false,
        environment: config.environment || 'sandbox',
        clientId: config.clientId && !config.clientId.startsWith('****')
          ? encryptSensitiveData(config.clientId)
          : currentAcquirerConfig.efibank?.clientId || '',
        clientSecret: config.clientSecret && !config.clientSecret.startsWith('****')
          ? encryptSensitiveData(config.clientSecret)
          : currentAcquirerConfig.efibank?.clientSecret || '',
        pixKey: config.pixKey || ''
      };
    } else if (acquirer === 'adyen') {
      updatedConfig = {
        enabled: config.enabled || false,
        environment: config.environment || 'test',
        apiKey: config.apiKey && !config.apiKey.startsWith('****')
          ? encryptSensitiveData(config.apiKey)
          : currentAcquirerConfig.adyen?.apiKey || '',
        merchantAccount: config.merchantAccount || '',
        clientKey: config.clientKey && !config.clientKey.startsWith('****')
          ? encryptSensitiveData(config.clientKey)
          : currentAcquirerConfig.adyen?.clientKey || ''
      };
    }
    
    const newAcquirerConfig = {
      ...currentAcquirerConfig,
      [acquirer]: updatedConfig
    };
    
    await sellerRef.update({
      acquirerConfig: newAcquirerConfig,
      updatedAt: (await import('firebase-admin')).default.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Configuração ${acquirer} salva para seller ${sellerUid}`);
    
    res.json({ 
      success: true, 
      message: `Configuração ${acquirer} salva com sucesso!`,
      acquirer,
      configured: true
    });
    
  } catch (error) {
    console.error('❌ Erro ao salvar configuração de adquirente:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
});

// ============================================
// 📊 UTMify INTEGRATION - Rastreamento de Conversões
// ============================================

integrationsRouter.get('/api/integrations/utmify/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    const config = await getUTMifyConfig(sellerUid);
    if (!config) {
      return res.json({ enabled: false, configured: false });
    }

    return res.json({
      enabled: config.enabled,
      configured: true,
      last4: config.apiToken ? config.apiToken.slice(-4) : ''
    });
  } catch (error: any) {
    console.error('[UTMify] Erro ao buscar config:', error.message);
    res.status(500).json({ error: 'Erro ao buscar configuração UTMify' });
  }
});

integrationsRouter.post('/api/integrations/utmify/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    const { apiToken, enabled } = req.body;
    if (!apiToken || apiToken.startsWith('****')) {
      const existingConfig = await getUTMifyConfig(sellerUid);
      if (existingConfig) {
        await saveUTMifyConfig(sellerUid, existingConfig.apiToken, enabled !== undefined ? enabled : existingConfig.enabled);
        return res.json({ success: true, message: 'Status UTMify atualizado!' });
      }
      return res.status(400).json({ error: 'API Token obrigatório' });
    }

    await saveUTMifyConfig(sellerUid, apiToken.trim(), enabled !== false);
    res.json({ success: true, message: 'UTMify configurado com sucesso!' });
  } catch (error: any) {
    console.error('[UTMify] Erro ao salvar config:', error.message);
    res.status(500).json({ error: 'Erro ao salvar configuração UTMify' });
  }
});

integrationsRouter.post('/api/integrations/utmify/test', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    const config = await getUTMifyConfig(sellerUid);
    if (!config) return res.status(400).json({ error: 'UTMify não configurado' });

    const testResult = await sendOrderToUTMify({
      orderId: 'TEST_' + Date.now(),
      tenantId: sellerUid,
      method: 'pix',
      status: 'paid',
      amount: 10000,
      currency: 'BRL',
      customer: { name: 'Teste VolatusPay', email: 'teste@volatuspay.com' },
      checkoutTitle: 'Produto Teste',
      createdAt: new Date(),
      paidAt: new Date(),
      trackingParameters: {
        src: null, sck: null,
        utm_source: 'magnorapay_test',
        utm_campaign: 'integration_test',
        utm_medium: null, utm_content: null, utm_term: null
      },
      gatewayFee: 249,
      platformFee: 0,
      netAmount: 9751
    });

    if (testResult) {
      res.json({ success: true, message: 'Teste enviado com sucesso! Verifique no painel UTMify.' });
    } else {
      res.status(400).json({ error: 'Falha ao enviar teste. Verifique seu API Token.' });
    }
  } catch (error: any) {
    console.error('[UTMify] Erro no teste:', error.message);
    res.status(500).json({ error: 'Erro ao testar integração UTMify' });
  }
});

// 📦 NOTAZZ - GET CONFIG
integrationsRouter.get('/api/integrations/notazz/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    const doc = await db.collection('sellers').doc(sellerUid).collection('integrations').doc('notazz').get();

    if (!doc.exists) {
      return res.json({ configured: false, enabled: false });
    }

    const data = doc.data()!;
    const apiKey = data.apiKey || '';
    const last4 = apiKey.length > 4 ? apiKey.slice(-4) : '';

    res.json({
      configured: !!apiKey,
      enabled: data.enabled ?? !!apiKey,
      last4,
      cnae: data.cnae || ''
    });
  } catch (error: any) {
    console.error('[Notazz] Erro ao buscar config:', error.message);
    res.status(500).json({ error: 'Erro ao buscar configuração do Notazz' });
  }
});

// 📦 NOTAZZ - SAVE CONFIG
integrationsRouter.post('/api/integrations/notazz/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const db = adminSdk.firestore();

    const { apiKey, cnae } = req.body;
    const docRef = db.collection('sellers').doc(sellerUid).collection('integrations').doc('notazz');

    const updateData: Record<string, any> = {
      updatedAt: new Date().toISOString()
    };

    if (apiKey) updateData.apiKey = apiKey;
    if (cnae !== undefined) updateData.cnae = cnae;
    updateData.enabled = true;

    await docRef.set(updateData, { merge: true });

    res.json({ success: true, configured: true, enabled: true });
  } catch (error: any) {
    console.error('[Notazz] Erro ao salvar config:', error.message);
    res.status(500).json({ error: 'Erro ao salvar configuração do Notazz' });
  }
});

// 💬 DISCORD - GET CONFIG
integrationsRouter.get('/api/integrations/discord/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    const doc = await db.collection('sellers').doc(sellerUid).collection('integrations').doc('discord').get();

    if (!doc.exists) return res.json({ configured: false, enabled: false });

    const data = doc.data()!;
    const webhookUrl = data.webhookUrl || '';
    const last4 = webhookUrl.length > 4 ? webhookUrl.slice(-4) : '';

    res.json({
      configured: !!webhookUrl,
      enabled: data.enabled ?? !!webhookUrl,
      last4,
      events: data.events || [],
    });
  } catch (error: any) {
    console.error('[Discord] Erro ao buscar config:', error.message);
    res.status(500).json({ error: 'Erro ao buscar configuração do Discord' });
  }
});

// 💬 DISCORD - SAVE CONFIG
integrationsRouter.post('/api/integrations/discord/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();

    const { webhookUrl, events } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: 'Webhook URL obrigatória' });
    if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
      return res.status(400).json({ error: 'URL inválida. Use uma Webhook URL do Discord.' });
    }

    const docRef = db.collection('sellers').doc(sellerUid).collection('integrations').doc('discord');
    const updateData: Record<string, any> = { enabled: true, updatedAt: new Date().toISOString() };
    if (webhookUrl && !webhookUrl.startsWith('****')) updateData.webhookUrl = webhookUrl;
    if (events !== undefined) updateData.events = events;

    await docRef.set(updateData, { merge: true });

    res.json({ success: true, configured: true, enabled: true });
  } catch (error: any) {
    console.error('[Discord] Erro ao salvar config:', error.message);
    res.status(500).json({ error: 'Erro ao salvar configuração do Discord' });
  }
});

// 💬 DISCORD - DISABLE
integrationsRouter.post('/api/integrations/discord/disable', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    await db.collection('sellers').doc(sellerUid).collection('integrations').doc('discord').set({ enabled: false }, { merge: true });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Discord] Erro ao desativar:', error.message);
    res.status(500).json({ error: 'Erro ao desativar Discord' });
  }
});

// 💬 DISCORD - TEST
integrationsRouter.post('/api/integrations/discord/test', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    const doc = await db.collection('sellers').doc(sellerUid).collection('integrations').doc('discord').get();
    if (!doc.exists || !doc.data()?.webhookUrl) {
      return res.status(400).json({ error: 'Discord não configurado' });
    }

    const { webhookUrl } = doc.data()!;

    const payload = {
      username: 'VolatusPay',
      embeds: [{
        title: '✅ Teste de Notificação!',
        color: 0x22c55e,
        description: 'Sua integração com o Discord está funcionando perfeitamente.',
        fields: [
          { name: '💰 Valor',   value: 'R$ 99,90',        inline: true },
          { name: '💳 Método',  value: 'PIX',              inline: true },
          { name: '👤 Cliente', value: 'Cliente Teste',    inline: false },
          { name: '🕐 Data',    value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: false },
        ],
        footer: { text: 'VolatusPay — Teste de integração' },
      }],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok || response.status === 204) {
      res.json({ success: true, message: 'Mensagem de teste enviada! Verifique seu canal.' });
    } else {
      const text = await response.text();
      res.status(400).json({ error: `Falha no Discord: ${text}` });
    }
  } catch (error: any) {
    console.error('[Discord] Erro no teste:', error.message);
    res.status(500).json({ error: 'Erro ao testar integração Discord' });
  }
});

// 🎯 XTRACKY - GET CONFIG
integrationsRouter.get('/api/integrations/xtracky/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    const doc = await db.collection('sellers').doc(sellerUid).collection('integrations').doc('xtracky').get();

    if (!doc.exists) return res.json({ configured: false, enabled: false });

    const data = doc.data()!;
    const productId = data.productId || '';
    const last4 = productId.length > 4 ? productId.slice(-4) : productId;

    res.json({
      configured: !!productId,
      enabled: data.enabled ?? !!productId,
      last4,
    });
  } catch (error: any) {
    console.error('[Xtracky] Erro ao buscar config:', error.message);
    res.status(500).json({ error: 'Erro ao buscar configuração do Xtracky' });
  }
});

// 🎯 XTRACKY - SAVE CONFIG
integrationsRouter.post('/api/integrations/xtracky/config', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();

    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'Product ID obrigatório' });

    const docRef = db.collection('sellers').doc(sellerUid).collection('integrations').doc('xtracky');
    await docRef.set({ productId, enabled: true, updatedAt: new Date().toISOString() }, { merge: true });

    res.json({ success: true, configured: true, enabled: true });
  } catch (error: any) {
    console.error('[Xtracky] Erro ao salvar config:', error.message);
    res.status(500).json({ error: 'Erro ao salvar configuração do Xtracky' });
  }
});

// 🎯 XTRACKY - DISABLE
integrationsRouter.post('/api/integrations/xtracky/disable', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();
    await db.collection('sellers').doc(sellerUid).collection('integrations').doc('xtracky').set({ enabled: false }, { merge: true });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Xtracky] Erro ao desativar:', error.message);
    res.status(500).json({ error: 'Erro ao desativar Xtracky' });
  }
});

// 🎯 XTRACKY - TEST
integrationsRouter.post('/api/integrations/xtracky/test', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerUid = req.user?.uid;
    if (!sellerUid) return res.status(401).json({ error: 'Não autenticado' });

    const payload = {
      orderId: `TEST_${Date.now()}`,
      amount: 9990,
      status: 'paid',
      platform: 'VOLATUSPAY',
      utm_source: 'test_utm_source',
      leadName: 'Cliente Teste',
      leadEmail: 'teste@volatuspay.com',
      leadPhone: '+5511999999999',
    };

    const response = await fetch('https://api.xtracky.com/api/integrations/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      res.json({ success: true, message: 'Evento de teste enviado ao Xtracky!' });
    } else {
      const text = await response.text();
      res.status(400).json({ error: `Falha no teste: ${text}` });
    }
  } catch (error: any) {
    console.error('[Xtracky] Erro no teste:', error.message);
    res.status(500).json({ error: 'Erro ao testar integração Xtracky' });
  }
});

export default integrationsRouter;
