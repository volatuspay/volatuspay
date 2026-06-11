/**
 * 🏦 ONZ FINANCE API - Integração Completa
 * Cash-in: QRCodes API (PIX dinâmico, mTLS)
 * Cash-out: Accounts API (PIX saída, mTLS)
 * Docs: https://developers.onz.software/reference/qrcodes
 *       https://developers.onz.software/reference/accounts
 */

import https from 'https';
import { getRTDB } from './firebase-admin.js';

// ─── Configuração base ─────────────────────────────────────────────────────

const RTDB_PATH = 'tetri-system/onz-finance';

// URLs de produção (sem -h / sem hmg.)
const QRCODES_PROD_URL  = 'api.qrcodes.sulcredi.coop.br';
const QRCODES_SBX_URL   = 'api.qrcodes-h.sulcredi.coop.br';
const ACCOUNTS_PROD_URL = 'secureapi.bancodigital.onz.software';
const ACCOUNTS_SBX_URL  = 'secureapi.bancodigital.hmg.onz.software';

// Prefixo de path para Accounts API
const ACCOUNTS_PATH_PREFIX = '/api/v2';

// ─── Tipos ─────────────────────────────────────────────────────────────────

export interface OnzCerts {
  qrcodes: { cert: Buffer; key: Buffer };
  accounts: { cert: Buffer; key: Buffer };
}

export interface OnzCredentials {
  cashInClientId:     string; // BASSPAGO_77
  cashInClientSecret: string; // cash-in key
  cashOutClientId:    string; // BASSPAGO_77
  cashOutClientSecret:string; // cash-out key
  pixKey:             string; // chave PIX registrada na ONZ para receber
  environment:        'production' | 'sandbox';
  enabled:            boolean;
}

export interface OnzPixChargeRequest {
  orderId:           string;
  amountBRL:         number;  // em centavos
  devedorNome?:      string;
  devedorCpf?:       string;
  devedorCnpj?:      string;
  descricao?:        string;
  expiracaoSegundos?: number; // padrão 3600
}

export interface OnzPixChargeResponse {
  txid:       string;
  brCode:     string;   // copia-e-cola
  qrCodeUrl?: string;   // URL da imagem do QR Code
  location?:  string;   // location do payload
  status:     'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR' | 'REMOVIDA_PELO_PSP';
  valor:      string;   // valor em R$ como string "0.00"
  expiracao:  number;
  criacao:    string;
}

export interface OnzPixCashOutRequest {
  qrCode?:      string;  // QR Code copia-e-cola (se pagamento via QR)
  pixKey?:      string;  // Chave PIX destino (se pagamento via chave)
  amountBRL:    number;  // em centavos
  idempotencyKey: string;
  description?: string;
  priority?:    'HIGH' | 'NORM';
}

export interface OnzBalanceResponse {
  available:  number;  // em centavos
  blocked?:   number;
  currency:   string;  // BRL
}

// ─── Cache de tokens ───────────────────────────────────────────────────────

interface TokenCache { token: string; expiry: number; }
const tokenCache = new Map<string, TokenCache>();

// ─── Cache de certificados em memória ─────────────────────────────────────

let certCache: OnzCerts | null = null;
let certCacheExpiry = 0;
const CERT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

// ─── Carregar certificados ─────────────────────────────────────────────────

