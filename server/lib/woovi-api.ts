/**
 * 🟢 WOOVI API INTEGRATION
 * Integração completa com Woovi (OpenPix) para PIX
 * Documentação: https://developers.woovi.com/
 */

import type { Firestore } from 'firebase-admin/firestore';
import { decryptSensitiveData } from '../security/key-encryption.js';

// Tipo para o DB (será injetado)
let db: Firestore | null = null;

export function setFirestoreInstance(firestoreDb: Firestore) {
  db = firestoreDb;
}

// 🔐 TIPOS E INTERFACES
export interface WooviConfig {
  appId: string;
  partnerAppId?: string; // App ID do Partner (sub-contas) — diferente do appId principal
  environment: 'sandbox' | 'production';
  webhookSecret?: string;
}

// 🏢 SUB-CONTA (PARTNER API)
export interface WooviSubAccountRequest {
  name: string;              // Razão social / nome
  taxID: {
    taxID: string;           // CPF ou CNPJ (apenas dígitos)
    type: 'BR:CPF' | 'BR:CNPJ';
  };
  email: string;
  website?: string;
  pixAlias?: string;        // Chave PIX padrão (normalmente o email)
}

export interface WooviSubAccountResponse {
  account: {
    accountId: string;
    name: string;
    email: string;
    status: string;          // 'ACTIVE' | 'PENDING' | etc.
    taxID?: { taxID: string; type: string };
    pixAlias?: string;
    createdAt?: string;
  };
}

export interface WooviCustomer {
  name: string;
  email: string;
  taxID?: string; // CPF/CNPJ
  phone?: string;
  address?: {
    zipcode: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    complement?: string;
  };
}

export interface WooviChargeRequest {
  correlationID: string; // ID único da transação (orderId)
  value: number; // Valor em centavos
  comment?: string;
  customer?: WooviCustomer;
  expiresIn?: number; // Tempo de expiração em segundos (padrão: 86400 = 24h)
  additionalInfo?: Array<{ key: string; value: string }>; // Informações adicionais, incluindo webhook URL
}

export interface WooviChargeResponse {
  charge: {
    value: number;
    identifier: string;
    correlationID: string;
    paymentLinkID: string;
    transactionID: string;
    status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
    brCode: string; // Código PIX copia-e-cola
    paymentLinkUrl: string;
    qrCodeImage: string; // URL da imagem QR Code
    expiresDate: string;
    createdAt: string;
  };
}

export interface WooviWebhookPayload {
  event: 'OPENPIX:CHARGE_COMPLETED' | 'OPENPIX:CHARGE_EXPIRED' | 'OPENPIX:TRANSACTION_RECEIVED';
  charge?: {
    correlationID: string;
    status: string;
    value: number;
    transactionID?: string;
  };
  transaction?: {
    value: number;
    time: string;
    endToEndId: string;
  };
  pix?: {
    charge: {
      correlationID: string;
      status: string;
    };
  };
}

/**
 * 🔐 CARREGA CONFIGURAÇÃO WOOVI DO FIRESTORE (CRIPTOGRAFADA)
 */
export async function loadWooviConfig(): Promise<WooviConfig | null> {
  try {
    if (!db) {
      console.error('❌ Firebase DB não inicializado');
      return null;
    }

    // Carregar de paymentConfig/global
    const configRef = db.collection('paymentConfig').doc('global');
    const configDoc = await configRef.get();

    if (!configDoc.exists) {
      console.log('⚠️ Configuração de pagamento não encontrada');
      return null;
    }

    const data = configDoc.data();
    const wooviConfig = data?.woovi;

    if (!wooviConfig?.enabled) {
      console.log('⚠️ Woovi não está habilitado');
      return null;
    }

    if (!wooviConfig.appId) {
      console.error('❌ AppID Woovi não configurado');
      return null;
    }

    // Descriptografar AppID
    const decryptedAppId = decryptSensitiveData(wooviConfig.appId);
    if (!decryptedAppId || decryptedAppId === 'DECRYPTION_ERROR') {
      console.error('❌ Erro ao descriptografar AppID Woovi');
      return null;
    }

    // Descriptografar webhook secret (opcional)
    let decryptedWebhookSecret: string | undefined;
    if (wooviConfig.webhookSecret) {
      const decrypted = decryptSensitiveData(wooviConfig.webhookSecret);
      if (decrypted && decrypted !== 'DECRYPTION_ERROR') {
        decryptedWebhookSecret = decrypted;
      }
    }

    // Descriptografar partnerAppId (opcional — para criação de sub-contas)
    let decryptedPartnerAppId: string | undefined;
    if (wooviConfig.partnerAppId) {
      const decrypted = decryptSensitiveData(wooviConfig.partnerAppId);
      if (decrypted && decrypted !== 'DECRYPTION_ERROR') {
        decryptedPartnerAppId = decrypted;
      }
    }

    console.log(`✅ Configuração Woovi carregada: ${wooviConfig.environment}`);
    return {
      appId: decryptedAppId,
      partnerAppId: decryptedPartnerAppId,
      environment: wooviConfig.environment || 'sandbox',
      webhookSecret: decryptedWebhookSecret,
    };
  } catch (error) {
    console.error('❌ Erro ao carregar configuração Woovi:', error);
    return null;
  }
}

