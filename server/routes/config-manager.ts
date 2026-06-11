import { Router } from 'express';
import { backupCurrentConfig, restoreConfigFromBackup, detectMissingKeys, autoRecoverySystem } from '../lib/config-backup';
import { getRTDB, getFirestore } from '../lib/firebase-admin';
import { verifyFirebaseToken, requireAdmin, require2FAVerified } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { encryptSensitiveData, decryptSensitiveData } from '../security/key-encryption';
import { syncAllAcquirersToRTDB, syncWithdrawalConfigToRTDB } from '../lib/eternal-sync.js';
import { firestoreCache } from '../lib/firestore-cache.js';

const router = Router();

/**
 * 🎬 SISTEMA DE CONFIGURAÇÃO DE ADQUIRENTES (BUNNY.NET, STRIPE, EFIBANK, ETC)
 * Salva e carrega configurações dos adquirentes com criptografia AES-256-GCM
 */

interface PaymentGatewayConfig {
  defaultAcquirers: {
    pix: 'efibank' | 'woovi' | 'pagarme';
    creditCardBR: 'efibank' | 'pagarme';
    creditCardGlobal: 'stripe' | 'adyen';
    boleto: 'efibank' | 'woovi' | 'pagarme';
  };
  stripe?: {
    enabled: boolean;
    environment: 'test' | 'production';
    publicKey: string;
    secretKey: string;
    webhookSecret: string;
  };
  efibank?: {
    enabled: boolean;
    environment: 'production';
    productionClientId: string;
    productionClientSecret: string;
    payeeCode: string;
    pixKey: string;
    certificatePath: string;
  };
  adyen?: {
    enabled: boolean;
    environment: 'test' | 'live';
    apiKey: string;
    merchantAccount: string;
    clientKey: string;
  };
  woovi?: {
    enabled: boolean;
    environment: 'production';
    appId: string;
    webhookSecret: string;
  };
  pagarme?: {
    enabled: boolean;
    environment: 'test' | 'production';
    apiKey: string;
    encryptionKey: string;
  };
  bunny?: {
    enabled: boolean;
    streamLibraryId: string;
    streamApiKey: string;
    storageApiKey: string;
    storageZoneName: string;
    storageRegion: 'de' | 'ny' | 'la' | 'sg' | 'syd';
  };
  lastUpdated?: string;
  updatedBy?: string;
}

// 💾 SALVAR CONFIGURAÇÕES DE ADQUIRENTES (COM CRIPTOGRAFIA)
router.post('/payment', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔐 [PAYMENT-CONFIG] Salvando configurações de adquirentes...');
    
    const config: PaymentGatewayConfig = req.body;
    
    // 🔒 CRIPTOGRAFAR CHAVES SENSÍVEIS
    const encryptedConfig: any = {
      defaultAcquirers: config.defaultAcquirers,
      lastUpdated: new Date().toISOString(),
      updatedBy: req.user?.email || 'admin'
    };
    
    // STRIPE
    if (config.stripe) {
      encryptedConfig.stripe = {
        enabled: config.stripe.enabled,
        environment: config.stripe.environment,
        publicKey: config.stripe.publicKey ? encryptSensitiveData(config.stripe.publicKey) : '',
        secretKey: config.stripe.secretKey ? encryptSensitiveData(config.stripe.secretKey) : '',
        webhookSecret: config.stripe.webhookSecret ? encryptSensitiveData(config.stripe.webhookSecret) : ''
      };
    }
    
    // EFIBANK
    if (config.efibank) {
      encryptedConfig.efibank = {
        enabled: config.efibank.enabled,
        environment: config.efibank.environment,
        productionClientId: config.efibank.productionClientId ? encryptSensitiveData(config.efibank.productionClientId) : '',
        productionClientSecret: config.efibank.productionClientSecret ? encryptSensitiveData(config.efibank.productionClientSecret) : '',
        payeeCode: config.efibank.payeeCode || '',
        pixKey: config.efibank.pixKey || '',
        certificatePath: config.efibank.certificatePath || ''
      };
    }
    
    // ADYEN
    if (config.adyen) {
      encryptedConfig.adyen = {
        enabled: config.adyen.enabled,
        environment: config.adyen.environment,
        apiKey: config.adyen.apiKey ? encryptSensitiveData(config.adyen.apiKey) : '',
        merchantAccount: config.adyen.merchantAccount || '',
        clientKey: config.adyen.clientKey ? encryptSensitiveData(config.adyen.clientKey) : ''
      };
    }
    
    // WOOVI
    if (config.woovi) {
      encryptedConfig.woovi = {
        enabled: config.woovi.enabled,
        environment: config.woovi.environment,
        appId: config.woovi.appId ? encryptSensitiveData(config.woovi.appId) : '',
        webhookSecret: config.woovi.webhookSecret ? encryptSensitiveData(config.woovi.webhookSecret) : ''
      };
    }
    
    // PAGARME
    if (config.pagarme) {
      encryptedConfig.pagarme = {
        enabled: config.pagarme.enabled,
        environment: config.pagarme.environment,
        apiKey: config.pagarme.apiKey ? encryptSensitiveData(config.pagarme.apiKey) : '',
        encryptionKey: config.pagarme.encryptionKey ? encryptSensitiveData(config.pagarme.encryptionKey) : ''
      };
    }
    
    // 🐰 BUNNY.NET
    if (config.bunny) {
      encryptedConfig.bunny = {
        enabled: config.bunny.enabled,
        streamLibraryId: config.bunny.streamLibraryId || '',
        streamApiKey: config.bunny.streamApiKey ? encryptSensitiveData(config.bunny.streamApiKey) : '',
        storageApiKey: config.bunny.storageApiKey ? encryptSensitiveData(config.bunny.storageApiKey) : '',
        storageZoneName: config.bunny.storageZoneName || '',
        storageRegion: config.bunny.storageRegion || 'de'
      };
      console.log('🐰 [BUNNY] Credenciais criptografadas com AES-256-GCM!');
    }
    
    // Salvar no Firestore
    const db = getFirestore();
    await db.collection('system-config').doc('payment-gateways').set(encryptedConfig, { merge: true });
    
    console.log('✅ [PAYMENT-CONFIG] Configurações salvas com sucesso!');
    
    syncAllAcquirersToRTDB(encryptedConfig).catch(err => 
      console.error('⚠️ [ETERNAL-SYNC] Erro async ao sincronizar adquirentes:', err?.message)
    );
    
    res.json({
      success: true,
      message: 'Configurações de adquirentes salvas com segurança!',
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('❌ [PAYMENT-CONFIG] Erro ao salvar:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao salvar configurações',
      details: error.message
    });
  }
});

