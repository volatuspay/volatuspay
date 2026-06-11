import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';

/**
 * 🆔 X-REQUEST-ID MIDDLEWARE
 * Adiciona ID único para cada request para rastreabilidade SIEM
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Usa X-Request-ID do cliente se existir (para correlação), senão gera novo
  const requestId = req.headers['x-request-id'] as string || `req_${nanoid(12)}`;
  
  // Anexa ao request para logging
  (req as any).requestId = requestId;
  
  // Retorna no response header para o cliente
  res.setHeader('X-Request-ID', requestId);
  
  next();
}
