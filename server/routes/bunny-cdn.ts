import { Router } from 'express';
import { getFirestore } from '../lib/firebase-admin';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { decryptSensitiveData } from '../security/key-encryption';
import { validateFile } from '../security/file-validator.js';
import { checkUploadAllowed, recordUpload, completeUpload } from '../security/upload-rate-limiter.js';
import { getBunnyCredentials as getBunnyCredentialsFromHelper } from '../lib/bunny-helper';
import multer from 'multer';
import fetch from 'node-fetch';
import sharp from 'sharp';

const router = Router();

// 📦 CONFIGURAR MULTER PARA UPLOAD DE CAPAS (APENAS - VÍDEOS VIA TUS URL)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB para capas de aula
  }
});

/**
 * 🐰 HELPER: BUSCAR CREDENCIAIS BUNNY.NET (FIREBASE FIRESTORE + FALLBACK ENV)
 */
async function getBunnyCredentials() {
  const credentials = await getBunnyCredentialsFromHelper();
  
  if (!credentials || !credentials.streamLibraryId || !credentials.streamApiKey) {
    console.error('❌ [BUNNY] Credenciais não encontradas no Firestore nem nas variáveis de ambiente');
    throw new Error('Bunny.net não configurado - verifique as configurações no painel admin');
  }
  
  return credentials;
}

/**
 * 🔓 ENDPOINT: CONFIGURAR BIBLIOTECA COMO PÚBLICA (SEM RESTRIÇÕES)
 * POST /api/bunny/library/make-public
 * 
 * ⚠️ ADMIN ONLY - Desativa autenticação e restrições da biblioteca
 */
router.post('/library/make-public', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🔓 [BUNNY-LIBRARY] Configurando biblioteca como pública...');
    
    const credentials = await getBunnyCredentials();
    
    const response = await fetch(
      `https://api.bunny.net/videolibrary/${credentials.streamLibraryId}`,
      {
        method: 'POST',
        headers: {
          'AccessKey': credentials.streamApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          EnableTokenAuthentication: false,
          EnableTokenIPVerification: false,
          PlayerTokenAuthenticationEnabled: false,
          AllowDirectPlay: true,
          BlockNoneReferrer: false
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bunny API error: ${error}`);
    }
    
    console.log('✅ [BUNNY-LIBRARY] Biblioteca configurada como PÚBLICA com sucesso!');
    
    res.json({
      success: true,
      message: 'Biblioteca Bunny Stream configurada como PÚBLICA! Todos os vídeos agora podem ser acessados sem restrições.'
    });
    
  } catch (error: any) {
    console.error('❌ [BUNNY-LIBRARY] Erro ao configurar biblioteca:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao configurar biblioteca',
      details: error.message
    });
  }
});

/**
 * 🎬 ENDPOINT: CRIAR VÍDEO NO BUNNY STREAM (RETORNA TUS UPLOAD URL)
 * POST /api/bunny/video/create
 * 
 * ✅ Sellers e admins podem criar vídeos no Bunny.net
 */
router.post('/video/create', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('🎬 [BUNNY-VIDEO] Criando vídeo no Bunny Stream...');
    
    const { title, collectionId } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Título do vídeo obrigatório'
      });
    }
    
    // Buscar credenciais
    const credentials = await getBunnyCredentials();
    
    // Criar vídeo no Bunny Stream
    const response = await fetch(
      `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos`,
      {
        method: 'POST',
        headers: {
          'AccessKey': credentials.streamApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          collectionId: collectionId || undefined
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bunny API error: ${error}`);
    }
    
    const videoData = await response.json() as any;
    
    console.log('✅ [BUNNY-VIDEO] Vídeo criado com sucesso:', videoData.guid);
    
    // 🎯 RETORNAR TUS UPLOAD URL PARA FRONTEND FAZER UPLOAD DIRETO
    res.json({
      success: true,
      message: 'Vídeo criado! Use o TUS upload URL para enviar o arquivo direto do frontend.',
      video: {
        guid: videoData.guid,
        title: videoData.title,
        // TUS upload URL para frontend fazer upload DIRETO (sem passar pelo servidor)
        tusUploadUrl: `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${videoData.guid}`,
        tusHeaders: {
          'AccessKey': credentials.streamApiKey,
        },
        thumbnailFileName: videoData.thumbnailFileName,
        status: videoData.status
      }
    });
    
  } catch (error: any) {
    console.error('❌ [BUNNY-VIDEO] Erro ao criar vídeo:');
    console.error('❌ [BUNNY-VIDEO] Error object:', error);
    console.error('❌ [BUNNY-VIDEO] Error message:', error?.message);
    console.error('❌ [BUNNY-VIDEO] Error stack:', error?.stack);
    console.error('❌ [BUNNY-VIDEO] Error type:', typeof error);
    res.status(500).json({
      success: false,
      error: 'Erro ao criar vídeo no Bunny Stream',
      details: error?.message || 'Erro desconhecido'
    });
  }
});

