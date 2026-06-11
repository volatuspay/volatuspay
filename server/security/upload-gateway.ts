/**
 * 🛡️ UPLOAD GATEWAY - ORQUESTRADOR DE SEGURANÇA
 * Gateway centralizado para processar todos os uploads com segurança MILITAR:
 * - Validação de arquivo com magic bytes
 * - Rate limiting inteligente
 * - Quarentena temporária
 * - Logging completo
 * - Integração com Bunny CDN Storage
 */

import { validateFile, detectPolyglot, sanitizeFilename } from './file-validator.js';
import { checkUploadAllowed, recordUpload, completeUpload } from './upload-rate-limiter.js';
import { uploadToSellerFolder, uploadToBunnyStorage, SellerFolderType, getSellerFolderPath, deleteBunnyStorageFile } from '../lib/bunny-helper.js';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';

function saveLocalFallback(buffer: Buffer, category: string, filename: string): string {
  const uploadsDir = path.join(process.cwd(), 'uploads', 'images');
  const categoryDir = path.join(uploadsDir, category);
  if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });
  const filePath = path.join(categoryDir, filename);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/images/${category}/${filename}`;
}

export interface UploadOptions {
  category: string;
  userId?: string;
  ip: string;
  tenantId?: string;
  sellerEmail?: string; // Email do vendedor para organizar por pasta
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
  retryAfter?: number;
  details?: {
    filename: string;
    size: number;
    mimeType: string;
    category: string;
  };
}

/**
 * 🚀 PROCESSAR UPLOAD SEGURO
 */
export async function processSecureUpload(options: UploadOptions): Promise<UploadResult> {
  const startTime = Date.now();
  
  try {
    console.log(`🛡️ [UPLOAD-GATEWAY] Iniciando upload seguro:`, {
      category: options.category,
      filename: options.originalFilename,
      size: options.buffer.length,
      userId: options.userId,
      ip: options.ip
    });
    
    // 1️⃣ VERIFICAR RATE LIMIT
    const rateLimitCheck = checkUploadAllowed(options.ip, options.userId);
    if (!rateLimitCheck.allowed) {
      console.warn(`⛔ [UPLOAD-GATEWAY] Rate limit excedido: ${options.ip}`);
      return {
        success: false,
        error: rateLimitCheck.reason,
        retryAfter: rateLimitCheck.retryAfter
      };
    }
    
    // Registrar upload (para rate limiting)
    recordUpload(options.ip, options.userId);
    
    try {
      // 2️⃣ VALIDAR ARQUIVO COM MAGIC BYTES
      const validation = await validateFile(
        options.buffer,
        options.originalFilename,
        options.mimeType,
        options.category
      );
      
      if (!validation.valid) {
        console.error(`❌ [UPLOAD-GATEWAY] Validação falhou:`, validation.error);
        return {
          success: false,
          error: validation.error
        };
      }
      
      // 3️⃣ DETECTAR POLYGLOT (arquivo válido em múltiplos formatos)
      if (detectPolyglot(options.buffer)) {
        console.error(`🚨 [UPLOAD-GATEWAY] POLYGLOT DETECTADO! Bloqueando por segurança.`);
        return {
          success: false,
          error: 'Arquivo suspeito detectado (polyglot). Upload bloqueado por segurança.'
        };
      }
      
      // 4️⃣ GERAR NOME ÚNICO SEGURO
      const sanitized = validation.sanitizedFilename || sanitizeFilename(options.originalFilename);
      const ext = validation.detectedExtension || sanitized.split('.').pop();
      const uniqueId = nanoid(12);
      const finalFilename = `${uniqueId}_${Date.now()}.${ext}`;
      
      // 5️⃣ UPLOAD PARA BUNNY CDN (COM FALLBACK FIREBASE)
      
      // Mapear categoria para tipo de pasta do vendedor
      const categoryToFolderType: Record<string, SellerFolderType> = {
        'products': 'produtos',
        'produtos': 'produtos',
        'vitrine': 'vitrine',
        'showcase': 'vitrine',
        'orders': 'ordens',
        'ordens': 'ordens',
        'sales': 'vendas',
        'vendas': 'vendas',
        'members': 'area-membros',
        'area-membros': 'area-membros',
        'videos': 'videos',
        'avatars': 'avatars',
        'banners': 'banners',
        'checkout': 'checkout'
      };
      
      let publicUrl: string;
      let storagePath: string;
      
      // 🗂️ SE TIVER EMAIL DO VENDEDOR, USAR PASTA ORGANIZADA NO BUNNY
      if (options.sellerEmail && categoryToFolderType[options.category.toLowerCase()]) {
        const folderType = categoryToFolderType[options.category.toLowerCase()];
        
        console.log(`📁 [UPLOAD-GATEWAY] Usando pasta do vendedor: ${options.sellerEmail} -> ${folderType}`);
        
        const bunnyResult = await uploadToSellerFolder(
          options.sellerEmail,
          folderType,
          finalFilename,
          options.buffer,
          validation.mimeType
        );
        
        if (bunnyResult.success && bunnyResult.url) {
          publicUrl = bunnyResult.url;
          storagePath = bunnyResult.path || getSellerFolderPath(options.sellerEmail!, folderType, finalFilename);
          console.log(`✅ [UPLOAD-GATEWAY] Upload Bunny OK: ${publicUrl}`);
        } else {
          console.warn(`⚠️ [UPLOAD-GATEWAY] Bunny indisponível, salvando localmente: ${bunnyResult.error || 'desconhecido'}`);
          publicUrl = saveLocalFallback(options.buffer, options.category, finalFilename);
          storagePath = publicUrl;
          console.log(`✅ [UPLOAD-GATEWAY] Fallback local OK: ${publicUrl}`);
        }
      } else {
        const categoryPath = options.tenantId 
          ? `${options.category}/${options.tenantId}/${finalFilename}`
          : `${options.category}/${finalFilename}`;
        
        const bunnyResult = await uploadToBunnyStorage(
          categoryPath,
          options.buffer,
          validation.mimeType || options.mimeType
        );
        
        if (bunnyResult.success && bunnyResult.url) {
          publicUrl = bunnyResult.url;
          storagePath = categoryPath;
          console.log(`✅ [UPLOAD-GATEWAY] Upload Bunny OK: ${publicUrl}`);
        } else {
          console.warn(`⚠️ [UPLOAD-GATEWAY] Bunny indisponível, salvando localmente: ${bunnyResult.error || 'desconhecido'}`);
          publicUrl = saveLocalFallback(options.buffer, options.category, finalFilename);
          storagePath = publicUrl;
          console.log(`✅ [UPLOAD-GATEWAY] Fallback local OK: ${publicUrl}`);
        }
      }
      
      const duration = Date.now() - startTime;
      
      console.log(`✅ [UPLOAD-GATEWAY] Upload concluído com sucesso:`, {
        filename: finalFilename,
        url: publicUrl,
        size: validation.size,
        duration: `${duration}ms`
      });
      
      return {
        success: true,
        url: publicUrl,
        details: {
          filename: finalFilename,
          size: validation.size || 0,
          mimeType: validation.mimeType || options.mimeType,
          category: options.category
        }
      };
      
    } finally {
      // Marcar upload como concluído (sempre, mesmo se falhar)
      completeUpload();
    }
    
  } catch (error: any) {
    console.error(`❌ [UPLOAD-GATEWAY] Erro crítico no upload:`, error);
    completeUpload(); // Garantir que decrementa contador
    
    return {
      success: false,
      error: error.message || 'Erro interno ao processar upload'
    };
  }
}

/**
 * 🗑️ DELETAR ARQUIVO DO STORAGE (BUNNY CDN)
 */
export async function deleteFromStorage(url: string): Promise<boolean> {
  try {
    if (!url) return true;
    
    console.log(`🐰 [UPLOAD-GATEWAY] Deletando arquivo: ${url}`);
    
    const urlObj = new URL(url);
    const filePath = urlObj.pathname.substring(1);
    
    const deleted = await deleteBunnyStorageFile(filePath);
    
    if (deleted) {
      console.log(`✅ [UPLOAD-GATEWAY] Arquivo deletado: ${filePath}`);
      return true;
    } else {
      console.error(`❌ [UPLOAD-GATEWAY] Erro ao deletar arquivo: ${filePath}`);
      return false;
    }
  } catch (error: any) {
    console.error(`❌ [UPLOAD-GATEWAY] Erro ao deletar arquivo:`, error);
    return false;
  }
}
