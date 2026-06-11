import { getRTDB } from './firebase-admin';

/**
 * 🔄 SISTEMA DE BACKUP ETERNO DE CONFIGURAÇÕES
 * 💾 Salva todas as chaves importantes no Firebase RTDB
 * 🛡️ Protege contra perda de dados ao trocar de ambiente
 * ♻️ Auto-restauração inteligente quando chaves estão ausentes
 */

export interface PlatformConfig {
  // Firebase configs
  firebase: {
    apiKey: string;
    authDomain: string;
    databaseURL: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId: string;
    clientEmail: string;
    privateKey: string;
    clientId: string;
  };
  
  // AI Services
  ai: {
    openaiApiKey: string;
  };
  
  // Payment Services - SISTEMA COMPLETO
  payments: {
    // Stripe
    stripeSecretKey: string;
    stripePublishableKey: string;
    
    // EfíBank Production
    efibankClientIdProd: string;
    efibankClientSecretProd: string;
    
    // EfíBank Sandbox  
    efibankClientIdSandbox: string;
    efibankClientSecretSandbox: string;
    
    // EfíBank Common
    efibankPayeeCode: string;
    efibankPixKey: string;
    efibankSandbox: boolean;
    
    // Adyen (se configurado)
    adyenMerchantAccount: string;
    adyenClientKey: string;
    adyenApiKey: string;
    adyenHmacKey: string;
  };
  
  // Metadata
  backupDate: string;
  environment: string;
  version: string;
  eternoPermanente: boolean;
}

/**
 * 💾 SALVAR CONFIGURAÇÃO ATUAL NO FIREBASE
 * Cria backup eterno das configurações atuais
 */
export async function backupCurrentConfig(): Promise<void> {
  try {
    console.log('💾 [CONFIG-BACKUP] Salvando configuração atual no Firebase...');
    
    const rtdb = getRTDB();
    
    const config: PlatformConfig = {
      firebase: {
        apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || '',
        databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL || '',
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || '',
        measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || '',
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || '',
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '',
        clientId: process.env.FIREBASE_ADMIN_CLIENT_ID || process.env.FIREBASE_CLIENT_ID || '',
      },
      ai: {
        openaiApiKey: process.env.OPENAI_API_KEY || '',
      },
      payments: {
        // Stripe
        stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
        
        // EfíBank Production  
        efibankClientIdProd: process.env.EFIBANK_CLIENT_ID || '',
        efibankClientSecretProd: process.env.EFIBANK_CLIENT_SECRET || '',
        
        // EfíBank Sandbox
        efibankClientIdSandbox: process.env.EFIBANK_CLIENT_ID_SANDBOX || '',
        efibankClientSecretSandbox: process.env.EFIBANK_CLIENT_SECRET_SANDBOX || '',
        
        // EfíBank Common
        efibankPayeeCode: process.env.EFIBANK_PAYEE_CODE || '',
        efibankPixKey: process.env.EFIBANK_PIX_KEY || '',
        efibankSandbox: process.env.EFIBANK_SANDBOX === 'true',
        
        // Adyen (se configurado)
        adyenMerchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || '',
        adyenClientKey: process.env.ADYEN_CLIENT_KEY || '',
        adyenApiKey: process.env.ADYEN_API_KEY || '',
        adyenHmacKey: process.env.ADYEN_HMAC_KEY || '',
      },
      backupDate: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '2.0.0',
      eternoPermanente: true
    };
    
    // Filtrar apenas chaves que não estão vazias
    const validConfig = filterValidConfig(config);
    
    if (Object.keys(validConfig.firebase).length > 0 || validConfig.ai.openaiApiKey) {
      await rtdb.ref('tetri-system/config-backup').set(validConfig);
      console.log('✅ [CONFIG-BACKUP] Configuração salva com sucesso no Firebase!');
      console.log(`📊 [CONFIG-BACKUP] ${countConfigKeys(validConfig)} chaves salvas`);
    } else {
      console.log('⚠️ [CONFIG-BACKUP] Nenhuma configuração válida para backup');
    }
    
  } catch (error) {
    console.error('❌ [CONFIG-BACKUP] Erro ao salvar configuração:', error.message);
  }
}

/**
 * 🔄 RESTAURAR CONFIGURAÇÃO DO FIREBASE
 * Busca e restaura automaticamente as configurações salvas
 */