// 🔄 CARREGAR CONFIGURAÇÕES DE ADQUIRENTES (COM DESCRIPTOGRAFIA)
router.get('/payment', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔄 [PAYMENT-CONFIG] Carregando configurações...');
    
    const db = getFirestore();
    const doc = await db.collection('system-config').doc('payment-gateways').get();
    
    if (!doc.exists) {
      console.log('⚠️ [PAYMENT-CONFIG] Nenhuma configuração encontrada - retornando padrão');
      return res.json({
        success: true,
        defaultAcquirers: {
          pix: 'woovi',
          creditCardBR: 'efibank',
          creditCardGlobal: 'stripe',
          boleto: 'woovi'
        }
      });
    }
    
    const encryptedData = doc.data() as any;
    
    // 🔓 DESCRIPTOGRAFAR CHAVES SENSÍVEIS
    const config: any = {
      defaultAcquirers: encryptedData.defaultAcquirers,
      lastUpdated: encryptedData.lastUpdated,
      updatedBy: encryptedData.updatedBy
    };
    
    // STRIPE
    if (encryptedData.stripe) {
      config.stripe = {
        enabled: encryptedData.stripe.enabled,
        environment: encryptedData.stripe.environment,
        publicKey: encryptedData.stripe.publicKey ? decryptSensitiveData(encryptedData.stripe.publicKey) : '',
        secretKey: encryptedData.stripe.secretKey ? decryptSensitiveData(encryptedData.stripe.secretKey) : '',
        webhookSecret: encryptedData.stripe.webhookSecret ? decryptSensitiveData(encryptedData.stripe.webhookSecret) : ''
      };
    }
    
    // EFIBANK
    if (encryptedData.efibank) {
      config.efibank = {
        enabled: encryptedData.efibank.enabled,
        environment: encryptedData.efibank.environment,
        productionClientId: encryptedData.efibank.productionClientId ? decryptSensitiveData(encryptedData.efibank.productionClientId) : '',
        productionClientSecret: encryptedData.efibank.productionClientSecret ? decryptSensitiveData(encryptedData.efibank.productionClientSecret) : '',
        payeeCode: encryptedData.efibank.payeeCode || '',
        pixKey: encryptedData.efibank.pixKey || '',
        certificatePath: encryptedData.efibank.certificatePath || ''
      };
    }
    
    // ADYEN
    if (encryptedData.adyen) {
      config.adyen = {
        enabled: encryptedData.adyen.enabled,
        environment: encryptedData.adyen.environment,
        apiKey: encryptedData.adyen.apiKey ? decryptSensitiveData(encryptedData.adyen.apiKey) : '',
        merchantAccount: encryptedData.adyen.merchantAccount || '',
        clientKey: encryptedData.adyen.clientKey ? decryptSensitiveData(encryptedData.adyen.clientKey) : ''
      };
    }
    
    // WOOVI
    if (encryptedData.woovi) {
      config.woovi = {
        enabled: encryptedData.woovi.enabled,
        environment: encryptedData.woovi.environment,
        appId: encryptedData.woovi.appId ? decryptSensitiveData(encryptedData.woovi.appId) : '',
        webhookSecret: encryptedData.woovi.webhookSecret ? decryptSensitiveData(encryptedData.woovi.webhookSecret) : ''
      };
    }
    
    // PAGARME
    if (encryptedData.pagarme) {
      config.pagarme = {
        enabled: encryptedData.pagarme.enabled,
        environment: encryptedData.pagarme.environment,
        apiKey: encryptedData.pagarme.apiKey ? decryptSensitiveData(encryptedData.pagarme.apiKey) : '',
        encryptionKey: encryptedData.pagarme.encryptionKey ? decryptSensitiveData(encryptedData.pagarme.encryptionKey) : ''
      };
    }
    
    // 🐰 BUNNY.NET
    if (encryptedData.bunny) {
      config.bunny = {
        enabled: encryptedData.bunny.enabled,
        streamLibraryId: encryptedData.bunny.streamLibraryId || '',
        streamApiKey: encryptedData.bunny.streamApiKey ? decryptSensitiveData(encryptedData.bunny.streamApiKey) : '',
        storageApiKey: encryptedData.bunny.storageApiKey ? decryptSensitiveData(encryptedData.bunny.storageApiKey) : '',
        storageZoneName: encryptedData.bunny.storageZoneName || '',
        storageRegion: encryptedData.bunny.storageRegion || 'de'
      };
      console.log('🐰 [BUNNY] Credenciais descriptografadas com sucesso!');
    }
    
    console.log('✅ [PAYMENT-CONFIG] Configurações carregadas!');
    
    res.json({
      success: true,
      ...config
    });
    
  } catch (error: any) {
    console.error('❌ [PAYMENT-CONFIG] Erro ao carregar:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar configurações',
      details: error.message
    });
  }
});

