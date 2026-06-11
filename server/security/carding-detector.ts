/**
 * Carding Velocity Detector
 * Detecta ataques de carding: múltiplas tentativas de pagamento no mesmo checkout
 * em uma janela de 30 segundos (ex.: 10 compras = possível teste de cartões roubados).
 *
 * Armazenamento: in-memory (Map) com gravação assíncrona de alertas no Firestore.
 */

const WINDOW_MS  = 30_000; // 30 segundos
const MAX_HITS   = 10;     // tentativas antes de bloquear
const MAX_KEYS   = 50_000; // limite de chaves para evitar vazamento de memória

// Map<"checkoutId::ip", timestamps[]>
const hitMap = new Map<string, number[]>();

export interface CardingResult {
  blocked: boolean;
  hits: number;
  message?: string;
}

function getClientIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return (Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0].trim();
  return req.headers?.['x-real-ip'] || req.ip || 'unknown';
}

function cleanWindow(key: string): number[] {
  const now = Date.now();
  const fresh = (hitMap.get(key) ?? []).filter(ts => now - ts < WINDOW_MS);
  hitMap.set(key, fresh);
  return fresh;
}

async function persistAlert(checkoutId: string, ip: string, hits: number, tenantId?: string) {
  try {
    const { ensureFirebaseReady, getFirestore } = await import('../lib/firebase-admin.js');
    const { FieldValue } = await import('firebase-admin/firestore');
    await ensureFirebaseReady();
    const db = getFirestore();
    await db.collection('carding_alerts').add({
      checkoutId,
      ip,
      tenantId: tenantId ?? null,
      hits,
      windowMs: WINDOW_MS,
      threshold: MAX_HITS,
      detectedAt: FieldValue.serverTimestamp(),
      type: 'velocity_carding'
    });
    console.warn(`🚨 [CARDING] Alerta: checkout=${checkoutId} ip=${ip} hits=${hits}`);
  } catch { /* não-crítico */ }
}

/**
 * Verifica velocidade de tentativas de pagamento.
 * @param checkoutId  ID do checkout alvo
 * @param req         Request Express (para extrair IP)
 * @param tenantId    Seller tenant (para alerta)
 */
export async function checkCardingVelocity(
  checkoutId: string,
  req: any,
  tenantId?: string
): Promise<CardingResult> {
  const ip  = getClientIp(req);
  const key = `${checkoutId}::${ip}`;

  // Evita crescimento ilimitado do Map
  if (hitMap.size > MAX_KEYS) {
    const oldest = hitMap.keys().next().value;
    if (oldest) hitMap.delete(oldest);
  }

  const list = cleanWindow(key);
  list.push(Date.now());
  hitMap.set(key, list);

  if (list.length >= MAX_HITS) {
    // Persiste apenas na primeira vez que bate o limite (não a cada request)
    if (list.length === MAX_HITS) {
      persistAlert(checkoutId, ip, list.length, tenantId).catch(() => {});
    }
    return {
      blocked: true,
      hits: list.length,
      message: 'Muitas tentativas de pagamento em pouco tempo. Aguarde alguns segundos e tente novamente.'
    };
  }

  return { blocked: false, hits: list.length };
}

// Limpeza periódica a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of hitMap.entries()) {
    const fresh = list.filter(ts => now - ts < WINDOW_MS);
    if (fresh.length === 0) hitMap.delete(key);
    else hitMap.set(key, fresh);
  }
}, 5 * 60_000).unref();
