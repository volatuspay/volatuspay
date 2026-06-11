/**
 * 🔐 ROTAS 2FA PARA SELLERS
 * Endpoints para verificação de dois fatores de vendedores
 */

import { Router } from 'express';
import { verifyFirebaseToken, AuthenticatedRequest } from '../security/firebase-auth';
import { 
  createSeller2FASession, 
  verifySeller2FACode, 
  hasValidSeller2FASession,
  resendSeller2FACode,
  invalidateSeller2FASession,
  isSeller2FAEnabled,
  setSeller2FAEnabled
} from '../lib/seller-2fa';

const router = Router();

/**
 * 📧 INICIAR 2FA - ENVIAR CÓDIGO POR EMAIL
 */
router.post('/send', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.authUser || req.user;
    if (!user?.uid || !user?.email) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    console.log(`🔐 [SELLER-2FA] Iniciando 2FA para: ${user.email.substring(0, 3)}***`);

    const result = await createSeller2FASession(user.uid, user.email);

    if (result.success) {
      res.json({ success: true, message: 'Código enviado para seu email' });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao enviar código:', error);
    res.status(500).json({ error: 'Erro interno ao enviar código' });
  }
});

/**
 * ✅ VERIFICAR CÓDIGO 2FA
 */
router.post('/verify', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.authUser || req.user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const { code } = req.body;
    if (!code || typeof code !== 'string' || code.length !== 6) {
      return res.status(400).json({ error: 'Código inválido. Deve ter 6 dígitos.' });
    }

    const result = await verifySeller2FACode(user.uid, code);

    if (result.success) {
      res.json({ success: true, message: 'Código verificado com sucesso' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao verificar código:', error);
    res.status(500).json({ error: 'Erro interno ao verificar código' });
  }
});

/**
 * 🔍 VERIFICAR STATUS DA SESSÃO 2FA
 */
router.get('/status', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.authUser || req.user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Verificar se 2FA está habilitado para este seller
    const is2FAEnabled = await isSeller2FAEnabled(user.uid);
    
    // Se 2FA está desabilitado, não requer verificação
    if (!is2FAEnabled) {
      return res.json({ 
        verified: true,
        requiresVerification: false,
        twoFactorEnabled: false
      });
    }

    const isValid = await hasValidSeller2FASession(user.uid);

    res.json({ 
      verified: isValid,
      requiresVerification: !isValid,
      twoFactorEnabled: true
    });
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao verificar status:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/**
 * 🔄 REENVIAR CÓDIGO 2FA
 */
router.post('/resend', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.authUser || req.user;
    if (!user?.uid || !user?.email) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const result = await resendSeller2FACode(user.uid, user.email);

    if (result.success) {
      res.json({ success: true, message: 'Novo código enviado para seu email' });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao reenviar código:', error);
    res.status(500).json({ error: 'Erro interno ao reenviar código' });
  }
});

/**
 * 🗑️ LOGOUT 2FA (INVALIDAR SESSÃO)
 */
router.post('/logout', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.authUser || req.user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    await invalidateSeller2FASession(user.uid);

    res.json({ success: true, message: 'Sessão 2FA encerrada' });
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao fazer logout:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/**
 * 🔧 OBTER PREFERÊNCIA 2FA DO SELLER
 */
router.get('/preference', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.authUser || req.user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const enabled = await isSeller2FAEnabled(user.uid);

    res.json({ enabled });
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao obter preferência:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/**
 * 🔧 ATUALIZAR PREFERÊNCIA 2FA DO SELLER
 */
router.patch('/preference', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.authUser || req.user;
    if (!user?.uid) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Campo "enabled" deve ser boolean' });
    }

    const result = await setSeller2FAEnabled(user.uid, enabled);

    if (result.success) {
      res.json({ success: true, enabled });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao atualizar preferência:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

export default router;