export async function loadOnzCerts(): Promise<OnzCerts | null> {
  const now = Date.now();
  if (certCache && certCacheExpiry > now) return certCache;

  try {
    // Tentar RTDB primeiro
    const rtdb = getRTDB();
    const snap = await rtdb.ref(`${RTDB_PATH}/certs`).once('value');
    if (snap.exists()) {
      const data = snap.val();
      if (data?.qrcodes?.cert && data?.qrcodes?.key && data?.accounts?.cert && data?.accounts?.key) {
        certCache = {
          qrcodes: {
            cert: Buffer.from(data.qrcodes.cert, 'base64'),
            key:  Buffer.from(data.qrcodes.key,  'base64'),
          },
          accounts: {
            cert: Buffer.from(data.accounts.cert, 'base64'),
            key:  Buffer.from(data.accounts.key,  'base64'),
          },
        };
        certCacheExpiry = now + CERT_CACHE_TTL_MS;
        console.log('✅ [ONZ] Certificados carregados do RTDB');
        return certCache;
      }
    }

    // Tentar variáveis de ambiente (base64)
    const qrcodesCertB64 = process.env.ONZ_QRCODES_CERT_B64;
    const qrcodesKeyB64  = process.env.ONZ_QRCODES_KEY_B64;
    const accountsCertB64 = process.env.ONZ_ACCOUNTS_CERT_B64;
    const accountsKeyB64  = process.env.ONZ_ACCOUNTS_KEY_B64;

    if (qrcodesCertB64 && qrcodesKeyB64 && accountsCertB64 && accountsKeyB64) {
      certCache = {
        qrcodes:  { cert: Buffer.from(qrcodesCertB64, 'base64'), key: Buffer.from(qrcodesKeyB64, 'base64') },
        accounts: { cert: Buffer.from(accountsCertB64, 'base64'), key: Buffer.from(accountsKeyB64, 'base64') },
      };
      certCacheExpiry = now + CERT_CACHE_TTL_MS;
      console.log('✅ [ONZ] Certificados carregados das variáveis de ambiente');
      return certCache;
    }

    console.warn('⚠️ [ONZ] Certificados não encontrados no RTDB nem nas env vars');
    return null;
  } catch (err: any) {
    console.error('❌ [ONZ] Erro ao carregar certificados:', err.message);
    return null;
  }
}

// ─── Salvar certificados no RTDB ────────────────────────────────────────────

export async function saveOnzCertsToRTDB(
  qrcodesCert: Buffer, qrcodesKey: Buffer,
  accountsCert: Buffer, accountsKey: Buffer
): Promise<void> {
  const rtdb = getRTDB();
  await rtdb.ref(`${RTDB_PATH}/certs`).set({
    qrcodes: {
      cert:    qrcodesCert.toString('base64'),
      key:     qrcodesKey.toString('base64'),
      savedAt: new Date().toISOString(),
    },
    accounts: {
      cert:    accountsCert.toString('base64'),
      key:     accountsKey.toString('base64'),
      savedAt: new Date().toISOString(),
    },
    eternal: true,
    version: 'PROD',
    partner: 'BASSPAGO_77',
  });
  // Invalidar cache
  certCache = null;
  certCacheExpiry = 0;
  console.log('✅ [ONZ] Certificados PROD salvos ETERNAMENTE no RTDB');
}

// ─── Carregar credenciais do RTDB ──────────────────────────────────────────

let credsCache: OnzCredentials | null = null;
let credsCacheExpiry = 0;

export async function loadOnzCredentials(): Promise<OnzCredentials | null> {
  const now = Date.now();
  if (credsCache && credsCacheExpiry > now) return credsCache;

  try {
    const rtdb = getRTDB();
    const snap = await rtdb.ref(`${RTDB_PATH}/credentials`).once('value');
    if (snap.exists()) {
      const d = snap.val();
      credsCache = d as OnzCredentials;
      credsCacheExpiry = now + (5 * 60 * 1000); // 5 min
      return credsCache;
    }
    return null;
  } catch (err: any) {
    console.error('❌ [ONZ] Erro ao carregar credenciais:', err.message);
    return null;
  }
}

export async function saveOnzCredentialsToRTDB(creds: OnzCredentials): Promise<void> {
  const rtdb = getRTDB();
  await rtdb.ref(`${RTDB_PATH}/credentials`).set({
    ...creds,
    savedAt: new Date().toISOString(),
    eternal: true,
  });
  credsCache = creds;
  credsCacheExpiry = Date.now() + (5 * 60 * 1000);
  console.log('✅ [ONZ] Credenciais salvas ETERNAMENTE no RTDB');
}

// ─── Helpers HTTP ──────────────────────────────────────────────────────────

function makeAgent(certBuf: Buffer, keyBuf: Buffer): https.Agent {
  return new https.Agent({
    cert:               certBuf,
    key:                keyBuf,
    rejectUnauthorized: true,
    keepAlive:          true,
  });
}

