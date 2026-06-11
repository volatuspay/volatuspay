/**
 * 🛡️ FILE VALIDATOR - MILITARY-GRADE SECURITY
 * Validação RIGOROSA de arquivos para prevenir ataques:
 * - Magic bytes validation (detecta arquivo real vs fake)
 * - File type spoofing prevention
 * - Polyglot file detection
 * - Malicious content scanning
 * - Path traversal prevention
 * - Resource exhaustion protection
 */

import path from 'path';

// 🔐 MAGIC BYTES SIGNATURES - Assinaturas hexadecimais para cada tipo de arquivo
const MAGIC_BYTES: Record<string, { signature: number[][]; offset: number; extension: string[] }> = {
  // Imagens
  'image/jpeg': {
    signature: [[0xFF, 0xD8, 0xFF]],
    offset: 0,
    extension: ['jpg', 'jpeg']
  },
  'image/png': {
    signature: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
    offset: 0,
    extension: ['png']
  },
  'image/gif': {
    signature: [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    offset: 0,
    extension: ['gif']
  },
  'image/webp': {
    signature: [[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]],
    offset: 0,
    extension: ['webp']
  },
  
  // Vídeos
  'video/mp4': {
    signature: [[0x66, 0x74, 0x79, 0x70]],
    offset: 4,
    extension: ['mp4', 'm4v']
  },
  'video/webm': {
    signature: [[0x1A, 0x45, 0xDF, 0xA3]],
    offset: 0,
    extension: ['webm']
  },
  'video/quicktime': {
    signature: [[0x66, 0x74, 0x79, 0x70]],
    offset: 4,
    extension: ['mov']
  },
  
  // Áudio
  'audio/mpeg': {
    signature: [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0x49, 0x44, 0x33]],
    offset: 0,
    extension: ['mp3']
  },
  'audio/wav': {
    signature: [[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]],
    offset: 0,
    extension: ['wav']
  },
  
  // Documentos
  'application/pdf': {
    signature: [[0x25, 0x50, 0x44, 0x46, 0x2D]],
    offset: 0,
    extension: ['pdf']
  },
  
  // Executáveis (BLOQUEADOS)
  'application/x-msdownload': {
    signature: [[0x4D, 0x5A]],
    offset: 0,
    extension: ['exe', 'dll']
  }
};

// 🚫 TIPOS DE ARQUIVO BLOQUEADOS (executáveis, scripts, etc)
const BLOCKED_TYPES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'text/x-sh',
  'text/x-python',
  'text/x-php',
  'application/javascript',
  'text/html'
];

// 📏 LIMITES DE TAMANHO POR CATEGORIA
const SIZE_LIMITS: Record<string, number> = {
  'images': 5 * 1024 * 1024,        // 5MB para imagens
  'videos': 500 * 1024 * 1024,      // 500MB para vídeos
  'audio': 50 * 1024 * 1024,        // 50MB para áudio
  'documents': 10 * 1024 * 1024,    // 10MB para documentos
  'default': 5 * 1024 * 1024        // 5MB padrão
};

// ✅ EXTENSÕES PERMITIDAS POR CATEGORIA
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  'images': ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  'videos': ['mp4', 'webm', 'mov'],
  'audio': ['mp3', 'wav', 'ogg'],
  'documents': ['pdf'],
  'lessons': ['jpg', 'jpeg', 'png', 'webp', 'gif'], // 📸 CAPAS DE AULA - APENAS IMAGENS, VÍDEOS BLOQUEADOS
  'modules': ['jpg', 'jpeg', 'png', 'webp', 'gif'], // 📸 CAPAS DE MÓDULO - APENAS IMAGENS, VÍDEOS BLOQUEADOS
  'products': ['jpg', 'jpeg', 'png', 'webp'],
  'testimonials': ['jpg', 'jpeg', 'png', 'webp'],
  'banners': ['jpg', 'jpeg', 'png', 'webp'],
  'showcases': ['jpg', 'jpeg', 'png', 'webp'],
  'default': ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'pdf']
};

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  mimeType?: string;
  detectedExtension?: string;
  size?: number;
  sanitizedFilename?: string;
}

