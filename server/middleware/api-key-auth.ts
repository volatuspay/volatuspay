import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { storage } from '../storage';
import { firestoreCache, withFirestoreTimeout } from '../lib/firestore-cache.js';
import { FieldValue } from 'firebase-admin/firestore';

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    sellerId: string;
    name: string;
    permissions: string[];
  };
}

/**
 * Middleware para validar API Key e verificar permissões
 * Header: X-API-Key: vp_live_xxx ou Authorization: Bearer vp_live_xxx
 *
 * Queries usam campo único para evitar índices compostos (Firebase Spark).
 * O filtro de `active` é feito em memória após busca por hash/key.
 */
export async function validateApiKey(req: ApiKeyRequest, res: Response, next: NextFunction) {
  try {
    const apiKey = req.headers['x-api-key'] as string ||
                   (req.headers.authorization?.startsWith('Bearer ')
                     ? req.headers.authorization.slice(7)
                     : null);

    if (!apiKey) {
      return res.status(401).json({
        error: 'API Key não fornecida',
        code: 'MISSING_API_KEY',
        message: 'Inclua o header X-API-Key ou Authorization: Bearer <api_key>'
      });
    }

    if (!apiKey.startsWith('vp_')) {
      return res.status(401).json({
        error: 'Formato de API Key inválido',
        code: 'INVALID_API_KEY_FORMAT'
      });
    }

    const firebaseStorage = storage as any;
    if (!firebaseStorage.db) {
      return res.status(503).json({
        error: 'Serviço temporariamente indisponível',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    const keyHash = hashApiKey(apiKey);

    // ── Cache hit ────────────────────────────────────────────────────────────
    const cachedKey = firestoreCache.getApiKeyFromCache(keyHash);
    if (cachedKey !== undefined) {
      if (cachedKey === null) {
        return res.status(401).json({ error: 'API Key inválida ou revogada', code: 'INVALID_API_KEY' });
      }
      req.apiKey = cachedKey;
      firebaseStorage.db.collection('apiKeys').doc(cachedKey.id).update({
        lastUsedAt: new Date(),
        usageCount: FieldValue.increment(1)
      }).catch(() => {});
      return next();
    }

    // ── Neon-first: evita round-trip ao Firebase quando possível ─────────────
    try {
      const { neonReadApiKey } = await import('../lib/neon-reads.js');
      const neonKey = await neonReadApiKey(keyHash);
      if (neonKey) {
        req.apiKey = neonKey;
        firestoreCache.setApiKeyCache(keyHash, neonKey);
        firestoreCache.setApiKeyCache(apiKey, neonKey);
        firebaseStorage.db.collection('apiKeys').doc(neonKey.id).update({
          lastUsedAt: new Date(),
          usageCount: FieldValue.increment(1)
        }).catch(() => {});
        return next();
      }
    } catch {}

    // ── Fallback Firebase: Busca por keyHash ──────────────────────────────────
    const byHashSnap = await withFirestoreTimeout(
      firebaseStorage.db
        .collection('apiKeys')
        .where('keyHash', '==', keyHash)
        .limit(2)
        .get()
    ) as any;

    let foundDoc: any = null;

    if (!byHashSnap.empty) {
      // filtra active em memória
      foundDoc = byHashSnap.docs.find((d: any) => d.data().active !== false) || null;
    }

    // ── Fallback: busca pelo valor bruto da key (single-field) ───────────────
    if (!foundDoc) {
      const byKeySnap = await withFirestoreTimeout(
        firebaseStorage.db
          .collection('apiKeys')
          .where('key', '==', apiKey)
          .limit(2)
          .get()
      ) as any;

      if (!byKeySnap.empty) {
        foundDoc = byKeySnap.docs.find((d: any) => d.data().active !== false) || null;
      }
    }

    if (!foundDoc) {
      firestoreCache.setApiKeyCache(keyHash, null);
      return res.status(401).json({
        error: 'API Key inválida ou revogada',
        code: 'INVALID_API_KEY'
      });
    }

    const data = foundDoc.data();
    const keyData = {
      id: foundDoc.id,
      sellerId: data.sellerId || data.sellerUid || '',
      name: data.name || '',
      permissions: data.permissions || []
    };

    req.apiKey = keyData;
    firestoreCache.setApiKeyCache(keyHash, keyData);
    firestoreCache.setApiKeyCache(apiKey, keyData);

    firebaseStorage.db.collection('apiKeys').doc(foundDoc.id).update({
      lastUsedAt: new Date(),
      usageCount: FieldValue.increment(1)
    }).catch(() => {});

    next();
  } catch (error: any) {
    console.error('Erro na validação de API Key:', error?.message || error);
    return res.status(500).json({
      error: 'Erro interno na autenticação',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Middleware para verificar se a API Key tem a permissão necessária
 */
export function requirePermission(...requiredPermissions: string[]) {
  return (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return res.status(401).json({
        error: 'Autenticação necessária',
        code: 'AUTH_REQUIRED'
      });
    }

    const hasPermission = requiredPermissions.some(perm =>
      req.apiKey!.permissions.includes(perm) ||
      req.apiKey!.permissions.includes('*')
    );

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Permissão insuficiente',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: requiredPermissions,
        current: req.apiKey.permissions
      });
    }

    next();
  };
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
