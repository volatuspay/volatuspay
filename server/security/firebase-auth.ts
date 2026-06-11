// 🔐 MIDDLEWARE DE AUTENTICAÇÃO FIREBASE
// Sistema completo de verificação de tokens e custom claims

import { Request, Response, NextFunction } from 'express';
import { ensureFirebaseReady, getAdmin } from '../lib/firebase-admin';
import { neonQuery } from '../lib/neon-db.js';

// ✅ FIREBASE INICIALIZAÇÃO REMOVIDA DAQUI - AGORA USA SINGLETON CENTRALIZADO
// O singleton em server/lib/firebase-admin.ts gerencia toda a inicialização Firebase
// Middlewares de autenticação abaixo usam o Firebase Admin já inicializado

// 🎯 INTERFACE PARA DADOS DO USUÁRIO AUTENTICADO
export interface AuthUser {
  uid: string;
  email?: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  adminLevel?: string;
  customClaims?: any;
  browserId?: string;
}

// 🎯 INTERFACE PARA REQUEST AUTENTICADA
export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  user?: {
    uid: string;
    email: string;
    email_verified: boolean;
    isAdmin?: boolean;
    customClaims?: any; // 🔒 CRITICAL: Necessário para checks de segurança (req.user.customClaims?.admin)
  };
}