/**
 * 🎬 ENDPOINT: OBTER TUS UPLOAD CREDENTIALS (FRONTEND FAZ UPLOAD DIRETO)
 * GET /api/bunny/video/:guid/upload-credentials
 * 
 * ⚠️ ADMIN ONLY - Apenas admins podem obter credenciais de upload
 */
router.get('/video/:guid/upload-credentials', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { guid } = req.params;
    
    console.log(`🎬 [BUNNY-VIDEO] Gerando credenciais TUS para upload do vídeo ${guid}...`);
    
    // Buscar credenciais
    const credentials = await getBunnyCredentials();
    
    // Retornar TUS upload URL e headers para frontend
    res.json({
      success: true,
      tusUploadUrl: `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${guid}`,
      tusHeaders: {
        'AccessKey': credentials.streamApiKey,
      }
    });
    
  } catch (error: any) {
    console.error('❌ [BUNNY-VIDEO] Erro ao gerar credenciais TUS:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar credenciais de upload',
      details: error.message
    });
  }
});

/**
 * 📊 ENDPOINT: OBTER STATUS DO VÍDEO (TRANSCODIFICAÇÃO, DURAÇÃO, ETC)
 * GET /api/bunny/video/:guid
 * 
 * ⚠️ ADMIN ONLY - Apenas admins podem consultar status de vídeos
 */
router.get('/video/:guid', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { guid } = req.params;
    
    console.log(`📊 [BUNNY-VIDEO] Buscando status do vídeo ${guid}...`);
    
    // Buscar credenciais
    const credentials = await getBunnyCredentials();
    
    const response = await fetch(
      `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${guid}`,
      {
        headers: {
          'AccessKey': credentials.streamApiKey
        }
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bunny API error: ${error}`);
    }
    
    const videoData = await response.json() as any;
    
    res.json({
      success: true,
      video: {
        guid: videoData.guid,
        title: videoData.title,
        status: videoData.status,
        duration: videoData.length,
        thumbnailUrl: videoData.thumbnailFileName ? 
          `https://vz-${videoData.videoLibraryId}.b-cdn.net/${videoData.guid}/${videoData.thumbnailFileName}` : 
          null,
        hlsUrl: `https://iframe.mediadelivery.net/embed/${credentials.streamLibraryId}/${videoData.guid}`,
        encodeProgress: videoData.encodeProgress
      }
    });
    
  } catch (error: any) {
    console.error('❌ [BUNNY-VIDEO] Erro ao buscar status:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar status do vídeo',
      details: error.message
    });
  }
});

/**
 * 🗑️ ENDPOINT: DELETAR VÍDEO DO BUNNY STREAM
 * DELETE /api/bunny/video/:guid
 * 
 * ⚠️ ADMIN ONLY - Apenas admins podem deletar vídeos
 */
