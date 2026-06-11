/**
 * 🟢 EFIBANK PAYMENTS API - Boleto e Cartão de Crédito
 * Integração completa com API de Cobranças da EfíBank
 */

import admin from 'firebase-admin';
import https from 'https';
import { getEfiBankKeys, getPaymentConfig } from './payment-config.js';

interface EfiBankCredentials {
  clientId: string;
  clientSecret: string;
  isProduction: boolean;
}

interface EfiBankCustomer {
  name: string;
  cpf?: string;
  cnpj?: string;
  email: string;
  phone_number: string;
  address?: {
    street: string;
    number: string;
    neighborhood: string;
    zipcode: string;
    city: string;
    state: string;
    complement?: string;
  };
}

interface EfiBankBoletoResponse {
  code: number;
  data: {
    charge_id: number;
    barcode: string;
    link: string;
    billet_link: string;
    pdf: {
      charge: string;
    };
    pix?: {
      qrcode: string;
      qrcode_image: string;
    };
    expire_at: string;
    status: string;
  };
}

interface EfiBankCardResponse {
  code: number;
  data: {
    charge_id: number;
    status: string;
    total: number;
    payment: string;
    installments: number;
    installment_value: number;
  };
}

interface EfiBankInstallmentsResponse {
  rate: number;
  name: string;
  installments: Array<{
    installment: number;
    has_interest: boolean;
    value: number;
    currency: string;
    interest_percentage: number;
  }>;
}

const tokenCacheMap = new Map<string, { token: string; expiry: number }>();

export async function getEfiCobrancasToken(credentials: EfiBankCredentials): Promise<string> {
  return getEfiBankToken(credentials);
}

