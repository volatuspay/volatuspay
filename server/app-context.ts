import { getAdmin, ensureFirebaseReady, getFirestore } from './lib/firebase-admin.js';
import { storage } from './storage.js';
import { verifyFirebaseToken, requireAdmin, requireApprovedSeller } from './security/firebase-auth.js';
import type { AuthenticatedRequest } from './security/firebase-auth.js';
import { firestoreCache, withFirestoreTimeout } from './lib/firestore-cache.js';
import rateLimit from 'express-rate-limit';

const skipLocalIPs = (req: any) => {
  const ip = req.ip;
  return /^(127\.|10\.|192\.168\.|160\.20\.)/.test(ip) || ip === '::1';
};

// Silences ERR_ERL_PERMISSIVE_TRUST_PROXY on GCE/Replit
const rlValidate = { trustProxy: false };

export const rateLimiters = {
  auth: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.', code: 'RATE_LIMIT_AUTH' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: rlValidate,
    skip: skipLocalIPs
  }),
  payment: rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 1000,
    message: { error: 'Muitas solicitações de pagamento. Aguarde alguns minutos.', code: 'RATE_LIMIT_PAYMENT' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: rlValidate,
    skip: skipLocalIPs
  }),
  admin: rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 500,
    message: { error: 'Limite de operações admin excedido. Aguarde 5 minutos.', code: 'RATE_LIMIT_ADMIN' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: rlValidate,
    skip: skipLocalIPs
  }),
  webhook: rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 500,
    message: { error: 'Limite de webhooks excedido. Aguarde 1 minuto.', code: 'RATE_LIMIT_WEBHOOK' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: rlValidate,
    skip: skipLocalIPs
  }),
  user: rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 200,
    message: { error: 'Muitas requisições. Aguarde 1 minuto.', code: 'RATE_LIMIT_USER' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: rlValidate,
    skip: skipLocalIPs
  })
};

export async function getDb() {
  await ensureFirebaseReady();
  return getFirestore();
}

export async function getAdminSdk() {
  await ensureFirebaseReady();
  return getAdmin();
}

export async function getTenantFromAuth(req: any): Promise<string | null> {
  if (!req.user?.uid) {
    return null;
  }

  try {
    // 🐘 Neon-first: evita round-trip ao Firebase para leitura de tenantId
    try {
      const { neonReadSellerTenantId } = await import('./lib/neon-reads.js');
      const tenantId = await neonReadSellerTenantId(req.user.uid);
      if (tenantId) return tenantId;
    } catch {}

    await ensureFirebaseReady();
    const db = getFirestore();

    const sellerDoc = await db.collection('sellers').doc(req.user.uid).get();
    if (sellerDoc.exists) {
      const sellerData = sellerDoc.data();
      if (sellerData?.tenantId) {
        return sellerData.tenantId;
      }
    }

    const tenantDoc = await db.collection('tenants').doc(req.user.uid).get();
    if (tenantDoc.exists) {
      return req.user.uid;
    }

    return req.user.uid;
  } catch (error) {
    console.error('Erro ao obter tenant:', error);
    return req.user.uid;
  }
}

export {
  getAdmin,
  ensureFirebaseReady,
  getFirestore,
  storage,
  verifyFirebaseToken,
  requireAdmin,
  requireApprovedSeller,
  firestoreCache,
  withFirestoreTimeout
};

export type { AuthenticatedRequest };
