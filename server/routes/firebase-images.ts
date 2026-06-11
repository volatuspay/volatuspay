import { Router } from 'express';
import { verifyFirebaseToken } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { uploadToBunnyStorage } from '../lib/bunny-helper.js';
import multer from 'multer';
import { nanoid } from 'nanoid';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  }
});

router.post('/upload/image',
  verifyFirebaseToken,
  upload.single('file'),
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Nenhum arquivo foi enviado'
        });
      }
      
      if (!req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({
          success: false,
          error: 'Apenas imagens são permitidas'
        });
      }
      
      const category = req.body.category || 'products';
      const userId = req.user?.uid || 'unknown';
      
      const timestamp = Date.now();
      const mimeToExt: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp'
      };
      const fileExtension = mimeToExt[req.file.mimetype] || 'jpg';
      const fileName = `${timestamp}_${nanoid(8)}.${fileExtension}`;
      const storagePath = `${category}/${userId}/${fileName}`;
      
      console.log(`📤 [UPLOAD] Iniciando upload: ${storagePath} (${(req.file.size / 1024).toFixed(1)}KB)`);
      
      let publicUrl: string | null = null;
      let storage = 'unknown';
      
      const bunnyResult = await uploadToBunnyStorage(
        storagePath, req.file.buffer, req.file.mimetype,
        { skipFirebaseFallback: true }
      );
      
      if (bunnyResult.success && bunnyResult.url) {
        publicUrl = bunnyResult.url;
        storage = 'bunny-cdn';
        console.log(`✅ [BUNNY] Upload concluído: ${publicUrl}`);
      }
      
      if (!publicUrl) {
        console.error(`❌ [BUNNY] Falha no upload: ${bunnyResult.error || 'desconhecido'}`);
        throw new Error('Erro ao salvar imagem. Tente novamente.');
      }
      
      console.log(`✅ [UPLOAD] Concluído via ${storage}: ${publicUrl}`);
      
      res.json({
        success: true,
        url: publicUrl,
        path: storagePath,
        category,
        storage,
        fileName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype
      });
      
    } catch (error) {
      console.error('❌ Erro no upload:', error);
      res.status(500).json({
        success: false,
        error: 'Erro ao salvar imagem',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
});

export default router;
