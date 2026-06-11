/**
 * 🔒 IDEMPOTENCY PROTECTION - Prevenir processamento duplicado
 * Migrado para Neon PostgreSQL — sem Firestore
 */

import { neonQuery } from '../lib/neon-db.js';

// 💾 CACHE EM MEMÓRIA (para performance)
const idempotencyCache = new Map<string, {
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: any;
  createdAt: number;
  expiresAt: number;
}>();

// 🧹 LIMPEZA AUTOMÁTICA DE CACHE (a cada 5 minutos)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, entry] of idempotencyCache.entries()) {
    if (now > entry.expiresAt) {
      idempotencyCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Idempotency cache cleaned: ${cleaned} expired entries`);
  }
}, 5 * 60 * 1000);

/**
 * 🔑 GERAR IDEMPOTENCY KEY
 * Baseado em: userId + checkoutId + amount + timestamp (janela de 5min)
 */
export function generateIdempotencyKey(
  userId: string,
  checkoutId: string,
  amount: number
): string {
  // Janela de 5 minutos (arredondar timestamp)
  const window = Math.floor(Date.now() / (5 * 60 * 1000));
  const key = `${userId}:${checkoutId}:${amount}:${window}`;
  
  // Hash simples para evitar expor dados
  const hash = Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  return `idem_${hash}`;
}

/**
 * 🔒 VERIFICAR IDEMPOTENCY KEY
 * Retorna resultado anterior se já foi processado
 */
export async function checkIdempotencyKey(
  idempotencyKey: string
): Promise<{
  exists: boolean;
  status?: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: any;
}> {
  try {
    // 1. VERIFICAR CACHE EM MEMÓRIA (rápido)
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) {
      const now = Date.now();
      if (now < cached.expiresAt) {
        console.log(`✅ Idempotency HIT (cache): ${idempotencyKey} - ${cached.status}`);
        return {
          exists: true,
          status: cached.status,
          result: cached.result,
          error: cached.error
        };
      } else {
        // Expirado, remover
        idempotencyCache.delete(idempotencyKey);
      }
    }
    
    // 2. VERIFICAR NEON (persistente)
    let found: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT status, result, error, expires_at_ms FROM idempotency_keys
        WHERE id = ${idempotencyKey} LIMIT 1
      `;
      if (rows.length > 0) found = rows[0];
    }, `checkIdem:${idempotencyKey}`);

    if (found) {
      const now = Date.now();
      if (now < Number(found.expires_at_ms)) {
        console.log(`✅ Idempotency HIT (db): ${idempotencyKey} - ${found.status}`);
        idempotencyCache.set(idempotencyKey, {
          status: found.status,
          result: found.result,
          error: found.error,
          createdAt: now,
          expiresAt: Number(found.expires_at_ms),
        });
        return { exists: true, status: found.status, result: found.result, error: found.error };
      } else {
        await neonQuery(async (sql) => {
          await sql`DELETE FROM idempotency_keys WHERE id = ${idempotencyKey}`;
        }, `deleteExpiredIdem`);
      }
    }

    console.log(`🆕 Idempotency MISS: ${idempotencyKey} - primeira execução`);
    return { exists: false };
    
  } catch (error) {
    console.error(`❌ Erro ao verificar idempotency key:`, error);
    // Em caso de erro, permitir execução (fail-open para não quebrar pagamentos)
    return { exists: false };
  }
}

/**
 * 🔒 REGISTRAR IDEMPOTENCY KEY COMO PROCESSANDO
 */
export async function startIdempotency(idempotencyKey: string): Promise<boolean> {
  try {
    const db = getFirestore();
    const now = Date.now();
    const expiresAt = now + (24 * 60 * 60 * 1000); // 24 horas
    
    const entry = {
      status: 'processing' as const,
      createdAt: now,
      expiresAt,
      result: null,
      error: null
    };
    
    idempotencyCache.set(idempotencyKey, entry);

    await neonQuery(async (sql) => {
      await sql`
        INSERT INTO idempotency_keys (id, status, created_at_ms, expires_at_ms)
        VALUES (${idempotencyKey}, 'processing', ${now}, ${expiresAt})
        ON CONFLICT (id) DO NOTHING
      `;
    }, `startIdem:${idempotencyKey}`);

    console.log(`🔄 Idempotency started: ${idempotencyKey}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Erro ao iniciar idempotency:`, error);
    return false;
  }
}

/**
 * ✅ REGISTRAR IDEMPOTENCY KEY COMO COMPLETO
 */
