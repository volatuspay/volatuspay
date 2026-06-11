// 🔒 SISTEMA DE CREDENCIAIS ETERNAS DO ZEN PAGAMENTOS
// Garante que credenciais nunca se percam - funcionam em qualquer VPS/Replit/Deploy
// 
// SEGURANÇA (Nov 23, 2025): Credenciais mantidas APENAS em Firebase (criptografadas) e RAM
// Arquivos locais plaintext foram completamente eliminados

import admin from 'firebase-admin';
import { decryptSensitiveData, encryptSensitiveData } from '../security/key-encryption.js';
import { loadCredentialsFromRTDB, restoreCertificateFromRTDB } from './eternal-sync.js';
import { firestoreCache, withFirestoreTimeout } from './firestore-cache.js';

// 🔒 CREDENCIAIS REMOVIDAS DO FILESYSTEM (Segurança - Nov 23, 2025)
// Antigos: CREDENTIALS_DIR e CREDENTIALS_FILE → removidos
// Credenciais agora existem APENAS em Firebase (criptografadas) e RAM (descriptografadas)

// 🔐 CREDENCIAIS ETERNAS DO ZEN PAGAMENTOS - EFIBANK
// ⚠️ SEGURANÇA: Credenciais devem ser configuradas pelo ADMIN via interface de configuração
// O sistema busca credenciais do Firebase primeiro, depois arquivo local, e só usa este objeto como último recurso
// NUNCA commite credenciais reais de produção neste arquivo!
const ETERNAL_EFIBANK_CREDENTIALS = {
  productionClientId: '', // Configure via Admin > Configurações de Pagamento
  productionClientSecret: '', // Configure via Admin > Configurações de Pagamento
  sandboxClientId: '',
  sandboxClientSecret: '',
  payeeCode: '', // Configure via Admin > Configurações de Pagamento
  pixKey: '', // Configure via Admin > Configurações de Pagamento
  certificatePath: '/home/runner/workspace/certs/efi-prod.p12',
  environment: 'production' as const,
  enabled: false // Será habilitado quando admin configurar as credenciais
};

// 🔒 DEPRECATED: saveCredentialsToFile REMOVIDA POR SEGURANÇA
// Credenciais NUNCA devem ser salvas em plaintext no disco
// Firebase criptografado é a única fonte de verdade permitida
// 
// HISTÓRICO: Função removida em 23/Nov/2025 para corrigir CVE de credenciais plaintext
//
// ANTES: fs.writeFileSync(credentials.json) → PLAINTEXT NO DISCO ❌
// AGORA: Credenciais existem APENAS em RAM após descriptografia ✅

// 🔒 DEPRECATED: loadCredentialsFromFile REMOVIDA POR SEGURANÇA
// Arquivos locais com credenciais foram completamente eliminados
// Única fonte permitida: Firebase Firestore (com criptografia AES-256-GCM)

