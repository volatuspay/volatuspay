/**
 * 🟡 EFIBANK REFUNDS API - Consulta real de devoluções/MEDs PIX
 * Integração com API PIX da EfíBank para consultar devoluções e MEDs
 */

import admin from 'firebase-admin';
import https from 'https';
import fetch from 'node-fetch';
import { getEfiBankKeys, getPaymentConfig } from './payment-config.js';

// Interface para devolução do EfiBank
export interface EfiBankRefund {
  id: string;
  rtrId: string; // Return ID
  valor: number; // Valor em reais
  horario: {
    solicitacao: string;
    liquidacao?: string;
  };
  status: 'EM_PROCESSAMENTO' | 'DEVOLVIDO' | 'NAO_REALIZADO';
  motivo?: string;
  natureza?: 'ORIGINAL' | 'MED_OPERACIONAL' | 'MED_FRAUDE';
}

// Interface para PIX recebido do EfiBank
export interface EfiBankPix {
  endToEndId: string;
  txid?: string;
  valor: string;
  horario: string;
  pagador?: {
    cpf?: string;
    cnpj?: string;
    nome?: string;
  };
  devolucoes?: EfiBankRefund[];
}

// Interface para resposta de listagem de PIX
export interface EfiBankPixListResponse {
  parametros: {
    inicio: string;
    fim: string;
    paginacao: {
      paginaAtual: number;
      itensPorPagina: number;
      quantidadeDePaginas: number;
      quantidadeTotalDeItens: number;
    };
  };
  pix?: EfiBankPix[];
}

// Cache para token e certificado (evita re-download e rate-limiting)
// Indexado por clientId para suportar múltiplos tenants
interface EfiCache {
  token?: string;
  tokenExpiry?: number;
  certBuffer?: Buffer;
  certPath?: string;
  certPassword?: string;
}
const efiCacheMap = new Map<string, EfiCache>();

function getEfiCache(clientId: string): EfiCache {
  if (!efiCacheMap.has(clientId)) {
    efiCacheMap.set(clientId, {});
  }
  return efiCacheMap.get(clientId)!;
}

// Compatibilidade: cache padrão (sem clientId específico)
let efiCache: EfiCache = {};

/**
 * Limpar cache (chamar se credenciais mudarem)
 */
export function clearEfiBankCache(clientId?: string): void {
  if (clientId) {
    efiCacheMap.set(clientId, {});
    console.log(`🧹 Cache EfiBank limpo para clientId: ${clientId}`);
  } else {
    efiCacheMap.clear();
    efiCache = {};
    console.log('🧹 Cache EfiBank limpo (todos)');
  }
}

/**
 * Baixar certificado do Bunny CDN Storage com cache
 */
