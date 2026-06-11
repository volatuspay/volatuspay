/**
 * 🔒 LOG SANITIZER - Prevenir vazamento de PII e dados sensíveis
 * Remove dados sensíveis dos logs automaticamente
 */

// 🚨 PADRÕES DE DADOS SENSÍVEIS (regex patterns)
const SENSITIVE_PATTERNS = {
  // CPF: 000.000.000-00 ou 00000000000
  cpf: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
  
  // CNPJ: 00.000.000/0000-00 ou 00000000000000
  cnpj: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
  
  // Email
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  
  // Telefone: (00) 00000-0000 ou variações
  phone: /\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}\b/g,
  
  // Cartão de crédito: 0000 0000 0000 0000
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  
  // CVV: 3 ou 4 dígitos isolados após "cvv" ou "cvc"
  cvv: /\b(cvv|cvc|security\s?code)[\s:=]+\d{3,4}\b/gi,
  
  // Senha: após palavras-chave
  password: /\b(password|senha|pass|pwd)[\s:=]["']?[^\s"']+["']?/gi,
  
  // Token/API Key: strings longas alfanuméricas
  token: /\b(token|apikey|api_key|bearer|authorization)[\s:=]["']?[\w\-._]{20,}["']?/gi,
  
  // PIX keys (emails, phones, CPF já cobertos)
  pixKey: /\b(pix[\s_]?key|chave[\s_]?pix)[\s:=]["']?[^\s"']+["']?/gi,
  
  // Valores monetários sensíveis em contextos de fraude
  // (não bloquear todos, apenas em contextos suspeitos)
  suspiciousAmount: /\b(fraud|scam|stolen|roubo|fraude).*?R?\$?\s?\d+[.,]?\d*\b/gi
};

/**
 * 🔒 SANITIZAR STRING - Remove dados sensíveis
 */
export function sanitizeString(text: string): string {
  if (!text || typeof text !== 'string') return text;
  
  let sanitized = text;
  
  // CPF: mostrar apenas últimos 3 dígitos
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.cpf, (match) => {
    const digits = match.replace(/\D/g, '');
    return `***.***.***-${digits.slice(-2)}`;
  });
  
  // CNPJ: mostrar apenas últimos 4 dígitos
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.cnpj, (match) => {
    const digits = match.replace(/\D/g, '');
    return `**.***.***/****-${digits.slice(-2)}`;
  });
  
  // Email: preservar domínio, ocultar usuário
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.email, (match) => {
    const [user, domain] = match.split('@');
    const maskedUser = user.length > 2 ? `${user[0]}***${user.slice(-1)}` : '***';
    return `${maskedUser}@${domain}`;
  });
  
  // Telefone: mostrar apenas últimos 4 dígitos
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.phone, (match) => {
    const digits = match.replace(/\D/g, '');
    return `(**) ****-${digits.slice(-4)}`;
  });
  
  // Cartão de crédito: mostrar apenas últimos 4 dígitos
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.creditCard, (match) => {
    const digits = match.replace(/\D/g, '');
    return `**** **** **** ${digits.slice(-4)}`;
  });
  
  // CVV: remover completamente
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.cvv, (match, keyword) => {
    return `${keyword}: ***`;
  });
  
  // Senha: remover completamente
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.password, (match, keyword) => {
    return `${keyword}: [REDACTED]`;
  });
  
  // Token/API Key: remover completamente
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.token, (match, keyword) => {
    return `${keyword}: [REDACTED]`;
  });
  
  // PIX Key: ocultar
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.pixKey, (match, keyword) => {
    return `${keyword}: [REDACTED]`;
  });
  
  return sanitized;
}

/**
 * 🔒 SANITIZAR OBJETO - Remove dados sensíveis recursivamente
 */
export function sanitizeObject(obj: any): any {
  if (!obj) return obj;
  
  // String: sanitizar diretamente
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  // Array: sanitizar cada item
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  // Objeto: sanitizar recursivamente
  if (typeof obj === 'object') {
    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Campos sensíveis conhecidos: remover completamente
      const sensitiveFields = [
        'password', 'senha', 'pwd',
        'token', 'apiKey', 'api_key', 'accessToken', 'refreshToken',
        'cvv', 'cvc', 'securityCode',
        'cardNumber', 'card_number',
        'secret', 'privateKey', 'private_key'
      ];
      
      if (sensitiveFields.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
        continue;
      }
      
      // Campos de CPF/CNPJ: mascarar
      if (['cpf', 'cnpj', 'document', 'documento'].includes(key.toLowerCase())) {
        if (typeof value === 'string') {
          const digits = value.replace(/\D/g, '');
          sanitized[key] = digits.length === 11 
            ? `***.***.***-${digits.slice(-2)}`
            : `**.***.***/****-${digits.slice(-2)}`;
        } else {
          sanitized[key] = value;
        }
        continue;
      }
      
      // Recursivo
      sanitized[key] = sanitizeObject(value);
    }
    
    return sanitized;
  }
  
  return obj;
}

/**
 * 🔒 OVERRIDE CONSOLE.LOG - Sanitizar automaticamente
 */
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

// Flag para desabilitar sanitização em desenvolvimento específico
const DISABLE_SANITIZATION = process.env.DISABLE_LOG_SANITIZATION === 'true';

export function enableLogSanitization() {
  if (DISABLE_SANITIZATION) {
    console.log('⚠️ LOG SANITIZATION DESABILITADA (DISABLE_LOG_SANITIZATION=true)');
    return;
  }
  
  console.log = (...args: any[]) => {
    const sanitized = args.map(arg => sanitizeObject(arg));
    originalLog.apply(console, sanitized);
  };
  
  console.error = (...args: any[]) => {
    const sanitized = args.map(arg => sanitizeObject(arg));
    originalError.apply(console, sanitized);
  };
  
  console.warn = (...args: any[]) => {
    const sanitized = args.map(arg => sanitizeObject(arg));
    originalWarn.apply(console, sanitized);
  };
  
  console.info = (...args: any[]) => {
    const sanitized = args.map(arg => sanitizeObject(arg));
    originalInfo.apply(console, sanitized);
  };
  
  console.log('🔒 LOG SANITIZATION ATIVADA - Dados sensíveis serão redactados automaticamente');
}

/**
 * 🔒 MIDDLEWARE EXPRESS - Sanitizar logs de requisições
 */
export function sanitizeRequestLogs(req: any, res: any, next: any) {
  // Salvar dados originais
  const originalBody = req.body;
  const originalQuery = req.query;
  const originalHeaders = req.headers;
  
  // Criar versões sanitizadas para logs
  req.sanitizedBody = sanitizeObject(originalBody);
  req.sanitizedQuery = sanitizeObject(originalQuery);
  req.sanitizedHeaders = sanitizeObject(originalHeaders);
  
  next();
}
