// 📁 SISTEMA DEVASTADOR DE UPLOAD SEGURO
// Proteção total contra arquivos maliciosos, overflow de memória e abuse

import sharp from 'sharp';
import crypto from 'crypto';
import path from 'path';

// 🔍 MAGIC BYTES PARA VALIDAÇÃO REAL DE TIPOS
const MAGIC_BYTES = {
  // Imagens permitidas
  'image/jpeg': [
    [0xFF, 0xD8, 0xFF], // JPEG
    [0xFF, 0xD8, 0xFF, 0xE0], // JPEG/JFIF
    [0xFF, 0xD8, 0xFF, 0xE1] // JPEG/EXIF
  ],
  'image/png': [
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] // PNG
  ],
  'image/webp': [
    [0x52, 0x49, 0x46, 0x46] // RIFF (WebP usa RIFF)
  ],
  
  // PDFs permitidos (apenas para documentos)
  'application/pdf': [
    [0x25, 0x50, 0x44, 0x46] // %PDF
  ]
};

// 🛡️ CONFIGURAÇÃO DE LIMITES RIGOROSOS
const UPLOAD_LIMITS = {
  // Tamanhos máximos por tipo
  maxSizes: {
    'image/jpeg': 2 * 1024 * 1024,      // 2MB para JPEG
    'image/png': 3 * 1024 * 1024,       // 3MB para PNG (pode ser maior)
    'image/webp': 1.5 * 1024 * 1024,    // 1.5MB para WebP
    'application/pdf': 10 * 1024 * 1024  // 10MB para PDF
  },
  
  // Dimensões máximas para imagens
  maxDimensions: {
    width: 4096,   // Max 4K width
    height: 4096,  // Max 4K height
    pixels: 16777216 // Max 16MP (4096x4096)
  },
  
  // Limites para PDFs
  pdf: {
    maxPages: 50,      // Máximo 50 páginas
    maxFileSize: 10 * 1024 * 1024 // 10MB
  },
  
  // Processamento
  processing: {
    outputMaxWidth: 1920,    // Redimensionar para max 1920px
    outputMaxHeight: 1920,   // Redimensionar para max 1920px
    quality: 85,             // Qualidade de compressão
    webpQuality: 80          // Qualidade WebP
  }
};

interface UploadValidationResult {
  valid: boolean;
  errors: string[];
  fileInfo?: {
    originalName: string;
    mimeType: string;
    size: number;
    hash: string;
    dimensions?: { width: number; height: number };
  };
}

interface ProcessingResult {
  success: boolean;
  processedBuffer?: Buffer;
  originalHash: string;
  processedHash: string;
  metadata: {
    format: string;
    width: number;
    height: number;
    size: number;
    compressed: boolean;
  };
  errors?: string[];
}

// 🧠 ENGINE PRINCIPAL DE UPLOAD SEGURO
class SecureUploadEngine {
  private uploadHistory = new Map<string, { count: number; lastUpload: number }>();
  private blockedHashes = new Set<string>();
  
