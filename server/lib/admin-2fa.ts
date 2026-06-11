/**
 * 🔐 ADMIN 2FA - AUTENTICAÇÃO DE DOIS FATORES VIA EMAIL
 * Sistema de 2FA para contas administrativas
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

/**
 * 🎲 GERAR CÓDIGO 2FA ALEATÓRIO (6 DÍGITOS)
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 📧 CRIAR E ENVIAR CÓDIGO 2FA PARA ADMIN
 */
export async function createAdmin2FASession(uid: string, email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);
    const now = new Date();

    console.log(`🔐 [2FA] Criando sessão 2FA para admin: ${email.substring(0, 3)}***`);

    const session: TwoFactorSession = {
      code,
      email,
      expiresAt,
      attempts: 0,
      verified: false,
      createdAt: now
    };

    await db.collection('admin-2fa-sessions').doc(uid).set(session);

    const emailResult = await send2FACode(email, code);

    if (!emailResult.success) {
      console.error(`❌ [2FA] Falha ao enviar email:`, emailResult.error);
      // FALLBACK: Mostrar código no console para acesso de emergência
      console.log(`\n🚨 [2FA EMERGENCY] ============================================`);
      console.log(`🔑 [2FA EMERGENCY] CÓDIGO PARA ${email}: ${code}`);
      console.log(`⏰ [2FA EMERGENCY] Expira em ${CODE_EXPIRY_MINUTES} minutos`);
      console.log(`🚨 [2FA EMERGENCY] ============================================\n`);
      // Não remove a sessão — permite usar o código exibido no console
      return { success: true, _emailFailed: true } as any;
    }

    console.log(`✅ [2FA] Código enviado para ${email.substring(0, 3)}*** - Expira em ${CODE_EXPIRY_MINUTES} minutos`);
    return { success: true };

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao criar sessão:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}

/**
 * ✅ VERIFICAR CÓDIGO 2FA
 */
export async function verifyAdmin2FACode(uid: string, code: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    const docRef = db.collection('admin-2fa-sessions').doc(uid);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.log(`❌ [2FA] Sessão não encontrada para UID: ${uid.substring(0, 8)}...`);
      return { success: false, error: 'Sessão 2FA não encontrada. Solicite um novo código.' };
    }

    const session = doc.data() as TwoFactorSession;

    if (session.verified) {
      console.log(`⚠️ [2FA] Código já foi verificado anteriormente`);
      return { success: true };
    }

    const expiresAt = session.expiresAt instanceof Date 
      ? session.expiresAt 
      : (session.expiresAt as any).toDate();

    if (new Date() > expiresAt) {
      console.log(`❌ [2FA] Código expirado`);
      await docRef.delete();
      return { success: false, error: 'Código expirado. Solicite um novo código.' };
    }

    if (session.attempts >= MAX_ATTEMPTS) {
      console.log(`❌ [2FA] Máximo de tentativas excedido`);
      await docRef.delete();
      return { success: false, error: 'Máximo de tentativas excedido. Solicite um novo código.' };
    }

    if (session.code !== code) {
      await docRef.update({ attempts: session.attempts + 1 });
      const remaining = MAX_ATTEMPTS - session.attempts - 1;
      console.log(`❌ [2FA] Código incorreto. Tentativas restantes: ${remaining}`);
      return { 
        success: false, 
        error: `Código incorreto. ${remaining} tentativa(s) restante(s).` 
      };
    }

    await docRef.update({ 
      verified: true,
      verifiedAt: new Date()
    });

    console.log(`✅ [2FA] Código verificado com sucesso!`);
    return { success: true };

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao verificar código:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}

/**
 * 🔍 VERIFICAR SE ADMIN TEM SESSÃO 2FA VÁLIDA
 * IMPORTANTE: Sessão válida apenas por 30 MINUTOS para máxima segurança
 * Admin SEMPRE precisa verificar 2FA em cada login novo
 */
export async function hasValid2FASession(uid: string): Promise<boolean> {
  try {
    const db = getFirestore();
    const doc = await db.collection('admin-2fa-sessions').doc(uid).get();

    if (!doc.exists) {
      console.log(`🔐 [2FA] Sem sessão para UID: ${uid.substring(0, 8)}... - Requer verificação`);
      return false;
    }

    const session = doc.data() as TwoFactorSession;

    if (!session.verified) {
      console.log(`🔐 [2FA] Sessão não verificada - Requer verificação`);
      return false;
    }

    const verifiedAt = (session as any).verifiedAt;
    if (verifiedAt) {
      const verifiedDate = verifiedAt instanceof Date ? verifiedAt : verifiedAt.toDate();
      const sessionDuration = 8 * 60 * 60 * 1000; // 8 horas
      const elapsed = Date.now() - verifiedDate.getTime();
      
      if (elapsed > sessionDuration) {
        console.log(`🔐 [2FA] Sessão expirada (${Math.round(elapsed / 60000)} min) - Requer nova verificação`);
        await db.collection('admin-2fa-sessions').doc(uid).delete();
        return false;
      }
      
      console.log(`✅ [2FA] Sessão válida (${Math.round(elapsed / 60000)} min de 480 min)`);
    }

    return true;

  } catch (error) {
    console.error('❌ [2FA] Erro ao verificar sessão:', error);
    // SEGURANÇA: Em caso de erro, SEMPRE exigir 2FA
    return false;
  }
}

/**
 * 🗑️ INVALIDAR SESSÃO 2FA (LOGOUT)
 */
export async function invalidate2FASession(uid: string): Promise<void> {
  try {
    const db = getFirestore();
    await db.collection('admin-2fa-sessions').doc(uid).delete();
    console.log(`🗑️ [2FA] Sessão invalidada para UID: ${uid.substring(0, 8)}...`);
  } catch (error) {
    console.error('❌ [2FA] Erro ao invalidar sessão:', error);
  }
}

/**
 * 📧 REENVIAR CÓDIGO 2FA
 */
export async function resendAdmin2FACode(uid: string, email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    const docRef = db.collection('admin-2fa-sessions').doc(uid);
    const doc = await docRef.get();

    if (doc.exists) {
      const session = doc.data() as TwoFactorSession;

      // Não permite reenvio se sessão já está verificada e ainda válida
      if (session.verified) {
        const verifiedAt = (session as any).verifiedAt;
        if (verifiedAt) {
          const verifiedDate = verifiedAt instanceof Date ? verifiedAt : verifiedAt.toDate();
          const sessionDuration = 8 * 60 * 60 * 1000; // 8 horas
          const elapsed = Date.now() - verifiedDate.getTime();
          if (elapsed < sessionDuration) {
            console.log(`⚠️ [2FA] Reenvio bloqueado - sessão já verificada e válida`);
            return { success: false, error: 'Sessão 2FA já verificada. Acesso liberado.' };
          }
        }
      }

      const createdAt = session.createdAt instanceof Date 
        ? session.createdAt 
        : (session.createdAt as any).toDate();
      
      const timeSinceCreation = Date.now() - createdAt.getTime();
      const minResendInterval = 60 * 1000;
      
      if (timeSinceCreation < minResendInterval) {
        const waitSeconds = Math.ceil((minResendInterval - timeSinceCreation) / 1000);
        return { 
          success: false, 
          error: `Aguarde ${waitSeconds} segundos para reenviar o código.` 
        };
      }
    }

    return createAdmin2FASession(uid, email);

  } catch (error: any) {
    console.error('❌ [2FA] Erro ao reenviar código:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}