// 🔐 MIDDLEWARE: VERIFICAR TOKEN FIREBASE
export const verifyFirebaseToken = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) => {
  try {
    console.log('🔑 Verificando autenticação Firebase...');
    
    // 🔥 GARANTIR QUE FIREBASE ESTEJA PRONTO
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    
    // 📋 EXTRAIR TOKEN DO HEADER AUTHORIZATION
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Token de autenticação ausente');
      return res.status(401).json({ 
        error: 'Token de autenticação requerido',
        code: 'NO_TOKEN'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // 🔍 VERIFICAR TOKEN COM FIREBASE ADMIN SDK
    const decodedToken = await adminSdk.auth().verifyIdToken(idToken);
    
    // 🔐 VERIFICAR CUSTOM CLAIMS PARA ADMIN
    const userRecord = await adminSdk.auth().getUser(decodedToken.uid);
    const isAdmin = userRecord.customClaims?.admin === true || userRecord.customClaims?.superAdmin === true;
    const isSuperAdmin = userRecord.customClaims?.superAdmin === true;
    const adminLevel = userRecord.customClaims?.adminLevel || (isAdmin ? 'admin' : null);
    
    // 🔐 OFUSCAR EMAIL NO LOG (SEGURANÇA)
    const emailDisplay = decodedToken.email ? decodedToken.email.substring(0, 1) + '***' + decodedToken.email.substring(decodedToken.email.indexOf('@')) : decodedToken.uid;
    console.log('✅ Token válido para usuário:', emailDisplay, isAdmin ? '(ADMIN)' : '');
    
    // 💾 ADICIONAR DADOS DO USUÁRIO AO REQUEST (COMPATIBILIDADE)
    req.authUser = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      isAdmin,
      isSuperAdmin,
      adminLevel,
      customClaims: decodedToken
    };
    
    // 🔄 COMPATIBILIDADE: Também setar req.user para compatibilidade com authMiddleware
    (req as any).user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      email_verified: decodedToken.email_verified,
      isAdmin, // Adicionar isAdmin aqui também
      customClaims: userRecord.customClaims || {} // 🔒 CRITICAL: Adicionar customClaims para checks de segurança
    };

    // 🛡️ RASTREAMENTO DE SEGURANÇA EM TEMPO REAL (ASSÍNCRONO - NÃO BLOQUEIA)
    // ⚡ ATUALIZA IP DE LOGIN PARA TODOS OS SELLERS (INCLUINDO SELLERS ADMINS!)
    const currentIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
                     req.headers['x-real-ip'] as string || 
                     req.connection?.remoteAddress || 
                     req.socket?.remoteAddress || 
                     req.ip || 
                     'unknown';
    
    const userAgent = req.headers['user-agent'] || 'unknown';
    const deviceType = userAgent.includes('Mobile') ? 'Mobile' : 
                      userAgent.includes('Tablet') ? 'Tablet' : 'Desktop';
    
    // 🔐 BROWSER SESSION VALIDATION - OBRIGATÓRIO
    let requestBrowserId = req.headers['x-browser-id'] as string;
    
    // 🚨 CRITICAL: browserId é OBRIGATÓRIO para todas requisições autenticadas
    if (!requestBrowserId) {
      console.log('⚠️ Browser ID ausente - gerando automaticamente');
      // AUTO-CORREÇÃO: Gerar browserId temporário se ausente (evita bloqueio total)
      const tempBrowserId = `temp_${decodedToken.uid.substring(0, 8)}_${Date.now()}`;
      req.headers['x-browser-id'] = tempBrowserId;
      requestBrowserId = tempBrowserId; // ✅ ATUALIZAR VARIÁVEL LOCAL
      console.log(`📝 Browser ID temporário gerado: ${tempBrowserId.substring(0, 20)}...`);
    }
    
    // 🔄 AUTO-CORREÇÃO DE BROWSER SESSION (NÃO-BLOQUEANTE)
    // Verificar e sincronizar browserId de forma assíncrona (não trava a requisição)
    adminSdk.firestore()
      .collection('sellers')
      .where('userId', '==', decodedToken.uid)
      .limit(1)
      .get()
      .then(sellerSnapshot => {
        if (!sellerSnapshot.empty) {
          const sellerDoc = sellerSnapshot.docs[0];
          const sellerData = sellerDoc.data();
          const storedBrowserId = sellerData.browserId;
          
          if (storedBrowserId && storedBrowserId !== requestBrowserId) {
            const storedPreview = storedBrowserId ? storedBrowserId.substring(0, 8) : 'undefined';
            const requestPreview = requestBrowserId ? requestBrowserId.substring(0, 8) : 'undefined';
            console.log(`🔄 AUTO-CORREÇÃO: Sincronizando novo browserId (${storedPreview}... → ${requestPreview}...)`);
            
            return sellerDoc.ref.update({
              browserId: requestBrowserId,
              lastBrowserUpdate: new Date(),
              updatedAt: new Date()
            }).then(() => {
              console.log('✅ Browser session sincronizada');
            });
          } else if (!storedBrowserId) {
            const requestPreview = requestBrowserId ? requestBrowserId.substring(0, 8) : 'undefined';
            console.log(`📝 Registrando browserId inicial: ${requestPreview}...`);
            return sellerDoc.ref.update({
              browserId: requestBrowserId,
              lastBrowserUpdate: new Date(),
              updatedAt: new Date()
            });
          }
        }
      })
      .catch(err => console.error('⚠️ Erro ao sincronizar browser session:', err));
    
    // 🔥 ATUALIZAR FIRESTORE DE FORMA ASSÍNCRONA (NÃO ESPERAR)
    // ✅ FUNCIONA PARA TODOS OS SELLERS, MESMO QUE SEJAM ADMINS
    adminSdk.firestore().collection('sellers')
      .where('userId', '==', decodedToken.uid)
      .limit(1)
      .get()
      .then(async snapshot => {
        if (!snapshot.empty) {
          const sellerDoc = snapshot.docs[0];
          const data = sellerDoc.data();
          
          // ✅ OTIMIZAÇÃO: Logar apenas quando IP realmente mudar
          if (data.lastLoginIP !== currentIP) {
            console.log(`📍 IP ATUALIZADO EM TEMPO REAL: ${decodedToken.email} → ${currentIP} (${deviceType})`);

            // 🔔 NOTIFICAÇÃO DE NOVO DISPOSITIVO (assíncrono, não bloqueia)
            import('../lib/login-monitor.js').then(({ checkAndNotifyNewDevice }) => {
              checkAndNotifyNewDevice({
                uid: decodedToken.uid,
                email: decodedToken.email || '',
                name: data.name || data.businessName || undefined,
                ip: currentIP,
                userAgent,
                deviceType,
              }).catch(() => {});
            }).catch(() => {});
          }
          
          return sellerDoc.ref.update({
            lastLoginIP: currentIP,
            lastLoginAt: new Date(),
            lastLoginDevice: deviceType,
            updatedAt: new Date()
          });
        }
      })
      .catch(err => console.error('⚠️ Erro ao atualizar IP de login:', err));

    // 📱 REGISTRAR SESSÃO (não bloqueia)
    import('../lib/user-sessions.js').then(({ registerOrUpdateSession }) => {
      registerOrUpdateSession(decodedToken.uid, requestBrowserId, currentIP, userAgent as string).catch(() => {});
    }).catch(() => {});

    next();
  } catch (error: any) {
    console.error('❌ Erro na verificação do token:', error?.message || error?.code || error);
    
    // 📋 CATEGORIZAR TIPOS DE ERRO
    if (error?.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        error: 'Token expirado. Faça login novamente.',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error?.code === 'auth/argument-error') {
      return res.status(401).json({ 
        error: 'Token inválido',
        code: 'INVALID_TOKEN'
      });
    }
    
    // 🔐 SECURITY: Firebase Admin não disponível → REJEITAR (nunca fazer fail-open em auth)
    if (!getAdmin() || error?.message?.includes('Cannot read') || error?.message?.includes('null')) {
      console.error('🚨 [AUTH] Firebase Admin não disponível - requisição BLOQUEADA por segurança');
      return res.status(503).json({
        error: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    return res.status(401).json({ 
      error: 'Erro de autenticação',
      code: 'AUTH_ERROR',
      details: error?.message || 'Erro desconhecido'
    });
  }
};

// 👑 MIDDLEWARE: VERIFICAR PERMISSÕES ADMIN
export const requireAdmin = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ 
        error: 'Usuário não autenticado',
        code: 'NOT_AUTHENTICATED'
      });
    }

    console.log('🔍 Verificando permissões admin para:', req.authUser.email);
    
    // ✅ VERIFICAR ADMIN VIA EMAIL (PRIMEIRO - MAIS RÁPIDO)
    const _adminEmail = process.env.ADMIN_EMAIL || '';
    if (_adminEmail && req.authUser.email === _adminEmail) {
      console.log('✅ Acesso admin concedido via EMAIL:', req.authUser.email);
      req.authUser.isAdmin = true;
      req.authUser.isSuperAdmin = true;
      req.authUser.adminLevel = 'superadmin';
      return next();
    }
    
    // 🔥 GARANTIR QUE FIREBASE ESTEJA PRONTO
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    
    // 🔐 VERIFICAR CUSTOM CLAIMS (FALLBACK)
    const userRecord = await adminSdk.auth().getUser(req.authUser.uid);
    if (userRecord.customClaims?.admin === true || userRecord.customClaims?.superAdmin === true) {
      console.log('✅ Acesso admin concedido via Custom Claims:', req.authUser.email, `(nível: ${userRecord.customClaims.adminLevel || 'admin'})`);
      req.authUser.isAdmin = true;
      req.authUser.isSuperAdmin = userRecord.customClaims?.superAdmin === true;
      req.authUser.adminLevel = userRecord.customClaims.adminLevel || 'admin';
      return next();
    }

    console.log('❌ Acesso admin negado para:', req.authUser.email, '- UID:', req.authUser.uid);
    console.log('💡 Dica: Configure Custom Claims via endpoint /api/admin/grant-access');
    return res.status(403).json({ 
      error: 'Acesso negado. Apenas administradores podem acessar esta funcionalidade.',
      code: 'INSUFFICIENT_PERMISSIONS',
      hint: 'Entre em contato com o suporte para solicitar acesso admin'
    });

  } catch (error) {
    console.error('❌ Erro na verificação de permissões admin:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      code: 'INTERNAL_ERROR'
    });
  }
};