  // 🔍 VALIDAÇÃO COMPLETA DE ARQUIVO
  async validateFile(buffer: Buffer, originalName: string, mimeType: string): Promise<UploadValidationResult> {
    const errors: string[] = [];
    console.log(`📁 SECURE UPLOAD: Validating ${originalName} (${mimeType}) - ${buffer.length} bytes`);
    
    // 1️⃣ VERIFICAR TAMANHO BÁSICO
    if (buffer.length === 0) {
      errors.push('File is empty');
    }
    
    if (buffer.length > 50 * 1024 * 1024) { // Hard limit 50MB
      errors.push('File too large (max 50MB)');
    }
    
    // 2️⃣ GERAR HASH PARA DEDUPLICAÇÃO
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    // 3️⃣ VERIFICAR HASH BLOQUEADO
    if (this.blockedHashes.has(hash)) {
      errors.push('File is blocked (malicious content detected previously)');
    }
    
    // 4️⃣ VALIDAR MAGIC BYTES
    const magicValidation = this.validateMagicBytes(buffer, mimeType);
    if (!magicValidation.valid) {
      errors.push(`Invalid file type: ${magicValidation.reason}`);
    }
    
    // 5️⃣ VERIFICAR LIMITES POR TIPO
    const maxSize = UPLOAD_LIMITS.maxSizes[mimeType as keyof typeof UPLOAD_LIMITS.maxSizes];
    if (maxSize && buffer.length > maxSize) {
      errors.push(`File too large for type ${mimeType} (max ${this.formatBytes(maxSize)})`);
    }
    
    // 6️⃣ VALIDAÇÕES ESPECÍFICAS POR TIPO
    let dimensions: { width: number; height: number } | undefined;
    
    if (mimeType.startsWith('image/')) {
      const imageValidation = await this.validateImage(buffer);
      if (!imageValidation.valid) {
        errors.push(...imageValidation.errors);
      } else {
        dimensions = imageValidation.dimensions;
      }
    } else if (mimeType === 'application/pdf') {
      const pdfValidation = await this.validatePDF(buffer);
      if (!pdfValidation.valid) {
        errors.push(...pdfValidation.errors);
      }
    } else {
      errors.push(`Unsupported file type: ${mimeType}`);
    }
    
    // 7️⃣ VERIFICAR NOME DO ARQUIVO
    const nameValidation = this.validateFileName(originalName);
    if (!nameValidation.valid) {
      errors.push(...nameValidation.errors);
    }
    
    const result: UploadValidationResult = {
      valid: errors.length === 0,
      errors,
      fileInfo: errors.length === 0 ? {
        originalName,
        mimeType,
        size: buffer.length,
        hash,
        dimensions
      } : undefined
    };
    
    console.log(`📁 VALIDATION RESULT: ${result.valid ? '✅ VALID' : '❌ INVALID'} - Errors: [${errors.join(', ')}]`);
    
    return result;
  }
  
  // 🔮 VALIDAR MAGIC BYTES (DETECÇÃO REAL DE TIPO)
  private validateMagicBytes(buffer: Buffer, expectedMimeType: string): { valid: boolean; reason?: string } {
    const magicBytes = MAGIC_BYTES[expectedMimeType as keyof typeof MAGIC_BYTES];
    
    if (!magicBytes) {
      return { valid: false, reason: 'Unsupported file type' };
    }
    
    // Verificar se algum dos magic bytes bate
    for (const magic of magicBytes) {
      if (buffer.length >= magic.length) {
        const matches = magic.every((byte, index) => buffer[index] === byte);
        if (matches) {
          return { valid: true };
        }
      }
    }
    
    return { valid: false, reason: 'File content does not match declared type' };
  }
  
