/**
 * 🔐 SELLER TOTP — AUTENTICAÇÃO GOOGLE AUTHENTICATOR
 * TOTP (Time-based One-Time Password) via otplib v13 + QR code para sellers
 */

import { generateSecret as otpGenerateSecret, verify as otpVerify, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { getFirestore } from './firebase-admin.js';

const APP_NAME = 'VolatusPay';
const PENDING_EXPIRY_MINUTES = 10;
const BACKUP_CODE_COUNT = 8;

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () =>
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
}

/**
 * 🎲 INICIAR SETUP TOTP — gera secret + QR code para o app autenticador
 */
export async function generateTOTPSetup(uid: string, email: string): Promise<{
  secret: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
}> {
  const db = getFirestore();
  const secret = otpGenerateSecret();
  const otpauth = generateURI({ issuer: APP_NAME, label: email, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth, { width: 240, margin: 2 });
  const backupCodes = generateBackupCodes();

  await db.collection('seller-totp-pending').doc(uid).set({
    secret,
    backupCodes: backupCodes.map(c => ({ code: c, used: false })),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + PENDING_EXPIRY_MINUTES * 60 * 1000),
  });

  console.log(`🔐 [TOTP] Setup iniciado para UID: ${uid.slice(0, 8)}...`);
  return { secret, qrCodeDataUrl, backupCodes };
}

/**
 * ✅ CONFIRMAR SETUP TOTP — seller escaneia QR e digita primeiro código
 */
export async function confirmTOTPSetup(uid: string, code: string): Promise<{ success: boolean; error?: string }> {
  const db = getFirestore();
  const pendingDoc = await db.collection('seller-totp-pending').doc(uid).get();

  if (!pendingDoc.exists) {
    return { success: false, error: 'Setup não iniciado. Gere um novo QR code.' };
  }

  const pending = pendingDoc.data() as any;
  const expiresAt = pending.expiresAt?.toDate?.() || new Date(pending.expiresAt._seconds * 1000);

  if (new Date() > expiresAt) {
    await pendingDoc.ref.delete();
    return { success: false, error: 'QR code expirado. Reinicie o processo.' };
  }

  const isValid = otpVerify({ token: code, secret: pending.secret });
  if (!isValid) {
    return { success: false, error: 'Código inválido. Verifique o app autenticador.' };
  }

  await db.collection('seller-totp').doc(uid).set({
    secret: pending.secret,
    backupCodes: pending.backupCodes,
    enabledAt: new Date(),
  });
  await pendingDoc.ref.delete();

  console.log(`✅ [TOTP] Ativado com sucesso para UID: ${uid.slice(0, 8)}...`);
  return { success: true };
}

/**
 * 🔍 VERIFICAR CÓDIGO TOTP (6 dígitos) ou CÓDIGO DE BACKUP (alfanumérico)
 */
export async function verifyTOTPCode(uid: string, code: string): Promise<{ success: boolean; error?: string }> {
  const db = getFirestore();
  const totpDoc = await db.collection('seller-totp').doc(uid).get();

  if (!totpDoc.exists) {
    return { success: false, error: 'TOTP não configurado.' };
  }

  const totp = totpDoc.data() as any;
  const cleanCode = code.trim();

  const isValid = otpVerify({ token: cleanCode, secret: totp.secret });
  if (isValid) {
    return { success: true };
  }

  const backupCodes: { code: string; used: boolean; usedAt?: Date }[] = totp.backupCodes || [];
  const backupIndex = backupCodes.findIndex(b => b.code === cleanCode.toUpperCase() && !b.used);

  if (backupIndex >= 0) {
    backupCodes[backupIndex] = { ...backupCodes[backupIndex], used: true, usedAt: new Date() };
    await totpDoc.ref.update({ backupCodes });
    console.log(`🔑 [TOTP] Código de backup usado para UID: ${uid.slice(0, 8)}...`);
    return { success: true };
  }

  return { success: false, error: 'Código inválido.' };
}

/**
 * 🔍 VERIFICAR SE TOTP ESTÁ ATIVO
 */
export async function isTOTPEnabled(uid: string): Promise<boolean> {
  try {
    const db = getFirestore();
    const doc = await db.collection('seller-totp').doc(uid).get();
    return doc.exists;
  } catch {
    return false;
  }
}

/**
 * 🗑️ DESATIVAR TOTP
 */
export async function disableTOTP(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestore();
    await db.collection('seller-totp').doc(uid).delete();
    await db.collection('seller-totp-pending').doc(uid).delete().catch(() => {});
    console.log(`🗑️ [TOTP] Desativado para UID: ${uid.slice(0, 8)}...`);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * 🔄 REGENERAR CÓDIGOS DE BACKUP
 */
export async function regenerateTOTPBackupCodes(uid: string): Promise<{ success: boolean; backupCodes?: string[]; error?: string }> {
  try {
    const db = getFirestore();
    const doc = await db.collection('seller-totp').doc(uid).get();
    if (!doc.exists) return { success: false, error: 'TOTP não ativado.' };

    const newCodes = generateBackupCodes();
    await doc.ref.update({
      backupCodes: newCodes.map(c => ({ code: c, used: false })),
      backupCodesRegeneratedAt: new Date(),
    });

    return { success: true, backupCodes: newCodes };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