router.delete('/video/:guid', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { guid } = req.params;
    
    console.log(`🗑️ [BUNNY-VIDEO] Deletando vídeo ${guid}...`);
    
    // Buscar credenciais
    const credentials = await getBunnyCredentials();
    
    const response = await fetch(
      `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${guid}`,
      {
        method: 'DELETE',
        headers: {
          'AccessKey': credentials.streamApiKey
        }
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bunny API error: ${error}`);
    }
    
    console.log('✅ [BUNNY-VIDEO] Vídeo deletado com sucesso!');
    
    res.json({
      success: true,
      message: 'Vídeo deletado com sucesso do Bunny Stream!'
    });
    
  } catch (error: any) {
    console.error('❌ [BUNNY-VIDEO] Erro ao deletar vídeo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao deletar vídeo',
      details: error.message
    });
  }
});

/**
 * 🗑️🔥 ENDPOINT: CASCADE DELETE - APAGAR VÍDEOS + IMAGENS EM LOTE
 * POST /api/bunny/cleanup
 * 
 * USADO PARA DELEÇÃO EM CASCATA (DELETE CASCADE):
 * - Deletar aula → apaga vídeo + capa do Bunny.net
 * - Deletar módulo → apaga vídeos + capas de todas aulas
 * - Deletar produto → apaga vídeos + capas de todos módulos/aulas
 * 
 * ⚠️ ADMIN ONLY - Apenas admins podem fazer cleanup em lote
 */
router.post('/cleanup', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { videoGuids = [], imageUrls = [] } = req.body;
    
    console.log(`🗑️🔥 [BUNNY-CLEANUP] Iniciando cascade delete - Vídeos: ${videoGuids.length}, Imagens: ${imageUrls.length}`);
    
    // Buscar credenciais
    const credentials = await getBunnyCredentials();
    
    const results = {
      videosDeleted: 0,
      videosFailed: 0,
      imagesDeleted: 0,
      imagesFailed: 0,
      errors: [] as string[]
    };
    
    // DELETAR VÍDEOS DO BUNNY STREAM
    for (const guid of videoGuids) {
      if (!guid) continue;
      
      try {
        console.log(`🗑️ [BUNNY-CLEANUP] Deletando vídeo: ${guid}`);
        
        const response = await fetch(
          `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${guid}`,
          {
            method: 'DELETE',
            headers: {
              'AccessKey': credentials.streamApiKey
            }
          }
        );
        
        if (!response.ok) {
          throw new Error(`Bunny API error: ${response.status}`);
        }
        
        results.videosDeleted++;
        console.log(`✅ [BUNNY-CLEANUP] Vídeo deletado: ${guid}`);
      } catch (error: any) {
        results.videosFailed++;
        results.errors.push(`Erro ao deletar vídeo ${guid}: ${error.message}`);
        console.error(`❌ [BUNNY-CLEANUP] Falha ao deletar vídeo ${guid}:`, error.message);
      }
    }
    
    // DELETAR IMAGENS DO BUNNY STORAGE
    for (const imageUrl of imageUrls) {
      if (!imageUrl) continue;
      
      try {
        // Extrair path da imagem da URL (CDN ou proxy interno)
        let filePath: string | null = null;
        
        if (imageUrl.startsWith('/api/images/')) {
          filePath = imageUrl.replace('/api/images/', '');
        } else {
          const cdnPattern = /https?:\/\/[^/]+\.b-cdn\.net\/(.+)/;
          const match = imageUrl.match(cdnPattern);
          if (match) filePath = match[1];
        }
        
        if (!filePath) {
          throw new Error('URL de imagem não reconhecida: ' + imageUrl);
        }
        console.log(`🗑️ [BUNNY-CLEANUP] Deletando imagem: ${filePath}`);
        
        const response = await fetch(
          `https://storage.bunnycdn.com/${credentials.storageZoneName}/${filePath}`,
          {
            method: 'DELETE',
            headers: {
              'AccessKey': credentials.storageApiKey
            }
          }
        );
        
        if (!response.ok && response.status !== 404) {
          throw new Error(`Bunny Storage error: ${response.status}`);
        }
        
        results.imagesDeleted++;
        console.log(`✅ [BUNNY-CLEANUP] Imagem deletada: ${filePath}`);
      } catch (error: any) {
        results.imagesFailed++;
        results.errors.push(`Erro ao deletar imagem ${imageUrl}: ${error.message}`);
        console.error(`❌ [BUNNY-CLEANUP] Falha ao deletar imagem ${imageUrl}:`, error.message);
      }
    }
    
    console.log('✅ [BUNNY-CLEANUP] Cascade delete concluído:', results);
    
    res.json({
      success: true,
      message: 'Cascade delete concluído!',
      results
    });
    
  } catch (error: any) {
    console.error('❌ [BUNNY-CLEANUP] Erro fatal no cascade delete:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao fazer cleanup em cascata',
      details: error.message
    });
  }
});

/**
 * 📦 ENDPOINT: UPLOAD DE IMAGEM COM SEGURANÇA MILITAR + BUNNY STORAGE
 * POST /api/bunny/upload/image
 * 
 * 🛡️ PROTEÇÃO MILITAR:
 * - Magic bytes validation (detecta polyglots e malware)
 * - Rate limiting por IP + usuário
 * - Validação de proporção 2:3 para capas de aula
 * - Upload direto para Bunny.net CDN (95% mais barato que Firebase)
 * 
 * ⚠️ AUTENTICADO - Qualquer usuário logado pode fazer upload
 */
