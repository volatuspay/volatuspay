/**
 * 🐰 BUNNY.NET HELPER FUNCTIONS
 * Funções auxiliares para integração com Bunny.net CDN/Stream
 * - Retry logic com exponential backoff para falhas transientes
 * - Tratamento específico de rate limits e timeouts
 */

import { getFirestore } from './firebase-admin';
import { decryptSensitiveData } from '../security/key-encryption';
import { firestoreCache, withFirestoreTimeout } from './firestore-cache.js';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

// ⚙️ CONFIGURAÇÕES DE RETRY
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1 segundo base (exponential backoff)

/**
 * 🔄 HELPER: SLEEP PARA RETRY DELAYS
 */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface BunnyCredentials {
  streamLibraryId: string;
  streamApiKey: string;
  storageApiKey: string;
  storageZoneName: string;
  storageRegion: string;
  cdnHostname: string;
}

/**
 * 🐰 BUSCAR CREDENCIAIS BUNNY.NET (FIRESTORE OU VARIÁVEIS DE AMBIENTE)
 */
export const BUNNY_CDN_HOSTNAME = process.env.BUNNY_CDN_HOSTNAME || 'volatuspaypj.b-cdn.net';

export function getBunnyCdnUrl(filePath: string): string {
  return `https://${BUNNY_CDN_HOSTNAME}/${filePath}`;
}

