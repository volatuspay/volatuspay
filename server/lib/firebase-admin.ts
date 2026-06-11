import admin from 'firebase-admin';

let initPromise: Promise<void> | null = null;
let isInitialized = false;

/**
 * 🔥 FIREBASE ADMIN SDK - SINGLETON CENTRALIZADO
 * ✅ Evita race conditions e múltiplas inicializações
 * ✅ Lazy loading com retry mechanism robusto
 * ✅ Logs sanitizados sem vazar secrets
 * ✅ FAIL FAST: Lança erro se inicialização falhar
 */

export async function ensureFirebaseReady(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (!initPromise) {
    initPromise = initializeFirebaseAdmin();
  }

  return initPromise;
}

/**
 * 🚀 PROMISE DE INICIALIZAÇÃO EXPORTADA
 * 
 * Use em scripts/jobs/services que precisam garantir Firebase ready:
 * 
 * ```typescript
 * import { firebaseReady } from './lib/firebase-admin.js';
 * await firebaseReady; // Aguarda inicialização
 * ```
 */
export const firebaseReady = ensureFirebaseReady();

export function getAdmin() {
  if (!isInitialized) {
    const error = new Error('Firebase Admin NÃO DISPONÍVEL - Firebase Admin não inicializado. Chame ensureFirebaseReady() primeiro!');
    console.error('❌ ERRO CRÍTICO:', error.message);
    throw error;
  }
  return admin;
}

export function getFirestore() {
  if (!isInitialized) {
    const error = new Error('Firebase Firestore NÃO DISPONÍVEL - Firebase Admin não inicializado. Chame ensureFirebaseReady() primeiro!');
    console.error('❌ ERRO CRÍTICO:', error.message);
    throw error;
  }
  return admin.firestore();
}

export function getRTDB() {
  if (!isInitialized) {
    console.warn('⚠️ Firebase RTDB não disponível - usando modo limitado');
    return null;
  }
  return admin.database();
}

export function getStorage() {
  console.warn('⚠️ Firebase Storage REMOVIDO - Usar Bunny CDN via bunny-helper.ts');
  return null;
}

export function getAuth() {
  if (!isInitialized) {
    console.warn('⚠️ Firebase Auth não disponível - usando modo limitado');
    return null;
  }
  return admin.auth();
}