// 🔥 SALVAR CREDENCIAIS NO FIREBASE (BACKUP PERMANENTE NA NUVEM)
// ⚠️ SEGURANÇA: Só salva se as credenciais forem válidas (não vazias)
export async function saveEternalCredentialsToFirebase(
  db: admin.firestore.Firestore, 
  credentials?: typeof ETERNAL_EFIBANK_CREDENTIALS
): Promise<void> {
  try {
    const credsToSave = credentials || ETERNAL_EFIBANK_CREDENTIALS;
    
    // 🔒 PROTEÇÃO: Não sobrescrever Firebase com credenciais vazias
    if (!credsToSave.productionClientId || !credsToSave.productionClientSecret) {
      console.warn('⚠️ SEGURANÇA: Credenciais vazias - NÃO sobrescrevendo Firebase');
      console.log('💡 Configure as credenciais via Admin > Configurações de Pagamento');
      return;
    }
    
    // 🔐 VERIFICAR SE ENCRYPTION_MASTER_KEY ESTÁ DISPONÍVEL
    if (!process.env.ENCRYPTION_MASTER_KEY) {
      console.warn('⚠️ ENCRYPTION_MASTER_KEY não disponível - Pulando salvamento de credenciais');
      console.log('💡 Credenciais serão carregadas do Firebase quando necessário');
      return;
    }
    
    console.log('🔥 Salvando credenciais eternas no Firebase...');
    
    // 🔐 CRIPTOGRAFAR CREDENCIAIS ANTES DE SALVAR
    console.log('🔐 Criptografando credenciais sensíveis...');
    const encryptedCreds = {
      ...credsToSave,
      productionClientId: encryptSensitiveData(credsToSave.productionClientId),
      productionClientSecret: encryptSensitiveData(credsToSave.productionClientSecret),
      sandboxClientId: credsToSave.sandboxClientId ? encryptSensitiveData(credsToSave.sandboxClientSecret) : '',
      sandboxClientSecret: credsToSave.sandboxClientSecret ? encryptSensitiveData(credsToSave.sandboxClientSecret) : '',
    };
    
    console.log('✅ Credenciais criptografadas com sucesso (AES-256-GCM)');
    
    // 🔒 Remover campos undefined para Firebase não recusar
    const cleanCreds = Object.fromEntries(
      Object.entries(encryptedCreds).filter(([_, value]) => value !== undefined && value !== '')
    );
    
    const configRef = db.collection('paymentConfig').doc('global');
    
    await configRef.set({
      efibank: cleanCreds,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'SYSTEM_ETERNAL',
      updatedByName: 'Sistema de Credenciais Eternas',
    }, { merge: true });
    
    console.log('✅ Credenciais eternas salvas no Firebase (CRIPTOGRAFADAS)');
    
    // 🔒 SEGURANÇA: NÃO salvar em arquivo plaintext (removido por segurança)
    // Firebase é a única fonte de verdade - backup triplo já existe lá
    
  } catch (error: any) {
    console.error('❌ ERRO ao salvar credenciais eternas no Firebase:', error?.message || error);
    console.error('📊 Detalhes do erro:', { 
      name: error?.name, 
      code: error?.code,
      stack: error?.stack?.split('\n')?.[0] 
    });
    // ⚠️ NÃO re-lançar erro - deixar sistema continuar
    // Credenciais serão carregadas do Firebase quando necessário
    console.warn('⚠️ Sistema continuará sem salvar novas credenciais');
  }
}

// 🔐 HELPER: DESCRIPTOGRAFAR CREDENCIAIS COM SUPORTE A BACKWARD COMPATIBILITY
const safeDecrypt = (value: string | undefined, keyName: string = 'chave'): string | undefined => {
  if (!value) return undefined;
  
  // Verificar se está no formato correto de criptografia (IV:AuthTag:Encrypted)
  if (!value.includes(':') || value.split(':').length !== 3) {
    console.warn(`⚠️ ${keyName} está em formato plain-text (não criptografada)`);
    // ✅ BACKWARD COMPATIBILITY: Retorna valor plain-text para não quebrar
    return value;
  }
  
  try {
    let decrypted = decryptSensitiveData(value);
    console.log(`✅ ${keyName} descriptografada com sucesso (${decrypted.length} chars)`);
    
    // 🔧 FIX: Verificar se ainda está criptografada (dupla-criptografia)
    if (decrypted.includes(':') && decrypted.split(':').length === 3) {
      console.log(`🔄 ${keyName} ainda criptografada! Descriptografando novamente...`);
      try {
        decrypted = decryptSensitiveData(decrypted);
        console.log(`✅ ${keyName} descriptografada (2ª tentativa) com sucesso`);
      } catch (error2) {
        console.warn(`⚠️ 2ª descriptografia falhou - usando resultado da 1ª`);
      }
    }
    
    return decrypted;
  } catch (error: any) {
    console.error(`❌ Erro ao descriptografar ${keyName}:`, error.message);
    // 🔧 FIX CRÍTICO: Retornar undefined em vez do valor criptografado
    // Valor criptografado é inválido para uso como credencial
    console.warn(`🚨 FALLBACK: Retornando undefined para ${keyName} (valor criptografado inválido)`);
    console.warn(`💡 Use variáveis de ambiente como backup: EFIBANK_CLIENT_ID, EFIBANK_CLIENT_SECRET`);
    return undefined; // ← FIX: Era "return value" que retornava dado criptografado inválido!
  }
};