// 🛡️ MIDDLEWARE: VERIFICAR PERMISSÃO ESPECÍFICA BASEADA EM ROLE
// Verifica se o usuário possui uma determinada permissão baseado no seu cargo
export const requirePermission = (permission: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.authUser) {
        return res.status(401).json({ 
          error: 'Usuário não autenticado',
          code: 'NOT_AUTHENTICATED'
        });
      }

      // 👑 CEO Fundador tem todas as permissões
      const { CEO_FOUNDER_EMAIL, DEFAULT_ROLE_PERMISSIONS } = await import('../../shared/roles.js');
      
      const _adminEmailFallback = process.env.ADMIN_EMAIL || '';
      if (req.authUser.email === CEO_FOUNDER_EMAIL || (_adminEmailFallback && req.authUser.email === _adminEmailFallback)) {
        return next();
      }

      // 🔥 Buscar role do usuário no Firestore
      await ensureFirebaseReady();
      const adminSdk = getAdmin();
      const db = adminSdk.firestore();
      
      const memberSnapshot = await db.collection('teamMembers')
        .where('userId', '==', req.authUser.uid)
        .limit(1)
        .get();
      
      if (memberSnapshot.empty) {
        // Se não é membro da equipe mas é admin, permitir acesso básico
        const userRecord = await adminSdk.auth().getUser(req.authUser.uid);
        if (userRecord.customClaims?.admin === true) {
          return next(); // Admins legados têm acesso total por enquanto
        }
        
        return res.status(403).json({ 
          error: 'Permissão negada. Você não tem o cargo necessário.',
          code: 'PERMISSION_DENIED',
          requiredPermission: permission
        });
      }
      
      const memberData = memberSnapshot.docs[0].data();
      const userRole = memberData.role;
      const userPermissions = memberData.permissions || DEFAULT_ROLE_PERMISSIONS[userRole] || [];
      
      // ✅ Verificar se tem a permissão necessária
      if (userPermissions.includes(permission)) {
        return next();
      }
      
      console.log(`❌ Permissão negada para ${req.authUser.email}: requer ${permission}, tem: ${userPermissions.join(', ')}`);
      return res.status(403).json({ 
        error: 'Permissão negada. Você não tem acesso a esta funcionalidade.',
        code: 'PERMISSION_DENIED',
        requiredPermission: permission
      });
      
    } catch (error) {
      console.error('❌ Erro na verificação de permissões:', error);
      return res.status(500).json({ 
        error: 'Erro interno do servidor',
        code: 'INTERNAL_ERROR'
      });
    }
  };
};

