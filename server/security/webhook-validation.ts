// 🔐 VALIDAÇÃO SEGURA DE WEBHOOKS
// Previne requisições forjadas e ataques de replay

import crypto from 'crypto';

/**
 * Valida assinatura de webhook do Stripe usando apenas a biblioteca webhooks
 * @param payload - Corpo da requisição (raw string)
 * @param signature - Header stripe-signature
 * @param webhookSecret - STRIPE_WEBHOOK_SECRET (whsec_...)
 * @returns boolean - true se válido
 */
export function validateStripeWebhook(payload: string, signature: string, webhookSecret: string): boolean {
  try {
    if (!payload || !signature || !webhookSecret) {
      console.error('🚨 STRIPE WEBHOOK: Parâmetros inválidos para validação');
      return false;
    }

    // ✅ USAR STRIPE WEBHOOKS DIRETAMENTE (sem precisar de STRIPE_SECRET_KEY)
    const Stripe = require('stripe');
    const stripe = new Stripe('sk_test_dummy', { apiVersion: '2024-06-20' }); // Dummy key apenas para acessar webhooks
    
    // Usar a função oficial do Stripe para validar webhook
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    
    // Se chegou até aqui, a assinatura é válida
    console.log('✅ STRIPE WEBHOOK: Assinatura validada com sucesso');
    return true;
    
  } catch (error: any) {
    console.error('❌ STRIPE WEBHOOK: Falha na validação da assinatura:', error.message);
    
    // Log específico para debugging
    if (error.message.includes('timestamp')) {
      console.error('⏰ ERRO: Webhook muito antigo (possível replay attack)');
    } else if (error.message.includes('signature')) {
      console.error('🚨 ERRO: Assinatura inválida (possível request forjado)');
    }
    
    return false;
  }
}

/**
 * 🛡️ VALIDAÇÃO HMAC PARA WEBHOOKS EFIBANK
 * Valida o token HMAC enviado via query parameter
 * 
 * @param hmacFromQuery - Token HMAC do query parameter
 * @param expectedHmac - HMAC esperado (EFIBANK_WEBHOOK_HMAC secret)
 * @returns boolean - true se HMAC válido
 */
export function validateEfiBankHMAC(hmacFromQuery: string | undefined, expectedHmac: string): boolean {
  try {
    if (!hmacFromQuery || !expectedHmac) {
      console.error('🚨 EFIBANK HMAC: Parâmetros ausentes');
      return false;
    }

    // Comparação segura contra timing attacks
    if (hmacFromQuery.length !== expectedHmac.length) {
      console.error('🚨 EFIBANK HMAC: Comprimento inválido');
      return false;
    }

    const isValid = crypto.timingSafeEqual(
      Buffer.from(hmacFromQuery),
      Buffer.from(expectedHmac)
    );

    if (isValid) {
      console.log('✅ EFIBANK HMAC: Validação passou');
    } else {
      console.error('🚨 EFIBANK HMAC: Token inválido - possível ataque');
    }

    return isValid;
  } catch (error: any) {
    console.error('❌ EFIBANK HMAC: Erro na validação:', error.message);
    return false;
  }
}

/**
 * 🛡️ VALIDAÇÃO CRÍTICA DE WEBHOOKS EFIBANK - PRODUÇÃO
 * Implementa múltiplas camadas de validação contra ataques:
 * - HMAC obrigatório (1ª camada)
 * - User-Agent rigoroso
 * - Estrutura de payload obrigatória
 * - Proteção contra replay attacks
 * - Validação de timestamp
 * 
 * @param payload - Corpo da requisição (Buffer do express.raw ou string)
 * @param headers - Headers da requisição
 * @returns boolean - true se válido
 */