router.post('/upload/image', verifyFirebaseToken, upload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.uid;
    const category = req.body.category || 'lessons';
    const clientIp = req.ip || req.socket.remoteAddress || '0.0.0.0';
    
    console.log('🐰🛡️ [BUNNY-UPLOAD] Iniciando - User:', userId, 'Category:', category, 'IP:', clientIp);
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    if (!req.file) {
      console.log('❌ Nenhum arquivo recebido');
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    // 🛡️ VALIDAÇÃO DE SEGURANÇA MILITAR (MAGIC BYTES + RATE LIMITING)
    // 🚫 RATE LIMITING - VERIFICAR SE UPLOAD É PERMITIDO
    const rateLimitResult = checkUploadAllowed(clientIp, userId);
    if (!rateLimitResult.allowed) {
      console.warn(`🚫 [BUNNY-UPLOAD] Rate limit excedido - User: ${userId}, IP: ${clientIp}`);
      return res.status(429).json({
        success: false,
        error: rateLimitResult.reason || 'Limite de uploads excedido. Aguarde antes de tentar novamente.',
        retryAfter: rateLimitResult.retryAfter
      });
    }
    
    // 📝 REGISTRAR UPLOAD EM ANDAMENTO
    recordUpload(clientIp, userId);
    
    // 🛡️ TRY/FINALLY - GARANTE QUE completeUpload() SEJA SEMPRE CHAMADO (ANTI-LEAK!)
    try {
      // 🛡️ VALIDAÇÃO DE MAGIC BYTES + MIME TYPE
      const securityValidation = await validateFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        category
      );
      
      if (!securityValidation.valid) {
        console.error('❌ [BUNNY-UPLOAD] Validação de segurança falhou:', securityValidation.error);
        return res.status(400).json({
          success: false,
          error: securityValidation.error || 'Arquivo não passou na validação de segurança'
        });
      }
      
      console.log('✅ [BUNNY-UPLOAD] Validação de segurança APROVADA');
      
      // 📐 VALIDAÇÃO DE DIMENSÕES EXATAS 1410x2250 PARA CAPAS DE AULA (BACKEND - NÃO CONFIA NO FRONTEND!)
      if (category === 'lessons' || category === 'modules') {
        try {
          const img = sharp(req.file.buffer);
          const meta = await img.metadata();
          
          if (!meta.width || !meta.height) {
            throw new Error('Não foi possível ler dimensões da imagem');
          }
          
          // DIMENSÕES EXATAS OBRIGATÓRIAS: 1410x2250 pixels (proporção 2:3)
          const REQUIRED_WIDTH = 1410;
          const REQUIRED_HEIGHT = 2250;
          
          if (meta.width !== REQUIRED_WIDTH || meta.height !== REQUIRED_HEIGHT) {
            console.error(`❌ [BUNNY-UPLOAD] Dimensões incorretas: ${meta.width}x${meta.height} (esperado: ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT})`);
            return res.status(400).json({
              success: false,
              error: `A imagem deve ter EXATAMENTE ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT} pixels (proporção 2:3). A sua imagem tem ${meta.width}x${meta.height}px. Redimensione e tente novamente.`
            });
          }
          
          console.log(`✅ [BUNNY-UPLOAD] Dimensões 1410x2250 validadas: ${meta.width}x${meta.height}`);
        } catch (sharpError: any) {
          console.error('❌ [BUNNY-UPLOAD] Erro ao validar dimensões com Sharp:', sharpError.message);
          return res.status(500).json({
            success: false,
            error: 'Erro ao processar dimensões da imagem. Tente com outra imagem.',
            details: sharpError.message
          });
        }
      }
      
      // 🐰 BUSCAR CREDENCIAIS BUNNY.NET
      let credentials;
      try {
        credentials = await getBunnyCredentials();
        
        if (!credentials) {
          throw new Error('BUNNY_NOT_CONFIGURED');
        }
      } catch (error: any) {
        console.error('❌ [BUNNY-UPLOAD] Bunny.net não configurado:', error.message);
        
        // NORMALIZAR TODOS OS ERROS DE CONFIGURAÇÃO PARA 503 COM MENSAGEM ACIONÁVEL
        return res.status(503).json({
          success: false,
          error: 'Bunny.net CDN não está configurado. Por favor, configure as credenciais no painel de administração.',
          action: 'CONFIGURE_BUNNY',
          details: 'Acesse Configurações > Métodos de Pagamento > Bunny.net e ative o serviço.'
        });
      }
      
      // 📁 GERAR NOME ÚNICO DO ARQUIVO
      const fileExtension = req.file.originalname.split('.').pop() || 'jpg';
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `${category}/${userId}/${timestamp}-${randomId}.${fileExtension}`;
      
      console.log(`📦 [BUNNY-UPLOAD] Fazendo upload: ${fileName}`);
      
      // 🚀 UPLOAD PARA BUNNY STORAGE
      const storageUrl = `https://storage.bunnycdn.com/${credentials.storageZoneName}/${fileName}`;
      
      const response = await fetch(storageUrl, {
        method: 'PUT',
        headers: {
          'AccessKey': credentials.storageApiKey,
          'Content-Type': req.file.mimetype
        },
        body: req.file.buffer
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Bunny Storage error: ${error}`);
      }
      
      // 🌐 URL via proxy do servidor (evita problemas de CDN)
      const proxyUrl = `/api/images/${fileName}`;
      
      console.log('✅ [BUNNY-UPLOAD] Upload concluído com sucesso:', fileName);
      
      res.json({
        success: true,
        url: proxyUrl,
        fileName,
        category,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype
      });
      
    } catch (error: any) {
      console.error('❌ [BUNNY-UPLOAD] Erro crítico:');
      console.error('❌ [BUNNY-UPLOAD] Error object:', error);
      console.error('❌ [BUNNY-UPLOAD] Error message:', error?.message);
      console.error('❌ [BUNNY-UPLOAD] Error stack:', error?.stack);
      console.error('❌ [BUNNY-UPLOAD] Error type:', typeof error);
      res.status(500).json({
        success: false,
        error: 'Erro ao fazer upload da imagem',
        details: error?.message || 'Erro desconhecido'
      });
    } finally {
      // ✅ SEMPRE LIBERAR SLOT - ANTI-LEAK GARANTIDO!
      completeUpload();
      console.log('🔓 [BUNNY-UPLOAD] Slot de upload liberado');
    }
    
  } catch (error: any) {
    console.error('❌ [BUNNY-UPLOAD] Erro fatal externo:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

/**
 * 🗑️ ENDPOINT: DELETAR ARQUIVO DO BUNNY STORAGE
 * DELETE /api/bunny/storage/:path
 * 
 * ⚠️ ADMIN ONLY - Apenas admins podem deletar arquivos
 */
router.delete('/storage/*', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    // Capturar path completo (tudo depois de /storage/)
    const path = req.params[0];
    
    if (!path) {
      return res.status(400).json({
        success: false,
        error: 'Path obrigatório'
      });
    }
    
    console.log(`🗑️ [BUNNY-STORAGE] Deletando arquivo: ${path}`);
    
    // Buscar credenciais
    const credentials = await getBunnyCredentials();
    
    const storageUrl = `https://storage.bunnycdn.com/${credentials.storageZoneName}/${path}`;
    
    const response = await fetch(storageUrl, {
      method: 'DELETE',
      headers: {
        'AccessKey': credentials.storageApiKey
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bunny Storage error: ${error}`);
    }
    
    console.log('✅ [BUNNY-STORAGE] Arquivo deletado com sucesso!');
    
    res.json({
      success: true,
      message: 'Arquivo deletado com sucesso!'
    });
    
  } catch (error: any) {
    console.error('❌ [BUNNY-STORAGE] Erro ao deletar:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao deletar arquivo',
      details: error.message
    });
  }
});

/**
 * 🔓 AUTO-CONFIG: CONFIGURAR BUNNY STREAM COMO PÚBLICO NO STARTUP
 * Chamado automaticamente quando servidor inicia
 */
export async function autoConfigureBunnyPublic() {
  try {
    console.log('🔓 [AUTO-CONFIG] Tentando configurar Bunny Stream como público...');
    
    const credentials = await getBunnyCredentials();
    // api.bunny.net requer Account API Key (não a per-library key)
    const accountApiKey = process.env.BUNNY_ACCOUNT_API_KEY || credentials.streamApiKey;
    
    const response = await fetch(
      `https://api.bunny.net/videolibrary/${credentials.streamLibraryId}`,
      {
        method: 'POST',
        headers: {
          'AccessKey': accountApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          EnableTokenAuthentication: false,
          EnableTokenIPVerification: false,
          PlayerTokenAuthenticationEnabled: false,
          AllowDirectPlay: true,
          BlockNoneReferrer: false
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.warn('⚠️ [AUTO-CONFIG] Não foi possível auto-configurar Bunny:', error);
      return false;
    }
    
    console.log('✅ [AUTO-CONFIG] Bunny Stream configurado como PÚBLICO automaticamente!');
    console.log('✅ [AUTO-CONFIG] Todos os vídeos agora podem ser acessados sem restrições!');
    return true;
    
  } catch (error: any) {
    console.warn('⚠️ [AUTO-CONFIG] Auto-configuração do Bunny falhou (não crítico):', error.message);
    return false;
  }
}

export default router;