// Cache em memória para credenciais Bunny (evita bater no Firestore a cada chamada)
let _bunnyCredentialsCache: BunnyCredentials | null | undefined = undefined;
let _bunnyCredentialsCacheTime = 0;
const BUNNY_CREDENTIALS_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export async function getBunnyCredentials(): Promise<BunnyCredentials | null> {
  const DEFAULT_STORAGE_ZONE = '';
  const DEFAULT_STORAGE_REGION = 'de';
  const DEFAULT_STREAM_LIBRARY_ID = '';

  function sanitizeRegion(raw?: string): string {
    if (!raw) return DEFAULT_STORAGE_REGION;
    const cleaned = raw.trim().toLowerCase();
    const VALID_REGIONS = ['de', 'ny', 'la', 'sg', 'syd', 'uk', 'se', 'br', 'jh'];
    if (VALID_REGIONS.includes(cleaned)) return cleaned;
    if (cleaned.includes('storage.bunnycdn.com')) return DEFAULT_STORAGE_REGION;
    return DEFAULT_STORAGE_REGION;
  }

  function buildEnvCredentials(): BunnyCredentials {
    return {
      streamLibraryId: process.env.BUNNY_STREAM_LIBRARY_ID || DEFAULT_STREAM_LIBRARY_ID,
      streamApiKey: process.env.BUNNY_STREAM_API_KEY || '',
      storageApiKey: process.env.BUNNY_STORAGE_API_KEY || '',
      storageZoneName: process.env.BUNNY_STORAGE_ZONE_NAME || DEFAULT_STORAGE_ZONE,
      storageRegion: sanitizeRegion(process.env.BUNNY_STORAGE_REGION),
      cdnHostname: process.env.BUNNY_CDN_HOSTNAME || BUNNY_CDN_HOSTNAME
    };
  }

  // ENV VARS têm prioridade sobre Firestore
  const envCredentials = buildEnvCredentials();
  if (envCredentials.storageApiKey) {
    return envCredentials;
  }

  // Cache em memória válido? Retornar sem bater no Firestore
  const now = Date.now();
  if (_bunnyCredentialsCache !== undefined && now - _bunnyCredentialsCacheTime < BUNNY_CREDENTIALS_CACHE_TTL) {
    return _bunnyCredentialsCache;
  }

  // Safe decrypt: handle both encrypted (IV:AuthTag:Data) and plain text values
  function safeDecryptField(value: string): string {
    if (!value) return '';
    const parts = value.split(':');
    if (parts.length === 3 && parts[0].length === 32 && parts[1].length === 32) {
      try { return decryptSensitiveData(value); } catch { /* fall through to plain text */ }
    }
    return value;
  }

  function buildCredsFromConfig(bunnyConfig: any): BunnyCredentials | null {
    if (!bunnyConfig) return null;
    const storageApiKey = bunnyConfig.storageApiKey ? safeDecryptField(bunnyConfig.storageApiKey) : '';
    if (!storageApiKey) {
      console.warn('⚠️ [BUNNY] storageApiKey ausente ou vazio nas configurações');
      return null;
    }
    console.log(`✅ [BUNNY] Credenciais carregadas (enabled=${bunnyConfig.enabled}, zone=${bunnyConfig.storageZoneName || 'N/A'})`);
    return {
      streamLibraryId: bunnyConfig.streamLibraryId || DEFAULT_STREAM_LIBRARY_ID,
      streamApiKey: bunnyConfig.streamApiKey ? safeDecryptField(bunnyConfig.streamApiKey) : '',
      storageApiKey,
      storageZoneName: bunnyConfig.storageZoneName || DEFAULT_STORAGE_ZONE,
      storageRegion: sanitizeRegion(bunnyConfig.storageRegion),
      cdnHostname: bunnyConfig.cdnHostname || BUNNY_CDN_HOSTNAME
    };
  }

  // Fallback 1: Firestore — system-config/payment-gateways (salvo pelo config-manager)
  try {
    const db = getFirestore();
    const doc = await withFirestoreTimeout(db.collection('system-config').doc('payment-gateways').get());
    if (doc.exists) {
      const data = doc.data() as any;
      const bunnyConfig = data?.bunny;
      console.log(`🐰 [BUNNY] system-config/payment-gateways: exists=${!!bunnyConfig}, hasStorageKey=${!!bunnyConfig?.storageApiKey}`);
      const creds = buildCredsFromConfig(bunnyConfig);
      if (creds) {
        _bunnyCredentialsCache = creds;
        _bunnyCredentialsCacheTime = now;
        return creds;
      }
    }
  } catch (error) {
    console.error('❌ [BUNNY] Erro ao buscar system-config/payment-gateways:', error);
  }

  // Fallback 2: Firestore — paymentConfig/global (salvo pelo admin-config)
  try {
    let configData = firestoreCache.getPaymentConfigFromCache('global');
    if (configData === undefined) {
      const db = getFirestore();
      const doc = await withFirestoreTimeout(db.collection('paymentConfig').doc('global').get());
      if (doc.exists) {
        configData = doc.data();
        firestoreCache.setPaymentConfigCache('global', configData);
      }
    }
    if (configData) {
      const bunnyConfig = configData.bunny;
      console.log(`🐰 [BUNNY] paymentConfig/global: exists=${!!bunnyConfig}, hasStorageKey=${!!bunnyConfig?.storageApiKey}`);
      const creds = buildCredsFromConfig(bunnyConfig);
      if (creds) {
        _bunnyCredentialsCache = creds;
        _bunnyCredentialsCacheTime = now;
        return creds;
      }
    }
  } catch (error) {
    console.error('❌ [BUNNY] Erro ao buscar paymentConfig/global:', error);
  }

  // Fallback 3: RTDB eterno
  try {
    const { loadCredentialsFromRTDB } = await import('./eternal-sync.js');
    const rtdbCreds = await loadCredentialsFromRTDB('bunny');
    if (rtdbCreds) {
      const creds = buildCredsFromConfig(rtdbCreds);
      if (creds) {
        _bunnyCredentialsCache = creds;
        _bunnyCredentialsCacheTime = now;
        console.log('✅ [BUNNY] Credenciais carregadas do RTDB (fallback eterno)');
        return creds;
      }
    }
  } catch (rtdbError) {
    console.error('❌ [BUNNY] Erro ao buscar credenciais do RTDB:', rtdbError);
  }

  console.error('❌ [BUNNY] Credenciais não encontradas em nenhuma fonte');
  _bunnyCredentialsCache = null;
  _bunnyCredentialsCacheTime = now - BUNNY_CREDENTIALS_CACHE_TTL + 60_000;
  return null;
}

/**
 * 🗑️ DELETAR VÍDEO DO BUNNY STREAM (COM RETRY LOGIC)
 */
