/**
 * 🔐 ROTAS DE 2FA PARA ADMINISTRADORES
 * Endpoints para autenticação de dois fatores via email
 */

import { Router, Response } from 'express';
import { 
  createAdmin2FASession, 
  verifyAdmin2FACode, 
  hasValid2FASession,
  resendAdmin2FACode,
  invalidate2FASession
} from '../lib/admin-2fa';
import { verifyFirebaseToken, AuthenticatedRequest, requireAdmin } from '../security/firebase-auth';
import { ensureFirebaseReady, getAdmin } from '../lib/firebase-admin';

const router = Router();

/**
 * 📧 POST /api/admin/2fa/send
 * Envia código 2FA por email para admin
 */
router.post('/send', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;
    
    if (!user?.uid || !user?.email) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const userRecord = await adminSdk.auth().getUser(user.uid);
    const isAdmin = userRecord.customClaims?.admin === true || 
                   userRecord.customClaims?.superAdmin === true ||
                   (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL);

    if (!isAdmin) {
      console.log(`❌ [2FA] Tentativa de 2FA por não-admin: ${user.email}`);
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    const result = await createAdmin2FASession(user.uid, user.email);

    if (result.success) {
      const emailFailed = (result as any)._emailFailed === true;
      return res.json({ 
        success: true, 
        message: emailFailed ? 'Código gerado — verifique o console do servidor' : 'Código enviado por email',
        emailFailed,
        expiresIn: 300
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao enviar código:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * ✅ POST /api/admin/2fa/verify
 * Verifica código 2FA
 */
router.post('/verify', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;
    const { code } = req.body;

    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    if (!code || typeof code !== 'string' || code.length !== 6) {
      return res.status(400).json({ error: 'Código inválido. Deve conter 6 dígitos.' });
    }

    const result = await verifyAdmin2FACode(user.uid, code);

    if (result.success) {
      return res.json({ 
        success: true, 
        message: 'Código verificado com sucesso',
        verified: true
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao verificar código:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * 🔄 POST /api/admin/2fa/resend
 * Reenvia código 2FA
 */
router.post('/resend', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;

    if (!user?.uid || !user?.email) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    await ensureFirebaseReady();
    const adminSdk = getAdmin();
    const userRecord = await adminSdk.auth().getUser(user.uid);
    const isAdmin = userRecord.customClaims?.admin === true || 
                   userRecord.customClaims?.superAdmin === true ||
                   (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL);

    if (!isAdmin) {
      console.log(`❌ [2FA] Tentativa de reenvio 2FA por não-admin: ${user.email}`);
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    const result = await resendAdmin2FACode(user.uid, user.email);

    if (result.success) {
      const emailFailed = (result as any)._emailFailed === true;
      return res.json({ 
        success: true, 
        message: emailFailed ? 'Código gerado — verifique o console do servidor' : 'Novo código enviado por email',
        emailFailed
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao reenviar código:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * 🔍 GET /api/admin/2fa/status
 * Verifica status da sessão 2FA
 */
router.get('/status', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;

    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // 🔒 2FA TEMPORARIAMENTE DESATIVADO
    return res.json({
      isAdmin: true,
      requires2FA: false,
      verified: true
    });

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao verificar status:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * 🗑️ POST /api/admin/2fa/logout
 * Invalida sessão 2FA (logout)
 */
router.post('/logout', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;

    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    await invalidate2FASession(user.uid);

    return res.json({ 
      success: true, 
      message: 'Sessão 2FA encerrada' 
    });

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao fazer logout:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