function httpsRequest<T>(
  hostname: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  agent: https.Agent
): Promise<T> {
  return new Promise((resolve, reject) => {
    const opts: https.RequestOptions = {
      hostname,
      port:   443,
      path,
      method,
      headers,
      agent,
    };
    if (body) {
      opts.headers!['Content-Length'] = String(Buffer.byteLength(body));
    }
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed as T);
        } catch {
          reject(new Error(`[ONZ] Resposta não-JSON (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Token - QRCodes API (Cash-in) ────────────────────────────────────────

async function getQRCodesToken(creds: OnzCredentials, certs: OnzCerts): Promise<string> {
  const cacheKey = `qrcodes:${creds.cashInClientId}:${creds.environment}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.token;

  const isProduction = creds.environment === 'production';
  const hostname = isProduction ? QRCODES_PROD_URL : QRCODES_SBX_URL;
  const agent = makeAgent(certs.qrcodes.cert, certs.qrcodes.key);

  const body = new URLSearchParams({
    client_id:     creds.cashInClientId,
    client_secret: creds.cashInClientSecret,
    grant_type:    'client_credentials',
    scope:         'cob.write cob.read pix.read pix.write webhook.read webhook.write',
  }).toString();

  const resp = await httpsRequest<any>(hostname, '/oauth/token', 'POST', {
    'Content-Type': 'application/x-www-form-urlencoded',
  }, body, agent);

  if (!resp.access_token) {
    throw new Error(`[ONZ QRCodes] Token falhou: ${JSON.stringify(resp)}`);
  }

  const expiresIn = (resp.expires_in || 3600) as number;
  tokenCache.set(cacheKey, { token: resp.access_token, expiry: Date.now() + (expiresIn - 60) * 1000 });
  console.log(`✅ [ONZ] Token QRCodes obtido (expira em ${expiresIn}s)`);
  return resp.access_token;
}

// ─── Token - Accounts API (Cash-out) ─────────────────────────────────────

async function getAccountsToken(creds: OnzCredentials, certs: OnzCerts): Promise<string> {
  const cacheKey = `accounts:${creds.cashOutClientId}:${creds.environment}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.token;

  const isProduction = creds.environment === 'production';
  const hostname = isProduction ? ACCOUNTS_PROD_URL : ACCOUNTS_SBX_URL;
  const agent = makeAgent(certs.accounts.cert, certs.accounts.key);

  const body = JSON.stringify({
    clientId:     creds.cashOutClientId,
    clientSecret: creds.cashOutClientSecret,
    grantType:    'client_credentials',
    scope:        'pix.read pix.write transactions.read account.read webhook.read webhook.write',
  });

  const resp = await httpsRequest<any>(hostname, `${ACCOUNTS_PATH_PREFIX}/oauth/token`, 'POST', {
    'Content-Type': 'application/json',
  }, body, agent);

  if (!resp.access_token && !resp.accessToken) {
    throw new Error(`[ONZ Accounts] Token falhou: ${JSON.stringify(resp)}`);
  }

  const token = resp.access_token || resp.accessToken;
  const expiresIn = (resp.expires_in || resp.expiresIn || 3600) as number;
  tokenCache.set(cacheKey, { token, expiry: Date.now() + (expiresIn - 60) * 1000 });
  console.log(`✅ [ONZ] Token Accounts obtido (expira em ${expiresIn}s)`);
  return token;
}

// ─── Cash-in: Criar cobrança PIX (QRCodes API) ────────────────────────────

export async function createOnzPixCharge(req: OnzPixChargeRequest): Promise<OnzPixChargeResponse> {
  const creds = await loadOnzCredentials();
  if (!creds || !creds.enabled) throw new Error('[ONZ] Credenciais não configuradas ou desabilitadas');

  const certs = await loadOnzCerts();
  if (!certs) throw new Error('[ONZ] Certificados mTLS não encontrados');

  const token = await getQRCodesToken(creds, certs);
  const isProduction = creds.environment === 'production';
  const hostname = isProduction ? QRCODES_PROD_URL : QRCODES_SBX_URL;
  const agent = makeAgent(certs.qrcodes.cert, certs.qrcodes.key);

  const amountStr = (req.amountBRL / 100).toFixed(2);

  const payload: any = {
    calendario: { expiracao: req.expiracaoSegundos || 3600 },
    valor:      { original: amountStr },
    chave:      creds.pixKey,
    solicitacaoPagador: req.descricao || `Pagamento VolatusPay #${req.orderId}`,
    infoAdicionais: [
      { nome: 'OrderId', valor: req.orderId },
    ],
  };

  if (req.devedorNome) {
    if (req.devedorCpf) {
      payload.devedor = { cpf: req.devedorCpf.replace(/\D/g, ''), nome: req.devedorNome };
    } else if (req.devedorCnpj) {
      payload.devedor = { cnpj: req.devedorCnpj.replace(/\D/g, ''), nome: req.devedorNome };
    }
  }

  const resp = await httpsRequest<any>(hostname, '/cob', 'POST', {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  }, JSON.stringify(payload), agent);

  if (!resp.txid) {
    throw new Error(`[ONZ] Criação de cobrança falhou: ${JSON.stringify(resp)}`);
  }

  // Gerar QR Code como imagem (PNG) via endpoint de location
  let qrCodeUrl: string | undefined;
  const location = resp.location || resp.loc?.location;
  if (location) {
    // A location é o endereço do payload para o QR Code
    qrCodeUrl = `https://${location}`;
  }

  return {
    txid:      resp.txid,
    brCode:    resp.pixCopiaECola || resp.brCode || '',
    qrCodeUrl,
    location,
    status:    resp.status || 'ATIVA',
    valor:     resp.valor?.original || amountStr,
    expiracao: resp.calendario?.expiracao || req.expiracaoSegundos || 3600,
    criacao:   resp.calendario?.criacao || new Date().toISOString(),
  };
}

// ─── Cash-in: Consultar cobrança ───────────────────────────────────────────

export async function getOnzPixCharge(txid: string): Promise<OnzPixChargeResponse> {
  const creds = await loadOnzCredentials();
  if (!creds || !creds.enabled) throw new Error('[ONZ] Credenciais não configuradas');

  const certs = await loadOnzCerts();
  if (!certs) throw new Error('[ONZ] Certificados não encontrados');

  const token = await getQRCodesToken(creds, certs);
  const isProduction = creds.environment === 'production';
  const hostname = isProduction ? QRCODES_PROD_URL : QRCODES_SBX_URL;
  const agent = makeAgent(certs.qrcodes.cert, certs.qrcodes.key);

  const resp = await httpsRequest<any>(hostname, `/cob/${txid}`, 'GET', {
    'Authorization': `Bearer ${token}`,
  }, null, agent);

  return {
    txid:      resp.txid,
    brCode:    resp.pixCopiaECola || '',
    location:  resp.location || resp.loc?.location,
    status:    resp.status,
    valor:     resp.valor?.original || '0.00',
    expiracao: resp.calendario?.expiracao || 3600,
    criacao:   resp.calendario?.criacao || '',
  };
}

// ─── Cash-out: PIX via QR Code (Accounts API) ─────────────────────────────

export async function sendOnzPixCashOut(req: OnzPixCashOutRequest): Promise<{ endToEndId?: string; status: string }> {
  const creds = await loadOnzCredentials();
  if (!creds || !creds.enabled) throw new Error('[ONZ] Credenciais não configuradas');

  const certs = await loadOnzCerts();
  if (!certs) throw new Error('[ONZ] Certificados não encontrados');

  const token = await getAccountsToken(creds, certs);
  const isProduction = creds.environment === 'production';
  const hostname = isProduction ? ACCOUNTS_PROD_URL : ACCOUNTS_SBX_URL;
  const agent = makeAgent(certs.accounts.cert, certs.accounts.key);

  const amountBRL = req.amountBRL / 100;
  let path: string;
  let body: any;

  if (req.qrCode) {
    path = `${ACCOUNTS_PATH_PREFIX}/pix/qrcode`;
    body = {
      qrCode:      req.qrCode,
      description: req.description || 'Saque VolatusPay',
      priority:    req.priority || 'NORM',
      payment:     { currency: 'BRL', amount: amountBRL },
    };
  } else if (req.pixKey) {
    path = `${ACCOUNTS_PATH_PREFIX}/pix/dict`;
    body = {
      pixKey:      req.pixKey,
      description: req.description || 'Saque VolatusPay',
      priority:    req.priority || 'NORM',
      payment:     { currency: 'BRL', amount: amountBRL },
    };
  } else {
    throw new Error('[ONZ] Cash-out requer qrCode ou pixKey');
  }

  const resp = await httpsRequest<any>(hostname, path, 'POST', {
    'Authorization':    `Bearer ${token}`,
    'Content-Type':     'application/json',
    'x-idempotency-key': req.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50),
  }, JSON.stringify(body), agent);

  return {
    endToEndId: resp.endToEndId || resp.end_to_end_id,
    status:     resp.status || 'QUEUED',
  };
}

// ─── Consultar saldo (Accounts API) ───────────────────────────────────────

export async function getOnzBalance(): Promise<OnzBalanceResponse> {
  const creds = await loadOnzCredentials();
  if (!creds || !creds.enabled) throw new Error('[ONZ] Credenciais não configuradas');

  const certs = await loadOnzCerts();
  if (!certs) throw new Error('[ONZ] Certificados não encontrados');

  const token = await getAccountsToken(creds, certs);
  const isProduction = creds.environment === 'production';
  const hostname = isProduction ? ACCOUNTS_PROD_URL : ACCOUNTS_SBX_URL;
  const agent = makeAgent(certs.accounts.cert, certs.accounts.key);

  const resp = await httpsRequest<any>(hostname, `${ACCOUNTS_PATH_PREFIX}/accounts/balances/`, 'GET', {
    'Authorization': `Bearer ${token}`,
  }, null, agent);

  // Normalizar resposta
  const balances = Array.isArray(resp) ? resp[0] : resp;
  const available = balances?.balanceAmount?.amount
    ?? balances?.available
    ?? balances?.balance
    ?? 0;

  return {
    available: Math.round(Number(available) * 100), // converter para centavos
    blocked:   balances?.blockedAmount?.amount ? Math.round(Number(balances.blockedAmount.amount) * 100) : 0,
    currency:  balances?.balanceAmount?.currency || 'BRL',
  };
}

// ─── Processar webhook PIX (QRCodes API) ───────────────────────────────────

export interface OnzWebhookPayload {
  evento?: string;
  pix?: Array<{
    endToEndId:  string;
    txid:        string;
    valor:       string;
    pagador?: { nome?: string; cpf?: string; cnpj?: string };
    infoPagador?: string;
    horario:     string;
  }>;
}

export function parseOnzWebhook(body: any): OnzWebhookPayload {
  return body as OnzWebhookPayload;
}

// ─── Limpar cache de tokens (forçar renovação) ─────────────────────────────

export function clearOnzTokenCache(): void {
  tokenCache.clear();
  certCache = null;
  certCacheExpiry = 0;
  credsCache = null;
  credsCacheExpiry = 0;
  console.log('🔄 [ONZ] Cache de tokens e certificados limpo');
}

// ─── Verificar status da integração ────────────────────────────────────────

export async function checkOnzStatus(): Promise<{
  certsLoaded: boolean;
  credsLoaded: boolean;
  environment: string;
  pixKey: string;
  enabled: boolean;
  qrcodesTokenOk?: boolean;
  accountsTokenOk?: boolean;
}> {
  const certs = await loadOnzCerts();
  const creds = await loadOnzCredentials();

  const result = {
    certsLoaded:  !!certs,
    credsLoaded:  !!creds,
    environment:  creds?.environment || 'não configurado',
    pixKey:       creds?.pixKey ? `${creds.pixKey.slice(0, 8)}...` : '',
    enabled:      creds?.enabled || false,
    qrcodesTokenOk: undefined as boolean | undefined,
    accountsTokenOk: undefined as boolean | undefined,
  };

  if (certs && creds && creds.enabled) {
    try {
      await getQRCodesToken(creds, certs);
      result.qrcodesTokenOk = true;
    } catch {
      result.qrcodesTokenOk = false;
    }
    try {
      await getAccountsToken(creds, certs);
      result.accountsTokenOk = true;
    } catch {
      result.accountsTokenOk = false;
    }
  }

  return result;
}