/**
 * 💰 SISTEMA DE TAXAS ETERNAS
 * Salva e carrega taxas do Firebase RTDB - NUNCA MAIS SOMEM!
 */

interface EternalFees {
  pix: {
    fixedFee: number;
    percentFee: number;
    releaseDays: number;
  };
  creditCardBR: {
    fixedFee: number;
    percentFee: number;
    releaseDays: number;
    installmentFees?: {
      '1x': number;
      '6x': number;
      '9x': number;
      '12x': number;
    };
  };
  creditCardGlobal: {
    fixedFee: number;
    percentFee: number;
    releaseDays: number;
  };
  boleto: {
    fixedFee: number;
    percentFee: number;
    releaseDays: number;
  };
  lastUpdated: string;
  updatedBy: string;
  eternal: boolean;
}

// 💾 SALVAR TAXAS ETERNAMENTE
// 🔒 CRITICAL SECURITY: Apenas admins podem modificar taxas do sistema
router.post('/fees', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('💰 [ETERNAL-FEES] Salvando taxas eternamente no Firebase RTDB...');
    
    const fees: EternalFees = {
      pix: {
        fixedFee: req.body.pixFixedFee || 0,
        percentFee: req.body.pixPercentFee || 0,
        releaseDays: req.body.pixReleaseDays || 0
      },
      creditCardBR: {
        fixedFee: req.body.creditCardBRFixedFee || 0,
        percentFee: req.body.creditCardBRPercentFee || 0,
        releaseDays: req.body.creditCardBRReleaseDays || 0,
        installmentFees: {
          '1x': req.body.creditCardBR1x || 5.2,
          '6x': req.body.creditCardBR6x || 6.9,
          '9x': req.body.creditCardBR9x || 7.29,
          '12x': req.body.creditCardBR12x || 17.90
        }
      },
      creditCardGlobal: {
        fixedFee: req.body.creditCardGlobalFixedFee || 0,
        percentFee: req.body.creditCardGlobalPercentFee || 0,
        releaseDays: req.body.creditCardGlobalReleaseDays || 0
      },
      boleto: {
        fixedFee: req.body.boletoFixedFee || 0,
        percentFee: req.body.boletoPercentFee || 0,
        releaseDays: req.body.boletoReleaseDays || 0
      },
      lastUpdated: new Date().toISOString(),
      updatedBy: req.body.adminEmail || 'admin',
      eternal: true
    };
    
    const rtdb = getRTDB();
    await rtdb.ref('tetri-system/eternal-fees').set(fees);
    
    syncWithdrawalConfigToRTDB({
      pixReleaseDays: fees.pix.releaseDays,
      creditCardBRReleaseDays: fees.creditCardBR.releaseDays,
      creditCardGlobalReleaseDays: fees.creditCardGlobal.releaseDays,
      boletoReleaseDays: fees.boleto.releaseDays,
    }).catch(err => console.error('⚠️ [ETERNAL-SYNC] Erro async prazos:', err?.message));
    
    console.log('✅ [ETERNAL-FEES] Taxas salvas eternamente com sucesso!');
    console.log('💰 PIX:', fees.pix);
    console.log('💳 Cartão BR:', fees.creditCardBR);
    console.log('🌍 Cartão Global:', fees.creditCardGlobal);
    console.log('📄 Boleto:', fees.boleto);
    
    res.json({
      success: true,
      message: 'Taxas salvas eternamente no Firebase RTDB! Nunca mais vão sumir!',
      fees,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [ETERNAL-FEES] Erro ao salvar taxas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao salvar taxas eternamente',
      details: error.message
    });
  }
});