// 🔐 MIDDLEWARE: EXIGIR 2FA VERIFICADO PARA AÇÕES ADMIN SENSÍVEIS
// BLINDAGEM TOTAL: Mesmo com token admin válido, precisa ter 2FA verificado
export const require2FAVerified = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) => {
  try {
    if (!req.authUser?.uid) {
      return res.status(401).json({ 
        error: 'Usuário não autenticado',
        code: 'NOT_AUTHENTICATED'
      });
    }

    // 🔐 IMPORTAR DINAMICAMENTE PARA EVITAR CIRCULAR DEPENDENCY
    const { hasValid2FASession } = await import('../lib/admin-2fa.js');
    
    const has2FA = await hasValid2FASession(req.authUser.uid);
    
    if (!has2FA) {
      console.log(`🚫 [2FA-REQUIRED] Admin ${req.authUser.email} tentou ação sem 2FA verificado`);
      return res.status(403).json({ 
        error: '2FA obrigatório. Valide seu código de segurança antes de continuar.',
        code: '2FA_REQUIRED',
        require2FA: true
      });
    }

    console.log(`✅ [2FA-OK] Admin ${req.authUser.email} tem 2FA válido - Ação permitida`);
    next();
  } catch (error: any) {
    console.error('❌ [2FA] Erro na verificação 2FA:', error);
    // SEGURANÇA: Em caso de erro, BLOQUEAR (fail-secure)
    return res.status(403).json({ 
      error: 'Erro na verificação de segurança. Tente novamente.',
      code: '2FA_ERROR'
    });
  }
};