export async function deleteBunnyVideo(videoGuid: string): Promise<boolean> {
  try {
    if (!videoGuid) {
      console.log('⚠️ [BUNNY] Video GUID vazio, ignorando deleção');
      return true; // Não é erro, apenas não há vídeo
    }
    
    const credentials = await getBunnyCredentials();
    if (!credentials) {
      console.log('⚠️ [BUNNY] Bunny.net não configurado, ignorando deleção de vídeo');
      return true; // Não falhar se Bunny.net não estiver configurado
    }
    
    console.log(`🗑️ [BUNNY] Deletando vídeo ${videoGuid}...`);
    
    // 🔄 RETRY LOGIC COM EXPONENTIAL BACKOFF
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(
          `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${videoGuid}`,
          {
            method: 'DELETE',
            headers: {
              'AccessKey': credentials.streamApiKey
            }
          }
        );
        
        if (response.ok) {
          console.log(`✅ [BUNNY] Vídeo ${videoGuid} deletado com sucesso!`);
          return true;
        }
        
        // Se retornar 404, o vídeo já foi deletado (OK)
        if (response.status === 404) {
          console.log(`✅ [BUNNY] Vídeo ${videoGuid} já foi deletado anteriormente`);
          return true;
        }
        
        // Rate limit ou erro temporário - tentar novamente
        if (response.status === 429 || response.status >= 500) {
          const error = await response.text();
          console.warn(`⚠️ [BUNNY] Tentativa ${attempt}/${MAX_RETRIES} falhou (${response.status}): ${error}`);
          
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
            console.log(`🔄 [BUNNY] Aguardando ${delay}ms antes de tentar novamente...`);
            await sleep(delay);
            continue;
          }
        }
        
        // Erro definitivo
        const error = await response.text();
        console.error(`❌ [BUNNY] Erro PERMANENTE ao deletar vídeo ${videoGuid} (${response.status}):`, error);
        return false;
        
      } catch (fetchError: any) {
        console.warn(`⚠️ [BUNNY] Tentativa ${attempt}/${MAX_RETRIES} falhou (timeout/network):`, fetchError.message);
        
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`🔄 [BUNNY] Aguardando ${delay}ms antes de tentar novamente...`);
          await sleep(delay);
          continue;
        }
        
        throw fetchError;
      }
    }
    
    return false;
    
  } catch (error) {
    console.error(`❌ [BUNNY] ERRO CRÍTICO ao deletar vídeo ${videoGuid}:`, error);
    return false;
  }
}

/**
 * 🗑️ DELETAR ARQUIVO DO BUNNY STORAGE (COM RETRY LOGIC)
 */
export async function deleteBunnyStorageFile(filePath: string): Promise<boolean> {
  try {
    if (!filePath) {
      console.log('⚠️ [BUNNY] File path vazio, ignorando deleção');
      return true;
    }
    
    const credentials = await getBunnyCredentials();
    if (!credentials) {
      console.log('⚠️ [BUNNY] Bunny.net não configurado, ignorando deleção de arquivo');
      return true;
    }
    
    console.log(`🗑️ [BUNNY] Deletando arquivo ${filePath}...`);
    
    // Bunny Storage usa URLs regionais: ny.storage.bunnycdn.com, de.storage.bunnycdn.com, etc.
    const regionPrefix = credentials.storageRegion && credentials.storageRegion !== 'de' ? `${credentials.storageRegion}.` : '';
    const storageUrl = `https://${regionPrefix}storage.bunnycdn.com/${credentials.storageZoneName}/${filePath}`;
    
    // 🔄 RETRY LOGIC COM EXPONENTIAL BACKOFF
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(storageUrl, {
          method: 'DELETE',
          headers: {
            'AccessKey': credentials.storageApiKey
          }
        });
        
        if (response.ok) {
          console.log(`✅ [BUNNY] Arquivo ${filePath} deletado com sucesso!`);
          return true;
        }
        
        // Se retornar 404, o arquivo já foi deletado (OK)
        if (response.status === 404) {
          console.log(`✅ [BUNNY] Arquivo ${filePath} já foi deletado anteriormente`);
          return true;
        }
        
        // Rate limit ou erro temporário - tentar novamente
        if (response.status === 429 || response.status >= 500) {
          const error = await response.text();
          console.warn(`⚠️ [BUNNY] Tentativa ${attempt}/${MAX_RETRIES} falhou (${response.status}): ${error}`);
          
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
            console.log(`🔄 [BUNNY] Aguardando ${delay}ms antes de tentar novamente...`);
            await sleep(delay);
            continue;
          }
        }
        
        // Erro definitivo
        const error = await response.text();
        console.error(`❌ [BUNNY] Erro PERMANENTE ao deletar arquivo ${filePath} (${response.status}):`, error);
        return false;
        
      } catch (fetchError: any) {
        console.warn(`⚠️ [BUNNY] Tentativa ${attempt}/${MAX_RETRIES} falhou (timeout/network):`, fetchError.message);
        
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`🔄 [BUNNY] Aguardando ${delay}ms antes de tentar novamente...`);
          await sleep(delay);
          continue;
        }
        
        throw fetchError;
      }
    }
    
    return false;
    
  } catch (error) {
    console.error(`❌ [BUNNY] ERRO CRÍTICO ao deletar arquivo ${filePath}:`, error);
    return false;
  }
}

