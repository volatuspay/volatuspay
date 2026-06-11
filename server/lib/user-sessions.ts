/**
 * 📱 USER SESSIONS — Rastreamento de sessões ativas por usuário
 * Migrado para Neon PostgreSQL — sem Firestore
 */

import { neonQuery } from './neon-db.js';
import { nanoid } from 'nanoid';

export interface SessionInfo {
  sessionId: string;
  uid: string;
  browserId: string;
  ip: string;
  browser: string;
  os: string;
  device: string;
  city: string;
  region: string;
  country: string;
  locationLabel: string;
  createdAt: Date;
  lastActiveAt: Date;
}

const geoCache = new Map<string, { city: string; region: string; country: string; label: string; at: number }>();

function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  const s = ua || '';

  let browser = 'Navegador desconhecido';
  if (s.includes('Edg/') || s.includes('EdgA/')) browser = 'Edge';
  else if (s.includes('OPR/') || s.includes('Opera')) browser = 'Opera';
  else if (s.includes('SamsungBrowser')) browser = 'Samsung Browser';
  else if (s.includes('Chrome') && !s.includes('Chromium')) browser = 'Chrome';
  else if (s.includes('Firefox')) browser = 'Firefox';
  else if (s.includes('Safari') && !s.includes('Chrome')) browser = 'Safari';
  else if (s.includes('MSIE') || s.includes('Trident')) browser = 'Internet Explorer';

  let os = 'SO desconhecido';
  if (s.includes('Windows NT 10')) os = 'Windows 10/11';
  else if (s.includes('Windows NT 6.3')) os = 'Windows 8.1';
  else if (s.includes('Windows NT 6.1')) os = 'Windows 7';
  else if (s.includes('Windows')) os = 'Windows';
  else if (s.includes('Mac OS X')) os = 'macOS';
  else if (s.includes('iPhone') || s.includes('iPad')) os = 'iOS';
  else if (s.includes('Android')) os = 'Android';
  else if (s.includes('Linux')) os = 'Linux';

  let device = 'Desktop';
  if (s.includes('Mobile') || s.includes('iPhone') || s.includes('Android')) device = 'Mobile';
  else if (s.includes('Tablet') || s.includes('iPad')) device = 'Tablet';

  return { browser, os, device };
}

async function getLocationFromIP(ip: string): Promise<{ city: string; region: string; country: string; label: string }> {
  const blank = { city: '', region: '', country: '', label: 'Localização desconhecida' };

  if (!ip || ip === 'unknown' || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return { ...blank, label: 'Rede local' };
  }

  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) {
    return { city: cached.city, region: cached.region, country: cached.country, label: cached.label };
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,countryCode,status&lang=pt-BR`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return blank;
    const data = await res.json() as any;
    if (data.status !== 'success') return blank;

    const city = data.city || '';
    const region = data.regionName || '';
    const country = data.countryCode || '';
    const label = [city, region, country].filter(Boolean).join(', ');

    geoCache.set(ip, { city, region, country, label, at: Date.now() });
    return { city, region, country, label };
  } catch {
    return blank;
  }
}

/**
 * Registra ou atualiza a sessão do usuário (Neon).
 */
export async function registerOrUpdateSession(
  uid: string,
  browserId: string,
  ip: string,
  userAgent: string,
): Promise<void> {
  try {
    const { browser, os, device } = parseUserAgent(userAgent);
    const geo = await getLocationFromIP(ip);
    const now = new Date();

    await neonQuery(async (sql) => {
      // Check for existing session with same uid+ip+browser+os
      const existing = await sql`
        SELECT id FROM seller_sessions
        WHERE uid = ${uid} AND ip = ${ip} AND browser = ${browser} AND os = ${os}
        ORDER BY last_active_at DESC LIMIT 1
      `;

      if (existing.length > 0) {
        // Update existing
        await sql`
          UPDATE seller_sessions SET
            last_active_at = ${now},
            browser_id = COALESCE(NULLIF(${browserId}, ''), browser_id),
            device = ${device},
            city = ${geo.city},
            region = ${geo.region},
            country = ${geo.country},
            location_label = ${geo.label}
          WHERE id = ${existing[0].id}
        `;
        // Delete duplicates
        await sql`
          DELETE FROM seller_sessions
          WHERE uid = ${uid} AND ip = ${ip} AND browser = ${browser} AND os = ${os}
            AND id != ${existing[0].id}
        `;
      } else {
        const sessionId = nanoid(20);
        await sql`
          INSERT INTO seller_sessions
            (id, uid, browser_id, ip, browser, os, device, city, region, country, location_label, created_at, last_active_at)
          VALUES
            (${sessionId}, ${uid}, ${browserId}, ${ip}, ${browser}, ${os}, ${device},
             ${geo.city}, ${geo.region}, ${geo.country}, ${geo.label}, ${now}, ${now})
        `;
      }
    }, `registerSession:${uid}`);
  } catch (err: any) {
    console.error('⚠️ [SESSIONS] Erro ao registrar sessão:', err?.message);
  }
}

/**
 * Retorna sessões únicas do usuário, mais recentes primeiro.
 */
export async function getSessionsForUser(uid: string): Promise<SessionInfo[]> {
  let rows: any[] = [];
  await neonQuery(async (sql) => {
    rows = await sql`
      SELECT id, uid, browser_id, ip, browser, os, device, city, region, country, location_label, created_at, last_active_at
      FROM seller_sessions
      WHERE uid = ${uid}
      ORDER BY last_active_at DESC
    `;
  }, `getSessionsForUser:${uid}`);

  return rows.map(r => ({
    sessionId: r.id,
    uid: r.uid,
    browserId: r.browser_id || '',
    ip: r.ip,
    browser: r.browser,
    os: r.os,
    device: r.device,
    city: r.city || '',
    region: r.region || '',
    country: r.country || '',
    locationLabel: r.location_label || '',
    createdAt: new Date(r.created_at),
    lastActiveAt: new Date(r.last_active_at),
  }));
}

/**
 * Revoga uma sessão específica (não pode revogar a própria sessão atual)
 */
export async function revokeSession(
  uid: string,
  sessionId: string,
  currentBrowserId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    let found: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT id, uid, browser_id FROM seller_sessions WHERE id = ${sessionId} LIMIT 1`;
      if (rows.length > 0) found = rows[0];
    }, `getSession:${sessionId}`);

    if (!found) return { success: false, error: 'Sessão não encontrada' };
    if (found.uid !== uid) return { success: false, error: 'Acesso negado' };
    if (found.browser_id === currentBrowserId) {
      return { success: false, error: 'Não é possível desconectar a sessão atual' };
    }

    await neonQuery(async (sql) => {
      await sql`DELETE FROM seller_sessions WHERE id = ${sessionId}`;
    }, `revokeSession:${sessionId}`);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Revoga todas as sessões exceto a atual
 */
export async function revokeAllOtherSessions(
  uid: string,
  currentBrowserId: string,
): Promise<{ success: boolean; count: number }> {
  try {
    let count = 0;
    await neonQuery(async (sql) => {
      const result = await sql`
        DELETE FROM seller_sessions
        WHERE uid = ${uid} AND (browser_id IS DISTINCT FROM ${currentBrowserId})
        RETURNING id
      `;
      count = result.length;
    }, `revokeAllOther:${uid}`);
    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0 };
  }
}