// 📊 ENDPOINT: VERIFICAR STATUS DE AUTENTICAÇÃO
export const authStatusHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ 
        authenticated: false,
        error: 'Não autenticado'
      });
    }

    // 🔍 VERIFICAR SE É ADMIN VIA CUSTOM CLAIMS
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const userRecord = await adminSdk.auth().getUser(req.authUser.uid);
    const isAdmin = userRecord.customClaims?.admin === true || userRecord.customClaims?.superAdmin === true;

    return res.json({
      authenticated: true,
      user: {
        uid: req.authUser.uid,
        email: req.authUser.email,
        isAdmin
      }
    });
  } catch (error) {
    console.error('❌ Erro ao verificar status de auth:', error);
    return res.status(500).json({ 
      error: 'Erro interno',
      code: 'INTERNAL_ERROR'
    });
  }
};

// 🎯 SISTEMA DE CUSTOM CLAIMS - GERENCIAMENTO DINÂMICO DE PERMISSÕES

/**
 * Definir Custom Claims para um usuário
 */
export const setUserCustomClaims = async (uid: string, claims: Record<string, any>): Promise<void> => {
  try {
    console.log(`🎯 Definindo Custom Claims para UID: ${uid}`, claims);
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    await adminSdk.auth().setCustomUserClaims(uid, claims);
    console.log(`✅ Custom Claims definidas com sucesso para: ${uid}`);
  } catch (error) {
    console.error(`❌ Erro ao definir Custom Claims para ${uid}:`, error);
    throw error;
  }
};

/**
 * Tornar um usuário admin via Custom Claims
 */
export const grantAdminAccess = async (uid: string, adminLevel: string = 'admin'): Promise<void> => {
  try {
    console.log(`👑 Concedendo acesso admin para UID: ${uid} (nível: ${adminLevel})`);
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const userRecord = await adminSdk.auth().getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    
    const newClaims = {
      ...existingClaims,
      admin: true,
      adminLevel: adminLevel,
      adminGrantedAt: new Date().toISOString()
    };
    
    await setUserCustomClaims(uid, newClaims);
    console.log(`✅ Acesso admin concedido para: ${userRecord.email} (${uid})`);
  } catch (error) {
    console.error(`❌ Erro ao conceder acesso admin para ${uid}:`, error);
    throw error;
  }
};

/**
 * Remover acesso admin via Custom Claims
 */
export const revokeAdminAccess = async (uid: string): Promise<void> => {
  try {
    console.log(`👑 Removendo acesso admin para UID: ${uid}`);
    
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const userRecord = await adminSdk.auth().getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    
    const { admin, adminLevel, adminGrantedAt, ...remainingClaims } = existingClaims;
    
    const newClaims = {
      ...remainingClaims,
      adminRevokedAt: new Date().toISOString()
    };
    
    await setUserCustomClaims(uid, newClaims);
    console.log(`✅ Acesso admin removido para: ${userRecord.email} (${uid})`);
  } catch (error) {
    console.error(`❌ Erro ao remover acesso admin para ${uid}:`, error);
    throw error;
  }
};

/**
 * Verificar se usuário tem acesso admin via Custom Claims APENAS
 * 🔐 MÉTODO SEGURO - Sem UIDs hardcoded
 */
export const checkAdminAccess = async (uid: string): Promise<boolean> => {
  try {
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    
    const userRecord = await adminSdk.auth().getUser(uid);
    const isAdminByClaims = userRecord.customClaims?.admin === true || userRecord.customClaims?.superAdmin === true;
    const isAdminByEmail = process.env.ADMIN_EMAIL ? userRecord.email === process.env.ADMIN_EMAIL : false;
    const isAdmin = isAdminByClaims || isAdminByEmail;
    
    console.log(`🔍 Verificação admin para ${uid.substring(0, 8)}...: ${isAdmin ? 'SIM' : 'NÃO'} (claims=${isAdminByClaims}, email=${isAdminByEmail})`);
    return isAdmin;
  } catch (error) {
    console.error(`❌ Erro ao verificar acesso admin para ${uid}:`, error);
    return false;
  }
};

