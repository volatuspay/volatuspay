/**
 * 🛡️ ENHANCED SECURITY LAYER - CORREÇÕES IDOR/CSRF/PRICING
 * Camada de segurança adicional para prevenir IDOR, CSRF e manipulação de preços
 * SEM QUEBRAR FUNCIONALIDADES EXISTENTES
 */

import { Request, Response, NextFunction } from 'express';
import { getFirestore } from '../lib/firebase-admin';
import {
  AuthenticatedRequest,
  getByIdWithOwnership,
  requireOwnership,
  denyClientFields,
  injectOwner,
  deleteWithOwnership,
  updateWithOwnership
} from './ownership-utils';
import {
  requireCSRF,
  getCSRFToken,
  validateOrigin
} from './csrf-protection';
import {
  computeAmount,
  createPriceQuote,
  validateOrderPrice
} from './server-pricing';

// ✅ EXPORTAR MIDDLEWARES DE OWNERSHIP
export {
  requireOwnership,
  getByIdWithOwnership,
  deleteWithOwnership,
  updateWithOwnership
};

// ✅ EXPORTAR MIDDLEWARES DE CSRF
export {
  requireCSRF,
  getCSRFToken as csrfTokenHandler,
  validateOrigin
};

// ✅ EXPORTAR FUNÇÕES DE PRICING
export {
  computeAmount,
  createPriceQuote,
  validateOrderPrice
};

/**
 * 🔒 SECURE PRODUCT CREATE - Previne mass assignment
 */
export async function secureProductCreate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const uid = req.authUser?.uid || req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Autenticação necessária'
      });
    }

    // 🚫 DENY DANGEROUS FIELDS
    const cleanBody = denyClientFields(req.body, [
      'ownerId',
      'userId',
      'tenantId',
      'verified',
      'featured',
      'adminApproved',
      'createdAt',
      'updatedAt',
      'salesCount',
      'revenue'
    ]);

    // 🔒 INJECT OWNER
    req.body = injectOwner(cleanBody, uid, {
      ownerField: 'ownerId'
    });

    console.log(`✅ Product create secured for user ${uid}`);
    next();
  } catch (error: any) {
    console.error(`❌ Secure product create error:`, error);
    
    if (error.message.includes('FORBIDDEN')) {
      return res.status(403).json({
        success: false,
        error: 'Operação não permitida'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Erro de segurança'
    });
  }
}

/**
 * 🔒 SECURE CHECKOUT UPDATE - Previne IDOR em checkouts
 */
export async function secureCheckoutUpdate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const uid = req.authUser?.uid || req.user?.uid;
    const isAdmin = req.authUser?.isAdmin || req.authUser?.isSuperAdmin;

    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Autenticação necessária'
      });
    }

    const checkoutId = req.params.id;

    // 🔍 VERIFICAR OWNERSHIP
    const checkout = await getByIdWithOwnership(
      'checkouts',
      checkoutId,
      uid,
      {
        ownerField: 'ownerId',
        allowAdmin: true,
        isAdmin
      }
    );

    if (!checkout) {
      console.warn(`🚨 IDOR ATTEMPT: User ${uid} tried to update checkout ${checkoutId}`);
      return res.status(404).json({
        success: false,
        error: 'Checkout não encontrado'
      });
    }

    // 🚫 DENY DANGEROUS FIELDS
    req.body = denyClientFields(req.body, [
      'ownerId',
      'userId',
      'tenantId',
      'salesCount',
      'revenue',
      'verified'
    ]);

    // Anexar checkout para uso posterior
    (req as any).verifiedCheckout = checkout;

    console.log(`✅ Checkout update authorized for user ${uid}`);
    next();
  } catch (error) {
    console.error(`❌ Secure checkout update error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro de segurança'
    });
  }
}

/**
 * 🔒 SECURE ORDER CREATE - Validação de preço server-side
 */
export async function secureOrderCreate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const uid = req.authUser?.uid || req.user?.uid;

    // ⚠️ ORDERS PODEM SER CRIADOS SEM AUTH (checkout público)
    // Mas ainda assim precisam de validação de preço

    const { productId, amount, quantity, quoteId, couponCode, affiliateCode, paymentMethod, installments } = req.body;

    if (!productId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Dados incompletos'
      });
    }

    // 💰 VALIDAR PREÇO SERVER-SIDE
    console.log(`💰 Validando preço server-side para order...`);
    const priceValidation = await validateOrderPrice({
      productId,
      quantity: quantity || 1,
      couponCode,
      affiliateCode,
      paymentMethod,
      installments,
      clientAmount: amount,
      quoteId
    });

    if (!priceValidation.isValid) {
      console.error(`🚨 PRICE MANIPULATION DETECTED: Client ${amount}, Server ${priceValidation.serverAmount}`);
      return res.status(400).json({
        success: false,
        error: 'Valor do pedido inválido',
        code: 'INVALID_AMOUNT',
        details: {
          clientAmount: priceValidation.clientAmount,
          serverAmount: priceValidation.serverAmount,
          difference: priceValidation.difference
        }
      });
    }

    // ✅ SOBRESCREVER AMOUNT COM VALOR DO SERVER
    req.body.amount = priceValidation.serverAmount;

    console.log(`✅ Order price validated: R$ ${priceValidation.serverAmount.toFixed(2)}`);
    next();
  } catch (error) {
    console.error(`❌ Secure order create error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro na validação do pedido'
    });
  }
}

