/**
 * 🏦 EFIBANK MARKETPLACE / SPLIT DE PAGAMENTO
 * Subconta por vendedor + split automático em cobranças
 *
 * Fluxo:
 *  1. Vendedor cadastra → KYC coletado (frente/verso doc + dados)
 *  2. Admin aprova → sistema cria subconta via API EFibank
 *  3. Venda processada → split automático plataforma x vendedor
 *  4. Vendedor saca → para conta bancária/chave PIX registrada
 */

import https from 'https';
import fs from 'fs';
import admin from 'firebase-admin';
import { getEfiBankKeys } from './payment-config.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface EfiSubAccountInput {
  cpf: string;
  nome: string;
  /** YYYY-MM-DD */
  nascimento: string;
  /** 11 dígitos com DDD */
  celular: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  /** UF, ex: "SP" */
  uf: string;
}

export interface EfiSubAccountResponse {
  identificador: string;
  status: 'ativa' | 'pendente' | 'rejeitada' | 'suspensa';
  saldo?: number;
}

export interface EfiSplitPartner {
  /** Identificador da subconta EFibank OU chave PIX do vendedor */
  id: string;
  /** Tipo: 'subconta' usa identificador, 'pix' usa chave PIX diretamente */
  type: 'subconta' | 'pix';
  /** Valor em centavos a ser repassado ao vendedor */
  value: number;
  /** Data de liberação YYYY-MM-DD (opcional para PIX imediato) */
  releaseAt?: string;
}

export interface EfiSplitConfig {
  splitPayload: Record<string, any> | null;
  sellerAmountCents: number;
  platformAmountCents: number;
}

// ─── Credenciais (env vars + Firebase fallback) ───────────────────────────────

interface EfiCreds {
  clientId: string;
  clientSecret: string;
  isProduction: boolean;
  certPath: string | null;
  paycode: string | null;
  platformPixKey: string | null;
}

async function getEfiCreds(db?: admin.firestore.Firestore): Promise<EfiCreds> {
  // Env vars têm prioridade (secrets do Replit)
  const envClientId = process.env.EFI_CLIENT_ID;
  const envClientSecret = process.env.EFI_CLIENT_SECRET;
  const isProductionEnv = process.env.EFI_PRODUCTION === 'true';
  const certPath = process.env.EFI_CERT_PATH || null;
  const paycode = process.env.EFI_PAYCODE || null;
  const platformPixKey = process.env.EFI_PIX_KEY_PLATFORM || null;

  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      isProduction: isProductionEnv,
      certPath,
      paycode,
      platformPixKey,
    };
  }

  // Fallback: Firebase
  if (db) {
    try {
      const keys = await getEfiBankKeys(db);
      if (keys?.clientId && keys?.clientSecret) {
        return {
          clientId: keys.clientId,
          clientSecret: keys.clientSecret,
          isProduction: keys.environment === 'production',
          certPath,
          paycode,
          platformPixKey,
        };
      }
    } catch { /* ignora */ }
  }

  throw new Error('Credenciais EFibank não configuradas (EFI_CLIENT_ID / EFI_CLIENT_SECRET)');
}

// ─── HTTPS Agent com mTLS ─────────────────────────────────────────────────────

let _cachedAgent: https.Agent | null = null;

function getHttpsAgent(certPath: string | null): https.Agent | undefined {
  if (!certPath) return undefined;
  if (_cachedAgent) return _cachedAgent;

  try {
    const pfx = fs.readFileSync(certPath);
    _cachedAgent = new https.Agent({ pfx, passphrase: '' });
    console.log('🔐 [EFI-MARKETPLACE] Certificado mTLS carregado:', certPath);
    return _cachedAgent;
  } catch (e: any) {
    console.warn('⚠️ [EFI-MARKETPLACE] Certificado não encontrado ou inválido:', e.message);
    return undefined;
  }
}

// ─── Token ────────────────────────────────────────────────────────────────────

const _tokenCache = new Map<string, { token: string; expiry: number }>();