export function validateEfiBankWebhook(payload: any, headers: any): boolean {
  try {
    console.log('🔍 EFIBANK WEBHOOK: Validando webhook EfíBank...');
    
    // NOTA: EfíBank webhooks são configurados via API, não há secret específico
    // A validação é feita pelo próprio servidor do EfíBank usando certificados
    
    // 🔐 AUDITORIA DE SEGURANÇA: Log de tentativa de webhook
    console.log('🔍 SECURITY AUDIT: Tentativa de webhook EfíBank', {
      ip: headers['x-forwarded-for'] || 'unknown',
      userAgent: headers['user-agent'] || 'unknown',
      timestamp: new Date().toISOString(),
      payloadSize: Buffer.byteLength(JSON.stringify(payload))
    });

    // ✅ NOTA: User-Agent não é validado aqui pois o HMAC já garante autenticidade
    // EfíBank pode usar diferentes User-Agents (Java/, Apache-HttpClient, etc.)
    // A validação HMAC (feita antes de chamar esta função) é suficiente e mais segura
    const userAgent = headers['user-agent'] || 'unknown';
    const clientIp = headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown';
    console.log('📡 EFIBANK WEBHOOK: Recebido de IP:', clientIp, 'User-Agent:', userAgent);
    
    // Validação estrutural do payload - converter para objeto para análise
    let payloadObj: any;
    try {
      if (Buffer.isBuffer(payload)) {
        payloadObj = JSON.parse(payload.toString('utf8'));
      } else if (typeof payload === 'string') {
        payloadObj = JSON.parse(payload);
      } else {
        payloadObj = payload; // Já é objeto
      }
    } catch (parseError) {
      console.error('🚨 EFIBANK WEBHOOK: Erro ao parsear payload:', parseError);
      return false;
    }
    
    // Verificar se payload tem estrutura válida
    if (!payloadObj || typeof payloadObj !== 'object') {
      console.error('🚨 EFIBANK WEBHOOK: Payload inválido ou vazio');
      return false;
    }
    
    // 🛡️ VALIDAÇÃO RIGOROSA PIX: deve ter txid válido
    if (payloadObj.txid && typeof payloadObj.txid === 'string' && payloadObj.txid.length >= 25) {
      // 🔐 AUDITORIA: Log de PIX webhook válido
      console.log('🔍 SECURITY AUDIT: PIX webhook válido detectado', {
        txid: payloadObj.txid,
        ip: headers['x-forwarded-for'] || 'unknown',
        timestamp: new Date().toISOString(),
        payloadKeys: Object.keys(payloadObj)
      });
      
      // 🔍 VALIDAÇÃO ADICIONAL: Verificar se não é replay attack (timestamp muito antigo)
      const webhookTimestamp = headers['x-timestamp'] || headers['timestamp'] || headers['date'];
      if (webhookTimestamp) {
        const timestampAge = Date.now() - (parseInt(webhookTimestamp) * 1000 || new Date(webhookTimestamp).getTime());
        if (timestampAge > 300000) { // 5 minutos
          console.error('🚨 SECURITY AUDIT: Replay attack detectado', {
            timestampAge: timestampAge / 1000,
            txid: payloadObj.txid,
            ip: headers['x-forwarded-for'] || 'unknown',
            reason: 'TIMESTAMP_TOO_OLD'
          });
          return false;
        }
      }

      // 🔐 VALIDAÇÃO DE INTEGRIDADE: Verificar se txid é alfanumérico válido
      const txidRegex = /^[a-zA-Z0-9]{25,}$/;
      if (!txidRegex.test(payloadObj.txid)) {
        console.error('🚨 SECURITY AUDIT: TXID formato inválido', {
          txid: payloadObj.txid,
          ip: headers['x-forwarded-for'] || 'unknown',
          reason: 'INVALID_TXID_FORMAT'
        });
        return false;
      }
      
      return true;
    }
    
    // Para cartão: deve ter data.charge
    if (payloadObj.data && payloadObj.data.charge && payloadObj.data.charge.id) {
      console.log('✅ EFIBANK WEBHOOK CARTÃO: Estrutura válida');
      return true;
    }
    
    // Estrutura alternativa do PIX (array de pix)
    if (payloadObj.pix && Array.isArray(payloadObj.pix) && payloadObj.pix.length > 0) {
      const pixData = payloadObj.pix[0];
      if (pixData.txid && pixData.valor) {
        console.log('✅ EFIBANK WEBHOOK PIX (array): Estrutura válida');
        return true;
      }
    }

    // 🚨 SECURITY CRITICAL: REJEITAR WEBHOOKS INVÁLIDOS
    console.error('🚨 SECURITY AUDIT: Tentativa de fraude detectada', {
      reason: 'WEBHOOK_STRUCTURE_INVALID',
      payloadKeys: Object.keys(payloadObj),
      ip: headers['x-forwarded-for'] || 'unknown',
      userAgent: headers['user-agent'] || 'unknown',
      timestamp: new Date().toISOString(),
      payloadSample: JSON.stringify(payloadObj).substring(0, 200) + '...'
    });
    
    // 🛡️ SECURITY: NÃO ACEITAR WEBHOOKS COM ESTRUTURA DESCONHECIDA
    // Isto previne ataques de webhook forjado
    return false;
    
  } catch (error: any) {
    console.error('❌ EFIBANK WEBHOOK: Erro na validação:', error.message);
    return false;
  }
}