async function getEfiBankToken(credentials: EfiBankCredentials): Promise<string> {
  const cacheKey = `${credentials.clientId}:${credentials.isProduction ? 'prod' : 'sandbox'}`;
  const now = Date.now();
  const cached = tokenCacheMap.get(cacheKey);
  if (cached && cached.expiry > now) {
    return cached.token;
  }

  const hostname = credentials.isProduction 
    ? 'cobrancas.api.efipay.com.br' 
    : 'cobrancas-h.api.efipay.com.br';
  
  const auth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ grant_type: 'client_credentials' });
    
    const options = {
      hostname,
      port: 443,
      path: '/v1/authorize',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            tokenCacheMap.set(cacheKey, {
              token: response.access_token,
              expiry: now + (response.expires_in * 1000) - 60000,
            });
            resolve(response.access_token);
          } else {
            reject(new Error(response.error_description || 'Falha na autenticação EfíBank'));
          }
        } catch (e) {
          reject(new Error('Resposta inválida da API EfíBank'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function efiBankRequest<T>(
  credentials: EfiBankCredentials,
  method: string,
  path: string,
  body?: any
): Promise<T> {
  const token = await getEfiBankToken(credentials);
  const hostname = credentials.isProduction 
    ? 'cobrancas.api.efipay.com.br' 
    : 'cobrancas-h.api.efipay.com.br';

  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    
    const options: https.RequestOptions = {
      hostname,
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.code === 200 || response.data) {
            resolve(response as T);
          } else {
            console.error('❌ EfíBank API Error:', response);
            reject(new Error(response.error_description || response.message || 'Erro na API EfíBank'));
          }
        } catch (e) {
          reject(new Error('Resposta inválida da API EfíBank'));
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

export async function createBoletoCharge(
  db: admin.firestore.Firestore,
  orderId: string,
  amount: number,
  customer: EfiBankCustomer,
  productName: string,
  dueDate: string,
  splitPayload?: Record<string, any> | null
): Promise<EfiBankBoletoResponse> {
  console.log(`📄 [BOLETO] Criando cobrança para order ${orderId}${splitPayload ? ' [COM SPLIT]' : ''}`);
  
  const keys = await getEfiBankKeys(db);
  if (!keys || !keys.clientId || !keys.clientSecret) {
    throw new Error('Credenciais EfíBank não configuradas');
  }

  const isProduction = keys.environment === 'production';

  const credentials: EfiBankCredentials = {
    clientId: keys.clientId,
    clientSecret: keys.clientSecret,
    isProduction,
  };

  const body: Record<string, any> = {
    items: [
      {
        name: productName.substring(0, 255),
        value: amount,
        amount: 1,
      },
    ],
    metadata: {
      custom_id: orderId,
      notification_url: `${process.env.APP_BASE_URL || 'https://volatuspay.com'}/api/webhooks/efibank`,
    },
    payment: {
      banking_billet: {
        customer: {
          name: customer.name,
          ...(customer.cpf && { cpf: customer.cpf.replace(/\D/g, '') }),
          ...(customer.cnpj && { cnpj: customer.cnpj.replace(/\D/g, '') }),
          email: customer.email,
          phone_number: customer.phone_number.replace(/\D/g, ''),
        },
        expire_at: dueDate,
        configurations: {
          fine: 200,
          interest: 33,
        },
        message: `Pagamento referente a: ${productName}`,
      },
    },
    ...(splitPayload ? { split: splitPayload } : {}),
  };

  const response = await efiBankRequest<EfiBankBoletoResponse>(
    credentials,
    'POST',
    '/v1/charge/one-step',
    body
  );

  console.log(`✅ [BOLETO] Cobrança criada: charge_id=${response.data.charge_id}`);
  
  await db.collection('orders').doc(orderId).update({
    efiChargeId: response.data.charge_id.toString(),
    boletoBarcode: response.data.barcode,
    boletoLink: response.data.billet_link,
    boletoPdfLink: response.data.pdf?.charge,
    boletoExpireAt: response.data.expire_at,
    boletoPixQrcode: response.data.pix?.qrcode,
    paymentMethod: 'boleto',
    processor: 'efibank',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return response;
}

export async function createCardCharge(
  db: admin.firestore.Firestore,
  orderId: string,
  amount: number,
  customer: EfiBankCustomer,
  productName: string,
  paymentToken: string,
  installments: number = 1,
  splitPayload?: Record<string, any> | null
): Promise<EfiBankCardResponse> {
  console.log(`💳 [CARD] Criando cobrança para order ${orderId} - ${installments}x${splitPayload ? ' [COM SPLIT]' : ''}`);
  
  const keys = await getEfiBankKeys(db);
  if (!keys || !keys.clientId || !keys.clientSecret) {
    throw new Error('Credenciais EfíBank não configuradas');
  }

  const isProduction = keys.environment === 'production';

  const credentials: EfiBankCredentials = {
    clientId: keys.clientId,
    clientSecret: keys.clientSecret,
    isProduction,
  };

  if (!customer.address) {
    throw new Error('Endereço de cobrança é obrigatório para pagamento com cartão');
  }

  const body: Record<string, any> = {
    items: [
      {
        name: productName.substring(0, 255),
        value: amount,
        amount: 1,
      },
    ],
    metadata: {
      custom_id: orderId,
      notification_url: `${process.env.APP_BASE_URL || 'https://volatuspay.com'}/api/webhooks/efibank`,
    },
    payment: {
      credit_card: {
        installments,
        payment_token: paymentToken,
        billing_address: {
          street: customer.address.street,
          number: customer.address.number,
          neighborhood: customer.address.neighborhood,
          zipcode: customer.address.zipcode.replace(/\D/g, ''),
          city: customer.address.city,
          state: customer.address.state,
          complement: customer.address.complement || '',
        },
        customer: {
          name: customer.name,
          ...(customer.cpf && { cpf: customer.cpf.replace(/\D/g, '') }),
          ...(customer.cnpj && { cnpj: customer.cnpj.replace(/\D/g, '') }),
          email: customer.email,
          phone_number: customer.phone_number.replace(/\D/g, ''),
        },
      },
    },
    ...(splitPayload ? { split: splitPayload } : {}),
  };

  const response = await efiBankRequest<EfiBankCardResponse>(
    credentials,
    'POST',
    '/v1/charge/one-step',
    body
  );

  console.log(`✅ [CARD] Cobrança criada: charge_id=${response.data.charge_id}, status=${response.data.status}`);
  
  const isPaid = response.data.status === 'paid';
  
  await db.collection('orders').doc(orderId).update({
    efiChargeId: response.data.charge_id.toString(),
    paymentMethod: 'card',
    processor: 'efibank',
    cardInstallments: installments,
    cardInstallmentValue: response.data.installment_value,
    status: isPaid ? 'paid' : 'pending',
    ...(isPaid && { paidAt: admin.firestore.FieldValue.serverTimestamp() }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return response;
}

export async function getInstallments(
  db: admin.firestore.Firestore,
  brand: 'visa' | 'mastercard' | 'amex' | 'elo',
  totalAmount: number
): Promise<EfiBankInstallmentsResponse> {
  console.log(`💳 [INSTALLMENTS] Consultando parcelas para ${brand} - R$ ${(totalAmount / 100).toFixed(2)}`);
  
  const keys = await getEfiBankKeys(db);
  if (!keys || !keys.clientId || !keys.clientSecret) {
    throw new Error('Credenciais EfíBank não configuradas');
  }

  const isProduction = keys.environment === 'production';
  const payeeCode = keys.payeeCode;

  if (!payeeCode) {
    throw new Error('Payee Code (Account Identifier) não configurado');
  }

  const credentials: EfiBankCredentials = {
    clientId: keys.clientId,
    clientSecret: keys.clientSecret,
    isProduction,
  };

  const response = await efiBankRequest<EfiBankInstallmentsResponse>(
    credentials,
    'GET',
    `/v1/installments?brand=${brand}&total=${totalAmount}`
  );

  console.log(`✅ [INSTALLMENTS] ${response.installments?.length || 0} opções de parcelas disponíveis`);
  
  return response;
}

export async function cancelCharge(
  db: admin.firestore.Firestore,
  chargeId: string
): Promise<boolean> {
  console.log(`🚫 [CANCEL] Cancelando cobrança ${chargeId}`);
  
  const keys = await getEfiBankKeys(db);
  if (!keys || !keys.clientId || !keys.clientSecret) {
    throw new Error('Credenciais EfíBank não configuradas');
  }

  const isProduction = keys.environment === 'production';

  const credentials: EfiBankCredentials = {
    clientId: keys.clientId,
    clientSecret: keys.clientSecret,
    isProduction,
  };

  try {
    await efiBankRequest(
      credentials,
      'PUT',
      `/v1/charge/${chargeId}/cancel`
    );
    console.log(`✅ [CANCEL] Cobrança ${chargeId} cancelada`);
    return true;
  } catch (error) {
    console.error(`❌ [CANCEL] Erro ao cancelar cobrança ${chargeId}:`, error);
    return false;
  }
}

export async function getChargeStatus(
  db: admin.firestore.Firestore,
  chargeId: string
): Promise<{ status: string; total: number; payment?: string }> {
  console.log(`🔍 [STATUS] Consultando status da cobrança ${chargeId}`);
  
  const keys = await getEfiBankKeys(db);
  if (!keys || !keys.clientId || !keys.clientSecret) {
    throw new Error('Credenciais EfíBank não configuradas');
  }

  const isProduction = keys.environment === 'production';

  const credentials: EfiBankCredentials = {
    clientId: keys.clientId,
    clientSecret: keys.clientSecret,
    isProduction,
  };

  const response = await efiBankRequest<{ code: number; data: any }>(
    credentials,
    'GET',
    `/v1/charge/${chargeId}`
  );

  return {
    status: response.data.status,
    total: response.data.total,
    payment: response.data.payment,
  };
}

export function clearEfiBankPaymentsCache(): void {
  tokenCacheMap.clear();
  console.log('🧹 Cache de pagamentos EfíBank limpo');
}
