/**
 * CHECKOUT GUARD — Proteção dos endpoints públicos de pagamento
 * Camadas: sanitização de inputs, validação CPF/CNPJ, rate-limit por IP, payload size guard
 * Inspirado em Hotmart / Kiwify / Braip — nível produção
 */

import { Request, Response, NextFunction } from 'express';

// ─── CPF / CNPJ ────────────────────────────────────────────────────────────

function isValidCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false; // todos iguais: 000...0 etc.
  const calc = (len: number) =>
    Array.from({ length: len }, (_, i) => parseInt(c[i]) * (len + 1 - i)).reduce((a, b) => a + b, 0);
  const d1 = ((calc(9) * 10) % 11) % 10;
  const d2 = ((calc(10) * 10) % 11) % 10;
  return d1 === parseInt(c[9]) && d2 === parseInt(c[10]);
}

function isValidCNPJ(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calcDig = (n: string, weights: number[]) =>
    weights.reduce((sum, w, i) => sum + parseInt(n[i]) * w, 0);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const r1 = calcDig(c, w1) % 11;
  const r2 = calcDig(c, w2) % 11;
  return parseInt(c[12]) === (r1 < 2 ? 0 : 11 - r1) &&
         parseInt(c[13]) === (r2 < 2 ? 0 : 11 - r2);
}

// ─── Sanitização ────────────────────────────────────────────────────────────

const HTML_RE = /<[^>]*>/g;
const CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g; // caracteres de controle (exceto \t \n \r)
const HEADER_INJ_RE = /[\r\n]/g; // email header injection
const SCRIPT_PROTO_RE = /javascript:|data:|vbscript:/gi;

function sanitizeText(val: string, maxLen: number): string {
  return val
    .replace(HTML_RE, '')
    .replace(CTRL_RE, '')
    .replace(SCRIPT_PROTO_RE, '')
    .trim()
    .slice(0, maxLen);
}

const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,255}\.[^\s@<>]{1,63}$/;

// ─── Rate-limit por IP em memória ────────────────────────────────────────────
// Simples e zero-custo (sem Firestore) — janela deslizante de 60s por IP

const _ipBuckets = new Map<string, { count: number; resetAt: number }>();
const PAYMENT_WINDOW_MS = 60_000;
const PAYMENT_MAX_PER_IP = 20; // 20 tentativas de pagamento por minuto por IP

function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

export function paymentIPRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  const now = Date.now();

  let bucket = _ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + PAYMENT_WINDOW_MS };
    _ipBuckets.set(ip, bucket);
  }
  bucket.count++;

  if (bucket.count > PAYMENT_MAX_PER_IP) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return res.status(429).json({
      error: 'Muitas tentativas de pagamento. Aguarde um momento.',
      code: 'PAYMENT_RATE_LIMIT',
      retryAfter,
    });
  }

  // Limpeza periódica (evita leak de memória em servidores de longa duração)
  if (_ipBuckets.size > 5000) {
    for (const [k, v] of _ipBuckets) {
      if (now > v.resetAt) _ipBuckets.delete(k);
    }
  }

  next();
}

// ─── Middleware principal ─────────────────────────────────────────────────────

