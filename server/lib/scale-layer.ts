/**
 * ⚡ SCALE LAYER — Infraestrutura de desempenho para alta concorrência
 *
 * Problemas resolvidos:
 * 1. Request Coalescing  — thundering herd: 1000 hits simultâneos no mesmo checkout → 1 query Firestore
 * 2. Keep-Alive Pool     — reutiliza conexões TCP para EfíBank, Bunny CDN, etc.
 * 3. SWR Cache           — stale-while-revalidate: responde da memória, atualiza em background
 * 4. ETag Helper         — cache 304 para endpoints públicos (checkout page)
 * 5. Event Loop Monitor  — detecta quando o servidor está sobrecarregado
 * 6. Async Fire-Forget   — garante que side effects (email/push/webhook) nunca bloqueiam resposta
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// 1. HTTP KEEP-ALIVE AGENT POOL
// Antes: keepAlive=false, maxSockets=1 → nova conexão TCP por request
// Agora: pool reutilizável por domínio, até 50 sockets, timeout 30s idle
// ─────────────────────────────────────────────────────────────────────────────

export const httpsPool = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30_000,
  freeSocketTimeout: 30_000,
});

export const httpPool = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30_000,
  freeSocketTimeout: 30_000,
});

/** Retorna agente para a URL informada */
export function getPoolAgent(url: string): https.Agent | http.Agent {
  return url.startsWith('https') ? httpsPool : httpPool;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REQUEST COALESCER (Thundering Herd Protection)
// Se 1000 requisições chegam para o mesmo key ao mesmo tempo, apenas 1 executa;
// as outras 999 aguardam a Promise ser resolvida e recebem o mesmo resultado.
// ─────────────────────────────────────────────────────────────────────────────

const inflightMap = new Map<string, Promise<any>>();
const inflightStats = { hits: 0, misses: 0 };

export async function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflightMap.get(key);
  if (existing) {
    inflightStats.hits++;
    return existing as Promise<T>;
  }

  inflightStats.misses++;
  const promise = fn().finally(() => inflightMap.delete(key));
  inflightMap.set(key, promise);
  return promise;
}