export async function restoreConfigFromBackup(): Promise<PlatformConfig | null> {
  try {
    console.log('🔄 [CONFIG-RESTORE] Buscando configuração no Firebase...');
    
    const rtdb = getRTDB();
    const snapshot = await rtdb.ref('tetri-system/config-backup').once('value');
    
    if (snapshot.exists()) {
      const config = snapshot.val() as PlatformConfig;
      console.log('✅ [CONFIG-RESTORE] Configuração encontrada no Firebase!');
      console.log(`📅 [CONFIG-RESTORE] Backup de: ${config.backupDate}`);
      console.log(`📊 [CONFIG-RESTORE] ${countConfigKeys(config)} chaves disponíveis`);
      return config;
    } else {
      console.log('⚠️ [CONFIG-RESTORE] Nenhum backup encontrado no Firebase');
      return null;
    }
    
  } catch (error) {
    console.error('❌ [CONFIG-RESTORE] Erro ao restaurar configuração:', error.message);
    return null;
  }
}

/**
 * 🔍 AUTO-DETECÇÃO DE CHAVES AUSENTES
 * Verifica se alguma chave importante está faltando
 */
export function detectMissingKeys(): string[] {
  const missing: string[] = [];
  
  // Verificar Firebase frontend
  if (!process.env.VITE_FIREBASE_API_KEY && !process.env.FIREBASE_API_KEY) missing.push('VITE_FIREBASE_API_KEY');
  if (!process.env.VITE_FIREBASE_PROJECT_ID && !process.env.FIREBASE_PROJECT_ID) missing.push('VITE_FIREBASE_PROJECT_ID');
  
  // Verificar Firebase backend
  if (!process.env.FIREBASE_PROJECT_ID) missing.push('FIREBASE_PROJECT_ID');
  if (!process.env.FIREBASE_ADMIN_CLIENT_EMAIL && !process.env.FIREBASE_CLIENT_EMAIL) missing.push('FIREBASE_ADMIN_CLIENT_EMAIL');
  if (!process.env.FIREBASE_ADMIN_PRIVATE_KEY && !process.env.FIREBASE_PRIVATE_KEY) missing.push('FIREBASE_ADMIN_PRIVATE_KEY');
  
  // Verificar AI
  if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  
  // Verificar Payments
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.EFIBANK_CLIENT_ID) missing.push('EFIBANK_CLIENT_ID');
  if (!process.env.EFIBANK_CLIENT_SECRET) missing.push('EFIBANK_CLIENT_SECRET');
  
  return missing;
}

/**
 * 🛡️ SISTEMA DE AUTO-RECUPERAÇÃO
 * Automaticamente tenta restaurar chaves ausentes
 */
