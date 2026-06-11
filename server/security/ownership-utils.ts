/**
 * 🛡️ OWNERSHIP UTILITIES - PREVENÇÃO IDOR
 * Utilitários para validação de ownership em recursos Firestore
 * SEM QUEBRAR FUNCIONALIDADES EXISTENTES
 */

import { Request, Response, NextFunction } from 'express';
import { getFirestore } from '../lib/firebase-admin';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

export interface AuthenticatedRequest extends Request {
  authUser?: {
    uid: string;
    email?: string;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
    customClaims?: any;
  };
}

/**
 * 🔒 ASSERT OWNER - Verifica se documento pertence ao usuário
 * Lança erro 403 se não for dono
 */
export function assertOwner(
  resourceDoc: any,
  uid: string,
  options?: {
    ownerField?: string;
    allowAdmin?: boolean;
    isAdmin?: boolean;
  }
): void {
  const ownerField = options?.ownerField || 'ownerId';
  const resourceOwnerId = resourceDoc[ownerField] || resourceDoc.userId;

  // ✅ Admin bypass (se permitido)
  if (options?.allowAdmin && options?.isAdmin) {
    console.log(`✅ Admin access granted for resource`);
    return;
  }

  // 🔍 Verificar ownership
  if (!resourceOwnerId) {
    throw new Error('SECURITY: Recurso sem owner definido');
  }

  if (resourceOwnerId !== uid) {
    throw new Error('FORBIDDEN');
  }
}

/**
 * 🔍 GET BY ID WITH OWNERSHIP - Busca documento COM verificação de ownership
 */
export async function getByIdWithOwnership(
  collection: string,
  id: string,
  uid: string,
  options?: {
    ownerField?: string;
    allowAdmin?: boolean;
    isAdmin?: boolean;
  }
): Promise<any> {
  const db = getFirestore();
  const ownerField = options?.ownerField || 'ownerId';

  try {
    const docRef = db.collection(collection).doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return null;
    }

    const data = docSnap.data();

    // ✅ Admin bypass
    if (options?.allowAdmin && options?.isAdmin) {
      console.log(`✅ Admin access: ${collection}/${id}`);
      return { id: docSnap.id, ...data };
    }

    // 🔍 Verificar ownership
    const resourceOwnerId = data?.[ownerField] || data?.userId;
    
    if (!resourceOwnerId || resourceOwnerId !== uid) {
      console.warn(`🚨 IDOR ATTEMPT: User ${uid} tried to access ${collection}/${id} owned by ${resourceOwnerId}`);
      return null; // Retornar null ao invés de erro (previne enumeration)
    }

    return { id: docSnap.id, ...data };
  } catch (error) {
    console.error(`❌ Error in getByIdWithOwnership:`, error);
    throw error;
  }
}

/**
 * 🛡️ OWNERSHIP MIDDLEWARE - Valida ownership antes de permitir acesso
 */
export function requireOwnership(
  collection: string,
  options?: {
    ownerField?: string;
    paramName?: string;
    allowAdmin?: boolean;
  }
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const uid = req.authUser?.uid || req.user?.uid;
      const isAdmin = req.authUser?.isAdmin || req.authUser?.isSuperAdmin;

      if (!uid) {
        return res.status(401).json({
          success: false,
          error: 'Autenticação necessária'
        });
      }

      const resourceId = req.params[options?.paramName || 'id'];
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          error: 'ID do recurso não fornecido'
        });
      }

      const resource = await getByIdWithOwnership(
        collection,
        resourceId,
        uid,
        {
          ownerField: options?.ownerField,
          allowAdmin: options?.allowAdmin,
          isAdmin
        }
      );

      if (!resource) {
        // 🔥 DETECTAR IDOR E BLOQUEAR (severity: high, 3 tentativas = ban)
        if (!isAdmin) {
          await addSuspiciousIPToPermanentBlacklist(
            req.ip,
            `IDOR attempt on ${collection}/${resourceId}`,
            'high'
          );
        }

        return res.status(404).json({
          success: false,
          error: 'Recurso não encontrado'
        });
      }

      // ✅ Anexar recurso ao request para uso posterior
      (req as any).resource = resource;

      next();
    } catch (error) {
      console.error(`❌ Ownership validation error:`, error);
      
      if (error.message === 'FORBIDDEN') {
        return res.status(404).json({
          success: false,
          error: 'Recurso não encontrado'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Erro ao validar permissões'
      });
    }
  };
}

