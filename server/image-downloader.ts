import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { nanoid } from 'nanoid';
import fetch from 'node-fetch';
import { getBunnyCredentials } from './lib/bunny-helper';

// 🖼️ SISTEMA AUTOMÁTICO DE DOWNLOAD DE IMAGENS EXTERNAS
// Aceita URLs de qualquer origem (Discord, Google, etc.) e salva no Bunny CDN

interface ImageDownloadResult {
  success: boolean;
  permanentUrl?: string;
  originalUrl?: string;
  error?: string;
}

// 🛡️ VALIDAR SE URL É SEGURA (PREVINE SSRF)
function isPrivateOrLocalIP(hostname: string): boolean {
  // Regex para detectar IPs privados e localhost
  const privateIPPatterns = [
    /^127\./,                    // 127.0.0.0/8 (localhost)
    /^10\./,                     // 10.0.0.0/8 (private)
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (private)
    /^192\.168\./,               // 192.168.0.0/16 (private)
    /^169\.254\./,               // 169.254.0.0/16 (link-local)
    /^0\./,                      // 0.0.0.0/8 (invalid)
    /^::1$/,                     // IPv6 localhost
    /^fc00::/,                   // IPv6 private
    /^fe80::/                    // IPv6 link-local
  ];
  
  // Verificar hostnames inseguros - SECURITY HARDENED
  const unsafeHosts = [
    '127.0.0.1', '::1',
    'local', 'internal', 'private', 'admin',
    'metadata.google.internal', // AWS/GCP metadata
    '169.254.169.254'           // AWS metadata IP
    // REMOVED: 'localhost' (DNS spoofing risk), '0.0.0.0' (CRITICAL: allows any IP)
  ];
  
  if (unsafeHosts.some(host => hostname.toLowerCase().includes(host))) {
    return true;
  }
  
  return privateIPPatterns.some(pattern => pattern.test(hostname));
}

// 🔍 DETECTAR SE É URL EXTERNA SEGURA
function isExternalImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  
  // Verificar se é URL interna do sistema
  if (url.includes('volatuspay.com') || url.includes('replit.dev') || url.startsWith('/uploads/')) {
    return false;
  }
  
  // Verificar se é URL válida
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false; // URL inválida
  }
  
  // 🛡️ PROTEÇÃO SSRF - Bloquear IPs privados e localhost
  if (isPrivateOrLocalIP(parsedUrl.hostname)) {
    console.warn(`🚨 SSRF BLOCKED: Tentativa de acesso a IP privado/localhost: ${parsedUrl.hostname}`);
    return false;
  }
  
  // Verificar se é HTTP/HTTPS válido
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    console.warn(`🚨 INVALID PROTOCOL: Protocolo não permitido: ${parsedUrl.protocol}`);
    return false;
  }
  
  // Verificar se parece com uma imagem
  const hasImageExtension = !!url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i);
  const isImageService = url.includes('discord') || url.includes('googleusercontent') || 
                         url.includes('imgur') || url.includes('postimg') || 
                         url.includes('cloudinary') || url.includes('unsplash');
  
  return hasImageExtension || isImageService;
}