// 🔐 MIDDLEWARE: VERIFICAR SE SELLER FOI APROVADO PELO ADMIN
// 🛡️ PRODUÇÃO: Bloqueia sellers não aprovados de criar produtos/checkouts
export const requireApprovedSeller = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({
        error: 'Usuário não autenticado',
        code: 'NOT_AUTHENTICATED'
      });
    }

    // ✅ ADMINS SEMPRE APROVADOS (bypass)
    if (req.authUser.isAdmin) {
      console.log('✅ Admin bypassa verificação de aprovação:', req.authUser.email);
      return next();
    }

    console.log('🔍 Verificando aprovação de seller para:', req.authUser.email);

    const uid = req.authUser.uid;

    // 1️⃣ VERIFICAR NEON PRIMEIRO (fonte de verdade após migração)
    let neonSeller: any = null;
    await neonQuery(async (sql) => {
      const rows = await (sql as any)`
        SELECT id, status, is_approved FROM sellers WHERE id = ${uid} LIMIT 1
      `;
      if (rows[0]) neonSeller = rows[0];
    }, `requireApprovedSeller:${uid}`);

    if (neonSeller) {
      const isApprovedNeon = neonSeller.is_approved === true || neonSeller.status === 'approved';
      if (!isApprovedNeon) {
        console.log('❌ Seller não aprovado (Neon):', req.authUser.email, '- status:', neonSeller.status);
        return res.status(403).json({
          error: 'Sua conta está aguardando aprovação do administrador. Você receberá um email quando for aprovado.',
          code: 'SELLER_NOT_APPROVED',
          status: neonSeller.status || 'pending'
        });
      }
      console.log('✅ Seller aprovado (Neon):', req.authUser.email);
      return next();
    }

    // 2️⃣ FALLBACK: BUSCAR DADOS DO SELLER NO FIRESTORE (sellers antigos)
    await ensureFirebaseReady();
    const adminSdk = getAdmin();

    const sellersSnapshot = await adminSdk.firestore()
      .collection('sellers')
      .where('userId', '==', uid)
      .limit(1)
      .get();

    if (sellersSnapshot.empty) {
      // Tentar também pelo doc ID (novo formato)
      const sellerDocById = await adminSdk.firestore()
        .collection('sellers')
        .doc(uid)
        .get();

      if (!sellerDocById.exists) {
        console.log('❌ Seller não encontrado no banco:', req.authUser.email);
        return res.status(403).json({
          error: 'Seller não encontrado. Complete seu cadastro.',
          code: 'SELLER_NOT_FOUND'
        });
      }

      const sellerData = sellerDocById.data() || {};
      const isApproved = sellerData.isApproved === true || sellerData.status === 'approved';
      if (!isApproved) {
        return res.status(403).json({
          error: 'Sua conta está aguardando aprovação do administrador.',
          code: 'SELLER_NOT_APPROVED',
          status: sellerData.status || 'pending'
        });
      }
      console.log('✅ Seller aprovado (Firestore doc):', req.authUser.email);
      return next();
    }

    const sellerData = sellersSnapshot.docs[0].data();

    // 🚨 VERIFICAR SE SELLER FOI APROVADO (isApproved OU status === "approved")
    const isApproved = sellerData.isApproved === true || sellerData.status === 'approved';
    
    if (!isApproved) {
      console.log('❌ Seller não aprovado:', req.authUser.email, '- isApproved:', sellerData.isApproved, '- status:', sellerData.status);
      return res.status(403).json({
        error: 'Sua conta está aguardando aprovação do administrador. Você receberá um email quando for aprovado.',
        code: 'SELLER_NOT_APPROVED',
        status: sellerData.status || 'pending'
      });
    }

    console.log('✅ Seller aprovado:', req.authUser.email);
    next();

  } catch (error) {
    console.error('❌ Erro na verificação de aprovação de seller:', error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
      code: 'INTERNAL_ERROR'
    });
  }
};

