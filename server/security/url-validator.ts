// 🔍 VALIDADOR ULTRA RIGOROSO DE URLs DE IMAGENS - IMPOSSÍVEL DE ABUSAR
// Previne URLs maliciosas, phishing, e ataques através de imagens

import { z } from 'zod';

interface URLValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedUrl?: string;
  warnings?: string[];
}

class URLValidator {
  // 🚨 DOMÍNIOS BLOQUEADOS - SITES PERIGOSOS/SUSPEITOS
  private readonly blockedDomains = new Set([
    // Domínios de phishing comuns
    'bit.ly', 'tinyurl.com', 'short.link', 't.co',
    // IPs locais/internos (previne SSRF) - SECURITY HARDENED
    '127.0.0.1', '10.', '192.168.', '172.',
    // REMOVED: 'localhost' (DNS spoofing risk), '0.0.0.0' (CRITICAL: allows any IP)
    // Domínios suspeitos
    'tempmail.', 'guerrillamail.', 'mailinator.',
    // Serviços de arquivo temporário
    'temp-share.', 'file.io', 'send.firefox.com'
  ]);

  // ✅ DOMÍNIOS PERMITIDOS PARA IMAGENS
  private readonly allowedImageDomains = new Set([
    'storage.googleapis.com',
    'firebasestorage.googleapis.com',
    'images.unsplash.com',
    'unsplash.com',
    'pexels.com',
    'pixabay.com',
    'imgur.com',
    'i.imgur.com',
    'cdn.jsdelivr.net',
    'raw.githubusercontent.com',
    'github.com',
    'gitlab.com',
    'cloudflare.com',
    'amazonaws.com',
    'azure.com',
    'dropbox.com',
    'drive.google.com',
    'onedrive.com'
  ]);

  // 📝 EXTENSÕES VÁLIDAS PARA IMAGENS
  private readonly validImageExtensions = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'
  ]);

  // 🔍 VALIDAÇÃO PRINCIPAL DE URL
  validateImageURL(url: string): URLValidationResult {
    try {
      // 1️⃣ VERIFICAÇÃO BÁSICA
      if (!url || url.trim().length === 0) {
        return { isValid: false, error: 'URL está vazia' };
      }

      const trimmedUrl = url.trim();

      // 2️⃣ VERIFICAR PROTOCOLO
      if (!trimmedUrl.startsWith('https://')) {
        return { 
          isValid: false, 
          error: 'Apenas URLs HTTPS são permitidas por segurança' 
        };
      }

      // 3️⃣ PARSE DA URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmedUrl);
      } catch {
        return { isValid: false, error: 'URL inválida' };
      }

      // 4️⃣ VERIFICAR DOMÍNIO BLOQUEADO
      const domain = parsedUrl.hostname.toLowerCase();
      for (const blockedDomain of this.blockedDomains) {
        if (domain.includes(blockedDomain)) {
          return { 
            isValid: false, 
            error: `Domínio não permitido: ${domain}` 
          };
        }
      }

      // 5️⃣ VERIFICAR SE É IP (previne SSRF)
      if (this.isIPAddress(domain)) {
        return { 
          isValid: false, 
          error: 'URLs com endereços IP não são permitidas' 
        };
      }

      // 6️⃣ VERIFICAR DOMÍNIO PERMITIDO
      const isDomainAllowed = Array.from(this.allowedImageDomains).some(
        allowedDomain => domain.includes(allowedDomain)
      );

      if (!isDomainAllowed) {
        return { 
          isValid: false, 
          error: `Domínio não autorizado: ${domain}. Use apenas serviços de imagem confiáveis.` 
        };
      }

      // 7️⃣ VERIFICAR EXTENSÃO (SE PRESENTE)
      const pathname = parsedUrl.pathname.toLowerCase();
      const hasValidExtension = Array.from(this.validImageExtensions).some(
        ext => pathname.endsWith(ext)
      );

      const warnings: string[] = [];
      if (!hasValidExtension && !pathname.includes('upload') && !pathname.includes('image')) {
        warnings.push('URL pode não ser uma imagem válida');
      }

      // 8️⃣ VERIFICAR TAMANHO DA URL (previne ataques de DoS)
      if (trimmedUrl.length > 2000) {
        return { 
          isValid: false, 
          error: 'URL muito longa (máximo 2000 caracteres)' 
        };
      }

      // 9️⃣ SANITIZAR URL
      const sanitizedUrl = this.sanitizeURL(trimmedUrl);

      return {
        isValid: true,
        sanitizedUrl,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      console.error('❌ Erro na validação de URL:', error);
      return { 
        isValid: false, 
        error: 'Erro interno na validação da URL' 
      };
    }
  }

  // 🔍 VERIFICAR SE É ENDEREÇO IP
  private isIPAddress(hostname: string): boolean {
    // IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(hostname)) {
      return true;
    }

    // IPv6
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    if (ipv6Regex.test(hostname)) {
      return true;
    }

    return false;
  }

  // 🧹 SANITIZAR URL
  private sanitizeURL(url: string): string {
    try {
      const parsedUrl = new URL(url);
      
      // Remove parâmetros suspeitos
      const suspiciousParams = ['javascript', 'data', 'vbscript', 'onload', 'onerror'];
      
      for (const param of suspiciousParams) {
        parsedUrl.searchParams.delete(param);
      }

      return parsedUrl.toString();
    } catch {
      return url; // Se não conseguir fazer parse, retorna original
    }
  }

  // 📊 ESTATÍSTICAS DE VALIDAÇÃO
  getValidationStats(): object {
    return {
      allowedDomains: this.allowedImageDomains.size,
      blockedDomains: this.blockedDomains.size,
      validExtensions: this.validImageExtensions.size
    };
  }
}

// 🌟 INSTÂNCIA SINGLETON
export const urlValidator = new URLValidator();

// 🛡️ SCHEMA RIGOROSO PARA VALIDAÇÃO ZOD
export const strictImageUrlSchema = z.string()
  .min(1, "URL da imagem é obrigatória")
  .max(2000, "URL muito longa (máximo 2000 caracteres)")
  .refine(
    (url) => url.startsWith('https://'),
    "Apenas URLs HTTPS são permitidas"
  )
  .refine(
    (url) => {
      const result = urlValidator.validateImageURL(url);
      return result.isValid;
    },
    (url) => {
      const result = urlValidator.validateImageURL(url);
      return result.error || "URL inválida";
    }
  )
  .transform((url) => {
    const result = urlValidator.validateImageURL(url);
    return result.sanitizedUrl || url;
  });

// 🔍 MIDDLEWARE PARA VALIDAÇÃO DE URLs EM REQUESTS
export function validateImageURLs(fields: string[]) {
  return (req: any, res: any, next: any) => {
    try {
      const errors: string[] = [];

      for (const field of fields) {
        const url = req.body[field];
        
        if (url && url.trim().length > 0) {
          // Permitir URLs internas do proxy de imagens (/api/images/...)
          if (url.startsWith('/api/images/') || url.startsWith('/uploads/')) {
            continue;
          }
          
          const result = urlValidator.validateImageURL(url);
          
          if (!result.isValid) {
            errors.push(`${field}: ${result.error}`);
          } else if (result.sanitizedUrl !== url) {
            // Atualizar com URL sanitizada
            req.body[field] = result.sanitizedUrl;
          }
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({
          error: 'URLs inválidas detectadas',
          details: errors,
          code: 'INVALID_IMAGE_URLS'
        });
      }

      next();
    } catch (error) {
      console.error('❌ Erro na validação de URLs:', error);
      next(); // Em caso de erro, permite a requisição
    }
  };
}

export default urlValidator;