// 📁 GARANTIR QUE DIRETÓRIO EXISTE
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Diretório criado: ${dirPath}`);
  }
}

// 🔗 DETECTAR EXTENSÃO DA URL
function getImageExtension(url: string): string {
  const match = url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)/i);
  if (match) return match[1].toLowerCase();
  
  // Fallback para URLs do Discord e outros
  if (url.includes('discord')) return 'png';
  if (url.includes('google')) return 'jpg';
  
  return 'png'; // Default
}

// 📥 DOWNLOAD DA IMAGEM PARA BUFFER (BUNNY UPLOAD)
function downloadImageToBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const timeout = 10000; // 10 segundos
    
    console.log(`📥 Iniciando download para buffer: ${url}`);
    
    const request = protocol.get(url, { timeout }, (response) => {
      // 🔐 SECURITY FIX: Verificar se é redirecionamento e validar destino
      if (response.statusCode !== undefined && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        console.log(`🔄 Redirecionamento detectado para: ${redirectUrl}`);
        
        // 🛡️ CRITICAL SSRF PROTECTION: Revalidar URL de destino antes do redirect
        try {
          const redirectParsed = new URL(redirectUrl);
          
          // Verificar se não é IP privado/localhost (previne SSRF via redirect)
          if (isPrivateOrLocalIP(redirectParsed.hostname)) {
            reject(new Error(`SSRF BLOCKED: Redirect para IP privado/localhost: ${redirectParsed.hostname}`));
            return;
          }
          
          // Verificar protocolo seguro
          if (!['https:', 'http:'].includes(redirectParsed.protocol)) {
            reject(new Error(`PROTOCOL BLOCKED: Protocolo não permitido: ${redirectParsed.protocol}`));
            return;
          }
          
          // Seguir redirecionamento apenas se seguro
          downloadImageToBuffer(redirectUrl)
            .then(resolve)
            .catch(reject);
        } catch (urlError: any) {
          reject(new Error(`INVALID REDIRECT URL: ${redirectUrl} - ${urlError.message}`));
        }
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Status ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const chunks: Buffer[] = [];
      
      response.on('data', (chunk) => chunks.push(chunk));
      
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`✅ Download concluído: ${buffer.length} bytes`);
        resolve(buffer);
      });
      
      response.on('error', (err) => {
        reject(err);
      });
      
    });
    
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout na conexão'));
    });
    
    request.on('error', (err) => {
      reject(err);
    });
  });
}

// 🐰 UPLOAD PARA BUNNY STORAGE CDN
async function uploadToBunnyStorage(buffer: Buffer, fileName: string, contentType: string): Promise<string | null> {
  const credentials = await getBunnyCredentials();
  
  if (!credentials || !credentials.storageApiKey || !credentials.storageZoneName) {
    console.log('⚠️ [BUNNY] Não configurado para imagens externas');
    return null;
  }
  
  const { storageApiKey, storageZoneName, storageRegion } = credentials;
  const folder = 'external-images';
  const fullPath = `${folder}/${fileName}`;
  
  const regionPrefix = storageRegion && storageRegion !== 'de' ? `${storageRegion}.` : '';
  const uploadUrl = `https://${regionPrefix}storage.bunnycdn.com/${storageZoneName}/${fullPath}`;
  
  console.log(`🐰 [BUNNY] Uploading external image to: ${fullPath}`);
  
  try {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': storageApiKey,
        'Content-Type': contentType,
      },
      body: buffer
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [BUNNY] Upload falhou - Status: ${response.status}, Response: ${errorText}`);
      return null;
    }
    
    const proxyUrl = `/api/images/${fullPath}`;
    console.log(`✅ [BUNNY] Upload OK: ${proxyUrl}`);
    
    return proxyUrl;
  } catch (bunnyError: any) {
    console.error(`❌ [BUNNY] Erro de rede no upload:`, bunnyError.message);
    return null;
  }
}

// 🔥 FUNÇÃO PRINCIPAL: PROCESSAR URL EXTERNA COM SEGURANÇA TOTAL - BUNNY CDN
export async function processExternalImageUrl(logoUrl: string): Promise<ImageDownloadResult> {
  try {
    if (!logoUrl || !isExternalImageUrl(logoUrl)) {
      return { 
        success: true, 
        permanentUrl: logoUrl,
        originalUrl: logoUrl 
      };
    }
    
    console.log(`🖼️ PROCESSANDO IMAGEM EXTERNA PARA BUNNY CDN: ${logoUrl}`);
    
    // 🛡️ VALIDAÇÃO ADICIONAL ANTES DO DOWNLOAD
    let parsedUrl;
    try {
      parsedUrl = new URL(logoUrl);
      
      // Re-verificar se não é IP privado (proteção extra)
      if (isPrivateOrLocalIP(parsedUrl.hostname)) {
        throw new Error(`SSRF BLOCKED: IP privado/localhost detectado: ${parsedUrl.hostname}`);
      }
    } catch (urlError: any) {
      console.error(`🚨 URL INVÁLIDA REJEITADA: ${logoUrl} - ${urlError.message}`);
      throw new Error(`URL inválida ou insegura: ${urlError.message}`);
    }
    
    // 🎯 GERAR NOME ÚNICO PARA ARQUIVO
    const fileExtension = getImageExtension(logoUrl);
    const uniqueId = nanoid(12);
    const timestamp = Date.now();
    const fileName = `logo_${timestamp}_${uniqueId}.${fileExtension}`;
    
    // Mapear extensão para content-type
    const contentTypeMap: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml'
    };
    const contentType = contentTypeMap[fileExtension] || 'image/png';
    
    // 📥 TENTAR DOWNLOAD COM MÚLTIPLAS TENTATIVAS
    let imageBuffer: Buffer | null = null;
    let lastError = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📥 Tentativa ${attempt}/3: Baixando ${logoUrl}`);
        imageBuffer = await downloadImageToBuffer(logoUrl);
        break;
      } catch (downloadError: any) {
        lastError = downloadError;
        console.warn(`⚠️ Tentativa ${attempt}/3 falhou: ${downloadError.message}`);
        
        // Aguardar antes da próxima tentativa (exceto na última)
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    // 🚨 SE TODAS AS TENTATIVAS FALHARAM - REJEITAR COMPLETAMENTE
    if (!imageBuffer || imageBuffer.length === 0) {
      console.error(`🚨 DOWNLOAD FALHOU COMPLETAMENTE após 3 tentativas: ${logoUrl}`);
      console.error(`🚨 Último erro: ${lastError?.message}`);
      throw new Error(`Falha no download da imagem após 3 tentativas: ${lastError?.message}`);
    }
    
    // 🐰 UPLOAD PARA BUNNY CDN
    const bunnyUrl = await uploadToBunnyStorage(imageBuffer, fileName, contentType);
    
    if (bunnyUrl) {
      console.log(`🎉 IMAGEM SALVA NO BUNNY CDN!`);
      console.log(`📥 Original: ${logoUrl}`);
      console.log(`💾 Permanente: ${bunnyUrl}`);
      console.log(`📊 Tamanho: ${imageBuffer.length} bytes`);
      
      return {
        success: true,
        permanentUrl: bunnyUrl,
        originalUrl: logoUrl
      };
    }
    
    // 🚨 BUNNY FALHOU - Rejeitar para segurança
    throw new Error('Falha no upload para Bunny CDN');
    
  } catch (error: any) {
    console.error(`❌ PROCESSAMENTO DE IMAGEM REJEITADO:`, error.message);
    
    // 🛡️ COMPORTAMENTO SEGURO: REJEITAR UPDATE EM VEZ DE MANTER URL EXTERNA
    return {
      success: false,
      error: `Processamento rejeitado por segurança: ${error.message}`,
      originalUrl: logoUrl
    };
  }
}

// 🖼️ MIDDLEWARE PARA SERVIR IMAGENS SALVAS
export function setupImageServing(app: any): void {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  
  // Servir imagens estaticamente
  app.use('/uploads', (req: any, res: any, next: any) => {
    // Headers para cache longo (imagens são permanentes)
    res.set({
      'Cache-Control': 'public, max-age=31536000', // 1 ano
      'Expires': new Date(Date.now() + 31536000000).toUTCString()
    });
    next();
  }, require('express').static(uploadsDir));
  
  console.log(`🖼️ Sistema de imagens permanentes ativo: /uploads`);
}