// 🔄 CARREGAR TAXAS ETERNAS
// 🔒 CRITICAL SECURITY: Autenticação obrigatória (sellers precisam ver taxas para calcular lucros)
router.get('/fees', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔄 [ETERNAL-FEES] Carregando taxas eternas do Firebase RTDB...');
    
    const rtdb = getRTDB();
    const snapshot = await rtdb.ref('tetri-system/eternal-fees').once('value');
    
    if (snapshot.exists()) {
      const fees = snapshot.val() as EternalFees;
      console.log('✅ [ETERNAL-FEES] Taxas eternas encontradas!');
      console.log('📅 Última atualização:', fees.lastUpdated);
      console.log('👤 Atualizado por:', fees.updatedBy);
      
      res.json({
        success: true,
        fees,
        message: 'Taxas eternas carregadas do Firebase RTDB!'
      });
    } else {
      console.log('⚠️ [ETERNAL-FEES] Nenhuma taxa eterna encontrada - usando padrão');
      
      // Retornar taxas padrão configuradas pelo usuário
      const defaultFees: EternalFees = {
        pix: { 
          fixedFee: 249,   // R$ 2,49
          percentFee: 2.99, 
          releaseDays: 0 
        },
        creditCardBR: { 
          fixedFee: 249,    // R$ 2,49
          percentFee: 5.2,   // Taxa base 1x
          releaseDays: 30,
          installmentFees: {
            '1x': 5.2,
            '6x': 6.9,
            '9x': 7.29,
            '12x': 17.90
          }
        },
        creditCardGlobal: { 
          fixedFee: 49, 
          percentFee: 4.99, 
          releaseDays: 30 
        },
        boleto: { 
          fixedFee: 349, 
          percentFee: 0, 
          releaseDays: 2 
        },
        lastUpdated: new Date().toISOString(),
        updatedBy: 'system-default',
        eternal: true
      };
      
      res.json({
        success: true,
        fees: defaultFees,
        message: 'Taxas padrão (ainda não foram configuradas taxas personalizadas)'
      });
    }
    
  } catch (error) {
    console.error('❌ [ETERNAL-FEES] Erro ao carregar taxas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar taxas eternas',
      details: error.message
    });
  }
});

/**
 * 🛡️ ENDPOINT DE GESTÃO DE CONFIGURAÇÕES
 * Sistema robusto para backup e restauração de chaves
 */

// 💾 BACKUP MANUAL DAS CONFIGURAÇÕES
// 🔒 CRITICAL SECURITY: Apenas admins podem fazer backup de configurações
router.post('/backup', verifyFirebaseToken, requireAdmin, require2FAVerified, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📋 [ENDPOINT] Iniciando backup manual das configurações...');
    await backupCurrentConfig();
    
    const missing = detectMissingKeys();
    
    res.json({
      success: true,
      message: 'Backup realizado com sucesso!',
      timestamp: new Date().toISOString(),
      missingKeys: missing.length,
      missingKeysList: missing
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao realizar backup',
      details: error.message
    });
  }
});