/**
 * 🚫 DENY CLIENT FIELDS - Remove campos que cliente NÃO pode definir
 * Previne Mass Assignment
 */
export function denyClientFields<T extends Record<string, any>>(
  body: T,
  deniedFields: string[]
): Omit<T, typeof deniedFields[number]> {
  const cleaned = { ...body };
  
  for (const field of deniedFields) {
    if (field in cleaned) {
      console.warn(`🚨 MASS ASSIGNMENT ATTEMPT: Client tried to set ${field}`);
      delete cleaned[field];
    }
  }
  
  return cleaned;
}

/**
 * 🔒 INJECT OWNER - Injeta ownerId no body baseado no usuário autenticado
 */
export function injectOwner(
  body: any,
  uid: string,
  options?: {
    ownerField?: string;
    overwrite?: boolean;
  }
): any {
  const ownerField = options?.ownerField || 'ownerId';
  
  // Não sobrescrever se já existe (a menos que overwrite=true)
  if (body[ownerField] && !options?.overwrite) {
    console.warn(`⚠️ Owner field already set: ${ownerField}`);
    // Validar que corresponde ao uid
    if (body[ownerField] !== uid) {
      throw new Error('FORBIDDEN: Cannot set different owner');
    }
    return body;
  }

  return {
    ...body,
    [ownerField]: uid
  };
}

/**
 * 📊 LIST WITH OWNERSHIP - Lista apenas recursos do usuário
 */
export async function listWithOwnership(
  collection: string,
  uid: string,
  options?: {
    ownerField?: string;
    allowAdmin?: boolean;
    isAdmin?: boolean;
    limit?: number;
    orderBy?: string;
    orderDirection?: 'asc' | 'desc';
  }
): Promise<any[]> {
  const db = getFirestore();
  const ownerField = options?.ownerField || 'ownerId';

  try {
    let query: any = db.collection(collection);

    // ✅ Admin pode ver tudo
    if (options?.allowAdmin && options?.isAdmin) {
      console.log(`✅ Admin listing all ${collection}`);
    } else {
      // 🔒 Filtrar por ownership
      query = query.where(ownerField, '==', uid);
    }

    // Ordenação
    if (options?.orderBy) {
      query = query.orderBy(options.orderBy, options.orderDirection || 'desc');
    }

    // Limite
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    
    return snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error(`❌ Error in listWithOwnership:`, error);
    throw error;
  }
}

/**
 * 🗑️ DELETE WITH OWNERSHIP - Deleta apenas se for dono
 */
export async function deleteWithOwnership(
  collection: string,
  id: string,
  uid: string,
  options?: {
    ownerField?: string;
    allowAdmin?: boolean;
    isAdmin?: boolean;
  }
): Promise<boolean> {
  const db = getFirestore();

  try {
    // Verificar ownership primeiro
    const resource = await getByIdWithOwnership(collection, id, uid, options);
    
    if (!resource) {
      return false;
    }

    // Deletar
    await db.collection(collection).doc(id).delete();
    console.log(`✅ Deleted ${collection}/${id} by user ${uid}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Error in deleteWithOwnership:`, error);
    throw error;
  }
}

/**
 * 📝 UPDATE WITH OWNERSHIP - Atualiza apenas se for dono
 */
export async function updateWithOwnership(
  collection: string,
  id: string,
  uid: string,
  updates: any,
  options?: {
    ownerField?: string;
    allowAdmin?: boolean;
    isAdmin?: boolean;
    deniedFields?: string[];
  }
): Promise<any> {
  const db = getFirestore();

  try {
    // Verificar ownership primeiro
    const resource = await getByIdWithOwnership(collection, id, uid, options);
    
    if (!resource) {
      return null;
    }

    // Limpar campos não permitidos
    let cleanUpdates = { ...updates };
    if (options?.deniedFields) {
      cleanUpdates = denyClientFields(cleanUpdates, options.deniedFields);
    }

    // Sempre negar alteração de ownerId
    delete cleanUpdates.ownerId;
    delete cleanUpdates.userId;

    // Atualizar
    await db.collection(collection).doc(id).update({
      ...cleanUpdates,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ Updated ${collection}/${id} by user ${uid}`);
    
    // Retornar documento atualizado
    const updated = await db.collection(collection).doc(id).get();
    return { id: updated.id, ...updated.data() };
  } catch (error) {
    console.error(`❌ Error in updateWithOwnership:`, error);
    throw error;
  }
}
