import { z } from "zod";
import { nanoid } from "nanoid";
import { sanitizeAndValidateInput } from "./xss-validator";

// 🛡️ SISTEMA ANTI-DUPLICAÇÃO - GERADOR DE IDs ÚNICOS GARANTIDOS
export function generateUniqueId(): string {
  return `${Date.now()}-${nanoid(12)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 🛡️ PREFIXOS ÚNICOS PARA CADA TIPO DE ENTITY
export function generateCheckoutId(): string { return `ck_${generateUniqueId()}`; }
export function generateOrderId(): string { return `ord_${generateUniqueId()}`; }
export function generateProductId(): string { return `prd_${generateUniqueId()}`; }
export function generateModuleId(): string { return `mod_${generateUniqueId()}`; }
export function generateLessonId(): string { return `les_${generateUniqueId()}`; }
export function generateEnrollmentId(): string { return `enr_${generateUniqueId()}`; }
export function generateBannerId(): string { return `banner_${generateUniqueId()}`; }

// Customer Schema - EXPANDIDO PARA DADOS COMPLETOS DA EMPRESA
export const customerSchema = z.object({
  // 👤 DADOS PESSOAIS BÁSICOS
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("Email inválido"),
  document: z.string().min(11, "CPF/CNPJ é obrigatório"),
  phone: z.string().min(10, "Telefone é obrigatório"),
  
  // 🏢 DADOS DA EMPRESA (OPCIONAIS PARA PESSOA FÍSICA)
  customerType: z.enum(["individual", "business"]).optional(), // Pessoa física ou jurídica
  businessData: z.object({
    businessName: z.string().min(1, "Razão social é obrigatória"), // Razão social
    tradingName: z.string().optional(), // Nome fantasia
    stateRegistration: z.string().optional(), // Inscrição estadual
    municipalRegistration: z.string().optional(), // Inscrição municipal
    businessType: z.string().optional(), // Tipo de negócio/atividade
    businessAddress: z.object({
      street: z.string().min(1, "Rua é obrigatória"),
      number: z.string().min(1, "Número é obrigatório"),
      complement: z.string().optional(),
      neighborhood: z.string().min(1, "Bairro é obrigatório"),
      city: z.string().min(1, "Cidade é obrigatória"),
      state: z.string().min(2, "Estado é obrigatório").max(2),
      zipCode: z.string().min(8, "CEP é obrigatório").max(9),
    }).optional(),
  }).optional(),
  
  // 🏠 ENDEREÇO PESSOAL/ENTREGA (SEPARADO DO ENDEREÇO DA EMPRESA)
  address: z.object({
    street: z.string().min(1, "Rua é obrigatória"),
    number: z.string().min(1, "Número é obrigatório"),
    complement: z.string().optional(),
    neighborhood: z.string().min(1, "Bairro é obrigatório"),
    city: z.string().min(1, "Cidade é obrigatória"),
    state: z.string().min(2, "Estado é obrigatório").max(2),
    zipCode: z.string().min(8, "CEP é obrigatório").max(9),
  }).optional(),
});

export type Customer = z.infer<typeof customerSchema>;

// Order Schema
export const orderQrCodeSchema = z.object({
  qrcode: z.string(),
  qrCodeBase64: z.string(),
  expiresAt: z.string(),
  text: z.string().optional(),
  image: z.string().optional(),
});

export const orderSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  checkoutId: z.string(),
  customer: customerSchema,
  amount: z.number(),
  status: z.enum(["pending", "paid", "cancelled", "expired", "failed"]),
  method: z.enum(["pix", "card", "boleto"]),
  processor: z.enum(["efibank", "stripe", "woovi"]).optional(),
  stripePaymentIntentId: z.string().optional(),
  efiChargeId: z.string().optional(),
  wooviChargeId: z.string().optional(),
  wooviCorrelationID: z.string().optional(),
  qrcode: orderQrCodeSchema.optional(),
  currency: z.string().default("BRL"),
  paidAt: z.date().optional(),
  
  // 🔒 IDEMPOTENCY - Previne criação de orders duplicadas
  idempotencyKey: z.string().optional(), // UUID v4 gerado pelo cliente ou backend
  
  // 💰 TAXAS E SALDOS (campos diretos para fácil acesso)
  gatewayFee: z.number().optional(), // Taxa do gateway em centavos
  platformFee: z.number().optional(), // Taxa da plataforma em centavos
  netAmount: z.number().optional(), // Saldo líquido do vendedor em centavos
  
  // 🔄 SNAPSHOT DO CHECKOUT NO MOMENTO DA VENDA - PRESERVA HISTÓRICO
  checkoutSnapshot: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    originalPrice: z.number(), // Valor original do checkout na época
    productType: z.enum(["digital", "ebook", "subscription", "service", "other"]).optional(), // Tipo no momento da venda
    productId: z.string().optional(), // ID do produto
    productName: z.string().optional(), // Nome do produto
    offerId: z.string().optional(), // ID da oferta
    offerName: z.string().optional(), // Nome da oferta
  }).optional(),
  
  // 🎯 CAMPOS TOP-LEVEL para facilitar filtros (dados legados + novos)
  checkoutTitle: z.string().optional(), // Título do checkout
  productType: z.enum(["digital", "ebook", "subscription", "service", "other"]).optional(), // Tipo do produto
  productId: z.string().optional(), // ID do produto
  productName: z.string().optional(), // Nome do produto
  offerId: z.string().optional(), // ID da oferta
  offerName: z.string().optional(), // Nome da oferta
  
  // 💰 DADOS FINANCEIROS CALCULADOS NA VENDA - SNAPSHOT ETERNO
  financialData: z.object({
    grossAmount: z.number(), // Valor bruto pago pelo cliente
    feeAmount: z.number(), // Taxa cobrada (calculada no momento da venda)
    netAmount: z.number(), // Valor líquido para o seller
    releaseDate: z.date(), // Data exata de liberação do saldo (baseada no prazo)
    released: z.boolean().default(false), // Se já foi liberado para saque
    feeBreakdown: z.object({
      fixedFee: z.number(), // Taxa fixa em centavos
      percentFee: z.number(), // Taxa percentual do gateway aplicada
      percentAmount: z.number(), // Valor em centavos da taxa percentual do gateway
      platformFeePercent: z.number().optional(), // 🔥 SNAPSHOT: Taxa percentual da plataforma
      platformFeeAmount: z.number().optional(), // 🔥 SNAPSHOT: Valor em centavos da taxa da plataforma
    }),
    releaseDays: z.number().optional(), // 🔥 SNAPSHOT: Prazo de saque em dias (D+1, D+30, etc)
  }).optional(),
  
  // 🤝 SISTEMA DE AFILIADOS - RASTREAMENTO ETERNO DE VENDAS
  isAffiliateSale: z.boolean().optional(), // Se foi venda de afiliado (true/false)
  affiliateUid: z.string().optional(), // UID do afiliado (Firebase Auth)
  offerSlug: z.string().optional(), // Slug da oferta usada (ex: "black-friday")
  offerTitle: z.string().optional(), // Título da oferta no momento da venda
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertOrderSchema = orderSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Order = z.infer<typeof orderSchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

// Idempotency Lock Schema - Previne orders duplicadas
export const idempotencyLockSchema = z.object({
  id: z.string(), // Formato: <tenantId>:<idempotencyKey>
  tenantId: z.string(),
  idempotencyKey: z.string(), // UUID v4 do cliente
  orderId: z.string(), // Referência para a order criada
  createdAt: z.date(),
  expiresAt: z.date(), // TTL de 24h para limpeza automática
});

export type IdempotencyLock = z.infer<typeof idempotencyLockSchema>;

// Tenant Schema
export const tenantSchema = z.object({
  id: z.string(),
  ownerId: z.string(), // Firebase Auth UID
  name: z.string(),
  domain: z.string().optional(),
  isTestMode: z.boolean().default(false),
  testMode: z.boolean().default(false),
  config: z.object({
    stripe: z.object({
      publicKey: z.string().optional(),
      secretKey: z.string().optional(),
    }).optional(),
    efi: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      certificate: z.string().optional(),
    }).optional(),
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertTenantSchema = tenantSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Tenant = z.infer<typeof tenantSchema>;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

// Checkout Schema
export const checkoutSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  productId: z.string().optional(), // ID do produto associado
  syncedProductId: z.string().optional(), // ID do produto sincronizado para ofertas
  slug: z.string().min(1, "Slug é obrigatório").max(200, "Slug deve ter no máximo 200 caracteres"),
  title: z.string()
    .min(1, "Título é obrigatório")
    .max(200, "Título deve ter no máximo 200 caracteres")
    .refine((val) => sanitizeAndValidateInput(val, 200, 'Título').isValid, (val) => ({
      message: sanitizeAndValidateInput(val, 200, 'Título').error || 'Título contém caracteres inválidos'
    })),
  subtitle: z.string()
    .max(200, "Subtítulo deve ter no máximo 200 caracteres")
    .optional()
    .refine((val) => !val || sanitizeAndValidateInput(val, 200, 'Subtítulo').isValid, (val) => ({
      message: val ? (sanitizeAndValidateInput(val, 200, 'Subtítulo').error || 'Subtítulo contém caracteres inválidos') : ''
    })),
  logoUrl: z.string().optional(),
  sellerDisplayName: z.string().max(100, "Nome do vendedor deve ter no máximo 100 caracteres").optional(), // Nome personalizado para exibição na vitrine
  theme: z.object({
    primary: z.string(),
    secondary: z.string(),
  }),
  productType: z.enum(["digital", "ebook", "subscription", "service", "other"]).default("digital"),
  
  // 🌍 CONFIGURAÇÕES GLOBAIS DE IDIOMA E PAÍS
  globalSettings: z.object({
    language: z.enum([
      "pt", "en", "es", "fr", "de", "it", "ja", "ko", "zh", 
      "ru", "ar", "hi", "nl", "sv", "no", "da", "fi", "pl", "tr"
    ]).default("en"), // Idioma padrão para checkouts globais
    country: z.enum([
      "US", "GB", "CA", "AU", "FR", "DE", "IT", "ES", "NL", "SE", 
      "NO", "DK", "FI", "JP", "KR", "CN", "IN", "BR", "MX", "AR", "CL"
    ]).default("US"), // País alvo para checkouts globais
    currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "KRW", "CNY", "INR", "BRL"]).default("USD"),
  }).optional(), // Só para checkouts globais
  
  fields: z.object({
    name: z.object({ enabled: z.boolean(), required: z.boolean() }),
    email: z.object({ enabled: z.boolean(), required: z.boolean() }),
    document: z.object({ enabled: z.boolean(), required: z.boolean() }),
    phone: z.object({ enabled: z.boolean(), required: z.boolean() }),
    address: z.object({ 
      enabled: z.boolean(), 
      required: z.boolean(),
      street: z.object({ enabled: z.boolean(), required: z.boolean() }),
      number: z.object({ enabled: z.boolean(), required: z.boolean() }),
      complement: z.object({ enabled: z.boolean(), required: z.boolean() }),
      neighborhood: z.object({ enabled: z.boolean(), required: z.boolean() }),
      city: z.object({ enabled: z.boolean(), required: z.boolean() }),
      state: z.object({ enabled: z.boolean(), required: z.boolean() }),
      zipCode: z.object({ enabled: z.boolean(), required: z.boolean() }),
    }).optional(),
  }),
  pricing: z.object({
    type: z.enum(["fixed"]).default("fixed"),
    amount: z.number().min(0, "Valor é obrigatório").max(999999900, "Valor máximo é R$ 9.999.999,00"),
    billingType: z.enum(["one_time", "subscription"]).default("one_time"),
    subscriptionPeriod: z.enum(["monthly", "quarterly", "semiannual", "annual"]).optional(),
    guaranteeDays: z.number().default(7), // Garantia fixa obrigatória de 7 dias
  }),
  currency: z.string().default("BRL"),
  marketTarget: z.enum(["brasil", "global"]).default("brasil"),
  
  // 🎨 CONFIGURAÇÕES DE LAYOUT E DESIGN
  layout: z.enum(["classic", "white-v1"]).default("classic"),
  displayMode: z.enum(["light", "dark"]).default("light"), // 🌓 Tema claro ou escuro
  bannerUrl: z.string().url().optional().or(z.literal("")),
  
  // 🏪 CONFIGURAÇÕES DE VITRINE E AFILIADOS
  showcase: z.object({
    enabled: z.boolean().default(false), // Se o checkout aparece na vitrine pública
    category: z.enum(["digital", "subscriptions", "courses", "ebooks", "software", "services", "others"]).default("others"),
    tags: z.array(z.string()).default([]), // Tags para busca e filtros
    featured: z.boolean().default(false), // Se é destaque na vitrine
    shortDescription: z.string().max(200, "Descrição deve ter no máximo 200 caracteres").optional(), // Descrição curta para vitrine
  }).optional(),
  
  affiliate: z.object({
    enabled: z.boolean().default(false), // Se permite afiliados
    autoApprove: z.boolean().default(true), // Aprovação automática de afiliados (padrão verdadeiro)
    commissionPercent: z.number().min(0).max(50).default(10), // Percentual de comissão (0-50%)
    cookieDuration: z.number().default(30), // Duração do cookie em dias (padrão 30)
    paymentDelay: z.number().default(30), // Dias para liberar comissão após venda (padrão 30)
    minPayout: z.number().default(5000), // Valor mínimo para saque em centavos (R$ 50.00)
  }).optional(),
  methods: z.object({
    pix: z.boolean().default(true),
    card: z.boolean().default(true),
    boleto: z.boolean().default(false),
  }).default({ pix: true, card: true, boleto: false }).refine(
    (methods) => methods.pix || methods.card || methods.boleto,
    { message: "Pelo menos um método de pagamento deve ser selecionado" }
  ),
  urls: z.object({
    success: z.string().optional().default(""),
    cancel: z.string().optional().default(""),
  }),
  exitIntent: z.object({
    enabled: z.boolean().default(false),
    type: z.enum(["text", "video", "whatsapp"]).default("text"),
    title: z.string().max(200, "Título deve ter no máximo 200 caracteres").default("🚨 Espera! Não vá embora!"),
    description: z.string().max(200, "Descrição deve ter no máximo 200 caracteres").default("Você tem uma chance única de adquirir este produto com desconto especial!"),
    buttonText: z.string().max(200, "Texto do botão deve ter no máximo 200 caracteres").default("Aproveitar Oferta"),
    buttonUrl: z.string().max(200, "URL deve ter no máximo 200 caracteres").default(""),
    redirectCheckoutId: z.string().default(""), // ID do checkout para redirecionamento
    whatsappNumber: z.string().max(200, "Número deve ter no máximo 200 caracteres").default(""),
    whatsappMessage: z.string().max(200, "Mensagem deve ter no máximo 200 caracteres").default("Olá! Vi sua oferta especial e tenho interesse!"),
    videoUrl: z.string().max(200, "URL deve ter no máximo 200 caracteres").default(""),
    backgroundColor: z.string().default("#dc2626"),
    textColor: z.string().default("#ffffff"),
    discountPercent: z.number().min(0).max(90).default(0),
  }),
  timer: z.object({
    enabled: z.boolean(),
    title: z.string().max(200, "Título deve ter no máximo 200 caracteres"),
    description: z.string().max(200, "Descrição deve ter no máximo 200 caracteres"),
    minutes: z.number(),
    color: z.string(),
    backgroundColor: z.string(),
  }),
  banner: z.object({
    enabled: z.boolean(),
    // 🖼️ CONFIGURAÇÕES DE IMAGEM
    imageAbove: z.object({
      enabled: z.boolean().default(false),
      imageUrl: z.string().url().optional().or(z.literal("")),
    }).default({ enabled: false, imageUrl: "" }),
    imageBelow: z.object({
      enabled: z.boolean().default(false),
      imageUrl: z.string().url().optional().or(z.literal("")),
    }).default({ enabled: false, imageUrl: "" }),
  }),
  orderBump: z.object({
    enabled: z.boolean().default(false),
    title: z.string().max(200, "Título deve ter no máximo 200 caracteres").default("🎁 Oferta Especial Para Você!"),
    subtitle: z.string().max(200, "Subtítulo deve ter no máximo 200 caracteres").default("Aproveite esta oferta única e aumente seu investimento"),
    products: z.array(z.object({
      checkoutId: z.string(), // ID do checkout/produto real do seller
      title: z.string().max(200, "Título deve ter no máximo 200 caracteres"),
      description: z.string().max(200, "Descrição deve ter no máximo 200 caracteres").optional(),
      customTitle: z.string().max(200, "Título deve ter no máximo 200 caracteres").optional(), // Título personalizado para o order bump
      customDescription: z.string().max(200, "Descrição deve ter no máximo 200 caracteres").optional(), // Descrição personalizada para o order bump
      price: z.number(),
      originalPrice: z.number().optional(),
      imageUrl: z.string().optional(),
      discount: z.number().min(0).max(90).default(0), // % de desconto
    })).default([]),
  }),
  
  // 🎯 PIXELS DE RASTREAMENTO - GOOGLE, FACEBOOK, TIKTOK, PINTEREST, KWAI
  // ✅ Facebook & TikTok: SEM TOKEN (apenas Pixel ID)
  // ✅ Google Ads: Measurement ID + Conversion Label
  // ✅ Google Analytics 4: Measurement ID (G-XXXXXXXXXX)
  tiktokPixel: z.string().max(100, "TikTok Pixel deve ter no máximo 100 caracteres").optional().or(z.literal("")),
  facebookPixel: z.string().max(100, "Facebook Pixel deve ter no máximo 100 caracteres").optional().or(z.literal("")),
  googleAdsId: z.string().max(100, "Google Ads ID deve ter no máximo 100 caracteres").optional().or(z.literal("")),
  googleAdsLabel: z.string().max(100, "Google Ads Label deve ter no máximo 100 caracteres").optional().or(z.literal("")),
  googleAnalytics4Id: z.string().max(100, "Google Analytics 4 ID deve ter no máximo 100 caracteres").optional().or(z.literal("")),
  pinterestPixel: z.string().max(100, "Pinterest Pixel deve ter no máximo 100 caracteres").optional().or(z.literal("")),
  kawaiPixel: z.string().max(100, "Kwai Pixel deve ter no máximo 100 caracteres").optional().or(z.literal("")),
  
  // 📊 ANALYTICS DE CHECKOUT - MÉTRICAS EM TEMPO REAL
  analytics: z.object({
    pageViews: z.number().int().nonnegative().default(0), // Visualizações da página
    formFilled: z.number().int().nonnegative().default(0), // Formulários preenchidos completamente
    paymentClicked: z.number().int().nonnegative().default(0), // Cliques no botão de pagamento
    activeNow: z.number().int().nonnegative().default(0), // Visitantes ativos agora (últimos 2 minutos)
  }).default({ pageViews: 0, formFilled: 0, paymentClicked: 0, activeNow: 0 }),
  
  // 🔐 CONTADOR ATÔMICO DE VENDAS (para lock de deleção 100% seguro)
  salesCount: z.number().int().nonnegative().default(0), // Incrementa atomicamente a cada venda
  
  // 🗑️ SOFT-DELETE SYSTEM
  deleted: z.boolean().default(false).optional(),
  deletedAt: z.date().optional(),
  deletedBy: z.string().optional(),
  
  documentMode: z.enum(['cpf', 'cnpj', 'both']).default('both'), // Tipo de documento aceito no checkout

  active: z.boolean().default(true),
  testMode: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertCheckoutSchema = checkoutSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Checkout = z.infer<typeof checkoutSchema>;
export type InsertCheckout = z.infer<typeof insertCheckoutSchema>;

export function getCheckoutsByTenant(tenantId: string) {
  return checkoutSchema.extend({ tenantId: z.literal(tenantId) });
}

// Product Schema - ÁREA DE MEMBROS/CONTEÚDO
export const productSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string()
    .min(1, "Título é obrigatório")
    .max(200, "Título deve ter no máximo 200 caracteres")
    .refine((val) => {
      const result = sanitizeAndValidateInput(val, 200, 'Título');
      return result.isValid;
    }, (val) => {
      const result = sanitizeAndValidateInput(val, 200, 'Título');
      return { message: result.error || 'Título contém caracteres inválidos' };
    }),
  description: z.string()
    .max(200, "Descrição deve ter no máximo 200 caracteres")
    .optional()
    .refine((val) => {
      if (!val) return true; // Allow empty/undefined
      const result = sanitizeAndValidateInput(val, 200, 'Descrição');
      return result.isValid;
    }, (val) => {
      if (!val) return { message: '' };
      const result = sanitizeAndValidateInput(val, 200, 'Descrição');
      return { message: result.error || 'Descrição contém caracteres inválidos' };
    }),
  imageUrl: z.string().optional().or(z.literal("")),
  productType: z.enum(["digital", "ebook", "subscription", "service", "other"]).default("digital"),
  
  // 🔗 INTEGRAÇÃO COM CHECKOUT
  checkoutId: z.string().optional(), // ID do checkout para pagamento
  
  // 🌐 URL PERSONALIZADA
  customUrl: z.string().url("Deve ser uma URL válida").max(200, "URL deve ter no máximo 200 caracteres").optional(), // URL personalizada do produto
  
  // 🏷️ NOME DO VENDEDOR PARA EXIBIÇÃO NA VITRINE
  sellerDisplayName: z.string().max(100, "Nome de exibição deve ter no máximo 100 caracteres").optional(), // Nome personalizado que aparece na vitrine ao invés do nome da empresa
  
  // 🌐 URL DA PÁGINA DE VENDAS (PARA AFILIADOS)
  salesPageUrl: z.string().url("Deve ser uma URL válida").max(500, "URL deve ter no máximo 500 caracteres").optional().or(z.literal("")), // URL oficial da página de vendas onde afiliados direcionam tráfego e comissões são contabilizadas
  
  // ACESSO E CONTEÚDO
  hasAccess: z.boolean().default(true), // Se tem área de membros
  accessDuration: z.number().optional(), // Dias de acesso específico
  
  // NOTIFICAÇÕES DE EXPIRAÇÃO
  notifyExpirationDays: z.array(z.number()).default([7, 2, 1]), // Avisar 7, 2, 1 dia antes
  
  // 🗑️ SISTEMA DE SOLICITAÇÃO DE EXCLUSÃO (APROVAÇÃO ADMIN)
  deletionRequest: z.object({
    status: z.enum(["none", "pending", "approved", "rejected"]).default("none"),
    requestedAt: z.date().optional(), // Quando seller solicitou exclusão
    requestedBy: z.string().optional(), // UID do seller que solicitou
    reason: z.string().max(500).optional(), // Motivo da exclusão
    reviewedAt: z.date().optional(), // Quando admin aprovou/rejeitou
    reviewedBy: z.string().optional(), // UID do admin que aprovou/rejeitou
    rejectionReason: z.string().max(500).optional(), // Motivo da rejeição (se rejeitado)
  }).default({ status: "none" }),
  
  // 🔒 CONTROLE DE EXCLUSÃO
  deletedAt: z.date().optional(), // Data da exclusão real (após aprovação admin)
  deletedBy: z.string().optional(), // UID do admin que aprovou a exclusão
  
  // 🤝 CONFIGURAÇÕES DE AFILIADOS
  affiliateConfig: z.object({
    enabled: z.boolean().default(false),
    autoApprove: z.boolean().default(false),
    extendCommission: z.boolean().default(false),
    shareData: z.boolean().default(false),
    marketplaceEnabled: z.boolean().default(false),
    commissions: z.object({
      single: z.number().min(0).max(100).default(10),
      recurring: z.number().min(0).max(100).default(0),
      type: z.enum(["todas", "primeira", "fixo"]).default("todas"),
    }),
    preference: z.enum(["primeiro", "ultimo"]).default("ultimo"),
    cookieDuration: z.number().min(1).max(365).default(30),
    selectedOffers: z.array(z.string()).default([]),
    support: z.object({
      name: z.string().default(""),
      email: z.string().email().or(z.literal("")).default(""),
      phone: z.string().default(""),
    }),
    salesPage: z.string().url().or(z.literal("")).default(""),
    rules: z.string().max(1000).optional(),
  }).default({
    enabled: false,
    autoApprove: false,
    extendCommission: false,
    shareData: false,
    marketplaceEnabled: false,
    commissions: {
      single: 10,
      recurring: 0,
      type: "todas" as const
    },
    preference: "ultimo" as const,
    cookieDuration: 30,
    selectedOffers: [],
    support: {
      name: "",
      email: "",
      phone: ""
    },
    salesPage: ""
  }),
  
  // 🎨 PREFERÊNCIAS DE PRODUTO (SINCRONIZADAS COM CHECKOUTS)
  category: z.enum(["digital", "subscriptions", "courses", "ebooks", "software", "services", "others", "apps"]).default("others").optional(),
  language: z.enum([
    "pt", "en", "es", "fr", "de", "it", "ja", "ko", "zh", 
    "ru", "ar", "hi", "nl", "sv", "no", "da", "fi", "pl", "tr"
  ]).default("pt").optional(),
  currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "KRW", "CNY", "INR", "BRL"]).default("BRL").optional(),
  
  membersAreaEnabled: z.boolean().default(false).optional(),
  allowMultiplePurchases: z.boolean().default(false).optional(),
  
  active: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertProductSchema = productSchema.omit({
  id: true,
  deletedAt: true,
  deletedBy: true,
  createdAt: true,
  updatedAt: true,
});

export const updateProductSchema = productSchema.partial().omit({
  id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedBy: true,
  deletionRequest: true,
});

export type Product = z.infer<typeof productSchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;

// Product Offer Schema - MÚLTIPLAS OFERTAS POR PRODUTO (HOTMART/KIWIFY STYLE)
export const productOfferSchema = z.object({
  id: z.string(),
  productId: z.string(),
  tenantId: z.string(),
  
  // 🔗 DADOS DA OFERTA
  slug: z.string().min(3, "Slug deve ter pelo menos 3 caracteres").max(100, "Slug deve ter no máximo 100 caracteres").regex(/^[a-z0-9-]+$/, "Slug deve conter apenas letras minúsculas, números e hífens"),
  title: z.string()
    .min(1, "Título é obrigatório")
    .max(200, "Título deve ter no máximo 200 caracteres")
    .refine((val) => sanitizeAndValidateInput(val, 200, 'Título').isValid, (val) => ({
      message: sanitizeAndValidateInput(val, 200, 'Título').error || 'Título contém caracteres inválidos'
    })),
  description: z.string()
    .max(200, "Descrição deve ter no máximo 200 caracteres")
    .optional()
    .refine((val) => !val || sanitizeAndValidateInput(val, 200, 'Descrição').isValid, (val) => ({
      message: val ? (sanitizeAndValidateInput(val, 200, 'Descrição').error || 'Descrição contém caracteres inválidos') : ''
    })),
  
  // 💰 PREÇO DA OFERTA
  price: z.number().min(0, "Preço deve ser maior ou igual a 0"),
  currency: z.string().default("BRL"),
  
  // 🔄 PERÍODO DE RECORRÊNCIA (APENAS PARA ASSINATURAS)
  subscriptionPeriod: z.enum(["monthly", "quarterly", "semiannual", "annual"]).optional(),
  
  // 🎨 VISUAL (OPCIONAL - USA DO PRODUTO SE NÃO DEFINIR)
  imageUrl: z.string().url("URL da imagem inválida").optional().or(z.literal("")),
  
  // 💳 MÉTODOS DE PAGAMENTO HABILITADOS
  paymentMethods: z.object({
    pix: z.boolean().default(true), // PIX habilitado por padrão
    boleto: z.boolean().default(false), // Boleto bancário
    card: z.boolean().default(false), // Cartão de crédito/débito
    cardBr: z.boolean().default(false), // Cartão brasileiro (EfíBank)
    cardGlobal: z.boolean().default(false), // Cartão global (Stripe)
  }).optional(),
  
  // 💰 CONFIGURAÇÕES DE PARCELAMENTO
  installments: z.object({
    enabled: z.boolean().default(false), // Parcelamento habilitado
    maxInstallments: z.number().min(1).max(12).default(12), // Máximo de parcelas (1-12)
    minInstallmentValue: z.number().min(500).default(500), // Valor mínimo por parcela em centavos (R$ 5,00)
    interestFree: z.number().min(0).max(12).default(0), // Parcelas sem juros (0 = todas com juros)
  }).optional(),
  
  // 📊 STATUS
  active: z.boolean().default(true),
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertProductOfferSchema = productOfferSchema.omit({
  id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
});

export type ProductOffer = z.infer<typeof productOfferSchema>;
export type InsertProductOffer = z.infer<typeof insertProductOfferSchema>;

// Function to generate offer ID
export function generateProductOfferId(): string { return `offer_${generateUniqueId()}`; }

// Module Schema
export const moduleSchema = z.object({
  id: z.string(),
  productId: z.string(),
  tenantId: z.string(), // Tenant do seller dono do módulo
  title: z.string()
    .min(1, "Título é obrigatório")
    .max(200, "Título deve ter no máximo 200 caracteres")
    .refine((val) => sanitizeAndValidateInput(val, 200, 'Título').isValid, (val) => ({
      message: sanitizeAndValidateInput(val, 200, 'Título').error || 'Título contém caracteres inválidos'
    })),
  description: z.string()
    .max(200, "Descrição deve ter no máximo 200 caracteres")
    .optional()
    .refine((val) => !val || sanitizeAndValidateInput(val, 200, 'Descrição').isValid, (val) => ({
      message: val ? (sanitizeAndValidateInput(val, 200, 'Descrição').error || 'Descrição contém caracteres inválidos') : ''
    })),
  imageUrl: z.string().url().optional().or(z.literal("")), // Capa do módulo
  position: z.number().min(0),
  active: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertModuleSchema = moduleSchema.omit({
  id: true,
  tenantId: true,
  position: true,
  createdAt: true,
  updatedAt: true,
});

export type Module = z.infer<typeof moduleSchema>;
export type InsertModule = z.infer<typeof insertModuleSchema>;

// Lesson Schema  
export const lessonSchema = z.object({
  id: z.string(),
  productId: z.string(), // Para facilitar consultas
  moduleId: z.string(),
  tenantId: z.string(), // Tenant do seller dono da aula
  title: z.string().min(1, "Título é obrigatório"),
  description: z.string().optional(),
  imageUrl: z.string().optional().or(z.literal("")), // Capa da aula
  videoType: z.enum(["youtube", "vimeo", "panda", "bunny", "custom"]),
  videoUrl: z.string().min(1, "URL do vídeo é obrigatória").url("URL deve ser válida"),
  bunnyVideoGuid: z.string().optional(), // GUID do vídeo no Bunny Stream
  duration: z.number().optional(), // em segundos
  position: z.number().min(0),
  active: z.boolean().default(true),
  attachmentUrl: z.string().optional().or(z.literal("")), // URL do PDF/arquivo anexado
  externalUrl: z.string().optional().or(z.literal("")), // URL externa clicável
  releaseAfterDays: z.number().min(0).default(0), // Liberar após X dias da compra (0 = imediato)
  visibility: z.enum(["mostrar", "ocultar"]).default("mostrar"), // Visibilidade da aula
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertLessonSchema = lessonSchema.omit({
  id: true,
  tenantId: true,
  position: true,
  createdAt: true,
  updatedAt: true,
});

export type Lesson = z.infer<typeof lessonSchema>;
export type InsertLesson = z.infer<typeof insertLessonSchema>;

// Seller Schema - CADASTRO COMPLETO DE VENDEDOR
export const sellerSchema = z.object({
  id: z.string(), // Firebase Auth UID
  userId: z.string(), // Firebase Auth UID (mesmo que id)
  tenantId: z.string().optional(), // Tenant único para cada seller
  
  // DADOS PESSOAIS
  name: z.string().min(1, "Nome é obrigatório").max(200, "Nome deve ter no máximo 200 caracteres"),
  email: z.string().email("Email inválido").max(200, "Email deve ter no máximo 200 caracteres"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres").max(200, "Senha deve ter no máximo 200 caracteres"),
  phone: z.string().min(10, "Telefone/WhatsApp é obrigatório").max(200, "Telefone deve ter no máximo 200 caracteres"),
  birthDate: z.string().min(10, "Data de nascimento é obrigatória").max(200, "Data deve ter no máximo 200 caracteres"),
  
  // DADOS DA EMPRESA/PESSOA
  businessName: z.string().min(1, "Nome da empresa/negócio é obrigatório").max(200, "Nome deve ter no máximo 200 caracteres"),
  documentType: z.enum(["cpf", "cnpj"], { required_error: "Tipo de documento é obrigatório" }),
  document: z.string().min(11, "Documento é obrigatório").max(200, "Documento deve ter no máximo 200 caracteres"),
  
  // ENDEREÇO DA EMPRESA
  address: z.object({
    street: z.string().min(1, "Rua é obrigatória").max(200, "Rua deve ter no máximo 200 caracteres"),
    number: z.string().min(1, "Número é obrigatório").max(200, "Número deve ter no máximo 200 caracteres"),
    complement: z.string().max(200, "Complemento deve ter no máximo 200 caracteres").optional(),
    neighborhood: z.string().min(1, "Bairro é obrigatório").max(200, "Bairro deve ter no máximo 200 caracteres"),
    city: z.string().min(1, "Cidade é obrigatória").max(200, "Cidade deve ter no máximo 200 caracteres"),
    state: z.string().min(2, "Estado é obrigatório").max(2),
    zipCode: z.string().min(8, "CEP é obrigatório").max(9), // Aceita CEP com ou sem hífen
  }),
  
  // DOCUMENTOS PESSOAIS
  personalDocumentType: z.enum(["rg", "cpf", "cnh"], { required_error: "Tipo de documento pessoal é obrigatório" }),
  personalDocumentNumber: z.string().min(8, "Número do documento pessoal é obrigatório").max(200, "Número deve ter no máximo 200 caracteres"),
  
  // URLS DOS DOCUMENTOS UPLOADADOS (OBRIGATÓRIOS PARA VERIFICAÇÃO)
  documentsUrls: z.object({
    documentFront: z.string().min(1, "Frente do documento é obrigatória"), // Frente RG/CNH
    documentBack: z.string().min(1, "Verso do documento é obrigatório"), // Verso RG/CNH
    selfieWithDocument: z.string().min(1, "Selfie com documento é obrigatória"), // Selfie segurando documento
    cnpjCard: z.string().optional().default(""), // Cartão CNPJ em PDF (obrigatório apenas para CNPJ)
    facialVerification: z.string().optional().default(""), // Vídeo de verificação facial KYC
  }),
  
  // NEGÓCIO
  businessNiche: z.string().min(1, "Nicho do negócio é obrigatório").max(200, "Nicho deve ter no máximo 200 caracteres"),
  productType: z.enum(["digital", "subscription"], { required_error: "Tipo de produto é obrigatório" }),
  productsDescription: z.string().min(10, "Descrição dos produtos deve ter pelo menos 10 caracteres").max(200, "Descrição deve ter no máximo 200 caracteres"),
  
  // 💰 CONFIGURAÇÕES FINANCEIRAS ESPECÍFICAS DO SELLER
  financialSettings: z.object({
    // 🇧🇷 PRAZOS DE LIBERAÇÃO BRASIL (D+X)
    withdrawalDelayDays: z.object({
      pix: z.number().default(0), // PIX = imediato
      cardBR: z.number().default(20), // Cartão BR = D+20 (padrão, admin pode alterar)
    }).default({
      pix: 0,
      cardBR: 20
    }),
    
    // 🌍 PRAZOS DE LIBERAÇÃO GLOBAL (STRIPE)
    globalWithdrawalDelayDays: z.object({
      cardGlobal: z.number().default(7), // Stripe = D+7 (padrão, admin pode alterar)
    }).default({
      cardGlobal: 7
    }),
    
    // 📊 TAXAS PERSONALIZADAS (Se admin quiser alterar)
    customFees: z.object({
      pix: z.object({
        fixedFee: z.number().default(249), // R$ 2,49 em centavos
        percentFee: z.number().default(0.02), // 2%
      }).default({ fixedFee: 249, percentFee: 0.02 }),
      
      cardBR: z.object({
        fixedFee: z.number().default(249), // R$ 2,49 em centavos
        percentFee: z.number().default(0.052), // 5.2%
      }).default({ fixedFee: 249, percentFee: 0.052 }),
      
      cardGlobal: z.object({
        fixedFeeBRL: z.number().default(150), // ~U$0.30 em BRL centavos
        percentFee: z.number().default(0.064), // 6.4%
      }).default({ fixedFeeBRL: 150, percentFee: 0.064 }),
    }).default({
      pix: { fixedFee: 249, percentFee: 0.02 },
      cardBR: { fixedFee: 249, percentFee: 0.052 },
      cardGlobal: { fixedFeeBRL: 150, percentFee: 0.064 }
    }),
    
    // 🔧 CONFIGURAÇÕES ADMINISTRATIVAS
    adminOverride: z.boolean().default(false), // Se admin alterou configurações manualmente
    lastUpdatedBy: z.string().optional(), // ID do admin que alterou
    lastUpdatedAt: z.date().optional(), // Data da última alteração
  }).default({
    withdrawalDelayDays: { pix: 0, cardBR: 20 },
    globalWithdrawalDelayDays: { cardGlobal: 7 },
    customFees: {
      pix: { fixedFee: 249, percentFee: 0.02 },
      cardBR: { fixedFee: 249, percentFee: 0.052 },
      cardGlobal: { fixedFeeBRL: 150, percentFee: 0.064 }
    },
    adminOverride: false
  }),
  
  // 🏦 CONFIGURAÇÕES DE ADQUIRENTES POR SELLER
  acquirerConfig: z.object({
    // PIX sempre habilitado por padrão
    pixEnabled: z.boolean().default(true),
    pixAcquirer: z.enum(['efibank', 'woovi', 'onz', 'pagarme']).default('efibank'),
    
    // Cartão brasileiro (apenas 1 tipo permitido: brasileiro OU global)
    brazilianCardEnabled: z.boolean().default(true),
    brazilianCardAcquirer: z.enum(['efibank', 'pagarme']).default('efibank'),
    
    // Cartão global (desabilitado por padrão)
    globalCardEnabled: z.boolean().default(false),
    globalCardAcquirer: z.enum(['stripe', 'adyen', 'pagarme']).default('stripe'),
    
    // Configurações técnicas dos adquirentes
    efibank: z.object({
      enabled: z.boolean().default(true),
      environment: z.enum(['sandbox', 'production']).default('sandbox'),
      clientId: z.string().default(''),
      clientSecret: z.string().default(''),
      pixKey: z.string().default('')
    }).default({
      enabled: true,
      environment: 'sandbox',
      clientId: '',
      clientSecret: '',
      pixKey: ''
    }),
    
    stripe: z.object({
      enabled: z.boolean().default(false),
      environment: z.enum(['test', 'live']).default('test'),
      publicKey: z.string().default(''),
      secretKey: z.string().default(''),
      webhookSecret: z.string().default('')
    }).default({
      enabled: false,
      environment: 'test',
      publicKey: '',
      secretKey: '',
      webhookSecret: ''
    }),
    
    adyen: z.object({
      enabled: z.boolean().default(false),
      environment: z.enum(['test', 'live']).default('test'),
      apiKey: z.string().default(''),
      merchantAccount: z.string().default(''),
      hmacKey: z.string().default('')
    }).default({
      enabled: false,
      environment: 'test',
      apiKey: '',
      merchantAccount: '',
      hmacKey: ''
    })
  }).default({
    pixEnabled: true,
    pixAcquirer: 'efibank',
    brazilianCardEnabled: true,
    brazilianCardAcquirer: 'efibank',
    globalCardEnabled: false,
    globalCardAcquirer: 'stripe',
    efibank: {
      enabled: true,
      environment: 'sandbox',
      clientId: '',
      clientSecret: '',
      pixKey: ''
    },
    stripe: {
      enabled: false,
      environment: 'test',
      publicKey: '',
      secretKey: '',
      webhookSecret: ''
    },
    adyen: {
      enabled: false,
      environment: 'test',
      apiKey: '',
      merchantAccount: '',
      hmacKey: ''
    }
  }),
  
  // 🏦 CAMPO FLAT DE ADQUIRENTES (lido diretamente pelo checkout payment route)
  // Populado automaticamente no registro e atualizado pelo admin via propagação
  acquirers: z.object({
    pix: z.string().optional(),
    creditCardBR: z.string().optional(),
    creditCard: z.string().optional(),
    creditCardGlobal: z.string().optional(),
    boleto: z.string().optional(),
  }).optional(),

  // TERMOS E STATUS
  acceptedTerms: z.boolean().refine(val => val === true, "Você deve aceitar os termos de uso"),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  
  // 🔒 BLOQUEIO DE CATEGORIAS DO MENU (liberado após aprovação admin)
  blockedCategories: z.array(z.string()).default([]),
  
  // ⚖️ LGPD/GDPR - CONSENTIMENTO PARA COLETA DE DADOS TÉCNICOS
  acceptedDataTracking: z.boolean().default(false), // Consentimento explícito para coletar dados técnicos
  dataTrackingConsentDate: z.date().optional(), // Data do consentimento
  dataTrackingConsentVersion: z.string().optional(), // Versão dos termos aceitos
  deviceFingerprint: z.any().optional(), // Dados técnicos do dispositivo (coletado com consentimento)
  registrationIP: z.string().optional(), // IP de registro (coletado com consentimento)
  
  // 🛡️ RASTREAMENTO DE SEGURANÇA (OBRIGATÓRIO - SEM NECESSIDADE DE CONSENTIMENTO)
  lastLoginIP: z.string().optional(), // Último IP de login/acesso (atualizado em tempo real)
  lastLoginAt: z.date().optional(), // Data/hora do último login
  lastLoginDevice: z.string().optional(), // Tipo de dispositivo do último acesso
  
  // DATAS DE CONTROLE
  approvedAt: z.date().optional(),
  rejectedAt: z.date().optional(),
  rejectionReason: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertSellerSchema = sellerSchema.omit({
  id: true,
  tenantId: true, // Auto-gerado no servidor
  status: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
});

// 💰 Schema para configurações financeiras específicas de seller (admin only)
export const sellerFinancialUpdateSchema = z.object({
  sellerId: z.string(),
  withdrawalDelayDays: z.object({
    pix: z.number().min(0).max(365),
    cardBR: z.number().min(0).max(365),
  }).optional(),
  globalWithdrawalDelayDays: z.object({
    cardGlobal: z.number().min(0).max(365),
  }).optional(),
  customFees: z.object({
    pix: z.object({
      fixedFee: z.number().min(0),
      percentFee: z.number().min(0).max(1),
    }).optional(),
    cardBR: z.object({
      fixedFee: z.number().min(0),
      percentFee: z.number().min(0).max(1),
    }).optional(),
    cardGlobal: z.object({
      fixedFeeBRL: z.number().min(0),
      percentFee: z.number().min(0).max(1),
    }).optional(),
  }).optional(),
});

export type SellerFinancialUpdate = z.infer<typeof sellerFinancialUpdateSchema>;

// Validação real de CPF (algoritmo oficial Receita Federal)
function isValidCPF(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
  let r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(d[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(d[i]) * (11 - i);
  r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(d[10]);
}

// Validação real de CNPJ (algoritmo oficial Receita Federal)
function isValidCNPJ(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (str: string, w: number[]) => {
    const s = w.reduce((acc, wt, i) => acc + parseInt(str[i]) * wt, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (calc(d, [5,4,3,2,9,8,7,6,5,4,3,2]) !== parseInt(d[12])) return false;
  return calc(d, [6,5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(d[13]);
}

// Schema para o formulário de registro (com confirmação de senha e email)
export const sellerRegisterFormSchema = insertSellerSchema.omit({
  userId: true, // 🔧 userId será gerado automaticamente pelo sistema
  financialSettings: true, // 🔧 Será gerado automaticamente
  acquirerConfig: true, // 🔧 Será gerado automaticamente
}).extend({
  confirmEmail: z.string().email("Email de confirmação deve ser válido"),
  confirmPassword: z.string().min(6, "Confirmação de senha deve ter pelo menos 6 caracteres"),
}).refine((data) => data.email === data.confirmEmail, {
  message: "Emails não coincidem",
  path: ["confirmEmail"],
}).refine((data) => data.password === data.confirmPassword, {
  message: "Senhas não coincidem",
  path: ["confirmPassword"],
}).refine((data) => {
  const digits = data.document.replace(/\D/g, "");
  if (data.documentType === "cpf") return isValidCPF(digits);
  if (data.documentType === "cnpj") return isValidCNPJ(digits);
  return true;
}, {
  message: "CPF ou CNPJ inválido. Verifique os dígitos informados.",
  path: ["document"],
});

export type Seller = z.infer<typeof sellerSchema>;
export type InsertSeller = z.infer<typeof insertSellerSchema>;
export type SellerRegisterForm = z.infer<typeof sellerRegisterFormSchema>;

// Member Schema (Comprador com acesso à área de membros)
export const memberSchema = z.object({
  id: z.string(), // Firebase Auth UID
  userId: z.string(), // Firebase Auth UID (mesmo que id)
  email: z.string().email(),
  name: z.string(),
  whatsapp: z.string().optional(), // WhatsApp para contato
  password: z.string(), // Hash da senha
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertMemberSchema = memberSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Schema para registro de membro (área de membros)
export const memberRegisterSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("Email inválido"),
  whatsapp: z.string().min(10, "WhatsApp deve ter pelo menos 10 dígitos"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

// Schema para login de membro
export const memberLoginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Senha é obrigatória"),
});

export type Member = z.infer<typeof memberSchema>;
export type InsertMember = z.infer<typeof memberSchema>;
export type MemberRegister = z.infer<typeof memberRegisterSchema>;
export type MemberLogin = z.infer<typeof memberLoginSchema>;

// Enrollment Schema (Matrícula em Produto)
export const enrollmentSchema = z.object({
  id: z.string(),
  memberId: z.string(), // ID do membro
  productId: z.string(), // ID do produto
  orderId: z.string().optional(), // ID do pedido (se compra)
  enrollmentType: z.enum(["purchase", "manual"]), // Compra ou adicionado manual
  enrolledAt: z.date(),
  expiresAt: z.date().optional(), // Data de expiração (opcional)
  status: z.string().default("active"), // Status: 'active', 'expired', 'cancelled'
  customerEmail: z.string().optional(), // Email do cliente (para queries)
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertEnrollmentSchema = enrollmentSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Enrollment = z.infer<typeof enrollmentSchema>;
export type InsertEnrollment = z.infer<typeof insertEnrollmentSchema>;

// Progress Schema (Progresso nas aulas)
export const progressSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  lessonId: z.string(),
  moduleId: z.string(),
  productId: z.string(),
  watchedSeconds: z.number().min(0).default(0),
  totalSeconds: z.number().min(0).default(0),
  currentTimestamp: z.number().min(0).default(0), // Posição exata do vídeo para resume playback
  completed: z.boolean().default(false),
  completedAt: z.date().optional(),
  lastWatchedAt: z.date().optional(), // Última vez que assistiu
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertProgressSchema = progressSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Progress = z.infer<typeof progressSchema>;
export type InsertProgress = z.infer<typeof insertProgressSchema>;

// 🤝 AFFILIATION SCHEMA - SISTEMA DE AFILIAÇÃO DE PRODUTOS
export const affiliationSchema = z.object({
  id: z.string(),
  affiliateId: z.string(), // userId do afiliado
  affiliateName: z.string(), // Nome do afiliado
  affiliateEmail: z.string(), // Email do afiliado
  productId: z.string(), // ID do produto
  productName: z.string(), // Nome do produto (snapshot)
  sellerId: z.string(), // tenantId do vendedor
  sellerName: z.string(), // Nome do vendedor (snapshot)
  status: z.enum(["approved", "pending", "rejected"]).default("pending"),
  affiliateCode: z.string(), // Código único para tracking
  affiliateLink: z.string(), // Link completo de afiliado
  
  // 💰 SNAPSHOT DA COMISSÃO (preservado eternamente)
  commissionSnapshot: z.object({
    single: z.number(), // % comissão venda única
    subscription: z.number().optional(), // % comissão assinatura
  }),
  
  // 📊 ESTATÍSTICAS
  totalSales: z.number().default(0), // Total de vendas via link
  totalEarnings: z.number().default(0), // Total ganho em centavos
  
  // 📅 TIMESTAMPS
  createdAt: z.date(),
  approvedAt: z.date().optional(),
  rejectedAt: z.date().optional(),
  updatedAt: z.date(),
});

export const insertAffiliationSchema = affiliationSchema.omit({
  id: true,
  totalSales: true,
  totalEarnings: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  rejectedAt: true,
});

export type Affiliation = z.infer<typeof affiliationSchema>;
export type InsertAffiliation = z.infer<typeof insertAffiliationSchema>;

// 🛡️ GERADOR DE ID ÚNICO PARA AFILIAÇÕES
export function generateAffiliationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const nano_id = nanoid(12);
  return `aff_${timestamp}_${nano_id}_${random}`;
}

// 🛡️ GERADOR DE CÓDIGO DE AFILIADO (8 caracteres)
export function generateAffiliateCode(): string {
  return nanoid(8).toUpperCase();
}

// 🔄 SUBSCRIPTION SCHEMA - CONTROLE DE ASSINATURAS REAIS
export const subscriptionSchema = z.object({
  id: z.string().default(() => generateUniqueId()),
  tenantId: z.string(),
  checkoutId: z.string(),
  orderId: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string().optional(),
  customerDocument: z.string().optional(), // CPF/CNPJ do cliente
  customerAddress: z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
  }).optional(), // Endereço completo do cliente
  productName: z.string(),
  productId: z.string().optional(), // ID real do produto no Firestore
  offerName: z.string().optional(), // Nome da oferta
  offerId: z.string().optional(), // ID da oferta
  amount: z.number(),
  currency: z.string().default("BRL"),
  period: z.enum(["monthly", "quarterly", "semiannual", "annual"]),
  status: z.enum(["active", "cancelled", "expired", "paused"]).default("active"),
  autoRenew: z.boolean().default(true),
  recurringCount: z.number().optional().default(1), // Número do ciclo de cobrança (1ª, 2ª, 3ª, etc) - opcional para dados legados
  startDate: z.date(),
  nextBillingDate: z.date(),
  expiresAt: z.date(),
  lastPaymentDate: z.date().optional(),
  cancelledAt: z.date().optional(),
  paymentMethod: z.enum(["pix", "card", "stripe"]),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const insertSubscriptionSchema = subscriptionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Subscription = z.infer<typeof subscriptionSchema>;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// 🛡️ GERADORES DE ID ULTRA-ÚNICOS - PREPARADOS PARA MILHÕES!
export function generateSubscriptionId(): string { 
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const performance_id = performance.now().toString().replace('.', '');
  const nano_id = nanoid(12);
  return `sub_${timestamp}_${nano_id}_${random}_${performance_id}`;
}

// 🛡️ GERADOR DE ID ÚNICO PARA PRODUTOS (PAGAMENTO ÚNICO)
export function generateProductUniqueId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const performance_id = performance.now().toString().replace('.', '');
  const nano_id = nanoid(12);
  return `prod_${timestamp}_${nano_id}_${random}_${performance_id}`;
}

// 🛡️ GERADOR DE ID ÚNICO PARA ENROLLMENTS
export function generateEnrollmentUniqueId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const performance_id = performance.now().toString().replace('.', '');
  const nano_id = nanoid(12);
  return `enrollment_${timestamp}_${nano_id}_${random}_${performance_id}`;
}

// Withdrawal Schema (Saque)
export const withdrawalSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  sellerId: z.string().optional(), // Se seller específico
  type: z.enum(["pix", "card"]), // Tipo de saque
  amount: z.number().min(0), // Valor do saque
  pixKey: z.string().optional(), // Chave PIX para saque
  bankData: z.object({
    bank: z.string().optional(),
    agency: z.string().optional(),
    account: z.string().optional(),
    accountType: z.enum(["corrente", "poupanca"]).optional(),
  }).optional(),
  status: z.enum(["pending", "processing", "approved", "rejected"]).default("pending"),
  requestedAt: z.date(),
  processedAt: z.date().optional(),
  approvedAt: z.date().optional(),
  rejectedAt: z.date().optional(),
  rejectionReason: z.string().optional(),
  transactionId: z.string().optional(), // ID da transação bancária
  fee: z.number().min(0).default(0), // Taxa cobrada
  netAmount: z.number().min(0), // Valor líquido após taxas
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertWithdrawalSchema = withdrawalSchema.omit({
  id: true,
  status: true,
  requestedAt: true,
  processedAt: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  transactionId: true,
  createdAt: true,
  updatedAt: true,
});

export type Withdrawal = z.infer<typeof withdrawalSchema>;
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;

// API Schemas for Functions
export const createPaymentSessionSchema = z.object({
  checkoutId: z.string(),
  method: z.enum(["pix", "card"]),
  amount: z.number().positive(), // CAMPO OBRIGATÓRIO PARA PAGAMENTOS
  amountOverride: z.number().optional(),
  customer: customerSchema,
  customerAddress: z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
  }).optional(),
  productType: z.enum(["digital", "ebook", "subscription", "service", "other"]).optional(),
  cardData: z.object({
    number: z.string(),
    expiry: z.string(),
    cvv: z.string(),
    name: z.string(),
    payment_token: z.string(),
  }).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  // 🔗 SISTEMA DE AFILIADOS: UID real do Firebase Auth do afiliado
  affiliateUid: z.string().optional(),
});

export type CreatePaymentSessionRequest = z.infer<typeof createPaymentSessionSchema>;

export const createPaymentSessionResponseSchema = z.object({
  orderId: z.string(),
  method: z.enum(["pix", "card"]),
  clientSecret: z.string().optional(),
  qrcode: orderQrCodeSchema.optional(),
});

export type CreatePaymentSessionResponse = z.infer<typeof createPaymentSessionResponseSchema>;

// User Schema (for auth context)
export const userSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  photoURL: z.string().nullable(),
});

export type User = z.infer<typeof userSchema>;

// 💰 CONFIGURAÇÕES DE TAXAS DE ADQUIRENTE (ADMIN GLOBAL)
export const acquirerConfigSchema = z.object({
  // EfíBank (Brasil)
  efibank: z.object({
    enabled: z.boolean().default(true),
    pixFeePercent: z.number().min(0).max(100).default(0.99), // 0.99%
    pixFeeFixed: z.number().min(0).default(0), // R$ 0,00 fixo
    cardFeePercent: z.number().min(0).max(100).default(3.99), // 3.99%
    cardFeeFixed: z.number().min(0).default(0), // R$ 0,00 fixo
    withdrawalDays: z.number().min(0).default(1), // D+1
  }),
  // Stripe (Global)
  stripe: z.object({
    enabled: z.boolean().default(true),
    cardFeePercent: z.number().min(0).max(100).default(5.2), // 5.2%
    cardFeeFixed: z.number().min(0).default(0.39), // R$ 0,39 fixo
    withdrawalDays: z.number().min(0).default(2), // D+2
  }),
  lastUpdated: z.date().optional(),
  updatedBy: z.string().optional(),
});

export type AcquirerConfig = z.infer<typeof acquirerConfigSchema>;

// 💰 REFUND SCHEMA - SISTEMA COMPLETO DE REEMBOLSOS
export const refundSchema = z.object({
  id: z.string().default(() => `refund_${Date.now()}_${nanoid(16)}_${Math.random().toString(36).substr(2, 12)}`),
  
  // 🔗 REFERÊNCIAS PRINCIPAIS
  tenantId: z.string(), // Seller que vai processar o reembolso
  customerId: z.string(), // Firebase Auth ID do comprador
  
  // 📦 PRODUTO E TRANSAÇÃO ORIGINAL
  productType: z.enum(["digital", "ebook", "subscription", "service", "other"]),
  productId: z.string(),
  productTitle: z.string(),
  checkoutId: z.string(),
  orderId: z.string().optional(), // Para digital/assinatura (collection orders)
  subscriptionId: z.string().optional(), // Para cancelamento de assinatura
  
  // 👤 DADOS DO COMPRADOR
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string().optional(),
  
  // 💳 DADOS FINANCEIROS
  originalAmount: z.number(), // Valor original pago
  refundAmount: z.number(), // Valor a ser reembolsado
  paymentMethod: z.enum(["pix", "card", "stripe"]),
  
  // 📋 MOTIVO E OBSERVAÇÕES
  reason: z.enum([
    "not_satisfied", // Não satisfeito
    "technical_issues", // Problemas técnicos
    "wrong_purchase", // Comprou errado
    "duplicate_purchase", // Compra duplicada
    "product_defect", // Produto com defeito
    "other" // Outro motivo
  ]).default("not_satisfied"),
  description: z.string().optional(), // Descrição detalhada do motivo
  
  // ⏱️ CONTROLE DE TEMPO
  purchaseDate: z.date(), // Data da compra original
  guaranteePeriodDays: z.number().default(7), // Período de garantia em dias
  isWithinGuarantee: z.boolean(), // Se está dentro do prazo
  
  // 🚦 STATUS DO REEMBOLSO
  status: z.enum([
    "pending", // Aguardando aprovação do seller
    "approved", // Aprovado pelo seller
    "rejected", // Rejeitado pelo seller
    "processed", // Processado (dinheiro devolvido)
    "cancelled" // Cancelado pelo comprador
  ]).default("pending"),
  
  // 💬 MENSAGENS E COMUNICAÇÃO
  sellerResponse: z.string().optional(), // Resposta do seller
  adminNotes: z.string().optional(), // Notas administrativas
  
  // 🕐 TIMESTAMPS
  createdAt: z.date(),
  updatedAt: z.date(),
  approvedAt: z.date().optional(),
  processedAt: z.date().optional(),
  rejectedAt: z.date().optional(),
});

export const insertRefundSchema = refundSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Refund = z.infer<typeof refundSchema>;
export type InsertRefund = z.infer<typeof insertRefundSchema>;

// 🆔 GERADOR DE ID ÚNICO PARA REEMBOLSOS
export function generateRefundId(): string {
  const timestamp = Date.now();
  const nano_id = nanoid(16);
  const random = Math.random().toString(36).substr(2, 12);
  const performance_id = performance.now().toString().replace('.', '');
  return `refund_${timestamp}_${nano_id}_${random}_${performance_id}`;
}

// 🚨 SELLERS DE RISCO - SISTEMA DE MONITORAMENTO
export const sellerRiskSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // ID do seller
  sellerEmail: z.string().email(),
  sellerName: z.string(),
  businessName: z.string().optional(),
  
  // 📊 ESTATÍSTICAS DE REEMBOLSO
  totalRefunds: z.number().default(0),
  refundsToday: z.number().default(0),
  refundsYesterday: z.number().default(0),
  refundsLast7Days: z.number().default(0),
  refundsLast30Days: z.number().default(0),
  refundsLast60Days: z.number().default(0),
  
  // 💰 VALORES FINANCEIROS
  totalRefundAmount: z.number().default(0), // em centavos
  averageRefundAmount: z.number().default(0), // em centavos
  
  // 📈 NÍVEL DE RISCO (0-100%)
  riskLevel: z.number().min(0).max(100).default(0),
  riskCategory: z.enum(["baixo", "medio", "alto", "urgente"]).default("baixo"),
  
  // 📋 PRODUTOS MAIS REEMBOLSADOS
  topRefundedProducts: z.array(z.object({
    productId: z.string(),
    productTitle: z.string(),
    refundCount: z.number(),
    refundAmount: z.number() // em centavos
  })).default([]),
  
  // 🕐 TIMESTAMPS
  lastRefundDate: z.date().optional(),
  lastUpdated: z.date(),
  createdAt: z.date(),
  
  // 🚨 FLAGS DE ALERTA
  isHighRisk: z.boolean().default(false),
  needsReview: z.boolean().default(false),
  isBlocked: z.boolean().default(false)
});

export const insertSellerRiskSchema = sellerRiskSchema.omit({
  id: true,
  createdAt: true,
  lastUpdated: true
});

export type SellerRisk = z.infer<typeof sellerRiskSchema>;
export type InsertSellerRisk = z.infer<typeof insertSellerRiskSchema>;

// 🧮 CALCULADORA DE RISCO BASEADA EM REEMBOLSOS
export function calculateRiskLevel(refundCount: number): { level: number; category: "baixo" | "medio" | "alto" | "urgente" } {
  let level = 0;
  
  if (refundCount >= 1) level = 2;
  if (refundCount >= 2) level = 3;
  if (refundCount >= 3) level = 5;
  if (refundCount >= 4) level = 8;
  if (refundCount >= 5) level = 12;
  if (refundCount >= 7) level = 18;
  if (refundCount >= 10) level = 25;
  if (refundCount >= 15) level = 35;
  if (refundCount >= 20) level = 50;
  if (refundCount >= 30) level = 70;
  if (refundCount >= 40) level = 85;
  if (refundCount >= 50) level = 95;
  if (refundCount >= 60) level = 100;
  
  let category: "baixo" | "medio" | "alto" | "urgente" = "baixo";
  
  if (level >= 80) category = "urgente";
  else if (level >= 40) category = "alto";
  else if (level >= 15) category = "medio";
  
  return { level, category };
}

// 🆔 GERADOR DE ID ÚNICO PARA SELLER RISK
export function generateSellerRiskId(): string {
  const timestamp = Date.now();
  const nano_id = nanoid(12);
  const random = Math.random().toString(36).substr(2, 8);
  return `risk_${timestamp}_${nano_id}_${random}`;
}

// 🔥 SCHEMAS ADICIONAIS PARA MEGA ESTRUTURA - PROCESSAR MILHÕES DE TRANSAÇÕES
export const transactionLogSchema = z.object({
  id: z.string().default(() => `txn_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  type: z.enum(["order", "refund", "withdrawal", "commission", "fee"]),
  entityId: z.string(), // ID da entidade relacionada
  amount: z.number(),
  currency: z.string().default("BRL"),
  status: z.enum(["pending", "completed", "failed", "cancelled"]),
  processor: z.enum(["efibank", "stripe", "woovi", "manual"]).optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const webhookLogSchema = z.object({
  id: z.string().default(() => `webhook_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  provider: z.enum(["efibank", "stripe", "woovi"]),
  eventType: z.string(),
  eventId: z.string(),
  payload: z.record(z.any()),
  processed: z.boolean().default(false),
  attempts: z.number().default(0),
  lastAttempt: z.date().optional(),
  error: z.string().optional(),
  createdAt: z.date(),
});

export const auditLogSchema = z.object({
  id: z.string().default(() => `audit_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string(),
  oldData: z.record(z.any()).optional(),
  newData: z.record(z.any()).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  timestamp: z.date(),
});

export const emailLogSchema = z.object({
  id: z.string().default(() => `email_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  recipientEmail: z.string(),
  recipientName: z.string().optional(),
  subject: z.string(),
  template: z.string(),
  variables: z.record(z.any()).optional(),
  status: z.enum(["pending", "sent", "delivered", "bounced", "failed"]),
  provider: z.string().optional(),
  providerId: z.string().optional(),
  error: z.string().optional(),
  sentAt: z.date().optional(),
  deliveredAt: z.date().optional(),
  createdAt: z.date(),
});

export const analyticsEventSchema = z.object({
  id: z.string().default(() => `analytics_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  eventType: z.string(),
  eventName: z.string(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  checkoutId: z.string().optional(),
  orderId: z.string().optional(),
  properties: z.record(z.any()).optional(),
  timestamp: z.date(),
});

export const couponSchema = z.object({
  id: z.string().default(() => `coupon_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  productId: z.string().optional(), // 🆕 Cupom específico de produto (opcional = cupom geral)
  code: z.string(),
  name: z.string(),
  type: z.enum(["percentage", "fixed_amount"]),
  value: z.number(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
  usageLimit: z.number().optional(),
  usedCount: z.number().default(0),
  validFrom: z.date(),
  validUntil: z.date(),
  active: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const testimonialSchema = z.object({
  id: z.string().default(() => `testimonial_${Date.now()}_${nanoid(16)}`),
  checkoutId: z.string(),
  tenantId: z.string(),
  authorName: z.string().min(1, "Nome do autor é obrigatório"),
  authorPhoto: z.string().url("URL da foto inválida").optional(),
  rating: z.number().min(1, "Mínimo 1 estrela").max(5, "Máximo 5 estrelas"),
  title: z.string().min(1, "Título é obrigatório"),
  content: z.string().min(1, "Conteúdo é obrigatório"),
  position: z.number().default(0),
  active: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const affiliateSchema = z.object({
  id: z.string().default(() => `affiliate_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  name: z.string(),
  email: z.string().email(),
  code: z.string(),
  commissionRate: z.number().min(0).max(100),
  status: z.enum(["active", "inactive", "suspended"]),
  totalEarnings: z.number().default(0),
  totalSales: z.number().default(0),
  paymentDetails: z.object({
    pixKey: z.string().optional(),
    bankAccount: z.string().optional(),
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const bankAccountSchema = z.object({
  id: z.string().default(() => `bank_${Date.now()}_${nanoid(16)}`),
  tenantId: z.string(),
  bank: z.string(),
  agency: z.string(),
  account: z.string(),
  accountType: z.enum(["checking", "savings"]),
  ownerName: z.string(),
  ownerDocument: z.string(),
  active: z.boolean().default(true),
  verifiedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// 🔗 SISTEMA DE AFILIADOS COMPLETO COM FIREBASE AUTH UID
export function generateAffiliateClickId(): string { return `click_${generateUniqueId()}`; }
export function generateCommissionId(): string { return `comm_${generateUniqueId()}`; }

// ✅ FUNÇÃO PARA USAR UID REAL DO FIREBASE AUTH COMO CÓDIGO DE AFILIADO
export function createAffiliateCode(firebaseUid: string): string { 
  return firebaseUid; // UID direto do Firebase Auth - 100% rastreável
}

// Schema para link de afiliado/clique
export const affiliateClickSchema = z.object({
  id: z.string(),
  affiliateId: z.string(), // ID do afiliado
  checkoutId: z.string(), // Checkout que foi clicado
  sellerId: z.string(), // Seller dono do checkout
  clickedAt: z.date(),
  ipAddress: z.string(),
  userAgent: z.string(),
  referrer: z.string().optional(),
  converted: z.boolean().default(false), // Se virou venda
  orderId: z.string().optional(), // ID da ordem se converteu
  createdAt: z.date(),
});

// Schema para comissões de afiliados
export const affiliateCommissionSchema = z.object({
  id: z.string(),
  affiliateId: z.string(), // Quem vai receber a comissão
  sellerId: z.string(), // Seller dono do produto
  orderId: z.string(), // Ordem que gerou a comissão
  checkoutId: z.string(), // Checkout usado na venda
  amount: z.number(), // Valor da comissão em centavos (DEPRECATED - usar grossAmount)
  percentage: z.number(), // Percentual usado para calcular
  orderAmount: z.number(), // Valor total da ordem
  
  // 💰 SISTEMA DE TAXAS ADMINISTRATIVAS (NOVO)
  paymentMethod: z.enum(["pix", "card", "boleto"]).optional(), // Método de pagamento da venda
  grossAmount: z.number().optional(), // Comissão bruta (antes de taxa admin)
  adminFee: z.number().optional(), // Taxa administrativa em centavos
  netAmount: z.number().optional(), // Comissão líquida (após taxa admin) - o que o afiliado recebe
  adminFeePercent: z.number().optional(), // % da taxa admin aplicada
  
  status: z.enum(["pending", "approved", "paid", "cancelled"]).default("pending"),
  approvedAt: z.date().optional(),
  paidAt: z.date().optional(),
  releaseDate: z.date(), // Data para liberar pagamento
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Schema atualizado para afiliados com dados do vendedor
export const affiliateUserSchema = z.object({
  id: z.string(),
  userId: z.string(), // Firebase UID do usuário afiliado
  name: z.string(),
  email: z.string().email(),
  document: z.string(), // CPF/CNPJ
  phone: z.string(),
  
  // Dados bancários para recebimento
  pixKey: z.string().optional(),
  bankAccount: z.object({
    bank: z.string(),
    agency: z.string(),
    account: z.string(),
    accountType: z.enum(["checking", "savings"]),
    ownerName: z.string(),
    ownerDocument: z.string(),
  }).optional(),
  
  // Estatísticas
  totalClicks: z.number().default(0),
  totalSales: z.number().default(0),
  totalCommissions: z.number().default(0), // Total em centavos
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

// 🎟️ CUPOM INSERT SCHEMA
export const insertCouponSchema = couponSchema.omit({
  id: true,
  usedCount: true,
  createdAt: true,
  updatedAt: true,
});

// ⭐ TESTIMONIAL INSERT SCHEMA
export const insertTestimonialSchema = testimonialSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Export types para MEGA ESTRUTURA
export type TransactionLog = z.infer<typeof transactionLogSchema>;
export type WebhookLog = z.infer<typeof webhookLogSchema>;
export type AuditLog = z.infer<typeof auditLogSchema>;
export type EmailLog = z.infer<typeof emailLogSchema>;
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export type Coupon = z.infer<typeof couponSchema>;
export type InsertCoupon = z.infer<typeof insertCouponSchema>;
export type Testimonial = z.infer<typeof testimonialSchema>;
export type InsertTestimonial = z.infer<typeof insertTestimonialSchema>;
export type Affiliate = z.infer<typeof affiliateSchema>;
export type BankAccount = z.infer<typeof bankAccountSchema>;

// Export types para SISTEMA DE AFILIADOS
export type AffiliateClick = z.infer<typeof affiliateClickSchema>;
export type AffiliateCommission = z.infer<typeof affiliateCommissionSchema>;
export type AffiliateUser = z.infer<typeof affiliateUserSchema>;

export const insertAffiliateClickSchema = affiliateClickSchema.omit({ id: true, createdAt: true });
export const insertAffiliateCommissionSchema = affiliateCommissionSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const insertAffiliateUserSchema = affiliateUserSchema.omit({ id: true, createdAt: true, updatedAt: true });

export type InsertAffiliateClick = z.infer<typeof insertAffiliateClickSchema>;
export type InsertAffiliateCommission = z.infer<typeof insertAffiliateCommissionSchema>;
export type InsertAffiliateUser = z.infer<typeof insertAffiliateUserSchema>;

// 💰 WITHDRAWAL REQUEST SCHEMA - SISTEMA DE SOLICITAÇÃO DE SAQUE
export const withdrawalRequestSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // Seller que está solicitando
  sellerName: z.string(),
  sellerEmail: z.string(),
  
  // 💵 DADOS FINANCEIROS
  amount: z.number().min(1, "Valor deve ser maior que R$ 0,01"), // Valor em centavos
  currency: z.string().default("BRL"),
  
  // 🏦 DADOS BANCÁRIOS
  pixKey: z.string().optional(), // Chave PIX
  bankAccount: z.object({
    bank: z.string().optional(),
    agency: z.string().optional(),
    account: z.string().optional(),
    accountType: z.enum(["corrente", "poupanca"]).optional(),
  }).optional(),
  
  // 📊 STATUS E CONTROLE
  status: z.enum(["pending", "approved", "rejected", "paid"]).default("pending"),
  requestedAt: z.date(),
  reviewedAt: z.date().optional(),
  reviewedBy: z.string().optional(), // Admin que aprovou/rejeitou
  paidAt: z.date().optional(),
  
  // 📝 MOTIVO DE REJEIÇÃO
  rejectionReason: z.string().optional(),
  
  // 📋 OBSERVAÇÕES
  notes: z.string().optional(), // Observações do seller
  adminNotes: z.string().optional(), // Notas internas do admin
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertWithdrawalRequestSchema = withdrawalRequestSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type WithdrawalRequest = z.infer<typeof withdrawalRequestSchema>;
export type InsertWithdrawalRequest = z.infer<typeof insertWithdrawalRequestSchema>;

// 🎯 BANNER SCHEMA - SISTEMA DE BANNERS FIREBASE COM ISOLAMENTO
export const bannerSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // 🔐 ISOLAMENTO POR USUÁRIO - CADA SELLER VÊ APENAS SEUS BANNERS
  title: z.string().min(1, "Título é obrigatório"),
  imageUrl: z.string().url("URL da imagem deve ser válida").min(1, "URL da imagem é obrigatória"),
  link: z.string().url().optional(), // Link opcional para clique no banner
  isActive: z.boolean().default(true), // Se o banner está ativo/visível
  position: z.enum(["dashboard_top", "marketplace_top", "awards_top", "login_page", "register_page", "award_page"]).default("dashboard_top"), // Posição do banner
  priority: z.number().int().min(0).max(100).default(0), // Prioridade para ordenação (0 = mais alta)
  startDate: z.date().optional(), // Data de início da exibição
  endDate: z.date().optional(), // Data de fim da exibição
  description: z.string().optional(), // Descrição/alt text para acessibilidade
  targetBlank: z.boolean().default(false), // Abrir link em nova aba
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertBannerSchema = bannerSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Banner = z.infer<typeof bannerSchema>;
export type InsertBanner = z.infer<typeof insertBannerSchema>;

// 🔥 POSTGRESQL REMOVIDO - SISTEMA 100% FIREBASE AGORA!
// Todas as operações de banners agora usam Firebase Firestore com isolamento por tenantId

// 🎯 SUPPORT TICKET SYSTEM - CENTRAL DE ATENDIMENTO REAL-TIME
export function generateTicketId(): string { return `tkt_${generateUniqueId()}`; }
export function generateMessageId(): string { return `msg_${generateUniqueId()}`; }

// Schema para tickets de suporte
export const supportTicketSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // 🔐 ISOLAMENTO - Cada seller vê apenas seus tickets
  sellerId: z.string(), // Firebase UID do seller que abriu o ticket
  sellerName: z.string(), // Nome do seller para facilitar identificação
  sellerEmail: z.string().email(), // Email do seller
  
  // Categorias de atendimento
  category: z.enum([
    "produto", 
    "financeiro", 
    "afiliado", 
    "taxas", 
    "technical", 
    "geral"
  ]).default("geral"),
  
  // Status do ticket
  status: z.enum([
    "open",      // Aberto - aguardando resposta admin
    "answered",  // Respondido - aguardando resposta seller  
    "closed",    // Fechado
    "resolved"   // Resolvido
  ]).default("open"),
  
  // Prioridade
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  
  subject: z.string().min(1, "Assunto é obrigatório").max(200, "Assunto deve ter no máximo 200 caracteres"),
  description: z.string().min(1, "Descrição é obrigatória").max(200, "Descrição deve ter no máximo 200 caracteres"), // Primeira mensagem
  
  // 👑 ADMIN ASSIGNMENT
  assignedAdminId: z.string().optional(), // Admin responsável pelo ticket
  assignedAdminName: z.string().optional(),
  
  // Contadores para facilitar queries
  totalMessages: z.number().default(1), // Começa com 1 (mensagem inicial)
  unreadByAdmin: z.number().default(1), // Mensagens não lidas pelo admin
  unreadBySeller: z.number().default(0), // Mensagens não lidas pelo seller
  
  // 📅 TIMESTAMPS CRÍTICOS  
  lastMessageAt: z.date(), // Última mensagem enviada (para ordenação)
  lastAdminReplyAt: z.date().optional(), // Última resposta do admin
  lastSellerReplyAt: z.date().optional(), // Última resposta do seller
  closedAt: z.date().optional(),
  resolvedAt: z.date().optional(),
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Schema para mensagens do chat
export const supportMessageSchema = z.object({
  id: z.string(),
  ticketId: z.string(), // Referência ao ticket
  
  // 👤 AUTOR DA MENSAGEM
  senderId: z.string(), // Firebase UID (seller ou admin)
  senderType: z.enum(["seller", "admin"]), // Tipo do remetente
  senderName: z.string(), // Nome para exibição
  senderEmail: z.string().email().optional(), // Email do remetente
  
  // 💬 CONTEÚDO
  content: z.string().min(1, "Mensagem não pode estar vazia").max(200, "Mensagem deve ter no máximo 200 caracteres"),
  messageType: z.enum(["text", "file", "image", "system"]).default("text"),
  
  // 📎 ANEXOS (FUTURO)
  attachments: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    type: z.string(), // MIME type
    size: z.number(), // Tamanho em bytes
  })).optional(),
  
  // 👀 CONTROLE DE LEITURA
  readByAdmin: z.boolean().default(false),
  readBySeller: z.boolean().default(false),
  readAt: z.date().optional(), // Quando foi lida (pelo destinatário)
  
  // 🔄 MENSAGENS DE SISTEMA (status changes, etc)
  isSystemMessage: z.boolean().default(false),
  systemData: z.object({
    type: z.enum(["status_change", "assignment", "priority_change"]),
    oldValue: z.string().optional(),
    newValue: z.string().optional(),
  }).optional(),
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Insert schemas
export const insertSupportTicketSchema = supportTicketSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSupportMessageSchema = supportMessageSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type SupportTicket = z.infer<typeof supportTicketSchema>;
export type SupportMessage = z.infer<typeof supportMessageSchema>;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;

// 📄 SCHEMAS DO NOTAZZ - EMISSÃO DE NOTAS FISCAIS NFS-E / NF-E
export const notazzConfigSchema = z.object({
  apiKey: z.string().min(1, "API Key é obrigatória"),
  cnae: z.string().optional(),
  last4: z.string().optional(),
  tenantId: z.string().min(1, "Tenant ID é obrigatório"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertNotazzConfigSchema = notazzConfigSchema.omit({
  tenantId: true,
  createdAt: true,
  updatedAt: true,
});

export const updateNotazzConfigSchema = notazzConfigSchema.omit({
  tenantId: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export const createNfseSchema = z.object({
  customerName: z.string().min(1, "Nome do cliente é obrigatório"),
  customerDocument: z.string().min(11, "CPF/CNPJ é obrigatório"),
  customerEmail: z.string().email("Email inválido"),
  customerPhone: z.string().optional(),
  customerAddress: z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
  }).optional(),
  serviceDescription: z.string().min(1, "Descrição do serviço é obrigatória"),
  serviceValue: z.number().positive("Valor deve ser positivo"),
  orderId: z.string().min(1, "ID da ordem é obrigatório"),
  externalId: z.string().optional(),
});

export type NotazzConfig = z.infer<typeof notazzConfigSchema>;
export type InsertNotazzConfig = z.infer<typeof insertNotazzConfigSchema>;
export type UpdateNotazzConfig = z.infer<typeof updateNotazzConfigSchema>;
export type CreateNfseRequest = z.infer<typeof createNfseSchema>;

// 🚚 SCHEMAS DO MELHOR ENVIO - LOGÍSTICA E RASTREAMENTO
export const melhorEnvioConfigSchema = z.object({
  clientId: z.string().min(1, "Client ID é obrigatório"),
  clientSecret: z.string().min(1, "Client Secret é obrigatório"),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  sandboxMode: z.boolean().default(false),
  last4ClientId: z.string().optional(),
  last4ClientSecret: z.string().optional(),
  tenantId: z.string().min(1, "Tenant ID é obrigatório"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertMelhorEnvioConfigSchema = melhorEnvioConfigSchema.omit({
  tenantId: true,
  createdAt: true,
  updatedAt: true,
});

export const updateMelhorEnvioConfigSchema = melhorEnvioConfigSchema.omit({
  tenantId: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export const calculateShippingSchema = z.object({
  from: z.object({
    postal_code: z.string().min(8, "CEP de origem é obrigatório"),
    address: z.string().optional(),
    number: z.string().optional(),
  }),
  to: z.object({
    postal_code: z.string().min(8, "CEP de destino é obrigatório"),
    address: z.string().optional(),
    number: z.string().optional(),
  }),
  package: z.object({
    weight: z.number().min(0.1, "Peso mínimo é 0.1kg"),
    width: z.number().min(1, "Largura mínima é 1cm"),
    height: z.number().min(1, "Altura mínima é 1cm"),
    length: z.number().min(1, "Comprimento mínimo é 1cm"),
  }),
});

export const createShipmentSchema = z.object({
  orderId: z.string().min(1, "ID da ordem é obrigatório"),
  serviceId: z.number().min(1, "ID do serviço é obrigatório"),
  packageData: calculateShippingSchema.shape.package,
  fromAddress: calculateShippingSchema.shape.from,
  toAddress: calculateShippingSchema.shape.to,
  recipientData: z.object({
    name: z.string().min(1, "Nome do destinatário é obrigatório"),
    document: z.string().min(1, "Documento do destinatário é obrigatório"),
    email: z.string().email("Email inválido").optional(),
    phone: z.string().optional(),
  }),
});

export const trackShipmentSchema = z.object({
  orders: z.array(z.string().min(1, "ID do envio é obrigatório")),
});

export type MelhorEnvioConfig = z.infer<typeof melhorEnvioConfigSchema>;
export type InsertMelhorEnvioConfig = z.infer<typeof insertMelhorEnvioConfigSchema>;
export type UpdateMelhorEnvioConfig = z.infer<typeof updateMelhorEnvioConfigSchema>;
export type CalculateShippingRequest = z.infer<typeof calculateShippingSchema>;
export type CreateShipmentRequest = z.infer<typeof createShipmentSchema>;
export type TrackShipmentRequest = z.infer<typeof trackShipmentSchema>;

// 🛡️ ULTRA-HARDENED SECURITY SYSTEM - AI-POWERED THREAT PROTECTION
export function generateSecurityLogId(): string { return `sec_${generateUniqueId()}`; }
export function generateBlockedIpId(): string { return `blk_${generateUniqueId()}`; }

// Categorias de ameaças detectadas
export const threatCategoryEnum = z.enum([
  "xss_injection",      // Cross-site scripting
  "sql_injection",      // SQL injection attempts
  "html_injection",     // HTML injection/manipulation
  "path_traversal",     // Directory traversal attacks
  "code_injection",     // Code injection attempts
  "flood_attack",       // DDoS/flooding
  "bot_detection",      // Bot/automated requests
  "farm_detection",     // Click farms/fake activity
  "malicious_upload",   // Malicious file uploads
  "brute_force",        // Brute force attacks
  "credential_stuffing", // Credential stuffing
  "inspection_attempt", // DevTools/DOM inspection
  "suspicious_behavior", // AI-detected suspicious patterns
  "rate_limit_exceeded", // Rate limiting triggered
  "banned_payload",     // Known malicious payloads
  "anomalous_traffic"   // Traffic anomalies
]);

// Ações tomadas pelo sistema
export const securityActionEnum = z.enum([
  "block_immediate",    // Bloqueio imediato de IP
  "block_temporary",    // Bloqueio temporário
  "challenge_captcha",  // Exigir captcha
  "rate_limit",         // Aplicar rate limiting
  "quarantine",         // Colocar em quarentena
  "log_only",           // Apenas logar (modo observação)
  "ai_analysis",        // Enviar para análise AI
  "escalate_admin",     // Escalar para admin
  "allow_monitored",    // Permitir mas monitorar
  "reject_request"      // Rejeitar requisição
]);

// Severidade da ameaça
export const threatSeverityEnum = z.enum([
  "critical",   // Crítica - bloqueio imediato
  "high",       // Alta - bloqueio/quarentena
  "medium",     // Média - rate limit/challenge
  "low",        // Baixa - apenas log
  "info"        // Informacional
]);

// Schema para logs de segurança
export const securityLogSchema = z.object({
  id: z.string(),
  
  // 🎯 IDENTIFICAÇÃO DA AMEAÇA
  threatCategory: threatCategoryEnum,
  severity: threatSeverityEnum,
  riskScore: z.number().min(0).max(100), // Score AI de 0-100
  
  // 🌐 INFORMAÇÕES DO ATACANTE
  sourceIp: z.string(),
  userAgent: z.string().optional(),
  referer: z.string().optional(),
  origin: z.string().optional(),
  
  // 📡 DETALHES DA REQUISIÇÃO
  method: z.string(), // GET, POST, etc
  endpoint: z.string(), // /api/users, etc
  payload: z.string().optional(), // Hash do payload suspeito
  headers: z.record(z.string()).optional(), // Headers suspeitos
  
  // 🎭 CONTEXTO DO USUÁRIO (se autenticado)
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  sessionId: z.string().optional(),
  
  // 🤖 ANÁLISE AI
  aiAnalysis: z.object({
    confidence: z.number().min(0).max(100), // Confiança da AI
    reasoning: z.string(), // Explicação da AI
    patterns: z.array(z.string()), // Padrões detectados
    recommendations: z.array(z.string()) // Recomendações
  }).optional(),
  
  // ⚡ AÇÕES TOMADAS
  actionTaken: securityActionEnum,
  blocked: z.boolean().default(false),
  ipBlocked: z.boolean().default(false),
  responseCode: z.number(), // 403, 429, etc
  
  // 📊 METADADOS
  processingTime: z.number(), // Tempo de processamento em ms
  detectionRule: z.string().optional(), // Regra que detectou
  falsePositive: z.boolean().default(false), // Marcado como falso positivo
  
  // 🌍 GEOLOCALIZAÇÃO (opcional)
  country: z.string().optional(),
  countryCode: z.string().optional(),
  city: z.string().optional(),
  
  // 🔍 IP INTELLIGENCE (detecção de datacenter/proxy/VPN/TOR)
  isDatacenter: z.boolean().optional(),
  isProxy: z.boolean().optional(),
  isVPN: z.boolean().optional(),
  isTor: z.boolean().optional(),
  threatLevel: z.enum(["safe", "low", "medium", "high", "critical"]).optional(),
  geoRiskScore: z.number().min(0).max(100).optional(),
  
  // 🕒 TIMESTAMPS
  detectedAt: z.date(),
  blockedAt: z.date().optional(),
  resolvedAt: z.date().optional(),
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Schema para IPs bloqueados
export const blockedIpSchema = z.object({
  id: z.string(),
  
  // 🌐 IDENTIFICAÇÃO DO IP
  ipAddress: z.string(),
  cidrRange: z.string().optional(), // Para bloqueios de subnet
  
  // 🎯 RAZÃO DO BLOQUEIO
  reason: z.string(),
  threatCategories: z.array(threatCategoryEnum),
  severity: threatSeverityEnum,
  riskScore: z.number().min(0).max(100),
  
  // 👤 QUEM BLOQUEOU
  blockedBy: z.enum(["system", "admin", "ai"]),
  adminId: z.string().optional(), // Se bloqueado por admin
  adminName: z.string().optional(),
  
  // ⏱️ DURAÇÃO DO BLOQUEIO
  isTemporary: z.boolean().default(false),
  expiresAt: z.date().optional(), // Para bloqueios temporários
  
  // 📊 ESTATÍSTICAS
  attacksBlocked: z.number().default(0), // Quantos ataques foram bloqueados
  lastAttemptAt: z.date().optional(), // Última tentativa do IP
  totalAttempts: z.number().default(0), // Total de tentativas
  
  // 🔄 STATUS
  isActive: z.boolean().default(true),
  unlockedBy: z.string().optional(), // Admin que desbloqueou
  unlockedAt: z.date().optional(),
  unblockReason: z.string().optional(),
  
  // 🌍 GEOLOCALIZAÇÃO (opcional)
  country: z.string().optional(),
  countryCode: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  isp: z.string().optional(),
  
  // 🔍 IP INTELLIGENCE (detecção de datacenter/proxy/VPN/TOR)
  isDatacenter: z.boolean().optional(),
  isProxy: z.boolean().optional(),
  isVPN: z.boolean().optional(),
  isTor: z.boolean().optional(),
  threatLevel: z.enum(["safe", "low", "medium", "high", "critical"]).optional(),
  geoRiskScore: z.number().min(0).max(100).optional(),
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Schema para estatísticas de segurança (agregações horárias)
export const securityStatsSchema = z.object({
  id: z.string(),
  
  // 📅 PERÍODO
  periodStart: z.date(),
  periodEnd: z.date(),
  periodType: z.enum(["hour", "day", "week", "month"]),
  
  // 📊 CONTADORES POR CATEGORIA
  totalAttacks: z.number().default(0),
  attacksByCategory: z.record(z.number()).default({}),
  attacksBySeverity: z.record(z.number()).default({}),
  attacksByAction: z.record(z.number()).default({}),
  
  // 🌐 IP STATISTICS  
  uniqueAttackerIps: z.number().default(0),
  newBlockedIps: z.number().default(0),
  totalBlockedIps: z.number().default(0),
  
  // ⚡ PERFORMANCE
  avgProcessingTime: z.number().default(0),
  maxProcessingTime: z.number().default(0),
  requestsProcessed: z.number().default(0),
  
  // 🤖 AI STATS
  aiAnalysisUsed: z.number().default(0),
  avgAiConfidence: z.number().default(0),
  falsePositives: z.number().default(0),
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Insert schemas (sem campos auto-gerados)
export const insertSecurityLogSchema = securityLogSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBlockedIpSchema = blockedIpSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSecurityStatsSchema = securityStatsSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update schemas para admin
export const updateBlockedIpSchema = blockedIpSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  ipAddress: true, // IP não pode ser alterado
}).partial();

export const updateSecurityLogSchema = securityLogSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

// Types
export type ThreatCategory = z.infer<typeof threatCategoryEnum>;
export type SecurityAction = z.infer<typeof securityActionEnum>;
export type ThreatSeverity = z.infer<typeof threatSeverityEnum>;

export type SecurityLog = z.infer<typeof securityLogSchema>;
export type BlockedIP = z.infer<typeof blockedIpSchema>;
export type SecurityStats = z.infer<typeof securityStatsSchema>;

export type InsertSecurityLog = z.infer<typeof insertSecurityLogSchema>;
export type InsertBlockedIP = z.infer<typeof insertBlockedIpSchema>;
export type InsertSecurityStats = z.infer<typeof insertSecurityStatsSchema>;

export type UpdateBlockedIP = z.infer<typeof updateBlockedIpSchema>;
export type UpdateSecurityLog = z.infer<typeof updateSecurityLogSchema>;

// 💳 CONFIGURAÇÕES DE PAGAMENTO - ADMIN PANEL
export const paymentConfigSchema = z.object({
  id: z.string(), // ID da configuração (geralmente "global" ou tenantId)
  
  // 🎯 ADQUIRENTES PADRÃO POR TIPO DE PAGAMENTO
  defaultAcquirers: z.object({
    pix: z.enum(["efibank", "woovi", "pagarme"]).default("woovi"), // Adquirente padrão para PIX
    creditCardBR: z.enum(["efibank", "pagarme"]).default("efibank"), // Adquirente padrão para cartão brasileiro
    creditCardGlobal: z.enum(["stripe", "adyen", "pagarme"]).default("stripe"), // Adquirente padrão para cartão internacional
    boleto: z.enum(["efibank", "woovi", "pagarme"]).default("woovi"), // Adquirente padrão para boleto
    
    // ⚠️ DEPRECATED: Mantido apenas para retrocompatibilidade - use creditCardBR/creditCardGlobal
    creditCard: z.enum(["stripe", "efibank", "adyen", "pagarme"]).optional(),
  }).optional(),
  
  // 💰 TAXAS DE PROCESSAMENTO
  fees: z.object({
    // PIX
    pixFixedFee: z.number().default(99), // Taxa fixa PIX em centavos (R$ 0,99)
    pixPercentFee: z.number().default(2.99), // Taxa percentual PIX (2.99%)
    pixReleaseDays: z.number().default(1), // Dias para liberar saldo PIX (1 dia)
    
    // CARTÃO BRASILEIRO
    creditCardBRFixedFee: z.number().default(49), // Taxa fixa cartão BR (R$ 0,49)
    creditCardBRPercentFee: z.number().default(4.99), // Taxa percentual cartão BR (4.99%)
    creditCardBRReleaseDays: z.number().default(30), // Dias para liberar cartão BR (30 dias)
    
    // CARTÃO GLOBAL (INTERNACIONAL)
    creditCardGlobalFixedFee: z.number().default(49), // Taxa fixa cartão global (R$ 0,49)
    creditCardGlobalPercentFee: z.number().default(4.99), // Taxa percentual cartão global (4.99%)
    creditCardGlobalReleaseDays: z.number().default(30), // Dias para liberar cartão global (30 dias)
    
    // BOLETO
    boletoFixedFee: z.number().default(349).optional(), // Taxa fixa boleto em centavos (R$ 3,49)
    boletoPercentFee: z.number().default(0).optional(), // Taxa percentual boleto (geralmente 0%)
    boletoReleaseDays: z.number().default(2).optional(), // Dias para liberar boleto (2 dias)
    
    // ⚠️ DEPRECATED: Mantido apenas para retrocompatibilidade
    creditCardFixedFee: z.number().optional(),
    creditCardPercentFee: z.number().optional(),
    creditCardReleaseDays: z.number().optional(),
  }),
  
  // 🔐 STRIPE KEYS (CRIPTOGRAFADAS)
  stripe: z.object({
    enabled: z.boolean().default(true),
    environment: z.enum(["test", "production"]).default("test"),
    publicKey: z.string().optional(), // Chave pública Stripe (pk_test_... ou pk_live_...)
    secretKey: z.string().optional(), // Chave privada Stripe (sk_test_... ou sk_live_...) - CRIPTOGRAFADA
    webhookSecret: z.string().optional(), // Webhook secret - CRIPTOGRAFADO
  }),
  
  // 🏦 EFIBANK KEYS (CRIPTOGRAFADAS)
  efibank: z.object({
    enabled: z.boolean().default(true),
    environment: z.enum(["sandbox", "production"]).default("sandbox"),
    
    // PRODUÇÃO
    productionClientId: z.string().optional(), // Client ID produção - CRIPTOGRAFADO
    productionClientSecret: z.string().optional(), // Client Secret produção - CRIPTOGRAFADO
    
    // SANDBOX (HOMOLOGAÇÃO)
    sandboxClientId: z.string().optional(), // Client ID sandbox - CRIPTOGRAFADO
    sandboxClientSecret: z.string().optional(), // Client Secret sandbox - CRIPTOGRAFADO
    
    // COMUNS
    payeeCode: z.string().optional(), // Código do beneficiário
    pixKey: z.string().optional(), // Chave PIX
    certificatePath: z.string().optional(), // Caminho do certificado .p12 (LEGADO - filesystem local)
    certificateStoragePath: z.string().optional(), // Caminho do certificado no Firebase Storage (ETERNO)
    certificateUpdatedAt: z.union([z.string(), z.date()]).optional(), // Data do último upload do certificado
    webhookHmac: z.string().optional(), // HMAC para validação de webhook - CRIPTOGRAFADO
    webhookUrl: z.string().optional(), // URL do webhook registrado na EfíBank
    webhookRegisteredAt: z.union([z.string(), z.date()]).optional(), // Data de registro do webhook
  }),
  
  // 🌐 ADYEN KEYS (CRIPTOGRAFADAS)
  adyen: z.object({
    enabled: z.boolean().default(false),
    environment: z.enum(["test", "live"]).default("test"),
    apiKey: z.string().optional(), // API Key Adyen - CRIPTOGRAFADA
    merchantAccount: z.string().optional(), // Merchant Account ID
    clientKey: z.string().optional(), // Client Key (pública)
  }).optional(),
  
  // 🟢 WOOVI KEYS (CRIPTOGRAFADAS)
  woovi: z.object({
    enabled: z.boolean().default(false),
    environment: z.enum(["sandbox", "production"]).default("sandbox"),
    appId: z.string().optional(), // AppID Woovi - CRIPTOGRAFADA (Authorization header)
    webhookSecret: z.string().optional(), // Webhook secret para validação - CRIPTOGRAFADO
  }).optional(),
  
  // 💳 PAGARME KEYS (CRIPTOGRAFADAS)
  pagarme: z.object({
    enabled: z.boolean().default(false),
    environment: z.enum(["test", "live"]).default("test"),
    
    // 🔐 CHAVES API (CRIPTOGRAFADAS)
    apiKey: z.string().optional(), // API Key (sk_test_ ou sk_live_) - CRIPTOGRAFADA
    encryptionKey: z.string().optional(), // Encryption Key (ek_test_ ou ek_live_) - CRIPTOGRAFADA
    
    // 💰 TAXAS PIX
    pixFeePercent: z.number().default(0.99), // Taxa percentual PIX (0.99%)
    pixFeeFixed: z.number().default(0), // Taxa fixa PIX em reais (R$ 0,00)
    pixReleaseDays: z.number().default(1), // Dias para liberar PIX (1 dia)
    
    // 💳 TAXAS CARTÃO DE CRÉDITO
    cardFeePercent: z.number().default(3.99), // Taxa percentual cartão (3.99%)
    cardFeeFixed: z.number().default(0.39), // Taxa fixa cartão em reais (R$ 0,39)
    cardReleaseDays: z.number().default(30), // Dias para liberar cartão (30 dias)
    
    // 🧾 TAXAS BOLETO
    boletoFeePercent: z.number().default(0), // Taxa percentual boleto (0%)
    boletoFeeFixed: z.number().default(3.49), // Taxa fixa boleto em reais (R$ 3,49)
    boletoReleaseDays: z.number().default(2), // Dias para liberar boleto (2 dias)
  }).optional(),
  
  // 🐰 BUNNY.NET - STORAGE E VIDEO STREAMING
  bunny: z.object({
    enabled: z.boolean().default(false),
    streamLibraryId: z.string().optional(), // Library ID do Bunny Stream
    streamApiKey: z.string().optional(), // API Key do Bunny Stream - CRIPTOGRAFADA
    storageApiKey: z.string().optional(), // API Key do Bunny Storage - CRIPTOGRAFADA
    storageZoneName: z.string().optional(), // Nome da storage zone
    storageRegion: z.enum(["de", "ny", "la", "sg", "syd"]).default("de"), // Região do storage
  }).optional(),
  
  // 🕒 METADADOS
  updatedBy: z.string().optional(), // UID do admin que atualizou
  updatedByName: z.string().optional(), // Nome do admin
  
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertPaymentConfigSchema = paymentConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updatePaymentConfigSchema = paymentConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type PaymentConfig = z.infer<typeof paymentConfigSchema>;
export type InsertPaymentConfig = z.infer<typeof insertPaymentConfigSchema>;
export type UpdatePaymentConfig = z.infer<typeof updatePaymentConfigSchema>;

// 🤝 AFFILIATE CONFIG SCHEMA - CONFIGURAÇÕES DE AFILIADOS POR PRODUTO
export const affiliateConfigSchema = z.object({
  enabled: z.boolean().default(false),
  autoApprove: z.boolean().default(false),
  extendCommission: z.boolean().default(false),
  shareData: z.boolean().default(false),
  marketplaceEnabled: z.boolean().default(false),
  commissions: z.object({
    single: z.number().min(0).max(100).default(10),
    recurring: z.number().min(0).max(100).default(0),
    type: z.enum(["todas", "primeira", "fixo"]).default("todas"),
  }),
  preference: z.enum(["primeiro", "ultimo"]).default("ultimo"),
  cookieDuration: z.number().min(1).max(365).default(30),
  selectedOffers: z.array(z.string()).default([]),
  support: z.object({
    name: z.string().default(""),
    email: z.string().email().or(z.literal("")).default(""),
    phone: z.string().default(""),
  }),
  salesPage: z.string().url().or(z.literal("")).default(""),
  rules: z.string().max(1000).optional(),
});

export type AffiliateConfig = z.infer<typeof affiliateConfigSchema>;

// 📊 PIXEL TRACKING SYSTEM V2 - ADVANCED MANAGED PIXELS
// ✅ BACKWARD COMPATIBLE: Mantém campos legacy nos checkouts (tiktokPixel, facebookPixel, etc)
// ✅ NEW SYSTEM: Collection separada 'checkoutPixels' para gerenciamento avançado
// Sistema completo de tracking com validações baseadas em documentações oficiais

// Plataformas suportadas
export const pixelPlatformEnum = z.enum([
  "google_ads",
  "google_analytics_4",
  "facebook",
  "tiktok",
  "kwai",
  "pinterest"
]);

export type PixelPlatform = z.infer<typeof pixelPlatformEnum>;

// Schema de Pixel Gerenciável (collection checkoutPixels/{checkoutId}/pixels/{pixelId})
export const managedPixelSchema = z.object({
  id: z.string().default(() => `pixel_${generateUniqueId()}`),
  checkoutId: z.string().min(1, "ID do checkout é obrigatório"),
  tenantId: z.string().min(1, "ID do tenant é obrigatório"),
  
  platform: pixelPlatformEnum,
  name: z.string().min(1, "Nome do pixel é obrigatório").max(100),
  enabled: z.boolean().default(true),
  
  // Campos específicos por plataforma (validação flexível para compatibilidade)
  pixelId: z.string().min(1, "ID do pixel é obrigatório").max(100).optional(),
  conversionId: z.string().max(100).optional(), // Google Ads: AW-XXXXXXXXXX
  conversionLabel: z.string().max(100).optional(), // Google Ads Label
  measurementId: z.string().max(100).optional(), // GA4: G-XXXXXXXXXX
  tagId: z.string().max(100).optional(), // Pinterest
  access_token: z.string().max(500).optional(), // Facebook CAPI token (server-side only)
  accessToken: z.string().max(500).optional(), // TikTok Events API token (server-side only)
  
  // Configurações avançadas
  enableEnhancedConversions: z.boolean().default(false),
  enableEcommerce: z.boolean().default(true),
  enableAutomaticMatching: z.boolean().default(false),
  enableAdvancedMatching: z.boolean().default(false),
  enableEnhancedMatch: z.boolean().default(false),
  
  // Eventos a serem rastreados
  events: z.object({
    pageView: z.boolean().default(true),
    viewContent: z.boolean().default(true),
    addToCart: z.boolean().default(true),
    initiateCheckout: z.boolean().default(true),
    addPaymentInfo: z.boolean().default(true),
    purchase: z.boolean().default(true),
  }).default({
    pageView: true,
    viewContent: true,
    addToCart: true,
    initiateCheckout: true,
    addPaymentInfo: true,
    purchase: true,
  }),
  
  // Metadados
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertManagedPixelSchema = managedPixelSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateManagedPixelSchema = managedPixelSchema.omit({
  id: true,
  checkoutId: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type ManagedPixel = z.infer<typeof managedPixelSchema>;
export type InsertManagedPixel = z.infer<typeof insertManagedPixelSchema>;
export type UpdateManagedPixel = z.infer<typeof updateManagedPixelSchema>;
// 👤 CUSTOMER PROFILE SCHEMA - Perfil do comprador/cliente (não vendedor)
// Vincula email de compra → Firebase UID para login na área de membros
// ✅ SUPORTA: Cliente antes do login (firebaseUid = null) + após login (firebaseUid preenchido)
export const customerProfileSchema = z.object({
  id: z.string().default(() => `cust_${generateUniqueId()}`), // ID próprio gerado
  firebaseUid: z.string().nullable().optional(), // Firebase UID (null antes do primeiro login)
  email: z.string().email("Email inválido"),
  name: z.string().min(1, "Nome é obrigatório"),
  document: z.string().optional(), // CPF/CNPJ
  phone: z.string().optional(),
  
  // 📊 ESTATÍSTICAS DENORMALIZADAS
  totalPurchases: z.number().default(0), // Total de compras realizadas
  totalSpent: z.number().default(0), // Total gasto em centavos
  firstPurchaseAt: z.date().optional(), // Data da primeira compra
  lastPurchaseAt: z.date().optional(), // Data da última compra
  
  // 🔒 METADADOS
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertCustomerProfileSchema = customerProfileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCustomerProfileSchema = customerProfileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type CustomerProfile = z.infer<typeof customerProfileSchema>;
export type InsertCustomerProfile = z.infer<typeof insertCustomerProfileSchema>;
export type UpdateCustomerProfile = z.infer<typeof updateCustomerProfileSchema>;

// 🎓 MEMBER ENTITLEMENT SCHEMA - Autorização de acesso a produto/área de membros
// Gerado automaticamente quando uma venda é paga (order.status = 'paid')
export const memberEntitlementSchema = z.object({
  id: z.string().default(() => `ent_${generateUniqueId()}`),
  customerId: z.string(), // Customer profile ID
  customerEmail: z.string().email(),
  orderId: z.string(), // ID da order que gerou este entitlement
  
  // 🎯 PRODUTO/CHECKOUT - CRITICAL para resolver conteúdo
  checkoutId: z.string(), // ID do checkout
  productId: z.string(), // ID do produto (para resolver conteúdo)
  productTitle: z.string(), // Título do produto (snapshot)
  productType: z.enum(["digital", "ebook", "subscription", "service", "other"]),
  tenantId: z.string(), // ID do seller/tenant (para resolver conteúdo)
  
  // 📅 CONTROLE DE ACESSO
  status: z.enum(["active", "expired", "cancelled", "suspended"]).default("active"),
  accessStartDate: z.date(), // Data de início do acesso (paidAt da order)
  accessEndDate: z.date().nullable().optional(), // null = vitalício, Date = expira
  
  // 🔄 ASSINATURAS - Alinhado com subscription periods existentes
  isSubscription: z.boolean().default(false),
  subscriptionId: z.string().optional(),
  billingCycle: z.enum(["monthly", "quarterly", "semiannual", "annual"]).optional(),
  nextBillingDate: z.date().optional(),
  
  // 👤 SELLER INFO (para contato/suporte)
  sellerId: z.string(), // tenantId do vendedor (duplicado para facilitar queries)
  sellerEmail: z.string().email().optional(),
  
  // 📊 AUDITORIA E CONTROLE
  cancelledAt: z.date().optional(),
  cancelReason: z.string().max(500).optional(),
  suspendedAt: z.date().optional(),
  suspendReason: z.string().max(500).optional(),
  accessDeniedCount: z.number().default(0), // Contador de tentativas negadas
  lastDeniedAt: z.date().optional(),
  
  // 🔒 METADADOS
  createdAt: z.date(),
  updatedAt: z.date(),
  lastAccessAt: z.date().optional(), // Última vez que acessou a área de membros
});

export const insertMemberEntitlementSchema = memberEntitlementSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateMemberEntitlementSchema = memberEntitlementSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type MemberEntitlement = z.infer<typeof memberEntitlementSchema>;
export type InsertMemberEntitlement = z.infer<typeof insertMemberEntitlementSchema>;
export type UpdateMemberEntitlement = z.infer<typeof updateMemberEntitlementSchema>;

// 💰 REFUND REQUEST SCHEMA - Solicitação de reembolso pelo cliente
export const refundRequestSchema = z.object({
  id: z.string().default(() => `ref_${generateUniqueId()}`),
  orderId: z.string(), // ID da order a ser reembolsada
  customerId: z.string(), // Customer profile ID
  customerEmail: z.string().email(),
  
  // 📋 DETALHES DA SOLICITAÇÃO
  reason: z.string().min(10, "Motivo deve ter no mínimo 10 caracteres").max(500),
  amount: z.number(), // Valor solicitado em centavos (pode ser parcial)
  orderAmount: z.number(), // Valor total da order (para validação)
  requestedAt: z.date(),
  
  // ✅ STATUS E PROCESSAMENTO
  status: z.enum(["pending", "approved", "denied", "refunded"]).default("pending"),
  processedAt: z.date().optional(),
  processedBy: z.string().optional(), // UID do admin/seller que processou
  processedByName: z.string().optional(), // Nome de quem processou
  denialReason: z.string().max(500).optional(), // Motivo da negação
  
  // 💸 DADOS DO REEMBOLSO (quando aprovado)
  refundedAmount: z.number().optional(), // Valor efetivamente reembolsado
  refundMethod: z.enum(["pix", "bank_transfer", "credit_card_reversal"]).optional(),
  refundTransactionId: z.string().optional(), // ID da transação de reembolso
  refundedAt: z.date().optional(), // Data do reembolso efetivo
  
  // 👤 SELLER INFO
  sellerId: z.string(), // tenantId do vendedor
  sellerEmail: z.string().email().optional(),
  
  // 📊 VALIDAÇÃO
  isPartialRefund: z.boolean().default(false), // Se é reembolso parcial
  
  // 🔒 METADADOS
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertRefundRequestSchema = refundRequestSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateRefundRequestSchema = refundRequestSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type RefundRequest = z.infer<typeof refundRequestSchema>;
export type InsertRefundRequest = z.infer<typeof insertRefundRequestSchema>;
export type UpdateRefundRequest = z.infer<typeof updateRefundRequestSchema>;

// 📊 CHECKOUT EVENT SCHEMA - Eventos de tracking tipo pixel
export const checkoutEventSchema = z.object({
  id: z.string().default(() => `evt_${generateUniqueId()}`),
  
  // 🛒 IDENTIFICAÇÃO
  checkoutId: z.string(),
  offerId: z.string().optional(),
  productId: z.string().optional(),
  tenantId: z.string(), // Seller owner
  
  // 📍 TIPO DE EVENTO
  eventType: z.enum([
    'checkout_pageview',
    'checkout_initiated', 
    'purchase_button_click',
    'purchase_approved',
    'purchase_pending',
    'checkout_heartbeat',  // Atualização de sessão ativa
    'checkout_exit'         // Saída do checkout
  ]),
  
  // 👤 SESSÃO
  sessionId: z.string(), // Gerado via device fingerprint
  userId: z.string().optional(), // Se usuário autenticado
  
  // 🌍 GEOLOCALIZAÇÃO
  geo: z.object({
    country: z.string().optional(),
    countryCode: z.string().optional(),
    state: z.string().optional(),
    stateCode: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    timezone: z.string().optional(),
  }).optional(),
  
  // 🔍 METADADOS
  userAgent: z.string().optional(),
  ipHash: z.string().optional(), // Hash do IP (não salvar IP direto)
  referrer: z.string().optional(),
  metadata: z.record(z.any()).optional(), // Dados extras do evento
  
  // ⏰ TIMING
  occurredAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export const insertCheckoutEventSchema = checkoutEventSchema.omit({
  id: true,
  createdAt: true,
});

export type CheckoutEvent = z.infer<typeof checkoutEventSchema>;
export type InsertCheckoutEvent = z.infer<typeof insertCheckoutEventSchema>;

// 📈 CHECKOUT ANALYTICS SCHEMA - Agregações para dashboard
export const checkoutAnalyticsSchema = z.object({
  id: z.string().default(() => `ana_${generateUniqueId()}`),
  
  // 🛒 FILTROS
  checkoutId: z.string().optional(), // null = global
  productId: z.string().optional(),
  tenantId: z.string(),
  
  // 📅 PERÍODO
  periodType: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  
  // 📊 MÉTRICAS
  metrics: z.object({
    totalPageviews: z.number().default(0),
    uniqueVisitors: z.number().default(0),
    checkoutsInitiated: z.number().default(0),
    purchaseClicks: z.number().default(0),
    purchasesApproved: z.number().default(0),
    purchasesPending: z.number().default(0),
    conversionRate: z.number().default(0), // %
  }),
  
  // 🗺️ DADOS GEOGRÁFICOS
  geoData: z.object({
    byCountry: z.record(z.number()).optional(),
    byState: z.record(z.number()).optional(), // Brasil
    byCity: z.record(z.number()).optional(),
    topLocations: z.array(z.object({
      location: z.string(),
      count: z.number(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    })).optional(),
  }).optional(),
  
  // ⏰ PICOS
  peakHours: z.array(z.object({
    hour: z.number(), // 0-23
    count: z.number(),
  })).optional(),
  
  // 🔒 METADADOS
  lastUpdated: z.date(),
  createdAt: z.date(),
});

export const insertCheckoutAnalyticsSchema = checkoutAnalyticsSchema.omit({
  id: true,
  createdAt: true,
});

export type CheckoutAnalytics = z.infer<typeof checkoutAnalyticsSchema>;
export type InsertCheckoutAnalytics = z.infer<typeof insertCheckoutAnalyticsSchema>;

// 👥 ACTIVE SESSION SCHEMA - Usuários ao vivo
export const activeSessionSchema = z.object({
  id: z.string().default(() => `sess_${generateUniqueId()}`),
  
  // 🛒 IDENTIFICAÇÃO
  checkoutId: z.string(),
  sessionId: z.string(),
  tenantId: z.string(),
  
  // 🌍 LOCALIZAÇÃO
  geo: z.object({
    country: z.string().optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }).optional(),
  
  // ⏰ ATIVIDADE
  lastHeartbeat: z.date(),
  firstSeen: z.date(),
  pageUrl: z.string().optional(),
  
  // 🔒 METADADOS
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const insertActiveSessionSchema = activeSessionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ActiveSession = z.infer<typeof activeSessionSchema>;
export type InsertActiveSession = z.infer<typeof insertActiveSessionSchema>;

// 🔧 GENERATOR FUNCTIONS
export function generateCustomerProfileId(): string { return `cust_${generateUniqueId()}`; }
export function generateEntitlementId(): string { return `ent_${generateUniqueId()}`; }
export function generateRefundRequestId(): string { return `ref_${generateUniqueId()}`; }
export function generateCheckoutEventId(): string { return `evt_${generateUniqueId()}`; }
export function generateCheckoutAnalyticsId(): string { return `ana_${generateUniqueId()}`; }
export function generateActiveSessionId(): string { return `sess_${generateUniqueId()}`; }


// ==========================================
// 💰 SISTEMA DE TAXAS E ANTECIPAÇÃO (v2 - Corrigido)
// ==========================================

// 💳 Configuração de taxa para um adquirente específico
export const acquirerFeeConfigSchema = z.object({
  // 📊 TAXAS BASE
  percentageFee: z.number().min(0).max(100), // Taxa percentual (ex: 2.0 para PIX 2%, 5.2 para cartão 5.2%)
  fixedFeeCents: z.number().int().min(0).default(0), // Taxa fixa por transação EM CENTAVOS (ex: 249 = R$ 2,49)
  
  // ⏰ ANTECIPAÇÃO (apenas para cartão)
  releaseDays: z.number().int().min(0).max(90).default(30), // Dias até liberação (0, 1, 2, 7, 14, 20, 30, etc)
  anticipationFeePercent: z.number().min(0).max(100).optional(), // Taxa adicional % para antecipação (ex: 1.0 = +1%)
  
  // 📅 METADADOS
  updatedAt: z.date(),
  updatedBy: z.string().optional(), // UID do admin que fez a alteração
});

// 🌐 Configuração GLOBAL de taxas (padrão do sistema)
export const globalFeeConfigSchema = z.object({
  id: z.literal('globalConfig'), // ID fixo no Firestore
  
  // 💳 TAXAS POR ADQUIRENTE (alinhado com sistema existente)
  // PIX
  pix: acquirerFeeConfigSchema.optional(),
  
  // CARTÕES BRASIL
  creditCardBR_D30: acquirerFeeConfigSchema.optional(), // Padrão: 5.2%, D30
  creditCardBR_D20: acquirerFeeConfigSchema.optional(), // Antecipação: 6.2%, D20
  creditCardBR_default: z.enum(['D30', 'D20']).default('D30'),
  
  // CARTÕES INTERNACIONAL
  creditCardGlobal: acquirerFeeConfigSchema.optional(),
  
  // BOLETO
  boleto: acquirerFeeConfigSchema.optional(),
  
  // ADQUIRENTES ESPECÍFICOS
  stripe: acquirerFeeConfigSchema.optional(),
  efibank: acquirerFeeConfigSchema.optional(),
  adyen: acquirerFeeConfigSchema.optional(),
  woovi: acquirerFeeConfigSchema.optional(),
  pagarme: acquirerFeeConfigSchema.optional(),
  witetec: acquirerFeeConfigSchema.optional(),
  
  // 📅 METADADOS
  createdAt: z.date(),
  updatedAt: z.date(),
});

// 👤 Override de taxas PERSONALIZADO por seller
export const sellerFeeOverrideSchema = z.object({
  id: z.string(), // sellerId (tenantId)
  sellerId: z.string(), // tenantId
  
  // 💳 TAXAS PERSONALIZADAS (undefined = usa taxa global)
  pix: acquirerFeeConfigSchema.optional(),
  
  creditCardBR_D30: acquirerFeeConfigSchema.optional(),
  creditCardBR_D20: acquirerFeeConfigSchema.optional(),
  creditCardBR_selected: z.enum(['D30', 'D20']).default('D30'), // Escolha atual do seller
  
  creditCardGlobal: acquirerFeeConfigSchema.optional(),
  boleto: acquirerFeeConfigSchema.optional(),
  
  stripe: acquirerFeeConfigSchema.optional(),
  efibank: acquirerFeeConfigSchema.optional(),
  adyen: acquirerFeeConfigSchema.optional(),
  woovi: acquirerFeeConfigSchema.optional(),
  pagarme: acquirerFeeConfigSchema.optional(),
  witetec: acquirerFeeConfigSchema.optional(),
  
  // 📊 PREFERÊNCIAS DO SELLER
  defaultAnticipation: z.enum(['D30', 'D20']).default('D30'), // Preferência de antecipação
  
  // 📅 METADADOS
  createdAt: z.date(),
  updatedAt: z.date(),
  customizedBy: z.string().optional(), // UID do admin que customizou
});

// 📝 Log de auditoria de mudanças de taxas
export const feeAuditLogSchema = z.object({
  id: z.string(),
  
  // 🎯 IDENTIFICAÇÃO
  sellerId: z.string().nullable(), // null = mudança global
  acquirer: z.string(), // pix, stripe, efibank, adyen, woovi, creditCardBR, creditCardGlobal, boleto, etc
  releaseOption: z.string().optional(), // "D30", "D20", etc (apenas para cartão)
  
  // 📊 MUDANÇA
  changeType: z.enum(['created', 'updated', 'deleted', 'restored_default']),
  oldValue: z.object({
    percentageFee: z.number(),
    fixedFeeCents: z.number(),
    releaseDays: z.number(),
  }).nullable(),
  newValue: z.object({
    percentageFee: z.number(),
    fixedFeeCents: z.number(),
    releaseDays: z.number(),
  }).nullable(),
  
  // 👤 RESPONSÁVEL
  changedBy: z.string(), // UID do admin ou seller
  changedByRole: z.enum(['admin', 'seller']),
  reason: z.string().optional(), // Motivo da mudança
  
  // 📅 METADADOS
  createdAt: z.date(),
});

// 🔧 TIPOS EXPORTADOS
export type AcquirerFeeConfig = z.infer<typeof acquirerFeeConfigSchema>;
export type GlobalFeeConfig = z.infer<typeof globalFeeConfigSchema>;
export type SellerFeeOverride = z.infer<typeof sellerFeeOverrideSchema>;
export type FeeAuditLog = z.infer<typeof feeAuditLogSchema>;

// 🔧 GENERATOR FUNCTIONS
export function generateFeeAuditLogId(): string { return `fee_audit_${generateUniqueId()}`; }

// 💰 TAXAS PADRÃO DO SISTEMA (hardcoded) - TODOS OS VALORES EM CENTAVOS
export const DEFAULT_FEES: GlobalFeeConfig = {
  id: 'globalConfig',
  
  // PIX: 2%, R$0, liberação imediata
  pix: {
    percentageFee: 2.0,
    fixedFeeCents: 0, // R$ 0,00
    releaseDays: 0, // D0 - imediato
    updatedAt: new Date(),
  },
  
  // CARTÃO BRASIL D30: 5.2%, R$2.49, liberação em 30 dias
  creditCardBR_D30: {
    percentageFee: 5.2,
    fixedFeeCents: 249, // R$ 2,49 em CENTAVOS
    releaseDays: 30,
    updatedAt: new Date(),
  },
  
  // CARTÃO BRASIL D20: 6.2%, R$2.49, liberação em 20 dias (antecipação)
  creditCardBR_D20: {
    percentageFee: 6.2,
    fixedFeeCents: 249, // R$ 2,49 em CENTAVOS
    releaseDays: 20,
    anticipationFeePercent: 1.0, // +1% de taxa de antecipação
    updatedAt: new Date(),
  },
  
  creditCardBR_default: 'D30',
  
  // CARTÃO INTERNACIONAL: 5.5%, R$2.49, liberação em 30 dias
  creditCardGlobal: {
    percentageFee: 5.5,
    fixedFeeCents: 249, // R$ 2,49 em CENTAVOS
    releaseDays: 30,
    updatedAt: new Date(),
  },
  
  // BOLETO: 3.5%, R$3.49, liberação em 2 dias
  boleto: {
    percentageFee: 3.5,
    fixedFeeCents: 349, // R$ 3,49 em CENTAVOS
    releaseDays: 2,
    updatedAt: new Date(),
  },
  
  createdAt: new Date(),
  updatedAt: new Date(),
};

// 🛠️ HELPER: Formatar centavos para reais
export function formatCentsToReais(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// 🛠️ HELPER: Converter reais para centavos
export function convertReaisToCents(reais: number): number {
  return Math.round(reais * 100);
}