/**
 * 🔍 VERIFICAR MAGIC BYTES - Detecta tipo real do arquivo
 * Suporta wildcards (0x00 = ignorar byte)
 */
function verifyMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const magicDef = MAGIC_BYTES[mimeType];
  if (!magicDef) {
    console.warn(`⚠️ [FILE-VALIDATOR] Magic bytes não definidos para: ${mimeType}`);
    return false;
  }
  
  const { signature, offset } = magicDef;
  
  // Verificação especial para WebP e WAV (compartilham RIFF)
  if (mimeType === 'image/webp') {
    // WebP: RIFF (0-3) + size (4-7) + WEBP (8-11)
    return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
           buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  }
  
  if (mimeType === 'audio/wav') {
    // WAV: RIFF (0-3) + size (4-7) + WAVE (8-11)
    return buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
           buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45;
  }
  
  // Verificação para MP4 (ISO BMFF - não-QuickTime)
  if (mimeType === 'video/mp4') {
    // Validar FTYP box size (bytes 0-3, big-endian)
    const boxSize = (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
    if (boxSize < 16 || boxSize > buffer.length) {
      console.warn(`⚠️ [FILE-VALIDATOR] FTYP box size inválido: ${boxSize} (mínimo 16)`);
      return false;
    }
    
    // Verificar ftyp signature
    const hasFtyp = buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70;
    if (!hasFtyp) return false;
    
    // MP4 brands permitidos (excluindo QuickTime)
    const mp4Brands = [
      'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
      'mp41', 'mp42', 'mp71',
      'avc1', 'avc2',
      'dash', 'cmfc', 'cmfs',
      'M4V ', 'M4A ', 'f4v ', 'm4v ', 'm4a '
    ];
    
    // Verificar major brand (bytes 8-11)
    const majorBrand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
    if (!mp4Brands.includes(majorBrand)) {
      console.warn(`⚠️ [FILE-VALIDATOR] MP4 major brand não permitido: ${majorBrand}`);
      return false;
    }
    
    // Verificar compatible brands (bytes 16+, cada um 4 bytes)
    // FTYP = size(4) + type(4) + majorBrand(4) + minorVersion(4) + compatibleBrands(...)
    const numCompatibleBrands = (boxSize - 16) / 4;
    for (let i = 0; i < numCompatibleBrands; i++) {
      const offset = 16 + (i * 4);
      if (offset + 4 > buffer.length) break;
      
      const compatBrand = String.fromCharCode(
        buffer[offset], 
        buffer[offset + 1], 
        buffer[offset + 2], 
        buffer[offset + 3]
      );
      
      // Ignorar brands vazios (0x00000000)
      if (compatBrand === '\x00\x00\x00\x00') continue;
      
      // WHITELIST: Aceitar apenas brands MP4 conhecidos
      if (!mp4Brands.includes(compatBrand)) {
        console.warn(`⚠️ [FILE-VALIDATOR] Compatible brand não permitido em MP4: ${compatBrand}`);
        return false;
      }
    }
    
    return true;
  }
  
  // Verificação para QuickTime/MOV
  if (mimeType === 'video/quicktime') {
    // Validar FTYP box size (bytes 0-3, big-endian)
    const boxSize = (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
    if (boxSize < 16 || boxSize > buffer.length) {
      console.warn(`⚠️ [FILE-VALIDATOR] FTYP box size inválido: ${boxSize} (mínimo 16)`);
      return false;
    }
    
    // Verificar ftyp signature
    const hasFtyp = buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70;
    if (!hasFtyp) return false;
    
    // QuickTime brands permitidos
    const qtBrands = ['qt  ', 'mqt '];
    
    // Verificar major brand (bytes 8-11)
    const majorBrand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
    if (!qtBrands.includes(majorBrand)) {
      console.warn(`⚠️ [FILE-VALIDATOR] QuickTime major brand não permitido: ${majorBrand}`);
      return false;
    }
    
    // Verificar compatible brands (bytes 16+)
    const numCompatibleBrands = (boxSize - 16) / 4;
    for (let i = 0; i < numCompatibleBrands; i++) {
      const offset = 16 + (i * 4);
      if (offset + 4 > buffer.length) break;
      
      const compatBrand = String.fromCharCode(
        buffer[offset], 
        buffer[offset + 1], 
        buffer[offset + 2], 
        buffer[offset + 3]
      );
      
      // Ignorar brands vazios
      if (compatBrand === '\x00\x00\x00\x00') continue;
      
      // WHITELIST: Aceitar apenas brands QuickTime conhecidos
      if (!qtBrands.includes(compatBrand)) {
        console.warn(`⚠️ [FILE-VALIDATOR] Compatible brand não permitido em MOV: ${compatBrand}`);
        return false;
      }
    }
    
    return true;
  }
  
  // Verificação padrão para outros tipos
  for (const sig of signature) {
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      // 0x00 = wildcard (ignorar)
      if (sig[i] === 0x00) continue;
      
      if (buffer[offset + i] !== sig[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return true;
    }
  }
  
  return false;
}

/**
 * 🔒 DETECTAR TIPO DE ARQUIVO POR MAGIC BYTES
 */
function detectFileTypeByMagicBytes(buffer: Buffer): string | null {
  for (const [mimeType, magicDef] of Object.entries(MAGIC_BYTES)) {
    if (verifyMagicBytes(buffer, mimeType)) {
      return mimeType;
    }
  }
  return null;
}

/**
 * 🧹 SANITIZAR NOME DE ARQUIVO - Remove caracteres perigosos
 */
export function sanitizeFilename(filename: string): string {
  // Remove path traversal
  let clean = path.basename(filename);
  
  // Remove caracteres perigosos
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Limitar tamanho
  const ext = path.extname(clean);
  const name = path.basename(clean, ext);
  if (name.length > 100) {
    clean = name.substring(0, 100) + ext;
  }
  
  return clean;
}

/**
 * 🛡️ VALIDAR ARQUIVO COMPLETO
 */
export async function validateFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  category: string = 'default'
): Promise<FileValidationResult> {
  
  console.log(`🔍 [FILE-VALIDATOR] Validando: ${filename} (${mimeType}) categoria: ${category}`);
  
  // 1️⃣ VERIFICAR TAMANHO
  const sizeLimit = SIZE_LIMITS[category] || SIZE_LIMITS.default;
  if (buffer.length > sizeLimit) {
    console.error(`❌ [FILE-VALIDATOR] Arquivo muito grande: ${buffer.length} > ${sizeLimit}`);
    return {
      valid: false,
      error: `Arquivo muito grande. Máximo: ${(sizeLimit / 1024 / 1024).toFixed(2)}MB`
    };
  }
  
  // 2️⃣ VERIFICAR SE É TIPO BLOQUEADO
  if (BLOCKED_TYPES.includes(mimeType)) {
    console.error(`❌ [FILE-VALIDATOR] Tipo bloqueado: ${mimeType}`);
    return {
      valid: false,
      error: 'Tipo de arquivo não permitido por questões de segurança'
    };
  }
  
  // 3️⃣ SANITIZAR NOME
  const sanitizedFilename = sanitizeFilename(filename);
  const ext = path.extname(sanitizedFilename).toLowerCase().replace('.', '');
  
  // 4️⃣ VERIFICAR EXTENSÃO PERMITIDA PARA CATEGORIA
  const allowedExts = ALLOWED_EXTENSIONS[category] || ALLOWED_EXTENSIONS.default;
  if (!allowedExts.includes(ext)) {
    console.error(`❌ [FILE-VALIDATOR] Extensão não permitida: ${ext} para categoria ${category}`);
    return {
      valid: false,
      error: `Extensão não permitida. Permitidas: ${allowedExts.join(', ')}`
    };
  }
  
  // 5️⃣ DETECTAR TIPO REAL POR MAGIC BYTES
  const detectedType = detectFileTypeByMagicBytes(buffer);
  if (!detectedType) {
    console.error(`❌ [FILE-VALIDATOR] Magic bytes não reconhecidos`);
    return {
      valid: false,
      error: 'Formato de arquivo não reconhecido ou corrompido'
    };
  }
  
  // 6️⃣ VERIFICAR SE TIPO DETECTADO É BLOQUEADO
  if (BLOCKED_TYPES.includes(detectedType)) {
    console.error(`❌ [FILE-VALIDATOR] Tipo detectado é bloqueado: ${detectedType}`);
    return {
      valid: false,
      error: 'Arquivo contém conteúdo não permitido (spoofing detectado)'
    };
  }
  
  // 7️⃣ VERIFICAR CONSISTÊNCIA: mimeType vs detectedType
  if (mimeType !== detectedType) {
    console.warn(`⚠️ [FILE-VALIDATOR] MIME mismatch: declarado=${mimeType}, detectado=${detectedType}`);
    // Aceitar se o tipo detectado for compatível com a categoria
    const detectedExt = MAGIC_BYTES[detectedType]?.extension[0];
    if (!detectedExt || !allowedExts.includes(detectedExt)) {
      return {
        valid: false,
        error: `Tipo de arquivo não corresponde ao conteúdo real (spoofing detectado)`
      };
    }
  }
  
  // 8️⃣ VERIFICAR CONTEÚDO MALICIOSO EM SVG/XML
  if (mimeType.includes('svg') || mimeType.includes('xml')) {
    const content = buffer.toString('utf-8');
    if (content.includes('<script') || content.includes('javascript:') || content.includes('onerror=')) {
      console.error(`❌ [FILE-VALIDATOR] Script malicioso detectado em SVG/XML`);
      return {
        valid: false,
        error: 'Arquivo contém código malicioso'
      };
    }
  }
  
  // ✅ ARQUIVO VÁLIDO!
  console.log(`✅ [FILE-VALIDATOR] Arquivo validado: ${sanitizedFilename} (${detectedType})`);
  return {
    valid: true,
    mimeType: detectedType,
    detectedExtension: MAGIC_BYTES[detectedType]?.extension[0],
    size: buffer.length,
    sanitizedFilename
  };
}

/**
 * 🔬 VERIFICAR SE ARQUIVO É POLYGLOT (válido em múltiplos formatos)
 * Ignora combinações legítimas (WebP/WAV usam RIFF mas são diferentes)
 */
export function detectPolyglot(buffer: Buffer): boolean {
  const matches: string[] = [];
  
  for (const mimeType of Object.keys(MAGIC_BYTES)) {
    if (verifyMagicBytes(buffer, mimeType)) {
      matches.push(mimeType);
    }
  }
  
  // Apenas 1 match = arquivo normal
  if (matches.length <= 1) {
    return false;
  }
  
  // Ignorar combinações legítimas de formatos que compartilham assinaturas
  const riffFormats = ['image/webp', 'audio/wav'];
  const ftypFormats = ['video/mp4', 'video/quicktime'];
  
  const isOnlyRiff = matches.every(m => riffFormats.includes(m));
  const isOnlyFtyp = matches.every(m => ftypFormats.includes(m));
  
  if ((isOnlyRiff || isOnlyFtyp) && matches.length === 2) {
    // Formatos que compartilham assinaturas base mas são diferenciados por sub-tipos
    // Se ambos deram match, a lógica de verificação especial deve prevenir isso
    console.warn(`⚠️ [FILE-VALIDATOR] Detectados múltiplos formatos relacionados: ${matches.join(', ')}`);
    return false; // Não é polyglot malicioso, apenas ambiguidade de formato
  }
  
  // Mais de 1 match não-RIFF = POLYGLOT REAL
  if (matches.length > 1) {
    console.warn(`🚨 [FILE-VALIDATOR] POLYGLOT DETECTADO! Matches: ${matches.join(', ')}`);
    return true;
  }
  
  return false;
}