export async function completeIdempotency(
  idempotencyKey: string,
  result: any
): Promise<void> {
  try {
    const db = getFirestore();
    const now = Date.now();
    const expiresAt = now + (24 * 60 * 60 * 1000); // 24 horas
    
    // 🔒 REDUZIR DADOS PERSISTIDOS: Apenas dados seguros, sem tokens/cartões
    const safeResult = {
      success: result.success,
      orderId: result.orderId,
      method: result.method,
      status: result.status,
      amount: result.amount,
      txid: result.txid,
      chargeId: result.chargeId,
      installments: result.installments,
      // 🚫 NÃO persistir: cardMask, qrcode completo, tokens, dados sensíveis
    };
    
    const entry = {
      status: 'completed' as const,
      result: safeResult,
      error: null,
      createdAt: now,
      expiresAt
    };
    
    idempotencyCache.set(idempotencyKey, { ...entry, result });

    await neonQuery(async (sql) => {
      const res = JSON.stringify(safeResult);
      await sql`
        UPDATE idempotency_keys
        SET status = 'completed', result = ${res}::jsonb, completed_at = NOW(), expires_at_ms = ${expiresAt}
        WHERE id = ${idempotencyKey}
      `;
    }, `completeIdem:${idempotencyKey}`);

    console.log(`✅ Idempotency completed: ${idempotencyKey}`);
    
  } catch (error) {
    console.error(`❌ Erro ao completar idempotency:`, error);
  }
}

/**
 * ❌ REGISTRAR IDEMPOTENCY KEY COMO FALHO
 */
export async function failIdempotency(
  idempotencyKey: string,
  error: any
): Promise<void> {
  try {
    const db = getFirestore();
    const now = Date.now();
    const expiresAt = now + (1 * 60 * 60 * 1000); // 1 hora (erro expira mais rápido)
    
    const entry = {
      status: 'failed' as const,
      result: null,
      error: error?.message || 'Unknown error',
      createdAt: now,
      expiresAt
    };
    
    idempotencyCache.set(idempotencyKey, entry);

    await neonQuery(async (sql) => {
      await sql`
        UPDATE idempotency_keys
        SET status = 'failed', error = ${error?.message || 'Unknown error'}, failed_at = NOW(), expires_at_ms = ${expiresAt}
        WHERE id = ${idempotencyKey}
      `;
    }, `failIdem:${idempotencyKey}`);

    console.log(`❌ Idempotency failed: ${idempotencyKey}`);
    
  } catch (err) {
    console.error(`❌ Erro ao registrar falha de idempotency:`, err);
  }
}

/**
 * 🛡️ MIDDLEWARE DE IDEMPOTENCY
 * Usar em rotas de pagamento/transações críticas
 */
export function idempotencyMiddleware(req: any, res: any, next: any) {
  // Extrair ou gerar idempotency key
  let idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
  
  if (!idempotencyKey) {
    // Gerar automaticamente baseado nos dados da transação
    const userId = req.user?.uid || req.body.userId;
    const checkoutId = req.body.checkoutId || req.params.checkoutId;
    const amount = req.body.amount || req.body.totalAmount;
    
    if (userId && checkoutId && amount) {
      idempotencyKey = generateIdempotencyKey(userId, checkoutId, amount);
      console.log(`🔑 Idempotency key gerada automaticamente: ${idempotencyKey}`);
    }
  }
  
  if (!idempotencyKey) {
    // Não há dados suficientes para idempotency, permitir mas avisar
    console.warn(`⚠️ Idempotency key não disponível para ${req.method} ${req.path}`);
    return next();
  }
  
  // Anexar ao request para uso posterior
  req.idempotencyKey = idempotencyKey;
  
  // Verificar se já foi processado
  checkIdempotencyKey(idempotencyKey).then(check => {
    if (check.exists) {
      if (check.status === 'processing') {
        const cached = idempotencyCache.get(idempotencyKey);
        const processingAge = cached ? Date.now() - cached.createdAt : 0;
        if (processingAge > 30000) {
          console.log(`🔄 Idempotency STALE processing (${Math.round(processingAge/1000)}s) - permitindo retry: ${idempotencyKey}`);
          idempotencyCache.delete(idempotencyKey);
          neonQuery(async (sql) => { await sql`DELETE FROM idempotency_keys WHERE id = ${idempotencyKey}`; }, 'deleteStaleIdem').catch(() => {});
          return next();
        }
        return res.status(409).json({
          success: false,
          error: 'Requisição já está sendo processada',
          code: 'DUPLICATE_REQUEST'
        });
      }

      if (check.status === 'completed') {
        console.log(`♻️ Retornando resultado anterior (idempotent): ${idempotencyKey}`);
        return res.status(200).json(check.result);
      }

      if (check.status === 'failed') {
        console.log(`🔄 Idempotency FAILED anterior - permitindo retry: ${idempotencyKey}`);
        idempotencyCache.delete(idempotencyKey);
        neonQuery(async (sql) => { await sql`DELETE FROM idempotency_keys WHERE id = ${idempotencyKey}`; }, 'deleteFailedIdem').catch(() => {});
        return next();
      }
    }
    
    // Primeira execução, marcar como processando e continuar
    startIdempotency(idempotencyKey).then(() => {
      next();
    }).catch(err => {
      console.error(`❌ Erro ao iniciar idempotency:`, err);
      next(); // Continuar mesmo com erro (fail-open)
    });
    
  }).catch(err => {
    console.error(`❌ Erro ao verificar idempotency:`, err);
    next(); // Continuar mesmo com erro (fail-open)
  });
}