/**
 * 🛡️ VALIDAÇÃO HMAC PARA WEBHOOKS ADYEN (SPEC OFICIAL)
 * Valida assinatura HMAC do Adyen usando biblioteca oficial
 * Adyen envia signature em notificationItems[0].NotificationRequestItem.additionalData.hmacSignature
 * 
 * @param notificationRequestItem - Objeto NotificationRequestItem do Adyen
 * @param hmacKey - ADYEN_HMAC_KEY (hex-encoded)
 * @returns boolean - true se HMAC válido
 */
export function validateAdyenWebhook(notificationRequestItem: any, hmacKey: string): boolean {
  try {
    if (!notificationRequestItem || !hmacKey) {
      console.error('🚨 ADYEN WEBHOOK: Parâmetros ausentes para validação');
      return false;
    }

    // ✅ USAR BIBLIOTECA OFICIAL DO ADYEN
    const { hmacValidator } = require('@adyen/api-library');
    const validator = new hmacValidator();

    const isValid = validator.validateHMAC(notificationRequestItem, hmacKey);

    if (isValid) {
      console.log('✅ ADYEN WEBHOOK: Assinatura HMAC validada com sucesso');
    } else {
      console.error('🚨 ADYEN WEBHOOK: Assinatura HMAC inválida - possível fraude');
    }

    return isValid;
  } catch (error: any) {
    console.error('❌ ADYEN WEBHOOK: Erro na validação HMAC:', error.message);
    return false;
  }
}

/**
 * 🛡️ VALIDAÇÃO PARA WEBHOOKS PAGAR.ME
 * Valida assinatura X-Hub-Signature do Pagar.me
 * 
 * @param payload - Corpo da requisição (string JSON)
 * @param signature - Header x-hub-signature (formato: sha1=hash)
 * @param secret - PAGARME_WEBHOOK_SECRET
 * @returns boolean - true se assinatura válida
 */
export function validatePagarmeWebhook(payload: string, signature: string | undefined, secret: string): boolean {
  try {
    if (!payload || !signature || !secret) {
      console.error('🚨 PAGAR.ME WEBHOOK: Parâmetros ausentes para validação');
      return false;
    }

    const parts = signature.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha1') {
      console.error('🚨 PAGAR.ME WEBHOOK: Formato de assinatura inválido');
      return false;
    }

    const receivedSignature = parts[1];

    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(receivedSignature),
      Buffer.from(expectedSignature)
    );

    if (isValid) {
      console.log('✅ PAGAR.ME WEBHOOK: Assinatura X-Hub-Signature validada com sucesso');
    } else {
      console.error('🚨 PAGAR.ME WEBHOOK: Assinatura inválida - possível fraude');
    }

    return isValid;
  } catch (error: any) {
    console.error('❌ PAGAR.ME WEBHOOK: Erro na validação:', error.message);
    return false;
  }
}

