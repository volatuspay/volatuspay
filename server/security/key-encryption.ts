// 🛡️ SISTEMA DE CRIPTOGRAFIA DE CHAVES SENSÍVEIS
// Protege chaves API, tokens e dados confidenciais

import crypto from 'crypto';

// 🔐 CHAVE MESTRA PARA CRIPTOGRAFIA (OBRIGATÓRIA)
// SECURITY: NUNCA use chaves hardcoded - sempre exija variável de ambiente
// Verificação movida para runtime para permitir que dotenv carregue as variáveis primeiro
function getMasterKey(): string {
  if (!process.env.ENCRYPTION_MASTER_KEY) {
    console.error('🚨 ERRO CRÍTICO DE SEGURANÇA: ENCRYPTION_MASTER_KEY não configurada!');
    console.error('⚠️ Esta variável é OBRIGATÓRIA para criptografar chaves sensíveis de sellers.');
    throw new Error('ENCRYPTION_MASTER_KEY não configurada - necessária para criptografia');
  }
  return process.env.ENCRYPTION_MASTER_KEY;
}
const ALGORITHM = 'aes-256-gcm';

// 🔐 CRIPTOGRAFAR DADOS SENSÍVEIS
export function encryptSensitiveData(data: string): string {
  try {
    // Gerar IV aleatório para cada criptografia
    const iv = crypto.randomBytes(16);
    
    // Criar key de 32 bytes a partir da master key
    const key = crypto.createHash('sha256').update(getMasterKey()).digest();
    
    // Criar cipher com AES-256-GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAutoPadding(true);
    
    // Criptografar dados
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Obter tag de autenticação GCM
    const authTag = cipher.getAuthTag();
    
    // Retornar IV + AuthTag + Dados criptografados (separados por :)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('❌ ERRO CRÍTICO NA CRIPTOGRAFIA:', error);
    console.error('🚨 ENCRYPTION_MASTER_KEY não disponível - IMPOSSÍVEL CRIPTOGRAFAR');
    console.error('🔧 SOLUÇÃO: Configure ENCRYPTION_MASTER_KEY nas variáveis de ambiente');
    // 🚨 HARD FAIL: NUNCA retornar plaintext - lançar erro para bloquear operação
    throw new Error('ENCRYPTION_MASTER_KEY não disponível - criptografia obrigatória para dados sensíveis');
  }
}

// 🔓 DESCRIPTOGRAFAR DADOS SENSÍVEIS
export function decryptSensitiveData(encryptedData: string): string {
  try {
    // Separar IV, AuthTag e dados
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Formato de dados criptografados inválido - esperado IV:AuthTag:Encrypted');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    // Criar key de 32 bytes a partir da master key
    const key = crypto.createHash('sha256').update(getMasterKey()).digest();
    
    // Criar decipher com AES-256-GCM
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    // Descriptografar dados
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('❌ Erro na descriptografia:', errorMessage);
    console.error('📍 Stack:', errorStack);
    console.error('⚠️ Dados podem estar em formato antigo ou corrompidos');
    // ⚠️ LANÇAR ERRO para que safeDecrypt possa fazer fallback
    throw error;
  }
}

// 🛡️ OFUSCAR CHAVES PARA LOGS (mostra apenas primeiros/últimos caracteres)
export function obfuscateKey(key: string, showChars: number = 4): string {
  if (!key || key.length <= showChars * 2) {
    return '***HIDDEN***';
  }
  
  const start = key.substring(0, showChars);
  const end = key.substring(key.length - showChars);
  const middle = '*'.repeat(Math.max(8, key.length - showChars * 2));
  
  return `${start}${middle}${end}`;
}

// 🛡️ SANITIZAR DADOS PARA LOGS (remove informações sensíveis)
export function sanitizeForLogs(data: any): any {
  if (typeof data === 'string') {
    // Detectar e ofuscar possíveis chaves/tokens
    if (data.match(/^sk_|^pk_|^rk_|^acct_/)) {
      return obfuscateKey(data);
    }
    
    // Detectar emails e ofuscar
    if (data.includes('@') && data.includes('.')) {
      const [username, domain] = data.split('@');
      const maskedUsername = username.length > 3 ? 
        username.substring(0, 2) + '*'.repeat(username.length - 2) : 
        '*'.repeat(username.length);
      return `${maskedUsername}@${domain}`;
    }
    
    return data;
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized: any = Array.isArray(data) ? [] : {};
    
    for (const [key, value] of Object.entries(data)) {
      // Chaves sensíveis que devem ser sempre ofuscadas
      const sensitiveKeys = [
        'email', 'password', 'token', 'key', 'secret', 'auth', 'credential',
        'stripe', 'firebase', 'api_key', 'client_secret', 'access_token'
      ];
      
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '***HIDDEN***';
      } else {
        sanitized[key] = sanitizeForLogs(value);
      }
    }
    
    return sanitized;
  }
  
  return data;
}

// 🛡️ LOGGER SEGURO (automaticamente sanitiza dados sensíveis)
export const secureLogger = {
  log: (message: string, data?: any) => {
    const sanitizedData = data ? sanitizeForLogs(data) : undefined;
    console.log(message, sanitizedData);
  },
  
  error: (message: string, error?: any) => {
    const sanitizedError = error ? sanitizeForLogs(error) : undefined;
    console.error(message, sanitizedError);
  },
  
  warn: (message: string, data?: any) => {
    const sanitizedData = data ? sanitizeForLogs(data) : undefined;
    console.warn(message, sanitizedData);
  },
  
  info: (message: string, data?: any) => {
    const sanitizedData = data ? sanitizeForLogs(data) : undefined;
    console.info(message, sanitizedData);
  }
};

// 🛡️ MIDDLEWARE PARA SANITIZAR RESPONSES HTTP
export function sanitizeHttpResponse(req: any, res: any, next: any) {
  const originalSend = res.send;
  
  res.send = function(body: any) {
    // Se é desenvolvimento, permitir dados completos
    if (process.env.NODE_ENV === 'development') {
      return originalSend.call(this, body);
    }
    
    // Em produção, sanitizar dados sensíveis antes de enviar
    try {
      if (typeof body === 'object') {
        const sanitizedBody = sanitizeForLogs(body);
        return originalSend.call(this, sanitizedBody);
      }
    } catch (error) {
      console.error('❌ Erro ao sanitizar response:', error);
    }
    
    return originalSend.call(this, body);
  };
  
  next();
}

// 🛡️ HASH DETERMINÍSTICO PARA IDs ÚNICOS SEM EXPOR DADOS
export function createSecureHash(data: string): string {
  return crypto.createHash('sha256').update(data + getMasterKey()).digest('hex').substring(0, 16);
}

export default {
  encryptSensitiveData,
  decryptSensitiveData,
  obfuscateKey,
  sanitizeForLogs,
  secureLogger,
  sanitizeHttpResponse,
  createSecureHash
};