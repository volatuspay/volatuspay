/**
 * 📧 EMAIL SERVICE - ENVIO DE EMAILS VIA RESEND
 * Sistema de envio de emails para 2FA, notificações, etc.
 */

function getResendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY;
}

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * 📧 ENVIAR EMAIL VIA RESEND API
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  try {
    const apiKey = getResendApiKey();

    if (!apiKey) {
      console.error('❌ [EMAIL] RESEND_API_KEY não configurada');
      return { success: false, error: 'Serviço de email não configurado' };
    }

    const defaultFrom = process.env.FROM_EMAIL || 'VolatusPay <noreply@volatuspay.com>';
    const fromEmail = options.from || defaultFrom;

    console.log(`📧 [EMAIL] Enviando para: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html
      })
    });

    const data = await response.json() as any;

    if (response.ok) {
      console.log(`✅ [EMAIL] Enviado com sucesso! ID: ${data.id}`);
      return { success: true, id: data.id };
    } else {
      console.error('❌ [EMAIL] Erro ao enviar:', data);
      if (data.statusCode === 403 && data.message?.includes('verify a domain')) {
        console.error('⚠️ [EMAIL] DOMINIO NAO VERIFICADO');
        return { success: false, error: 'Dominio de email nao verificado.' };
      }
      return { success: false, error: data.message || 'Erro ao enviar email' };
    }
  } catch (error: any) {
    console.error('❌ [EMAIL] Erro crítico:', error);
    return { success: false, error: error.message || 'Erro interno' };
  }
}

const BASE_URL = process.env.APP_BASE_URL || 'https://volatuspay.com';

/* ─── Brand tokens ─────────────────────────────────────────── */
const BRAND        = '#2563eb';   /* Azul VolatusPay */
const BRAND_DARK   = '#1d4ed8';
const BRAND_LIGHT  = '#eff6ff';
const PIX_GREEN    = '#16a34a';
const PIX_GREEN_BG = '#f0fdf4';
const LOGO_URL     = 'https://volatuspay.com/logo-volatuspay.png';

/* ─── Base wrappers ─────────────────────────────────────────── */
function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
          ${content}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailHeader(): string {
  return `
  <tr>
    <td style="background:#ffffff;border-radius:12px 12px 0 0;border:1px solid #e2e8f0;border-bottom:none;padding:28px 32px 20px 32px;text-align:center;">
      <img src="${LOGO_URL}" alt="VolatusPay" width="180" height="auto" style="display:block;margin:0 auto;max-width:180px;height:auto;" />
    </td>
  </tr>
  <tr>
    <td style="background:${BRAND};height:3px;font-size:0;line-height:0;border-left:1px solid ${BRAND};border-right:1px solid ${BRAND};">&nbsp;</td>
  </tr>`;
}

function emailCard(body: string): string {
  return `
  <tr>
    <td style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;padding:8px 32px 32px 32px;">
      ${body}
    </td>
  </tr>`;
}

function emailFooter(): string {
  return `
  <tr>
    <td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:1px solid #f1f5f9;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 4px 0;line-height:1.6;">
        Precisa de ajuda? <a href="mailto:${process.env.SUPPORT_EMAIL || 'suporte@volatuspay.com'}" style="color:${BRAND};text-decoration:none;">Entre em contato</a>
      </p>
      <p style="color:#cbd5e1;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} VolatusPay — CNPJ 60.416.460/0001-27</p>
    </td>
  </tr>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">`;
}

function infoTable(rows: Array<{ label: string; value: string; valueStyle?: string }>): string {
  const rowsHtml = rows.map(r => `
    <tr>
      <td style="padding:10px 0;color:#64748b;font-size:13px;width:45%;">${r.label}</td>
      <td style="padding:10px 0;font-size:13px;text-align:right;font-weight:600;${r.valueStyle || 'color:#111827;'}">${r.value}</td>
    </tr>
    <tr><td colspan="2" style="padding:0;border-top:1px solid #f1f5f9;"></td></tr>
  `).join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
      style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:20px 0;">
      <tr><td style="padding:4px 20px 0 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${rowsHtml}
        </table>
      </td></tr>
    </table>`;
}

function ctaButton(href: string, label: string, color?: string): string {
  const bg = color || BRAND;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 8px 0;">
      <tr>
        <td align="center">
          <a href="${href}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

function iconBadge(emoji: string, bg: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:16px;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background:${bg};border-radius:50%;width:60px;height:60px;text-align:center;line-height:60px;font-size:28px;">
            ${emoji}
          </div>
        </td>
      </tr>
    </table>`;
}

/* ──────────────────────────────────────────────────────────────
 * 🔐 CÓDIGO 2FA (ADMIN)
 * ────────────────────────────────────────────────────────────── */
export async function send2FACode(email: string, code: string, userName?: string): Promise<EmailResult> {
  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('🔐', BRAND_LIGHT)}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Verificação de Segurança</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Área Administrativa — VolatusPay</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${userName ? `, <strong>${userName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px 0;">
        Use o código abaixo para completar seu acesso ao painel administrativo:
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px 0;">
        <tr>
          <td align="center">
            <div style="display:inline-block;background:${BRAND_LIGHT};border:2px solid ${BRAND};border-radius:12px;padding:20px 40px;">
              <span style="font-size:38px;font-weight:800;color:${BRAND_DARK};letter-spacing:12px;font-family:'Courier New',monospace;">
                ${code}
              </span>
            </div>
          </td>
        </tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
        <tr>
          <td style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;text-align:center;">
            <p style="color:#92400e;font-size:13px;margin:0;font-weight:600;">
              ⏱ Este código expira em <strong>5 minutos</strong>
            </p>
          </td>
        </tr>
      </table>

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
        Se você não solicitou este código, ignore este email com segurança.<br>
        <strong style="color:#6b7280;">Nunca compartilhe este código com ninguém.</strong>
      </p>
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: email,
    subject: `[${code}] Seu código de verificação — VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * ✅ SELLER APROVADO
 * ────────────────────────────────────────────────────────────── */
export async function sendSellerApprovalEmail(email: string, businessName?: string): Promise<EmailResult> {
  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('✅', '#dcfce7')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Conta Aprovada!</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Bem-vindo(a) à VolatusPay</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${businessName ? `, <strong>${businessName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        Parabéns! Sua conta de vendedor foi <strong style="color:${PIX_GREEN};">aprovada</strong> com sucesso. Agora você pode:
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:0;margin:0 0 24px 0;">
        <tr><td style="padding:16px 20px;">
          <p style="color:#15803d;font-size:14px;line-height:1.8;margin:0;">
            ✓ Criar produtos e checkouts<br>
            ✓ Receber pagamentos via PIX, cartão e boleto<br>
            ✓ Configurar afiliados<br>
            ✓ Acompanhar vendas em tempo real
          </p>
        </td></tr>
      </table>

      ${ctaButton(`${BASE_URL}/login`, 'Acessar Minha Conta', PIX_GREEN)}
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: email,
    subject: `Sua conta foi aprovada — VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * ❌ SELLER REJEITADO
 * ────────────────────────────────────────────────────────────── */
export async function sendSellerRejectionEmail(email: string, rejectionReason: string, businessName?: string): Promise<EmailResult> {
  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('⚠️', '#fef3c7')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Cadastro Pendente de Ajustes</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">VolatusPay</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${businessName ? `, <strong>${businessName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px 0;">
        Não foi possível aprovar seu cadastro neste momento. Veja o motivo:
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
        <tr>
          <td style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="color:#b91c1c;font-size:13px;font-weight:600;margin:0 0 4px 0;">Motivo:</p>
            <p style="color:#dc2626;font-size:14px;margin:0;">${rejectionReason}</p>
          </td>
        </tr>
      </table>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px 0;">
        <strong>Não se preocupe!</strong> Corrija as informações e reenvie sua documentação para nova análise.
      </p>

      ${ctaButton(`${BASE_URL}/login`, 'Reenviar Documentos', '#dc2626')}
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: email,
    subject: `Cadastro pendente de ajustes — VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * ⚡ PIX GERADO → SELLER (aguardando pagamento)
 * ────────────────────────────────────────────────────────────── */
interface PixGeradoData {
  sellerEmail: string;
  sellerName?: string;
  productName: string;
  buyerName: string;
  buyerEmail: string;
  amount: number;
  orderId: string;
}

export async function sendPixGeradoEmail(data: PixGeradoData): Promise<EmailResult> {
  const amountFormatted = (data.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('⏳', '#fef9c3')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">PIX Gerado</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Aguardando confirmação do pagamento</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${data.sellerName ? `, <strong>${data.sellerName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px 0;">
        Um cliente gerou um PIX para o seu produto. Aguardando confirmação do pagamento.
      </p>

      ${infoTable([
        { label: 'Produto', value: data.productName },
        { label: 'Comprador', value: data.buyerName },
        { label: 'E-mail', value: data.buyerEmail, valueStyle: 'color:#64748b;' },
        { label: 'Valor', value: amountFormatted, valueStyle: `color:${PIX_GREEN};font-size:16px;` },
        { label: 'Pedido', value: `#${data.orderId.substring(0, 8).toUpperCase()}`, valueStyle: 'color:#9ca3af;font-size:12px;font-family:monospace;' },
      ])}

      <p style="color:#9ca3af;font-size:13px;text-align:center;margin:0;">
        Você receberá outro email quando o pagamento for confirmado.
      </p>
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.sellerEmail,
    subject: `PIX aguardando: ${data.productName} — ${amountFormatted} | VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * 📲 PIX GERADO → COMPRADOR (QR Code + copia e cola)
 * ────────────────────────────────────────────────────────────── */
export interface PixBuyerEmailData {
  buyerEmail: string;
  buyerName: string;
  productName: string;
  amount: number;
  orderId: string;
  pixCopiaECola: string;
  qrCodeImage?: string | null;
  expiresAt?: string;
  sellerName?: string;
}

export async function sendPixBuyerEmail(data: PixBuyerEmailData): Promise<EmailResult> {
  const amountFormatted = (data.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  let qrImageUrl: string | null = null;
  if (data.pixCopiaECola) {
    if (data.qrCodeImage && !data.qrCodeImage.startsWith('data:')) {
      qrImageUrl = data.qrCodeImage;
    } else {
      qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.pixCopiaECola)}&margin=10&bgcolor=ffffff&color=000000&format=png`;
    }
  }

  const qrSection = qrImageUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 16px 0;">
      <tr>
        <td align="center">
          <p style="color:#64748b;font-size:13px;margin:0 0 12px 0;">Escaneie o QR Code com seu app do banco:</p>
          <div style="display:inline-block;background:#ffffff;border:2px solid #e2e8f0;border-radius:16px;padding:16px;">
            <img src="${qrImageUrl}" alt="QR Code PIX" width="200" height="200" style="display:block;width:200px;height:200px;border:0;" />
          </div>
        </td>
      </tr>
    </table>` : '';

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:16px;">
        <tr>
          <td align="center">
            <div style="display:inline-block;background:${PIX_GREEN_BG};border:2px solid #bbf7d0;border-radius:50%;width:56px;height:56px;text-align:center;line-height:56px;font-size:26px;">
              💳
            </div>
          </td>
        </tr>
      </table>

      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Finalize seu Pagamento</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">via PIX — VolatusPay</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${data.buyerName ? `, <strong>${data.buyerName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 20px 0;">
        Seu pedido foi gerado com sucesso! Para concluir, efetue o pagamento PIX abaixo.
      </p>

      ${infoTable([
        { label: 'Produto', value: data.productName },
        ...(data.sellerName ? [{ label: 'Vendedor', value: data.sellerName }] : []),
        { label: 'Valor', value: amountFormatted, valueStyle: `color:${PIX_GREEN};font-size:18px;` },
        { label: 'Pedido', value: `#${data.orderId.substring(0, 10).toUpperCase()}`, valueStyle: 'color:#9ca3af;font-size:12px;font-family:monospace;' },
      ])}

      ${qrSection}

      <p style="color:#64748b;font-size:13px;text-align:center;margin:${qrSection ? '4px' : '20px'} 0 10px 0;">
        ${qrSection ? 'Ou copie o código PIX Copia e Cola:' : 'Copie o código PIX Copia e Cola abaixo:'}
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px 0;">
        <tr>
          <td style="background:#f8fafc;border:2px dashed ${PIX_GREEN};border-radius:8px;padding:14px;">
            <p style="color:#111827;font-size:11px;line-height:1.5;margin:0;font-family:'Courier New',Courier,monospace;word-break:break-all;user-select:all;-webkit-user-select:all;">
              ${data.pixCopiaECola}
            </p>
          </td>
        </tr>
      </table>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0 0 20px 0;">
        Toque e segure → <strong>Copiar</strong> → abra seu banco → <strong>PIX Copia e Cola</strong>
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
        <tr>
          <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;text-align:center;">
            <p style="color:#92400e;font-size:13px;margin:0;font-weight:600;">
              ⏱ Este PIX expira em <strong>1 hora</strong>. Efetue o pagamento antes do vencimento.
            </p>
          </td>
        </tr>
      </table>

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
        Após o pagamento, a confirmação é automática e você receberá um e-mail de confirmação.
      </p>
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.buyerEmail,
    subject: `Pague agora: ${data.productName} — ${amountFormatted} | VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * ✅ PIX PAGO → SELLER
 * ────────────────────────────────────────────────────────────── */
interface PixPagoData {
  sellerEmail: string;
  sellerName?: string;
  productName: string;
  buyerName: string;
  buyerEmail: string;
  amount: number;
  netAmount: number;
  orderId: string;
}

export async function sendPixPagoEmail(data: PixPagoData): Promise<EmailResult> {
  const amountFormatted = (data.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const netFormatted    = (data.netAmount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('✅', '#dcfce7')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">PIX Confirmado!</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Venda aprovada — VolatusPay</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${data.sellerName ? `, <strong>${data.sellerName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        Excelente! O pagamento PIX foi confirmado e sua venda foi aprovada.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
        <tr>
          <td style="background:${PIX_GREEN_BG};border:1px solid #86efac;border-radius:10px;padding:20px;text-align:center;">
            <p style="color:#15803d;font-size:13px;font-weight:600;margin:0 0 4px 0;">Valor Líquido</p>
            <p style="color:#15803d;font-size:32px;font-weight:800;margin:0;">${netFormatted}</p>
          </td>
        </tr>
      </table>

      ${infoTable([
        { label: 'Produto', value: data.productName },
        { label: 'Comprador', value: data.buyerName },
        { label: 'E-mail', value: data.buyerEmail, valueStyle: 'color:#64748b;' },
        { label: 'Valor Bruto', value: amountFormatted },
        { label: 'Pedido', value: `#${data.orderId.substring(0, 8).toUpperCase()}`, valueStyle: 'color:#9ca3af;font-size:12px;font-family:monospace;' },
      ])}

      ${ctaButton(`${BASE_URL}/dashboard/sales`, 'Ver Minhas Vendas', PIX_GREEN)}
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.sellerEmail,
    subject: `Venda aprovada! ${data.productName} — ${netFormatted} | VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * 💰 VENDA APROVADA (TODOS OS MÉTODOS) → SELLER
 * ────────────────────────────────────────────────────────────── */
export interface SaleApprovedEmailData {
  sellerEmail: string;
  sellerName?: string;
  productName: string;
  productPrice: number;
  buyerName: string;
  buyerEmail: string;
  paymentMethod: 'pix' | 'credit_card' | 'boleto' | 'debit_card';
  orderId: string;
  netAmount: number;
  orderBumps?: Array<{ name: string; price: number }>;
  currency?: string;
}

export async function sendSaleApprovedEmail(data: SaleApprovedEmailData): Promise<EmailResult> {
  const currency            = data.currency || 'BRL';
  const netFormatted        = (data.netAmount / 100).toLocaleString('pt-BR', { style: 'currency', currency });
  const productPriceFormatted = (data.productPrice / 100).toLocaleString('pt-BR', { style: 'currency', currency });

  const paymentMethodLabel: Record<string, string> = {
    pix: 'PIX',
    credit_card: 'Cartão de Crédito',
    boleto: 'Boleto',
    debit_card: 'Cartão de Débito'
  };

  const bumpsRows = (data.orderBumps || []).map(bump => {
    const bumpPrice = (bump.price / 100).toLocaleString('pt-BR', { style: 'currency', currency });
    return `
      <tr>
        <td style="padding:8px 0;color:#64748b;font-size:13px;">+ ${bump.name}</td>
        <td style="padding:8px 0;font-size:13px;text-align:right;font-weight:600;color:${PIX_GREEN};">${bumpPrice}</td>
      </tr>`;
  }).join('');

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('🎉', '#dcfce7')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Venda Aprovada!</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">
        via ${paymentMethodLabel[data.paymentMethod] || data.paymentMethod}
      </p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${data.sellerName ? `, <strong>${data.sellerName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        Parabéns! Você realizou uma nova venda.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
        <tr>
          <td style="background:${PIX_GREEN_BG};border:1px solid #86efac;border-radius:10px;padding:20px;text-align:center;">
            <p style="color:#15803d;font-size:13px;font-weight:600;margin:0 0 4px 0;">Valor Líquido</p>
            <p style="color:#15803d;font-size:32px;font-weight:800;margin:0;">${netFormatted}</p>
          </td>
        </tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:0 0 24px 0;">
        <tr><td style="padding:4px 20px 0 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;">Produto</td>
              <td style="padding:10px 0;font-size:13px;text-align:right;font-weight:600;color:#111827;">${data.productName}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;border-top:1px solid #f1f5f9;"></td></tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;">Valor</td>
              <td style="padding:10px 0;font-size:13px;text-align:right;font-weight:600;color:#111827;">${productPriceFormatted}</td>
            </tr>
            ${bumpsRows ? `<tr><td colspan="2" style="padding:0;border-top:1px solid #f1f5f9;"></td></tr>${bumpsRows}` : ''}
            <tr><td colspan="2" style="padding:0;border-top:2px solid #e2e8f0;"></td></tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;">Comprador</td>
              <td style="padding:10px 0;font-size:13px;text-align:right;font-weight:600;color:#111827;">${data.buyerName}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;border-top:1px solid #f1f5f9;"></td></tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;">E-mail</td>
              <td style="padding:10px 0;font-size:13px;text-align:right;color:#64748b;">${data.buyerEmail}</td>
            </tr>
            <tr><td colspan="2" style="padding:0;border-top:1px solid #f1f5f9;"></td></tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;">Pedido</td>
              <td style="padding:10px 0;font-size:12px;text-align:right;color:#9ca3af;font-family:monospace;">#${data.orderId.substring(0, 8).toUpperCase()}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      ${ctaButton(`${BASE_URL}/dashboard/sales`, 'Ver Minhas Vendas', PIX_GREEN)}
    `)}
    ${emailFooter()}
  `);

  const subject = data.orderBumps && data.orderBumps.length > 0
    ? `Venda aprovada! ${data.productName} + ${data.orderBumps.length} bump(s) — ${netFormatted}`
    : `Venda aprovada! ${data.productName} — ${netFormatted}`;

  return sendEmail({ to: data.sellerEmail, subject, html });
}

/* ──────────────────────────────────────────────────────────────
 * 💰 SAQUE APROVADO → SELLER
 * ────────────────────────────────────────────────────────────── */
interface WithdrawalApprovedData {
  sellerEmail: string;
  sellerName?: string;
  amount: number;
  currency: string;
  pixKey: string;
  withdrawalId: string;
}

export async function sendWithdrawalApprovedEmail(data: WithdrawalApprovedData): Promise<EmailResult> {
  const amountFormatted = (data.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: data.currency || 'BRL' });

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('💸', '#dcfce7')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Saque Aprovado!</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Transferência em processamento</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${data.sellerName ? `, <strong>${data.sellerName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        Seu saque foi <strong style="color:${PIX_GREEN};">aprovado</strong> com sucesso!
      </p>

      ${infoTable([
        { label: 'Valor', value: amountFormatted, valueStyle: `color:${PIX_GREEN};font-size:18px;` },
        { label: 'Chave PIX', value: data.pixKey },
        { label: 'ID do Saque', value: data.withdrawalId, valueStyle: 'color:#9ca3af;font-size:12px;font-family:monospace;' },
      ])}

      <p style="color:#64748b;font-size:13px;text-align:center;margin:0 0 24px 0;">
        O valor será transferido para sua conta PIX em até <strong>24 horas úteis</strong>.
      </p>

      ${ctaButton(`${BASE_URL}/dashboard/finances`, 'Ver Meu Financeiro', BRAND)}
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.sellerEmail,
    subject: `Saque aprovado: ${amountFormatted} — VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * ❌ SAQUE REJEITADO → SELLER
 * ────────────────────────────────────────────────────────────── */
interface WithdrawalRejectedData {
  sellerEmail: string;
  sellerName?: string;
  amount: number;
  currency: string;
  pixKey: string;
  withdrawalId: string;
  reason: string;
}

export async function sendWithdrawalRejectedEmail(data: WithdrawalRejectedData): Promise<EmailResult> {
  const amountFormatted = (data.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: data.currency || 'BRL' });

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('❌', '#fee2e2')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Saque Não Aprovado</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Valor devolvido ao saldo</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${data.sellerName ? `, <strong>${data.sellerName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px 0;">
        Infelizmente sua solicitação de saque foi <strong style="color:#dc2626;">recusada</strong>.
        O valor foi devolvido integralmente ao seu saldo disponível.
      </p>

      ${infoTable([
        { label: 'Valor', value: amountFormatted },
        { label: 'Chave PIX', value: data.pixKey },
        { label: 'Motivo', value: data.reason, valueStyle: 'color:#d97706;' },
        { label: 'ID do Saque', value: data.withdrawalId, valueStyle: 'color:#9ca3af;font-size:12px;font-family:monospace;' },
      ])}

      <p style="color:#64748b;font-size:13px;text-align:center;margin:0 0 24px 0;">
        O valor de <strong>${amountFormatted}</strong> foi devolvido ao seu saldo.<br>
        Você pode fazer uma nova solicitação a qualquer momento.
      </p>

      ${ctaButton(`${BASE_URL}/dashboard/finances`, 'Ver Meu Financeiro', BRAND)}
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.sellerEmail,
    subject: `Saque recusado — ${amountFormatted} devolvido ao saldo | VolatusPay`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * ⏰ ASSINATURA VENCENDO → COMPRADOR
 * ────────────────────────────────────────────────────────────── */
interface SubscriptionExpiringData {
  customerEmail: string;
  customerName: string;
  productName: string;
  daysLeft: number;
  expiresAt: string;
  valor: string;
  renewUrl: string;
}

export async function sendSubscriptionExpiringEmail(data: SubscriptionExpiringData): Promise<EmailResult> {
  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('⏰', '#fef3c7')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Sua assinatura vence em breve!</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Renove para manter seu acesso</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá, <strong>${data.customerName}</strong>!
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        Sua assinatura de <strong>${data.productName}</strong> vence em
        <strong style="color:#d97706;">${data.daysLeft} dia${data.daysLeft > 1 ? 's' : ''}</strong>
        (${data.expiresAt}).
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
        <tr>
          <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;text-align:center;">
            <p style="color:#92400e;font-size:13px;font-weight:600;margin:0 0 4px 0;">Valor da renovação</p>
            <p style="color:#78350f;font-size:24px;font-weight:800;margin:0;">${data.valor}</p>
          </td>
        </tr>
      </table>

      <p style="color:#64748b;font-size:13px;text-align:center;margin:0 0 24px 0;">
        Para manter seu acesso sem interrupções, renove antes do vencimento.
      </p>

      ${ctaButton(data.renewUrl, 'Renovar Assinatura', '#d97706')}

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
        Se você já efetuou o pagamento, pode ignorar este aviso. O acesso é confirmado automaticamente.
      </p>
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.customerEmail,
    subject: `Sua assinatura de "${data.productName}" vence em ${data.daysLeft} dia${data.daysLeft > 1 ? 's' : ''}`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * ❌ ASSINATURA VENCIDA → COMPRADOR
 * ────────────────────────────────────────────────────────────── */
interface SubscriptionExpiredData {
  customerEmail: string;
  customerName: string;
  productName: string;
  renewUrl: string;
}

export async function sendSubscriptionExpiredEmail(data: SubscriptionExpiredData): Promise<EmailResult> {
  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('😔', '#fee2e2')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Seu acesso foi encerrado</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Renove agora para recuperar o acesso</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá, <strong>${data.customerName}</strong>!
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        Sua assinatura de <strong>${data.productName}</strong> venceu e seu acesso foi encerrado.
      </p>

      <p style="color:#64748b;font-size:14px;text-align:center;line-height:1.6;margin:0 0 24px 0;">
        Para reativar e continuar com acesso imediato, basta renovar clicando no botão abaixo.<br>
        <strong style="color:#374151;">O acesso é liberado automaticamente ao renovar.</strong>
      </p>

      ${ctaButton(data.renewUrl, 'Renovar Agora', '#dc2626')}
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.customerEmail,
    subject: `Seu acesso a "${data.productName}" foi encerrado — Renove agora`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * 🔔 NOVO SELLER AGUARDANDO → ADMIN
 * ────────────────────────────────────────────────────────────── */
export async function sendNewSellerPendingEmail(adminEmail: string, seller: {
  name: string;
  email: string;
  businessName?: string;
  businessNiche?: string;
  document?: string;
}): Promise<EmailResult> {
  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('🔔', BRAND_LIGHT)}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Novo Seller Aguardando Aprovação</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">Ação necessária — Painel Admin</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px 0;">
        Um novo vendedor se cadastrou e está aguardando sua aprovação:
      </p>

      ${infoTable([
        { label: 'Nome', value: seller.name },
        { label: 'E-mail', value: seller.email, valueStyle: 'color:#64748b;' },
        ...(seller.businessName ? [{ label: 'Empresa', value: seller.businessName }] : []),
        ...(seller.businessNiche ? [{ label: 'Nicho', value: seller.businessNiche }] : []),
        ...(seller.document ? [{ label: 'Documento', value: seller.document }] : []),
      ])}

      ${ctaButton(`${BASE_URL}/admin/sellers`, 'Revisar Cadastro', BRAND)}
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: adminEmail,
    subject: `Novo seller aguardando aprovação — ${seller.businessName || seller.name}`,
    html
  });
}

/* ──────────────────────────────────────────────────────────────
 * 🛒 RECUPERAÇÃO DE CARRINHO ABANDONADO
 * ────────────────────────────────────────────────────────────── */
export interface AbandonedCartEmailData {
  buyerEmail: string;
  buyerName: string;
  productName: string;
  checkoutSlug: string;
  day: 1 | 3 | 7;
}

export async function sendAbandonedCartEmail(data: AbandonedCartEmailData): Promise<EmailResult> {
  const checkoutUrl = `${BASE_URL}/checkout/${data.checkoutSlug}`;

  const urgencyMessages: Record<number, { headline: string; body: string; cta: string; icon: string; color: string }> = {
    1: {
      headline: 'Você deixou algo para trás',
      body: `Você começou a se inscrever em <strong>${data.productName}</strong> mas não finalizou. O seu acesso ainda está reservado — mas pode não ficar disponível por muito tempo.`,
      cta: 'Finalizar minha compra',
      icon: '👀',
      color: BRAND,
    },
    3: {
      headline: 'Ainda pensando?',
      body: `Sua vaga em <strong>${data.productName}</strong> está reservada, mas as vagas são limitadas. Não deixe passar essa oportunidade.`,
      cta: 'Garantir minha vaga agora',
      icon: '🤔',
      color: '#d97706',
    },
    7: {
      headline: 'Última chance!',
      body: `Sua reserva em <strong>${data.productName}</strong> está prestes a expirar. Esta é nossa última mensagem — depois disso sua vaga será liberada.`,
      cta: 'Quero garantir meu acesso',
      icon: '⚠️',
      color: '#dc2626',
    },
  };

  const msg = urgencyMessages[data.day];

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge(msg.icon, '#f1f5f9')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">${msg.headline}</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">VolatusPay</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá${data.buyerName ? `, <strong>${data.buyerName}</strong>` : ''},
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px 0;">
        ${msg.body}
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:0 0 24px 0;">
        <tr><td style="padding:16px 20px;">
          <p style="color:#64748b;font-size:13px;margin:0 0 4px 0;">Produto reservado:</p>
          <p style="color:#111827;font-size:17px;font-weight:700;margin:0;">${data.productName}</p>
        </td></tr>
      </table>

      ${ctaButton(checkoutUrl, msg.cta, msg.color)}

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
        Se você não se interessou mais, pode ignorar este email.
      </p>
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.buyerEmail,
    subject: data.day === 1
      ? `Você esqueceu de finalizar: ${data.productName}`
      : data.day === 3
        ? `Sua vaga em ${data.productName} ainda está disponível`
        : `Última chance: ${data.productName} — sua reserva expira em breve`,
    html,
  });
}

/* ──────────────────────────────────────────────────────────────
 * 🔁 REATIVAÇÃO PÓS-VENCIMENTO → COMPRADOR (+1, +2, +3 dias)
 * ────────────────────────────────────────────────────────────── */
export interface SubscriptionReactivationData {
  customerEmail: string;
  customerName: string;
  productName: string;
  renewUrl: string;
  daysAfter: 1 | 2 | 3;
  valor?: string;
}

export async function sendSubscriptionReactivationEmail(data: SubscriptionReactivationData): Promise<EmailResult> {
  const msgs: Record<number, { headline: string; body: string; cta: string; icon: string; iconBg: string; color: string; urgency: string }> = {
    1: {
      headline: 'Você ainda pode recuperar seu acesso!',
      body: `Sua assinatura de <strong>${data.productName}</strong> venceu ontem, mas ainda dá tempo de reativar e continuar de onde parou. Nenhum dado foi perdido!`,
      cta: 'Reativar meu acesso agora',
      icon: '🔑',
      iconBg: '#ede9fe',
      color: '#7c3aed',
      urgency: 'Reative hoje e não perca seu progresso',
    },
    2: {
      headline: 'Seu acesso ainda está esperando por você',
      body: `Já faz 2 dias desde que sua assinatura de <strong>${data.productName}</strong> venceu. Recupere agora antes que perca tudo!`,
      cta: 'Recuperar acesso',
      icon: '⚡',
      iconBg: '#fef3c7',
      color: '#d97706',
      urgency: 'Não deixe pra amanhã — reative agora',
    },
    3: {
      headline: 'Última chance de reativação!',
      body: `Sua assinatura de <strong>${data.productName}</strong> está encerrada há 3 dias. Esta é sua última notificação — reative agora ou você perderá o acesso definitivamente.`,
      cta: '⚠️ Reativar agora — última chance',
      icon: '🚨',
      iconBg: '#fee2e2',
      color: '#dc2626',
      urgency: 'Ação imediata necessária',
    },
  };

  const m = msgs[data.daysAfter];

  const valorSection = data.valor ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center;">
          <p style="color:#64748b;font-size:13px;font-weight:600;margin:0 0 4px 0;">Valor para reativar</p>
          <p style="color:#111827;font-size:24px;font-weight:800;margin:0;">${data.valor}</p>
        </td>
      </tr>
    </table>` : '';

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge(m.icon, m.iconBg)}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">${m.headline}</h2>
      <p style="color:#64748b;text-align:center;font-size:14px;margin:0 0 24px 0;">${m.urgency}</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá, <strong>${data.customerName}</strong>!
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        ${m.body}
      </p>

      ${valorSection}

      ${ctaButton(data.renewUrl, m.cta, m.color)}

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:8px 0 0 0;">
        Se você não deseja mais a assinatura, pode ignorar este email com segurança.
      </p>
    `)}
    ${emailFooter()}
  `);

  const subjects: Record<number, string> = {
    1: `Reative seu acesso a "${data.productName}" — ainda dá tempo!`,
    2: `Seu acesso a "${data.productName}" ainda está esperando`,
    3: `⚠️ Última chance: reative sua assinatura de "${data.productName}"`,
  };

  return sendEmail({
    to: data.customerEmail,
    subject: subjects[data.daysAfter],
    html,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 💳 DUNNING — Smart Retry de Cartão Recusado
// ─────────────────────────────────────────────────────────────────────────────

interface DunningFailedData {
  customerEmail: string;
  customerName: string;
  productName: string;
  attempt: number;
  nextRetryDate: Date;
  renewUrl?: string;
}

interface DunningCancelledData {
  customerEmail: string;
  customerName: string;
  productName: string;
  renewUrl: string;
}

export async function sendDunningFailedEmail(data: DunningFailedData): Promise<EmailResult> {
  const retryDateStr = data.nextRetryDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  const msgs: Record<number, { headline: string; body: string; icon: string; iconBg: string; color: string }> = {
    1: {
      headline: 'Não conseguimos processar seu pagamento',
      body: `Tentamos cobrar sua assinatura de <strong>${data.productName}</strong>, mas o cartão foi recusado. Vamos tentar novamente automaticamente em <strong>${retryDateStr}</strong>. Verifique se os dados do cartão estão atualizados.`,
      icon: '💳',
      iconBg: '#fef3c7',
      color: '#d97706',
    },
    2: {
      headline: '2ª tentativa de cobrança falhou',
      body: `Já tentamos cobrar sua assinatura de <strong>${data.productName}</strong> duas vezes sem sucesso. Faremos mais uma tentativa em <strong>${retryDateStr}</strong>. Para garantir seu acesso, atualize seu método de pagamento.`,
      icon: '⚠️',
      iconBg: '#fee2e2',
      color: '#dc2626',
    },
    3: {
      headline: 'Última tentativa automática em ${retryDateStr}',
      body: `Esta é a penúltima tentativa para sua assinatura de <strong>${data.productName}</strong>. Se não conseguirmos processar o pagamento em <strong>${retryDateStr}</strong>, sua assinatura será cancelada automaticamente.`,
      icon: '🚨',
      iconBg: '#fee2e2',
      color: '#dc2626',
    },
  };

  const m = msgs[Math.min(data.attempt, 3)];

  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge(m.icon, m.iconBg)}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">${m.headline}</h2>
      <p style="color:#64748b;text-align:center;font-size:13px;margin:0 0 24px 0;">Tentativa ${data.attempt} de 3</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá, <strong>${data.customerName}</strong>!
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px 0;">
        ${m.body}
      </p>

      ${data.renewUrl ? ctaButton(data.renewUrl, 'Atualizar forma de pagamento', m.color) : ''}

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:16px 0 0 0;">
        Próxima tentativa automática: <strong>${retryDateStr}</strong>
      </p>
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.customerEmail,
    subject: `Problema no pagamento da sua assinatura "${data.productName}"`,
    html,
  });
}

export async function sendSubscriptionCancelledDunningEmail(data: DunningCancelledData): Promise<EmailResult> {
  const html = emailWrapper(`
    ${emailHeader()}
    ${emailCard(`
      ${iconBadge('❌', '#fee2e2')}
      <h2 style="color:#111827;text-align:center;margin:0 0 4px 0;font-size:22px;font-weight:700;">Assinatura cancelada</h2>
      <p style="color:#64748b;text-align:center;font-size:13px;margin:0 0 24px 0;">Não conseguimos processar o pagamento após 3 tentativas</p>

      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0;">
        Olá, <strong>${data.customerName}</strong>!
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0;">
        Infelizmente, tentamos processar o pagamento da sua assinatura de <strong>${data.productName}</strong> três vezes e não conseguimos. Por isso, cancelamos sua assinatura automaticamente.
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px 0;">
        Se desejar reativar, basta assinar novamente pelo link abaixo.
      </p>

      ${ctaButton(data.renewUrl, 'Assinar novamente', '#059669')}

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:16px 0 0 0;">
        Ficamos à disposição se precisar de ajuda.
      </p>
    `)}
    ${emailFooter()}
  `);

  return sendEmail({
    to: data.customerEmail,
    subject: `Sua assinatura de "${data.productName}" foi cancelada`,
    html,
  });
}
