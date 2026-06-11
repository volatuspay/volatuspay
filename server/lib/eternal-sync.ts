import { getRTDB } from './firebase-admin.js';
import fs from 'fs';
import path from 'path';

const RTDB_BASE_PATH = 'tetri-system';
const CERT_RTDB_PATH = 'system/certificates/efibank-prod';
const LOCAL_CERT_PATH = path.join(process.cwd(), 'certs', 'efi-prod.p12');

function sanitizeForRTDB(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForRTDB);
  
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = sanitizeForRTDB(value);
    }
  }
  return cleaned;
}

export async function syncAcquirerToRTDB(
  acquirerName: string,
  data: Record<string, any>
): Promise<void> {
  try {
    const rtdb = getRTDB();
    const path = `${RTDB_BASE_PATH}/acquirers/${acquirerName}`;
    
    const payload = sanitizeForRTDB({
      ...data,
      lastSyncAt: new Date().toISOString(),
      syncSource: 'admin-panel',
    });
    
    await rtdb.ref(path).set(payload);
    console.log(`✅ [ETERNAL-SYNC] Adquirente ${acquirerName} sincronizado no RTDB: ${path}`);
  } catch (error: any) {
    console.error(`❌ [ETERNAL-SYNC] Erro ao sincronizar ${acquirerName}:`, error?.message);
  }
}

export async function syncAllAcquirersToRTDB(config: Record<string, any>): Promise<void> {
  try {
    const rtdb = getRTDB();
    const updates: Record<string, any> = {};
    
    if (config.defaultAcquirers) {
      updates[`${RTDB_BASE_PATH}/acquirers/_defaultAcquirers`] = sanitizeForRTDB({
        ...config.defaultAcquirers,
        lastSyncAt: new Date().toISOString(),
      });
    }

    const acquirerNames = ['stripe', 'efibank', 'adyen', 'woovi', 'pagarme', 'bunny', 'witetec'];
    for (const name of acquirerNames) {
      if (config[name]) {
        updates[`${RTDB_BASE_PATH}/acquirers/${name}`] = sanitizeForRTDB({
          ...config[name],
          lastSyncAt: new Date().toISOString(),
          eternal: true,
        });
      }
    }
    
    if (Object.keys(updates).length > 0) {
      await rtdb.ref().update(updates);
      console.log(`✅ [ETERNAL-SYNC] ${Object.keys(updates).length} adquirentes sincronizados no RTDB (update, sem apagar existentes)`);
    }
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao sincronizar adquirentes:', error?.message);
  }
}

export async function syncCredentialsToRTDB(acquirerName: string, encryptedCredentials: Record<string, any>): Promise<void> {
  try {
    const rtdb = getRTDB();
    const path = `${RTDB_BASE_PATH}/credentials/${acquirerName}`;
    
    const payload = sanitizeForRTDB({
      ...encryptedCredentials,
      lastSyncAt: new Date().toISOString(),
      eternal: true,
    });
    
    await rtdb.ref(path).set(payload);
    console.log(`✅ [ETERNAL-SYNC] Credenciais ${acquirerName} salvas no RTDB ETERNAMENTE: ${path}`);
  } catch (error: any) {
    console.error(`❌ [ETERNAL-SYNC] Erro ao salvar credenciais ${acquirerName}:`, error?.message);
  }
}

export async function syncAllCredentialsToRTDB(encryptedConfig: Record<string, any>): Promise<void> {
  try {
    const rtdb = getRTDB();
    const updates: Record<string, any> = {};
    
    const acquirerNames = ['stripe', 'efibank', 'adyen', 'woovi', 'pagarme', 'bunny'];
    for (const name of acquirerNames) {
      if (encryptedConfig[name]) {
        updates[`${RTDB_BASE_PATH}/credentials/${name}`] = sanitizeForRTDB({
          ...encryptedConfig[name],
          lastSyncAt: new Date().toISOString(),
          eternal: true,
        });
      }
    }
    
    if (Object.keys(updates).length > 0) {
      await rtdb.ref().update(updates);
      console.log(`✅ [ETERNAL-SYNC] Credenciais de ${Object.keys(updates).length} adquirentes salvas ETERNAMENTE no RTDB`);
    }
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao salvar credenciais no RTDB:', error?.message);
  }
}