  // 🖼️ VALIDAÇÃO ESPECÍFICA DE IMAGENS
  private async validateImage(buffer: Buffer): Promise<{ valid: boolean; errors: string[]; dimensions?: { width: number; height: number } }> {
    const errors: string[] = [];
    
    try {
      const metadata = await sharp(buffer).metadata();
      
      if (!metadata.width || !metadata.height) {
        errors.push('Could not read image dimensions');
        return { valid: false, errors };
      }
      
      // Verificar dimensões
      if (metadata.width > UPLOAD_LIMITS.maxDimensions.width) {
        errors.push(`Image width too large (max ${UPLOAD_LIMITS.maxDimensions.width}px)`);
      }
      
      if (metadata.height > UPLOAD_LIMITS.maxDimensions.height) {
        errors.push(`Image height too large (max ${UPLOAD_LIMITS.maxDimensions.height}px)`);
      }
      
      const totalPixels = metadata.width * metadata.height;
      if (totalPixels > UPLOAD_LIMITS.maxDimensions.pixels) {
        errors.push(`Image resolution too high (max ${UPLOAD_LIMITS.maxDimensions.pixels} pixels)`);
      }
      
      // Verificar formato suportado
      if (!['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format || '')) {
        errors.push(`Unsupported image format: ${metadata.format}`);
      }
      
      // Verificar densidade (evitar imagens absurdamente densas)
      if (metadata.density && metadata.density > 600) {
        errors.push('Image density too high (possible vector-based attack)');
      }
      
      return {
        valid: errors.length === 0,
        errors,
        dimensions: { width: metadata.width, height: metadata.height }
      };
      
    } catch (error: any) {
      return {
        valid: false,
        errors: [`Invalid image file: ${error.message}`]
      };
    }
  }
  
  // 📄 VALIDAÇÃO ESPECÍFICA DE PDF
  private async validatePDF(buffer: Buffer): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      // Verificar estrutura básica do PDF
      const pdfString = buffer.toString('latin1');
      
      // Deve começar com %PDF
      if (!pdfString.startsWith('%PDF-')) {
        errors.push('Invalid PDF header');
      }
      
      // Verificar versão do PDF (aceitar apenas versões comuns)
      const versionMatch = pdfString.match(/%PDF-(\d+\.\d+)/);
      if (versionMatch) {
        const version = parseFloat(versionMatch[1]);
        if (version < 1.0 || version > 2.0) {
          errors.push(`Unsupported PDF version: ${version}`);
        }
      }
      
      // Verificar se tem estrutura válida (deve ter xref e trailer)
      if (!pdfString.includes('xref') || !pdfString.includes('trailer')) {
        errors.push('Invalid PDF structure (missing xref or trailer)');
      }
      
      // Estimar número de páginas (método simples)
      const pageMatches = pdfString.match(/\/Type\s*\/Page[^s]/g);
      const estimatedPages = pageMatches ? pageMatches.length : 0;
      
      if (estimatedPages > UPLOAD_LIMITS.pdf.maxPages) {
        errors.push(`PDF has too many pages (max ${UPLOAD_LIMITS.pdf.maxPages})`);
      }
      
      // Verificar por conteúdo suspeito
      const suspiciousPatterns = [
        /\/JavaScript/i,
        /\/JS/i,
        /\/OpenAction/i,
        /\/Launch/i,
        /eval\s*\(/i,
        /<script/i
      ];
      
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(pdfString)) {
          errors.push('PDF contains potentially malicious content');
          break;
        }
      }
      
    } catch (error: any) {
      errors.push(`PDF validation error: ${error.message}`);
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  // 📝 VALIDAÇÃO DE NOME DE ARQUIVO
  private validateFileName(fileName: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Verificar comprimento
    if (fileName.length > 255) {
      errors.push('Filename too long (max 255 characters)');
    }
    
    // Verificar caracteres inválidos
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(fileName)) {
      errors.push('Filename contains invalid characters');
    }
    
    // Verificar nomes reservados do Windows
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    const baseName = path.parse(fileName).name.toUpperCase();
    if (reservedNames.includes(baseName)) {
      errors.push('Filename uses reserved system name');
    }
    
    // Verificar extensão dupla (possível tentativa de bypass)
    const extensions = fileName.split('.').slice(1);
    if (extensions.length > 2) {
      errors.push('Multiple file extensions not allowed');
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  // 🔄 PROCESSAR E OTIMIZAR ARQUIVO
  async processFile(buffer: Buffer, mimeType: string, originalName: string): Promise<ProcessingResult> {
    console.log(`🔄 PROCESSING: ${originalName} (${mimeType})`);
    
    const originalHash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    try {
      if (mimeType.startsWith('image/')) {
        return await this.processImage(buffer, originalHash);
      } else if (mimeType === 'application/pdf') {
        // PDFs são mantidos como estão (apenas validados)
        return {
          success: true,
          processedBuffer: buffer,
          originalHash,
          processedHash: originalHash,
          metadata: {
            format: 'pdf',
            width: 0,
            height: 0,
            size: buffer.length,
            compressed: false
          }
        };
      } else {
        throw new Error(`Unsupported file type for processing: ${mimeType}`);
      }
    } catch (error: any) {
      console.error(`❌ PROCESSING ERROR: ${error.message}`);
      return {
        success: false,
        originalHash,
        processedHash: '',
        metadata: {
          format: 'unknown',
          width: 0,
          height: 0,
          size: 0,
          compressed: false
        },
        errors: [error.message]
      };
    }
  }
  
  // 🖼️ PROCESSAR IMAGEM (REDIMENSIONAR, OTIMIZAR, REMOVER EXIF)
  private async processImage(buffer: Buffer, originalHash: string): Promise<ProcessingResult> {
    const sharp_instance = sharp(buffer);
    const metadata = await sharp_instance.metadata();
    
    let needsProcessing = false;
    let pipeline = sharp_instance;
    
    // 1️⃣ REMOVER METADADOS EXIF (SEMPRE)
    pipeline = pipeline.rotate(); // Remove EXIF orientation and other metadata
    needsProcessing = true;
    
    // 2️⃣ REDIMENSIONAR SE NECESSÁRIO
    if (metadata.width && metadata.height) {
      const maxW = UPLOAD_LIMITS.processing.outputMaxWidth;
      const maxH = UPLOAD_LIMITS.processing.outputMaxHeight;
      
      if (metadata.width > maxW || metadata.height > maxH) {
        pipeline = pipeline.resize(maxW, maxH, {
          fit: 'inside',
          withoutEnlargement: true
        });
        needsProcessing = true;
      }
    }
    
    // 3️⃣ OTIMIZAR QUALIDADE
    const format = metadata.format;
    if (format === 'jpeg' || format === 'jpg') {
      pipeline = pipeline.jpeg({ 
        quality: UPLOAD_LIMITS.processing.quality,
        progressive: true,
        mozjpeg: true
      });
    } else if (format === 'png') {
      pipeline = pipeline.png({ 
        quality: UPLOAD_LIMITS.processing.quality,
        progressive: true,
        compressionLevel: 8
      });
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ 
        quality: UPLOAD_LIMITS.processing.webpQuality,
        effort: 6
      });
    }
    
    // 4️⃣ PROCESSAR SE NECESSÁRIO
    const processedBuffer = needsProcessing ? await pipeline.toBuffer() : buffer;
    const processedHash = crypto.createHash('sha256').update(processedBuffer).digest('hex');
    
    // 5️⃣ OBTER METADADOS FINAIS
    const finalMetadata = await sharp(processedBuffer).metadata();
    
    console.log(`✅ IMAGE PROCESSED: ${metadata.width}x${metadata.height} → ${finalMetadata.width}x${finalMetadata.height} | ${buffer.length} → ${processedBuffer.length} bytes`);
    
    return {
      success: true,
      processedBuffer,
      originalHash,
      processedHash,
      metadata: {
        format: finalMetadata.format || 'unknown',
        width: finalMetadata.width || 0,
        height: finalMetadata.height || 0,
        size: processedBuffer.length,
        compressed: processedBuffer.length < buffer.length
      }
    };
  }
  
  // 🔒 VERIFICAR RATE LIMITING DE UPLOAD
  checkUploadRateLimit(clientId: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const history = this.uploadHistory.get(clientId);
    
    if (!history) {
      this.uploadHistory.set(clientId, { count: 1, lastUpload: now });
      return { allowed: true };
    }
    
    // Reset counter if more than 1 hour passed
    if (now - history.lastUpload > 60 * 60 * 1000) {
      this.uploadHistory.set(clientId, { count: 1, lastUpload: now });
      return { allowed: true };
    }
    
    // Check limits
    const maxUploadsPerHour = 50; // 50 uploads por hora por usuário
    if (history.count >= maxUploadsPerHour) {
      const retryAfter = Math.ceil((60 * 60 * 1000 - (now - history.lastUpload)) / 1000);
      return { allowed: false, retryAfter };
    }
    
    // Update counter
    history.count++;
    history.lastUpload = now;
    this.uploadHistory.set(clientId, history);
    
    return { allowed: true };
  }
  
  // 🧹 LIMPEZA PERIÓDICA
  cleanup() {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 horas
    
    for (const [clientId, history] of this.uploadHistory.entries()) {
      if (now - history.lastUpload > maxAge) {
        this.uploadHistory.delete(clientId);
      }
    }
  }
  
  // 🚫 BLOQUEAR HASH MALICIOSO
  blockHash(hash: string) {
    this.blockedHashes.add(hash);
    console.log(`🚫 HASH BLOCKED: ${hash}`);
  }
  
  // 📊 FORMATAR BYTES
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// 🎯 SINGLETON GLOBAL
const secureUploadEngine = new SecureUploadEngine();

// Limpeza automática a cada hora
setInterval(() => {
  secureUploadEngine.cleanup();
}, 60 * 60 * 1000);

export { secureUploadEngine, SecureUploadEngine, UploadValidationResult, ProcessingResult, UPLOAD_LIMITS };