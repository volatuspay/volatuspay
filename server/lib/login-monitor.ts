/**
 * 🔔 LOGIN MONITOR — NOTIFICAÇÃO DE NOVO DISPOSITIVO/IP
 * Detecta logins de dispositivos não reconhecidos e notifica o seller por email
 */

import { getFirestore } from './firebase-admin';
import { sendEmail } from './email-service';

const MAX_KNOWN_DEVICES = 20;

function buildDeviceFingerprint(ip: string, userAgent: string): string {
  return `${ip}|${userAgent.slice(0, 120)}`;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' (Horário de Brasília)';
}

function buildLoginAlertEmail(params: {
  name?: string;
  ip: string;
  deviceType: string;
  userAgent: string;
  dateStr: string;
}): string {
  const { name, ip, deviceType, userAgent, dateStr } = params;
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222">
      <div style="background:#111;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0;font-size:20px">🔐 Novo acesso detectado</h2>
      </div>
      <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        <p>Olá${name ? `, <b>${name}</b>` : ''}!</p>
        <p>Identificamos um acesso à sua conta <b>VolatusPay</b> a partir de um dispositivo não reconhecido anteriormente.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0">
          <tr style="background:#fff">
            <td style="padding:10px 14px;border:1px solid #ddd;font-weight:bold;width:140px">Data/Hora</td>
            <td style="padding:10px 14px;border:1px solid #ddd">${dateStr}</td>
          </tr>
          <tr style="background:#f5f5f5">
            <td style="padding:10px 14px;border:1px solid #ddd;font-weight:bold">IP de acesso</td>
            <td style="padding:10px 14px;border:1px solid #ddd">${ip}</td>
          </tr>
          <tr style="background:#fff">
            <td style="padding:10px 14px;border:1px solid #ddd;font-weight:bold">Tipo de dispositivo</td>
            <td style="padding:10px 14px;border:1px solid #ddd">${deviceType}</td>
          </tr>
          <tr style="background:#f5f5f5">
            <td style="padding:10px 14px;border:1px solid #ddd;font-weight:bold">Navegador</td>
            <td style="padding:10px 14px;border:1px solid #ddd">${userAgent.slice(0, 120)}</td>
          </tr>
        </table>
        <div style="background:#fffbea;border:1px solid #f0c040;border-radius:6px;padding:14px 16px;margin-top:8px">
          <p style="margin:0"><b>✅ Foi você?</b> Pode ignorar este email com segurança.</p>
          <p style="margin:8px 0 0"><b>⚠️ Não foi você?</b> Altere sua senha imediatamente em <a href="https://volatuspay.com/dashboard/settings">Configurações</a> e entre em contato com o suporte.</p>
        </div>
        <p style="color:#999;font-size:11px;margin-top:20px">VolatusPay — volatuspay.com<br>Você recebe este email porque é vendedor cadastrado na plataforma.</p>
      </div>
    </div>
  `;
}

/**
 * 📡 VERIFICAR E NOTIFICAR NOVO DISPOSITIVO
 * Chamado de forma assíncrona no middleware de autenticação Firebase
 */
export async function checkAndNotifyNewDevice(params: {
  uid: string;
  email: string;
  name?: string;
  ip: string;
  userAgent: string;
  deviceType: string;
}): Promise<void> {
  try {
    const { uid, email, name, ip, userAgent, deviceType } = params;

    if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') return;

    const db = getFirestore();
    const fingerprint = buildDeviceFingerprint(ip, userAgent);

    const knownDoc = await db.collection('seller-known-devices').doc(uid).get();
    const devices: any[] = knownDoc.exists ? (knownDoc.data()?.devices || []) : [];

    const isKnown = devices.some(d => d.fingerprint === fingerprint);
    const now = new Date();

    if (!isKnown) {
      await sendEmail({
        to: email,
        subject: '🔐 Novo acesso à sua conta VolatusPay',
        html: buildLoginAlertEmail({
          name,
          ip,
          deviceType,
          userAgent,
          dateStr: formatDateTime(now),
        }),
      });

      const newDevice = {
        fingerprint,
        ip,
        deviceType,
        userAgent: userAgent.slice(0, 200),
        firstSeenAt: now,
        lastSeenAt: now,
      };

      const updatedDevices = [...devices.slice(-(MAX_KNOWN_DEVICES - 1)), newDevice];
      await db.collection('seller-known-devices').doc(uid).set({ devices: updatedDevices, updatedAt: now });

      console.log(`🔔 [LOGIN-MONITOR] Novo dispositivo para ${email.slice(0, 3)}*** — email enviado`);
    } else {
      const updatedDevices = devices.map(d =>
        d.fingerprint === fingerprint ? { ...d, lastSeenAt: now } : d
      );
      await db.collection('seller-known-devices').doc(uid).set({ devices: updatedDevices, updatedAt: now });
    }
  } catch (e: any) {
    console.error('⚠️ [LOGIN-MONITOR] Erro:', e?.message);
  }
}
