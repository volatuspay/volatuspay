import DOMPurify from 'isomorphic-dompurify';

export interface ValidationResult {
  isValid: boolean;
  sanitized: string;
  error?: string;
  blockedPatterns?: string[];
}

const DANGEROUS_PATTERNS = [
  { pattern: /<script[\s\S]*?>[\s\S]*?<\/script>/i, name: '<script>' },
  { pattern: /<iframe[\s\S]*?>/i, name: '<iframe>' },
  { pattern: /<embed[\s\S]*?>/i, name: '<embed>' },
  { pattern: /<object[\s\S]*?>/i, name: '<object>' },
  { pattern: /javascript:/i, name: 'javascript:' },
  { pattern: /on\w+\s*=/i, name: 'event handlers (onclick, onerror, etc.)' },
  { pattern: /<img[\s\S]*?onerror[\s\S]*?>/i, name: '<img onerror>' },
  { pattern: /data:text\/html/i, name: 'data:text/html' },
  { pattern: /vbscript:/i, name: 'vbscript:' },
  { pattern: /<style[\s\S]*?>[\s\S]*?<\/style>/i, name: '<style>' },
  { pattern: /<link[\s\S]*?>/i, name: '<link>' },
  { pattern: /<meta[\s\S]*?>/i, name: '<meta>' },
  { pattern: /<base[\s\S]*?>/i, name: '<base>' },
  { pattern: /eval\s*\(/i, name: 'eval()' },
  { pattern: /expression\s*\(/i, name: 'expression()' },
  { pattern: /<\s*\/?\s*(html|head|body|title|div|span|p|h[1-6]|a|button|input|form|table|tr|td|ul|li|ol|img|video|audio|canvas|svg)/i, name: 'HTML tags' },
];

const HTML_ENTITIES_DECODE: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#x2F;': '/',
  '&amp;': '&',
  '&#60;': '<',
  '&#62;': '>',
  '&#34;': '"',
  '&#39;': "'",
  '&#47;': '/',
  '&#38;': '&',
};

function decodeHTMLEntities(text: string): string {
  const tempDiv = typeof document !== 'undefined' 
    ? document.createElement('div')
    : null;
  
  if (tempDiv) {
    tempDiv.innerHTML = DOMPurify.sanitize(text, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
    return tempDiv.textContent || tempDiv.innerText || text;
  } else {
    let decoded = text;
    
    decoded = decoded.replace(/&([a-zA-Z]+);/g, (match, entity) => {
      const standardEntities: Record<string, string> = {
        'lt': '<', 'gt': '>', 'amp': '&', 'quot': '"', 'apos': "'",
        'nbsp': ' ', 'equals': '=', 'colon': ':', 'semi': ';',
        'lpar': '(', 'rpar': ')', 'lsqb': '[', 'rsqb': ']',
        'lcub': '{', 'rcub': '}', 'ast': '*', 'plus': '+',
        'comma': ',', 'period': '.', 'sol': '/', 'bsol': '\\',
        'quest': '?', 'excl': '!', 'num': '#', 'percnt': '%',
        'dollar': '$', 'commat': '@', 'newline': '\n', 'tab': '\t'
      };
      return standardEntities[entity.toLowerCase()] || match;
    });
    
    decoded = decoded.replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return String.fromCharCode(code);
    });
    
    decoded = decoded.replace(/&#(\d+);/gi, (_, dec) => {
      const code = parseInt(dec, 10);
      return String.fromCharCode(code);
    });
    
    return decoded;
  }
}

export function sanitizeAndValidateInput(
  input: string,
  maxLength: number = 200,
  fieldName: string = 'campo'
): ValidationResult {
  if (!input || typeof input !== 'string') {
    return {
      isValid: false,
      sanitized: '',
      error: `${fieldName} é obrigatório`,
    };
  }

  let normalized = input.trim();
  
  normalized = normalized.replace(/\s+/g, ' ');

  const decoded = decodeHTMLEntities(normalized);

  if (decoded.length > maxLength) {
    return {
      isValid: false,
      sanitized: normalized,
      error: `${fieldName} não pode ter mais de ${maxLength} caracteres (atual: ${decoded.length})`,
    };
  }

  const blockedPatterns: string[] = [];
  for (const { pattern, name } of DANGEROUS_PATTERNS) {
    if (pattern.test(decoded)) {
      blockedPatterns.push(name);
    }
  }

  if (blockedPatterns.length > 0) {
    return {
      isValid: false,
      sanitized: normalized,
      error: `❌ Entrada bloqueada: detectamos código malicioso. Não é permitido inserir: ${blockedPatterns.join(', ')}`,
      blockedPatterns,
    };
  }

  return {
    isValid: true,
    sanitized: normalized,
  };
}

export function createXSSValidator(fieldName: string, maxLength: number = 200) {
  return (value: string) => {
    const result = sanitizeAndValidateInput(value, maxLength, fieldName);
    return result.isValid;
  };
}

export function getXSSErrorMessage(fieldName: string, maxLength: number = 200) {
  return (value: string) => {
    const result = sanitizeAndValidateInput(value, maxLength, fieldName);
    if (!result.isValid) {
      return result.error || 'Entrada inválida';
    }
    return undefined;
  };
}
