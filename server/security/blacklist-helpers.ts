/**
 * 🛡️ HELPERS PARA BLACKLIST COM SUPORTE A FINGERPRINT
 * Funções auxiliares para adicionar dispositivos à blacklist
 * ✨ PRIORIZA FINGERPRINT sobre IP para bloqueio preciso
 */

import { Request } from 'express';
import { persistentBlacklist } from './persistent-ip-blacklist';

/**
 * 🎯 ADICIONAR DISPOSITIVO À BLACKLIST (USA FINGERPRINT SE DISPONÍVEL)
 * Bloqueia apenas o dispositivo específico, não a rede inteira
 */
export async function addDeviceToBlacklist(
  req: Request,
  reason: string,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  expiresInMs?: number,
  endpoint?: string
): Promise<boolean> {
  // 🔐 PRIORIZAR FINGERPRINT (dispositivo único) sobre IP (rede inteira)
  const deviceFingerprint = (req as any).deviceFingerprint;
  const realIP = (req as any).realIP || req.ip || '127.0.0.1';
  const userAgent = req.headers['user-agent'];
  
  // Se tem fingerprint, usa ele. Senão, fallback para IP (compatibilidade)
  const identifier = deviceFingerprint || realIP;
  
  const result = await persistentBlacklist.addToBlacklist(
    identifier,
    reason,
    severity,
    expiresInMs,
    endpoint,
    userAgent
  );
  
  // Log para debug
  if (deviceFingerprint) {
    console.log(`🎯 Dispositivo adicionado à blacklist via FINGERPRINT: ${deviceFingerprint}`);
  } else {
    console.log(`⚠️ Dispositivo adicionado à blacklist via IP (sem fingerprint): ${realIP}`);
  }
  
  return result;
}

/**
 * 🔍 PEGAR IDENTIFICADOR DO DISPOSITIVO (FINGERPRINT ou IP)
 */
export function getDeviceIdentifier(req: Request): string {
  const deviceFingerprint = (req as any).deviceFingerprint;
  const realIP = (req as any).realIP || req.ip || '127.0.0.1';
  
  return deviceFingerprint || realIP;
}
