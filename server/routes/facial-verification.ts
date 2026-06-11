import express from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { ensureFirebaseReady, getFirestore } from '../lib/firebase-admin.js';
import { userRateLimit } from '../security/user-rate-limiter.js';
import { sanitizeForLogs, obfuscateKey } from '../security/key-encryption.js';
import { uploadToBunnyStorage } from '../lib/bunny-helper.js';
import { saveDataToBunny } from '../lib/bunny-data-storage.js';

const router = express.Router();

// 🎥 CONFIGURAÇÃO DO MULTER PARA VÍDEOS DE VERIFICAÇÃO FACIAL
const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
    fieldSize: 2 * 1024,
    fieldNameSize: 50,
    fields: 5
  },
  fileFilter: (req, file, cb) => {
    try {
      const allowedTypes = ['video/webm', 'video/mp4', 'video/quicktime', 'video/x-msvideo'];
      if (!allowedTypes.includes(file.mimetype)) {
        console.log(`❌ FACIAL VIDEO: Tipo rejeitado: ${file.mimetype}`);
        return cb(new Error('Tipo de vídeo não suportado. Use WebM ou MP4.'));
      }
      
      const maxNameLength = 100;
      if (file.originalname.length > maxNameLength) {
        return cb(new Error('Nome do arquivo muito longo'));
      }
      
      console.log(`✅ FACIAL VIDEO: Aceito ${file.originalname} (${file.mimetype})`);
      cb(null, true);
    } catch (error) {
      console.error('❌ FACIAL VIDEO fileFilter error:', error);
      cb(new Error('Erro ao validar arquivo de vídeo'));
    }
  }
});

// 🎥 ENDPOINT PARA UPLOAD DE VÍDEO DE VERIFICAÇÃO FACIAL (KYC)
router.post('/',
  userRateLimit('facial-verification'),
  uploadVideo.single('file'),
  async (req: any, res) => {
    try {
      console.log('🎥 FACIAL VERIFICATION - Iniciando processamento...');
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum vídeo foi enviado'
        });
      }
      
      const businessName = req.body.businessName || 'seller';
      const document = req.body.document || 'doc';
      const email = req.body.email || 'email';
      
      console.log('🏢 Facial Verification - Seller Info:', { 
        businessName: sanitizeForLogs(businessName), 
        document: obfuscateKey(document), 
        email: obfuscateKey(email) 
      });
      
      const sanitizeEmail = (email: string): string => {
        return email
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '_')
          .replace(/@/g, '_at_')
          .substring(0, 50);
      };
      
      const sanitizeDocument = (doc: string): string => {
        return doc
          .replace(/[^0-9]/g, '')
          .substring(0, 14);
      };
      
      const cleanEmail = sanitizeEmail(email);
      const cleanDoc = sanitizeDocument(document);
      
      // 📁 Estrutura de pastas: facial-verification/seller-email/
      const sellerFolder = cleanEmail || (req.user?.uid || 'anonymous');
      
      console.log(`🗂️ Pasta do seller para facial verification: ${sellerFolder}`);
      
      const timestamp = Date.now();
      
      const mimeToExt: Record<string, string> = {
        'video/webm': 'webm',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi'
      };
      const fileExtension = mimeToExt[req.file.mimetype] || 'webm';
      
      const fileName = `facial_${timestamp}_${nanoid(8)}.${fileExtension}`;
      
      const folderPath = `facial-verification/${sellerFolder}`;
      const storagePath = `${folderPath}/${fileName}`;
      console.log(`📂 Salvando vídeo no Bunny: ${storagePath}`);
      
      const bunnyResult = await uploadToBunnyStorage(
        storagePath,
        req.file.buffer,
        req.file.mimetype
      );
      
      if (!bunnyResult.success || !bunnyResult.url) {
        throw new Error(`Falha no upload para Bunny CDN: ${bunnyResult.error || 'desconhecido'}`);
      }
      
      const cdnUrl = `/uploads/${storagePath}`;
      
      // 📝 Registrar no Bunny (full data) + Firestore (lightweight index)
      const verificationLogId = `fv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const fullVerificationLog = {
        email: email,
        document: cleanDoc,
        bunnyUrl: cdnUrl,
        storagePath: `${folderPath}/${fileName}`,
        uploadedAt: new Date().toISOString(),
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        consentGranted: true,
        purpose: 'seller_kyc_registration',
        retentionDays: 365,
        storage: 'bunny-cdn'
      };

      saveDataToBunny('logs/facial-verification', verificationLogId, fullVerificationLog)
        .then(r => r.success && console.log(`☁️ Facial verification log ${verificationLogId} salvo no Bunny`))
        .catch(err => console.error('⚠️ Bunny facial verification log error:', err));

      await ensureFirebaseReady();
      const firestore = getFirestore();
      await firestore.collection('facialVerificationLogs').doc(verificationLogId).set({
        timestamp: new Date().toISOString(),
        sellerId: cleanEmail,
        email: email,
        bunnyUrl: cdnUrl,
        result: 'uploaded',
        confidence: 1.0
      });
      
      console.log(`✅ FACIAL VERIFICATION CONCLUÍDO - Vídeo salvo no Bunny CDN`);
      console.log(`🔗 URL CDN: ${cdnUrl}`);
      
      res.json({
        success: true,
        url: cdnUrl,
        path: `${folderPath}/${fileName}`,
        message: 'Vídeo de verificação facial salvo com sucesso no Bunny CDN'
      });
      
    } catch (error) {
      console.error('❌ Erro no upload de verificação facial:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao salvar vídeo de verificação facial',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
});

export default router;