/**
 * 🔒 SECURE MODULE/LESSON UPDATE - Previne IDOR em módulos/aulas
 */
export async function secureContentUpdate(
  collection: 'modules' | 'lessons'
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

      const resourceId = req.params.moduleId || req.params.lessonId;

      // 🔍 VERIFICAR OWNERSHIP
      const resource = await getByIdWithOwnership(
        collection,
        resourceId,
        uid,
        {
          ownerField: 'ownerId',
          allowAdmin: true,
          isAdmin
        }
      );

      if (!resource) {
        console.warn(`🚨 IDOR ATTEMPT: User ${uid} tried to update ${collection}/${resourceId}`);
        return res.status(404).json({
          success: false,
          error: 'Recurso não encontrado'
        });
      }

      // 🚫 DENY DANGEROUS FIELDS
      req.body = denyClientFields(req.body, [
        'ownerId',
        'userId',
        'tenantId',
        'createdAt',
        'updatedAt'
      ]);

      console.log(`✅ ${collection} update authorized for user ${uid}`);
      next();
    } catch (error) {
      console.error(`❌ Secure content update error:`, error);
      return res.status(500).json({
        success: false,
        error: 'Erro de segurança'
      });
    }
  };
}

/**
 * 🔒 SECURE WITHDRAWAL - Previne manipulação de saques
 */
export async function secureWithdrawal(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const uid = req.authUser?.uid || req.user?.uid;

    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Autenticação necessária'
      });
    }

    // 🚫 DENY DANGEROUS FIELDS
    req.body = denyClientFields(req.body, [
      'status',
      'approved',
      'processedAt',
      'approvedBy',
      'ownerId',
      'userId'
    ]);

    // 🔒 INJECT OWNER
    req.body = injectOwner(req.body, uid, {
      ownerField: 'userId'
    });

    // 💰 VALIDAR VALOR MÍNIMO
    if (req.body.amount < 10) {
      return res.status(400).json({
        success: false,
        error: 'Valor mínimo para saque é R$ 10,00'
      });
    }

    // 💰 VERIFICAR SALDO (se tiver campo balance no request)
    const db = getFirestore();
    const sellerDoc = await db.collection('sellers').doc(uid).get();
    
    if (sellerDoc.exists) {
      const seller = sellerDoc.data();
      const balance = seller?.balance || 0;

      if (req.body.amount > balance) {
        return res.status(400).json({
          success: false,
          error: 'Saldo insuficiente',
          details: {
            requested: req.body.amount,
            available: balance
          }
        });
      }
    }

    console.log(`✅ Withdrawal secured for user ${uid}, amount: R$ ${req.body.amount}`);
    next();
  } catch (error) {
    console.error(`❌ Secure withdrawal error:`, error);
    return res.status(500).json({
      success: false,
      error: 'Erro de segurança'
    });
  }
}

/**
 * 📊 ALLOWED ORIGINS - Lista de origens permitidas
 */
export function getAllowedOrigins(): string[] {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    return [
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      'https://volatuspay.com'
    ];
  }

  return [
    'https://volatuspay.com',
    'https://volatuspay.com'
  ];
}

/**
 * 📊 ALLOWED ORIGIN PATTERNS - Padrões permitidos
 */
export function getAllowedOriginPatterns(): (string | RegExp)[] {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    return [
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      /^https:\/\/.*\.replit\.app$/,
      /^https:\/\/.*\.replit\.dev$/,
      'https://volatuspay.com'
    ];
  }

  return [
    'https://volatuspay.com',
    'https://volatuspay.com'
  ];
}

/**
 * 🎯 HELPER: Get Tenant from Auth
 */
export async function getTenantFromAuthSecure(req: AuthenticatedRequest): Promise<string | null> {
  const uid = req.authUser?.uid || req.user?.uid;
  
  if (!uid) {
    return null;
  }

  // Buscar seller pelo UID
  const db = getFirestore();
  const sellerQuery = await db.collection('sellers')
    .where('userId', '==', uid)
    .limit(1)
    .get();

  if (sellerQuery.empty) {
    console.warn(`⚠️ Seller não encontrado para UID: ${uid}`);
    return null;
  }

  const seller = sellerQuery.docs[0];
  return seller.id;
}