export async function autoRecoverySystem(): Promise<boolean> {
  try {
    const missing = detectMissingKeys();
    
    if (missing.length === 0) {
      console.log('✅ [AUTO-RECOVERY] Todas as chaves estão presentes');
      return true;
    }
    
    console.log(`🔍 [AUTO-RECOVERY] ${missing.length} chaves ausentes detectadas:`, missing);
    
    const backupConfig = await restoreConfigFromBackup();
    if (!backupConfig) {
      console.log('❌ [AUTO-RECOVERY] Não foi possível recuperar do backup');
      return false;
    }
    
    // 🔐 Helper para sanitizar secrets nos logs (previne vazamento)
    const sanitize = (secret: string): string => {
      if (!secret || secret.length < 8) return '***';
      return `${secret.substring(0, 8)}***`;
    };
    
    console.log('💡 [AUTO-RECOVERY] Backup encontrado! Configure as seguintes chaves no Replit Secrets:');
    console.log('🔐 NOTA: Valores sanitizados para segurança - use o backup completo do Firebase Database');
    console.log('');
    console.log('🔥 === FIREBASE FRONTEND ===');
    if (backupConfig.firebase.apiKey) console.log(`VITE_FIREBASE_API_KEY=${sanitize(backupConfig.firebase.apiKey)}`);
    if (backupConfig.firebase.authDomain) console.log(`VITE_FIREBASE_AUTH_DOMAIN=${backupConfig.firebase.authDomain}`);
    if (backupConfig.firebase.databaseURL) console.log(`VITE_FIREBASE_DATABASE_URL=${backupConfig.firebase.databaseURL}`);
    if (backupConfig.firebase.projectId) console.log(`VITE_FIREBASE_PROJECT_ID=${backupConfig.firebase.projectId}`);
    if (backupConfig.firebase.storageBucket) console.log(`VITE_FIREBASE_STORAGE_BUCKET=${backupConfig.firebase.storageBucket}`);
    if (backupConfig.firebase.messagingSenderId) console.log(`VITE_FIREBASE_MESSAGING_SENDER_ID=${backupConfig.firebase.messagingSenderId}`);
    if (backupConfig.firebase.appId) console.log(`VITE_FIREBASE_APP_ID=${sanitize(backupConfig.firebase.appId)}`);
    if (backupConfig.firebase.measurementId) console.log(`VITE_FIREBASE_MEASUREMENT_ID=${backupConfig.firebase.measurementId}`);
    
    console.log('');
    console.log('🔥 === FIREBASE BACKEND ===');
    if (backupConfig.firebase.projectId) console.log(`FIREBASE_PROJECT_ID=${backupConfig.firebase.projectId}`);
    if (backupConfig.firebase.clientEmail) console.log(`FIREBASE_CLIENT_EMAIL=${backupConfig.firebase.clientEmail}`);
    if (backupConfig.firebase.privateKey) console.log(`FIREBASE_PRIVATE_KEY=${sanitize(backupConfig.firebase.privateKey)}`);
    
    console.log('');
    console.log('🤖 === AI SERVICES ===');
    if (backupConfig.ai.openaiApiKey) console.log(`OPENAI_API_KEY=${sanitize(backupConfig.ai.openaiApiKey)}`);
    
    console.log('');
    console.log('💳 === PAYMENT SERVICES ===');
    if (backupConfig.payments.stripeSecretKey) console.log(`STRIPE_SECRET_KEY=${sanitize(backupConfig.payments.stripeSecretKey)}`);
    if (backupConfig.payments.stripePublishableKey) console.log(`VITE_STRIPE_PUBLISHABLE_KEY=${sanitize(backupConfig.payments.stripePublishableKey)}`);
    
    console.log('🏦 === EFIBANK PRODUCTION ===');
    if (backupConfig.payments.efibankClientIdProd) console.log(`EFIBANK_CLIENT_ID=${sanitize(backupConfig.payments.efibankClientIdProd)}`);
    if (backupConfig.payments.efibankClientSecretProd) console.log(`EFIBANK_CLIENT_SECRET=${sanitize(backupConfig.payments.efibankClientSecretProd)}`);
    
    console.log('🏦 === EFIBANK SANDBOX ===');
    if (backupConfig.payments.efibankClientIdSandbox) console.log(`EFIBANK_CLIENT_ID_SANDBOX=${sanitize(backupConfig.payments.efibankClientIdSandbox)}`);
    if (backupConfig.payments.efibankClientSecretSandbox) console.log(`EFIBANK_CLIENT_SECRET_SANDBOX=${sanitize(backupConfig.payments.efibankClientSecretSandbox)}`);
    
    console.log('🏦 === EFIBANK COMMON ===');
    if (backupConfig.payments.efibankPayeeCode) console.log(`EFIBANK_PAYEE_CODE=${sanitize(backupConfig.payments.efibankPayeeCode)}`);
    if (backupConfig.payments.efibankPixKey) console.log(`EFIBANK_PIX_KEY=${sanitize(backupConfig.payments.efibankPixKey)}`);
    
    console.log('💳 === ADYEN (SE CONFIGURADO) ===');
    if (backupConfig.payments.adyenMerchantAccount) console.log(`ADYEN_MERCHANT_ACCOUNT=${backupConfig.payments.adyenMerchantAccount}`);
    if (backupConfig.payments.adyenClientKey) console.log(`ADYEN_CLIENT_KEY=${sanitize(backupConfig.payments.adyenClientKey)}`);
    if (backupConfig.payments.adyenApiKey) console.log(`ADYEN_API_KEY=${sanitize(backupConfig.payments.adyenApiKey)}`);
    if (backupConfig.payments.adyenHmacKey) console.log(`ADYEN_HMAC_KEY=${sanitize(backupConfig.payments.adyenHmacKey)}`);
    
    console.log('');
    console.log('🚀 [AUTO-RECOVERY] Copie e cole essas chaves no Replit Secrets e reinicie o servidor!');
    
    return true;
    
  } catch (error) {
    console.error('❌ [AUTO-RECOVERY] Erro no sistema de recuperação:', error.message);
    return false;
  }
}

/**
 * 📊 CONTADOR DE CHAVES VÁLIDAS
 */
function countConfigKeys(config: PlatformConfig): number {
  let count = 0;
  
  Object.values(config.firebase).forEach(val => val && count++);
  Object.values(config.ai).forEach(val => val && count++);
  Object.values(config.payments).forEach(val => val && count++);
  
  return count;
}

/**
 * 🧹 FILTRAR CONFIGURAÇÕES VÁLIDAS
 */
function filterValidConfig(config: PlatformConfig): PlatformConfig {
  const filtered = { ...config };
  
  // Filtrar Firebase
  Object.keys(filtered.firebase).forEach(key => {
    if (!filtered.firebase[key as keyof typeof filtered.firebase]) {
      delete filtered.firebase[key as keyof typeof filtered.firebase];
    }
  });
  
  // Filtrar AI
  Object.keys(filtered.ai).forEach(key => {
    if (!filtered.ai[key as keyof typeof filtered.ai]) {
      delete filtered.ai[key as keyof typeof filtered.ai];
    }
  });
  
  // Filtrar Payments
  Object.keys(filtered.payments).forEach(key => {
    if (!filtered.payments[key as keyof typeof filtered.payments] && key !== 'efibankSandbox') {
      delete filtered.payments[key as keyof typeof filtered.payments];
    }
  });
  
  return filtered;
}