// 👑 MIDDLEWARE: VERIFICAR PERMISSÕES SUPER ADMIN (APENAS PARA OPERAÇÕES CRÍTICAS)
export const requireSuperAdmin = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) => {
  try {
    if (!req.authUser) {
      return res.status(401).json({ 
        error: 'Usuário não autenticado',
        code: 'NOT_AUTHENTICATED'
      });
    }

    console.log('🔐 Verificando permissões SUPER ADMIN para:', req.authUser.email);
    
    // 🔥 GARANTIR QUE FIREBASE ESTEJA PRONTO
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    
    // 🎯 VERIFICAR CUSTOM CLAIMS PRIMEIRO
    const userRecord = await adminSdk.auth().getUser(req.authUser.uid);
    if (userRecord.customClaims?.admin === true && userRecord.customClaims?.adminLevel === 'super') {
      console.log('✅ Acesso SUPER ADMIN via Custom Claims para:', req.authUser.email);
      req.authUser.isAdmin = true;
      req.authUser.isSuperAdmin = true;
      req.authUser.adminLevel = 'super';
      return next();
    }

    console.log('❌ Acesso SUPER ADMIN negado para:', req.authUser.email, '- UID:', req.authUser.uid);
    console.log('💡 Dica: Configure Super Admin via: await grantAdminAccess(uid, "super")');
    return res.status(403).json({ 
      error: 'Acesso negado. Apenas SUPER ADMINISTRADORES podem executar esta operação.',
      code: 'INSUFFICIENT_SUPER_ADMIN_PERMISSIONS',
      required: 'super_admin',
      current: req.authUser.adminLevel || 'none',
      hint: 'Entre em contato com o suporte para solicitar acesso super admin'
    });

  } catch (error) {
    console.error('❌ Erro na verificação de permissões SUPER ADMIN:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      code: 'INTERNAL_ERROR'
    });
  }
};

// 🔐 MIDDLEWARE: AUTENTICAÇÃO OPCIONAL FIREBASE
// Valida token se presente, mas permite requisições sem token
export const optionalFirebaseAuth = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) => {
  try {
    // 📋 EXTRAIR TOKEN DO HEADER AUTHORIZATION
    const authHeader = req.headers.authorization;
    
    // Se não há token, continuar sem autenticação
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('ℹ️ Requisição sem autenticação - continuando...');
      return next();
    }

    // Se há token, validar normalmente
    const idToken = authHeader.split('Bearer ')[1];
    
    // 🔥 GARANTIR QUE FIREBASE ESTEJA PRONTO
    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    
    // 🔍 VERIFICAR TOKEN COM FIREBASE ADMIN SDK
    const decodedToken = await adminSdk.auth().verifyIdToken(idToken);
    
    // 🔐 VERIFICAR CUSTOM CLAIMS
    const userRecord = await adminSdk.auth().getUser(decodedToken.uid);
    const isAdmin = userRecord.customClaims?.admin === true || userRecord.customClaims?.superAdmin === true;
    const isSuperAdmin = userRecord.customClaims?.superAdmin === true;
    const adminLevel = userRecord.customClaims?.adminLevel || (isAdmin ? 'admin' : null);
    
    // 💾 ADICIONAR DADOS DO USUÁRIO AO REQUEST
    req.authUser = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      isAdmin,
      isSuperAdmin,
      adminLevel,
      customClaims: decodedToken
    };
    
    (req as any).user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      email_verified: decodedToken.email_verified,
      isAdmin,
      customClaims: userRecord.customClaims || {}
    };

    console.log('✅ Auth opcional: Token válido para', decodedToken.email?.substring(0, 3) + '***');
    next();
    
  } catch (error) {
    // 🔐 LIMPAR DADOS DE AUTH PARA EVITAR VAZAMENTO DE CONTEXTO
    delete req.authUser;
    delete (req as any).user;
    
    // Se token inválido, continuar sem autenticação
    console.log('⚠️ Auth opcional: Token inválido, continuando sem auth');
    next();
  }
};