async function getCertBufferCached(storagePath: string): Promise<Buffer> {
  if (efiCache.certBuffer && efiCache.certPath === storagePath) {
    return efiCache.certBuffer;
  }
  
  try {
    const { getBunnyCredentials } = await import('./bunny-helper.js');
    const credentials = await getBunnyCredentials();
    
    if (!credentials || !credentials.storageApiKey || !credentials.storageZoneName) {
      throw new Error('Bunny CDN não configurado para download de certificado');
    }
    
    const regionPrefix = credentials.storageRegion && credentials.storageRegion !== 'de' ? `${credentials.storageRegion}.` : '';
    const url = `https://${regionPrefix}storage.bunnycdn.com/${credentials.storageZoneName}/${storagePath}`;
    
    const response = await fetch(url, {
      headers: { 'AccessKey': credentials.storageApiKey }
    });
    
    if (!response.ok) {
      throw new Error(`Certificado nao encontrado no storage (${response.status})`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`📥 Certificado baixado do Bunny CDN: ${buffer.length} bytes`);
    
    efiCache.certBuffer = buffer;
    efiCache.certPath = storagePath;
    
    return buffer;
  } catch (error: any) {
    console.error('❌ Erro ao baixar certificado:', error.message);
    throw new Error('Falha ao carregar certificado P12');
  }
}

/**
 * Obter token OAuth2 da API EfiBank PIX com cache
 */
async function getEfiBankTokenCached(
  clientId: string,
  clientSecret: string,
  certBuffer: Buffer,
  certPassword: string,
  isProduction: boolean
): Promise<string> {
  // Verificar cache por clientId (suporta múltiplos tenants)
  const cache = getEfiCache(clientId);
  const now = Date.now();
  if (cache.token && cache.tokenExpiry && cache.tokenExpiry > now) {
    return cache.token;
  }
  
  return new Promise((resolve, reject) => {
    const hostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const httpsAgent = new https.Agent({
      pfx: certBuffer,
      passphrase: certPassword || '',
      rejectUnauthorized: true,
      keepAlive: false,
      minVersion: 'TLSv1.2'
    });
    
    const options = {
      hostname,
      port: 443,
      path: '/oauth/token',
      method: 'POST',
      agent: httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            // Cache por 50 minutos (tokens duram 1h) — indexado por clientId
            const c = getEfiCache(clientId);
            c.token = parsed.access_token;
            c.tokenExpiry = now + (50 * 60 * 1000);
            resolve(parsed.access_token);
          } else {
            reject(new Error('Falha na autenticacao EfiBank'));
          }
        } catch (e) {
          reject(new Error('Resposta invalida do servidor de autenticacao'));
        }
      });
    });
    
    req.on('error', () => reject(new Error('Erro de conexao com servidor EfiBank')));
    req.write(JSON.stringify({ grant_type: 'client_credentials' }));
    req.end();
  });
}

/**
 * Fazer requisição à API PIX do EfiBank
 */