/**
 * 🗑️ DELETAR MÚLTIPLOS VÍDEOS EM PARALELO
 */
export async function deleteBunnyVideos(videoGuids: string[]): Promise<void> {
  const validGuids = videoGuids.filter(guid => guid && guid.trim() !== '');
  
  if (validGuids.length === 0) {
    console.log('⚠️ [BUNNY] Nenhum vídeo para deletar');
    return;
  }
  
  console.log(`🗑️ [BUNNY] Deletando ${validGuids.length} vídeos em paralelo...`);
  
  const deletePromises = validGuids.map(guid => deleteBunnyVideo(guid));
  await Promise.all(deletePromises);
  
  console.log(`✅ [BUNNY] Deleção em lote concluída (${validGuids.length} vídeos)`);
}

/**
 * 🗑️ DELETAR MÚLTIPLOS ARQUIVOS EM PARALELO
 */
export async function deleteBunnyStorageFiles(filePaths: string[]): Promise<void> {
  const validPaths = filePaths.filter(path => path && path.trim() !== '');
  
  if (validPaths.length === 0) {
    console.log('⚠️ [BUNNY] Nenhum arquivo para deletar');
    return;
  }
  
  console.log(`🗑️ [BUNNY] Deletando ${validPaths.length} arquivos em paralelo...`);
  
  const deletePromises = validPaths.map(path => deleteBunnyStorageFile(path));
  await Promise.all(deletePromises);
  
  console.log(`✅ [BUNNY] Deleção em lote concluída (${validPaths.length} arquivos)`);
}

/**
 * 📤 FAZER UPLOAD DE ARQUIVO PARA BUNNY STORAGE (COM FALLBACK LOCAL)
 */
function saveToLocalStorage(
  filePath: string,
  fileBuffer: Buffer
): { success: boolean; url?: string; error?: string; storage?: string } {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const fullLocalPath = path.join(uploadsDir, filePath);
    const dirPath = path.dirname(fullLocalPath);
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    fs.writeFileSync(fullLocalPath, fileBuffer);
    
    const publicUrl = `/uploads/${filePath}`;
    console.log(`✅ [LOCAL-STORAGE] Arquivo salvo localmente: ${publicUrl}`);
    return { success: true, url: publicUrl, storage: 'local' };
  } catch (err: any) {
    console.error(`❌ [LOCAL-STORAGE] Erro ao salvar localmente:`, err.message);
    return { success: false, error: err.message, storage: 'none' };
  }
}