// 🌟 CARREGAR CREDENCIAIS ETERNAS (PRIORIDADE: Firebase > Arquivo Local > Hardcoded)
export async function loadEternalCredentials(db: admin.firestore.Firestore): Promise<typeof ETERNAL_EFIBANK_CREDENTIALS> {
  try {
    console.log('🌟 Carregando credenciais eternas...');
    
    // PRIORIDADE 1: FIREBASE (sempre atualizado)
    try {
      const configDoc = await db.collection('paymentConfig').doc('global').get();
      
      if (configDoc.exists) {
        const data = configDoc.data();
        if (data?.efibank?.productionClientId) {
          console.log('✅ Credenciais eternas carregadas do FIREBASE');
          
          const decryptedCredentials = {
            ...data.efibank,
            productionClientId: safeDecrypt(data.efibank.productionClientId, 'EfíBank Production Client ID'),
            productionClientSecret: safeDecrypt(data.efibank.productionClientSecret, 'EfíBank Production Client Secret'),
            sandboxClientId: safeDecrypt(data.efibank.sandboxClientId, 'EfíBank Sandbox Client ID'),
            sandboxClientSecret: safeDecrypt(data.efibank.sandboxClientSecret, 'EfíBank Sandbox Client Secret'),
          };
          
          if (decryptedCredentials.productionClientId && decryptedCredentials.productionClientSecret) {
            console.log('🔓 Credenciais descriptografadas com sucesso');
            return decryptedCredentials;
          } else {
            console.warn('⚠️ Firestore tem credenciais mas descriptografia falhou - tentando RTDB...');
          }
        }
      }
    } catch (firebaseError) {
      console.warn('⚠️ Erro ao buscar credenciais do Firebase:', firebaseError);
    }
    
    // PRIORIDADE 2: RTDB (backup eterno)
    try {
      console.log('🔄 Tentando carregar credenciais EfíBank do RTDB (backup eterno)...');
      const rtdbCreds = await loadCredentialsFromRTDB('efibank');
      
      if (rtdbCreds && rtdbCreds.productionClientId) {
        console.log('✅ Credenciais EfíBank carregadas do RTDB (backup eterno)!');
        
        const decryptedRtdbCreds = {
          ...ETERNAL_EFIBANK_CREDENTIALS,
          ...rtdbCreds,
          productionClientId: safeDecrypt(rtdbCreds.productionClientId, 'EfíBank RTDB Production Client ID') || '',
          productionClientSecret: safeDecrypt(rtdbCreds.productionClientSecret, 'EfíBank RTDB Production Client Secret') || '',
          sandboxClientId: safeDecrypt(rtdbCreds.sandboxClientId, 'EfíBank RTDB Sandbox Client ID') || '',
          sandboxClientSecret: safeDecrypt(rtdbCreds.sandboxClientSecret, 'EfíBank RTDB Sandbox Client Secret') || '',
        };
        
        return decryptedRtdbCreds;
      }
    } catch (rtdbError) {
      console.warn('⚠️ Erro ao buscar credenciais do RTDB:', rtdbError);
    }
    
    // PRIORIDADE 3: FALLBACK (sem salvar no Firebase - admin deve configurar)
    console.log('⚠️ Credenciais EfiBank não encontradas no Firebase nem no RTDB');
    console.log('💡 Configure via Admin > Configurações de Pagamento');
    console.log('🔒 NÃO sobrescrevendo Firebase com credenciais vazias');
    
    return ETERNAL_EFIBANK_CREDENTIALS;
    
  } catch (error) {
    console.error('❌ Erro crítico ao carregar credenciais eternas:', error);
    console.log('🆘 FALLBACK FINAL: Usando credenciais hardcoded');
    return ETERNAL_EFIBANK_CREDENTIALS;
  }
}

