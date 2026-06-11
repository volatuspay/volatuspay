import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * 🏷️ ETAG MIDDLEWARE
 * Adiciona suporte a ETag para cache inteligente e otimização
 */
export function etagMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  
  res.json = function(body: any) {
    // Gera ETag baseado no conteúdo
    const content = JSON.stringify(body);
    const etag = `"${crypto.createHash('md5').update(content).digest('hex')}"`;
    
    // Define ETag header
    res.setHeader('ETag', etag);
    
    // Verifica If-None-Match para retornar 304 Not Modified
    const clientETag = req.headers['if-none-match'];
    if (clientETag === etag) {
      res.status(304).end();
      return res;
    }
    
    // Retorna resposta normal
    return originalJson(body);
  };
  
  next();
}