export function sanitizeCheckoutInputs(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') return next();

    // ── PAYLOAD SIZE GUARD (50 KB max) ──────────────────────────────────────
    const rawSize = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (rawSize > 50_000) {
      return res.status(413).json({ error: 'Payload muito grande', code: 'PAYLOAD_TOO_LARGE' });
    }

    // ── CUSTOMER ─────────────────────────────────────────────────────────────
    if (body.customer && typeof body.customer === 'object') {
      const c = body.customer;

      // Nome: sem HTML, sem scripts, máx 150
      if (typeof c.name === 'string') {
        c.name = sanitizeText(c.name, 150);
        if (c.name.length < 2) {
          return res.status(400).json({ error: 'Nome inválido (mínimo 2 caracteres)', code: 'INVALID_NAME' });
        }
      }

      // Email: sem newlines (header injection), formato válido, máx 254
      if (typeof c.email === 'string') {
        c.email = c.email.replace(HEADER_INJ_RE, '').trim().toLowerCase().slice(0, 254);
        if (!EMAIL_RE.test(c.email)) {
          return res.status(400).json({ error: 'Email inválido', code: 'INVALID_EMAIL' });
        }
      }

      // Telefone: apenas dígitos, 10-11
      for (const f of ['phone', 'phone_number', 'phoneNumber']) {
        if (typeof c[f] === 'string') {
          c[f] = c[f].replace(/\D/g, '').slice(0, 11);
        }
      }

      // Documento CPF/CNPJ — validação matemática
      if (typeof c.document === 'string') {
        const doc = c.document.replace(/\D/g, '');
        if (doc.length === 11) {
          if (!isValidCPF(doc)) {
            return res.status(400).json({ error: 'CPF inválido', code: 'INVALID_CPF' });
          }
        } else if (doc.length === 14) {
          if (!isValidCNPJ(doc)) {
            return res.status(400).json({ error: 'CNPJ inválido', code: 'INVALID_CNPJ' });
          }
        } else if (doc.length > 0) {
          // Documento com tamanho inválido mas não vazio — rejeita
          return res.status(400).json({ error: 'CPF deve ter 11 dígitos ou CNPJ 14 dígitos', code: 'INVALID_DOCUMENT' });
        }
        c.document = doc;
      }

      // Campos de endereço
      if (c.address && typeof c.address === 'object') {
        const addr = c.address;
        for (const f of ['street', 'neighborhood', 'city', 'complement', 'number']) {
          if (typeof addr[f] === 'string') addr[f] = sanitizeText(addr[f], 200);
        }
        if (typeof addr.state === 'string') {
          addr.state = addr.state.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
        }
        if (typeof addr.zipCode === 'string') {
          addr.zipCode = addr.zipCode.replace(/\D/g, '').slice(0, 8);
        }
      }
    }

    // ── COUPON CODE: apenas alfanumérico + traço + underline ─────────────────
    if (typeof body.couponCode === 'string') {
      body.couponCode = body.couponCode.replace(/[^A-Za-z0-9\-_]/g, '').slice(0, 50);
    }
    if (typeof body.cardCouponCode === 'string') {
      body.cardCouponCode = body.cardCouponCode.replace(/[^A-Za-z0-9\-_]/g, '').slice(0, 50);
    }

    // ── TRACKING PARAMETERS: strip injection chars ──────────────────────────
    if (body.trackingParameters && typeof body.trackingParameters === 'object') {
      const tp = body.trackingParameters;
      const keys = Object.keys(tp);
      // Máximo 30 parâmetros
      if (keys.length > 30) {
        keys.slice(30).forEach(k => delete tp[k]);
      }
      for (const k of Object.keys(tp)) {
        if (k.length > 100) { delete tp[k]; continue; }
        if (typeof tp[k] === 'string') {
          tp[k] = tp[k].replace(/[<>"';&`\\]/g, '').slice(0, 500);
        }
      }
    }
    if (body.cardTrackingParams && typeof body.cardTrackingParams === 'object') {
      const tp = body.cardTrackingParams;
      for (const k of Object.keys(tp)) {
        if (typeof tp[k] === 'string') tp[k] = tp[k].replace(/[<>"';&`\\]/g, '').slice(0, 500);
      }
    }

    // ── OFFER SLUG: apenas alfanumérico + traço ─────────────────────────────
    if (typeof body.offerSlug === 'string') {
      body.offerSlug = body.offerSlug.replace(/[^A-Za-z0-9\-_]/g, '').slice(0, 100);
    }

    // ── AFFILIATE UID: apenas alfanumérico ──────────────────────────────────
    for (const f of ['affiliateUid', 'cardAffiliateUid']) {
      if (typeof body[f] === 'string') {
        body[f] = body[f].replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 100);
      }
    }

    next();
  } catch (err: any) {
    // fail-open: log mas não bloqueia checkout legítimo
    console.error('[CHECKOUT GUARD] Sanitização erro (fail-open):', err?.message);
    next();
  }
}