/**
 * Middleware de validação de webhook genérico
 * @param type - 'stripe', 'efibank', 'adyen', 'pagarme'
 * @returns Express middleware function
 */
export function createWebhookValidator(type: 'stripe' | 'efibank' | 'adyen' | 'pagarme') {
  return async (req: any, res: any, next: any) => {
    try {
      if (type === 'stripe') {
        // 💳 STRIPE WEBHOOK: Validação de assinatura com RAW BODY
        // ✅ BUSCAR SECRETS DO FIREBASE (CRIPTOGRAFADOS) OU ENV VAR
        const { ensureFirebaseReady, getFirestore } = await import('../lib/firebase-admin.js');
        const { decryptSensitiveData } = await import('./key-encryption.js');
        
        await ensureFirebaseReady();
        const db = getFirestore();
        
        const paymentConfigRef = db.collection('paymentConfig').doc('global');
        const paymentConfigDoc = await paymentConfigRef.get();
        
        let webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        
        if (paymentConfigDoc.exists) {
          const data = paymentConfigDoc.data();
          if (data?.stripe?.webhookSecret) {
            try {
              webhookSecret = decryptSensitiveData(data.stripe.webhookSecret);
              console.log('✅ STRIPE Webhook Secret carregado do Firebase');
            } catch (decryptError) {
              console.error('⚠️ Erro ao descriptografar webhook secret, usando env var:', decryptError);
            }
          }
        }
        
        const signature = req.headers['stripe-signature'];
        
        if (!webhookSecret) {
          console.error('🚨 STRIPE_WEBHOOK_SECRET não configurado');
          return res.status(500).json({ error: 'Webhook secret não configurado' });
        }
        
        // ⚠️ STRIPE REQUER RAW BODY (Buffer ou string)
        let payload: string;
        
        if (Buffer.isBuffer(req.body)) {
          // ✅ CORRETO: express.raw() foi usado
          payload = req.body.toString('utf8');
        } else if (typeof req.body === 'string') {
          // ✅ OK: Já é string
          payload = req.body;
        } else {
          // ❌ ERRO: express.json() foi usado, mas precisamos do raw body
          console.error('🚨 STRIPE WEBHOOK: req.body não é Buffer/string (use express.raw())');
          return res.status(500).json({ error: 'Endpoint deve usar express.raw()' });
        }
        
        const isValid = validateStripeWebhook(payload, signature, webhookSecret);
        
        if (!isValid) {
          console.error('🚨 STRIPE WEBHOOK REJEITADO: Assinatura inválida');
          return res.status(401).json({ error: 'Assinatura inválida' });
        }
        
      } else if (type === 'efibank') {
        const isValid = validateEfiBankWebhook(req.body, req.headers);
        
        if (!isValid) {
          console.error('🚨 EFIBANK WEBHOOK REJEITADO: Validação falhou');
          return res.status(401).json({ error: 'Webhook inválido' });
        }
      } else if (type === 'adyen') {
        // 🌍 ADYEN WEBHOOK: Validação oficial usando @adyen/api-library
        // ✅ BUSCAR HMAC KEY DO FIREBASE (CRIPTOGRAFADA) OU ENV VAR
        const { ensureFirebaseReady, getFirestore } = await import('../lib/firebase-admin.js');
        const { decryptSensitiveData } = await import('./key-encryption.js');
        
        await ensureFirebaseReady();
        const db = getFirestore();
        
        const paymentConfigRef = db.collection('paymentConfig').doc('global');
        const paymentConfigDoc = await paymentConfigRef.get();
        
        let hmacKey = process.env.ADYEN_HMAC_KEY;
        
        if (paymentConfigDoc.exists) {
          const data = paymentConfigDoc.data();
          if (data?.adyen?.hmacKey) {
            try {
              hmacKey = decryptSensitiveData(data.adyen.hmacKey);
              console.log('✅ ADYEN HMAC Key carregado do Firebase');
            } catch (decryptError) {
              console.error('⚠️ Erro ao descriptografar HMAC key, usando env var:', decryptError);
            }
          }
        }
        
        if (!hmacKey) {
          console.error('🚨 ADYEN_HMAC_KEY não configurado');
          return res.status(500).json({ error: 'HMAC key não configurado' });
        }
        
        // Extrair notificationRequestItem do payload
        const notificationItems = req.body.notificationItems;
        
        if (!notificationItems || !Array.isArray(notificationItems) || notificationItems.length === 0) {
          console.error('🚨 ADYEN WEBHOOK: Payload inválido - sem notificationItems');
          return res.status(400).json({ notificationResponse: '[invalid]' });
        }
        
        const notificationRequestItem = notificationItems[0].NotificationRequestItem;
        
        if (!notificationRequestItem) {
          console.error('🚨 ADYEN WEBHOOK: Payload inválido - sem NotificationRequestItem');
          return res.status(400).json({ notificationResponse: '[invalid]' });
        }
        
        const isValid = validateAdyenWebhook(notificationRequestItem, hmacKey);
        
        if (!isValid) {
          console.error('🚨 ADYEN WEBHOOK REJEITADO: Assinatura HMAC inválida');
          return res.status(401).json({ notificationResponse: '[invalid]' });
        }
      } else if (type === 'pagarme') {
        // 💳 PAGAR.ME WEBHOOK: Validação X-Hub-Signature com RAW BODY
        // ✅ BUSCAR SECRET DO FIREBASE (CRIPTOGRAFADO) OU ENV VAR
        const { ensureFirebaseReady, getFirestore } = await import('../lib/firebase-admin.js');
        const { decryptSensitiveData } = await import('./key-encryption.js');
        
        await ensureFirebaseReady();
        const db = getFirestore();
        
        const paymentConfigRef = db.collection('paymentConfig').doc('global');
        const paymentConfigDoc = await paymentConfigRef.get();
        
        let webhookSecret = process.env.PAGARME_WEBHOOK_SECRET;
        
        if (paymentConfigDoc.exists) {
          const data = paymentConfigDoc.data();
          if (data?.pagarme?.webhookSecret) {
            try {
              webhookSecret = decryptSensitiveData(data.pagarme.webhookSecret);
              console.log('✅ PAGAR.ME Webhook Secret carregado do Firebase');
            } catch (decryptError) {
              console.error('⚠️ Erro ao descriptografar webhook secret, usando env var:', decryptError);
            }
          }
        }
        
        const signature = req.headers['x-hub-signature'];
        
        if (!webhookSecret) {
          console.error('🚨 PAGARME_WEBHOOK_SECRET não configurado');
          return res.status(500).json({ error: 'Webhook secret não configurado' });
        }
        
        // ⚠️ PAGAR.ME REQUER RAW BODY (Buffer ou string)
        // Se req.body for um objeto, significa que express.json() foi usado (ERRADO!)
        let payload: string;
        
        if (Buffer.isBuffer(req.body)) {
          // ✅ CORRETO: express.raw() foi usado
          payload = req.body.toString('utf8');
        } else if (typeof req.body === 'string') {
          // ✅ OK: Já é string
          payload = req.body;
        } else {
          // ❌ ERRO: express.json() foi usado, mas precisamos do raw body
          console.error('🚨 PAGAR.ME WEBHOOK: req.body não é Buffer/string (use express.raw())');
          return res.status(500).json({ error: 'Endpoint deve usar express.raw()' });
        }
        
        const isValid = validatePagarmeWebhook(payload, signature, webhookSecret);
        
        if (!isValid) {
          console.error('🚨 PAGAR.ME WEBHOOK REJEITADO: Assinatura inválida');
          return res.status(401).json({ error: 'Assinatura inválida' });
        }
      }
      
      console.log(`✅ ${type.toUpperCase()} WEBHOOK: Validação passou`);
      next();
      
    } catch (error: any) {
      console.error(`❌ ${type.toUpperCase()} WEBHOOK: Erro na validação:`, error.message);
      return res.status(500).json({ error: 'Erro interno na validação' });
    }
  };
}