async function getToken(creds: EfiCreds): Promise<string> {
  const key = `${creds.clientId}:${creds.isProduction ? 'prod' : 'sandbox'}`;
  const now = Date.now();
  const cached = _tokenCache.get(key);
  if (cached && cached.expiry > now) return cached.token;

  const hostname = creds.isProduction
    ? 'cobrancas.api.efipay.com.br'
    : 'cobrancas-h.api.efipay.com.br';

  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const agent = getHttpsAgent(creds.certPath);

  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({ grant_type: 'client_credentials' });
    const options: https.RequestOptions = {
      hostname,
      port: 443,
      path: '/v1/authorize',
      method: 'POST',
      agent,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.access_token) {
            _tokenCache.set(key, {
              token: r.access_token,
              expiry: now + (r.expires_in * 1000) - 60_000,
            });
            resolve(r.access_token);
          } else {
            reject(new Error(r.error_description || JSON.stringify(r)));
          }
        } catch {
          reject(new Error('Resposta de auth inválida EFibank'));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ─── Request helper ───────────────────────────────────────────────────────────

async function efiRequest<T = any>(
  creds: EfiCreds,
  method: string,
  path: string,
  body?: any
): Promise<T> {
  const token = await getToken(creds);
  const hostname = creds.isProduction
    ? 'cobrancas.api.efipay.com.br'
    : 'cobrancas-h.api.efipay.com.br';
  const agent = getHttpsAgent(creds.certPath);

  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options: https.RequestOptions = {
      hostname,
      port: 443,
      path,
      method,
      agent,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch {
          reject(new Error(`EFibank response inválida: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// ─── Criar Subconta ───────────────────────────────────────────────────────────

/**
 * Cria uma subconta EFibank Marketplace para um vendedor.
 * Chame após o admin aprovar o vendedor e KYC validado.
 */
export async function createEfiSubAccount(
  db: admin.firestore.Firestore,
  input: EfiSubAccountInput
): Promise<EfiSubAccountResponse> {
  const creds = await getEfiCreds(db);
  const token = await getToken(creds);

  const body: Record<string, any> = {
    nome: input.nome,
    cpf: input.cpf.replace(/\D/g, ''),
    nascimento: input.nascimento,
    celular: input.celular.replace(/\D/g, ''),
    email: input.email,
    endereco: {
      cep: input.cep.replace(/\D/g, ''),
      logradouro: input.logradouro,
      numero: input.numero,
      complemento: input.complemento || '',
      bairro: input.bairro,
      cidade: input.cidade,
      uf: input.uf.toUpperCase(),
    },
  };

  if (creds.paycode) body.payee_code = creds.paycode;

  console.log(`🏦 [EFI-MARKETPLACE] Criando subconta para: ${input.email}`);

  const response = await efiRequest<any>(creds, 'POST', '/v1/subaccounts', body);

  if (!response?.data?.identificador) {
    console.error('❌ [EFI-MARKETPLACE] Resposta inválida:', response);
    throw new Error(response?.message || response?.error_description || 'Erro ao criar subconta EFibank');
  }

  console.log(`✅ [EFI-MARKETPLACE] Subconta criada: ${response.data.identificador}`);

  return {
    identificador: response.data.identificador,
    status: response.data.status || 'pendente',
    saldo: response.data.saldo,
  };
}

// ─── Consultar Subconta ───────────────────────────────────────────────────────

export async function getEfiSubAccount(
  db: admin.firestore.Firestore,
  identificador: string
): Promise<EfiSubAccountResponse> {
  const creds = await getEfiCreds(db);

  const response = await efiRequest<any>(creds, 'GET', `/v1/subaccounts/${identificador}`);

  return {
    identificador: response?.data?.identificador || identificador,
    status: response?.data?.status || 'pendente',
    saldo: response?.data?.saldo,
  };
}

// ─── Calcular Split ───────────────────────────────────────────────────────────

/**
 * Calcula os valores de split entre plataforma e vendedor.
 *
 * @param totalAmountCents    Valor total da venda em centavos
 * @param platformFeePercent  Taxa percentual da plataforma (ex: 5.99)
 * @param platformFeeFixed    Taxa fixa da plataforma em centavos (ex: 249)
 */
export function calculateSplit(
  totalAmountCents: number,
  platformFeePercent: number,
  platformFeeFixed: number
): { platformAmountCents: number; sellerAmountCents: number } {
  const platformPercent = Math.round((totalAmountCents * platformFeePercent) / 100);
  const platformTotal = platformPercent + platformFeeFixed;
  const sellerAmount = Math.max(0, totalAmountCents - platformTotal);

  return {
    platformAmountCents: platformTotal,
    sellerAmountCents: sellerAmount,
  };
}

// ─── Montar payload de split para cobrança EFibank ───────────────────────────

/**
 * Retorna o campo `split` pronto para inserir no body de qualquer cobrança EFibank.
 * Compatível com /v1/charge/one-step (boleto/cartão) e /v2/cob/{txid} (PIX).
 */
export function buildSplitPayload(
  partner: EfiSplitPartner,
  totalAmountCents: number,
  platformFeePercent: number,
  platformFeeFixed: number,
  releaseAfterDays = 0
): EfiSplitConfig {
  const { platformAmountCents, sellerAmountCents } = calculateSplit(
    totalAmountCents,
    platformFeePercent,
    platformFeeFixed
  );

  if (sellerAmountCents <= 0) {
    return { splitPayload: null, sellerAmountCents: 0, platformAmountCents };
  }

  const releaseDate = new Date();
  releaseDate.setDate(releaseDate.getDate() + releaseAfterDays);
  const releaseDateStr = releaseDate.toISOString().split('T')[0];

  let splitPayload: Record<string, any>;

  if (partner.type === 'subconta') {
    splitPayload = {
      type: 'partners',
      eFiPartners: [
        {
          id: partner.id,
          value: sellerAmountCents,
          releaseAt: partner.releaseAt || releaseDateStr,
        },
      ],
    };
  } else {
    // PIX direto — usado quando vendedor não tem subconta mas tem chave PIX
    splitPayload = {
      divisaoTarifa: 'minhaconta',
      favorecidos: [
        {
          conta: { chave: partner.id },
          componente: { fixo: { valor: (sellerAmountCents / 100).toFixed(2) } },
        },
      ],
    };
  }

  console.log(
    `💱 [SPLIT] Total: R$${(totalAmountCents / 100).toFixed(2)} → ` +
    `Plataforma: R$${(platformAmountCents / 100).toFixed(2)} | ` +
    `Vendedor: R$${(sellerAmountCents / 100).toFixed(2)}`
  );

  return { splitPayload, sellerAmountCents, platformAmountCents };
}

// ─── Buscar configuração de split do vendedor ─────────────────────────────────

export interface SellerSplitInfo {
  splitEnabled: boolean;
  efiAccountId: string | null;
  efiAccountStatus: string | null;
  efiPixKey: string | null;
  splitType: 'subconta' | 'pix' | null;
  platformFeePercent: number;
  platformFeeFixed: number;
}

/**
 * Busca as informações de split de um vendedor a partir da linha da tabela sellers.
 */
export function getSellerSplitInfo(sellerRow: Record<string, any>): SellerSplitInfo {
  const splitEnabled = Boolean(sellerRow.efi_split_enabled);
  const efiAccountId = sellerRow.efi_account_id || null;
  const efiAccountStatus = sellerRow.efi_account_status || null;
  const efiPixKey = sellerRow.efi_pix_key || sellerRow.banking_data?.pixKey || null;

  let splitType: 'subconta' | 'pix' | null = null;
  if (splitEnabled) {
    splitType = efiAccountId ? 'subconta' : efiPixKey ? 'pix' : null;
  }

  return {
    splitEnabled: splitEnabled && splitType !== null,
    efiAccountId,
    efiAccountStatus,
    efiPixKey,
    splitType,
    platformFeePercent: Number(sellerRow.custom_pix_percent_fee ?? 0),
    platformFeeFixed: Number(sellerRow.custom_pix_fixed_fee ?? 0),
  };
}

// ─── Testar conectividade com as credenciais configuradas ─────────────────────

export async function testEfiCredentials(db?: admin.firestore.Firestore): Promise<{
  ok: boolean;
  environment: string;
  certLoaded: boolean;
  error?: string;
}> {
  try {
    const creds = await getEfiCreds(db);
    await getToken(creds);
    const certLoaded = Boolean(creds.certPath && fs.existsSync(creds.certPath));
    return {
      ok: true,
      environment: creds.isProduction ? 'production' : 'sandbox',
      certLoaded,
    };
  } catch (e: any) {
    return { ok: false, environment: 'unknown', certLoaded: false, error: e.message };
  }
}
