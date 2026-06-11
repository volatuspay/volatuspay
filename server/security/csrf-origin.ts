import type { Request, Response, NextFunction } from 'express';

/**
 * 🛡️ CSRF MITIGATION VIA ORIGIN/REFERER HEADER
 *
 * Como o app usa Firebase Auth com Bearer tokens (não cookies de sessão),
 * o risco de CSRF já é baixo. Esta camada adiciona verificação de Origin
 * em requisições mutantes em produção para defesa em profundidade.
 *
 * Rotas de webhook externo são excluídas automaticamente.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Rotas que recebem requisições externas legítimas sem Origin (webhooks)
const WEBHOOK_PREFIXES = ['/webhook/', '/api/webhooks/'];

function isWebhook(path: string): boolean {
  return WEBHOOK_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function getAllowedOrigins(): string[] {
  const origins = [
    'https://volatuspay.com',
    'https://www.volatuspay.com',
    'https://volatus.com',
    'https://www.volatus.com',
  ];

  // Em dev/staging também permite o domínio Replit e localhost
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:5000');
    origins.push('http://localhost:3000');
  }

  // Domínio dinâmico do Replit (ex: xxx.replit.dev)
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDomain) {
    origins.push(`https://${replitDomain}`);
  }

  return origins;
}

export function csrfOriginMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Métodos seguros não precisam de validação
    if (SAFE_METHODS.has(req.method)) return next();

    // Webhooks externos são excluídos
    if (isWebhook(req.path)) return next();

    // Em dev, não bloquear (apenas logar)
    const isDev = process.env.NODE_ENV !== 'production';

    const origin = req.headers['origin'] as string | undefined;
    const referer = req.headers['referer'] as string | undefined;

    const source = origin || (referer ? new URL(referer).origin : undefined);

    if (!source) {
      // Sem Origin/Referer — pode ser uma requisição server-to-server legítima
      // (ex: curl, Postman, apps mobile). Não bloquear, apenas logar.
      if (!isDev) {
        console.warn(`⚠️ [CSRF] Requisição sem Origin: ${req.method} ${req.path} | IP: ${req.ip}`);
      }
      return next();
    }

    const allowed = getAllowedOrigins();
    const isAllowed = allowed.some(
      (o) => source === o || source.startsWith(o)
    );

    if (!isAllowed) {
      console.warn(
        `🚫 [CSRF] Origin suspeito bloqueado: "${source}" → ${req.method} ${req.path} | IP: ${req.ip}`
      );
      res.status(403).json({
        error: 'Origem não autorizada',
        code: 'CSRF_ORIGIN_REJECTED',
      });
      return;
    }

    next();
  };
}