async function initializeFirebaseAdmin(): Promise<void> {
  try {
    // 🔍 Verificar se já foi inicializado por outro processo
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin já inicializado, reutilizando instância...');
      isInitialized = true;
      return;
    }

    console.log('🔥 Inicializando Firebase Admin SDK (Singleton)...');

    // 🔄 RETRY MECHANISM COM BOUNDED DELAY (máximo 10 segundos)
    const maxRetries = 5;
    const maxWaitTime = 10000; // 10 segundos
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const elapsed = Date.now() - startTime;
      
      if (elapsed > maxWaitTime) {
        console.warn('⏱️ Timeout aguardando secrets Firebase (10s)');
        break;
      }

      console.log(`🔍 [SINGLETON] Tentativa ${attempt}/${maxRetries}: Verificando secrets...`);

      const secrets = await loadFirebaseSecrets();
      
      if (secrets.isValid) {
        await initializeWithSecrets(secrets);
        isInitialized = true;
        console.log('✅ Firebase Admin SDK inicializado com sucesso!');
        console.log('📊 Firebase pronto para operações permanentes');
        return;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * attempt, 3000); // Max 3s delay
        console.log(`⏳ Aguardando ${delay}ms antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Firebase secrets não disponíveis após múltiplas tentativas');

  } catch (error) {
    console.error('❌ ERRO CRÍTICO: Firebase Admin SDK não pode ser inicializado:', error.message);
    console.error('🔥 SISTEMA NÃO PODE CONTINUAR SEM FIREBASE ADMIN');
    isInitialized = false;
    // FAIL FAST: Lança erro em vez de fail silenciosamente
    throw new Error(`Firebase Admin SDK initialization failed: ${error.message}`);
  }
}

interface FirebaseSecrets {
  isValid: boolean;
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  serviceAccountJson?: string;
}

async function loadFirebaseSecrets(): Promise<FirebaseSecrets> {

  // 🔐 PRIORIDADE 0: FIREBASE_ADMIN_CREDENTIAL_FILE (arquivo JSON no disco)
  const credentialFile = process.env.FIREBASE_ADMIN_CREDENTIAL_FILE;
  if (credentialFile) {
    try {
      const { readFileSync } = await import('fs');
      const raw = readFileSync(credentialFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.project_id && parsed.private_key && parsed.client_email) {
        console.log('✅ FIREBASE_ADMIN_CREDENTIAL_FILE carregado de arquivo:', credentialFile);
        console.log('🎯 Projeto Firebase:', parsed.project_id);
        return { isValid: true, serviceAccountJson: raw };
      }
    } catch (e: any) {
      console.warn('⚠️ FIREBASE_ADMIN_CREDENTIAL_FILE erro ao ler:', e.message);
    }
  }

  // 🔐 PRIORIDADE 1: FIREBASE_SERVICE_ACCOUNT_JSON_B64 (Base64 encoded - Legacy)
  let serviceAccountB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64;
  if (serviceAccountB64) {
    try {
      // ✅ VALIDAÇÃO: Verificar se já é JSON direto (não Base64)
      if (serviceAccountB64.trim().startsWith('{')) {
        console.log('✅ FIREBASE_SERVICE_ACCOUNT_JSON_B64 detectado como JSON direto (não codificado)');
        const testParse = JSON.parse(serviceAccountB64);
        if (testParse.project_id && testParse.private_key) {
          console.log('✅ JSON válido com project_id e private_key');
          return { isValid: true, serviceAccountJson: serviceAccountB64 };
        }
      }
      
      // Tentar decode Base64
      const decoded = Buffer.from(serviceAccountB64, 'base64').toString('utf-8');
      
      // Validar se o decode resultou em JSON válido
      const testParse = JSON.parse(decoded);
      if (testParse.project_id && testParse.private_key) {
        console.log('✅ FIREBASE_SERVICE_ACCOUNT_JSON_B64 encontrado e decodificado com sucesso');
        return { isValid: true, serviceAccountJson: decoded };
      }
    } catch (error) {
      console.warn('⚠️ Erro processando FIREBASE_SERVICE_ACCOUNT_JSON_B64:', error.message);
      console.warn('💡 DICA: Cole o JSON diretamente (não precisa ser Base64)');
    }
  }

  // 🔐 PRIORIDADE 2: FIREBASE_SERVICE_ACCOUNT_JSON ou FIREBASE_SERVICE_ACCOUNT (raw ou Base64)
  const saJsonSources = [
    { name: 'FIREBASE_SERVICE_ACCOUNT_JSON', value: process.env.FIREBASE_SERVICE_ACCOUNT_JSON },
    { name: 'FIREBASE_SERVICE_ACCOUNT', value: process.env.FIREBASE_SERVICE_ACCOUNT }
  ];
  
  for (const source of saJsonSources) {
    let serviceAccountJson = source.value;
    if (!serviceAccountJson) continue;
    
    try {
      // Sanitizar: remover BOM, caracteres invisíveis, whitespace
      serviceAccountJson = serviceAccountJson
        .replace(/^\uFEFF/, '')
        .replace(/^\xEF\xBB\xBF/, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim();
      
      // TENTATIVA 1: JSON direto
      if (serviceAccountJson.startsWith('{')) {
        try {
          const parsed = JSON.parse(serviceAccountJson);
          if (parsed.project_id && parsed.private_key) {
            console.log(`✅ ${source.name} encontrado como JSON direto e validado`);
            console.log('🎯 Projeto Firebase:', parsed.project_id);
            return { isValid: true, serviceAccountJson };
          }
        } catch (jsonErr: any) {
          console.warn(`⚠️ ${source.name} parece JSON mas falhou parse:`, jsonErr.message);
        }
      }
      
      // TENTATIVA 2: Base64 encoded
      try {
        const decoded = Buffer.from(serviceAccountJson, 'base64').toString('utf-8');
        if (decoded.trim().startsWith('{')) {
          const parsed = JSON.parse(decoded);
          if (parsed.project_id && parsed.private_key) {
            console.log(`✅ ${source.name} decodificado de Base64 com sucesso`);
            console.log('🎯 Projeto Firebase:', parsed.project_id);
            return { isValid: true, serviceAccountJson: decoded };
          }
        }
      } catch (b64Err: any) {
        console.warn(`⚠️ ${source.name} Base64 decode falhou:`, b64Err.message);
      }

      // TENTATIVA 3: JSON com aspas extras ou escapado
      try {
        let cleaned = serviceAccountJson;
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
          cleaned = cleaned.slice(1, -1);
        }
        cleaned = cleaned.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        if (cleaned.trim().startsWith('{')) {
          const parsed = JSON.parse(cleaned);
          if (parsed.project_id && parsed.private_key) {
            console.log(`✅ ${source.name} encontrado após limpeza de escape e validado`);
            console.log('🎯 Projeto Firebase:', parsed.project_id);
            return { isValid: true, serviceAccountJson: cleaned };
          }
        }
      } catch (cleanErr: any) {
        console.warn(`⚠️ ${source.name} limpeza de escape falhou:`, cleanErr.message);
      }

      console.warn(`⚠️ ${source.name} presente mas não pôde ser processado. Primeiros 80 chars:`, serviceAccountJson.substring(0, 80));
    } catch (error: any) {
      console.warn(`⚠️ ${source.name} erro geral:`, error.message);
    }
  }

  // 🔐 PRIORIDADE 2.5: FIREBASE_PRIVATE_KEY pode conter o JSON completo do service account
  const rawPrivateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY;
  if (rawPrivateKey) {
    try {
      const trimmed = rawPrivateKey.trim();
      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        if (parsed.project_id && parsed.private_key) {
          console.log('✅ FIREBASE_PRIVATE_KEY contém JSON completo do service account - usando automaticamente');
          console.log('🎯 Projeto Firebase:', parsed.project_id);
          return { isValid: true, serviceAccountJson: trimmed };
        }
      }
    } catch (e) {
      console.warn('⚠️ FIREBASE_PRIVATE_KEY parece JSON mas falhou parse:', (e as any).message);
    }
  }

  // 🔐 PRIORIDADE 3: Credenciais individuais (triplet)
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || process.env.VITE_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || process.env.VITE_FIREBASE_PRIVATE_KEY;

  // ✅ LOGS SANITIZADOS - NÃO VAZAR SECRETS
  console.log('🔑 Secrets disponíveis:', {
    FIREBASE_SERVICE_ACCOUNT_JSON_B64: !!serviceAccountB64,
    FIREBASE_SERVICE_ACCOUNT_JSON: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    FIREBASE_SERVICE_ACCOUNT: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    FIREBASE_PROJECT_ID: !!projectId,
    FIREBASE_CLIENT_EMAIL: !!clientEmail,
    FIREBASE_PRIVATE_KEY: !!privateKey,
    // 🔧 DEBUG: Verificar valores ADMIN específicos
    FIREBASE_ADMIN_PROJECT_ID: !!process.env.FIREBASE_ADMIN_PROJECT_ID,
    FIREBASE_ADMIN_CLIENT_EMAIL: !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    FIREBASE_ADMIN_PRIVATE_KEY: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY
  });

  if (projectId && clientEmail && privateKey) {
    console.log('✅ Credenciais individuais encontradas');
    return { 
      isValid: true, 
      projectId, 
      clientEmail, 
      privateKey 
    };
  }

  return { isValid: false };
}

async function initializeWithSecrets(secrets: FirebaseSecrets): Promise<void> {
  let credential: admin.credential.Credential;
  let effectiveProjectId: string;

  if (secrets.serviceAccountJson) {
    // 🔐 Usar service account JSON com normalização ULTRA ROBUSTA
    console.log('🔧 Processando service account JSON...');
    
    // ✅ VALIDAÇÃO ROBUSTA: Verificar se é JSON válido antes de fazer parse
    let raw: any;
    try {
      raw = JSON.parse(secrets.serviceAccountJson);
    } catch (parseError) {
      console.error('❌ JSON do service account está corrompido:', parseError.message);
      console.log('📋 Primeiros 50 chars do JSON:', secrets.serviceAccountJson.substring(0, 50));
      console.log('🔄 Tentando modo individual...');
      secrets.serviceAccountJson = ''; // Force fallback
      raw = null;
    }
    
    if (raw) {
      let privateKey = (raw.private_key || raw.privateKey || '').toString();
    
    // ✅ NORMALIZAÇÃO ULTRA ROBUSTA DA PRIVATE KEY
    console.log('🔧 Processando private key do service account JSON...');
    
    // Remover TODAS as escapadas e caracteres problemáticos
    privateKey = privateKey
      .replace(/\\n/g, '\n')           // Escapas simples
      .replace(/\\\\n/g, '\n')         // Escapas duplas
      .replace(/\r\n/g, '\n')          // Windows line endings  
      .replace(/\r/g, '\n')            // Mac line endings
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '') // Caracteres de controle
      .replace(/\\"/g, '"')            // Aspas escapadas
      .replace(/\\\\/g, '\\')          // Barras escapadas
      .trim();
    
    // 🔧 NORMALIZAÇÃO ULTRA AGRESSIVA para deployment
    console.log('🔧 Normalizando private key - Length:', privateKey.length);
    
    // CASOS ESPECIAIS: Deployment pode enviar sem newlines
    if (!privateKey.includes('\n') && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      console.log('🔧 DETECTADO: Private key sem quebras de linha - inserindo automaticamente');
      // Formato comum em deployment: -----BEGIN PRIVATE KEY-----MIIEvQIBADANBg...-----END PRIVATE KEY-----
      privateKey = privateKey
        .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
        .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----')
        .replace(/(.{64})/g, '$1\n') // Adicionar quebras a cada 64 caracteres
        .replace(/\n\n/g, '\n'); // Remover quebras duplas
    }
    
    // Validação mais permissiva
    if (!privateKey || privateKey.length < 100) {
      console.error('❌ Private key muito curta ou vazia - Length:', privateKey.length);
      console.error('📋 Primeiros 100 chars:', privateKey.substring(0, 100));
      throw new Error('🔥 Private key inválida - muito curta. Verifique FIREBASE_SERVICE_ACCOUNT_JSON no deployment.');
    } else if (!privateKey.includes('-----BEGIN') || !privateKey.includes('-----END')) {
      console.error('❌ Headers PEM não encontrados na private key');
      console.error('📋 Primeiros 200 chars:', privateKey.substring(0, 200));
      throw new Error('🔥 Private key sem headers PEM. Verifique o formato do JSON no deployment.');
    } else {
      // Tentar normalizar headers PEM
      privateKey = privateKey
        .replace(/-----BEGIN[^-]*-----/g, '-----BEGIN PRIVATE KEY-----')
        .replace(/-----END[^-]*-----/g, '-----END PRIVATE KEY-----');
      
      // 🔐 Reconstruir certificado com private key normalizada
      const certObj = {
        projectId: raw.project_id || '',
        clientEmail: raw.client_email,
        privateKey,
      };
      
      try {
        credential = admin.credential.cert(certObj);
        effectiveProjectId = certObj.projectId;
        console.log('🔐 ✅ Service account JSON processado com sucesso!');
        console.log('📊 Projeto:', effectiveProjectId);
        console.log('✅ Private key válida - Firebase Admin pronto para Firestore');
      } catch (error) {
        console.error('❌ FALHA CRÍTICA ao processar service account JSON:', error.message);
        console.error('📋 Project ID:', certObj.projectId);
        console.error('📋 Client Email:', certObj.clientEmail);
        console.error('📋 Private Key Length:', certObj.privateKey?.length || 0);
        throw new Error(`🔥 Firebase Admin BLOQUEADO - Erro ao criar credential: ${error.message}`);
      }
    }
    }
  }
  
  if (!secrets.serviceAccountJson) {
    // 🔐 Usar credenciais individuais
    if (!secrets.privateKey || !secrets.projectId || !secrets.clientEmail) {
      console.error('❌ FIREBASE ADMIN: CREDENCIAIS NÃO ENCONTRADAS!');
      console.error('🚨 PRODUÇÃO: Configure FIREBASE_SERVICE_ACCOUNT_JSON no Deployment → Environment Variables');
      console.error('📋 Secrets disponíveis:', {
        FIREBASE_SERVICE_ACCOUNT_JSON: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
        FIREBASE_SERVICE_ACCOUNT_JSON_B64: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64,
        individual_creds: {
          projectId: !!secrets.projectId,
          clientEmail: !!secrets.clientEmail,
          privateKey: !!secrets.privateKey
        }
      });
      
      throw new Error('🔥 Firebase Admin BLOQUEADO - Credenciais não configuradas no deployment. Configure FIREBASE_SERVICE_ACCOUNT_JSON nas Environment Variables do deployment.');
      
    } else {
      try {
        let privateKey = secrets.privateKey;
        
        // 🔧 PROCESSAMENTO APRIMORADO DA CHAVE PRIVADA
        console.log('🔧 Processando chave privada individual para Firebase...');
      
        // Converter caracteres de escape para quebras de linha reais
        privateKey = privateKey.replace(/\\n/g, '\n');
        
        // Remover caracteres de controle problemáticos, mas preservar quebras de linha
        privateKey = privateKey.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
        
        // Garantir que começa e termina corretamente
        privateKey = privateKey.trim();
        
        // Verificar formato básico
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || 
            !privateKey.includes('-----END PRIVATE KEY-----')) {
          throw new Error('Formato de chave privada inválido - headers não encontrados');
        }
        
        console.log('✅ Chave privada processada com sucesso');

        credential = admin.credential.cert({
          projectId: secrets.projectId!,
          clientEmail: secrets.clientEmail!,
          privateKey: privateKey
        });
        effectiveProjectId = secrets.projectId!;
        console.log('🔐 Usando credenciais individuais');
      } catch (individualError) {
        console.error('❌ Falha nas credenciais individuais:', individualError.message);
        throw new Error('Credenciais Firebase inválidas - configure FIREBASE_SERVICE_ACCOUNT_JSON (ou _B64) ou credenciais individuais no deployment');
      }
    }
  }

  // 🚀 Inicializar Firebase Admin com projectId consistente
  let initConfig: any = {
    projectId: effectiveProjectId || ''
  };
  
  // ✅ SÓ ADICIONAR CREDENTIAL, DATABASE E STORAGE SE VÁLIDO (impede ADC completamente)
  if (credential) {
    initConfig.credential = credential;
    initConfig.databaseURL = `https://${effectiveProjectId}-default-rtdb.firebaseio.com/`;
    console.log('🔐 Inicializando com credential e RTDB válidos (Storage = Bunny CDN)');
    console.log('💾 Realtime Database:', initConfig.databaseURL);
  } else {
    console.log('🔐 Inicializando SEM credential - RTDB desabilitado para evitar ADC');
    console.log('⚠️ RTDB não estará disponível até credenciais válidas');
  }
  
  const app = admin.initializeApp(initConfig);

  console.log('🔥 Firebase Admin SDK inicializado:', app.name);
  console.log('📊 Projeto ativo:', effectiveProjectId || '');
}

export function isFirebaseReady(): boolean {
  return isInitialized;
}