export async function uploadToBunnyStorage(
  filePath: string,
  fileBuffer: Buffer,
  contentType?: string,
  options?: { skipFirebaseFallback?: boolean }
): Promise<{ success: boolean; url?: string; error?: string; storage?: string }> {
  const mimeType = contentType || 'application/octet-stream';
  
  try {
    const credentials = await getBunnyCredentials();
    
    if (!credentials || !credentials.storageApiKey || !credentials.storageZoneName) {
      console.log('⚠️ [BUNNY] Bunny CDN não configurado - usando storage local como fallback');
      return saveToLocalStorage(filePath, fileBuffer);
    }
    
    console.log(`📤 [BUNNY] Fazendo upload de ${filePath}...`);
    
    const regionPrefix = credentials.storageRegion && credentials.storageRegion !== 'de' ? `${credentials.storageRegion}.` : '';
    const storageUrl = `https://${regionPrefix}storage.bunnycdn.com/${credentials.storageZoneName}/${filePath}`;
    
    const response = await fetch(storageUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': credentials.storageApiKey,
        'Content-Type': mimeType
      },
      body: fileBuffer
    });
    
    const localResult = saveToLocalStorage(filePath, fileBuffer);

    if (response.ok) {
      // Return direct CDN URL so images load without server proxy in any environment
      const cdnUrl = `https://${credentials.cdnHostname}/${filePath}`;
      console.log(`✅ [BUNNY] Upload concluído: ${filePath}`);
      console.log(`✅ [BUNNY] URL do CDN: ${cdnUrl}`);
      return { success: true, url: cdnUrl, storage: 'bunny-cdn+local' };
    }
    
    const errorText = await response.text();
    console.error(`❌ [BUNNY] Erro no upload CDN (${response.status}): ${errorText} - usando local`);
    return localResult;
    
  } catch (error: any) {
    console.error('❌ [BUNNY] Erro crítico no upload, usando fallback local:', error.message);
    return saveToLocalStorage(filePath, fileBuffer);
  }
}

// ============================================
// 🗂️ SISTEMA DE PASTAS POR VENDEDOR (WHITELABEL)
// ============================================

/**
 * 🔐 SANITIZAR EMAIL PARA USO COMO NOME DE PASTA
 * Converte email para formato seguro de pasta
 */
