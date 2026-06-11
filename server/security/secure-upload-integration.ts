// 📁 INTEGRAÇÃO DO SISTEMA DE UPLOAD SEGURO
// Conecta o pipeline de segurança aos endpoints reais de upload

import multer from 'multer';
import { secureUploadEngine, UploadValidationResult, ProcessingResult } from './secure-upload';

// 🔧 CONFIGURAÇÃO DE MULTER SEGURO COM VALIDAÇÃO
const createSecureMulter = () => {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB hard limit
      files: 5, // Máximo 5 arquivos por request
      fieldSize: 10 * 1024, // 10KB para campos de texto
      fieldNameSize: 100, // 100 chars para nomes de campos
      fields: 10 // Máximo 10 campos não-arquivo
    },
    fileFilter: (req, file, cb) => {
      console.log(`📁 SECURE UPLOAD: Filtering ${file.originalname} (${file.mimetype})`);
      
      // Verificar tipo MIME permitido
      const allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
        'application/pdf'
      ];
      
      if (!allowedTypes.includes(file.mimetype)) {
        console.log(`❌ SECURE UPLOAD: Rejected type ${file.mimetype}`);
        return cb(new Error(`File type ${file.mimetype} not allowed`));
      }
      
      // Verificar nome do arquivo
      if (!file.originalname || file.originalname.length > 255) {
        return cb(new Error('Invalid filename'));
      }
      
      // Verificar caracteres suspeitos no nome
      const suspiciousChars = /[<>:"/\\|?*\x00-\x1f]/;
      if (suspiciousChars.test(file.originalname)) {
        return cb(new Error('Filename contains invalid characters'));
      }
      
      console.log(`✅ SECURE UPLOAD: Accepted ${file.originalname}`);
      cb(null, true);
    }
  });
};