/**
 * 🛡️ REPLAY ATTACK PROTECTION - Validação de timestamp
 * Blinda contra ataques onde uma requisição válida é capturada e reenviada.
 *
 * Funcionamento:
 * - Cliente envia header X-Request-Timestamp com Unix timestamp em ms
 * - Servidor rejeita se timestamp > 5 minutos atrás ou > 60s no futuro
 * - Reduz janela de replay de ~60min (vida do token Firebase) para 5min
 *
 * Fail-open: se o header não for enviado, a requisição passa normalmente
 * (compatibilidade com clientes antigos e webhooks externos)
 */

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutos
const FUTURE_TOLERANCE_MS = 60 * 1000;  // 60 segundos de tolerância para relógios dessincronizados

// 📍 Nonces usados recentemente para bloquear replays dentro da janela de 5min
const usedNonces = new Map<string, number>(); // nonce → timestamp

// 🧹 Limpar nonces expirados a cada 2 minutos
setInterval(() => {
  const cutoff = Date.now() - REPLAY_WINDOW_MS;
  let cleaned = 0;
  for (const [nonce, ts] of usedNonces.entries()) {
    if (ts < cutoff) {
      usedNonces.delete(nonce);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`🧹 Replay nonce cache cleaned: ${cleaned} expired`);
}, 2 * 60 * 1000);

export function replayProtectionMiddleware(req: any, res: any, next: any) {
  const tsHeader = req.headers['x-request-timestamp'];

  // Sem header → fail-open (compatibilidade retroativa)
  if (!tsHeader) {
    return next();
  }

  const requestTs = parseInt(tsHeader, 10);

  // Header malformado
  if (isNaN(requestTs) || requestTs <= 0) {
    console.warn(`🚨 [REPLAY] Header X-Request-Timestamp inválido: "${tsHeader}" de ${req.ip}`);
    return res.status(400).json({
      success: false,
      error: 'Timestamp de requisição inválido',
      code: 'INVALID_TIMESTAMP'
    });
  }

  const now = Date.now();
  const age = now - requestTs;

  // Requisição muito antiga (replay attack)
  if (age > REPLAY_WINDOW_MS) {
    console.warn(`🚨 [REPLAY] Requisição expirada (${Math.round(age / 1000)}s atrás) bloqueada: ${req.method} ${req.path} IP:${req.ip}`);
    return res.status(400).json({
      success: false,
      error: 'Requisição expirada. Envie uma nova requisição.',
      code: 'REQUEST_EXPIRED'
    });
  }

  // Requisição do futuro (relógio manipulado / pré-gerado para replay futuro)
  if (requestTs > now + FUTURE_TOLERANCE_MS) {
    console.warn(`🚨 [REPLAY] Timestamp futuro bloqueado: ${req.method} ${req.path} IP:${req.ip}`);
    return res.status(400).json({
      success: false,
      error: 'Timestamp inválido (futuro).',
      code: 'INVALID_TIMESTAMP'
    });
  }

  // Nonce opcional: se o cliente enviar X-Nonce, bloquear replay mesmo dentro da janela de 5min
  const nonce = req.headers['x-nonce'];
  if (nonce) {
    const nonceKey = `${req.user?.uid || req.ip}:${nonce}`;
    if (usedNonces.has(nonceKey)) {
      console.warn(`🚨 [REPLAY] Nonce duplicado bloqueado: ${nonceKey} IP:${req.ip}`);
      return res.status(409).json({
        success: false,
        error: 'Requisição duplicada detectada.',
        code: 'DUPLICATE_REQUEST'
      });
    }
    usedNonces.set(nonceKey, now);
  }

  next();
}