/**
 * 🌐 RETORNA BASE URL DA API WOOVI
 * Woovi/OpenPix usa https://api.openpix.com.br para sandbox e produção.
 * A diferença entre ambientes é o App ID utilizado, não a URL.
 */
function getWooviBaseUrl(_environment: 'sandbox' | 'production'): string {
  return 'https://api.openpix.com.br';
}

/**
 * 🌐 RETORNA URL BASE DO SERVIDOR (dinâmica por ambiente)
 */
function getAppBaseUrl(): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '');
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS;
  if (devDomain) {
    return `https://${devDomain.split(',')[0].trim()}`;
  }
  return 'https://volatuspay.com';
}

/**
 * 💰 CRIAR COBRANÇA PIX NA WOOVI
 */
export async function createWooviCharge(
  request: WooviChargeRequest,
  config?: WooviConfig
): Promise<WooviChargeResponse | null> {
  try {
    // Carregar configuração se não foi passada
    const wooviConfig = config || await loadWooviConfig();
    if (!wooviConfig) {
      console.error('❌ Configuração Woovi não disponível');
      return null;
    }

    const baseUrl = getWooviBaseUrl(wooviConfig.environment);
    const url = `${baseUrl}/api/v1/charge`;

    // 🔔 URL do webhook dinâmica (produção = volatuspay.com, dev = Replit domain)
    const webhookUrl = `${getAppBaseUrl()}/api/webhooks/woovi`;
    const requestWithWebhook = {
      ...request,
      additionalInfo: [
        ...(request.additionalInfo || []),
        { key: 'webhook', value: webhookUrl }
      ]
    };

    console.log('🟢 Criando cobrança Woovi:', {
      correlationID: request.correlationID,
      value: request.value,
      environment: wooviConfig.environment,
      webhookUrl
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': wooviConfig.appId,
      },
      body: JSON.stringify(requestWithWebhook),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erro ao criar cobrança Woovi:', {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const data = await response.json() as WooviChargeResponse;
    console.log('✅ Cobrança Woovi criada:', {
      chargeId: data.charge.identifier,
      correlationID: data.charge.correlationID,
      status: data.charge.status
    });

    return data;
  } catch (error) {
    console.error('❌ Exceção ao criar cobrança Woovi:', error);
    return null;
  }
}

/**
 * 🔍 CONSULTAR STATUS DA COBRANÇA
 */
export async function getWooviChargeStatus(
  correlationID: string,
  config?: WooviConfig
): Promise<WooviChargeResponse | null> {
  try {
    const wooviConfig = config || await loadWooviConfig();
    if (!wooviConfig) {
      console.error('❌ Configuração Woovi não disponível');
      return null;
    }

    const baseUrl = getWooviBaseUrl(wooviConfig.environment);
    const url = `${baseUrl}/api/v1/charge?correlationID=${encodeURIComponent(correlationID)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': wooviConfig.appId,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erro ao consultar cobrança Woovi:', {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const data = await response.json() as WooviChargeResponse;
    return data;
  } catch (error) {
    console.error('❌ Exceção ao consultar cobrança Woovi:', error);
    return null;
  }
}

// 🔄 TIPOS PARA DEVOLUÇÕES/MEDs
export interface WooviRefund {
  value: number;
  correlationID: string;
  comment?: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt?: string;
  endToEndId?: string;
  type?: 'MED' | 'REFUND' | 'CHARGEBACK';
}

export interface WooviRefundsResponse {
  refunds: WooviRefund[];
}

/**
 * 🔄 CONSULTAR DEVOLUÇÕES/MEDs DE UMA COBRANÇA
 * Retorna todas as devoluções (incluindo MEDs) associadas a uma cobrança PIX
 */
export async function getWooviRefunds(
  chargeIdOrCorrelationID: string,
  config?: WooviConfig
): Promise<WooviRefundsResponse | null> {
  try {
    const wooviConfig = config || await loadWooviConfig();
    if (!wooviConfig) {
      console.error('❌ Configuração Woovi não disponível');
      return null;
    }

    const baseUrl = getWooviBaseUrl(wooviConfig.environment);
    const url = `${baseUrl}/api/v1/charge/${encodeURIComponent(chargeIdOrCorrelationID)}/refund`;

    console.log('🔄 Consultando devoluções/MEDs:', { chargeIdOrCorrelationID });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': wooviConfig.appId,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erro ao consultar devoluções Woovi:', {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const data = await response.json() as WooviRefundsResponse;
    console.log('✅ Devoluções encontradas:', data.refunds?.length || 0);
    return data;
  } catch (error) {
    console.error('❌ Exceção ao consultar devoluções Woovi:', error);
    return null;
  }
}

/**
 * 🔍 LISTAR TODAS AS COBRANÇAS COM FILTRO (para buscar MEDs em lote)
 */
export async function listWooviCharges(
  config?: WooviConfig,
  filters?: {
    start?: string; // Data início ISO
    end?: string;   // Data fim ISO
    status?: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  }
): Promise<any[] | null> {
  try {
    const wooviConfig = config || await loadWooviConfig();
    if (!wooviConfig) {
      console.error('❌ Configuração Woovi não disponível');
      return null;
    }

    const baseUrl = getWooviBaseUrl(wooviConfig.environment);
    let url = `${baseUrl}/api/v1/charge`;
    
    // Adicionar filtros como query params
    const params = new URLSearchParams();
    if (filters?.start) params.append('start', filters.start);
    if (filters?.end) params.append('end', filters.end);
    if (filters?.status) params.append('status', filters.status);
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': wooviConfig.appId,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erro ao listar cobranças Woovi:', {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const data = await response.json();
    return data.charges || [];
  } catch (error) {
    console.error('❌ Exceção ao listar cobranças Woovi:', error);
    return null;
  }
}

/**
 * 🔐 VALIDAR WEBHOOK WOOVI
 * Woovi envia o header 'authorization' que deve corresponder ao webhookSecret configurado
 */
export function validateWooviWebhook(
  authorizationHeader: string | undefined,
  webhookSecret: string
): boolean {
  if (!authorizationHeader || !webhookSecret) {
    return false;
  }

  // Woovi envia o authorization header direto (sem Bearer ou outro prefixo)
  return authorizationHeader === webhookSecret;
}

/**
 * 📦 PROCESSAR WEBHOOK WOOVI
 */
export async function processWooviWebhook(payload: WooviWebhookPayload): Promise<{
  success: boolean;
  correlationID?: string;
  status?: string;
}> {
  try {
    console.log('🟢 Processando webhook Woovi:', { event: payload.event });

    // Verificar se é webhook de teste
    if ((payload as any).evento === 'teste_webhook') {
      console.log('✅ Webhook de TESTE recebido - ignorando processamento');
      return { success: true };
    }

    // Extrair correlationID baseado no tipo de evento
    let correlationID: string | undefined;
    let status: string | undefined;

    if (payload.event === 'OPENPIX:CHARGE_COMPLETED') {
      correlationID = payload.charge?.correlationID || payload.pix?.charge?.correlationID;
      status = 'paid';
    } else if (payload.event === 'OPENPIX:CHARGE_EXPIRED') {
      correlationID = payload.charge?.correlationID;
      status = 'expired';
    } else if (payload.event === 'OPENPIX:TRANSACTION_RECEIVED') {
      correlationID = payload.pix?.charge?.correlationID;
      status = 'paid';
    }

    if (!correlationID) {
      console.error('❌ correlationID não encontrado no webhook');
      return { success: false };
    }

    console.log('✅ Webhook processado:', { correlationID, status });
    return {
      success: true,
      correlationID,
      status,
    };
  } catch (error) {
    console.error('❌ Erro ao processar webhook Woovi:', error);
    return { success: false };
  }
}

// ─── PARTNER API — SUB-CONTAS ────────────────────────────────────────────────

/**
 * 🏢 CRIAR SUB-CONTA WOOVI PARA UM SELLER
 * Usa o partnerAppId (diferente do appId de cobranças).
 * Documentação: https://developers.woovi.com/api#tag/partner/paths/~1api~1v1~1partner~1account/post
 */
export async function createWooviSubAccount(
  request: WooviSubAccountRequest,
  config?: WooviConfig
): Promise<WooviSubAccountResponse | null> {
  try {
    const wooviConfig = config || await loadWooviConfig();
    if (!wooviConfig) {
      console.warn('⚠️ [Woovi Partner] Configuração Woovi não disponível — sub-conta não criada');
      return null;
    }

    const partnerAppId = wooviConfig.partnerAppId;
    if (!partnerAppId) {
      console.warn('⚠️ [Woovi Partner] partnerAppId não configurado em Admin > Adquirentes > Woovi — sub-conta não criada');
      return null;
    }

    const baseUrl = getWooviBaseUrl(wooviConfig.environment);
    const url = `${baseUrl}/api/v1/partner/account`;

    console.log('🏢 [Woovi Partner] Criando sub-conta:', {
      name: request.name,
      email: request.email,
      taxIDType: request.taxID.type,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': partnerAppId,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [Woovi Partner] Erro ao criar sub-conta:', {
        status: response.status,
        error: errorText,
        seller: request.email,
      });
      return null;
    }

    const data = await response.json() as WooviSubAccountResponse;
    console.log('✅ [Woovi Partner] Sub-conta criada:', {
      accountId: data.account?.accountId,
      status: data.account?.status,
      seller: request.email,
    });

    return data;
  } catch (error) {
    console.error('❌ [Woovi Partner] Exceção ao criar sub-conta:', error);
    return null;
  }
}

/**
 * 🔍 BUSCAR SUB-CONTA WOOVI DE UM SELLER
 */
export async function getWooviSubAccount(
  accountId: string,
  config?: WooviConfig
): Promise<WooviSubAccountResponse | null> {
  try {
    const wooviConfig = config || await loadWooviConfig();
    if (!wooviConfig?.partnerAppId) return null;

    const baseUrl = getWooviBaseUrl(wooviConfig.environment);
    const url = `${baseUrl}/api/v1/partner/account/${encodeURIComponent(accountId)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': wooviConfig.partnerAppId,
      },
    });

    if (!response.ok) return null;

    return await response.json() as WooviSubAccountResponse;
  } catch (error) {
    console.error('❌ [Woovi Partner] Exceção ao buscar sub-conta:', error);
    return null;
  }
}

/**
 * 🔧 HELPER: monta WooviSubAccountRequest a partir dos dados do seller no Firestore
 */
export function buildWooviSubAccountRequest(sellerData: any): WooviSubAccountRequest | null {
  const name = sellerData.businessName || sellerData.name || sellerData.displayName;
  const email = sellerData.email;
  const docRaw = (sellerData.document || sellerData.cnpj || sellerData.cpf || '').replace(/\D/g, '');
  const docType = sellerData.documentType as 'cpf' | 'cnpj'
    || (docRaw.length === 14 ? 'cnpj' : 'cpf');

  if (!name || !email || !docRaw) {
    console.warn('⚠️ [Woovi Partner] Seller sem nome/email/documento — sub-conta não pode ser criada', {
      name, email, docRaw,
    });
    return null;
  }

  return {
    name,
    email,
    taxID: {
      taxID: docRaw,
      type: docType === 'cnpj' ? 'BR:CNPJ' : 'BR:CPF',
    },
    pixAlias: email,
  };
}