// 🔄 RESTAURAR CONFIGURAÇÕES DO BACKUP
// 🔒 CRITICAL SECURITY: Apenas admins podem restaurar configurações
router.get('/restore', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('📋 [ENDPOINT] Buscando backup para restauração...');
    const config = await restoreConfigFromBackup();
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Nenhum backup encontrado no Firebase'
      });
    }
    
    const missing = detectMissingKeys();
    
    // Preparar instruções de restauração
    const instructions = {
      firebase_frontend: [],
      firebase_backend: [],
      ai_services: [],
      payment_services: []
    };
    
    // Firebase Frontend
    if (config.firebase.apiKey) instructions.firebase_frontend.push(`VITE_FIREBASE_API_KEY=${config.firebase.apiKey}`);
    if (config.firebase.authDomain) instructions.firebase_frontend.push(`VITE_FIREBASE_AUTH_DOMAIN=${config.firebase.authDomain}`);
    if (config.firebase.databaseURL) instructions.firebase_frontend.push(`VITE_FIREBASE_DATABASE_URL=${config.firebase.databaseURL}`);
    if (config.firebase.projectId) instructions.firebase_frontend.push(`VITE_FIREBASE_PROJECT_ID=${config.firebase.projectId}`);
    if (config.firebase.storageBucket) instructions.firebase_frontend.push(`VITE_FIREBASE_STORAGE_BUCKET=${config.firebase.storageBucket}`);
    if (config.firebase.messagingSenderId) instructions.firebase_frontend.push(`VITE_FIREBASE_MESSAGING_SENDER_ID=${config.firebase.messagingSenderId}`);
    if (config.firebase.appId) instructions.firebase_frontend.push(`VITE_FIREBASE_APP_ID=${config.firebase.appId}`);
    if (config.firebase.measurementId) instructions.firebase_frontend.push(`VITE_FIREBASE_MEASUREMENT_ID=${config.firebase.measurementId}`);
    
    // Firebase Backend
    if (config.firebase.projectId) instructions.firebase_backend.push(`FIREBASE_PROJECT_ID=${config.firebase.projectId}`);
    if (config.firebase.clientEmail) instructions.firebase_backend.push(`FIREBASE_CLIENT_EMAIL=${config.firebase.clientEmail}`);
    if (config.firebase.privateKey) instructions.firebase_backend.push(`FIREBASE_PRIVATE_KEY=${config.firebase.privateKey}`);
    
    // AI Services
    if (config.ai.openaiApiKey) instructions.ai_services.push(`OPENAI_API_KEY=${config.ai.openaiApiKey}`);
    
    // Payment Services
    if (config.payments.stripeSecretKey) instructions.payment_services.push(`STRIPE_SECRET_KEY=${config.payments.stripeSecretKey}`);
    if (config.payments.stripePublishableKey) instructions.payment_services.push(`VITE_STRIPE_PUBLISHABLE_KEY=${config.payments.stripePublishableKey}`);
    if (config.payments.efibankClientIdProd) instructions.payment_services.push(`EFIBANK_CLIENT_ID=${config.payments.efibankClientIdProd}`);
    if (config.payments.efibankClientSecretProd) instructions.payment_services.push(`EFIBANK_CLIENT_SECRET=${config.payments.efibankClientSecretProd}`);
    if (config.payments.efibankPixKey) instructions.payment_services.push(`EFIBANK_PIX_KEY=${config.payments.efibankPixKey}`);
    
    res.json({
      success: true,
      message: 'Backup encontrado com sucesso!',
      backup: {
        date: config.backupDate,
        environment: config.environment,
        version: config.version
      },
      missing_keys: missing,
      total_missing: missing.length,
      restoration_instructions: instructions,
      instructions_text: [
        '🔥 === INSTRUÇÕES DE RESTAURAÇÃO ===',
        '',
        '1. Acesse o Replit Secrets no seu projeto',
        '2. Adicione as seguintes chaves:',
        '',
        '📱 FIREBASE FRONTEND:',
        ...instructions.firebase_frontend,
        '',
        '🔥 FIREBASE BACKEND:',
        ...instructions.firebase_backend,
        '',
        '🤖 AI SERVICES:',
        ...instructions.ai_services,
        '',
        '💳 PAYMENT SERVICES:',
        ...instructions.payment_services,
        '',
        '3. Reinicie o servidor após adicionar as chaves',
        '4. Acesse /api/config/status para verificar'
      ]
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao restaurar configurações',
      details: error.message
    });
  }
});

