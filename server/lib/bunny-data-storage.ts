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

export type DataCategory =
  | 'logs/security'
  | 'logs/audit'
  | 'logs/payment-audit'
  | 'logs/rate-limit'
  | 'logs/webhook'
  | 'logs/utmify'
  | 'logs/facial-verification'
  | 'logs/seller-documents'
  | 'analytics/checkout-events'
  | 'analytics/checkout-analytics'
  | 'analytics/affiliate-clicks'
  | 'webhooks/processed'
  | 'webhooks/processing';

export function buildDataPath(
  category: DataCategory,
  id: string,
  options?: { tenantId?: string; date?: Date }
): string {
  const d = options?.date || new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  if (options?.tenantId) {
    return `data/${category}/${options.tenantId}/${yyyy}/${mm}/${dd}/${id}.json`;
  }
  return `data/${category}/${yyyy}/${mm}/${dd}/${id}.json`;
}

let _credentialsCache: any = null;
let _credentialsCacheTime = 0;
const CREDENTIALS_TTL = 5 * 60 * 1000;

async function getCachedCredentials() {
  const now = Date.now();
  if (_credentialsCache && (now - _credentialsCacheTime) < CREDENTIALS_TTL) {
    return _credentialsCache;
  }
  _credentialsCache = await getBunnyCredentials();
  _credentialsCacheTime = now;
  return _credentialsCache;
}

export async function saveDataToBunny(
  category: DataCategory,
  id: string,
  data: any,
  options?: { tenantId?: string; date?: Date }
): Promise<{ success: boolean; url?: string; path?: string; error?: string }> {
  try {
    const credentials = await getCachedCredentials();
    if (!credentials || !credentials.storageApiKey) {
      return { success: false, error: 'Bunny CDN não configurado' };
    }

    const filePath = buildDataPath(category, id, options);
    const storageUrl = buildStorageUrl(credentials, filePath);

    const serialized = JSON.stringify({
      ...data,
      _id: id,
      _category: category,
      _storedAt: new Date().toISOString(),
      _version: 1
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
          return { success: true, url: publicUrl, path: filePath };
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

export async function saveDataBatchToBunny(
  items: Array<{ category: DataCategory; id: string; data: any; tenantId?: string; date?: Date }>
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;

  const batchSize = 5;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(item =>
        saveDataToBunny(item.category, item.id, item.data, {
          tenantId: item.tenantId,
          date: item.date
        })
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        saved++;
      } else {
        errors++;
      }
    }
  }

  return { saved, errors };
}

export async function getDataFromBunny(
  category: DataCategory,
  id: string,
  options?: { tenantId?: string; date?: Date }
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const credentials = await getCachedCredentials();
    if (!credentials || !credentials.storageApiKey) {
      return { success: false, error: 'Bunny CDN não configurado' };
    }

    const filePath = buildDataPath(category, id, options);
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

export async function listDataInBunny(
  category: DataCategory,
  options?: { tenantId?: string; date?: Date }
): Promise<{ success: boolean; files?: string[]; error?: string }> {
  try {
    const credentials = await getCachedCredentials();
    if (!credentials || !credentials.storageApiKey) {
      return { success: false, error: 'Bunny CDN não configurado' };
    }

    const d = options?.date || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');

    let folderPath: string;
    if (options?.tenantId) {
      folderPath = `data/${category}/${options.tenantId}/${yyyy}/${mm}/${dd}/`;
    } else {
      folderPath = `data/${category}/${yyyy}/${mm}/${dd}/`;
    }

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

export function isBunnyDataStorageAvailable(): boolean {
  return !!(process.env.BUNNY_STORAGE_API_KEY);
}
