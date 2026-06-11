/**
 * 🔐 SESSION REVOCATION — INVALIDAÇÃO DE SESSÕES AO TROCAR SENHA
 * Ao mudar senha, revoga todos os refresh tokens do usuário no Firebase Auth.
 * O cliente perde acesso imediatamente e precisa fazer login novamente.
 */

import { getFirestore } from './firebase-admin';
import { getAdmin } from './firebase-admin';

/**
 * 🚫 REVOGAR TODAS AS SESSÕES DO SELLER
 * Chamado quando: senha alterada, conta suspensa, logout forçado pelo admin
 */
export async function revokeAllSessions(uid: string, reason: string = 'password_change'): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = getAdmin();
    const db = getFirestore();

    await admin.auth().revokeRefreshTokens(uid);

    const revokedAt = new Date();

    await db.collection('seller-session-revocations').doc(uid).set({
      revokedAt,
      reason,
      revokedBy: 'system',
    });

    await db.collection('sellers')
      .where('userId', '==', uid)
      .limit(1)
      .get()
      .then(snap => {
        if (!snap.empty) {
          snap.docs[0].ref.update({ passwordChangedAt: revokedAt, updatedAt: revokedAt }).catch(() => {});
        }
      });

    console.log(`🚫 [SESSION-REVOKE] Sessões revogadas para UID: ${uid.slice(0, 8)}... — motivo: ${reason}`);
    return { success: true };
  } catch (e: any) {
    console.error('❌ [SESSION-REVOKE] Erro:', e?.message);
    return { success: false, error: e.message };
  }
}

/**
 * 🔍 VERIFICAR SE TOKEN FOI EMITIDO APÓS ÚLTIMA REVOGAÇÃO
 * Retorna false se o token é anterior à última troca de senha (deve rejeitar)
 */
export async function isTokenIssuedAfterRevocation(uid: string, tokenIat: number): Promise<boolean> {
  try {
    const db = getFirestore();
    const doc = await db.collection('seller-session-revocations').doc(uid).get();
    if (!doc.exists) return true;

    const data = doc.data() as any;
    const revokedAt: Date = data.revokedAt?.toDate?.() || new Date(data.revokedAt._seconds * 1000);
    const revokedAtSeconds = Math.floor(revokedAt.getTime() / 1000);

    return tokenIat > revokedAtSeconds;
  } catch {
    return true;
  }
}
