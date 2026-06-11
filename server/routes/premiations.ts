import { Router } from 'express';
import { verifyFirebaseToken, requireAdmin, AuthenticatedRequest } from '../security/firebase-auth.js';
import { uploadToBunnyStorage } from '../lib/bunny-helper.js';
import { neonQuery } from '../lib/neon-db.js';
import multer from 'multer';
import { nanoid } from 'nanoid';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

const validateMagicBytes = (req: any, res: any, next: any) => {
  if (!req.file || !req.file.buffer) return next();
  const buffer = req.file.buffer;
  const mimeType = req.file.mimetype;
  const magicBytes: Record<string, number[][]> = {
    'image/jpeg': [[0xFF, 0xD8, 0xFF]],
    'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
    'image/webp': [[0x52, 0x49, 0x46, 0x46]]
  };
  const expectedBytes = magicBytes[mimeType];
  if (!expectedBytes) {
    return res.status(400).json({ success: false, message: 'Tipo de arquivo não reconhecido' });
  }
  let isValid = false;
  for (const expected of expectedBytes) {
    if (buffer.length >= expected.length) {
      isValid = expected.every((byte, index) => buffer[index] === byte);
      if (isValid) break;
    }
  }
  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Conteúdo do arquivo não corresponde ao tipo declarado' });
  }
  next();
};

router.get('/premiations', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    let premiations: any[] = [];
    await neonQuery(async (sql) => {
      premiations = await sql`SELECT id, milestone_value, title, description, image_url, created_at FROM premiations ORDER BY milestone_value ASC`;
    }, 'getPremiations');
    res.json(premiations.map(r => ({
      id: r.id,
      milestoneValue: Number(r.milestone_value),
      title: r.title,
      description: r.description || '',
      imageUrl: r.image_url || '',
    })));
  } catch (error: any) {
    console.error('❌ [PREMIATIONS] Erro ao buscar premiações:', error);
    res.status(500).json({ error: 'Erro ao buscar premiações' });
  }
});

router.get('/admin/premiations', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    let premiations: any[] = [];
    await neonQuery(async (sql) => {
      premiations = await sql`SELECT id, milestone_value, title, description, image_url, created_at FROM premiations ORDER BY milestone_value ASC`;
    }, 'adminGetPremiations');
    res.json(premiations.map(r => ({
      id: r.id,
      milestoneValue: Number(r.milestone_value),
      title: r.title,
      description: r.description || '',
      imageUrl: r.image_url || '',
    })));
  } catch (error: any) {
    console.error('❌ Erro ao buscar premiações:', error);
    res.status(500).json({ error: 'Erro ao buscar premiações' });
  }
});

router.post('/admin/premiations', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { milestoneValue, title, description, imageUrl } = req.body;
    if (!milestoneValue || !title || !imageUrl) {
      return res.status(400).json({ error: 'Campos obrigatórios: milestoneValue, title, imageUrl' });
    }

    let existing: any[] = [];
    await neonQuery(async (sql) => {
      existing = await sql`SELECT id FROM premiations WHERE milestone_value = ${milestoneValue} LIMIT 1`;
    }, 'checkDupPremiation');

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Já existe uma premiação cadastrada para essa meta.' });
    }

    const id = nanoid(20);
    await neonQuery(async (sql) => {
      await sql`
        INSERT INTO premiations (id, milestone_value, title, description, image_url, created_at)
        VALUES (${id}, ${milestoneValue}, ${title}, ${description || ''}, ${imageUrl}, NOW())
      `;
    }, 'createPremiation');

    console.log('✅ Premiação criada:', id);
    res.json({ id, milestoneValue, title, description: description || '', imageUrl, createdAt: new Date().toISOString() });
  } catch (error: any) {
    console.error('❌ Erro ao criar premiação:', error);
    res.status(500).json({ error: 'Erro ao criar premiação' });
  }
});

router.put('/admin/premiations/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { milestoneValue, title, description, imageUrl } = req.body;
    if (!milestoneValue || !title || !imageUrl) {
      return res.status(400).json({ error: 'Campos obrigatórios: milestoneValue, title, imageUrl' });
    }

    let existing: any[] = [];
    await neonQuery(async (sql) => {
      existing = await sql`SELECT id FROM premiations WHERE milestone_value = ${milestoneValue} AND id != ${id} LIMIT 1`;
    }, 'checkDupPremiationUpdate');

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Já existe outra premiação cadastrada para essa meta.' });
    }

    await neonQuery(async (sql) => {
      await sql`
        UPDATE premiations SET milestone_value = ${milestoneValue}, title = ${title}, description = ${description || ''}, image_url = ${imageUrl}, updated_at = NOW()
        WHERE id = ${id}
      `;
    }, 'updatePremiation');

    console.log('✅ Premiação atualizada:', id);
    res.json({ id, milestoneValue, title, description: description || '', imageUrl, updatedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar premiação:', error);
    res.status(500).json({ error: 'Erro ao atualizar premiação' });
  }
});

router.delete('/admin/premiations/:id', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    await neonQuery(async (sql) => {
      await sql`DELETE FROM premiations WHERE id = ${id}`;
    }, 'deletePremiation');
    console.log('✅ Premiação deletada:', id);
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('❌ Erro ao deletar premiação:', error);
    res.status(500).json({ error: 'Erro ao deletar premiação' });
  }
});

router.post('/upload/premiation',
  verifyFirebaseToken,
  requireAdmin,
  upload.single('file'),
  validateMagicBytes,
  async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Nenhum arquivo foi enviado' });
      }
      if (!req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({ success: false, message: 'Apenas imagens são permitidas para premiações' });
      }
      const timestamp = Date.now();
      const mimeToExt: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const fileExtension = mimeToExt[req.file.mimetype] || 'jpg';
      const fileName = `premiation_${timestamp}_${nanoid(8)}.${fileExtension}`;
      const storagePath = `premiations/${fileName}`;

      const bunnyResult = await uploadToBunnyStorage(storagePath, req.file.buffer, req.file.mimetype);
      if (!bunnyResult.success || !bunnyResult.url) {
        throw new Error(`Falha no upload para Bunny CDN: ${bunnyResult.error || 'desconhecido'}`);
      }

      res.json({ success: true, url: bunnyResult.url, path: storagePath });
    } catch (error) {
      console.error('❌ Erro no upload de premiation:', error);
      res.status(500).json({ success: false, message: 'Erro ao salvar imagem', error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }
);

export default router;