// 🔄 SINCRONIZAR CREDENCIAIS (garantir que Firebase tem credenciais criptografadas)
export async function syncEternalCredentials(db: admin.firestore.Firestore): Promise<void> {
  try {
    console.log('🔄 Sincronizando credenciais eternas...');
    
    const credentials = await loadEternalCredentials(db);
    
    // 🔐 MIGRAÇÃO AUTOMÁTICA: Garantir que todas as credenciais no Firebase estão criptografadas
    // APENAS SE ENCRYPTION_MASTER_KEY ESTIVER DISPONÍVEL
    if (process.env.ENCRYPTION_MASTER_KEY) {
      await ensureCredentialsEncrypted(db, credentials);
    } else {
      console.warn('⚠️ ENCRYPTION_MASTER_KEY não disponível - Pulando migração de criptografia');
    }
    
    restoreCertificateFromRTDB().catch((err: any) =>
      console.warn('⚠️ Restauração de certificado falhou (não crítico):', err?.message)
    );
    
    console.log('✅ Credenciais eternas sincronizadas com sucesso!');
  } catch (error) {
    console.error('⚠️ Sincronização de credenciais eternas falhou:', error);
    // ⚠️ NÃO re-lançar erro - deixar sistema continuar
    // Sistema pode funcionar sem sincronização se já houver credenciais no Firebase
  }
}

// 🔐 GARANTIR QUE CREDENCIAIS ESTÃO CRIPTOGRAFADAS NO FIREBASE
async function ensureCredentialsEncrypted(
  db: admin.firestore.Firestore,
  credentials: typeof ETERNAL_EFIBANK_CREDENTIALS
): Promise<void> {
  try {
    console.log('🔐 Verificando se credenciais no Firebase estão criptografadas...');
    
    // Verificar credenciais atuais no Firebase
    const configDoc = await db.collection('paymentConfig').doc('global').get();
    
    if (!configDoc.exists) {
      console.log('⚠️ Nenhuma credencial no Firebase - salvando criptografadas pela primeira vez...');
      await saveEternalCredentialsToFirebase(db, credentials);
      return;
    }
    
    const data = configDoc.data();
    const currentCreds = data?.efibank;
    
    if (!currentCreds) {
      console.log('⚠️ Credenciais EfíBank não encontradas no Firebase - salvando...');
      await saveEternalCredentialsToFirebase(db, credentials);
      return;
    }
    
    // 🔍 VERIFICAR SE ESTÃO EM PLAINTEXT
    const isPlaintext = (value: string | undefined): boolean => {
      if (!value) return false;
      // Formato criptografado: IV:AuthTag:Encrypted (3 partes separadas por :)
      return !value.includes(':') || value.split(':').length !== 3;
    };
    
    const hasPlaintext = 
      isPlaintext(currentCreds.productionClientId) ||
      isPlaintext(currentCreds.productionClientSecret) ||
      isPlaintext(currentCreds.sandboxClientId) ||
      isPlaintext(currentCreds.sandboxClientSecret);
    
    if (hasPlaintext) {
      console.warn('⚠️ MIGRAÇÃO: Credenciais em plaintext detectadas no Firebase!');
      console.log('🔐 Criptografando credenciais existentes...');
      
      // Re-salvar credenciais criptografadas
      await saveEternalCredentialsToFirebase(db, credentials);
      
      // 🔍 VERIFICAR SE CRIPTOGRAFIA FOI BEM-SUCEDIDA
      const verifyDoc = await db.collection('paymentConfig').doc('global').get();
      const verifyData = verifyDoc.data()?.efibank;
      
      if (!verifyData || isPlaintext(verifyData.productionClientId) || isPlaintext(verifyData.productionClientSecret)) {
        throw new Error('FALHA NA MIGRAÇÃO: Credenciais ainda estão em plaintext após salvar!');
      }
      
      console.log('✅ MIGRAÇÃO COMPLETA: Credenciais agora estão criptografadas no Firebase');
    } else {
      console.log('✅ Credenciais já estão criptografadas no Firebase (AES-256-GCM)');
    }
    
  } catch (error) {
    console.error('❌ Erro ao verificar/criptografar credenciais:', error);
    // ⚠️ NÃO re-lançar erro - deixar sistema continuar
    console.warn('⚠️ Sistema continuará com credenciais existentes no Firebase');
  }
}