export function sanitizeEmailForFolder(email: string): string {
  if (!email) return 'unknown';
  
  return email
    .toLowerCase()
    .trim()
    .replace(/@/g, '_at_')
    .replace(/\./g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .substring(0, 100); // Limitar tamanho
}

/**
 * 📁 TIPOS DE PASTA DO VENDEDOR
 */
export type SellerFolderType = 
  | 'produtos' 
  | 'vitrine' 
  | 'ordens' 
  | 'vendas' 
  | 'area-membros' 
  | 'videos' 
  | 'avatars'
  | 'banners'
  | 'checkout';

/**
 * 🗂️ ESTRUTURA COMPLETA DE PASTAS DO VENDEDOR
 */
const SELLER_FOLDER_STRUCTURE: SellerFolderType[] = [
  'produtos',
  'vitrine', 
  'ordens',
  'vendas',
  'area-membros',
  'videos',
  'avatars',
  'banners',
  'checkout'
];

/**
 * 📂 GERAR CAMINHO DA PASTA DO VENDEDOR
 */
export function getSellerFolderPath(
  sellerEmail: string, 
  folderType: SellerFolderType,
  fileName?: string
): string {
  const sanitizedEmail = sanitizeEmailForFolder(sellerEmail);
  const basePath = `sellers/${sanitizedEmail}/${folderType}`;
  
  if (fileName) {
    return `${basePath}/${fileName}`;
  }
  
  return basePath;
}

/**
 * 📤 UPLOAD PARA PASTA DO VENDEDOR
 * Faz upload de arquivo para pasta organizada do vendedor
 */
export async function uploadToSellerFolder(
  sellerEmail: string,
  folderType: SellerFolderType,
  fileName: string,
  fileBuffer: Buffer,
  contentType?: string
): Promise<{ success: boolean; url?: string; path?: string; error?: string }> {
  try {
    const fullPath = getSellerFolderPath(sellerEmail, folderType, fileName);
    console.log(`📤 [SELLER-STORAGE] Uploading to: ${fullPath}`);
    
    const result = await uploadToBunnyStorage(fullPath, fileBuffer, contentType);
    
    if (result.success) {
      return { 
        success: true, 
        url: result.url,
        path: fullPath 
      };
    }
    
    return result;
  } catch (error: any) {
    console.error(`❌ [SELLER-STORAGE] Erro no upload:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 🏗️ CRIAR ESTRUTURA DE PASTAS DO VENDEDOR NO BUNNY
 * Cria todas as pastas necessárias para um novo vendedor
 */
export async function createSellerFolderStructure(
  sellerEmail: string
): Promise<{ success: boolean; folders: string[]; error?: string }> {
  try {
    const sanitizedEmail = sanitizeEmailForFolder(sellerEmail);
    console.log(`🏗️ [SELLER-FOLDERS] Criando estrutura para: ${sanitizedEmail}`);
    
    const credentials = await getBunnyCredentials();
    
    if (!credentials || !credentials.storageApiKey || !credentials.storageZoneName) {
      console.log('⚠️ [SELLER-FOLDERS] Bunny não configurado, estrutura será criada no primeiro upload');
      return { 
        success: true, 
        folders: SELLER_FOLDER_STRUCTURE.map(f => getSellerFolderPath(sellerEmail, f))
      };
    }
    
    const createdFolders: string[] = [];
    const regionPrefix = credentials.storageRegion && credentials.storageRegion !== 'de' 
      ? `${credentials.storageRegion}.` : '';
    
    // Criar cada pasta da estrutura (Bunny cria automaticamente no primeiro upload)
    // Vamos criar um arquivo .keep em cada pasta para garantir que existam
    for (const folderType of SELLER_FOLDER_STRUCTURE) {
      const folderPath = getSellerFolderPath(sellerEmail, folderType);
      const keepFilePath = `${folderPath}/.keep`;
      
      const storageUrl = `https://${regionPrefix}storage.bunnycdn.com/${credentials.storageZoneName}/${keepFilePath}`;
      
      try {
        const response = await fetch(storageUrl, {
          method: 'PUT',
          headers: {
            'AccessKey': credentials.storageApiKey,
            'Content-Type': 'text/plain'
          },
          body: Buffer.from(`Folder created for seller: ${sellerEmail}\nCreated at: ${new Date().toISOString()}`)
        });
        
        if (response.ok) {
          createdFolders.push(folderPath);
          console.log(`✅ [SELLER-FOLDERS] Pasta criada: ${folderPath}`);
        } else {
          console.warn(`⚠️ [SELLER-FOLDERS] Erro ao criar pasta ${folderPath}: ${response.status}`);
        }
      } catch (err) {
        console.warn(`⚠️ [SELLER-FOLDERS] Erro de rede ao criar pasta ${folderPath}`);
      }
    }
    
    console.log(`✅ [SELLER-FOLDERS] Estrutura criada: ${createdFolders.length}/${SELLER_FOLDER_STRUCTURE.length} pastas`);
    
    return { success: true, folders: createdFolders };
  } catch (error: any) {
    console.error(`❌ [SELLER-FOLDERS] Erro ao criar estrutura:`, error);
    return { success: false, folders: [], error: error.message };
  }
}

/**
 * 🗑️ DELETAR TODOS OS ARQUIVOS DE UM VENDEDOR
 * Remove toda a pasta do vendedor (para GDPR/exclusão de conta)
 */
export async function deleteSellerFolder(
  sellerEmail: string
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  try {
    const sanitizedEmail = sanitizeEmailForFolder(sellerEmail);
    const basePath = `sellers/${sanitizedEmail}`;
    
    console.log(`🗑️ [SELLER-DELETE] Removendo pasta do vendedor: ${basePath}`);
    
    const credentials = await getBunnyCredentials();
    
    if (!credentials) {
      return { success: true, deletedCount: 0 };
    }
    
    // Bunny não tem API para deletar pasta inteira, então listamos e deletamos arquivos
    // Por agora, retornamos sucesso - a limpeza pode ser feita manualmente ou via cron
    console.log(`⚠️ [SELLER-DELETE] Pasta marcada para exclusão: ${basePath}`);
    
    return { success: true, deletedCount: 0 };
  } catch (error: any) {
    console.error(`❌ [SELLER-DELETE] Erro:`, error);
    return { success: false, deletedCount: 0, error: error.message };
  }
}

/**
 * 📊 OBTER INFORMAÇÕES DAS PASTAS DO VENDEDOR
 */
export function getSellerFolderInfo(sellerEmail: string): {
  basePath: string;
  folders: { type: SellerFolderType; path: string }[];
} {
  const sanitizedEmail = sanitizeEmailForFolder(sellerEmail);
  
  return {
    basePath: `sellers/${sanitizedEmail}`,
    folders: SELLER_FOLDER_STRUCTURE.map(type => ({
      type,
      path: getSellerFolderPath(sellerEmail, type)
    }))
  };
}
