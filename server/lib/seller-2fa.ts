/**
 * 🔐 SELLER 2FA - AUTENTICAÇÃO DE DOIS FATORES VIA EMAIL
 * Sistema de 2FA obrigatório para contas de vendedores
 */

import { send2FACode } from './email-service';
import { getFirestore } from './firebase-admin';

interface TwoFactorSession {
  code: string;
  email: string;
  expiresAt: Date;
  attempts: number;
  verified: boolean;
  createdAt: Date;
}

const MAX_ATTEMPTS = 3;
const CODE_EXPIRY_MINUTES = 5;
const SESSION_DURATION_HOURS = 24;

/**
 * 🎲 GERAR CÓDIGO 2FA ALEATÓRIO (6 DÍGITOS)
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 📧 CRIAR E ENVIAR CÓDIGO 2FA PARA SELLER
 */
export async function createSeller2FASession(uid: string, email: string, userName?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    console.log(`🔐 [SELLER-2FA] Criando sessão 2FA para seller: ${email.substring(0, 3)}***`);

    const session: TwoFactorSession = {
      code,
      email,
      expiresAt,
      attempts: 0,
      verified: false,
      createdAt: new Date()
    };

    await db.collection('seller-2fa-sessions').doc(uid).set(session);

    const emailResult = await send2FACode(email, code, userName);

    if (!emailResult.success) {
      console.error(`❌ [SELLER-2FA] Falha ao enviar email:`, emailResult.error);
      return { success: false, error: emailResult.error || 'Falha ao enviar código por email' };
    }

    console.log(`✅ [SELLER-2FA] Código enviado para ${email.substring(0, 3)}*** - Expira em ${CODE_EXPIRY_MINUTES} minutos`);
    return { success: true };

  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao criar sessão:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}

/**
 * ✅ VERIFICAR CÓDIGO 2FA DO SELLER
 */
export async function verifySeller2FACode(uid: string, code: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    const docRef = db.collection('seller-2fa-sessions').doc(uid);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.log(`❌ [SELLER-2FA] Sessão não encontrada para UID: ${uid.substring(0, 8)}...`);
      return { success: false, error: 'Sessão 2FA não encontrada. Solicite um novo código.' };
    }

    const session = doc.data() as TwoFactorSession;

    if (session.verified) {
      console.log(`⚠️ [SELLER-2FA] Código já foi verificado anteriormente`);
      return { success: true };
    }

    const now = new Date();
    const expiresAt = session.expiresAt instanceof Date ? session.expiresAt : new Date((session.expiresAt as any)._seconds * 1000);

    if (now > expiresAt) {
      console.log(`❌ [SELLER-2FA] Código expirado`);
      await docRef.delete();
      return { success: false, error: 'Código expirado. Solicite um novo código.' };
    }

    if (session.attempts >= MAX_ATTEMPTS) {
      console.log(`❌ [SELLER-2FA] Máximo de tentativas excedido`);
      await docRef.delete();
      return { success: false, error: 'Máximo de tentativas excedido. Solicite um novo código.' };
    }

    if (session.code !== code) {
      await docRef.update({ attempts: session.attempts + 1 });
      const remaining = MAX_ATTEMPTS - session.attempts - 1;
      console.log(`❌ [SELLER-2FA] Código inválido. Tentativas restantes: ${remaining}`);
      return { success: false, error: `Código inválido. ${remaining} tentativa(s) restante(s).` };
    }

    const validUntil = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
    await docRef.update({ 
      verified: true,
      verifiedAt: new Date(),
      validUntil
    });

    console.log(`✅ [SELLER-2FA] Código verificado com sucesso! Sessão válida por ${SESSION_DURATION_HOURS}h`);
    return { success: true };

  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao verificar código:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}

/**
 * 🔍 VERIFICAR SE SELLER TEM SESSÃO 2FA VÁLIDA
 */
export async function hasValidSeller2FASession(uid: string): Promise<boolean> {
  try {
    const db = getFirestore();
    const doc = await db.collection('seller-2fa-sessions').doc(uid).get();

    if (!doc.exists) {
      return false;
    }

    const session = doc.data() as any;

    if (!session.verified) {
      return false;
    }

    const validUntil = session.validUntil instanceof Date 
      ? session.validUntil 
      : new Date((session.validUntil as any)._seconds * 1000);

    if (new Date() > validUntil) {
      console.log(`⏰ [SELLER-2FA] Sessão expirada para UID: ${uid.substring(0, 8)}...`);
      await db.collection('seller-2fa-sessions').doc(uid).delete();
      return false;
    }

    return true;

  } catch (error) {
    console.error('❌ [SELLER-2FA] Erro ao verificar sessão:', error);
    return false;
  }
}

/**
 * 🔄 REENVIAR CÓDIGO 2FA
 */
export async function resendSeller2FACode(uid: string, email: string, userName?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    
    await db.collection('seller-2fa-sessions').doc(uid).delete().catch((e) => {
      // Sessão pode não existir - ignorar erro silenciosamente
    });

    return createSeller2FASession(uid, email, userName);
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao reenviar código:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}

/**
 * 🗑️ INVALIDAR SESSÃO 2FA (LOGOUT)
 */
export async function invalidateSeller2FASession(uid: string): Promise<void> {
  try {
    const db = getFirestore();
    await db.collection('seller-2fa-sessions').doc(uid).delete();
    console.log(`🗑️ [SELLER-2FA] Sessão invalidada para UID: ${uid.substring(0, 8)}...`);
  } catch (error) {
    console.error('❌ [SELLER-2FA] Erro ao invalidar sessão:', error);
  }
}

/**
 * 🔧 VERIFICAR SE 2FA ESTÁ HABILITADO PARA O SELLER
 * Por padrão retorna FALSE (2FA desativado - usuário ativa manualmente no perfil)
 */
export async function isSeller2FAEnabled(uid: string): Promise<boolean> {
  try {
    const db = getFirestore();
    const doc = await db.collection('seller-2fa-preferences').doc(uid).get();

    if (!doc.exists) {
      // Por padrão, 2FA está DESATIVADO - seller ativa manualmente no perfil se quiser
      return false;
    }

    const data = doc.data();
    // Retorna o valor salvo (true se habilitado, false se desabilitado)
    return data?.enabled === true;
  } catch (error) {
    console.error('❌ [SELLER-2FA] Erro ao verificar preferência 2FA:', error);
    // Em caso de erro, considera desativado para não bloquear acesso
    return false;
  }
}

/**
 * 🔧 ATUALIZAR PREFERÊNCIA 2FA DO SELLER
 * IMPORTANTE: Ao reativar 2FA, invalida sessão existente para forçar nova verificação
 */
export async function setSeller2FAEnabled(uid: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    
    await db.collection('seller-2fa-preferences').doc(uid).set({
      enabled,
      updatedAt: new Date()
    }, { merge: true });

    // 🔐 SEGURANÇA: Se reativando 2FA, invalidar sessão existente para forçar nova verificação
    if (enabled) {
      await db.collection('seller-2fa-sessions').doc(uid).delete().catch((e) => {
        // Sessão pode não existir - ignorar erro silenciosamente
      });
      console.log(`🔐 [SELLER-2FA] Sessão anterior invalidada - nova verificação será exigida`);
    }

    console.log(`🔧 [SELLER-2FA] 2FA ${enabled ? 'ATIVADO' : 'DESATIVADO'} para UID: ${uid.substring(0, 8)}...`);
    return { success: true };
  } catch (error: any) {
    console.error('❌ [SELLER-2FA] Erro ao atualizar preferência 2FA:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}