export function getCoalesceStats() {
  return {
    ...inflightStats,
    inFlight: inflightMap.size,
    hitRate: inflightStats.hits / (inflightStats.hits + inflightStats.misses || 1)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SWR CACHE (Stale-While-Revalidate)
// Retorna dado stale imediatamente enquanto atualiza em background.
// Ideal para checkout page: sempre rápido, nunca bloqueia, nunca stale por mais de `staleMs`
// ─────────────────────────────────────────────────────────────────────────────

interface SwrEntry<T> {
  data: T;
  fetchedAt: number;
  refreshing: boolean;
}

class SwrCache<T> {
  private store = new Map<string, SwrEntry<T>>();
  private readonly ttlMs: number;
  private readonly staleMs: number;

  constructor(opts: { ttlMs: number; staleMs?: number }) {
    this.ttlMs   = opts.ttlMs;
    this.staleMs = opts.staleMs ?? opts.ttlMs * 3; // dados usáveis até 3× o TTL normal
  }

  async get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.store.get(key);
    const now = Date.now();

    if (entry) {
      const age = now - entry.fetchedAt;

      // Dentro do TTL normal — retorna direto
      if (age < this.ttlMs) return entry.data;

      // Stale mas ainda usável — serve stale e revalida em background
      if (age < this.staleMs && !entry.refreshing) {
        entry.refreshing = true;
        fetcher()
          .then(fresh => this.store.set(key, { data: fresh, fetchedAt: Date.now(), refreshing: false }))
          .catch(() => { entry.refreshing = false; });
        return entry.data;
      }

      // Stale e já revalidando — retorna stale enquanto aguarda
      if (entry.refreshing) return entry.data;
    }

    // Cache miss ou expirado completamente — fetch síncrono com coalescing
    const fresh = await coalesce(key, fetcher);
    this.store.set(key, { data: fresh, fetchedAt: Date.now(), refreshing: false });
    return fresh;
  }

  invalidate(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

// Cache SWR para checkouts públicos (produto mais acessado durante lançamentos)
export const checkoutSwr = new SwrCache<any>({ ttlMs: 10_000, staleMs: 120_000 });

// Cache SWR para paymentConfig global
export const paymentConfigSwr = new SwrCache<any>({ ttlMs: 60_000, staleMs: 600_000 });

// ─────────────────────────────────────────────────────────────────────────────
// 4. ETAG HELPER
// Gera ETag a partir do conteúdo; permite resposta 304 Not Modified.
// Reduz bandwidth em até 80% para endpoints estáticos/semi-estáticos.
// ─────────────────────────────────────────────────────────────────────────────

export function computeETag(data: any): string {
  const json = JSON.stringify(data);
  return `"${crypto.createHash('sha1').update(json).digest('hex').slice(0, 16)}"`;
}

/**
 * Responde com 304 se o cliente já tem a versão atual (ETag match),
 * caso contrário envia JSON com ETag e Cache-Control.
 */
export function sendWithETag(
  res: any,
  req: any,
  data: any,
  opts?: { maxAge?: number; staleWhileRevalidate?: number }
): void {
  const etag = computeETag(data);
  const maxAge = opts?.maxAge ?? 30;
  const swr = opts?.staleWhileRevalidate ?? 120;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${swr}`);
  res.setHeader('Vary', 'Accept-Encoding');

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.json(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. EVENT LOOP LAG MONITOR
// Detecta quando o event loop está sobrecarregado (>200ms de lag).
// Loga warning para alertar operações antes de começar a recusar requests.
// ─────────────────────────────────────────────────────────────────────────────

let _lagMs = 0;
let _lagChecks = 0;
let _lagHigh = 0;

function measureLag() {
  const start = Date.now();
  setImmediate(() => {
    const lag = Date.now() - start;
    _lagMs = lag;
    _lagChecks++;
    if (lag > 200) {
      _lagHigh++;
      if (_lagHigh % 10 === 1) { // log a cada 10 ocorrências
        console.warn(`⚠️ [SCALE] Event loop lag alto: ${lag}ms (total: ${_lagHigh}×)`);
      }
    }
  });
}

export function startEventLoopMonitor(intervalMs = 1000) {
  const timer = setInterval(measureLag, intervalMs);
  timer.unref(); // não impede shutdown
  return timer;
}

export function getEventLoopStats() {
  return { lagMs: _lagMs, checks: _lagChecks, highLagCount: _lagHigh };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ASYNC FIRE-AND-FORGET WRAPPER
// Garante que side effects (email, push, webhook) nunca bloqueiam a resposta.
// Erros são capturados e logados silenciosamente.
// ─────────────────────────────────────────────────────────────────────────────

export function fireAndForget(label: string, fn: () => Promise<any>): void {
  Promise.resolve()
    .then(fn)
    .catch(err => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[fire-and-forget:${label}] ${err?.message ?? err}`);
      }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. CONCURRENT OPERATION LIMITER (Semáforo)
// Evita sobrecarga quando dezenas de workers simultâneos tentam escrever no
// mesmo documento Firestore (ex.: contador de vendas no lançamento).
// ─────────────────────────────────────────────────────────────────────────────

export class Semaphore {
  private concurrency: number;
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get pending() { return this.queue.length; }
  get running() { return this.active; }
}

// Semáforo global para operações críticas de pagamento (max 100 simultâneos)
export const paymentSemaphore = new Semaphore(100);

// ─────────────────────────────────────────────────────────────────────────────
// 8. HEALTH / METRICS ENDPOINT DATA
// ─────────────────────────────────────────────────────────────────────────────

export function getScaleMetrics() {
  const mem = process.memoryUsage();
  return {
    eventLoop: getEventLoopStats(),
    coalesce: getCoalesceStats(),
    cache: {
      checkoutSwrSize: checkoutSwr.size(),
      paymentConfigSwrSize: paymentConfigSwr.size(),
    },
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    httpPool: {
      httpsActiveSockets: httpsPool.sockets ? Object.values(httpsPool.sockets).reduce((a, b) => a + (b as any[]).length, 0) : 0,
    },
    uptime: Math.round(process.uptime())
  };
}
