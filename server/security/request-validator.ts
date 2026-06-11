// ✅ SISTEMA DEVASTADOR DE VALIDAÇÃO E SANITIZAÇÃO
// Proteção total contra dados maliciosos e requisições inválidas

import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';
import { sanitizeAndValidateInput } from '../../shared/xss-validator';

// 🛡️ SCHEMAS DE VALIDAÇÃO POR ENDPOINT

// CPF/CNPJ validation
const cpfRegex = /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/;
const cnpjRegex = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/;

// Schemas base reutilizáveis
const BaseSchemas = {
  // Identificadores
  id: z.string().min(1, 'ID is required').max(100, 'ID too long'),
  uuid: z.string().uuid('Invalid UUID format'),
  tenantId: z.string().min(10, 'Invalid tenant ID').max(50, 'Tenant ID too long'),
  
  // Documentos
  cpf: z.string()
    .regex(cpfRegex, 'Invalid CPF format')
    .transform(val => val.replace(/\D/g, '')), // Remove formatação
  
  cnpj: z.string()
    .regex(cnpjRegex, 'Invalid CNPJ format')
    .transform(val => val.replace(/\D/g, '')), // Remove formatação
  
  // Textos
  name: z.string()
    .min(2, 'Name too short')
    .max(100, 'Name too long')
    .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Name contains invalid characters'),
  
  email: z.string()
    .email('Invalid email format')
    .max(254, 'Email too long')
    .toLowerCase(),
  
  phone: z.string()
    .regex(/^\(\d{2}\)\s\d{4,5}-\d{4}$|^\d{10,11}$/, 'Invalid phone format')
    .transform(val => val.replace(/\D/g, '')), // Remove formatação
  
  // Valores monetários
  amount: z.number()
    .positive('Amount must be positive')
    .max(1000000, 'Amount too large') // Max R$ 1M
    .multipleOf(0.01, 'Amount must have max 2 decimal places'),
  
  // URLs
  url: z.string()
    .url('Invalid URL format')
    .max(2000, 'URL too long')
    .refine(url => {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    }, 'Only HTTP/HTTPS URLs allowed'),
  
  // Texto livre (com sanitização) - 🛡️ LIMITE 200 CHARS (anti-prompt-injection)
  freeText: z.string()
    .max(200, 'Text too long (max 200 characters)')
    .refine(val => {
      const result = sanitizeAndValidateInput(val, 200, 'Texto');
      return result.isValid;
    }, {
      message: 'Texto contém código malicioso ou caracteres inválidos'
    })
    .transform(val => DOMPurify.sanitize(val, { ALLOWED_TAGS: [] })), // Remove HTML
  
  // Descrições - 🛡️ LIMITE 200 CHARS (anti-prompt-injection)
  description: z.string()
    .max(200, 'Description too long (max 200 characters)')
    .refine(val => {
      const result = sanitizeAndValidateInput(val, 200, 'Descrição');
      return result.isValid;
    }, {
      message: 'Descrição contém código malicioso ou caracteres inválidos'
    })
    .transform(val => DOMPurify.sanitize(val, { ALLOWED_TAGS: [] })),
  
  // Slugs
  slug: z.string()
    .min(3, 'Slug too short')
    .max(100, 'Slug too long')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  
  // Paginação
  page: z.number().int().positive().max(1000).default(1),
  limit: z.number().int().positive().max(100).default(20),
  
  // Datas
  dateString: z.string().datetime('Invalid date format'),
  
  // Booleanos
  boolean: z.boolean(),
  
  // Enums comuns
  status: z.enum(['active', 'inactive', 'pending', 'blocked', 'approved', 'rejected']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  productType: z.enum(['digital', 'service', 'subscription']),
  paymentMethod: z.enum(['pix', 'credit_card', 'debit_card', 'boleto']),
  
  // Endereços
  address: z.object({
    street: z.string().min(5, 'Street too short').max(200, 'Street too long'),
    number: z.string().max(20, 'Number too long'),
    complement: z.string().max(100, 'Complement too long').optional(),
    neighborhood: z.string().min(2, 'Neighborhood too short').max(100, 'Neighborhood too long'),
    city: z.string().min(2, 'City too short').max(100, 'City too long'),
    state: z.string().length(2, 'State must be 2 characters'),
    zipCode: z.string().regex(/^\d{5}-?\d{3}$/, 'Invalid ZIP code format')
  })
};

// 📋 SCHEMAS ESPECÍFICOS POR ENDPOINT

export const ValidationSchemas = {
  // 👤 SELLER REGISTRATION
  '/api/sellers/register': z.object({
    // Dados pessoais
    name: BaseSchemas.name,
    email: BaseSchemas.email,
    phone: BaseSchemas.phone,
    cpf: BaseSchemas.cpf.optional(),
    cnpj: BaseSchemas.cnpj.optional(),
    
    // Dados da empresa
    companyName: z.string().min(2, 'Company name too short').max(200, 'Company name too long').optional(),
    businessType: z.enum(['individual', 'company']).default('individual'),
    
    // Endereço
    address: BaseSchemas.address.optional(),
    
    // Termos
    acceptTerms: z.boolean().refine(val => val === true, 'Terms must be accepted'),
    acceptPrivacy: z.boolean().refine(val => val === true, 'Privacy policy must be accepted'),
    
    // Anti-bot
    _timestamp: z.number().optional(), // Timestamp do cliente
    _interactionTime: z.number().optional() // Tempo de interação
  }).refine(data => {
    // Deve ter CPF OU CNPJ
    return data.cpf || data.cnpj;
  }, {
    message: 'Either CPF or CNPJ is required',
    path: ['cpf']
  }),
  
  // 💰 PAYMENT SESSION
  '/api/payment/create-session': z.object({
    checkoutId: BaseSchemas.id,
    tenantId: BaseSchemas.tenantId,
    amount: BaseSchemas.amount,
    currency: z.enum(['BRL', 'USD', 'EUR']).default('BRL'),
    paymentMethod: BaseSchemas.paymentMethod,
    
    // Dados do cliente
    customer: z.object({
      name: BaseSchemas.name,
      email: BaseSchemas.email,
      phone: BaseSchemas.phone,
      document: z.string().min(11, 'Document too short').max(18, 'Document too long'),
      address: BaseSchemas.address.optional()
    }),
    
    // Metadata
    metadata: z.record(z.string()).optional(),
    
    // Configurações
    returnUrl: BaseSchemas.url.optional(),
    cancelUrl: BaseSchemas.url.optional()
  }),
  
  // 📦 PRODUCT CREATION
  '/api/products': z.object({
    tenantId: BaseSchemas.tenantId,
    title: z.string().min(3, 'Title too short').max(200, 'Title too long'),
    description: BaseSchemas.description,
    productType: BaseSchemas.productType,
    
    // Preços
    amount: BaseSchemas.amount,
    compareAtAmount: BaseSchemas.amount.optional(),
    
    // Configurações
    active: BaseSchemas.boolean.default(true),
    featured: BaseSchemas.boolean.default(false),
    
    // SEO
    slug: BaseSchemas.slug.optional(),
    metaTitle: z.string().max(60, 'Meta title too long').optional(),
    metaDescription: z.string().max(160, 'Meta description too long').optional(),
    
    // Imagens
    images: z.array(BaseSchemas.url).max(10, 'Too many images').optional(),
    
    sku: z.string().max(50, 'SKU too long').optional()
  }),
  
  // 📄 FILE UPLOAD
  '/api/objects/upload': z.object({
    tenantId: BaseSchemas.tenantId,
    fileName: z.string()
      .min(1, 'File name required')
      .max(255, 'File name too long')
      .regex(/^[a-zA-Z0-9._-]+$/, 'File name contains invalid characters'),
    fileType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    fileSize: z.number().positive('File size must be positive').max(50 * 1024 * 1024, 'File too large'),
    category: z.enum(['product', 'document', 'avatar', 'banner']).default('document'),
    
    // Hash para deduplicação
    fileHash: z.string().length(64, 'Invalid file hash').optional()
  }),
  
  // 🎫 SUPPORT TICKET
  '/api/support/tickets': z.object({
    tenantId: BaseSchemas.tenantId,
    sellerId: BaseSchemas.id,
    sellerName: BaseSchemas.name,
    sellerEmail: BaseSchemas.email,
    
    // Ticket info - aceita categorias em português e inglês
    category: z.enum(['technical', 'billing', 'account', 'general', 'bug_report', 'feature_request', 'produto', 'financeiro', 'afiliado', 'taxas', 'geral']),
    subject: z.string().min(5, 'Subject too short').max(200, 'Subject too long'),
    description: BaseSchemas.description,
    priority: BaseSchemas.priority.default('normal'),
    
    // Attachments
    attachments: z.array(BaseSchemas.url).max(5, 'Too many attachments').optional()
  }),
  
  // 🏪 CHECKOUT CREATION
  '/api/checkouts': z.object({
    tenantId: BaseSchemas.tenantId,
    title: z.string().min(3, 'Title too short').max(200, 'Title too long'),
    description: BaseSchemas.description.optional(),
    
    // Produto vinculado
    productId: BaseSchemas.id.optional(),
    
    // Preços
    pricing: z.object({
      amount: BaseSchemas.amount,
      currency: z.enum(['BRL', 'USD', 'EUR']).default('BRL'),
      billingCycle: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annual', 'annual']).default('one_time')
    }),
    
    // Configurações
    active: BaseSchemas.boolean.default(true),
    collectAddress: BaseSchemas.boolean.default(false),
    collectPhone: BaseSchemas.boolean.default(true),
    
    // Métodos de pagamento aceitos
    paymentMethods: z.array(BaseSchemas.paymentMethod).min(1, 'At least one payment method required'),
    
    // URLs
    successUrl: BaseSchemas.url.optional(),
    cancelUrl: BaseSchemas.url.optional(),
    
    // SEO
    slug: BaseSchemas.slug,
    metaTitle: z.string().max(60, 'Meta title too long').optional(),
    metaDescription: z.string().max(160, 'Meta description too long').optional()
  }),
  
  // 🔄 WEBHOOK VALIDATION
  '/webhook/efi': z.object({
    // Headers do webhook
    'x-efi-signature': z.string().optional(),
    
    // Payload do webhook
    pix: z.array(z.object({
      endToEndId: z.string(),
      txid: z.string(),
      valor: z.string().regex(/^\d+\.\d{2}$/, 'Invalid amount format'),
      chave: z.string(),
      horario: z.string().datetime()
    })).optional()
  }),
  
  // 📊 QUERY PARAMETERS (para GET requests)
  queryParams: z.object({
    page: BaseSchemas.page,
    limit: BaseSchemas.limit,
    search: z.string().max(100, 'Search term too long').optional(),
    sortBy: z.string().max(50, 'Sort field too long').optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    filter: z.string().max(100, 'Filter too long').optional(),
    startDate: BaseSchemas.dateString.optional(),
    endDate: BaseSchemas.dateString.optional(),
    status: BaseSchemas.status.optional(),
    tenantId: BaseSchemas.tenantId.optional()
  })
};

// 🧹 SANITIZAÇÃO AVANÇADA
export class RequestSanitizer {
  
  // 🧼 SANITIZAR STRING (REMOVER HTML, XSS, INJEÇÕES)
  static sanitizeString(input: string): string {
    if (typeof input !== 'string') return '';
    
    // 1. Remover HTML tags
    let sanitized = DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
    
    // 2. Remover caracteres de controle
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    
    // 3. Limitar caracteres especiais
    sanitized = sanitized.replace(/[<>'"&]/g, '');
    
    // 4. Trim espaços
    sanitized = sanitized.trim();
    
    return sanitized;
  }
  
  // 📧 SANITIZAR EMAIL
  static sanitizeEmail(email: string): string {
    if (typeof email !== 'string') return '';
    
    return email.toLowerCase().trim();
  }
  
  // 🔢 SANITIZAR NÚMERO
  static sanitizeNumber(input: any): number | null {
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
      const parsed = parseFloat(input);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }
  
  // 📱 SANITIZAR TELEFONE
  static sanitizePhone(phone: string): string {
    if (typeof phone !== 'string') return '';
    
    // Manter apenas números
    return phone.replace(/\D/g, '');
  }
  
  // 🆔 SANITIZAR DOCUMENTO (CPF/CNPJ)
  static sanitizeDocument(document: string): string {
    if (typeof document !== 'string') return '';
    
    // Manter apenas números
    return document.replace(/\D/g, '');
  }
  
  // 🌐 SANITIZAR URL
  static sanitizeUrl(url: string): string | null {
    if (typeof url !== 'string') return null;
    
    try {
      const parsed = new URL(url);
      
      // Apenas HTTP/HTTPS
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return null;
      }
      
      // Remover caracteres perigosos
      parsed.pathname = parsed.pathname.replace(/[<>'"]/g, '');
      parsed.search = parsed.search.replace(/[<>'"]/g, '');
      
      return parsed.toString();
    } catch {
      return null;
    }
  }
  
  // 🧹 SANITIZAR OBJETO RECURSIVAMENTE
  static sanitizeObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    
    if (typeof obj === 'number') {
      return this.sanitizeNumber(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }
    
    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const sanitizedKey = this.sanitizeString(key);
        sanitized[sanitizedKey] = this.sanitizeObject(value);
      }
      return sanitized;
    }
    
    return obj;
  }
}

// 🛡️ MIDDLEWARE PRINCIPAL DE VALIDAÇÃO
export const requestValidationMiddleware = (schemaKey?: string) => {
  return (req: any, res: any, next: any) => {
    try {
      const endpoint = req.route?.path || req.path;
      const method = req.method;
      
      console.log(`✅ VALIDATING REQUEST: ${method} ${endpoint}`);
      
      // 1️⃣ SANITIZAR DADOS BÁSICOS
      if (req.body) {
        req.body = RequestSanitizer.sanitizeObject(req.body);
      }
      
      if (req.query) {
        req.query = RequestSanitizer.sanitizeObject(req.query);
      }
      
      // 2️⃣ VALIDAR COM SCHEMA ESPECÍFICO
      const schema = schemaKey ? 
        ValidationSchemas[schemaKey as keyof typeof ValidationSchemas] :
        ValidationSchemas[endpoint as keyof typeof ValidationSchemas];
      
      if (schema && method !== 'GET') {
        try {
          req.body = schema.parse(req.body);
          console.log(`✅ VALIDATION SUCCESS: ${endpoint}`);
        } catch (error: any) {
          console.log(`❌ VALIDATION FAILED: ${endpoint} - ${error.message}`);
          
          return res.status(422).json({
            error: 'Validation failed',
            message: 'Request data is invalid',
            details: error.errors || [{ message: error.message }],
            code: 'VALIDATION_ERROR'
          });
        }
      }
      
      // 3️⃣ VALIDAR QUERY PARAMETERS PARA GET
      if (method === 'GET' && Object.keys(req.query).length > 0) {
        try {
          req.query = ValidationSchemas.queryParams.parse(req.query);
        } catch (error: any) {
          return res.status(422).json({
            error: 'Invalid query parameters',
            details: error.errors || [{ message: error.message }],
            code: 'QUERY_VALIDATION_ERROR'
          });
        }
      }
      
      // 4️⃣ VERIFICAR TAMANHO DO PAYLOAD
      const payloadSize = JSON.stringify(req.body || {}).length;
      if (payloadSize > 1024 * 1024) { // 1MB limit
        return res.status(413).json({
          error: 'Payload too large',
          message: 'Request payload exceeds 1MB limit',
          code: 'PAYLOAD_TOO_LARGE'
        });
      }
      
      // 5️⃣ VERIFICAR CONTENT-TYPE PARA REQUESTS COM BODY
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
          return res.status(400).json({
            error: 'Invalid content type',
            message: 'Content-Type must be application/json',
            code: 'INVALID_CONTENT_TYPE'
          });
        }
      }
      
      next();
      
    } catch (error: any) {
      console.error('❌ Request validation middleware error:', error);
      return res.status(500).json({
        error: 'Validation error',
        message: 'Unable to validate request',
        code: 'VALIDATION_MIDDLEWARE_ERROR'
      });
    }
  };
};

// 🎯 MIDDLEWARE ESPECÍFICO PARA ENDPOINTS CRÍTICOS
export const strictValidationMiddleware = (schemaKey: keyof typeof ValidationSchemas) => {
  return requestValidationMiddleware(schemaKey);
};

export { BaseSchemas };