// 📊 VERIFICAR STATUS DAS CREDENCIAIS
export async function checkCredentialsStatus(db: admin.firestore.Firestore): Promise<void> {
  console.log('\n=== 📊 STATUS DAS CREDENCIAIS ETERNAS ===');
  
  // Verificar Firebase
  try {
    let configDoc = firestoreCache.getPaymentConfigFromCache('global');
    if (configDoc === undefined) {
      const freshDoc = await withFirestoreTimeout(db.collection('paymentConfig').doc('global').get());
      if (freshDoc.exists) {
        configDoc = freshDoc.data();
        firestoreCache.setPaymentConfigCache('global', configDoc);
      }
    }
    
    if (configDoc && configDoc.efibank?.productionClientId) {
      console.log('✅ Firebase: Credenciais encontradas');
    } else {
      console.log('❌ Firebase: Credenciais NÃO encontradas');
    }
  } catch (error) {
    console.log('❌ Firebase: Erro ao verificar');
  }
  
  // 🔒 Arquivo local DESABILITADO (removido por segurança - Nov 23/2025)
  console.log('🔒 Arquivo Local: DESABILITADO (segurança - credenciais apenas no Firebase)');
  
  console.log('===========================================\n');
}

// 💰 TAXAS PADRÃO (FALLBACK SOMENTE SE FIREBASE NÃO TIVER DADOS)
// ⚠️ ESTES VALORES SÃO USADOS APENAS COMO ÚLTIMO RECURSO
// A FONTE DE VERDADE É SEMPRE O FIREBASE (definido pelo admin)
const DEFAULT_FEES_FALLBACK = {
  pixFixedFee: 199,
  pixPercentFee: 5.2,
  pixReleaseDays: 0,
  creditCardBRFixedFee: 49,
  creditCardBRPercentFee: 4.99,
  creditCardBRReleaseDays: 30,
  creditCardGlobalFixedFee: 49,
  creditCardGlobalPercentFee: 4.99,
  creditCardGlobalReleaseDays: 30,
  boletoFixedFee: 349,
  boletoPercentFee: 0,
  boletoReleaseDays: 2,
};

// 🔥 SALVAR TAXAS NO FIREBASE (CHAMADO APENAS PELO ADMIN)
export async function saveEternalFeesToFirebase(db: admin.firestore.Firestore, fees?: Record<string, any>): Promise<void> {
  try {
    const feesToSave = fees || DEFAULT_FEES_FALLBACK;
    
    // 🔒 PROTEÇÃO: Não sobrescrever taxas do admin com fallback
    if (!fees) {
      const existingDoc = await db.collection('paymentConfig').doc('global').get();
      if (existingDoc.exists && existingDoc.data()?.fees) {
        console.log('✅ Taxas já existem no Firebase (definidas pelo admin) - NÃO sobrescrevendo');
        return;
      }
    }
    
    console.log('💰 Salvando taxas no Firebase...');
    const configRef = db.collection('paymentConfig').doc('global');
    
    await configRef.set({
      fees: feesToSave,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    
    console.log('✅ Taxas salvas no Firebase com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro ao salvar taxas no Firebase:', error);
  }
}

// 🌟 CARREGAR TAXAS DO FIREBASE (FONTE DE VERDADE = ADMIN)
// Se Firebase tem taxas → usa elas (SEMPRE)
// Se Firebase NÃO tem → usa fallback padrão (SEM salvar por cima)
export async function loadEternalFees(db: admin.firestore.Firestore): Promise<typeof DEFAULT_FEES_FALLBACK> {
  try {
    let configData = firestoreCache.getPaymentConfigFromCache('global');
    if (configData === undefined) {
      const configDoc = await withFirestoreTimeout(db.collection('paymentConfig').doc('global').get());
      if (configDoc.exists) {
        configData = configDoc.data();
        firestoreCache.setPaymentConfigCache('global', configData);
      }
    }
    
    if (configData?.fees) {
      console.log('✅ Taxas carregadas do Firebase (definidas pelo admin)');
      return configData.fees;
    }
    
    // Fallback: usar padrão SEM sobrescrever Firebase
    console.log('⚠️ Nenhuma taxa encontrada no Firebase - usando fallback padrão (NÃO salva no Firebase)');
    console.log('💡 Configure as taxas via Admin > Configurações de Pagamento');
    return DEFAULT_FEES_FALLBACK;
    
  } catch (error) {
    console.error('❌ Erro ao carregar taxas:', error);
    return DEFAULT_FEES_FALLBACK;
  }
}

export default {
  loadEternalCredentials,
  saveEternalCredentialsToFirebase,
  syncEternalCredentials,
  checkCredentialsStatus,
  saveEternalFeesToFirebase,
  loadEternalFees
};