export async function loadCredentialsFromRTDB(acquirerName: string): Promise<Record<string, any> | null> {
  try {
    const rtdb = getRTDB();
    const snapshot = await rtdb.ref(`${RTDB_BASE_PATH}/credentials/${acquirerName}`).once('value');
    if (snapshot.exists()) {
      console.log(`✅ [ETERNAL-SYNC] Credenciais ${acquirerName} carregadas do RTDB (backup eterno)`);
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error(`❌ [ETERNAL-SYNC] Erro ao carregar credenciais ${acquirerName} do RTDB:`, error?.message);
    return null;
  }
}

export async function syncGlobalFeesToRTDB(fees: Record<string, any>, updatedBy?: string): Promise<void> {
  try {
    const rtdb = getRTDB();
    const path = `${RTDB_BASE_PATH}/fees/global`;
    
    const payload = sanitizeForRTDB({
      ...fees,
      lastSyncAt: new Date().toISOString(),
      updatedBy: updatedBy || 'system',
      eternal: true,
    });
    
    await rtdb.ref(path).set(payload);
    console.log(`✅ [ETERNAL-SYNC] Taxas globais sincronizadas no RTDB: ${path}`);
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao sincronizar taxas globais:', error?.message);
  }
}

export async function syncSellerFeesToRTDB(
  sellerId: string,
  feeData: Record<string, any>,
  updatedBy?: string
): Promise<void> {
  try {
    const rtdb = getRTDB();
    const path = `${RTDB_BASE_PATH}/fees/sellers/${sellerId}`;
    
    const payload = sanitizeForRTDB({
      ...feeData,
      sellerId,
      lastSyncAt: new Date().toISOString(),
      updatedBy: updatedBy || 'admin',
    });
    
    await rtdb.ref(path).set(payload);
    console.log(`✅ [ETERNAL-SYNC] Taxas do seller ${sellerId} sincronizadas no RTDB: ${path}`);
  } catch (error: any) {
    console.error(`❌ [ETERNAL-SYNC] Erro ao sincronizar taxas do seller ${sellerId}:`, error?.message);
  }
}

export async function syncWithdrawalConfigToRTDB(config: {
  pixReleaseDays?: number;
  creditCardBRReleaseDays?: number;
  creditCardGlobalReleaseDays?: number;
  boletoReleaseDays?: number;
  [key: string]: any;
}): Promise<void> {
  try {
    const rtdb = getRTDB();
    const path = `${RTDB_BASE_PATH}/withdrawal-config`;
    
    const payload = sanitizeForRTDB({
      pixReleaseDays: config.pixReleaseDays ?? 0,
      creditCardBRReleaseDays: config.creditCardBRReleaseDays ?? 30,
      creditCardGlobalReleaseDays: config.creditCardGlobalReleaseDays ?? 30,
      boletoReleaseDays: config.boletoReleaseDays ?? 2,
      lastSyncAt: new Date().toISOString(),
      eternal: true,
    });
    
    await rtdb.ref(path).set(payload);
    console.log(`✅ [ETERNAL-SYNC] Prazos de saque sincronizados no RTDB: ${path}`);
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao sincronizar prazos de saque:', error?.message);
  }
}

export async function syncFullConfigToRTDB(fullConfig: {
  acquirers?: Record<string, any>;
  defaultAcquirers?: Record<string, any>;
  fees?: Record<string, any>;
  withdrawalDays?: Record<string, any>;
}): Promise<void> {
  try {
    const rtdb = getRTDB();
    
    const payload: Record<string, any> = {
      lastFullSyncAt: new Date().toISOString(),
      syncVersion: 2,
    };
    
    if (fullConfig.acquirers || fullConfig.defaultAcquirers) {
      const acquirers: Record<string, any> = {};
      if (fullConfig.defaultAcquirers) {
        acquirers._defaultAcquirers = sanitizeForRTDB(fullConfig.defaultAcquirers);
      }
      if (fullConfig.acquirers) {
        for (const [name, data] of Object.entries(fullConfig.acquirers)) {
          acquirers[name] = sanitizeForRTDB(data);
        }
      }
      payload.acquirers = acquirers;
    }
    
    if (fullConfig.fees) {
      payload.fees = { global: sanitizeForRTDB(fullConfig.fees) };
    }
    
    if (fullConfig.withdrawalDays) {
      payload['withdrawal-config'] = sanitizeForRTDB(fullConfig.withdrawalDays);
    }
    
    await rtdb.ref(RTDB_BASE_PATH).update(payload);
    console.log('✅ [ETERNAL-SYNC] Sincronização completa no RTDB realizada!');
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro na sincronização completa:', error?.message);
  }
}

export async function loadAcquirersFromRTDB(): Promise<Record<string, any> | null> {
  try {
    const rtdb = getRTDB();
    const snapshot = await rtdb.ref(`${RTDB_BASE_PATH}/acquirers`).once('value');
    if (snapshot.exists()) {
      console.log('✅ [ETERNAL-SYNC] Adquirentes carregados do RTDB');
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao carregar adquirentes do RTDB:', error?.message);
    return null;
  }
}

export async function loadGlobalFeesFromRTDB(): Promise<Record<string, any> | null> {
  try {
    const rtdb = getRTDB();
    const snapshot = await rtdb.ref(`${RTDB_BASE_PATH}/fees/global`).once('value');
    if (snapshot.exists()) {
      console.log('✅ [ETERNAL-SYNC] Taxas globais carregadas do RTDB');
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao carregar taxas globais do RTDB:', error?.message);
    return null;
  }
}

export async function loadSellerFeesFromRTDB(sellerId: string): Promise<Record<string, any> | null> {
  try {
    const rtdb = getRTDB();
    const snapshot = await rtdb.ref(`${RTDB_BASE_PATH}/fees/sellers/${sellerId}`).once('value');
    if (snapshot.exists()) {
      console.log(`✅ [ETERNAL-SYNC] Taxas do seller ${sellerId} carregadas do RTDB`);
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error(`❌ [ETERNAL-SYNC] Erro ao carregar taxas do seller ${sellerId}:`, error?.message);
    return null;
  }
}

export async function loadWithdrawalConfigFromRTDB(): Promise<Record<string, any> | null> {
  try {
    const rtdb = getRTDB();
    const snapshot = await rtdb.ref(`${RTDB_BASE_PATH}/withdrawal-config`).once('value');
    if (snapshot.exists()) {
      console.log('✅ [ETERNAL-SYNC] Prazos de saque carregados do RTDB');
      return snapshot.val();
    }
    return null;
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao carregar prazos de saque do RTDB:', error?.message);
    return null;
  }
}

export async function syncCertificateToRTDB(certBuffer: Buffer, source: string = 'admin-panel'): Promise<boolean> {
  try {
    if (!certBuffer || certBuffer.length < 256) {
      console.warn('⚠️ [ETERNAL-SYNC] Certificado inválido ou vazio - não sincronizando');
      return false;
    }
    const rtdb = getRTDB();
    await rtdb.ref(CERT_RTDB_PATH).set({
      base64: certBuffer.toString('base64'),
      sizeBytes: certBuffer.length,
      source,
      savedAt: new Date().toISOString(),
      eternal: true,
    });
    console.log(`✅ [ETERNAL-SYNC] Certificado EfíBank salvo ETERNAMENTE no RTDB: ${certBuffer.length} bytes`);
    return true;
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao salvar certificado no RTDB:', error?.message);
    return false;
  }
}

export async function loadCertificateFromRTDB(): Promise<Buffer | null> {
  try {
    const rtdb = getRTDB();
    const snap = await rtdb.ref(CERT_RTDB_PATH).once('value');
    if (!snap.exists()) return null;
    const data = snap.val();
    if (!data?.base64) return null;
    const buf = Buffer.from(data.base64, 'base64');
    if (buf.length < 256) return null;
    console.log(`✅ [ETERNAL-SYNC] Certificado carregado do RTDB: ${buf.length} bytes`);
    return buf;
  } catch (error: any) {
    console.error('❌ [ETERNAL-SYNC] Erro ao carregar certificado do RTDB:', error?.message);
    return null;
  }
}

export async function restoreCertificateFromRTDB(): Promise<boolean> {
  try {
    const localExists = fs.existsSync(LOCAL_CERT_PATH);
    const localSize = localExists ? fs.statSync(LOCAL_CERT_PATH).size : 0;

    if (localExists && localSize > 256) {
      console.log(`✅ [ETERNAL-SYNC] Certificado local encontrado (${localSize} bytes) - verificando RTDB...`);

      // Sincronização bidirecional: se RTDB não tem o cert, salva o local
      try {
        const rtdb = getRTDB();
        const snap = await rtdb.ref(CERT_RTDB_PATH).once('value');
        if (!snap.exists() || !snap.val()?.base64) {
          const localBuf = fs.readFileSync(LOCAL_CERT_PATH);
          await syncCertificateToRTDB(localBuf, 'startup-local-sync');
          console.log(`🔄 [ETERNAL-SYNC] Cert local salvo no RTDB automaticamente (${localBuf.length} bytes)`);
        } else {
          console.log(`✅ [ETERNAL-SYNC] Cert já está no RTDB (${snap.val().sizeBytes} bytes) - nada a fazer`);
        }
      } catch (syncErr: any) {
        console.warn(`⚠️ [ETERNAL-SYNC] Falha ao verificar/sincronizar cert no RTDB: ${syncErr?.message}`);
      }

      return true;
    }

    const buf = await loadCertificateFromRTDB();
    if (!buf) {
      console.log('ℹ️ [ETERNAL-SYNC] Nenhum certificado no RTDB para restaurar localmente');
      return false;
    }
    const certsDir = path.dirname(LOCAL_CERT_PATH);
    if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });
    fs.writeFileSync(LOCAL_CERT_PATH, buf);
    console.log(`✅ [ETERNAL-SYNC] Certificado restaurado do RTDB para disco local: ${buf.length} bytes`);
    return true;
  } catch (error: any) {
    console.warn(`⚠️ [ETERNAL-SYNC] Restauração do certificado falhou (não crítico): ${error?.message}`);
    return false;
  }
}

export default {
  syncAcquirerToRTDB,
  syncAllAcquirersToRTDB,
  syncCredentialsToRTDB,
  syncAllCredentialsToRTDB,
  loadCredentialsFromRTDB,
  syncGlobalFeesToRTDB,
  syncSellerFeesToRTDB,
  syncWithdrawalConfigToRTDB,
  syncFullConfigToRTDB,
  loadAcquirersFromRTDB,
  loadGlobalFeesFromRTDB,
  loadSellerFeesFromRTDB,
  loadWithdrawalConfigFromRTDB,
  syncCertificateToRTDB,
  loadCertificateFromRTDB,
  restoreCertificateFromRTDB,
};
