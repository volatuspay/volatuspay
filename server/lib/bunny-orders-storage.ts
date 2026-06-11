import { getBunnyCredentials } from './bunny-helper.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildStorageUrl(credentials: any, filePath: string): string {
  const regionPrefix = credentials.storageRegion && credentials.storageRegion !== 'de' ? `${credentials.storageRegion}.` : '';
  return `https://${regionPrefix}storage.bunnycdn.com/${credentials.storageZoneName}/${filePath}`;
}

function buildPublicUrl(credentials: any, filePath: string): string {
  return `https://${credentials.storageZoneName}.b-cdn.net/${filePath}`;
}

function orderFilePath(tenantId: string, orderId: string): string {
  return `sellers/${tenantId}/ordens/${orderId}.json`;
}

const PII_FIELD_NAMES = new Set([
  'cpf', 'cpfCnpj', 'cnpj', 'document', 'documentNumber', 'documentId', 'rg',
  'email', 'customerEmail', 'buyerEmail', 'sellerEmail',
  'phone', 'customerPhone', 'buyerPhone', 'telefone', 'celular', 'whatsapp',
  'ip', 'customerIp', 'buyerIp', 'ipAddress',
  'address', 'endereco', 'street', 'rua', 'cep', 'zipcode', 'postalCode',
  'complement', 'complemento', 'neighborhood', 'bairro', 'city', 'cidade',
  'name', 'fullName', 'firstName', 'lastName', 'customerName', 'buyerName',
  'numero', 'number'
]);

const SAFE_FIELDS = new Set([
  'id', 'orderId', 'tenantId', 'sellerId', 'productId', 'checkoutId', 'affiliateId',
  'status', 'paymentMethod', 'paymentStatus', 'gateway', 'acquirer',
  'amount', 'totalAmount', 'price', 'commission', 'fee', 'discount',
  'currency', 'installments', 'quantity',
  'createdAt', 'updatedAt', 'paidAt', 'completedAt', 'cancelledAt',
  'productName', 'productType', 'checkoutSlug',
  'couponCode', 'couponDiscount',
  '_bunnyStoredAt', '_version', '_piiSanitized',
  'txid', 'e2eId', 'chargeId', 'paymentId', 'transactionId',
  'refundStatus', 'refundAmount', 'refundReason',
  'orderBump', 'upsell', 'source', 'utm_source', 'utm_medium', 'utm_campaign',
  'deleted', 'deletedAt', 'type', 'origin'
]);

function maskValue(val: any): string {
  const str = String(val);
  if (str.length > 4) {
    return str.substring(0, 3) + '***' + str.substring(str.length - 2);
  }
  return '***';
}

function sanitizePII(data: any, depth: number = 0): any {
  if (depth > 5) return '[REDACTED]';
  if (!data) return data;
  if (typeof data !== 'object') return data;
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizePII(item, depth + 1));
  }
  
  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    
    if (SAFE_FIELDS.has(key)) {
      sanitized[key] = value;
      continue;
    }
    
    if (PII_FIELD_NAMES.has(key) || PII_FIELD_NAMES.has(lowerKey)) {
      if (value && (typeof value === 'string' || typeof value === 'number')) {
        sanitized[key] = maskValue(value);
      } else if (value && typeof value === 'object') {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = '***';
      }
      continue;
    }
    
    if (value && typeof value === 'object') {
      sanitized[key] = sanitizePII(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

export async function saveOrderToBunny(
  tenantId: string,
  orderId: string,
  orderData: any
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const credentials = await getBunnyCredentials();
    if (!credentials || !credentials.storageApiKey) {
      return { success: false, error: 'Bunny CDN não configurado' };
    }

    const filePath = orderFilePath(tenantId, orderId);
    const storageUrl = buildStorageUrl(credentials, filePath);

    const sanitizedData = sanitizePII(orderData);
    const serialized = JSON.stringify({
      ...sanitizedData,
      id: orderId,
      tenantId,
      _bunnyStoredAt: new Date().toISOString(),
      _version: 1,
      _piiSanitized: true
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(storageUrl, {
          method: 'PUT',
          headers: {
            'AccessKey': credentials.storageApiKey,
            'Content-Type': 'application/json'
          },
          body: serialized
        });

        if (response.ok) {
          const publicUrl = buildPublicUrl(credentials, filePath);
          return { success: true, url: publicUrl };
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
          }
        }

        const errorText = await response.text();
        return { success: false, error: `Bunny ${response.status}: ${errorText}` };
      } catch (fetchError: any) {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
          continue;
        }
        return { success: false, error: fetchError.message };
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getOrderFromBunny(
  tenantId: string,
  orderId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const credentials = await getBunnyCredentials();
    if (!credentials || !credentials.storageApiKey) {
      return { success: false, error: 'Bunny CDN não configurado' };
    }

    const filePath = orderFilePath(tenantId, orderId);
    const publicUrl = buildPublicUrl(credentials, filePath);

    const response = await fetch(publicUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    }

    if (response.status === 404) {
      return { success: false, error: 'not_found' };
    }

    return { success: false, error: `Bunny ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateOrderInBunny(
  tenantId: string,
  orderId: string,
  updateFields: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await getOrderFromBunny(tenantId, orderId);

    let mergedData: any;
    if (existing.success && existing.data) {
      mergedData = { ...existing.data, ...updateFields, updatedAt: new Date().toISOString() };
    } else {
      mergedData = { id: orderId, tenantId, ...updateFields, updatedAt: new Date().toISOString() };
    }

    const result = await saveOrderToBunny(tenantId, orderId, mergedData);
    return { success: result.success, error: result.error };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function listSellerOrders(
  tenantId: string
): Promise<{ success: boolean; files?: string[]; error?: string }> {
  try {
    const credentials = await getBunnyCredentials();
    if (!credentials || !credentials.storageApiKey) {
      return { success: false, error: 'Bunny CDN não configurado' };
    }

    const folderPath = `sellers/${tenantId}/ordens/`;
    const storageUrl = buildStorageUrl(credentials, folderPath);

    const response = await fetch(storageUrl, {
      method: 'GET',
      headers: {
        'AccessKey': credentials.storageApiKey,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const items: any[] = await response.json() as any[];
      const files = items
        .filter((item: any) => !item.IsDirectory && item.ObjectName?.endsWith('.json'))
        .map((item: any) => item.ObjectName.replace('.json', ''));
      return { success: true, files };
    }

    if (response.status === 404) {
      return { success: true, files: [] };
    }

    return { success: false, error: `Bunny ${response.status}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