// 🔍 STATUS DAS CONFIGURAÇÕES
router.get('/status', async (req, res) => {
  try {
    const missing = detectMissingKeys();
    const hasBackup = await restoreConfigFromBackup();
    
    res.json({
      success: true,
      status: {
        all_keys_present: missing.length === 0,
        missing_keys_count: missing.length,
        missing_keys: missing,
        backup_available: !!hasBackup,
        backup_date: hasBackup?.backupDate || null,
        environment: process.env.NODE_ENV || 'unknown',
        timestamp: new Date().toISOString()
      },
      firebase: {
        frontend_configured: !!process.env.VITE_FIREBASE_API_KEY && !!process.env.VITE_FIREBASE_PROJECT_ID,
        backend_configured: !!process.env.FIREBASE_PROJECT_ID && !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY
      },
      ai: {
        openai_configured: !!process.env.OPENAI_API_KEY
      },
      payments: {
        stripe_configured: !!process.env.STRIPE_SECRET_KEY,
        efibank_configured: !!process.env.EFIBANK_CLIENT_ID && !!process.env.EFIBANK_CLIENT_SECRET
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar status',
      details: error.message
    });
  }
});

// 🚨 AUTO-RECOVERY ENDPOINT
router.get('/auto-recovery', async (req, res) => {
  try {
    console.log('🚨 [ENDPOINT] Iniciando sistema de auto-recuperação...');
    const success = await autoRecoverySystem();
    
    const missing = detectMissingKeys();
    
    res.json({
      success,
      message: success ? 'Sistema de recuperação executado com sucesso!' : 'Falha no sistema de recuperação',
      missing_keys: missing,
      instructions: success ? 'Verifique os logs do servidor para instruções detalhadas' : 'Não foi possível recuperar as configurações'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro no sistema de auto-recuperação',
      details: error.message
    });
  }
});

// 🔧 SETUP RÁPIDO - PÁGINA HTML PARA FACILITAR CONFIGURAÇÃO
router.get('/setup', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🛡️ VolatusPay - Configuração de Chaves</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #0f0f0f; color: #fff; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; }
        .section { background: #1a1a1a; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #333; }
        .button { background: #16a34a; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; margin: 10px; font-weight: bold; }
        .button:hover { background: #15803d; }
        .status { padding: 10px; border-radius: 8px; margin: 10px 0; }
        .success { background: #065f46; border: 1px solid #10b981; }
        .error { background: #7f1d1d; border: 1px solid #ef4444; }
        .warning { background: #92400e; border: 1px solid #f59e0b; }
        .code { background: #000; color: #0f0; padding: 15px; border-radius: 8px; font-family: 'Courier New', monospace; white-space: pre-wrap; font-size: 12px; overflow-x: auto; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .loading { display: none; color: #60a5fa; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛡️ VolatusPay - Configuração de Chaves</h1>
            <p>Sistema de backup e restauração automática de configurações</p>
        </div>
        
        <div class="section">
            <h2>📊 Status Atual</h2>
            <button class="button" onclick="checkStatus()">🔍 Verificar Status</button>
            <div id="status-result"></div>
        </div>
        
        <div class="grid">
            <div class="section">
                <h2>💾 Backup</h2>
                <p>Salva suas configurações atuais no Firebase</p>
                <button class="button" onclick="createBackup()">💾 Criar Backup</button>
                <div id="backup-result"></div>
            </div>
            
            <div class="section">
                <h2>🔄 Restaurar</h2>
                <p>Busca configurações salvas no Firebase</p>
                <button class="button" onclick="restoreBackup()">🔄 Restaurar Backup</button>
                <div id="restore-result"></div>
            </div>
        </div>
        
        <div class="section">
            <h2>🚨 Auto-Recuperação</h2>
            <p>Sistema inteligente que detecta chaves ausentes e mostra como restaurar</p>
            <button class="button" onclick="autoRecover()">🚨 Executar Auto-Recuperação</button>
            <div id="recovery-result"></div>
        </div>
        
        <div class="section">
            <h2>📋 Instruções</h2>
            <div class="status warning">
                <strong>⚠️ Como usar este sistema:</strong><br>
                1. <strong>Backup:</strong> Execute sempre que tiver todas as chaves funcionando<br>
                2. <strong>Restaurar:</strong> Use quando trocar de ambiente/conta Replit<br>
                3. <strong>Auto-Recuperação:</strong> Detecta problemas e mostra instruções<br>
                4. <strong>Importante:</strong> Backup fica salvo eternamente no Firebase RTDB
            </div>
        </div>
    </div>

    <script>
        function showLoading(id) {
            document.getElementById(id).innerHTML = '<div class="loading">🔄 Carregando...</div>';
        }
        
        async function checkStatus() {
            showLoading('status-result');
            try {
                const response = await fetch('/api/config/status');
                const data = await response.json();
                
                let html = '<div class="status ' + (data.status.all_keys_present ? 'success' : 'error') + '">';
                html += '<strong>' + (data.status.all_keys_present ? '✅ Todas as chaves estão presentes!' : '❌ Chaves ausentes detectadas') + '</strong><br>';
                html += 'Chaves ausentes: ' + data.status.missing_keys_count + '<br>';
                html += 'Backup disponível: ' + (data.status.backup_available ? '✅ Sim' : '❌ Não') + '<br>';
                if (data.status.backup_date) html += 'Data do backup: ' + new Date(data.status.backup_date).toLocaleString('pt-BR') + '<br>';
                html += '</div>';
                
                if (data.status.missing_keys.length > 0) {
                    html += '<div class="code">Chaves ausentes:\\n' + data.status.missing_keys.join('\\n') + '</div>';
                }
                
                document.getElementById('status-result').innerHTML = html;
            } catch (error) {
                document.getElementById('status-result').innerHTML = '<div class="status error">❌ Erro: ' + error.message + '</div>';
            }
        }
        
        async function createBackup() {
            showLoading('backup-result');
            try {
                const response = await fetch('/api/config/backup', { method: 'POST' });
                const data = await response.json();
                
                let html = '<div class="status ' + (data.success ? 'success' : 'error') + '">';
                html += '<strong>' + (data.success ? '✅ Backup criado com sucesso!' : '❌ Erro no backup') + '</strong><br>';
                html += data.message + '<br>';
                if (data.missingKeys) html += 'Chaves ausentes: ' + data.missingKeys;
                html += '</div>';
                
                document.getElementById('backup-result').innerHTML = html;
            } catch (error) {
                document.getElementById('backup-result').innerHTML = '<div class="status error">❌ Erro: ' + error.message + '</div>';
            }
        }
        
        async function restoreBackup() {
            showLoading('restore-result');
            try {
                const response = await fetch('/api/config/restore');
                const data = await response.json();
                
                if (data.success) {
                    let html = '<div class="status success"><strong>✅ Backup encontrado!</strong><br>';
                    html += 'Data: ' + new Date(data.backup.date).toLocaleString('pt-BR') + '<br>';
                    html += 'Chaves ausentes: ' + data.total_missing + '</div>';
                    
                    if (data.instructions_text) {
                        html += '<div class="code">' + data.instructions_text.join('\\n') + '</div>';
                    }
                    
                    document.getElementById('restore-result').innerHTML = html;
                } else {
                    document.getElementById('restore-result').innerHTML = '<div class="status error">❌ ' + data.error + '</div>';
                }
            } catch (error) {
                document.getElementById('restore-result').innerHTML = '<div class="status error">❌ Erro: ' + error.message + '</div>';
            }
        }
        
        async function autoRecover() {
            showLoading('recovery-result');
            try {
                const response = await fetch('/api/config/auto-recovery');
                const data = await response.json();
                
                let html = '<div class="status ' + (data.success ? 'success' : 'error') + '">';
                html += '<strong>' + (data.success ? '✅ Sistema executado!' : '❌ Falha na recuperação') + '</strong><br>';
                html += data.message + '<br>';
                if (data.missing_keys.length > 0) {
                    html += 'Chaves ausentes: ' + data.missing_keys.length + '<br>';
                    html += '</div>';
                    html += '<div class="code">Chaves ausentes:\\n' + data.missing_keys.join('\\n') + '</div>';
                    html += '<div class="status warning"><strong>📋 Verifique os logs do servidor para instruções completas de restauração!</strong></div>';
                } else {
                    html += 'Todas as chaves estão presentes!</div>';
                }
                
                document.getElementById('recovery-result').innerHTML = html;
            } catch (error) {
                document.getElementById('recovery-result').innerHTML = '<div class="status error">❌ Erro: ' + error.message + '</div>';
            }
        }
        
        // Verificar status automaticamente ao carregar
        window.onload = () => checkStatus();
    </script>
</body>
</html>
  `;
  
  res.send(html);
});

// ==========================================
// 📡 CONFIGURAÇÃO DE WEBHOOK DO SELLER
// ==========================================

// 💾 SALVAR URL DE WEBHOOK DO SELLER
router.post('/webhook-url', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user?.uid;
    if (!sellerId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { webhookUrl, webhookSecret } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({ error: 'URL do webhook é obrigatória' });
    }

    // Validar URL
    try {
      new URL(webhookUrl);
    } catch {
      return res.status(400).json({ error: 'URL inválida' });
    }

    // Validar que é HTTPS em produção
    if (!webhookUrl.startsWith('https://') && process.env.NODE_ENV === 'production') {
      return res.status(400).json({ error: 'Webhook URL deve usar HTTPS em produção' });
    }

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({ error: 'Banco de dados não disponível' });
    }

    // Salvar configuração do webhook
    const webhookConfig: any = {
      webhookUrl,
      updatedAt: new Date().toISOString()
    };

    // Criptografar secret se fornecido
    if (webhookSecret) {
      webhookConfig.webhookSecret = encryptSensitiveData(webhookSecret);
    }

    await db.collection('users').doc(sellerId).update({
      webhookUrl,
      'settings.webhookUrl': webhookUrl,
      'settings.webhookConfig': webhookConfig
    });

    // 🐘 DUAL-WRITE → Neon (fire-and-forget)
    import('../lib/neon-sellers.js').then(({ neonUpdateUser }) => {
      neonUpdateUser(sellerId, { webhookUrl });
    }).catch(() => {});

    console.log(`✅ Webhook URL configurada para seller ${sellerId}: ${webhookUrl.substring(0, 50)}...`);

    res.json({
      success: true,
      message: 'URL de webhook configurada com sucesso',
      webhookUrl
    });

  } catch (error: any) {
    console.error('❌ Erro ao salvar webhook URL:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração', details: error.message });
  }
});

// 📖 OBTER CONFIGURAÇÃO DE WEBHOOK DO SELLER
router.get('/webhook-url', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user?.uid;
    if (!sellerId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({ error: 'Banco de dados não disponível' });
    }

    const userData = await firestoreCache.getUser(sellerId);
    
    if (!userData) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const webhookUrl = userData?.webhookUrl || userData?.settings?.webhookUrl || null;
    const hasSecret = !!(userData?.settings?.webhookConfig?.webhookSecret);

    res.json({
      success: true,
      webhookUrl,
      hasSecret,
      events: [
        'payment.confirmed',
        'payment.failed',
        'payment.refunded',
        'subscription.created',
        'subscription.renewed',
        'subscription.cancelled',
        'subscription.payment_failed',
        'delivery.shipped',
        'delivery.delivered',
        'delivery.failed',
        'delivery.returned',
        'boleto.created',
        'boleto.paid',
        'boleto.expired'
      ]
    });

  } catch (error: any) {
    console.error('❌ Erro ao buscar webhook URL:', error);
    res.status(500).json({ error: 'Erro ao buscar configuração', details: error.message });
  }
});

// 🧪 TESTAR WEBHOOK DO SELLER
router.post('/webhook-test', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user?.uid;
    if (!sellerId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({ error: 'Banco de dados não disponível' });
    }

    const userData = await firestoreCache.getUser(sellerId);
    const webhookUrl = userData?.webhookUrl || userData?.settings?.webhookUrl;

    if (!webhookUrl) {
      return res.status(400).json({ error: 'Nenhuma URL de webhook configurada' });
    }

    // Enviar webhook de teste
    const testPayload = {
      event: 'test.webhook',
      tenantId: sellerId,
      data: {
        message: 'Este é um webhook de teste da VolatusPay',
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      apiVersion: '2025-11-03'
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Volatus-Pay-Event': 'test.webhook',
          'X-Volatus-Pay-Tenant': sellerId,
          'User-Agent': 'Volatus-Pay-Webhook/1.0'
        },
        body: JSON.stringify(testPayload)
      });

      const responseText = await response.text();

      if (response.ok) {
        res.json({
          success: true,
          message: 'Webhook de teste enviado com sucesso!',
          httpStatus: response.status,
          response: responseText.substring(0, 500)
        });
      } else {
        res.json({
          success: false,
          message: 'Webhook falhou',
          httpStatus: response.status,
          response: responseText.substring(0, 500)
        });
      }
    } catch (fetchError: any) {
      res.json({
        success: false,
        message: 'Não foi possível conectar à URL do webhook',
        error: fetchError.message
      });
    }

  } catch (error: any) {
    console.error('❌ Erro ao testar webhook:', error);
    res.status(500).json({ error: 'Erro ao testar webhook', details: error.message });
  }
});

// 🗑️ REMOVER WEBHOOK DO SELLER
router.delete('/webhook-url', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.user?.uid;
    if (!sellerId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({ error: 'Banco de dados não disponível' });
    }

    const { FieldValue } = await import('firebase-admin/firestore');

    await db.collection('users').doc(sellerId).update({
      webhookUrl: FieldValue.delete(),
      'settings.webhookUrl': FieldValue.delete(),
      'settings.webhookConfig': FieldValue.delete()
    });

    console.log(`🗑️ Webhook URL removida para seller ${sellerId}`);

    res.json({
      success: true,
      message: 'Configuração de webhook removida'
    });

  } catch (error: any) {
    console.error('❌ Erro ao remover webhook URL:', error);
    res.status(500).json({ error: 'Erro ao remover configuração', details: error.message });
  }
});

export default router;