// 🛡️ MIDDLEWARE DE UPLOAD SEGURO PRINCIPAL
export const secureUploadMiddleware = (fieldName: string = 'file', maxFiles: number = 1) => {
  const upload = createSecureMulter();
  const multerUpload = maxFiles === 1 ? upload.single(fieldName) : upload.array(fieldName, maxFiles);
  
  return [
    // 1️⃣ PROCESSAR UPLOAD COM MULTER
    (req: any, res: any, next: any) => {
      multerUpload(req, res, (err) => {
        if (err) {
          console.log(`❌ MULTER ERROR: ${err.message}`);
          
          if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
              return res.status(413).json({
                error: 'File too large',
                message: 'Maximum file size is 50MB',
                code: 'FILE_TOO_LARGE'
              });
            }
            if (err.code === 'LIMIT_FILE_COUNT') {
              return res.status(400).json({
                error: 'Too many files',
                message: `Maximum ${maxFiles} files allowed`,
                code: 'TOO_MANY_FILES'
              });
            }
          }
          
          return res.status(400).json({
            error: 'Upload error',
            message: err.message,
            code: 'UPLOAD_ERROR'
          });
        }
        
        next();
      });
    },
    
    // 2️⃣ VALIDAÇÃO E PROCESSAMENTO SEGURO
    async (req: any, res: any, next: any) => {
      try {
        const files = req.files || (req.file ? [req.file] : []);
        
        if (files.length === 0) {
          return res.status(400).json({
            error: 'No files uploaded',
            message: 'At least one file is required',
            code: 'NO_FILES'
          });
        }
        
        console.log(`📁 SECURE UPLOAD: Processing ${files.length} files`);
        
        // Verificar rate limiting de upload por usuário
        const clientId = req.user?.uid || req.ip || 'anonymous';
        const rateLimitResult = secureUploadEngine.checkUploadRateLimit(clientId);
        
        if (!rateLimitResult.allowed) {
          return res.status(429).json({
            error: 'Upload rate limit exceeded',
            message: 'Too many uploads, please try again later',
            retryAfter: rateLimitResult.retryAfter,
            code: 'UPLOAD_RATE_LIMIT'
          });
        }
        
        // Processar cada arquivo
        const results: any[] = [];
        const errors: string[] = [];
        
        for (const file of files) {
          try {
            console.log(`🔍 VALIDATING: ${file.originalname} (${file.size} bytes)`);
            
            // 🔍 VALIDAÇÃO COMPLETA
            const validation: UploadValidationResult = await secureUploadEngine.validateFile(
              file.buffer,
              file.originalname,
              file.mimetype
            );
            
            if (!validation.valid) {
              errors.push(`${file.originalname}: ${validation.errors.join(', ')}`);
              continue;
            }
            
            // 🔄 PROCESSAMENTO SEGURO
            const processing: ProcessingResult = await secureUploadEngine.processFile(
              file.buffer,
              file.mimetype,
              file.originalname
            );
            
            if (!processing.success) {
              errors.push(`${file.originalname}: Processing failed - ${processing.errors?.join(', ')}`);
              continue;
            }
            
            // ✅ ARQUIVO PROCESSADO COM SUCESSO
            results.push({
              originalName: file.originalname,
              processedHash: processing.processedHash,
              originalHash: processing.originalHash,
              size: processing.metadata.size,
              width: processing.metadata.width,
              height: processing.metadata.height,
              format: processing.metadata.format,
              compressed: processing.metadata.compressed,
              buffer: processing.processedBuffer // Para upload ao Firebase Storage
            });
            
            console.log(`✅ PROCESSED: ${file.originalname} - ${processing.metadata.size} bytes`);
            
          } catch (fileError: any) {
            console.error(`❌ FILE PROCESSING ERROR: ${file.originalname} - ${fileError.message}`);
            errors.push(`${file.originalname}: ${fileError.message}`);
          }
        }
        
        // Verificar se algum arquivo foi processado com sucesso
        if (results.length === 0) {
          return res.status(400).json({
            error: 'No files could be processed',
            message: 'All files failed validation or processing',
            details: errors,
            code: 'ALL_FILES_FAILED'
          });
        }
        
        // Adicionar resultados à request para uso posterior
        req.secureUploadResults = {
          processedFiles: results,
          errors: errors.length > 0 ? errors : undefined,
          totalProcessed: results.length,
          totalErrors: errors.length
        };
        
        console.log(`📁 SECURE UPLOAD COMPLETE: ${results.length} processed, ${errors.length} errors`);
        
        next();
        
      } catch (error: any) {
        console.error('❌ Secure upload middleware error:', error);
        return res.status(500).json({
          error: 'Upload processing failed',
          message: 'Internal error during file processing',
          code: 'PROCESSING_ERROR'
        });
      }
    }
  ];
};

// 🎯 MIDDLEWARE ESPECÍFICO PARA IMAGENS DE PRODUTOS
export const secureProductImageUpload = secureUploadMiddleware('productImage', 5);

// 🎯 MIDDLEWARE ESPECÍFICO PARA DOCUMENTOS
export const secureDocumentUpload = secureUploadMiddleware('document', 3);

// 🎯 MIDDLEWARE ESPECÍFICO PARA AVATAR
export const secureAvatarUpload = secureUploadMiddleware('avatar', 1);

// 📊 MIDDLEWARE PARA ESTATÍSTICAS DE UPLOAD
export const uploadStatsMiddleware = (req: any, res: any, next: any) => {
  // Interceptar response para registrar estatísticas
  const originalSend = res.send;
  
  res.send = function(data: any) {
    if (req.secureUploadResults) {
      console.log(`📊 UPLOAD STATS: User=${req.user?.uid || 'anonymous'} Files=${req.secureUploadResults.totalProcessed} Errors=${req.secureUploadResults.totalErrors}`);
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

// 🧹 MIDDLEWARE PARA LIMPEZA DE BUFFERS
export const cleanupBuffersMiddleware = (req: any, res: any, next: any) => {
  // Limpar buffers após response para economizar memória
  res.on('finish', () => {
    if (req.secureUploadResults?.processedFiles) {
      req.secureUploadResults.processedFiles.forEach((file: any) => {
        if (file.buffer) {
          file.buffer = null; // Liberar memória
        }
      });
    }
  });
  
  next();
};