async function efiBankPixRequest<T>(
  path: string,
  token: string,
  certBuffer: Buffer,
  certPassword: string,
  isProduction: boolean,
  method: string = 'GET'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const hostname = isProduction ? 'pix.api.efipay.com.br' : 'pix-h.api.efipay.com.br';
    
    const httpsAgent = new https.Agent({
      pfx: certBuffer,
      passphrase: certPassword || '',
      rejectUnauthorized: true,
      keepAlive: false,
      minVersion: 'TLSv1.2'
    });
    
    const options = {
      hostname,
      port: 443,
      path,
      method,
      agent: httpsAgent,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Erro ${res.statusCode} na API EfiBank`));
            return;
          }
          resolve(JSON.parse(data) as T);
        } catch (e) {
          reject(new Error('Resposta invalida da API EfiBank'));
        }
      });
    });
    
    req.on('error', () => reject(new Error('Erro de conexao com API EfiBank')));
    req.end();
  });
}

/**
 * Listar PIX recebidos com devoluções da API EfiBank
 */
export async function listEfiBankPixWithRefunds(
  db: admin.firestore.Firestore,
  options?: {
    days?: number;
    limit?: number;
  }
): Promise<{
  success: boolean;
  pix: EfiBankPix[];
  totalRefunds: number;
  error?: string;
}> {
  try {
    // Buscar configurações do EfiBank
    const config = await getPaymentConfig(db);
    
    if (!config?.efibank?.enabled) {
      return { success: false, pix: [], totalRefunds: 0, error: 'EfiBank não configurado' };
    }
    
    const keys = await getEfiBankKeys(db);
    if (!keys.clientId || !keys.clientSecret) {
      return { success: false, pix: [], totalRefunds: 0, error: 'Credenciais EfiBank não encontradas' };
    }
    
    const isProduction = keys.environment === 'production';
    console.log(`🟡 EfiBank PIX API (${isProduction ? 'PRODUÇÃO' : 'SANDBOX'})`);
    
    // Buscar certificado do Firebase Storage
    const certPath = (config.efibank as any).certificateStoragePath;
    if (!certPath) {
      return { success: false, pix: [], totalRefunds: 0, error: 'Certificado P12 não configurado' };
    }
    
    let certBuffer: Buffer;
    try {
      certBuffer = await getCertBufferCached(certPath);
    } catch (certError: any) {
      return { success: false, pix: [], totalRefunds: 0, error: `Erro ao carregar certificado: ${certError.message}` };
    }
    
    // Obter certificado password
    const certPassword = (config.efibank as any).certificatePassword || '';
    
    // Obter token OAuth2
    console.log('🔐 Obtendo token OAuth2...');
    const token = await getEfiBankTokenCached(keys.clientId, keys.clientSecret, certBuffer, certPassword, isProduction);
    console.log('✅ Token OAuth2 obtido');
    
    // Definir período de consulta
    const days = options?.days || 30;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Formatar datas no padrão ISO 8601 (requerido pela API EfiBank)
    const inicio = startDate.toISOString();
    const fim = endDate.toISOString();
    
    // Listar PIX recebidos
    console.log(`📋 Consultando PIX recebidos de ${startDate.toLocaleDateString()} a ${endDate.toLocaleDateString()}`);
    
    const pixList = await efiBankPixRequest<EfiBankPixListResponse>(
      `/v2/pix?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}&paginacao.paginaAtual=0&paginacao.itensPorPagina=${options?.limit || 100}`,
      token,
      certBuffer,
      certPassword,
      isProduction
    );
    
    const pixItems = pixList.pix || [];
    console.log(`📊 PIX recebidos: ${pixItems.length}`);
    
    // Filtrar apenas os que têm devoluções
    const pixWithRefunds = pixItems.filter(p => p.devolucoes && p.devolucoes.length > 0);
    const totalRefunds = pixWithRefunds.reduce((sum, p) => sum + (p.devolucoes?.length || 0), 0);
    
    console.log(`⚠️ PIX com devoluções: ${pixWithRefunds.length} (Total: ${totalRefunds} devoluções)`);
    
    return {
      success: true,
      pix: pixWithRefunds,
      totalRefunds,
    };
  } catch (error: any) {
    console.error('❌ Erro ao consultar PIX EfiBank:', error.message);
    return { success: false, pix: [], totalRefunds: 0, error: error.message };
  }
}

/**
 * Consultar devoluções de um PIX específico pelo e2eId
 */
export async function getEfiBankPixRefunds(
  db: admin.firestore.Firestore,
  e2eId: string
): Promise<{
  success: boolean;
  refunds: EfiBankRefund[];
  error?: string;
}> {
  try {
    const config = await getPaymentConfig(db);
    
    if (!config?.efibank?.enabled) {
      return { success: false, refunds: [], error: 'EfiBank não configurado' };
    }
    
    const keys = await getEfiBankKeys(db);
    if (!keys.clientId || !keys.clientSecret) {
      return { success: false, refunds: [], error: 'Credenciais EfiBank não encontradas' };
    }
    
    const isProduction = keys.environment === 'production';
    
    const certPath = (config.efibank as any).certificateStoragePath;
    if (!certPath) {
      return { success: false, refunds: [], error: 'Certificado P12 não configurado' };
    }
    
    const certBuffer = await getCertBufferCached(certPath);
    const certPassword = (config.efibank as any).certificatePassword || '';
    const token = await getEfiBankTokenCached(keys.clientId, keys.clientSecret, certBuffer, certPassword, isProduction);
    
    // Consultar devoluções do PIX específico
    const response = await efiBankPixRequest<{ devolucoes?: EfiBankRefund[] }>(
      `/v2/pix/${e2eId}/devolucao`,
      token,
      certBuffer,
      certPassword,
      isProduction
    );
    
    return {
      success: true,
      refunds: response.devolucoes || [],
    };
  } catch (error: any) {
    console.error(`❌ Erro ao consultar devoluções do PIX ${e2eId}:`, error.message);
    return { success: false, refunds: [], error: error.message };
  }
}

// Interface para infração MED do EfiBank
export interface EfiBankInfracao {
  idInfracao: string;
  endToEndId: string;
  protocolo: number;
  dataTransacao: string;
  valor: number;
  chave?: string;
  status: 'ABERTA' | 'ACEITA' | 'CANCELADA_EFI' | 'EM_DEFESA' | 'REJEITADA';
  razao?: string;
  tipoSituacao?: string;
  tipoFraude?: string;
  comentario?: string;
  defesa?: string;
  justificativaAnalista?: string;
  identificadorTicket?: number[];
  dadosAnalise?: {
    abertura: string;
    prazoFinalizacao: string;
    recebimentoDefesa?: string;
    finalizacao?: string;
  };
  origem?: {
    nomeParticipante: string;
    conta: number;
    nome: string;
    documento: string;
  };
  destino?: {
    nomeParticipante: string;
    conta: number;
    nome: string;
    documento: string;
  };
  criadoEm?: string;
  atualizadoEm?: string;
}

// Interface para resposta de listagem de infrações
export interface EfiBankInfracoesResponse {
  parametros: {
    inicio: string;
    fim: string;
    paginacao: {
      paginaAtual: number;
      itensPorPagina: number;
      quantidadeDePaginas: number;
      quantidadeTotalDeItens: number;
    };
  };
  infracoes?: EfiBankInfracao[];
}

/**
 * Listar infrações MED da conta EfiBank
 * Endpoint: GET /v2/gn/infracoes
 */
export async function listEfiBankMedInfracoes(
  db: admin.firestore.Firestore,
  options?: {
    days?: number;
    limit?: number;
  }
): Promise<{
  success: boolean;
  infracoes: EfiBankInfracao[];
  totalCount: number;
  error?: string;
}> {
  try {
    const config = await getPaymentConfig(db);
    
    if (!config?.efibank?.enabled) {
      return { success: false, infracoes: [], totalCount: 0, error: 'EfiBank não configurado' };
    }
    
    const keys = await getEfiBankKeys(db);
    if (!keys.clientId || !keys.clientSecret) {
      return { success: false, infracoes: [], totalCount: 0, error: 'Credenciais EfiBank não encontradas' };
    }
    
    const isProduction = keys.environment === 'production';
    console.log(`🟡 EfiBank Infrações API (${isProduction ? 'PRODUÇÃO' : 'SANDBOX'})`);
    
    const certPath = (config.efibank as any).certificateStoragePath;
    if (!certPath) {
      return { success: false, infracoes: [], totalCount: 0, error: 'Certificado P12 não configurado' };
    }
    
    let certBuffer: Buffer;
    try {
      certBuffer = await getCertBufferCached(certPath);
    } catch (certError: any) {
      return { success: false, infracoes: [], totalCount: 0, error: `Erro ao carregar certificado: ${certError.message}` };
    }
    
    const certPassword = (config.efibank as any).certificatePassword || '';
    
    console.log('🔐 Obtendo token OAuth2 para infrações...');
    const token = await getEfiBankTokenCached(keys.clientId, keys.clientSecret, certBuffer, certPassword, isProduction);
    console.log('✅ Token OAuth2 obtido');
    
    // Definir período de consulta
    const days = options?.days || 90;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const inicio = startDate.toISOString();
    const fim = endDate.toISOString();
    
    const requestPath = `/v2/gn/infracoes?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}&paginacao.paginaAtual=0&paginacao.itensPorPagina=${options?.limit || 100}`;
    console.log(`📋 Consultando infrações MED de ${inicio} a ${fim}`);
    console.log(`🔗 Request path: ${requestPath}`);
    
    // Consultar infrações MED
    const response = await efiBankPixRequest<EfiBankInfracoesResponse>(
      requestPath,
      token,
      certBuffer,
      certPassword,
      isProduction
    );
    
    console.log(`📦 Resposta API infrações:`, JSON.stringify(response, null, 2));
    
    const infracoes = response.infracoes || [];
    const totalCount = response.parametros?.paginacao?.quantidadeTotalDeItens || infracoes.length;
    
    console.log(`⚠️ Infrações MED encontradas: ${infracoes.length} (Total: ${totalCount})`);
    
    return {
      success: true,
      infracoes,
      totalCount,
    };
  } catch (error: any) {
    console.error('❌ Erro ao consultar infrações MED EfiBank:', error.message);
    return { success: false, infracoes: [], totalCount: 0, error: error.message };
  }
}

/**
 * Consultar detalhes completos de um PIX específico pelo e2eId
 * Inclui informações do pagador e devoluções
 */
export async function getEfiBankPixDetails(
  db: admin.firestore.Firestore,
  e2eId: string
): Promise<{
  success: boolean;
  pix: EfiBankPix | null;
  error?: string;
}> {
  try {
    const config = await getPaymentConfig(db);
    
    if (!config?.efibank?.enabled) {
      return { success: false, pix: null, error: 'EfiBank não configurado' };
    }
    
    const keys = await getEfiBankKeys(db);
    if (!keys.clientId || !keys.clientSecret) {
      return { success: false, pix: null, error: 'Credenciais EfiBank não encontradas' };
    }
    
    const isProduction = keys.environment === 'production';
    console.log(`🟡 EfiBank PIX API: Consultando PIX ${e2eId} (${isProduction ? 'PRODUÇÃO' : 'SANDBOX'})`);
    
    const certPath = (config.efibank as any).certificateStoragePath;
    if (!certPath) {
      return { success: false, pix: null, error: 'Certificado P12 não configurado' };
    }
    
    const certBuffer = await getCertBufferCached(certPath);
    const certPassword = (config.efibank as any).certificatePassword || '';
    const token = await getEfiBankTokenCached(keys.clientId, keys.clientSecret, certBuffer, certPassword, isProduction);
    
    // Consultar detalhes do PIX específico
    const response = await efiBankPixRequest<EfiBankPix>(
      `/v2/pix/${e2eId}`,
      token,
      certBuffer,
      certPassword,
      isProduction
    );
    
    console.log(`✅ PIX encontrado: valor=${response.valor}, pagador=${response.pagador?.nome || 'N/A'}`);
    
    return {
      success: true,
      pix: response,
    };
  } catch (error: any) {
    console.error(`❌ Erro ao consultar PIX ${e2eId}:`, error.message);
    return { success: false, pix: null, error: error.message };
  }
}

/**
 * Consultar infração PIX (MED) por correlationId
 */
export async function getEfiBankMedByOrder(
  db: admin.firestore.Firestore,
  orderId: string
): Promise<{
  success: boolean;
  hasMed: boolean;
  meds: EfiBankRefund[];
  error?: string;
}> {
  try {
    // Buscar o pedido para obter o e2eId
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return { success: false, hasMed: false, meds: [], error: 'Pedido não encontrado' };
    }
    
    const order = orderDoc.data();
    const e2eId = order?.e2eId || order?.endToEndId || order?.pixEndToEndId;
    
    if (!e2eId) {
      return { success: false, hasMed: false, meds: [], error: 'E2E ID não encontrado no pedido' };
    }
    
    // Consultar devoluções
    const result = await getEfiBankPixRefunds(db, e2eId);
    
    if (!result.success) {
      return { success: false, hasMed: false, meds: [], error: result.error };
    }
    
    // Filtrar apenas MEDs (natureza MED_FRAUDE ou MED_OPERACIONAL)
    const meds = result.refunds.filter(r => 
      r.natureza === 'MED_FRAUDE' || r.natureza === 'MED_OPERACIONAL'
    );
    
    return {
      success: true,
      hasMed: meds.length > 0,
      meds,
    };
  } catch (error: any) {
    return { success: false, hasMed: false, meds: [], error: error.message };
  }
}
